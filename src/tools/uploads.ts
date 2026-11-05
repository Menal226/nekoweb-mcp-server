import { openAsBlob } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { NekowebError, nekoweb } from "../api.js";
import { LOCAL_ROOT, MAX_SIMPLE_UPLOAD_BYTES } from "../constants.js";
import { joinSitePath, normalizeSitePath } from "../paths.js";
import { formatBytes, OVERWRITES, reportProgress, text } from "./common.js";

interface UploadItem {
    name: string;
    blob: Blob;
}

async function localFile(path: string): Promise<UploadItem> {
    const real = await realpath(resolve(path)).catch(() => {
        throw new NekowebError(`Local file not found: ${resolve(path)}`);
    });
    if (LOCAL_ROOT) {
        const rel = relative(await realpath(LOCAL_ROOT), real);
        if (rel.startsWith("..") || isAbsolute(rel)) throw new NekowebError(`${real} is outside NEKOWEB_LOCAL_ROOT (${LOCAL_ROOT}).`);
    }
    if (!(await stat(real)).isFile()) {
        throw new NekowebError(`${real} is not a file (upload folders as a zip with nekoweb_import_zip).`);
    }
    return { name: basename(real), blob: await openAsBlob(real) };
}

function base64File(name: string, base64: string): UploadItem {
    if (/[/\\\0]/.test(name)) throw new NekowebError(`Invalid file name "${name}": use a plain name without slashes, e.g. "photo.png".`);
    return { name, blob: new Blob([Buffer.from(base64, "base64")]) };
}

// Small files are sent in batches under the 100MB request limit; large ones through the chunked big-file API.
async function uploadItems(folder: string, items: UploadItem[], ctx: ServerContext): Promise<string[]> {
    const signal = ctx.mcpReq.signal;
    const total = items.reduce((sum, item) => sum + item.blob.size, 0);
    const uploaded: string[] = [];
    let done = 0;
    let batch: UploadItem[] = [];
    let batchSize = 0;

    const flush = async () => {
        if (batch.length === 0) return;
        await nekoweb.upload(folder, batch, signal);
        for (const item of batch) uploaded.push(`${joinSitePath(folder, item.name)} (${formatBytes(item.blob.size)})`);
        done += batchSize;
        reportProgress(ctx, done, total, `Uploaded ${uploaded.length}/${items.length} files`);
        batch = [];
        batchSize = 0;
    };

    for (const item of items) {
        if (item.blob.size > MAX_SIMPLE_UPLOAD_BYTES) {
            const id = await nekoweb.bigUpload(item.blob, signal, sent =>
                reportProgress(ctx, done + sent, total, `Uploading ${item.name}`)
            );
            const target = joinSitePath(folder, item.name);
            await nekoweb.bigMove(id, target, signal);
            uploaded.push(`${target} (${formatBytes(item.blob.size)}, chunked)`);
            done += item.blob.size;
            continue;
        }
        if (batchSize + item.blob.size > MAX_SIMPLE_UPLOAD_BYTES) await flush();
        batch.push(item);
        batchSize += item.blob.size;
    }
    await flush();
    return uploaded;
}

export function registerUploadTools(server: McpServer): void {
    server.registerTool(
        "nekoweb_upload_file",
        {
            title: "Upload files",
            description: `Upload one or more files (any type, e.g. images, fonts, HTML) into a folder of your Nekoweb site. Existing files with the same name are overwritten.

Provide files as local_paths (files on this machine) and/or as base64 'files'. Files over 95MB are sent automatically with Nekoweb's chunked big-file upload. For plain text content, nekoweb_write_file is simpler.

Examples:
  - "Upload my banner" -> { folder: "/mysite.nekoweb.org/images", local_paths: ["C:/Users/me/banner.png"] }
  - "Add this favicon" -> { folder: "/mysite.nekoweb.org", files: [{ name: "favicon.ico", content_base64: "AAABAA..." }] }`,
            inputSchema: z.strictObject({
                folder: z
                    .string()
                    .min(1)
                    .max(1024)
                    .default("/")
                    .describe("Destination folder, e.g. '/mysite.nekoweb.org/images'; must already exist"),
                local_paths: z
                    .array(z.string().min(1))
                    .min(1)
                    .max(100)
                    .optional()
                    .describe("Absolute paths of local files; each keeps its file name"),
                files: z
                    .array(
                        z.strictObject({
                            name: z.string().min(1).max(255).describe("File name to create in the folder, e.g. 'logo.png'"),
                            content_base64: z.base64().describe("The file's bytes, base64-encoded")
                        })
                    )
                    .min(1)
                    .max(50)
                    .optional()
                    .describe("Files to upload from base64 content, each with a name")
            }),
            annotations: OVERWRITES
        },
        async ({ folder, local_paths = [], files = [] }, ctx) => {
            if (local_paths.length + files.length === 0) throw new NekowebError("Nothing to upload: pass local_paths or files.");
            const items = [...(await Promise.all(local_paths.map(localFile))), ...files.map(f => base64File(f.name, f.content_base64))];
            const names = items.map(item => item.name);
            const duplicate = names.find((name, i) => names.indexOf(name) !== i);
            if (duplicate) throw new NekowebError(`Two files are named "${duplicate}"; each upload needs a distinct name.`);

            const target = normalizeSitePath(folder);
            const uploaded = await uploadItems(target, items, ctx);
            return text([`Uploaded ${uploaded.length} file(s) to ${target}:`, ...uploaded.map(line => `- ${line}`)].join("\n"));
        }
    );

    server.registerTool(
        "nekoweb_import_zip",
        {
            title: "Import zip archive",
            description: `Upload a .zip archive and extract it into a folder of your Nekoweb site, e.g. to deploy a whole site at once. Extracted files overwrite existing files with the same paths.

The 'zip' rate limit is strict (often 1 import per period); check nekoweb_get_limits first when unsure.

Example: "Deploy my built site" -> { zip_local_path: "C:/projects/site/dist.zip", folder: "/mysite.nekoweb.org" }`,
            inputSchema: z.strictObject({
                folder: z.string().min(1).max(1024).default("/").describe("Folder to extract into, e.g. '/mysite.nekoweb.org'"),
                zip_local_path: z.string().min(1).optional().describe("Absolute path of a local .zip file"),
                zip_base64: z.base64().optional().describe("The .zip file's bytes, base64-encoded")
            }),
            annotations: OVERWRITES
        },
        async ({ folder, zip_local_path, zip_base64 }, ctx) => {
            if (!zip_local_path === !zip_base64) throw new NekowebError("Pass exactly one of zip_local_path or zip_base64.");
            const target = normalizeSitePath(folder);
            const zip = zip_local_path ? await localFile(zip_local_path) : base64File("archive.zip", zip_base64!);
            const id = await nekoweb.bigUpload(zip.blob, ctx.mcpReq.signal, sent =>
                reportProgress(ctx, sent, zip.blob.size, "Uploading archive")
            );
            await nekoweb.importZip(id, target, ctx.mcpReq.signal);
            return text(
                `Imported ${zip.name} (${formatBytes(zip.blob.size)}) into ${target}. Use nekoweb_list_folder to check the result.`
            );
        }
    );
}
