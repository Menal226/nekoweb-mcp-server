// Runs the built server against a mock Nekoweb API: `npm run build && npm run smoke` (add `-- --live` for real key-less calls).
import { strict as assert } from "node:assert";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const API_KEY = "test-key";
const SESSION_TOKEN = "test-session";
const SITE_TAGS: Record<string, string[]> = {
    "test.nekoweb.org": ["art", "r&b"],
    "second.nekoweb.org": [],
    "full.nekoweb.org": Array.from({ length: 10 }, (_, i) => `tag${i}`)
};
const SITE_IDS = Object.fromEntries(Object.keys(SITE_TAGS).map((domain, i) => [String(i + 1), domain]));
// Rotated after every form submission, so stale tokens are rejected.
let csrf = "csrf-0";
const SETTING_FLAGS = ["main", "nice_links", "strict_slash", "visible", "show_in_global_feed", "support_http", "nsfw"];
const defaultSettings = (main: boolean, folder: string): Record<string, boolean | string> => ({
    ...Object.fromEntries(SETTING_FLAGS.map(flag => [flag, ["visible", "show_in_global_feed"].includes(flag)])),
    main,
    folder
});
const SITE_SETTINGS: Record<string, Record<string, boolean | string>> = {
    "test.nekoweb.org": defaultSettings(true, "/"),
    "second.nekoweb.org": defaultSettings(false, "/blog"),
    "full.nekoweb.org": defaultSettings(false, "/")
};

// Daily snapshots of running totals, like the stats page's chart data. October 3rd is missing.
const day = (date: string) => Date.parse(`${date}T22:01:00Z`);
const MONTH_STATS = [
    { time: day("2026-10-01"), views: 100, followers: 1, updates: 5 },
    { time: day("2026-10-02"), views: 110, followers: 1, updates: 6 },
    { time: day("2026-10-04"), views: 130, followers: 2, updates: 6 },
    { time: day("2026-10-05"), views: 135, followers: 2, updates: 8 }
];
const LONG_STATS = Array.from({ length: 70 }, (_, i) => ({
    time: day("2026-08-01") + i * 86_400_000,
    views: i * 2,
    followers: Math.floor(i / 10),
    updates: i
}));

// [domain, title as HTML, followed back]. The mock shows 2 per page.
const FOLLOWERS: Record<string, [string, string, boolean][]> = {
    "test.nekoweb.org": [
        ["a.nekoweb.org", "Alpha", true],
        ["b.nekoweb.org", "b.nekoweb.org", false],
        ["kiwi2.xyz", "kiwi&#39;s cool website!", false],
        ["c.nekoweb.org", "C &amp; co", true],
        ["d.nekoweb.org", "Delta", false]
    ],
    "second.nekoweb.org": [],
    "full.nekoweb.org": Array.from({ length: 50 }, (_, i) => [`f${i}.nekoweb.org`, `F${i}`, false])
};

function followersPage(domain: string, page: number, sort: string): string {
    const sorted = [...FOLLOWERS[domain]];
    if (sort === "follows") sorted.reverse();
    if (sort === "lastupd") sorted.sort(([a], [b]) => a.localeCompare(b));
    const pages = Math.ceil(sorted.length / 2);
    const cards = sorted.slice((page - 1) * 2, page * 2).map(([site, title, following]) => siteCard(site, title, following));
    const pager = pagerLinks(page, pages, `&amp;sort=${sort}`);
    const list = cards.length
        ? `<div class="carouselContainer">${cards.join("\r\n")}</div><div style="text-align:center">${pager}</div>`
        : "<p>No sites found :(</p>";
    return `<div class="explore"><h2>Sites that follow ${domain}</h2><div id="sites">${list}</div></div><footer><a href="/explore?page=1&amp;sort=lastupd">Explore</a></footer>`;
}

function siteCard(site: string, title: string, following: boolean): string {
    const id = site.replace(/\./g, "-");
    return `<div class="pre-pre-site"><div class="pre-site" style=""><div id="site-${id}" class="site-box t-classic" style="width:275px!important"><span class="top-dot"></span><a href="//${site}/" target="_blank" rel="noopener ugc"><div class="sitefeature"><img class="screenshot" src="/screenshots/${site}/index_large.jpg"></div><p style="">${site}\r\n<span class="follow ${following ? "following " : ""}follow-${id}" data-domain="${site}" role="button">[${following ? "-" : "+"}]</span></p><span style="" class="site-title">${title}</span><br></a><span class="bottom-dot"></span></div></div></div>`;
}

function pagerLinks(page: number, pages: number, extra = ""): string {
    return Array.from({ length: pages }, (_, i) =>
        i + 1 === page ? `<b>${page}</b>` : `<a href="?page=${i + 1}${extra}">${i + 1}</a>`
    ).join("\r\n");
}

// [title as HTML, last updated]
const SITES: Record<string, [string, string]> = {
    "cleve.nekoweb.org": ["Cleve&#39;s place", "November 6, 2026"],
    "eyeorb.net": ["eyeorb", "November 6, 2026"],
    "kiwi2.xyz": ["kiwi2.xyz", "October 30, 2026"],
    "fairfruit.nekoweb.org": ["Fair &amp; Fruit", "October 1, 2026"],
    "hidden.nekoweb.org": ["Hidden", "September 9, 2026"]
};
const FOLLOWING = new Set(["cleve.nekoweb.org", "eyeorb.net", "kiwi2.xyz"]);
const EXPLORE_TAGS: Record<string, string[]> = {
    "cleve.nekoweb.org": ["art"],
    "eyeorb.net": ["art", "eyes"],
    "fairfruit.nekoweb.org": ["art"]
};

// Most viewed first, 2 sites per page. Name searches match part of the domain, tag searches the whole tag.
function explorePage(params: URLSearchParams, loggedIn: boolean): string {
    const { q = "", by = "name", sort = "views" } = Object.fromEntries(params);
    const page = Number(params.get("page")) || 1;
    const found = Object.keys(SITES).filter(site => (by === "tag" ? !q || (EXPLORE_TAGS[site] ?? []).includes(q) : site.includes(q)));
    if (sort === "newest") found.reverse();
    const cards = found.slice((page - 1) * 2, page * 2).map(site => siteCard(site, SITES[site][0], loggedIn && FOLLOWING.has(site)));
    const pager = pagerLinks(page, Math.ceil(found.length / 2), `&amp;sort=${sort}&amp;by=${by}&amp;q=${q}`);
    const tagCloud = `<div class="tags"><a href="/explore?page=1&amp;sort=views&amp;by=tag&amp;q=art">art</a> <a href="/explore?page=1&amp;sort=views&amp;by=tag&amp;q=eyes">eyes</a></div>`;
    return `<div class="explore"><form><input name="page" value="1"><select name="sort"><option value="views">Most Views</option></select></form>${tagCloud}<div id="sites"><div id="sites-div"><div class="carouselContainer">${cards.join("\r\n")}</div></div><div style="text-align:center">${pager}</div></div></div><footer><a href="/explore?page=1">Explore</a></footer>`;
}

