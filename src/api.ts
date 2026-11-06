import * as z from "zod/v4";
import {
    API_BASE_URL,
    API_KEY,
    BIG_UPLOAD_CHUNK_BYTES,
    MAX_READ_BYTES,
    REQUEST_TIMEOUT_MS,
    SERVER_NAME,
    SERVER_VERSION,
    SESSION_TOKEN,
    SITE_BASE_URL,
    UPLOAD_TIMEOUT_MS
} from "./constants.js";

const KEY_HINT = "Generate a key at https://nekoweb.org/api while logged in and set it as NEKOWEB_API_KEY.";
const SESSION_HINT =
    'Ask the user to copy the "token" cookie for nekoweb.org from a browser where they are logged in, set it as NEKOWEB_SESSION_TOKEN in this server\'s MCP config, and restart their MCP client. They should not paste the token into the chat.';

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

// nekoweb.org's own pages answer with HTML pages or plain text instead of JSON.
export function sitePageError(status: number, body: string, domain: string, reset?: string | null, ownSite = true): string {
    if ((status >= 300 && status < 400) || /Security error|Not logged in/i.test(body)) {
        return `Nekoweb rejected the session (HTTP ${status}), which means the session token is invalid or expired, for example because the user logged out. ${SESSION_HINT}`;
    }
    if (status === 429) {
        return `Rate limit exceeded (HTTP 429).${reset ? ` The limit resets at ${describeReset(reset)}.` : ""} Wait before retrying.`;
    }
    if (/Site not found/i.test(body)) {
        return ownSite
            ? `Site not found: ${domain} isn't a site on the logged-in account. nekoweb_list_sites lists your sites.`
            : `Site not found: there is no Nekoweb site at ${domain}.`;
    }
    const message = body.includes("<") ? body.match(/<p>\s*([^<]+?)\s*<\/p>/)?.[1] : errorDetail(body).slice(0, 300);
    if (message && status < 500) return `Nekoweb refused the request (HTTP ${status}): ${message}`;
    return `Nekoweb returned HTTP ${status} for ${domain}. Try again in a moment.`;
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

const INJECTED_LINK =
    /<a href="https?:\/\/[^"/]+\/cdn-cgi\/content\?id=[^"]*" aria-hidden="true" rel="nofollow noopener" style="display: none !important; visibility: hidden !important"><\/a>/g;

export function stripInjectedLinks(bytes: Uint8Array): Uint8Array {
    const text = Buffer.from(bytes).toString("latin1");
    const cleaned = text.replace(INJECTED_LINK, "");
    return cleaned.length === text.length ? bytes : new Uint8Array(Buffer.from(cleaned, "latin1"));
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
    constructor(
        private readonly apiKey: string | undefined,
        private readonly sessionToken: string | undefined
    ) {}

    private async send(url: URL, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
        const timeout = AbortSignal.timeout(timeoutMs);
        try {
            // Don't follow redirects: bad credentials would otherwise come back as the login page with status 200.
            return await fetch(url, {
                ...init,
                headers: { "User-Agent": `${SERVER_NAME}/${SERVER_VERSION}`, ...(init.headers as Record<string, string>) },
                redirect: "manual",
                signal: signal ? AbortSignal.any([signal, timeout]) : timeout
            });
        } catch (error) {
            if (timeout.aborted) throw new NekowebError(`Nekoweb did not respond within ${timeoutMs / 1000} seconds. Try again later.`);
            if (signal?.aborted) throw error;
            throw new NekowebError(`Could not reach Nekoweb: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async request(path: string, opts: RequestOptions = {}): Promise<Response> {
        const { method = "GET", query, body, signal, timeoutMs = REQUEST_TIMEOUT_MS, auth = true } = opts;
        if (auth && !this.apiKey) throw new NekowebError(`No Nekoweb API key configured. ${KEY_HINT}`);

        const url = new URL(API_BASE_URL + path);
        for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
        const headers: Record<string, string> = this.apiKey ? { Authorization: this.apiKey } : {};
        const response = await this.send(url, { method, headers, body }, timeoutMs, signal);
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

    // nekoweb.org's own pages and forms, as opposed to the API, need the login session token.
    // 'ownSite' is the user's site whose settings are read or changed; 'about' names the page in errors otherwise.
    private async sitePage(
        url: URL,
        { ownSite, about, init = {}, signal }: { ownSite?: string; about?: string; init?: RequestInit; signal?: AbortSignal }
    ): Promise<Response> {
        if (!this.sessionToken) throw new NekowebError(`No Nekoweb session token configured. ${SESSION_HINT}`);
        const headers = {
            Cookie: `token=${this.sessionToken}`,
            Origin: SITE_BASE_URL,
            Referer: ownSite ? `${SITE_BASE_URL}/settings/${encodeURIComponent(ownSite)}` : SITE_BASE_URL + url.pathname
        };
        const response = await this.send(url, { ...init, headers }, REQUEST_TIMEOUT_MS, signal);
        // A successful form submission redirects back to the settings page.
        const backToSettings = init.method === "POST" && response.headers.get("location")?.includes("/settings/");
        if (response.ok || backToSettings) return response;
        const body = await response.text().catch(() => "");
        const name = ownSite ?? about ?? decodeURIComponent(url.pathname);
        throw new NekowebError(sitePageError(response.status, body, name, response.headers.get("ratelimit-reset"), ownSite !== undefined));
    }

    async getSettingsPage(domain: string, page?: string, signal?: AbortSignal): Promise<string> {
        const url = new URL(`${SITE_BASE_URL}/settings/${encodeURIComponent(domain)}`);
        if (page) url.searchParams.set("page", page);
        return (await this.sitePage(url, { ownSite: domain, signal })).text();
    }

    async getStatsPage(domain: string, time: "month" | "year" | "all", signal?: AbortSignal): Promise<string> {
        const url = new URL(`${SITE_BASE_URL}/settings/${encodeURIComponent(domain)}/stats`);
        url.searchParams.set("time", time);
        return (await this.sitePage(url, { ownSite: domain, signal })).text();
    }

    // Sort is "followdate", "lastupd" or "follows".
    async getFollowersPage(domain: string, page: number, sort: string, signal?: AbortSignal): Promise<string> {
        const url = new URL(`${SITE_BASE_URL}/followers/${encodeURIComponent(domain)}`);
        url.searchParams.set("page", String(page));
        url.searchParams.set("sort", sort);
        return (await this.sitePage(url, { ownSite: domain, signal })).text();
    }

    async getSessionPage(path: string, query: Record<string, string>, signal?: AbortSignal): Promise<string> {
        const url = new URL(SITE_BASE_URL + path);
        for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
        return (await this.sitePage(url, { signal })).text();
    }

    // Explore is public, but only shows which sites you follow when logged in.
    async getExplorePage(query: Record<string, string>, signal?: AbortSignal): Promise<{ html: string; loggedIn: boolean }> {
        if (this.sessionToken) return { html: await this.getSessionPage("/explore", query, signal), loggedIn: true };
        return { html: await this.getPublicPage(`/explore?${new URLSearchParams(query)}`, signal), loggedIn: false };
    }

    async getPublicPage(path: string, signal?: AbortSignal): Promise<string> {
        const response = await this.send(new URL(SITE_BASE_URL + path), {}, REQUEST_TIMEOUT_MS, signal);
        if (!response.ok) {
            await response.body?.cancel();
            throw new NekowebError(`Nekoweb returned HTTP ${response.status} for ${path}. Try again in a moment.`);
        }
        return response.text();
    }

    // The page behind the "Follow on Nekoweb" button. It only asks for confirmation, so loading it changes nothing.
    async getFollowPage(domain: string, signal?: AbortSignal): Promise<string> {
        const url = new URL(`${SITE_BASE_URL}/follow/${encodeURIComponent(domain)}`);
        return (await this.sitePage(url, { about: domain, signal })).text();
    }

    // Returns whether the site is followed afterwards.
    async toggleFollow(domain: string, signal?: AbortSignal): Promise<boolean> {
        const url = new URL(`${SITE_BASE_URL}/api/${encodeURIComponent(domain)}/toggle_follow`);
        const body = await (await this.sitePage(url, { about: domain, signal })).text();
        try {
            const result = JSON.parse(body) as { followed?: unknown };
            if (typeof result.followed === "boolean") return result.followed;
        } catch {}
        throw new NekowebError(`Nekoweb returned an unexpected response when toggling the follow for ${domain}: ${body.slice(0, 300)}`);
    }

    async submitSettingsForm(domain: string, action: string, fields: Record<string, string>, signal?: AbortSignal): Promise<void> {
        const init = { method: "POST", body: new URLSearchParams(fields) };
        const response = await this.sitePage(new URL(SITE_BASE_URL + action), { ownSite: domain, init, signal });
        await response.body?.cancel();
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
        const contentType = response.headers.get("content-type") ?? "";
        let bytes: Uint8Array = new Uint8Array(await response.arrayBuffer());
        if (/html/i.test(contentType)) bytes = stripInjectedLinks(bytes);
        if (bytes.byteLength > MAX_READ_BYTES) throw tooBig(bytes.byteLength);
        return { contentType, bytes };
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

export const nekoweb = new NekowebClient(API_KEY, SESSION_TOKEN);
