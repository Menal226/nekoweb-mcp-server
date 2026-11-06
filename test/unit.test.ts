import { describe, expect, it } from "vitest";
import { describeReset, httpErrorMessage, sitePageError } from "../src/api.js";
import { joinSitePath, normalizeDomain, normalizeEntryPath, normalizeSitePath, splitPath } from "../src/paths.js";
import { decodeUtf8, imageType } from "../src/tools/files.js";
import { parseTagForm, parseTags } from "../src/tools/settings.js";
import { parseStats } from "../src/tools/stats.js";
import { parseFollowers } from "../src/tools/followers.js";
import { parseFeed, parseFollowing, parseNews, parseRss } from "../src/tools/social.js";
import { absoluteUrl, htmlText, isoDate, parseHtml } from "../src/html.js";

// Shaped like the tags section of the real /settings/<domain> page.
function tagsPage(tags: string[], summary = `You have ${tags.length} out of 10 tags.`): string {
    const rows = tags.map(
        tag => `
                            <tr>\r
                                <td>${tag}</td>\r
                                <td>\r
                                    <form method="post" action="/api/tags/remove" enctype="application/x-www-form-urlencoded">\r
                                        <input type="hidden" name="tag" value="${tag}" required>\r
                                        <input type="hidden" name="csrf" value="REDACTED" required>\r
                                        <input type="hidden" name="site_id" value="29644">\r
                                        <input type="submit" value="Delete">\r
                                    </form>\r
                                </td>\r
                            </tr>\r`
    );
    return `<html><body><div id="domain"><span>You have 1 out of 1 domains.</span><input type="hidden" name="csrf" value="OTHER"></div>
<div id="tags" >\r
        <h2>Tags</h2>\r
                <span>${summary}</span><br><br>\r
                <table>\r
                    <tbody id="tags">\r
                        <tr>\r
                            <th>Tag</th>\r
                            <th></th>\r
                        </tr>\r${rows.join("")}
                    </tbody>\r
                </table>\r
                <form action="/api/tags/add" method="post"><p><b>Add tag</b></p><input type="text" name="tag">
                    <input type="hidden" name="csrf" value="REDACTED" required>
                    <input type="hidden" name="site_id" value="29644"></form>
</div></body></html>`;
}

describe("site tags", () => {
    it("reads the tags and the tag count from the settings page", () => {
        expect(parseTags(tagsPage(["computer", "gui", "hi"]))).toEqual({ tags: ["computer", "gui", "hi"], used: 3, limit: 10 });
    });

    it("decodes HTML entities and handles no tags", () => {
        expect(parseTags(tagsPage(["r&amp;b", "&#x1F431;cats"]))?.tags).toEqual(["r&b", "🐱cats"]);
        expect(parseTags(tagsPage([]))).toEqual({ tags: [], used: 0, limit: 10 });
        expect(parseTags(tagsPage(["a"], "Translated text"))).toEqual({ tags: ["a"] });
    });

    it("returns undefined when the page has no tags section", () => {
        expect(parseTags("<html><p>Site not found</p></html>")).toBeUndefined();
    });

    it("reads the CSRF token and site id from the tag forms", () => {
        expect(parseTagForm(tagsPage(["gui"]))).toEqual({ csrf: "REDACTED", siteId: "29644" });
        expect(parseTagForm(tagsPage([]))).toEqual({ csrf: "REDACTED", siteId: "29644" });
        expect(parseTagForm("<html><p>Site not found</p></html>")).toBeUndefined();
    });
});

// Shaped like the chart script on the real /settings/<domain>/stats page.
function statsPage(dates: string, views: string, followers: string, updates: string): string {
    return `<canvas id="all-updates"></canvas>\r
    </div>\r
    <script>\r
        const dates = [${dates}];\r
        const viewsData = [${views}];\r
        const followersData = [${followers}];\r
        const updatesData = [${updates}];\r
        const chartLabels = {\r
            visits: "Visits",\r
        };\r
        const filled = [];\r
    </script>`;
}

describe("site stats", () => {
    it("reads the daily snapshots from the stats page", () => {
        expect(parseStats(statsPage("1791496972766,1791583379774", "114,116", "0,1", "27,27"))).toEqual([
            { time: 1791496972766, views: 114, followers: 0, updates: 27 },
            { time: 1791583379774, views: 116, followers: 1, updates: 27 }
        ]);
        expect(parseStats(statsPage("", "", "", ""))).toEqual([]);
    });

    it("returns undefined when the data is missing or doesn't line up", () => {
        expect(parseStats(statsPage("1,2", "3", "4,5", "6,7"))).toBeUndefined();
        expect(parseStats("<p> You need to be a Cute kitty tier to view yearly statistics. </p>")).toBeUndefined();
    });
});