// Newest updates first, grouped under a heading per day, 2 sites per page. Like nekoweb.org, it leaves out hidden sites.
function followingPage(page: number): string {
    const sites = [...FOLLOWING]
        .filter(site => site !== "hidden.nekoweb.org")
        .sort((a, b) => Date.parse(SITES[b][1]) - Date.parse(SITES[a][1]));
    const shown = sites.slice((page - 1) * 2, page * 2);
    if (shown.length === 0) return `<h1>Sites you follow</h1><div id="sites"><p>No sites found :(</p></div>`;
    const sections: { day: string; cards: string[] }[] = [];
    for (const site of shown) {
        const [title, updated] = SITES[site];
        if (sections.at(-1)?.day !== updated) sections.push({ day: updated, cards: [] });
        sections.at(-1)!.cards.push(siteCard(site, title, true));
    }
    const html = sections.map(({ day, cards }) => `<h2 class="date">${day}</h2><div class="carouselContainer">${cards.join("")}</div>`);
    return `<h1>Sites you follow</h1><div id="sites">${html.join("\r\n")}</div><div style="text-align:center">${pagerLinks(page, Math.ceil(sites.length / 2))}</div>`;
}

const FEED = [
    {
        site: "cleve.nekoweb.org",
        title: "New &amp; shiny",
        link: "https://cleve.nekoweb.org/blog/1",
        date: "10/29/2026",
        text: "I made a <b>thing</b>."
    },
    { site: "eyeorb.net", title: "Eyes", link: "https://eyeorb.net/eyes", date: "10/20/2026", text: "Look!" },
    { site: "kiwi2.xyz", title: "Kiwi", link: "//kiwi2.xyz/kiwi", date: "9/1/2026", text: "" }
];

function feedPage(page: number): string {
    const posts = FEED.slice((page - 1) * 2, page * 2).map(
        post =>
            `<div class="pre-pre-post"><div class="pre-post"><a class="post-link" href="${post.link}" target="_blank"><div class="post-box"><div class="post-header"><span class="post-author">${post.site}</span> <span class="post-date">${post.date}</span><span class="follow following" role="button">[-]</span></div><h4 class="post-title">${post.title}</h4><p class="post-description">${post.text}</p></div></a></div></div>`
    );
    return `<h1>RSS Feed (<a href="/global-feed.xml">view global</a>)</h1><div id="posts">${posts.join("\r\n")}</div><div>${pagerLinks(page, Math.ceil(FEED.length / 2))}</div>`;
}

const NEWS = `<div id="news"><h1>News</h1><h2>Moving news - November 1, 2026</h2><p>News now lives on <a href="https://kicya.net/news">kicya.net</a>.</p><h2>Tags are here – October 2, 2026</h2><p>You can now:</p><ul><li>add tags</li><li>search by tag</li></ul><h2>Hello world</h2><p>First post!<br>Welcome.</p></div>`;

const GLOBAL_FEED = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Nekoweb global feed</title><item><title><![CDATA[Fish & chips]]></title><description><![CDATA[fish.nekoweb.org — Today I ate fish & chips]]></description><link>https://fish.nekoweb.org/food</link><guid>https://fish.nekoweb.org/food</guid><pubDate>Thu, 05 Nov 2026 10:00:00 GMT</pubDate></item><item><title>Untitled</title><description>no site here</description><link>https://x.org/</link><pubDate>whenever</pubDate></item><item><title>Third</title><description>c.nekoweb.org — c</description><link>https://c.nekoweb.org/</link><pubDate>Mon, 02 Nov 2026 00:00:00 GMT</pubDate></item></channel></rss>`;
const calls: { method: string; path: string; fields: Record<string, string>; files: Record<string, number> }[] = [];

// Shaped like real /site/info responses.
const SITE = {
    main: 1,
    domain: "test.nekoweb.org",
    title: "Test Site",
    updates: 7,
    followers: 3,
    views: 1234,
    created_at: 1709235724576,
    updated_at: 1709597947291
};

