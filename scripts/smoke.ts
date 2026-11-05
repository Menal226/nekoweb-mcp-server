// Runs the built server against a mock Nekoweb API: `npm run build && npm run smoke` (add `-- --live` for real key-less calls).
import { strict as assert } from "node:assert";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const API_KEY = "test-key";
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
            res.end(file.body);
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
        "nekoweb_create",
        "nekoweb_delete",
        "nekoweb_get_limits",
        "nekoweb_get_site_info",
        "nekoweb_import_zip",
        "nekoweb_list_folder",
        "nekoweb_list_sites",
        "nekoweb_move",
        "nekoweb_read_file",
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

    console.error("✓ mock API: all checks passed");
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
    console.error("✓ live: public site info and key errors work against nekoweb.org");
}

let failed = false;
try {
    const withKey = await connect({ NEKOWEB_API_KEY: API_KEY, NEKOWEB_API_BASE_URL: apiBase });
    await mockChecks(withKey);
    await withKey.close();

    const wrongKey = await connect({ NEKOWEB_API_KEY: "wrong-key", NEKOWEB_API_BASE_URL: apiBase });
    await badKeyChecks(wrongKey);
    await wrongKey.close();

    if (process.argv.includes("--live")) {
        const live = await connect({});
        await liveChecks(live);
        await live.close();

        const liveBadKey = await connect({ NEKOWEB_API_KEY: "not-a-real-key" });
        await badKeyChecks(liveBadKey);
        await liveBadKey.close();
    }
} catch (error) {
    failed = true;
    console.error("✗ Smoke test failed:", error);
} finally {
    mock.close();
}
process.exit(failed ? 1 : 0);
