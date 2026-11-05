import * as z from "zod/v4";
import {
    API_BASE_URL,
    API_KEY,
    BIG_UPLOAD_CHUNK_BYTES,
    MAX_READ_BYTES,
    REQUEST_TIMEOUT_MS,
    SERVER_NAME,
    SERVER_VERSION,
    UPLOAD_TIMEOUT_MS
} from "./constants.js";

const KEY_HINT = "Generate a key at https://nekoweb.org/api while logged in and set it as NEKOWEB_API_KEY.";

export class NekowebError extends Error {}

export function httpErrorMessage(status: number, body: string, reset?: string | null): string {
    // Nekoweb redirects unauthenticated requests to its login page.
    if (status >= 300 && status < 400) {
        return `Nekoweb redirected the request to its login page (HTTP ${status}), which means the API key is missing or invalid. ${KEY_HINT}`;
    }
    const detail = errorDetail(body).slice(0, 500);
    const prefix = `Nekoweb API error (HTTP ${status})${detail ? `: ${detail}` : ""}.`;
    switch (status) {
        case 401:
        case 403:
            return `${prefix} The API key was rejected. ${KEY_HINT}`;
        case 404:
            return `${prefix} The path or site was not found. Use nekoweb_list_folder to check which files exist.`;
        case 429:
            return `${prefix} Rate limit exceeded.${reset ? ` The limit resets at ${describeReset(reset)}.` : ""} Wait before retrying; nekoweb_get_limits shows the remaining quota.`;
        default:
            return status >= 500
                ? `${prefix} Nekoweb is having trouble; try again in a moment.`
                : `${prefix} Check the path with nekoweb_list_folder; a site's files are usually inside a folder named after it, e.g. "/mysite.nekoweb.org/index.html".`;
    }
}

function errorDetail(body: string): string {
    try {
        const parsed = JSON.parse(body) as { error?: unknown } | null;
        if (typeof parsed?.error === "string") return parsed.error;
    } catch {}
    return body.trim();
}

// Reset values are epoch milliseconds, epoch seconds, or seconds until the reset.
export function describeReset(reset: string | number): string {
    const n = Number(reset);
    if (!Number.isFinite(n) || n < 0) return "not started";
    if (n > 1e12) return new Date(n).toISOString();
    if (n > 1e9) return new Date(n * 1000).toISOString();
    return `${Math.ceil(n)} seconds from now`;
}

const SiteInfoSchema = z.object({
    id: z.number().optional(),
    // The API sends 1/0 here, not true/false.
    main: z.union([z.boolean(), z.number()]).transform(Boolean).optional(),
    domain: z.string(),
    folder: z.string().optional(),
    title: z.string().nullish(),
    updates: z.number().nullish(),
    followers: z.number().nullish(),
    views: z.number().nullish(),
    created_at: z.number().nullish(),
    updated_at: z.number().nullish()
});
export type SiteInfo = z.infer<typeof SiteInfoSchema>;

const FolderEntrySchema = z.object({ name: z.string(), dir: z.boolean() });
const LimitsSchema = z.record(z.string(), z.object({ limit: z.number(), remaining: z.number(), reset: z.number() }));

interface RequestOptions {
    method?: "GET" | "POST";
    query?: Record<string, string>;
    body?: URLSearchParams | FormData;
    signal?: AbortSignal;
    timeoutMs?: number;
    auth?: boolean;
}

class NekowebClient {
    constructor(private readonly apiKey: string | undefined) {}

