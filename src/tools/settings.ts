import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { nekoweb, NekowebError } from "../api.js";
import { parseHtml, squash } from "../html.js";
import { normalizeSitePath } from "../paths.js";
import { json, OVERWRITES, READ_ONLY, resolveDomain, responseFormatField, SESSION_NOTE, siteField, text, WRITES } from "./common.js";

const FLAGS = {
    main: [
        "Main site",
        "Make this your main site: it's shown when you follow other sites, and your username subdomain redirects to it. Only one site can be main, so this takes it from the current one."
    ],
    nice_links: ["Nice links", "Serve /page.html at /page. Turning this off again breaks links that leave out .html."],
    strict_slash: [
        "Strict slashes",
        "Only with nice links: /page.html is served only at /page, and /page/index.html only at /page/ (like Neocities)."
    ],
    visible: ["Listed in Explore", "Show the site in Explore and on Follows pages."],
    show_in_global_feed: ["Posts in global feed", "Show the site's RSS posts in the global feed."],
    support_http: ["HTTP access", "Allow plain HTTP as well as HTTPS."],
    nsfw: ["NSFW", "Mark the site as NSFW. It then can't be reached from the UK."]
} as const;
type Flag = keyof typeof FLAGS;
const FLAG_NAMES = Object.keys(FLAGS) as Flag[];

export type SiteSettings = Record<Flag, boolean> & { folder: string };

export function parseSiteSettings(html: string): { settings: SiteSettings; csrf: string; siteId: string } | undefined {
    const $ = parseHtml(html);
    const input = (name: string) => $(`form[action="/api/settings"] input[name="${name}"]`).first();
    const csrf = input("csrf").attr("value");
    const siteId = input("site_id").attr("value");
    const folder = input("folder").attr("value");
    if (!csrf || !siteId || folder === undefined || FLAG_NAMES.some(flag => input(flag).length === 0)) return undefined;
    const flags = Object.fromEntries(FLAG_NAMES.map(flag => [flag, input(flag).attr("checked") !== undefined])) as Record<Flag, boolean>;
    return { settings: { ...flags, folder }, csrf, siteId };
}

async function loadSettings(domain: string, signal: AbortSignal) {
    const form = parseSiteSettings(await nekoweb.getSettingsPage(domain, undefined, signal));
    if (!form)
        throw new NekowebError(`Couldn't find the settings form on the settings page of ${domain}; Nekoweb may have changed the page.`);
    return form;
}

function formatSettings(domain: string, settings: SiteSettings): string {
    const lines = FLAG_NAMES.map(flag => `- ${FLAGS[flag][0]}: ${settings[flag] ? "on" : "off"}`);
    return [`# Settings for ${domain}`, "", `- Serve folder: ${settings.folder}`, ...lines].join("\n");
}

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

    server.registerTool(
        "nekoweb_get_site_settings",
        {
            title: "Get site settings",
            description: `Show the settings of one of your Nekoweb sites: the folder it serves and whether each option is on.

Options: ${FLAG_NAMES.map(flag => `${flag} (${FLAGS[flag][1]})`).join("; ")}

${SESSION_NOTE} Change settings with nekoweb_update_site_settings.

Example: "Is nice links on for my site?" -> {}`,
            inputSchema: z.strictObject({ site: siteField, response_format: responseFormatField }),
            annotations: READ_ONLY
        },
        async ({ site, response_format }, ctx) => {
            const domain = await resolveDomain(site, ctx.mcpReq.signal);
            const { settings } = await loadSettings(domain, ctx.mcpReq.signal);
            return response_format === "json" ? json({ site: domain, ...settings }) : text(formatSettings(domain, settings));
        }
    );

    const flagFields = Object.fromEntries(FLAG_NAMES.map(flag => [flag, z.boolean().optional().describe(FLAGS[flag][1])])) as Record<
        Flag,
        z.ZodOptional<z.ZodBoolean>
    >;

    server.registerTool(
        "nekoweb_update_site_settings",
        {
            title: "Update site settings",
            description: `Change settings of one of your Nekoweb sites. Only the settings you pass change; the rest stay as they are.

${SESSION_NOTE}

Turning nice_links off, changing the folder, or turning nsfw on can break links to the site or make it unreachable for some visitors, so confirm those with the user first. nekoweb_get_site_settings shows the current settings.

Examples:
  - "Turn on nice links" -> { nice_links: true }
  - "Hide my site from Explore" -> { visible: false }
  - "Serve my other site from /second" -> { site: "second.nekoweb.org", folder: "/second" }`,
            inputSchema: z.strictObject({
                site: siteField,
                ...flagFields,
                folder: z
                    .string()
                    .min(1)
                    .max(1024)
                    .optional()
                    .describe(
                        "Folder the site serves its files from, from the account's file root, e.g. '/mysite.nekoweb.org'. It must exist."
                    )
            }),
            annotations: OVERWRITES
        },
        async ({ site, folder, ...flags }, ctx) => {
            const signal = ctx.mcpReq.signal;
            const wanted: Partial<SiteSettings> = Object.fromEntries(Object.entries(flags).filter(([, value]) => value !== undefined));
            if (folder !== undefined) wanted.folder = normalizeSitePath(folder);
            if (Object.keys(wanted).length === 0) throw new NekowebError("Pass at least one setting to change.");

            const domain = await resolveDomain(site, signal);
            const { settings, csrf, siteId } = await loadSettings(domain, signal);
            const changes = (Object.keys(wanted) as (keyof SiteSettings)[]).filter(key => wanted[key] !== settings[key]);
            if (changes.length === 0)
                return text(`Those settings are already set, so nothing changed.\n\n${formatSettings(domain, settings)}`);
            if (wanted.folder !== undefined && wanted.folder !== settings.folder) await nekoweb.readFolder(wanted.folder, signal);

            const next: SiteSettings = { ...settings, ...wanted };
            const fields: Record<string, string> = { folder: next.folder, csrf, site_id: siteId };
            for (const flag of FLAG_NAMES) if (next[flag]) fields[flag] = "on";
            await nekoweb.submitSettingsForm(domain, "/api/settings", fields, signal);

            const after = (await loadSettings(domain, signal)).settings;
            const failed = changes.filter(key => after[key] !== next[key]);
            if (failed.length > 0) {
                throw new NekowebError(
                    `Nekoweb accepted the request, but these settings of ${domain} didn't change: ${failed.join(", ")}.\n\n${formatSettings(domain, after)}`
                );
            }
            const describe = (key: keyof SiteSettings) =>
                key === "folder" ? `serve folder ${after.folder}` : `${FLAGS[key][0]} ${after[key] ? "on" : "off"}`;
            return text(`Updated ${domain}: ${changes.map(describe).join(", ")}.\n\n${formatSettings(domain, after)}`);
        }
    );
}