const FOLDERS: Record<string, { name: string; dir: boolean }[]> = {
    "/": [
        { name: "index.html", dir: false },
        { name: "blog", dir: true },
        { name: "style.css", dir: false }
    ],
    "/blog": [
        { name: "first.html", dir: false },
        { name: "drafts", dir: true }
    ],
    "/blog/drafts": [{ name: "wip.html", dir: false }]
};

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RAW_FILES: Record<string, { type: string; body: Buffer }> = {
    "/index.html": { type: "text/html; charset=utf-8", body: Buffer.from('<h1>Hi</h1>\n<!--#include file="/footer.html" -->') },
    "/logo.png": { type: "application/octet-stream", body: PNG },
    "/data.bin": { type: "application/octet-stream", body: Buffer.from([0x00, 0xff, 0x10]) },
    "/LICENSE": { type: "application/octet-stream", body: Buffer.from("MIT License — ünïcode") },
    "/long.txt": { type: "text/plain", body: Buffer.from("x".repeat(30_000)) }
};

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://mock");
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        const text = typeof body === "string" ? body : JSON.stringify(body);
        res.writeHead(status, { "content-type": typeof body === "string" ? "text/plain" : "application/json", ...headers });
        res.end(text);
    };

    if (url.pathname.startsWith("/site/info/")) return send(200, { ...SITE, domain: decodeURIComponent(url.pathname.slice(11)) });
    const errorPage = (message: string) => send(400, `<title>Error! - nekoweb.org</title><p> ${message} </p><a>Go back</a>`);
    const loggedIn = req.headers.cookie === `token=${SESSION_TOKEN}`;
    // Public pages: the mock fails the test if a cookie is sent along.
    if (url.pathname === "/news" || url.pathname === "/global-feed.xml") {
        assert.equal(req.headers.cookie, undefined);
        calls.push({ method: "GET", path: url.pathname, fields: {}, files: {} });
        return send(200, url.pathname === "/news" ? NEWS : GLOBAL_FEED, { "content-type": "text/html" });
    }
    if (url.pathname === "/follows" || url.pathname === "/feed") {
        calls.push({ method: "GET", path: url.pathname, fields: Object.fromEntries(url.searchParams), files: {} });
        if (!loggedIn) return send(303, "See Other", { location: "/" });
        const page = Number(url.searchParams.get("page")) || 1;
        return send(200, url.pathname === "/follows" ? followingPage(page) : feedPage(page), { "content-type": "text/html" });
    }
    // Explore is public; only logged-in visitors see which sites they follow.
    if (url.pathname === "/explore") {
        calls.push({ method: "GET", path: url.pathname, fields: Object.fromEntries(url.searchParams), files: {} });
        return send(200, explorePage(url.searchParams, loggedIn), { "content-type": "text/html" });
    }
    // The confirmation page behind "Follow on Nekoweb" buttons, which shows whether you follow the site.
    if (url.pathname.startsWith("/follow/")) {
        const domain = decodeURIComponent(url.pathname.slice(8)).toLowerCase();
        calls.push({ method: "GET", path: url.pathname, fields: {}, files: {} });
        if (!loggedIn) return send(303, "See Other", { location: "/" });
        if (!SITES[domain]) return errorPage("Site not found");
        const following = FOLLOWING.has(domain);
        return send(
            200,
            `<title>Follow - ${domain}</title><h1>${following ? "Unfollow" : "Follow"} ${domain}</h1><button class="follow${following ? " following" : ""}" data-domain="${domain}">${following ? "Unfollow" : "Follow"}</button>`,
            { "content-type": "text/html" }
        );
    }
    const toggle = url.pathname.match(/^\/api\/([^/]+)\/toggle_follow$/);
    if (toggle) {
        const domain = decodeURIComponent(toggle[1]);
        calls.push({ method: "GET", path: url.pathname, fields: {}, files: {} });
        if (!loggedIn) return send(400, { error: "Not logged in" });
        if (!SITES[domain]) return send(400, { error: "Site not found" });
        if (FOLLOWING.has(domain)) FOLLOWING.delete(domain);
        else FOLLOWING.add(domain);
        return send(200, { followed: FOLLOWING.has(domain) });
    }
    if (url.pathname.startsWith("/followers/")) {
        const domain = decodeURIComponent(url.pathname.slice(11));
        const fields = Object.fromEntries(url.searchParams);
        calls.push({ method: "GET", path: url.pathname, fields, files: {} });
        if (!loggedIn) return send(303, "See Other", { location: "/" });
        if (!FOLLOWERS[domain]) return errorPage("Site not found");
        return send(200, followersPage(domain, Number(fields.page) || 1, fields.sort ?? "followdate"));
    }
    // Like nekoweb.org's settings pages: logged-out visitors go to the homepage, other people's sites are an error page.
    if (url.pathname.startsWith("/settings/")) {
        const [domain, subpage] = url.pathname.slice(10).split("/").map(decodeURIComponent);
        assert.ok([null, "tags"].includes(url.searchParams.get("page")));
        if (req.headers.cookie !== `token=${SESSION_TOKEN}`) return send(303, "See Other", { location: "/" });
        assert.equal(req.headers.referer, `${apiBase}/settings/${domain}`);
        assert.equal(req.headers.origin, apiBase);
        const tags = SITE_TAGS[domain];
        if (!tags) return errorPage("Site not found");
        if (subpage === "stats") {
            const time = url.searchParams.get("time");
            if (time === "year") return errorPage("You need to be a Cute kitty tier to view yearly statistics.");
            const snapshots = time === "all" ? LONG_STATS : domain === "second.nekoweb.org" ? [] : MONTH_STATS;
            const array = (name: string, values: number[]) => `        const ${name} = [${values.join(",")}];\r\n`;
            return send(
                200,
                `<canvas id="all-updates"></canvas>\r\n    </div>\r\n    <script>\r\n${array(
                    "dates",
                    snapshots.map(s => s.time)
                )}${array(
                    "viewsData",
                    snapshots.map(s => s.views)
                )}${array(
                    "followersData",
                    snapshots.map(s => s.followers)
                )}${array(
                    "updatesData",
                    snapshots.map(s => s.updates)
                )}        const chartLabels = {};\r\n    </script>`
            );
        }
        const siteId = Object.keys(SITE_IDS).find(id => SITE_IDS[id] === domain);
        const hidden = `<input type="hidden" name="csrf" value="${csrf}" required>\r\n<input type="hidden" name="site_id" value="${siteId}">`;
        const rows = tags.map(tag => {
            const escaped = tag.replace(/&/g, "&amp;");
            return `<tr>\r\n<td>${escaped}</td>\r\n<td><form method="post" action="/api/tags/remove"><input type="hidden" name="tag" value="${escaped}" required>\r\n${hidden}</form></td>\r\n</tr>`;
        });
        const addForm =
            tags.length < 10 ? `<form action="/api/tags/add" method="post"><input type="text" name="tag">\r\n${hidden}</form>` : "";
        const settings = SITE_SETTINGS[domain];
        const boxes = SETTING_FLAGS.map(
            flag =>
                `<input type="checkbox" name="${flag}" id="${flag}"${settings[flag] ? " checked" : ""}>\r\n<label for="${flag}">${flag}</label><br>`
        );
        const settingsForm = `<div id="site-settings"><form action="/api/settings" method="post">${boxes.join("\r\n")}<label for="servefolder">Serve Folder:</label><input type="text" name="folder" id="servefolder" value="${settings.folder}">\r\n${hidden}<input type="submit" value="Save"></form></div>`;
        return send(
            200,
            `${settingsForm}<div id="tags" >\r\n<h2>Tags</h2>\r\n<span>You have ${tags.length} out of 10 tags.</span><br><br>\r\n<table>\r\n<tbody id="tags">\r\n<tr><th>Tag</th><th></th></tr>\r\n${rows.join("\r\n")}\r\n</tbody>\r\n</table>\r\n${addForm}</div>`
        );
    }
    // Like nekoweb.org's settings form: unchecked boxes aren't sent, and success redirects back to the settings page.
    if (url.pathname === "/api/settings") {
        const form = Object.fromEntries(new URLSearchParams(await new Response(Readable.toWeb(req) as ReadableStream).text()));
        calls.push({ method: "POST", path: url.pathname, fields: form, files: {} });
        assert.equal(req.headers.origin, apiBase);
        if (!loggedIn || form.csrf !== csrf) return send(400, "Security error, please close this tab");
        csrf = `csrf-${Number(csrf.slice(5)) + 1}`;
        const domain = SITE_IDS[form.site_id];
        if (!FOLDERS[form.folder]) return errorPage("Folder doesn't exist.");
        SITE_SETTINGS[domain] = { ...Object.fromEntries(SETTING_FLAGS.map(flag => [flag, form[flag] === "on"])), folder: form.folder };
        return send(302, "Found", { location: `/settings/${domain}` });
    }
    // Like nekoweb.org's tag forms: success redirects back to the settings page, a bad session or token is a "Security error".
    if (url.pathname === "/api/tags/add" || url.pathname === "/api/tags/remove") {
        const form = Object.fromEntries(new URLSearchParams(await new Response(Readable.toWeb(req) as ReadableStream).text()));
        calls.push({ method: "POST", path: url.pathname, fields: form, files: {} });
        assert.equal(req.headers.origin, apiBase);
        if (req.headers.cookie !== `token=${SESSION_TOKEN}` || form.csrf !== csrf)
            return send(400, "Security error, please close this tab");
        csrf = `csrf-${Number(csrf.slice(5)) + 1}`;
        const domain = SITE_IDS[form.site_id];
        const tags = SITE_TAGS[domain];
        if (url.pathname.endsWith("/add")) {
            if (tags.includes(form.tag)) return errorPage("You already have this tag.");
            if (!/^[a-z0-9-&]+$/.test(form.tag)) return errorPage("Tag can only contain lowercase letters, numbers and dashes.");
            tags.push(form.tag);
            tags.sort();
        } else {
            SITE_TAGS[domain] = tags.filter(tag => tag !== form.tag);
        }
        return send(302, "Found", { location: `/settings/${domain}?page=tags` });
    }
    // Like the real API: a missing or wrong key is redirected to the login page.
    if (req.headers.authorization !== API_KEY) return send(302, "Found. Redirecting to /", { location: "/" });

    const fields: Record<string, string> = {};
    const files: Record<string, number> = {};
    if (req.method === "POST") {
        const request = new Request(url, {
            method: "POST",
            headers: req.headers as Record<string, string>,
            body: Readable.toWeb(req) as ReadableStream,
            duplex: "half"
        } as RequestInit);
        const form = await request.formData();
        for (const [key, value] of form.entries()) {
            if (typeof value === "string") fields[key] = value;
            else files[`${key}:${value.name}`] = value.size;
        }
    }
    calls.push({ method: req.method ?? "GET", path: url.pathname, fields, files });

    switch (url.pathname) {
        case "/site/info":
            return send(200, SITE);
        case "/site/info_all":
            return send(200, [
                { ...SITE, folder: "/test.nekoweb.org" },
                { ...SITE, main: 0, folder: "/second.nekoweb.org", domain: "second.nekoweb.org", title: "Second" }
            ]);
        case "/files/limits":
            return send(200, {
                general: { limit: 100, remaining: 99, reset: 1724615605438 },
                big_uploads: { limit: 5, remaining: 5, reset: -1 },
                zip: { limit: 1, remaining: 1, reset: -1 }
            });
        case "/files/get": {
            const file = RAW_FILES[url.searchParams.get("pathname") ?? ""];
            if (!file) return send(404, { error: "File not found" });
            res.writeHead(200, { "content-type": file.type });
            // Like Cloudflare's bot protection on nekoweb.org, which adds a hidden link to HTML.
            const trap = `<a href="${apiBase}/cdn-cgi/content?id=abc.123-1.2.1.1-x_Y" aria-hidden="true" rel="nofollow noopener" style="display: none !important; visibility: hidden !important"></a>`;
            res.end(file.type.includes("html") ? Buffer.concat([Buffer.from(trap), file.body]) : file.body);
            return;
        }
        case "/files/readfolder": {
            const pathname = url.searchParams.get("pathname") ?? "";
            if (pathname === "/ratelimited") return send(429, "Too many requests", { "ratelimit-reset": "1724615605438" });
            const entries = FOLDERS[pathname];
            return entries ? send(200, entries) : send(404, "Folder not found");
        }
        case "/files/create":
            return send(200, fields.isFolder === "true" ? "Folder created" : "File created");
        case "/files/delete":
            return send(200, "File/folder deleted");
        case "/files/rename":
            return send(200, "File/folder renamed");
        case "/files/edit":
            return send(200, "File edited");
        case "/files/upload":
            return send(200, "Files uploaded");
        case "/files/big/create":
            return send(200, { id: "big123" });
        case "/files/big/append":
            return send(200, "Appended");
        case "/files/big/move":
            return send(200, "Moved");
        case "/files/import/big123":
            return send(200, "Imported");
        default:
            return send(404, "Not found");
    }
}