// Shaped like a site card on the real /followers/<domain> page.
function followerCard(domain: string, title: string, following: boolean): string {
    const id = domain.replace(/\./g, "-");
    return `
            <div class="pre-pre-site">
                <div class="pre-site" style="">
                    <div id="site-${id}" class="site-box t-classic" style="width:275px!important;height:190px!important;position:relative!important">
                        <span class="top-dot"></span>
                        <a href="//${domain}/" target="_blank" rel="noopener ugc" style="position:relative!important">
                            <div class="sitefeature" style="position:relative!important">
                                <img class="screenshot" src="/screenshots/${domain}/index_large.jpg" style="position:relative!important">
                            </div>
                            <p style="position:relative!important">${domain}
                                <span class="follow ${following ? "following " : ""}follow-${id}" data-domain="${domain}" role="button" title="${following ? "Unfollow" : "Follow"}" style="position:relative!important">[${following ? "-" : "+"}]</span>
                            </p>
                            <span style="position:relative!important" class="site-title">${title}</span><br>
                        </a>
                        <span class="bottom-dot"></span>
                    </div>
                </div>
            </div>`;
}

function followersPage(cards: string[], pager = "<b>1</b>"): string {
    return `<div class="explore"><h2>Sites that follow menal.nekoweb.org</h2>
        <div id="sites"><div class="carouselContainer">${cards.join("")}</div>
        <div style="text-align:center;padding:15px">${pager}</div></div></div>
        <footer><a href="/explore?page=1&amp;sort=lastupd">Explore</a></footer>`;
}

describe("followers", () => {
    it("reads each follower's card", () => {
        const page = followersPage([
            followerCard("eyeorb.net", "eyeorb", true),
            followerCard("kiwi2.xyz", "kiwi&#39;s cool website!", false)
        ]);
        expect(parseFollowers(page, "/followers/menal.nekoweb.org")).toEqual({
            pages: 1,
            followers: [
                {
                    domain: "eyeorb.net",
                    title: "eyeorb",
                    url: "https://eyeorb.net/",
                    screenshot_url: "https://nekoweb.org/screenshots/eyeorb.net/index_large.jpg",
                    you_follow: true
                },
                {
                    domain: "kiwi2.xyz",
                    title: "kiwi's cool website!",
                    url: "https://kiwi2.xyz/",
                    screenshot_url: "https://nekoweb.org/screenshots/kiwi2.xyz/index_large.jpg",
                    you_follow: false
                }
            ]
        });
    });

    it("counts the pages from the pager links", () => {
        const pager = `<a href="?page=1&amp;sort=followdate">1</a> <b>2</b> <a href="?page=3&amp;sort=followdate">3</a> <a href="?page=3&amp;sort=followdate">▶</a>`;
        expect(
            parseFollowers(followersPage([followerCard("a.nekoweb.org", "a", false)], pager), "/followers/menal.nekoweb.org").pages
        ).toBe(3);
        const lastPage = `<a href="?page=1&amp;sort=followdate">1</a> <a href="?page=2&amp;sort=followdate">2</a> <b>3</b>`;
        expect(
            parseFollowers(followersPage([followerCard("a.nekoweb.org", "a", false)], lastPage), "/followers/menal.nekoweb.org").pages
        ).toBe(3);
        expect(parseFollowers(followersPage([], "<p>No sites found :(</p>"), "/followers/menal.nekoweb.org")).toEqual({
            followers: [],
            pages: 0
        });
        expect(parseFollowers("<p> Site not found </p>", "/followers/menal.nekoweb.org")).toEqual({ followers: [], pages: 0 });
    });
});

describe("following", () => {
    it("reads the sites you follow with the day each was last updated", () => {
        const page = `<div class="explore"><h2>Sites you follow (sorted by last updated)</h2><div id="sites">
            <h2 class="date">November 6, 2026</h2>
            <div class='carouselContainer'>${followerCard("cleve.nekoweb.org", "People Playground | Mod Creator", true)}<style>.follow { cursor: pointer; }</style></div>
            <h2 class="date">November 5, 2026</h2>
            <div class='carouselContainer'>${followerCard("eyeorb.net", "eyeorb", true)}${followerCard("kiwi2.xyz", "kiwi", true)}</div>
            <div style="text-align:center"><b>1</b> <a href="?page=2">2</a></div></div></div>`;
        const { sites, pages } = parseFollowing(page);
        expect(pages).toBe(2);
        expect(sites.map(site => [site.domain, site.title, site.last_updated])).toEqual([
            ["cleve.nekoweb.org", "People Playground | Mod Creator", "2026-11-06"],
            ["eyeorb.net", "eyeorb", "2026-11-05"],
            ["kiwi2.xyz", "kiwi", "2026-11-05"]
        ]);
        expect(sites[0]).not.toHaveProperty("you_follow");
        expect(parseFollowing(`<div id="sites"><p>No sites found :(</p></div>`)).toEqual({ sites: [], pages: 0 });
    });
});

