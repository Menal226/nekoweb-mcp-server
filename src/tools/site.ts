import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { describeReset, nekoweb, type SiteInfo } from "../api.js";
import { normalizeDomain } from "../paths.js";
import { formatDate, json, READ_ONLY, responseFormatField, text } from "./common.js";

function formatSite(site: SiteInfo): string {
    return [
        `## ${site.title || "(untitled)"} — ${site.domain}${site.main ? " (main site)" : ""}`,
        `- URL: https://${site.domain}/`,
        ...(site.folder ? [`- Files folder: ${site.folder} (use this as the path prefix for file tools)`] : []),
        `- Views: ${site.views ?? 0} · Followers: ${site.followers ?? 0} · Updates: ${site.updates ?? 0}`,
        `- Created: ${formatDate(site.created_at)} · Last updated: ${formatDate(site.updated_at)}`
    ].join("\n");
}

export function registerSiteTools(server: McpServer): void {
    server.registerTool(
        "nekoweb_get_site_info",
        {
            title: "Get site info",
            description: `Get a Nekoweb site's title, domain, views, followers, update count and creation/update dates.

Without 'site', returns the site that the configured API key belongs to. With 'site', looks up any public Nekoweb site (no API key needed).

Examples:
  - "How many views does my site have?" -> {}
  - "How popular is fairfruit.nekoweb.org?" -> { site: "fairfruit.nekoweb.org" }
Use nekoweb_list_sites to see every site on the account.`,
            inputSchema: z.strictObject({
                site: z
                    .string()
                    .min(1)
                    .max(253)
                    .optional()
                    .describe("Domain of another site, e.g. 'fairfruit.nekoweb.org'. Omit for your own site."),
                response_format: responseFormatField
            }),
            annotations: READ_ONLY
        },
        async ({ site, response_format }, ctx) => {
            const domain = site && normalizeDomain(site);
            const info = domain ? await nekoweb.getPublicSiteInfo(domain, ctx.mcpReq.signal) : await nekoweb.getSiteInfo(ctx.mcpReq.signal);
            return response_format === "json" ? json(info) : text(formatSite(info));
        }
    );

    server.registerTool(
        "nekoweb_list_sites",
        {
            title: "List my sites",
            description: `List every site on the Nekoweb account that owns the API key, with domain, title, views, followers, dates and the folder that holds each site's files. The main site is marked.

Call this first to learn the folder to use in file paths, e.g. '/mysite.nekoweb.org'.

Use nekoweb_get_site_info for a single site.`,
            inputSchema: z.strictObject({ response_format: responseFormatField }),
            annotations: READ_ONLY
        },
        async ({ response_format }, ctx) => {
            const sites = await nekoweb.getAllSites(ctx.mcpReq.signal);
            if (response_format === "json") return json({ count: sites.length, sites });
            if (sites.length === 0) return text("This account has no sites.");
            return text(`# ${sites.length} site(s)\n\n${sites.map(formatSite).join("\n\n")}`);
        }
    );

    server.registerTool(
        "nekoweb_get_limits",
        {
            title: "Get rate limits",
            description: `Show the account's current API rate limits: 'general' (most file operations), 'big_uploads' (chunked uploads over 95MB) and 'zip' (zip imports).

Each limit has the maximum, how many requests remain, and when the counter resets. Call this before bulk operations or after a 429 error.`,
            inputSchema: z.strictObject({ response_format: responseFormatField }),
            annotations: READ_ONLY
        },
        async ({ response_format }, ctx) => {
            const limits = await nekoweb.getLimits(ctx.mcpReq.signal);
            if (response_format === "json") return json(limits);
            const lines = Object.entries(limits).map(
                ([name, limit]) => `- **${name}**: ${limit.remaining}/${limit.limit} remaining (resets: ${describeReset(limit.reset)})`
            );
            return text(["# Nekoweb rate limits", "", ...lines].join("\n"));
        }
    );
}