const mock = createServer((req, res) => void handle(req, res).catch(error => res.writeHead(500).end(String(error))));
await new Promise<void>(resolve => mock.listen(0, "127.0.0.1", resolve));
const apiBase = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

type ToolResult = {
    isError?: boolean;
    content: { type: string; text?: string; data?: string; mimeType?: string }[];
    structuredContent?: unknown;
};

function textOf(result: ToolResult): string {
    return result.content.map(block => block.text ?? `[${block.type}]`).join("\n");
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<ToolResult> {
    return (await client.callTool({ name, arguments: args })) as ToolResult;
}

async function ok(client: Client, name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const result = await call(client, name, args);
    assert.ok(!result.isError, `${name} failed: ${textOf(result)}`);
    return result;
}

async function connect(env: Record<string, string>): Promise<Client> {
    const client = new Client({ name: "smoke-test", version: "1.0.0" });
    await client.connect(
        new StdioClientTransport({
            command: "node",
            args: ["build/index.js"],
            env: { ...getDefaultEnvironment(), ...env },
            stderr: "ignore"
        })
    );
    return client;
}

async function mockChecks(client: Client): Promise<void> {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), [
        "nekoweb_add_tag",
        "nekoweb_create",
        "nekoweb_delete",
        "nekoweb_follow_site",
        "nekoweb_get_feed",
        "nekoweb_get_global_feed",
        "nekoweb_get_limits",
        "nekoweb_get_news",
        "nekoweb_get_site_info",
        "nekoweb_get_site_settings",
        "nekoweb_get_stats_history",
        "nekoweb_get_tags",
        "nekoweb_import_zip",
        "nekoweb_list_folder",
        "nekoweb_list_followers",
        "nekoweb_list_following",
        "nekoweb_list_sites",
        "nekoweb_move",
        "nekoweb_read_file",
        "nekoweb_remove_tag",
        "nekoweb_search_sites",
        "nekoweb_update_site_settings",
        "nekoweb_upload_file",
        "nekoweb_write_file"
    ]);
    for (const tool of tools) {
        assert.ok(tool.description && tool.annotations, `${tool.name} needs a description and annotations`);
    }

    assert.match(textOf(await ok(client, "nekoweb_get_site_info", {})), /Test Site — test\.nekoweb\.org \(main site\)/);
    const own = await ok(client, "nekoweb_get_site_info", { response_format: "json" });
    assert.equal((own.structuredContent as { main: unknown }).main, true);
    const other = await ok(client, "nekoweb_get_site_info", { site: "https://fairfruit.nekoweb.org/", response_format: "json" });
    assert.equal((other.structuredContent as { domain: string }).domain, "fairfruit.nekoweb.org");
    const sites = textOf(await ok(client, "nekoweb_list_sites", {}));
    assert.match(
        sites,
        /2 site\(s\)[\s\S]*test\.nekoweb\.org \(main site\)\n[\s\S]*Files folder: \/test\.nekoweb\.org[\s\S]*second\.nekoweb\.org\n/
    );
    assert.match(textOf(await ok(client, "nekoweb_get_limits", {})), /general\*\*: 99\/100/);

    assert.match(textOf(await ok(client, "nekoweb_list_folder", {})), /📁 blog\/[\s\S]*index\.html/);
    const tree = await ok(client, "nekoweb_list_folder", { path: "/", recursive: true, limit: 3, response_format: "json" });
    const page = tree.structuredContent as { total: number; next_offset: number; entries: { path: string }[] };
    assert.equal(page.total, 6);
    assert.equal(page.next_offset, 3);
    assert.deepEqual(
        page.entries.map(e => e.path),
        ["/blog", "/blog/drafts", "/blog/drafts/wip.html"]
    );
    assert.deepEqual(JSON.parse(tree.content[0].text!), page, "JSON text must match structuredContent");

    const html = await ok(client, "nekoweb_read_file", { path: "index.html" });
    assert.equal(calls.at(-1)?.path, "/files/get");
    assert.equal(html.content[1].text, '<h1>Hi</h1>\n<!--#include file="/footer.html" -->', "SSI source must come back unrendered");
    const image = await ok(client, "nekoweb_read_file", { path: "/logo.png" });
    assert.equal(image.content[1].type, "image");
    assert.equal(image.content[1].mimeType, "image/png");
    assert.equal(image.content[1].data, PNG.toString("base64"));
    assert.match(textOf(await ok(client, "nekoweb_read_file", { path: "/data.bin" })), /binary file/);
    assert.equal((await ok(client, "nekoweb_read_file", { path: "/LICENSE" })).content[1].text, "MIT License — ünïcode");
    const long = await ok(client, "nekoweb_read_file", { path: "/long.txt", max_chars: 10_000 });
    assert.match(long.content[0].text!, /More content: call again with offset=10000/);
    const tail = await ok(client, "nekoweb_read_file", { path: "/long.txt", offset: 25_000 });
    assert.equal(tail.content[1].text!.length, 5_000);
    assert.match(textOf(await call(client, "nekoweb_read_file", { path: "/missing.html" })), /HTTP 404\): File not found/);

    await ok(client, "nekoweb_create", { path: "blog/new", is_folder: true });
    assert.deepEqual(calls.at(-1)?.fields, { pathname: "/blog/new", isFolder: "true" });
    await ok(client, "nekoweb_write_file", { path: "/blog/post.html", content: "<h1>Hi</h1>" });
    assert.deepEqual(calls.at(-1)?.fields, { pathname: "/blog" });
    assert.deepEqual(calls.at(-1)?.files, { "files:post.html": 11 });
    await ok(client, "nekoweb_write_file", { path: "/index.html", content: "hello", mode: "edit_existing" });
    assert.deepEqual(calls.at(-1), {
        method: "POST",
        path: "/files/edit",
        fields: { pathname: "/index.html", content: "hello" },
        files: {}
    });
    await ok(client, "nekoweb_move", { from: "/a.html", to: "/pages/a.html" });
    assert.deepEqual(calls.at(-1)?.fields, { pathname: "/a.html", newpathname: "/pages/a.html" });
    await ok(client, "nekoweb_delete", { path: "/old" });
    assert.equal(calls.at(-1)?.path, "/files/delete");

    await ok(client, "nekoweb_upload_file", { folder: "/img", files: [{ name: "a.png", content_base64: PNG.toString("base64") }] });
    assert.deepEqual(calls.at(-1)?.files, { "files:a.png": 8 });
    await ok(client, "nekoweb_upload_file", { folder: "/", local_paths: ["package.json"] });
    assert.ok(calls.at(-1)?.files["files:package.json"], "local file should be uploaded");
    const zip = await ok(client, "nekoweb_import_zip", { zip_base64: PNG.toString("base64"), folder: "/site" });
    assert.match(textOf(zip), /Imported archive\.zip \(8 B\) into \/site/);
    assert.deepEqual(
        calls.slice(-3).map(c => c.path),
        ["/files/big/create", "/files/big/append", "/files/import/big123"]
    );
    assert.deepEqual(calls.at(-1)?.fields, { path: "/site" });

    const traversal = await call(client, "nekoweb_delete", { path: "/../etc" });
    assert.equal(traversal.isError, true);
    assert.match(textOf(traversal), /not allowed/);
    assert.equal((await call(client, "nekoweb_delete", { path: "/" })).isError, true);
    const limited = await call(client, "nekoweb_list_folder", { path: "/ratelimited" });
    assert.equal(limited.isError, true);
    assert.match(textOf(limited), /HTTP 429[\s\S]*Rate limit exceeded[\s\S]*2024-08-25/);
    assert.match(textOf(await call(client, "nekoweb_list_folder", { path: "/nope" })), /HTTP 404[\s\S]*nekoweb_list_folder/);
    assert.equal((await call(client, "nekoweb_list_folder", { limit: 0 })).isError, true, "limit=0 should fail validation");

    const noSession = await call(client, "nekoweb_get_tags", {});
    assert.equal(noSession.isError, true);
    assert.match(textOf(noSession), /No Nekoweb session token configured[\s\S]*NEKOWEB_SESSION_TOKEN[\s\S]*not paste/);
    assert.match(textOf(await call(client, "nekoweb_add_tag", { tag: "art" })), /No Nekoweb session token configured/);
    assert.match(textOf(await call(client, "nekoweb_get_feed", {})), /No Nekoweb session token configured/);
    assert.match(textOf(await call(client, "nekoweb_follow_site", { site: "eyeorb.net" })), /No Nekoweb session token configured/);
    assert.match(textOf(await call(client, "nekoweb_get_site_settings", {})), /No Nekoweb session token configured/);
    assert.match(textOf(await call(client, "nekoweb_update_site_settings", { nsfw: true })), /No Nekoweb session token configured/);

    const tagged = await ok(client, "nekoweb_search_sites", { query: "art", by: "tag", response_format: "json" });
    assert.deepEqual(calls.at(-1)?.fields, { page: "1", sort: "views", by: "tag", q: "art" });
    assert.deepEqual(tagged.structuredContent, {
        query: "art",
        by: "tag",
        sort: "most_viewed",
        page: 1,
        pages: 2,
        count: 2,
        sites: [
            {
                domain: "cleve.nekoweb.org",
                title: "Cleve's place",
                url: "https://cleve.nekoweb.org/",
                screenshot_url: `${apiBase}/screenshots/cleve.nekoweb.org/index_large.jpg`
            },
            {
                domain: "eyeorb.net",
                title: "eyeorb",
                url: "https://eyeorb.net/",
                screenshot_url: `${apiBase}/screenshots/eyeorb.net/index_large.jpg`
            }
        ]
    });
    assert.equal(
        textOf(await ok(client, "nekoweb_search_sites", { sort: "newest", page: 2 })),
        "# Sites on Nekoweb\n\nSorted by newest, page 2 of 3.\n\n- [kiwi2.xyz](https://kiwi2.xyz/)\n- [eyeorb.net](https://eyeorb.net/) — eyeorb"
    );
    assert.equal(
        textOf(await ok(client, "nekoweb_search_sites", { query: " kiwi " })),
        '# Sites matching "kiwi"\n\nSorted by most viewed.\n\n- [kiwi2.xyz](https://kiwi2.xyz/)'
    );
    assert.equal(textOf(await ok(client, "nekoweb_search_sites", { query: "ar", by: "tag" })), 'No sites tagged "ar".');
    assert.equal(textOf(await ok(client, "nekoweb_search_sites", { page: 9 })), "Page 9 has no sites on Nekoweb.");
    console.error("✓ mock API: sites are searched without a session token");

    const news = textOf(await ok(client, "nekoweb_get_news", {}));
    assert.match(
        news,
        /^# Nekoweb news\n\n## Moving news \(2026-11-01\)\n\nNews now lives on \[kicya\.net\]\(https:\/\/kicya\.net\/news\)\./
    );
    assert.match(
        news,
        /## Tags are here \(2026-10-02\)\n\nYou can now:\n\n- add tags\n- search by tag\n\n## Hello world\n\nFirst post!\nWelcome\.$/
    );
    assert.match(
        textOf(await ok(client, "nekoweb_get_news", { limit: 1 })),
        /^# Nekoweb news\n\n## Moving news[^#]*\n\n2 older posts not shown\.$/
    );
    const newsJson = await ok(client, "nekoweb_get_news", { limit: 2, response_format: "json" });
    assert.deepEqual(
        (newsJson.structuredContent as { count: number; total: number; posts: { title: string; date?: string }[] }).posts.map(p => [
            p.title,
            p.date
        ]),
        [
            ["Moving news", "2026-11-01"],
            ["Tags are here", "2026-10-02"]
        ]
    );
    const global = await ok(client, "nekoweb_get_global_feed", { limit: 2, response_format: "json" });
    assert.deepEqual(global.structuredContent, {
        count: 2,
        posts: [
            {
                title: "Fish & chips",
                url: "https://fish.nekoweb.org/food",
                site: "fish.nekoweb.org",
                date: "2026-11-05T10:00:00.000Z",
                description: "Today I ate fish & chips"
            },
            { title: "Untitled", url: "https://x.org/", site: "", date: "whenever", description: "no site here" }
        ]
    });
    const globalText = textOf(await ok(client, "nekoweb_get_global_feed", {}));
    assert.match(
        globalText,
        /^# Newest posts on Nekoweb\n\n- \*\*\[Fish & chips\]\(https:\/\/fish\.nekoweb\.org\/food\)\*\* — fish\.nekoweb\.org · 2026-11-05T10:00:00\.000Z\n {2}Today I ate fish & chips\n/
    );
    assert.deepEqual(
        calls.filter(c => c.path === "/news" || c.path === "/global-feed.xml").length,
        5,
        "news and the global feed are fetched without a session token"
    );
    console.error("✓ mock API: news and the global feed need no session token");

    console.error("✓ mock API: all checks passed");
}