    private async request(path: string, opts: RequestOptions = {}): Promise<Response> {
        const { method = "GET", query, body, signal, timeoutMs = REQUEST_TIMEOUT_MS, auth = true } = opts;
        if (auth && !this.apiKey) throw new NekowebError(`No Nekoweb API key configured. ${KEY_HINT}`);

        const url = new URL(API_BASE_URL + path);
        for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
        const headers: Record<string, string> = { "User-Agent": `${SERVER_NAME}/${SERVER_VERSION}` };
        if (this.apiKey) headers.Authorization = this.apiKey;
        const timeout = AbortSignal.timeout(timeoutMs);

        let response: Response;
        try {
            // Don't follow redirects: a bad key would otherwise come back as the login page with status 200.
            response = await fetch(url, {
                method,
                headers,
                body,
                redirect: "manual",
                signal: signal ? AbortSignal.any([signal, timeout]) : timeout
            });
        } catch (error) {
            if (timeout.aborted) throw new NekowebError(`Nekoweb did not respond within ${timeoutMs / 1000} seconds. Try again later.`);
            if (signal?.aborted) throw error;
            throw new NekowebError(`Could not reach Nekoweb: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new NekowebError(httpErrorMessage(response.status, text, response.headers.get("ratelimit-reset")));
        }
        return response;
    }

    private async json<T>(schema: z.ZodType<T>, path: string, opts?: RequestOptions): Promise<T> {
        const text = await (await this.request(path, opts)).text();
        try {
            return schema.parse(JSON.parse(text));
        } catch {
            throw new NekowebError(`Nekoweb returned an unexpected response for ${path}: ${text.slice(0, 300)}`);
        }
    }

    private async post(path: string, body: URLSearchParams | FormData, signal?: AbortSignal): Promise<void> {
        await this.request(path, { method: "POST", body, signal, timeoutMs: UPLOAD_TIMEOUT_MS });
    }

    getSiteInfo(signal?: AbortSignal): Promise<SiteInfo> {
        return this.json(SiteInfoSchema, "/site/info", { signal });
    }

    getAllSites(signal?: AbortSignal): Promise<SiteInfo[]> {
        return this.json(z.array(SiteInfoSchema), "/site/info_all", { signal });
    }

    getPublicSiteInfo(domain: string, signal?: AbortSignal): Promise<SiteInfo> {
        return this.json(SiteInfoSchema, `/site/info/${encodeURIComponent(domain)}`, { signal, auth: false });
    }

    getLimits(signal?: AbortSignal) {
        return this.json(LimitsSchema, "/files/limits", { signal });
    }

    readFolder(pathname: string, signal?: AbortSignal) {
        return this.json(z.array(FolderEntrySchema), "/files/readfolder", { query: { pathname }, signal });
    }

    async getFile(pathname: string, signal?: AbortSignal): Promise<{ contentType: string; bytes: Uint8Array }> {
        const response = await this.request("/files/get", { query: { pathname }, signal, timeoutMs: UPLOAD_TIMEOUT_MS });
        const tooBig = (size: number) => new NekowebError(`${pathname} is ${size} bytes, over the ${MAX_READ_BYTES} byte read limit.`);
        const length = Number(response.headers.get("content-length") ?? 0);
        if (length > MAX_READ_BYTES) {
            await response.body?.cancel();
            throw tooBig(length);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > MAX_READ_BYTES) throw tooBig(bytes.byteLength);
        return { contentType: response.headers.get("content-type") ?? "", bytes };
    }

    create(pathname: string, isFolder: boolean, signal?: AbortSignal) {
        return this.post("/files/create", new URLSearchParams({ pathname, isFolder: String(isFolder) }), signal);
    }

    delete(pathname: string, signal?: AbortSignal) {
        return this.post("/files/delete", new URLSearchParams({ pathname }), signal);
    }

    rename(pathname: string, newpathname: string, signal?: AbortSignal) {
        return this.post("/files/rename", new URLSearchParams({ pathname, newpathname }), signal);
    }

    edit(pathname: string, content: string, signal?: AbortSignal) {
        const form = new FormData();
        form.append("pathname", pathname);
        form.append("content", content);
        return this.post("/files/edit", form, signal);
    }

    // Overwrites files with the same names. The total must stay under 100MB.
    upload(folder: string, files: { name: string; blob: Blob }[], signal?: AbortSignal) {
        const form = new FormData();
        form.append("pathname", folder);
        for (const file of files) form.append("files", file.blob, file.name);
        return this.post("/files/upload", form, signal);
    }

    // Sends a blob of any size in chunks through the big-file API and returns the upload id.
    async bigUpload(blob: Blob, signal?: AbortSignal, onChunk?: (sent: number) => void): Promise<string> {
        const { id } = await this.json(z.object({ id: z.string().min(1) }), "/files/big/create", { signal });
        let start = 0;
        do {
            const end = Math.min(start + BIG_UPLOAD_CHUNK_BYTES, blob.size);
            const form = new FormData();
            form.append("id", id);
            form.append("file", blob.slice(start, end), "chunk");
            await this.post("/files/big/append", form, signal);
            onChunk?.(end);
            start = end;
        } while (start < blob.size);
        return id;
    }

    bigMove(id: string, pathname: string, signal?: AbortSignal) {
        return this.post("/files/big/move", new URLSearchParams({ id, pathname }), signal);
    }

    importZip(id: string, path: string, signal?: AbortSignal) {
        return this.post(`/files/import/${encodeURIComponent(id)}`, new URLSearchParams({ path }), signal);
    }
}

export const nekoweb = new NekowebClient(API_KEY);
