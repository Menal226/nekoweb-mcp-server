import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { nekoweb } from "../api.js";
import { CHARACTER_LIMIT, MAX_INLINE_IMAGE_BYTES, MAX_RECURSIVE_FOLDER_REQUESTS } from "../constants.js";
import { joinSitePath, normalizeEntryPath, normalizeSitePath, splitPath } from "../paths.js";
import { formatBytes, json, OVERWRITES, pathField, READ_ONLY, responseFormatField, text, WRITES } from "./common.js";

const IMAGE_EXTENSIONS: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    ico: "image/x-icon",
    bmp: "image/bmp"
};

export function decodeUtf8(bytes: Uint8Array): string | undefined {
    if (bytes.includes(0)) return undefined;
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        return undefined;
    }
}

export function imageType(pathname: string, contentType: string): string | undefined {
    const header = contentType.split(";")[0].trim().toLowerCase();
    if (header.startsWith("image/")) return header;
    return IMAGE_EXTENSIONS[pathname.slice(pathname.lastIndexOf(".") + 1).toLowerCase()];
}

export function registerFileTools(server: McpServer): void {
    server.registerTool(
        "nekoweb_list_folder",
        {
            title: "List folder",
            description: `List the files and folders inside a folder of your Nekoweb site, sorted by path.

Set recursive=true to walk subfolders too (up to max_depth levels; each subfolder costs one API request against the rate limit, capped at ${MAX_RECURSIVE_FOLDER_REQUESTS} per call). Results are paginated with limit/offset.

Examples:
  - "What's on my site?" -> { path: "/" }
  - "Find every image on my site" -> { path: "/mysite.nekoweb.org/assets", recursive: true }`,
            inputSchema: z.strictObject({
                path: pathField("/mysite.nekoweb.org/blog").default("/"),
                recursive: z.boolean().default(false).describe("Also list the contents of subfolders"),
                max_depth: z.number().int().min(1).max(10).default(3).describe("How many folder levels to descend when recursive=true"),
                limit: z.number().int().min(1).max(500).default(100).describe("Maximum number of entries to return"),
                offset: z.number().int().min(0).default(0).describe("Number of entries to skip, for pagination"),
                response_format: responseFormatField
            }),
            annotations: READ_ONLY
        },
        async ({ path, recursive, max_depth, limit, offset, response_format }, ctx) => {
            const root = normalizeSitePath(path);
            const entries: { name: string; path: string; dir: boolean }[] = [];
            const queue = [{ folder: root, depth: 1 }];
            let requests = 0;
            let truncated = false;

            for (let next = queue.shift(); next; next = queue.shift()) {
                if (++requests > MAX_RECURSIVE_FOLDER_REQUESTS) {
                    truncated = true;
                    break;
                }
                for (const child of await nekoweb.readFolder(next.folder, ctx.mcpReq.signal)) {
                    const childPath = joinSitePath(next.folder, child.name);
                    entries.push({ name: child.name, path: childPath, dir: child.dir });
                    if (recursive && child.dir && next.depth < max_depth) queue.push({ folder: childPath, depth: next.depth + 1 });
                }
            }
            entries.sort((a, b) => a.path.localeCompare(b.path));

            const render = (count: number) => {
                const page = entries.slice(offset, offset + count);
                const nextOffset = offset + page.length;
                const hasMore = entries.length > nextOffset;
                const data = {
                    path: root,
                    total: entries.length,
                    offset,
                    entries: page,
                    has_more: hasMore,
                    ...(hasMore && { next_offset: nextOffset }),
                    ...(truncated && { walk_truncated: true })
                };
                if (response_format === "json") return { data, text: JSON.stringify(data, null, 2) };
                const lines = [`# ${root}`, `Showing ${page.length} of ${entries.length} entries.`, ""];
                for (const entry of page) {
                    const label = recursive ? entry.path : entry.name;
                    lines.push(entry.dir ? `- 📁 ${label}/` : `- ${label}`);
                }
                if (hasMore) lines.push("", `More entries: call again with offset=${nextOffset}.`);
                if (truncated)
                    lines.push("", `Stopped after ${MAX_RECURSIVE_FOLDER_REQUESTS} folder requests; list deeper folders separately.`);
                return { data, text: lines.join("\n") };
            };

            // Stay under the character limit by returning fewer entries.
            let count = limit;
            let result = render(count);
            while (count > 1 && result.text.length > CHARACTER_LIMIT) result = render((count = Math.ceil(count / 2)));

            if (response_format === "json") return { content: [{ type: "text", text: result.text }], structuredContent: result.data };
            return text(entries.length === 0 ? `${root} is empty.` : result.text);
        }
    );

    server.registerTool(
        "nekoweb_read_file",
        {
            title: "Read file",
            description: `Read the raw source of a file on your Nekoweb site (SSI directives in .html files are returned as written, not rendered).

Text files are returned as text, paginated by character offset. Images up to ${formatBytes(MAX_INLINE_IMAGE_BYTES)} are returned as images. Other binaries return only their size.

Examples:
  - "Show me my homepage HTML" -> { path: "/mysite.nekoweb.org/index.html" }
  - "Read the rest of the stylesheet" -> { path: "/mysite.nekoweb.org/style.css", offset: 20000 }`,
            inputSchema: z.strictObject({
                path: pathField("/mysite.nekoweb.org/index.html"),
                offset: z
                    .number()
                    .int()
                    .min(0)
                    .default(0)
                    .describe("Character offset to start reading from, for files longer than max_chars"),
                max_chars: z.number().int().min(100).max(CHARACTER_LIMIT).default(20_000).describe("Maximum characters of text to return")
            }),
            annotations: READ_ONLY
        },
        async ({ path, offset, max_chars }, ctx) => {
            const pathname = normalizeEntryPath(path);
            const { contentType, bytes } = await nekoweb.getFile(pathname, ctx.mcpReq.signal);
            const size = formatBytes(bytes.byteLength);

            const content = decodeUtf8(bytes);
            if (content !== undefined) {
                if (offset > 0 && offset >= content.length) {
                    return text(`offset ${offset} is past the end of ${pathname} (${content.length} characters).`);
                }
                const end = Math.min(offset + max_chars, content.length);
                const header = [`${pathname} — ${size}, ${content.length} characters`];
                if (end < content.length || offset > 0) header.push(`Showing characters ${offset}–${end}.`);
                if (end < content.length) header.push(`More content: call again with offset=${end}.`);
                return {
                    content: [
                        { type: "text", text: header.join("\n") },
                        { type: "text", text: content.slice(offset, end) }
                    ]
                };
            }

            const mimeType = imageType(pathname, contentType);
            if (mimeType && bytes.byteLength <= MAX_INLINE_IMAGE_BYTES) {
                return {
                    content: [
                        { type: "text", text: `${pathname} — ${mimeType}, ${size}` },
                        { type: "image", data: Buffer.from(bytes).toString("base64"), mimeType }
                    ]
                };
            }
            return text(`${pathname} is a binary file (${size}); its contents can't be shown as text.`);
        }
    );

    server.registerTool(
        "nekoweb_create",
        {
            title: "Create file or folder",
            description: `Create a new empty file or a new folder on your Nekoweb site. Fails if something already exists at that path.

To create a file with content in one step, use nekoweb_write_file instead.

Examples:
  - "Make a blog folder" -> { path: "/mysite.nekoweb.org/blog", is_folder: true }
  - "Create an empty robots.txt" -> { path: "/mysite.nekoweb.org/robots.txt", is_folder: false }`,
            inputSchema: z.strictObject({
                path: pathField("/mysite.nekoweb.org/blog"),
                is_folder: z.boolean().describe("true to create a folder, false to create an empty file")
            }),
            annotations: WRITES
        },
        async ({ path, is_folder }, ctx) => {
            const pathname = normalizeEntryPath(path);
            await nekoweb.create(pathname, is_folder, ctx.mcpReq.signal);
            return text(`Created ${is_folder ? "folder" : "file"} ${pathname}`);
        }
    );

    server.registerTool(
        "nekoweb_write_file",
        {
            title: "Write text file",
            description: `Write text content to a file on your Nekoweb site, creating it or replacing its entire content.

mode='create_or_overwrite' (default) uploads the file whether or not it exists; the parent folder must already exist (create it with nekoweb_create). mode='edit_existing' only changes a file that already exists.

Always send the complete new file content; there is no partial update. For binary or local files, use nekoweb_upload_file.

Examples:
  - "Change my homepage title" -> read it with nekoweb_read_file, then { path: "/mysite.nekoweb.org/index.html", content: "<full new html>" }
  - "Add a stylesheet" -> { path: "/mysite.nekoweb.org/css/style.css", content: "body { ... }" }`,
            inputSchema: z.strictObject({
                path: pathField("/mysite.nekoweb.org/index.html"),
                content: z.string().max(50_000_000).describe("The complete new content of the file (UTF-8 text)"),
                mode: z
                    .enum(["create_or_overwrite", "edit_existing"])
                    .default("create_or_overwrite")
                    .describe(
                        "'create_or_overwrite' (default) writes the file whether or not it exists; 'edit_existing' fails if it doesn't"
                    )
            }),
            annotations: OVERWRITES
        },
        async ({ path, content, mode }, ctx) => {
            const pathname = normalizeEntryPath(path);
            const blob = new Blob([content]);
            if (mode === "edit_existing") {
                await nekoweb.edit(pathname, content, ctx.mcpReq.signal);
            } else {
                const { folder, name } = splitPath(pathname);
                await nekoweb.upload(folder, [{ name, blob }], ctx.mcpReq.signal);
            }
            return text(`Wrote ${formatBytes(blob.size)} to ${pathname}`);
        }
    );

    server.registerTool(
        "nekoweb_delete",
        {
            title: "Delete file or folder",
            description: `Permanently delete a file or a folder (including everything inside it) from your Nekoweb site. This cannot be undone.

Example: "Remove the old drafts folder" -> { path: "/mysite.nekoweb.org/drafts" }`,
            inputSchema: z.strictObject({ path: pathField("/mysite.nekoweb.org/old-page.html") }),
            annotations: OVERWRITES
        },
        async ({ path }, ctx) => {
            const pathname = normalizeEntryPath(path);
            await nekoweb.delete(pathname, ctx.mcpReq.signal);
            return text(`Deleted ${pathname}`);
        }
    );

    server.registerTool(
        "nekoweb_move",
        {
            title: "Rename or move",
            description: `Rename or move a file or folder on your Nekoweb site. Both are full paths from your file root; the destination's parent folder must exist.

Examples:
  - "Rename about.html to about-me.html" -> { from: "/mysite.nekoweb.org/about.html", to: "/mysite.nekoweb.org/about-me.html" }
  - "Move logo.png into the images folder" -> { from: "/mysite.nekoweb.org/logo.png", to: "/mysite.nekoweb.org/images/logo.png" }`,
            inputSchema: z.strictObject({
                from: pathField("/mysite.nekoweb.org/about.html").describe("Current path of the file or folder"),
                to: pathField("/mysite.nekoweb.org/pages/about.html").describe("New path of the file or folder")
            }),
            annotations: { ...OVERWRITES, idempotentHint: false }
        },
        async ({ from, to }, ctx) => {
            const source = normalizeEntryPath(from);
            const target = normalizeEntryPath(to);
            await nekoweb.rename(source, target, ctx.mcpReq.signal);
            return text(`Moved ${source} → ${target}`);
        }
    );
}
