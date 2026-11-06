import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { nekoweb, NekowebError } from "../api.js";
import { parseHtml, squash } from "../html.js";
import { json, OVERWRITES, READ_ONLY, resolveDomain, responseFormatField, SESSION_NOTE, siteField, text, WRITES } from "./common.js";

export interface SiteTags {
    tags: string[];
    used?: number;
    limit?: number;
}

export function parseTags(html: string): SiteTags | undefined {
    const $ = parseHtml(html);
    const section = $("div#tags");
    if (section.length === 0) return undefined;
    const tags = section
        .find("tr > td:first-child")
        .toArray()
        .map(cell => squash($(cell).text()))
        .filter(Boolean);
    const counts = squash(section.find("span").first().text()).match(/(\d+)\D+(\d+)/);
    return counts ? { tags, used: Number(counts[1]), limit: Number(counts[2]) } : { tags };
}

export function parseTagForm(html: string): { csrf: string; siteId: string } | undefined {
    const $ = parseHtml(html);
    const scope = $("div#tags").length ? "div#tags " : "";
    const csrf = $(`${scope}input[name="csrf"]`).first().attr("value");
    const siteId = $(`${scope}input[name="site_id"]`).first().attr("value");
    return csrf && siteId ? { csrf, siteId } : undefined;
}

const tagField = z.string().trim().min(2).max(32).describe("The tag, 2-32 characters, e.g. 'pixel-art'");

async function loadTags(domain: string, signal: AbortSignal, page?: string): Promise<{ tags: SiteTags; html: string }> {
    const html = await nekoweb.getSettingsPage(domain, page, signal);
    const tags = parseTags(html);
    if (!tags) throw new NekowebError(`Couldn't find the tags on the settings page of ${domain}; Nekoweb may have changed the page.`);
    return { tags, html };
}

// The CSRF token comes from a freshly loaded settings page, and the tags are reloaded to confirm the change.
async function changeTag(domain: string, action: "add" | "remove", tag: string, html: string, signal: AbortSignal): Promise<SiteTags> {
    const form = parseTagForm(html);
    if (!form) throw new NekowebError(`Couldn't find the tag form on the settings page of ${domain}; Nekoweb may have changed the page.`);
    await nekoweb.submitSettingsForm(domain, `/api/tags/${action}`, { tag, csrf: form.csrf, site_id: form.siteId }, signal);
    return (await loadTags(domain, signal)).tags;
}

const hasTag = (tags: SiteTags, tag: string) => tags.tags.some(t => t.toLowerCase() === tag.toLowerCase());

function formatTags(domain: string, tags: SiteTags): string {
    if (tags.tags.length === 0) return `${domain} has no tags${tags.limit === undefined ? "" : ` (up to ${tags.limit} allowed)`}.`;
    const count = tags.limit === undefined ? `${tags.tags.length}` : `${tags.tags.length} of ${tags.limit}`;
    return `# Tags on ${domain} (${count})\n\n${tags.tags.map(tag => `- ${tag}`).join("\n")}`;
}

export function registerSettingsTools(server: McpServer): void {
    server.registerTool(
        "nekoweb_get_tags",
        {
            title: "Get tags",
            description: `List the tags on one of your Nekoweb sites, and how many of the allowed tags it uses.

${SESSION_NOTE}

Examples:
  - "What tags does my site have?" -> {}
  - "Show the tags on my other site" -> { site: "second.nekoweb.org" }`,
            inputSchema: z.strictObject({ site: siteField, response_format: responseFormatField }),
            annotations: READ_ONLY
        },
        async ({ site, response_format }, ctx) => {
            const domain = await resolveDomain(site, ctx.mcpReq.signal);
            const { tags } = await loadTags(domain, ctx.mcpReq.signal, "tags");
            return response_format === "json" ? json({ site: domain, ...tags }) : text(formatTags(domain, tags));
        }
    );

    server.registerTool(
        "nekoweb_add_tag",
        {
            title: "Add tag",
            description: `Add a tag to one of your Nekoweb sites. Sites can have a limited number of tags (usually 10); remove one with nekoweb_remove_tag to make room.

${SESSION_NOTE} Tag changes are rate limited to about 20 per 15 minutes.

Example: "Tag my site as pixel art" -> { tag: "pixel-art" }`,
            inputSchema: z.strictObject({ site: siteField, tag: tagField }),
            annotations: { ...WRITES, idempotentHint: true }
        },
        async ({ site, tag }, ctx) => {
            const domain = await resolveDomain(site, ctx.mcpReq.signal);
            const { tags, html } = await loadTags(domain, ctx.mcpReq.signal);
            if (hasTag(tags, tag))
                return text(`${domain} already has the tag "${tag}", so nothing changed.\n\n${formatTags(domain, tags)}`);
            if (tags.limit !== undefined && tags.tags.length >= tags.limit) {
                throw new NekowebError(
                    `${domain} already has ${tags.tags.length} of ${tags.limit} tags. Remove one with nekoweb_remove_tag first.`
                );
            }
            const after = await changeTag(domain, "add", tag, html, ctx.mcpReq.signal);
            if (!hasTag(after, tag))
                throw new NekowebError(`Nekoweb accepted the request, but "${tag}" isn't among the tags of ${domain}.`);
            return text(`Added the tag "${tag}" to ${domain}.\n\n${formatTags(domain, after)}`);
        }
    );

    server.registerTool(
        "nekoweb_remove_tag",
        {
            title: "Remove tag",
            description: `Remove a tag from one of your Nekoweb sites. Use nekoweb_get_tags to see the current tags.

${SESSION_NOTE} Tag changes are rate limited to about 20 per 15 minutes.

Example: "Remove the windows tag" -> { tag: "windows" }`,
            inputSchema: z.strictObject({ site: siteField, tag: tagField }),
            annotations: OVERWRITES
        },
        async ({ site, tag }, ctx) => {
            const domain = await resolveDomain(site, ctx.mcpReq.signal);
            const { tags, html } = await loadTags(domain, ctx.mcpReq.signal);
            const existing = tags.tags.find(t => t.toLowerCase() === tag.toLowerCase());
            if (!existing) return text(`${domain} doesn't have the tag "${tag}", so nothing changed.\n\n${formatTags(domain, tags)}`);
            const after = await changeTag(domain, "remove", existing, html, ctx.mcpReq.signal);
            if (hasTag(after, existing))
                throw new NekowebError(`Nekoweb accepted the request, but "${existing}" is still among the tags of ${domain}.`);
            return text(`Removed the tag "${existing}" from ${domain}.\n\n${formatTags(domain, after)}`);
        }
    );
}