async function sessionChecks(client: Client): Promise<void> {
    assert.equal(textOf(await ok(client, "nekoweb_get_tags", {})), "# Tags on test.nekoweb.org (2 of 10)\n\n- art\n- r&b");
    const second = await ok(client, "nekoweb_get_tags", { site: "https://Second.nekoweb.org/", response_format: "json" });
    assert.deepEqual(second.structuredContent, { site: "second.nekoweb.org", tags: [], used: 0, limit: 10 });
    assert.match(textOf(await call(client, "nekoweb_get_tags", { site: "fairfruit.nekoweb.org" })), /Site not found: fairfruit/);
    console.error("✓ session token: tags are read from the settings page");

    const tagPosts = () => calls.filter(c => c.path.startsWith("/api/tags/"));
    const added = await ok(client, "nekoweb_add_tag", { tag: " pixel-art " });
    assert.equal(
        textOf(added),
        'Added the tag "pixel-art" to test.nekoweb.org.\n\n# Tags on test.nekoweb.org (3 of 10)\n\n- art\n- pixel-art\n- r&b'
    );
    assert.deepEqual(tagPosts().at(-1)?.fields, { tag: "pixel-art", csrf: "csrf-0", site_id: "1" });
    assert.match(textOf(await ok(client, "nekoweb_add_tag", { tag: "Art" })), /already has the tag "Art", so nothing changed/);
    assert.match(
        textOf(await call(client, "nekoweb_add_tag", { site: "full.nekoweb.org", tag: "more" })),
        /10 of 10 tags[\s\S]*nekoweb_remove_tag/
    );
    const invalid = await call(client, "nekoweb_add_tag", { tag: "Bad Tag" });
    assert.equal(invalid.isError, true);
    assert.match(textOf(invalid), /HTTP 400\): Tag can only contain/);
    assert.equal((await call(client, "nekoweb_add_tag", { tag: "x" })).isError, true, "one-letter tags should fail validation");

    // The mock rotates the CSRF token after every change, so this only works with a token from a fresh settings page.
    assert.match(textOf(await ok(client, "nekoweb_remove_tag", { tag: "r&b" })), /Removed the tag "r&b"[\s\S]*- art\n- pixel-art$/);
    assert.deepEqual(tagPosts().at(-1)?.fields, { tag: "r&b", csrf: "csrf-2", site_id: "1" });
    assert.match(textOf(await ok(client, "nekoweb_remove_tag", { tag: "nope" })), /doesn't have the tag "nope", so nothing changed/);
    assert.equal(tagPosts().length, 3);
    console.error("✓ session token: tags are added and removed with a fresh CSRF token");

    const settingsText = (folder: string, on: string[]) =>
        [
            "# Settings for test.nekoweb.org",
            "",
            `- Serve folder: ${folder}`,
            ...[
                ["Main site", "main"],
                ["Nice links", "nice_links"],
                ["Strict slashes", "strict_slash"],
                ["Listed in Explore", "visible"],
                ["Posts in global feed", "show_in_global_feed"],
                ["HTTP access", "support_http"],
                ["NSFW", "nsfw"]
            ].map(([label, flag]) => `- ${label}: ${on.includes(flag) ? "on" : "off"}`)
        ].join("\n");
    const defaults = ["main", "visible", "show_in_global_feed"];
    assert.equal(textOf(await ok(client, "nekoweb_get_site_settings", {})), settingsText("/", defaults));
    const secondSettings = await ok(client, "nekoweb_get_site_settings", { site: "second.nekoweb.org", response_format: "json" });
    assert.deepEqual(secondSettings.structuredContent, {
        site: "second.nekoweb.org",
        main: false,
        nice_links: false,
        strict_slash: false,
        visible: true,
        show_in_global_feed: true,
        support_http: false,
        nsfw: false,
        folder: "/blog"
    });
    assert.match(textOf(await call(client, "nekoweb_get_site_settings", { site: "fairfruit.nekoweb.org" })), /Site not found: fairfruit/);

    const settingPosts = () => calls.filter(c => c.path === "/api/settings");
    assert.equal(
        textOf(await ok(client, "nekoweb_update_site_settings", { nice_links: true, strict_slash: true, visible: true })),
        `Updated test.nekoweb.org: Nice links on, Strict slashes on.\n\n${settingsText("/", [...defaults, "nice_links", "strict_slash"])}`
    );
    assert.deepEqual(settingPosts().at(-1)?.fields, {
        main: "on",
        nice_links: "on",
        strict_slash: "on",
        visible: "on",
        show_in_global_feed: "on",
        folder: "/",
        csrf: "csrf-3",
        site_id: "1"
    });
    assert.match(
        textOf(await ok(client, "nekoweb_update_site_settings", { nice_links: true, folder: "/" })),
        /^Those settings are already set, so nothing changed\./
    );
    assert.equal(
        textOf(await ok(client, "nekoweb_update_site_settings", { visible: false, folder: "blog\\drafts" })),
        `Updated test.nekoweb.org: Listed in Explore off, serve folder /blog/drafts.\n\n${settingsText("/blog/drafts", [
            "main",
            "show_in_global_feed",
            "nice_links",
            "strict_slash"
        ])}`
    );
    assert.equal(settingPosts().at(-1)?.fields.visible, undefined, "unchecked boxes are left out of the form");
    assert.match(textOf(await call(client, "nekoweb_update_site_settings", { folder: "/nope" })), /HTTP 404/);
    assert.match(textOf(await call(client, "nekoweb_update_site_settings", { folder: "/../etc" })), /not allowed/);
    assert.match(textOf(await call(client, "nekoweb_update_site_settings", {})), /Pass at least one setting/);
    assert.equal(settingPosts().length, 2);
    console.error("✓ session token: site settings are read and only the given ones change");

    assert.equal(
        textOf(await ok(client, "nekoweb_get_stats_history", {})),
        [
            "# Statistics for test.nekoweb.org over the last month",
            "",
            "4 daily snapshots from 2026-10-01 to 2026-10-05 (UTC).",
            "",
            "| | Views | Followers | Updates |",
            "|---|---|---|---|",
            "| Latest total | 135 | 2 | 8 |",
            "| Gained | +35 | +1 | +3 |",
            "",
            "## By day",
            "",
            "Totals at each snapshot, with the change since the previous snapshot in brackets.",
            "",
            "| Recorded (UTC) | Views | Followers | Updates |",
            "|---|---|---|---|",
            "| 2026-10-01 22:01 | 100 | 1 | 5 |",
            "| 2026-10-02 22:01 | 110 (+10) | 1 (+0) | 6 (+1) |",
            "| 2026-10-04 22:01 (2 days) | 130 (+20) | 2 (+1) | 6 (+0) |",
            "| 2026-10-05 22:01 | 135 (+5) | 2 (+0) | 8 (+2) |",
            "",
            "Some days have no snapshot; the change after a gap covers all the days marked."
        ].join("\n")
    );
    const history = await ok(client, "nekoweb_get_stats_history", { response_format: "json" });
    const snapshots = (history.structuredContent as { snapshots: Record<string, unknown>[] }).snapshots;
    assert.deepEqual(snapshots[0], { recorded_at: "2026-10-01T22:01:00.000Z", views: 100, followers: 1, updates: 5 });
    assert.deepEqual(snapshots[2], {
        recorded_at: "2026-10-04T22:01:00.000Z",
        views: 130,
        followers: 2,
        updates: 6,
        gained: { views: 20, followers: 1, updates: 0 },
        days: 2
    });
    const all = textOf(await ok(client, "nekoweb_get_stats_history", { period: "all" }));
    assert.match(
        all,
        /over all time\n\n70 daily snapshots[\s\S]*## By month[\s\S]*\| 2026-08 \| 60 \(\+60\) \| 3 \(\+3\) \| 30 \(\+30\) \|\n\| 2026-09 \| 120 \(\+60\)/
    );
    assert.match(all, /\| 2026-10 \| 138 \(\+18\) \| 6 \(\+0\) \| 69 \(\+9\) \|$/);
    const year = await call(client, "nekoweb_get_stats_history", { period: "year" });
    assert.equal(year.isError, true);
    assert.match(textOf(year), /HTTP 400\): You need to be a Cute kitty tier[\s\S]*Try period "month"/);
    assert.equal(
        textOf(await ok(client, "nekoweb_get_stats_history", { site: "second.nekoweb.org" })),
        "Nekoweb has no statistics for second.nekoweb.org over the last month yet."
    );
    assert.match(textOf(await call(client, "nekoweb_get_stats_history", { site: "fairfruit.nekoweb.org" })), /Site not found: fairfruit/);
    console.error("✓ session token: stats history is read from the stats page");

    const followerCalls = (domain: string) =>
        calls.filter(c => c.path === `/followers/${domain}`).map(c => `${c.fields.page}:${c.fields.sort}`);
    assert.equal(
        textOf(await ok(client, "nekoweb_list_followers", {})),
        [
            "# 5 sites following test.nekoweb.org",
            "",
            "Sorted by follow date. You follow back 2 of them.",
            "",
            "- [a.nekoweb.org](https://a.nekoweb.org/) — Alpha (you follow back)",
            "- [b.nekoweb.org](https://b.nekoweb.org/)",
            "- [kiwi2.xyz](https://kiwi2.xyz/) — kiwi's cool website!",
            "- [c.nekoweb.org](https://c.nekoweb.org/) — C & co (you follow back)",
            "- [d.nekoweb.org](https://d.nekoweb.org/) — Delta"
        ].join("\n")
    );
    assert.deepEqual(followerCalls("test.nekoweb.org"), ["1:followdate", "2:followdate", "3:followdate"]);
    const popular = await ok(client, "nekoweb_list_followers", { sort: "most_followed", response_format: "json" });
    const content = popular.structuredContent as { pages: number; count: number; followers: { domain: string }[] };
    assert.deepEqual([content.pages, content.count, content.followers[0].domain], [3, 5, "d.nekoweb.org"]);
    assert.deepEqual((popular.structuredContent as { followers: unknown[] }).followers[1], {
        domain: "c.nekoweb.org",
        title: "C & co",
        url: "https://c.nekoweb.org/",
        screenshot_url: `${apiBase}/screenshots/c.nekoweb.org/index_large.jpg`,
        you_follow: true
    });
    const pageTwo = textOf(await ok(client, "nekoweb_list_followers", { page: 2 }));
    assert.match(
        pageTwo,
        /^# 2 sites following test\.nekoweb\.org\n\nSorted by follow date\. You follow back 1 of them\. This is page 2 of 3\.\n\n- \[kiwi2\.xyz\][\s\S]*c\.nekoweb\.org[^\n]*$/
    );
    assert.equal(
        textOf(await ok(client, "nekoweb_list_followers", { page: 9 })),
        "No sites follow test.nekoweb.org on this page. Page 9 is past the end of the list."
    );
    assert.equal(
        textOf(await ok(client, "nekoweb_list_followers", { site: "second.nekoweb.org" })),
        "No sites follow second.nekoweb.org yet."
    );
    const full = textOf(await ok(client, "nekoweb_list_followers", { site: "full.nekoweb.org" }));
    assert.match(
        full,
        /^# 40 sites following full\.nekoweb\.org[\s\S]*Only the first 20 of 25 pages were fetched; use 'page' for the rest\./
    );
    assert.equal(followerCalls("full.nekoweb.org").length, 20);
    assert.match(textOf(await call(client, "nekoweb_list_followers", { site: "fairfruit.nekoweb.org" })), /Site not found: fairfruit/);
    console.error("✓ session token: followers are read from every page");

    const following = textOf(await ok(client, "nekoweb_list_following", {}));
    assert.equal(
        following,
        "# 3 sites you follow\n\n## Updated 2026-11-06\n\n- [cleve.nekoweb.org](https://cleve.nekoweb.org/) — Cleve's place\n- [eyeorb.net](https://eyeorb.net/) — eyeorb\n\n## Updated 2026-10-30\n\n- [kiwi2.xyz](https://kiwi2.xyz/)"
    );
    const followingTwo = await ok(client, "nekoweb_list_following", { page: 2, response_format: "json" });
    assert.deepEqual(followingTwo.structuredContent, {
        page: 2,
        pages: 2,
        count: 1,
        sites: [
            {
                domain: "kiwi2.xyz",
                title: "kiwi2.xyz",
                url: "https://kiwi2.xyz/",
                screenshot_url: `${apiBase}/screenshots/kiwi2.xyz/index_large.jpg`,
                last_updated: "2026-10-30"
            }
        ]
    });
    assert.equal(
        textOf(await ok(client, "nekoweb_list_following", { page: 5 })),
        "No followed sites on this page. Page 5 is past the end of the list."
    );

    const feed = textOf(await ok(client, "nekoweb_get_feed", {}));
    assert.equal(
        feed,
        "# Your feed (page 1 of 2)\n\n- **[New & shiny](https://cleve.nekoweb.org/blog/1)** — cleve.nekoweb.org · 2026-10-29\n  I made a thing.\n- **[Eyes](https://eyeorb.net/eyes)** — eyeorb.net · 2026-10-20\n  Look!"
    );
    const feedTwo = await ok(client, "nekoweb_get_feed", { page: 2, response_format: "json" });
    assert.deepEqual(feedTwo.structuredContent, {
        page: 2,
        pages: 2,
        count: 1,
        posts: [{ title: "Kiwi", url: "https://kiwi2.xyz/kiwi", site: "kiwi2.xyz", date: "2026-09-01", description: "" }]
    });
    assert.equal(textOf(await ok(client, "nekoweb_get_feed", { page: 3 })), "Page 3 of your feed is empty.");
    console.error("✓ session token: followed sites and the feed are read");

    assert.equal(
        textOf(await ok(client, "nekoweb_search_sites", { query: "e" })),
        '# Sites matching "e"\n\nSorted by most viewed, page 1 of 2.\n\n- [cleve.nekoweb.org](https://cleve.nekoweb.org/) — Cleve\'s place (you follow)\n- [eyeorb.net](https://eyeorb.net/) — eyeorb (you follow)'
    );
    const searched = await ok(client, "nekoweb_search_sites", { query: "hidden", response_format: "json" });
    assert.equal((searched.structuredContent as { sites: { you_follow: boolean }[] }).sites[0].you_follow, false);
    console.error("✓ session token: search results say which sites you follow");

    const toggles = () => calls.filter(c => c.path.endsWith("/toggle_follow")).length;
    assert.equal(
        textOf(await ok(client, "nekoweb_follow_site", { site: "fairfruit.nekoweb.org" })),
        "You now follow fairfruit.nekoweb.org."
    );
    assert.equal(
        textOf(await ok(client, "nekoweb_follow_site", { site: "https://FairFruit.nekoweb.org/" })),
        "You already follow fairfruit.nekoweb.org, so nothing changed."
    );
    assert.equal(toggles(), 1);
    assert.equal(textOf(await ok(client, "nekoweb_follow_site", { site: "eyeorb.net", follow: false })), "You unfollowed eyeorb.net.");
    assert.equal(
        textOf(await ok(client, "nekoweb_follow_site", { site: "eyeorb.net", follow: false })),
        "You don't follow eyeorb.net, so nothing changed."
    );
    assert.equal(toggles(), 2);
    // Hidden sites aren't on the followed sites list, but the follow page still shows whether you follow them.
    assert.equal(textOf(await ok(client, "nekoweb_follow_site", { site: "hidden.nekoweb.org" })), "You now follow hidden.nekoweb.org.");
    assert.doesNotMatch(textOf(await ok(client, "nekoweb_list_following", {})), /hidden\.nekoweb\.org/);
    assert.equal(
        textOf(await ok(client, "nekoweb_follow_site", { site: "hidden.nekoweb.org" })),
        "You already follow hidden.nekoweb.org, so nothing changed."
    );
    assert.equal(
        textOf(await ok(client, "nekoweb_follow_site", { site: "hidden.nekoweb.org", follow: false })),
        "You unfollowed hidden.nekoweb.org."
    );
    assert.equal(toggles(), 4);
    assert.deepEqual([...FOLLOWING].sort(), ["cleve.nekoweb.org", "fairfruit.nekoweb.org", "kiwi2.xyz"]);
    assert.match(textOf(await call(client, "nekoweb_follow_site", { site: "https://" })), /Invalid site "https:\/\/"/);
    const missing = await call(client, "nekoweb_follow_site", { site: "nope.nekoweb.org" });
    assert.equal(missing.isError, true);
    assert.equal(textOf(missing), "Site not found: there is no Nekoweb site at nope.nekoweb.org.");
    console.error("✓ session token: following and unfollowing only toggle when needed");
}

