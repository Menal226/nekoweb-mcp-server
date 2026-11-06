import { McpServer } from "@modelcontextprotocol/server";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { registerFileTools } from "./tools/files.js";
import { registerFollowerTools } from "./tools/followers.js";
import { registerSettingsTools } from "./tools/settings.js";
import { registerSiteTools } from "./tools/site.js";
import { registerSocialTools } from "./tools/social.js";
import { registerStatsTools } from "./tools/stats.js";
import { registerUploadTools } from "./tools/uploads.js";

const INSTRUCTIONS = `Tools for managing a static website hosted on Nekoweb (nekoweb.org).
Paths are absolute from the account's file root. Each site's files are usually in a folder named after it, e.g. "/mysite.nekoweb.org/index.html"; nekoweb_list_sites shows each site's folder and nekoweb_list_folder at "/" shows the layout.
Typical workflow: nekoweb_list_sites to find the folder, nekoweb_list_folder to explore, nekoweb_read_file to read, nekoweb_write_file to change text files, nekoweb_upload_file for binaries.
File operations share a rate limit; check nekoweb_get_limits before bulk work.
Tools for things the official API lacks (site settings, tags, stats history, followers, followed sites, your feed, following and unfollowing) need the optional login session token (NEKOWEB_SESSION_TOKEN). Never ask the user to paste it into the chat; it goes in the MCP config. nekoweb_get_news, nekoweb_get_global_feed and nekoweb_search_sites need neither the key nor the token.`;

export function createServer(): McpServer {
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
    registerSiteTools(server);
    registerFileTools(server);
    registerUploadTools(server);
    registerSettingsTools(server);
    registerStatsTools(server);
    registerFollowerTools(server);
    registerSocialTools(server);
    return server;
}
