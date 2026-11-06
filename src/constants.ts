import { readFileSync } from "node:fs";

export const SERVER_NAME = "nekoweb-mcp-server";
export const SERVER_VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

// Overridable so tests can point the server at a mock Nekoweb.
export const API_BASE_URL = (process.env.NEKOWEB_API_BASE_URL ?? "https://nekoweb.org/api").replace(/\/+$/, "");
export const SITE_BASE_URL = (process.env.NEKOWEB_SITE_BASE_URL ?? "https://nekoweb.org").replace(/\/+$/, "");
export const API_KEY = process.env.NEKOWEB_API_KEY?.trim() || undefined;
export const SESSION_TOKEN = process.env.NEKOWEB_SESSION_TOKEN?.trim() || undefined;
export const LOCAL_ROOT = process.env.NEKOWEB_LOCAL_ROOT || undefined;

export const CHARACTER_LIMIT = 25_000;
// Nekoweb rejects upload requests over 100MB; bigger files go through the chunked big-file API.
export const MAX_SIMPLE_UPLOAD_BYTES = 95 * 1024 * 1024;
export const BIG_UPLOAD_CHUNK_BYTES = 50 * 1024 * 1024;
export const MAX_READ_BYTES = 20 * 1024 * 1024;
export const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;
// Every folder read counts against the rate limit.
export const MAX_RECURSIVE_FOLDER_REQUESTS = 25;

export const REQUEST_TIMEOUT_MS = 60_000;
export const UPLOAD_TIMEOUT_MS = 10 * 60_000;