async function badSessionChecks(client: Client): Promise<void> {
    const tags = await call(client, "nekoweb_get_tags", { site: "test.nekoweb.org" });
    assert.equal(tags.isError, true);
    assert.match(textOf(tags), /HTTP 303[\s\S]*session token is invalid or expired/);
    assert.match(
        textOf(await call(client, "nekoweb_remove_tag", { site: "test.nekoweb.org", tag: "art" })),
        /session token is invalid or expired/
    );
    assert.match(
        textOf(await call(client, "nekoweb_get_stats_history", { site: "test.nekoweb.org" })),
        /session token is invalid or expired/
    );
    assert.match(textOf(await call(client, "nekoweb_list_followers", { site: "test.nekoweb.org" })), /session token is invalid or expired/);
    assert.match(textOf(await call(client, "nekoweb_list_following", {})), /session token is invalid or expired/);
    assert.match(textOf(await call(client, "nekoweb_get_feed", {})), /session token is invalid or expired/);
    assert.match(
        textOf(await call(client, "nekoweb_get_site_settings", { site: "test.nekoweb.org" })),
        /session token is invalid or expired/
    );
    assert.match(
        textOf(await call(client, "nekoweb_update_site_settings", { site: "test.nekoweb.org", nsfw: true })),
        /session token is invalid or expired/
    );
    assert.match(
        textOf(await call(client, "nekoweb_follow_site", { site: "fairfruit.nekoweb.org" })),
        /session token is invalid or expired/
    );
    assert.match(
        textOf(await call(client, "nekoweb_follow_site", { site: "fairfruit.nekoweb.org", follow: false })),
        /session token is invalid or expired/
    );
    console.error("✓ wrong session token: reported as expired");
}

