import type { McpServer } from "@modelcontextprotocol/server";
import { isTag, type AnyNode } from "domhandler";
import * as z from "zod/v4";
import { nekoweb, NekowebError } from "../api.js";
import { absoluteUrl, htmlText, isoDate, pageCount, parseHtml, parseXml, siteCards, squash, type SiteCard } from "../html.js";
import { normalizeDomain } from "../paths.js";
import { json, loadPages, MAX_PAGES, pageField, READ_ONLY, responseFormatField, SESSION_NOTE, text } from "./common.js";

export interface FollowedSite extends Omit<SiteCard, "you_follow"> {
    last_updated: string;
}

export interface FeedPost {
    title: string;
    url: string;
    site: string;
    date: string;
    description: string;
}

export interface NewsPost {
    title: string;
    date?: string;
    text: string;
}

// Sites are grouped under an <h2 class="date"> heading with the day they were last updated.
export function parseFollowing(html: string): { sites: FollowedSite[]; pages: number } {
    const $ = parseHtml(html);
    const sites: FollowedSite[] = [];
    let day = "";
    for (const child of $("#sites").children().toArray()) {
        const section = $(child);
        if (section.is("h2.date")) day = squash(section.text());
        else for (const { you_follow: _, ...site } of siteCards($, section)) sites.push({ ...site, last_updated: isoDate(day) ?? day });
    }
    return { sites, pages: pageCount($, "/follows", sites.length > 0) };
}

export function parseFeed(html: string): { posts: FeedPost[]; pages: number } {
    const $ = parseHtml(html);
    const posts = $(".post-box")
        .toArray()
        .map(box => {
            const post = $(box);
            const date = squash(post.find(".post-date").text());
            const href = post.closest("a.post-link").attr("href") ?? post.find("a[href]").attr("href");
            return {
                title: squash(post.find(".post-title").text()),
                url: href ? absoluteUrl(href) : "",
                site: squash(post.find(".post-author").text()),
                date: isoDate(date) ?? date,
                description: htmlText(post.find(".post-description").contents())
            };
        });
    return { posts, pages: pageCount($, "/feed", posts.length > 0) };
}

// Each post is an <h2>Title - Month D, YYYY</h2> followed by its content.
export function parseNews(html: string): NewsPost[] {
    const $ = parseHtml(html);
    const posts: { heading: string; body: AnyNode[] }[] = [];
    for (const node of $("#news").contents().toArray()) {
        if (isTag(node) && node.name === "h2") posts.push({ heading: squash($(node).text()), body: [] });
        else posts.at(-1)?.body.push(node);
    }
    return posts.map(({ heading, body }) => {
        const split = heading.match(/^(.*\S)\s+[-–—]\s+([A-Z][a-z]+ \d{1,2}, \d{4})$/);
        const date = split && isoDate(split[2]);
        return { title: split ? split[1] : heading, ...(date && { date }), text: htmlText(body) };
    });
}

// Descriptions start with the site's domain: "mysite.nekoweb.org — My post".
export function parseRss(xml: string): FeedPost[] {
    const $ = parseXml(xml);
    return $("item")
        .toArray()
        .map(element => {
            const item = $(element);
            const field = (name: string) => squash(item.children(name).first().text());
            const [site, ...rest] = field("description").split(" — ");
            const published = Date.parse(field("pubDate"));
            return {
                title: field("title"),
                url: field("link"),
                site: rest.length ? site : "",
                date: Number.isNaN(published) ? field("pubDate") : new Date(published).toISOString(),
                description: rest.length ? rest.join(" — ") : site
            };
        });
}

function formatPosts(heading: string, posts: FeedPost[]): string {
    const lines = posts.map(post => {
        const title = post.title || post.url || "Untitled";
        const meta = [post.site, post.date].filter(Boolean).join(" · ");
        const description = post.description ? `\n  ${post.description.replace(/\n+/g, " ")}` : "";
        return `- **${post.url ? `[${title}](${post.url})` : title}**${meta ? ` — ${meta}` : ""}${description}`;
    });
    return [`# ${heading}`, "", ...lines].join("\n");
}

function loadFollowing(page: number | undefined, signal: AbortSignal) {
    return loadPages(async n => {
        const result = parseFollowing(await nekoweb.getSessionPage("/follows", { page: String(n) }, signal));
        return { items: result.sites, pages: result.pages };
    }, page);
}

