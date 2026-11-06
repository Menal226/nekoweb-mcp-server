import { load, type Cheerio, type CheerioAPI } from "cheerio";
import { isTag, isText, type AnyNode } from "domhandler";
import { SITE_BASE_URL } from "./constants.js";

export const parseHtml = (html: string): CheerioAPI => load(html);
export const parseXml = (xml: string): CheerioAPI => load(xml, { xml: true });

export const squash = (value: string) => value.replace(/\s+/g, " ").trim();

export function absoluteUrl(href: string): string {
    try {
        return new URL(href.startsWith("//") ? `https:${href}` : href, SITE_BASE_URL).href;
    } catch {
        return href;
    }
}

const BLOCKS = new Set(["p", "div", "ul", "ol", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "table", "tr"]);

function nodeText(node: AnyNode): string {
    if (isText(node)) return node.data.replace(/\s+/g, " ");
    if (!isTag(node) || node.name === "script" || node.name === "style") return "";
    const inner = node.children.map(nodeText).join("");
    if (node.name === "br") return "\n";
    if (node.name === "li") return `\n- ${inner.trim()}`;
    if (node.name === "a" && node.attribs.href) {
        const url = absoluteUrl(node.attribs.href);
        const name = squash(inner);
        return name && name !== url ? `[${name}](${url})` : url;
    }
    return BLOCKS.has(node.name) ? `\n\n${inner}\n\n` : inner;
}

// Readable text with Markdown links and list items.
export function htmlText(nodes: Cheerio<AnyNode> | AnyNode[]): string {
    return [...nodes]
        .map(nodeText)
        .join("")
        .replace(/[ \t]*\n[ \t]*/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

// "November 6, 2026" or "10/29/2026" -> "2026-11-06"
export function isoDate(value: string): string | undefined {
    const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const ms = us ? Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2])) : Date.parse(`${value} UTC`);
    return Number.isNaN(ms) ? undefined : new Date(ms).toISOString().slice(0, 10);
}

export interface SiteCard {
    domain: string;
    title: string;
    url: string;
    screenshot_url?: string;
    you_follow: boolean;
}

// The "site-box" cards on the followers and following pages.
export function siteCards($: CheerioAPI, scope: Cheerio<AnyNode>): SiteCard[] {
    return scope
        .find(".site-box")
        .toArray()
        .flatMap(box => {
            const card = $(box);
            const domain = squash(
                card
                    .find("p")
                    .first()
                    .contents()
                    .filter((_, node) => isText(node))
                    .text()
            );
            if (!domain) return [];
            const href = card.find("a[href]").first().attr("href");
            const screenshot = card.find("img.screenshot").attr("src");
            return [
                {
                    domain,
                    title: squash(card.find(".site-title").text()),
                    url: href ? absoluteUrl(href) : `https://${domain}/`,
                    ...(screenshot && { screenshot_url: absoluteUrl(screenshot) }),
                    you_follow: card.find(".follow").hasClass("following")
                }
            ];
        });
}

export function pageCount($: CheerioAPI, path: string, hasItems: boolean): number {
    const links = $("a[href]").filter((_, link) => {
        const href = $(link).attr("href") ?? "";
        return href.startsWith("?") || href.startsWith(`${path}?`) || href.startsWith(`${SITE_BASE_URL}${path}?`);
    });
    const linked = links.toArray().map(link => Number(new URL($(link).attr("href")!, SITE_BASE_URL + path).searchParams.get("page")) || 0);
    // The current page is a bold number next to the links; on the last page it is the highest one.
    const current = links
        .parent()
        .children("b")
        .toArray()
        .map(bold => Number(squash($(bold).text())) || 0);
    return Math.max(hasItems ? 1 : 0, ...linked, ...current);
}
