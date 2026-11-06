import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { nekoweb } from "../api.js";
import { pageCount, parseHtml, siteCards, type SiteCard } from "../html.js";
import {
    json,
    loadPages,
    MAX_PAGES,
    pageField,
    READ_ONLY,
    resolveDomain,
    responseFormatField,
    SESSION_NOTE,
    siteField,
    text
} from "./common.js";

const SORTS = { follow_date: "followdate", recently_updated: "lastupd", most_followed: "follows" } as const;
type Sort = keyof typeof SORTS;
const SORT_NAMES: Record<Sort, string> = {
    follow_date: "follow date",
    recently_updated: "most recently updated",
    most_followed: "most followed"
};

export function parseFollowers(html: string, path: string): { followers: SiteCard[]; pages: number } {
    const $ = parseHtml(html);
    const followers = siteCards($, $("#sites"));
    return { followers, pages: pageCount($, path, followers.length > 0) };
}

function formatFollowers(domain: string, sort: Sort, followers: SiteCard[], note: string): string {
    if (followers.length === 0) return `No sites follow ${domain}${note ? ` on this page. ${note}` : " yet."}`;
    const back = followers.filter(follower => follower.you_follow).length;
    const lines = followers.map(follower => {
        const title = follower.title && follower.title !== follower.domain ? ` — ${follower.title}` : "";
        return `- [${follower.domain}](${follower.url})${title}${follower.you_follow ? " (you follow back)" : ""}`;
    });
    return [
        `# ${followers.length} site${followers.length === 1 ? "" : "s"} following ${domain}`,
        "",
        `Sorted by ${SORT_NAMES[sort]}. You follow back ${back} of them.${note ? ` ${note}` : ""}`,
        "",
        ...lines
    ].join("\n");
}

export function registerFollowerTools(server: McpServer): void {
    server.registerTool(
        "nekoweb_list_followers",
        {
            title: "List followers",
            description: `List the sites that follow one of your Nekoweb sites, with each one's domain, title, link, screenshot and whether you follow it back. Only works for sites on your own account.

${SESSION_NOTE}

Without 'page', every page of followers is fetched (up to ${MAX_PAGES} pages). For just the follower count, nekoweb_get_site_info is quicker and needs no session token.

Examples:
  - "Who follows my site?" -> {}
  - "Which of my followers updated most recently?" -> { sort: "recently_updated" }
  - "Who follows my other site?" -> { site: "second.nekoweb.org" }`,
            inputSchema: z.strictObject({
                site: siteField,
                sort: z
                    .enum(["follow_date", "recently_updated", "most_followed"])
                    .default("follow_date")
                    .describe("Order of the list: 'follow_date' (default), 'recently_updated' or 'most_followed'"),
                page: pageField.optional().describe("Fetch only this page of followers. Omit to fetch them all."),
                response_format: responseFormatField
            }),
            annotations: READ_ONLY
        },
        async ({ site, sort, page, response_format }, ctx) => {
            const signal = ctx.mcpReq.signal;
            const domain = await resolveDomain(site, signal);
            const path = `/followers/${domain}`;
            const loaded = await loadPages(async n => {
                const result = parseFollowers(await nekoweb.getFollowersPage(domain, n, SORTS[sort], signal), path);
                return { items: result.followers, pages: result.pages };
            }, page);
            const { items: followers, pages, note } = loaded;
            if (response_format === "json") {
                return json({ site: domain, sort, ...(page && { page }), pages, count: followers.length, followers });
            }
            return text(formatFollowers(domain, sort, followers, note));
        }
    );
}
