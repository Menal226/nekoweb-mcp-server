#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { API_KEY, SERVER_NAME } from "./constants.js";
import { createServer } from "./server.js";

// stdout carries the protocol, so all logging goes to stderr.
if (!API_KEY) console.error(`[${SERVER_NAME}] NEKOWEB_API_KEY is not set; only public site lookups will work.`);
serveStdio(createServer, { onerror: error => console.error(`[${SERVER_NAME}]`, error) });
console.error(`${SERVER_NAME} running on stdio`);