async function badKeyChecks(client: Client): Promise<void> {
    const read = await call(client, "nekoweb_read_file", { path: "/index.html" });
    assert.equal(read.isError, true);
    assert.match(textOf(read), /HTTP 302[\s\S]*missing or invalid/);
    console.error("✓ wrong API key: reported as an auth error");
}

async function liveChecks(client: Client): Promise<void> {
    const info = await ok(client, "nekoweb_get_site_info", { site: "fairfruit.nekoweb.org", response_format: "json" });
    assert.equal((info.structuredContent as { domain: string }).domain, "fairfruit.nekoweb.org");
    assert.match(
        textOf(await call(client, "nekoweb_get_site_info", { site: "no-such-site-xyz.nekoweb.org" })),
        /HTTP 404\): Site not found/
    );
    assert.match(textOf(await call(client, "nekoweb_list_folder", {})), /No Nekoweb API key/);
    const news = await ok(client, "nekoweb_get_news", { limit: 1, response_format: "json" });
    assert.ok((news.structuredContent as { total: number }).total > 10, "the news page should list many posts");
    const global = await ok(client, "nekoweb_get_global_feed", { response_format: "json" });
    const posts = (global.structuredContent as { posts: { url: string; site: string; date: string }[] }).posts;
    assert.equal(posts.length, 20);
    assert.ok(posts.every(post => post.url.startsWith("http") && post.site && !Number.isNaN(Date.parse(post.date))));
    const found = await ok(client, "nekoweb_search_sites", { query: "fairfruit", response_format: "json" });
    const results = (found.structuredContent as { sites: { domain: string; you_follow?: boolean }[] }).sites;
    assert.ok(results.some(site => site.domain === "fairfruit.nekoweb.org" && site.you_follow === undefined));
    const art = await ok(client, "nekoweb_search_sites", { query: "art", by: "tag", sort: "most_followed", response_format: "json" });
    assert.ok(
        (art.structuredContent as { pages: number; count: number }).pages > 1 && (art.structuredContent as { count: number }).count > 40
    );
    console.error("✓ live: public site info and key errors work against nekoweb.org");
}