export function registerSocialTools(server: McpServer): void {
    server.registerTool(
        "nekoweb_list_following",
        {
            title: "List followed sites",
            description: `List the Nekoweb sites you follow, newest updates first, with each one's title, link, screenshot and the day it was last updated.

${SESSION_NOTE}

Without 'page', every page is fetched (up to ${MAX_PAGES} pages). For the posts those sites published, use nekoweb_get_feed.

Examples:
  - "Which sites I follow updated recently?" -> {}
  - "Show the second page of sites I follow" -> { page: 2 }`,
            inputSchema: z.strictObject({
                page: pageField.optional().describe("Fetch only this page. Omit to fetch them all."),
                response_format: responseFormatField
            }),
            annotations: READ_ONLY
        },
        async ({ page, response_format }, ctx) => {
            const { items: sites, pages, note } = await loadFollowing(page, ctx.mcpReq.signal);
            if (response_format === "json") return json({ ...(page && { page }), pages, count: sites.length, sites });
            if (sites.length === 0) return text(page ? `No followed sites on this page. ${note}` : "You don't follow any sites yet.");
            const lines: string[] = [];
            for (const [i, site] of sites.entries()) {
                if (i === 0 || site.last_updated !== sites[i - 1].last_updated) lines.push("", `## Updated ${site.last_updated}`, "");
                const title = site.title && site.title !== site.domain ? ` — ${site.title}` : "";
                lines.push(`- [${site.domain}](${site.url})${title}`);
            }
            return text(
                [`# ${sites.length} site${sites.length === 1 ? "" : "s"} you follow`, ...(note ? ["", note] : []), ...lines].join("\n")
            );
        }
    );

    server.registerTool(
        "nekoweb_get_feed",
        {
            title: "Get your feed",
            description: `Get the latest posts from the sites you follow, as shown on your Nekoweb feed. Posts come from those sites' RSS feeds: each has a title, link, site, date and short description.

${SESSION_NOTE}

Newest posts are on page 1. For posts from all of Nekoweb, use nekoweb_get_global_feed, which needs no session token.

Examples:
  - "What did the sites I follow post lately?" -> {}
  - "Older posts from my feed" -> { page: 2 }`,
            inputSchema: z.strictObject({
                page: pageField.default(1).describe("Page of the feed, newest first (default 1)"),
                response_format: responseFormatField
            }),
            annotations: READ_ONLY
        },
        async ({ page, response_format }, ctx) => {
            const { posts, pages } = parseFeed(await nekoweb.getSessionPage("/feed", { page: String(page) }, ctx.mcpReq.signal));
            if (response_format === "json") return json({ page, pages, count: posts.length, posts });
            if (posts.length === 0) {
                return text(
                    page > 1
                        ? `Page ${page} of your feed is empty.`
                        : "Your feed is empty. Follow sites with an RSS feed to see their posts here."
                );
            }
            return text(formatPosts(`Your feed (page ${page}${pages > 1 ? ` of ${pages}` : ""})`, posts));
        }
    );

    server.registerTool(
        "nekoweb_get_global_feed",
        {
            title: "Get the global feed",
            description: `Get the newest posts from all Nekoweb sites, from nekoweb.org's global RSS feed: title, link, site, date and short description. No session token needed.

For posts only from the sites you follow, use nekoweb_get_feed.

Example: "What's new on Nekoweb?" -> {}`,
            inputSchema: z.strictObject({
                limit: z
                    .number()
                    .int()
                    .min(1)
                    .max(50)
                    .default(20)
                    .describe("How many posts to return, newest first (default 20, the feed has about 50)"),
                response_format: responseFormatField
            }),
            annotations: READ_ONLY
        },
        async ({ limit, response_format }, ctx) => {
            const posts = parseRss(await nekoweb.getPublicPage("/global-feed.xml", ctx.mcpReq.signal)).slice(0, limit);
            if (response_format === "json") return json({ count: posts.length, posts });
            if (posts.length === 0) return text("The global feed is empty right now.");
            return text(formatPosts("Newest posts on Nekoweb", posts));
        }
    );

    server.registerTool(
        "nekoweb_get_news",
        {
            title: "Get Nekoweb news",
            description: `Get the latest announcements from nekoweb.org's news page: new features, policy changes and so on, newest first. No session token needed.

Example: "Any Nekoweb news?" -> {}`,
            inputSchema: z.strictObject({
                limit: z.number().int().min(1).max(100).default(5).describe("How many posts to return, newest first (default 5)"),
                response_format: responseFormatField
            }),
            annotations: READ_ONLY
        },
        async ({ limit, response_format }, ctx) => {
            const all = parseNews(await nekoweb.getPublicPage("/news", ctx.mcpReq.signal));
            if (all.length === 0) throw new NekowebError("Couldn't find any posts on nekoweb.org/news; Nekoweb may have changed the page.");
            const posts = all.slice(0, limit);
            if (response_format === "json") return json({ count: posts.length, total: all.length, posts });
            const sections = posts.map(post => `## ${post.title}${post.date ? ` (${post.date})` : ""}\n\n${post.text}`);
            const more = all.length > posts.length ? `\n\n${all.length - posts.length} older posts not shown.` : "";
            return text(`# Nekoweb news\n\n${sections.join("\n\n")}${more}`);
        }
    );

    server.registerTool(
        "nekoweb_follow_site",
        {
            title: "Follow or unfollow a site",
            description: `Follow or unfollow a Nekoweb site from your account. Checks first, so following a site you already follow (or unfollowing one you don't) changes nothing.

${SESSION_NOTE}

Examples:
  - "Follow fairfruit.nekoweb.org" -> { site: "fairfruit.nekoweb.org" }
  - "Unfollow eyeorb.net" -> { site: "eyeorb.net", follow: false }`,
            inputSchema: z.strictObject({
                site: z.string().min(1).max(253).describe("Domain of the site, e.g. 'fairfruit.nekoweb.org'"),
                follow: z.boolean().default(true).describe("true to follow (default), false to unfollow")
            }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
        },
        async ({ site, follow }, ctx) => {
            const signal = ctx.mcpReq.signal;
            const domain = normalizeDomain(site);
            const already = () => text(`You ${follow ? "already follow" : "don't follow"} ${domain}, so nothing changed.`);
            // Nekoweb only has a toggle, so check the followed sites first. If that list was cut off at MAX_PAGES, a site
            // missing from it may still be followed: then a toggle that goes the wrong way is undone.
            const following = await loadFollowing(undefined, signal);
            const listed = following.items.some(item => item.domain.toLowerCase() === domain);
            const complete = following.pages <= MAX_PAGES;
            if (listed === follow && (listed || complete)) return already();

            let followed = await nekoweb.toggleFollow(domain, signal);
            if (followed !== follow && !complete) {
                followed = await nekoweb.toggleFollow(domain, signal);
                if (followed === follow) return already();
            }
            if (followed !== follow)
                throw new NekowebError(`Nekoweb says you ${followed ? "still follow" : "don't follow"} ${domain}. Try again in a moment.`);
            return text(follow ? `You now follow ${domain}.` : `You unfollowed ${domain}.`);
        }
    );
}
