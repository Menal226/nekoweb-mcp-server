import type { CallToolResult, ServerContext } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { nekoweb } from "../api.js";
import { normalizeDomain } from "../paths.js";

export const responseFormatField = z
    .enum(["markdown", "json"])
    .default("markdown")
    .describe("'markdown' for readable text (default), 'json' for structured data");

export const pathField = (example: string) =>
    z.string().min(1).max(1024).describe(`Path from the account's file root, including the site folder, e.g. '${example}'`);

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
export const WRITES = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
export const OVERWRITES = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } as const;

export function text(value: string): CallToolResult {
    return { content: [{ type: "text", text: value }] };
}

export function json(value: Record<string, unknown>): CallToolResult {
    return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

export function formatDate(ms: number | null | undefined): string {
    return ms ? new Date(ms).toISOString().slice(0, 19).replace("T", " ") + " UTC" : "unknown";
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function reportProgress(ctx: ServerContext, progress: number, total: number, message: string): void {
    const progressToken = ctx.mcpReq._meta?.progressToken;
    if (progressToken === undefined) return;
    ctx.mcpReq.notify({ method: "notifications/progress", params: { progressToken, progress, total, message } }).catch(() => {});
}

export const SESSION_NOTE = `Requires the optional session token (NEKOWEB_SESSION_TOKEN). If it isn't set, this tool returns setup steps to pass on to the user.`;

export const siteField = z
    .string()
    .min(1)
    .max(253)
    .optional()
    .describe("Domain of one of your sites, e.g. 'mysite.nekoweb.org'. Omit for the site the API key belongs to.");

export const pageField = z.number().int().min(1).max(10_000);

export async function resolveDomain(site: string | undefined, signal: AbortSignal): Promise<string> {
    return site ? normalizeDomain(site) : (await nekoweb.getSiteInfo(signal)).domain;
}

export const MAX_PAGES = 20;

// Without a page, loads every page up to MAX_PAGES.
export async function loadPages<T>(
    load: (page: number) => Promise<{ items: T[]; pages: number }>,
    page?: number
): Promise<{ items: T[]; pages: number; note: string }> {
    const first = await load(page ?? 1);
    const items = [...first.items];
    for (let next = 2; !page && next <= Math.min(first.pages, MAX_PAGES); next++) {
        const more = (await load(next)).items;
        if (more.length === 0) break;
        items.push(...more);
    }
    let note = "";
    if (page && items.length === 0) note = `Page ${page} is past the end of the list.`;
    else if (page && first.pages > 1) note = `This is page ${page} of ${first.pages}.`;
    else if (!page && first.pages > MAX_PAGES)
        note = `Only the first ${MAX_PAGES} of ${first.pages} pages were fetched; use 'page' for the rest.`;
    return { items, pages: first.pages, note };
}
