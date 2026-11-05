import { NekowebError } from "./api.js";

// "blog\\post.html/" -> "/blog/post.html"; rejects ".." so paths can't escape the file root.
export function normalizeSitePath(input: string): string {
    const segments = input
        .trim()
        .replace(/\\/g, "/")
        .split("/")
        .filter(segment => segment !== "" && segment !== ".");
    if (segments.includes("..")) {
        throw new NekowebError(
            `Invalid path "${input}": ".." is not allowed. Use an absolute path, e.g. "/mysite.nekoweb.org/blog/post.html".`
        );
    }
    return "/" + segments.join("/");
}

export function normalizeEntryPath(input: string): string {
    const path = normalizeSitePath(input);
    if (path === "/") throw new NekowebError(`Invalid path "${input}": this needs a file or folder path, not the root folder.`);
    return path;
}

export function splitPath(path: string): { folder: string; name: string } {
    const index = path.lastIndexOf("/");
    return { folder: index <= 0 ? "/" : path.slice(0, index), name: path.slice(index + 1) };
}

export function joinSitePath(folder: string, name: string): string {
    return normalizeSitePath(`${folder}/${name}`);
}