let failed = false;
try {
    const mockUrls = { NEKOWEB_API_BASE_URL: apiBase, NEKOWEB_SITE_BASE_URL: apiBase };
    const withKey = await connect({ NEKOWEB_API_KEY: API_KEY, ...mockUrls });
    await mockChecks(withKey);
    await withKey.close();

    const wrongKey = await connect({ NEKOWEB_API_KEY: "wrong-key", ...mockUrls });
    await badKeyChecks(wrongKey);
    await wrongKey.close();

    const withSession = await connect({ NEKOWEB_API_KEY: API_KEY, NEKOWEB_SESSION_TOKEN: SESSION_TOKEN, ...mockUrls });
    await sessionChecks(withSession);
    await withSession.close();

    const wrongSession = await connect({ NEKOWEB_API_KEY: API_KEY, NEKOWEB_SESSION_TOKEN: "expired", ...mockUrls });
    await badSessionChecks(wrongSession);
    await wrongSession.close();

    if (process.argv.includes("--live")) {
        const live = await connect({});
        await liveChecks(live);
        await live.close();

        const liveBadKey = await connect({ NEKOWEB_API_KEY: "not-a-real-key", NEKOWEB_SESSION_TOKEN: "not-a-real-token" });
        await badKeyChecks(liveBadKey);
        await badSessionChecks(liveBadKey);
        await liveBadKey.close();
    }
} catch (error) {
    failed = true;
    console.error("✗ Smoke test failed:", error);
} finally {
    mock.close();
}
process.exit(failed ? 1 : 0);