describe("feeds", () => {
    // Shaped like a post card on the real /feed page.
    const post = (site: string, url: string, date: string, title: string, description: string) => `
        <div class="pre-pre-post"><div class="pre-post">
            <a class="post-link" href="${url}" target="_blank" rel="noopener ugc">
                <div class="post-box t-classic" id="post-x"><div class="post-box-inner">
                    <span class="post-top-dot"></span>
                    <span class="post-author">${site}</span><span class="post-dot">·</span>
                    <span class="post-date">${date}</span><span class="post-dot">·</span>
                    <span class="follow following follow-x" data-confirm="1" data-domain="${site}" role="button" title="Unfollow">[-]</span>
                    <h4 class="post-title">${title}</h4>
                    <p class="post-description">${description}</p>
                    <span class="post-bottom-dot"></span>
                </div></div>
            </a>
        </div></div>`;

    it("reads posts from the personal feed", () => {
        const page = `<h2>RSS Feed (<a href="/global-feed">view global</a>)</h2><div class="posts">
            ${post("eyeorb.net", "https://eyeorb.net/blog/japan/", "10/29/2026", "japan 1 - the first week", "the beginning &amp; more..")}
            ${post("cleve.nekoweb.org", "/blog", "not a date", "Update", "")}
            </div><div><b>1</b></div>`;
        expect(parseFeed(page)).toEqual({
            pages: 1,
            posts: [
                {
                    title: "japan 1 - the first week",
                    url: "https://eyeorb.net/blog/japan/",
                    site: "eyeorb.net",
                    date: "2026-10-29",
                    description: "the beginning & more.."
                },
                { title: "Update", url: "https://nekoweb.org/blog", site: "cleve.nekoweb.org", date: "not a date", description: "" }
            ]
        });
    });

    it("reads the global RSS feed", () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Nekoweb Global Feed</title>
            <item><title>Ranting About German Grammars</title><description>arlecooch-ie.nekoweb.org — Complaining about grammars &amp; more</description>
            <link>https://arlecooch-ie.nekoweb.org/pages/ranting</link><guid isPermaLink="false">arlecooch-ie.nekoweb.org:post12</guid>
            <pubDate>Fri, 06 Nov 2026 13:45:00 GMT</pubDate></item>
            <item><title><![CDATA[A <b>bold</b> title]]></title><description>No site prefix</description><link>https://x.nekoweb.org/</link><pubDate>soon</pubDate></item>
            </channel></rss>`;
        expect(parseRss(xml)).toEqual([
            {
                title: "Ranting About German Grammars",
                url: "https://arlecooch-ie.nekoweb.org/pages/ranting",
                site: "arlecooch-ie.nekoweb.org",
                date: "2026-11-06T13:45:00.000Z",
                description: "Complaining about grammars & more"
            },
            { title: "A <b>bold</b> title", url: "https://x.nekoweb.org/", site: "", date: "soon", description: "No site prefix" }
        ]);
    });

    it("reads news posts with their dates and text", () => {
        const page = `<div id="news">
            <h2>New page for updates - September 22, 2026</h2>
            <p>
                Nekoweb updates will now be posted on <a href="https://kicya.net/news">Kicya's news page</a> from now on.
            </p>
            <h2>New languages - August 29, 2026</h2>
            <p>Thanks to the <a href="/credits">translators</a>! You can now use: <ul><li>English</li><li>French</li></ul></p>
            <div><h3>READ THE ZINE</h3></div>
            <h2>No date here</h2>
        </div><footer>Credits</footer>`;
        expect(parseNews(page)).toEqual([
            {
                title: "New page for updates",
                date: "2026-09-22",
                text: "Nekoweb updates will now be posted on [Kicya's news page](https://kicya.net/news) from now on."
            },
            {
                title: "New languages",
                date: "2026-08-29",
                text: "Thanks to the [translators](https://nekoweb.org/credits)! You can now use:\n\n- English\n- French\n\nREAD THE ZINE"
            },
            { title: "No date here", text: "" }
        ]);
    });

    it("reads dates and text", () => {
        expect(isoDate("November 6, 2026")).toBe("2026-11-06");
        expect(isoDate("1/2/2026")).toBe("2026-01-02");
        expect(isoDate("someday")).toBeUndefined();
        const $ = parseHtml("<div>a<br>b <a href='/faq'>the FAQ</a> <a href='https://y.org/'>https://y.org/</a><script>x()</script></div>");
        expect(htmlText($("div"))).toBe("a\nb [the FAQ](https://nekoweb.org/faq) https://y.org/");
        expect(absoluteUrl("//x.org/a")).toBe("https://x.org/a");
        expect(absoluteUrl("http://[bad")).toBe("http://[bad");
    });
});

describe("file contents", () => {
    it("decodes valid UTF-8 and rejects binaries", () => {
        expect(decodeUtf8(new TextEncoder().encode("héllo"))).toBe("héllo");
        expect(decodeUtf8(new Uint8Array([0, 1]))).toBeUndefined();
        expect(decodeUtf8(new Uint8Array([0xff, 0xfe]))).toBeUndefined();
    });

    it("detects images from Content-Type or extension", () => {
        expect(imageType("/a.bin", "image/gif")).toBe("image/gif");
        expect(imageType("/a.PNG", "application/octet-stream")).toBe("image/png");
        expect(imageType("/a.zip", "application/octet-stream")).toBeUndefined();
    });
});

describe("paths", () => {
    it("normalizes site paths", () => {
        expect(normalizeSitePath("")).toBe("/");
        expect(normalizeSitePath("blog/post.html")).toBe("/blog/post.html");
        expect(normalizeSitePath("\\blog\\\\./post.html/")).toBe("/blog/post.html");
    });

    it("rejects traversal and the root where an entry is required", () => {
        expect(() => normalizeSitePath("/a/../b")).toThrow(/not allowed/);
        expect(() => normalizeEntryPath("/")).toThrow(/root folder/);
    });

    it("normalizes domains", () => {
        expect(normalizeDomain(" https://MySite.nekoweb.org/blog/ ")).toBe("mysite.nekoweb.org");
        expect(normalizeDomain("mysite.nekoweb.org")).toBe("mysite.nekoweb.org");
        expect(normalizeDomain("eyeorb.net?ref=1")).toBe("eyeorb.net");
        expect(() => normalizeDomain("https://")).toThrow(/Invalid site/);
        expect(() => normalizeDomain("my site")).toThrow(/Invalid site/);
    });

    it("splits and joins paths", () => {
        expect(splitPath("/a/b.html")).toEqual({ folder: "/a", name: "b.html" });
        expect(splitPath("/b.html")).toEqual({ folder: "/", name: "b.html" });
        expect(joinSitePath("/", "x")).toBe("/x");
    });
});

describe("errors", () => {
    it("unwraps JSON error bodies and adds recovery hints", () => {
        expect(httpErrorMessage(404, '{"error":"Site not found"}')).toMatch(
            /^Nekoweb API error \(HTTP 404\): Site not found\. .*nekoweb_list_folder/
        );
        expect(httpErrorMessage(401, "You are not logged in.")).toMatch(/NEKOWEB_API_KEY/);
        expect(httpErrorMessage(302, "")).toMatch(/missing or invalid/);
        expect(httpErrorMessage(429, "", "1724615605438")).toMatch(/2024-08-25T/);
    });

    it("explains settings page errors", () => {
        const errorPage = (message: string) => `<title>Error! - nekoweb.org</title><h1>Error!</h1><p> ${message} </p>`;
        expect(sitePageError(303, "", "a.nekoweb.org")).toMatch(/invalid or expired[\s\S]*NEKOWEB_SESSION_TOKEN/);
        expect(sitePageError(400, "Security error, please close this tab", "a.nekoweb.org")).toMatch(/invalid or expired/);
        expect(sitePageError(400, errorPage("Site not found"), "a.nekoweb.org")).toMatch(/^Site not found: a\.nekoweb\.org/);
        expect(sitePageError(400, errorPage("You already have this tag."), "a.nekoweb.org")).toBe(
            "Nekoweb refused the request (HTTP 400): You already have this tag."
        );
        expect(sitePageError(429, "", "a.nekoweb.org", "900")).toMatch(/HTTP 429.*900 seconds from now/);
        expect(sitePageError(502, "<p>Bad gateway</p>", "a.nekoweb.org")).toMatch(/HTTP 502.*Try again/);
    });

    it("describes reset values in ms, seconds and relative form", () => {
        expect(describeReset(-1)).toBe("not started");
        expect(describeReset(1724615605438)).toBe("2024-08-25T19:53:25.438Z");
        expect(describeReset(1724615605)).toBe("2024-08-25T19:53:25.000Z");
        expect(describeReset(30)).toBe("30 seconds from now");
    });
});
