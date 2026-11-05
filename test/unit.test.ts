import { describe, expect, it } from "vitest";
import { describeReset, httpErrorMessage } from "../src/api.js";
import { joinSitePath, normalizeEntryPath, normalizeSitePath, splitPath } from "../src/paths.js";
import { decodeUtf8, imageType } from "../src/tools/files.js";

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

    it("describes reset values in ms, seconds and relative form", () => {
        expect(describeReset(-1)).toBe("not started");
        expect(describeReset(1724615605438)).toBe("2024-08-25T19:53:25.438Z");
        expect(describeReset(1724615605)).toBe("2024-08-25T19:53:25.000Z");
        expect(describeReset(30)).toBe("30 seconds from now");
    });
});
