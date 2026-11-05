import { McpServer } from "@modelcontextprotocol/server";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { registerFileTools } from "./tools/files.js";
import { registerSiteTools } from "./tools/site.js";
import { registerUploadTools } from "./tools/uploads.js";

const INSTRUCTIONS = `Tools for managing a static website hosted on Nekoweb (nekoweb.org).
Paths are absolute from the account's file root. Each site's files are usually in a folder named after it, e.g. "/mysite.nekoweb.org/index.html"; nekoweb_list_sites shows each site's folder and nekoweb_list_folder at "/" shows the layout.
Typical workflow: nekoweb_list_sites to find the folder, nekoweb_list_folder to explore, nekoweb_read_file to read, nekoweb_write_file to change text files, nekoweb_upload_file for binaries.
File operations share a rate limit; check nekoweb_get_limits before bulk work.`;

export function createServer(): McpServer {
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
    registerSiteTools(server);
    registerFileTools(server);
    registerUploadTools(server);
    return server;
}
