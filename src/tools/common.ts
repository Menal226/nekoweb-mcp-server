import type { CallToolResult, ServerContext } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

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
