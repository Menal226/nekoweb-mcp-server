[![npm](https://img.shields.io/npm/v/nekoweb-mcp-server?style=flat-square)](https://www.npmjs.com/package/nekoweb-mcp-server) [![License](https://img.shields.io/badge/license-Apache_2.0-blue?style=flat-square)](LICENSE)

# Nekoweb MCP Server

## Installation

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square)](<https://insiders.vscode.dev/redirect/mcp/install?name=nekoweb&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22nekoweb_api_key%22%2C%22description%22%3A%22Nekoweb%20API%20key%20(from%20https%3A%2F%2Fnekoweb.org%2Fapi)%22%2C%22password%22%3Atrue%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22nekoweb_session_token%22%2C%22description%22%3A%22Optional%3A%20Nekoweb%20session%20token%20(the%20token%20cookie%20from%20nekoweb.org).%20Leave%20empty%20to%20skip%22%2C%22password%22%3Atrue%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22nekoweb-mcp-server%22%5D%2C%22env%22%3A%7B%22NEKOWEB_API_KEY%22%3A%22%24%7Binput%3Anekoweb_api_key%7D%22%2C%22NEKOWEB_SESSION_TOKEN%22%3A%22%24%7Binput%3Anekoweb_session_token%7D%22%7D%7D>) [![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_Server-24bfa5?style=flat-square)](<https://insiders.vscode.dev/redirect/mcp/install?name=nekoweb&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22nekoweb_api_key%22%2C%22description%22%3A%22Nekoweb%20API%20key%20(from%20https%3A%2F%2Fnekoweb.org%2Fapi)%22%2C%22password%22%3Atrue%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22nekoweb_session_token%22%2C%22description%22%3A%22Optional%3A%20Nekoweb%20session%20token%20(the%20token%20cookie%20from%20nekoweb.org).%20Leave%20empty%20to%20skip%22%2C%22password%22%3Atrue%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22nekoweb-mcp-server%22%5D%2C%22env%22%3A%7B%22NEKOWEB_API_KEY%22%3A%22%24%7Binput%3Anekoweb_api_key%7D%22%2C%22NEKOWEB_SESSION_TOKEN%22%3A%22%24%7Binput%3Anekoweb_session_token%7D%22%7D%7D&quality=insiders>) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/en/install-mcp?name=nekoweb&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIm5la293ZWItbWNwLXNlcnZlciJdLCJlbnYiOnsiTkVLT1dFQl9BUElfS0VZIjoieW91ci1hcGkta2V5IiwiTkVLT1dFQl9TRVNTSU9OX1RPS0VOIjoieW91ci1zZXNzaW9uLXRva2VuIn19) [![Download for Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Download_Extension-D97757?style=flat-square&logo=claude&logoColor=white)](https://github.com/Menal226/nekoweb-mcp-server/releases/latest/download/nekoweb-mcp-server.mcpb)

### Prerequisites

1. [Node.js](https://nodejs.org) 20.3 or newer. The Claude Desktop extension doesn't need it, because Claude Desktop includes its own.
2. **A Nekoweb API key** (required). Log in to Nekoweb, open <https://nekoweb.org/api> and generate a key. The key gives full access to your site's files, so keep it private.
3. **A Nekoweb session token** (optional). Without it, everything in Nekoweb's official API works: your files, uploads, site info and limits. With it, you also get site settings, tags, stats history, followers, your feed, following sites and search results that show who you follow. See [Getting your session token](#getting-your-session-token).

#### Getting your session token

The session token is the login cookie your browser uses on nekoweb.org. The server uses it to read and change things that aren't in the official API.

1. Log in at <https://nekoweb.org> in your browser.
2. Open the developer tools (F12) and go to **Application → Cookies** (Chrome, Edge) or **Storage → Cookies** (Firefox), then pick `https://nekoweb.org`.
3. Copy the value of the cookie named `token`.
4. Put it in your MCP config as `NEKOWEB_SESSION_TOKEN`, as in the examples below, and restart your client.

> [!WARNING]
> The session token is more powerful than the API key: it can do anything you can do while logged in, including changing your account settings. Keep it private, and never paste it into a chat with your assistant. It stops working when the session ends, for example when you log out, and then you need to copy a new one.

<details><summary><b>Keeping your API key and session token safe</b></summary>

- **Don't commit them.** If your MCP config lives in a project (e.g. `.vscode/mcp.json`), use your client's secret prompt, like the VS Code button above does, instead of pasting them into the file.
- **Regenerate the key if it leaks.** Generating a new key at <https://nekoweb.org/api> makes the old one stop working. For a leaked session token, log out of nekoweb.org to end that session.
- **Limit local uploads.** Set `NEKOWEB_LOCAL_ROOT` to your site project's folder so the assistant can only upload files from there. See [Configuration](#configuration).

</details>

The examples below include both the API key and the session token. If you don't want the session token, leave it out: each client has an **API key only** version.

### Claude Code

```bash
claude mcp add nekoweb -e NEKOWEB_API_KEY=your-api-key -e NEKOWEB_SESSION_TOKEN=your-session-token -- npx -y nekoweb-mcp-server
```

<details><summary>API key only</summary>

```bash
claude mcp add nekoweb -e NEKOWEB_API_KEY=your-api-key -- npx -y nekoweb-mcp-server
```

</details>

### Claude Desktop

Download [nekoweb-mcp-server.mcpb](https://github.com/Menal226/nekoweb-mcp-server/releases/latest/download/nekoweb-mcp-server.mcpb) and open it. Claude Desktop shows an install screen that asks for your API key and, optionally, your session token. Leave the session token empty to skip it.

<details><summary>Or add it to the config file</summary>

Open **Settings → Developer → Edit Config**, add the server to `claude_desktop_config.json`, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "nekoweb": {
      "command": "npx",
      "args": ["-y", "nekoweb-mcp-server"],
      "env": {
        "NEKOWEB_API_KEY": "your-api-key",
        "NEKOWEB_SESSION_TOKEN": "your-session-token"
      }
    }
  }
}
```

For the API key only, remove the `NEKOWEB_SESSION_TOKEN` line (and the comma before it).

</details>

### VS Code

Use the install button above. VS Code asks for your API key and session token when the server first starts; leave the session token empty to skip it. Or add this to `.vscode/mcp.json` or your user MCP configuration:

```json
{
  "inputs": [
    { "type": "promptString", "id": "nekoweb_api_key", "description": "Nekoweb API key", "password": true },
    {
      "type": "promptString",
      "id": "nekoweb_session_token",
      "description": "Optional: Nekoweb session token. Leave empty to skip",
      "password": true
    }
  ],
  "servers": {
    "nekoweb": {
      "command": "npx",
      "args": ["-y", "nekoweb-mcp-server"],
      "env": {
        "NEKOWEB_API_KEY": "${input:nekoweb_api_key}",
        "NEKOWEB_SESSION_TOKEN": "${input:nekoweb_session_token}"
      }
    }
  }
}
```

For the API key only, remove the `nekoweb_session_token` input and the `NEKOWEB_SESSION_TOKEN` line.

### Cursor

Use the install button above, then replace `your-api-key` and `your-session-token` with yours, or delete the `NEKOWEB_SESSION_TOKEN` line to use the API key only. Or add this to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "nekoweb": {
      "command": "npx",
      "args": ["-y", "nekoweb-mcp-server"],
      "env": {
        "NEKOWEB_API_KEY": "your-api-key",
        "NEKOWEB_SESSION_TOKEN": "your-session-token"
      }
    }
  }
}
```

For the API key only, remove the `NEKOWEB_SESSION_TOKEN` line (and the comma before it).

### Other MCP hosts

Any host that supports local (stdio) MCP servers works. Configure it to run `npx -y nekoweb-mcp-server` with the `NEKOWEB_API_KEY` environment variable set, and optionally `NEKOWEB_SESSION_TOKEN`. Most hosts use the same JSON format as the Claude Desktop and Cursor examples above.

### Build from source

Clone this repository and run `npm install` and `npm run build`. Then use `node /path/to/nekoweb-mcp-server/build/index.js` as the command in your host's config instead of `npx -y nekoweb-mcp-server`.

### Check that it works

Ask your assistant: _"What's on my Nekoweb site?"_ It should list your site's files.

---

## Configuration

| Environment variable    | Required | Description                                                                                                                                                                                              |
| ----------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEKOWEB_API_KEY`       | Yes      | Your API key from <https://nekoweb.org/api>. Without it, only public site lookups work.                                                                                                                  |
| `NEKOWEB_LOCAL_ROOT`    | No       | A folder on your computer. When set, the upload tools can only read files inside it. When unset, any file you name can be uploaded.                                                                      |
| `NEKOWEB_SESSION_TOKEN` | No       | Your Nekoweb login session, for features the official API doesn't have, like site settings, tags, stats history, followers and your feed. See [Getting your session token](#getting-your-session-token). |

See [Getting your session token](#getting-your-session-token) for how to get the session token.

## Tools

Tools marked read-only never change your site. The others change files, so most clients ask for your approval before running them.

<details>

<summary><b>Site</b></summary>

- **nekoweb_get_site_info** - Get a site's title, domain, views, followers, update count and dates (read-only)
  - `site`: Domain of another public site, e.g. `yoursite.nekoweb.org`. Omit for your own site (string, optional)
  - `response_format`: `markdown` (default) or `json` (string, optional)

- **nekoweb_list_sites** - List every site on your account, with its stats and the folder that holds its files (read-only)
  - `response_format`: `markdown` (default) or `json` (string, optional)

- **nekoweb_get_limits** - Show how many API requests you have left and when each limit resets (read-only)
  - `response_format`: `markdown` (default) or `json` (string, optional)

</details>

<details>

<summary><b>Files</b></summary>

- **nekoweb_list_folder** - List the files and folders in a folder (read-only)
  - `path`: Folder to list, e.g. `/mysite.nekoweb.org/blog`. Defaults to `/` (string, optional)
  - `recursive`: Also list subfolders. Each subfolder uses one API request, up to 25 per call (boolean, optional)
  - `max_depth`: How many levels of subfolders to list, 1–10, default 3 (number, optional)
  - `limit`: Maximum entries to return, 1–500, default 100 (number, optional)
  - `offset`: Entries to skip, for paging through large folders (number, optional)
  - `response_format`: `markdown` (default) or `json` (string, optional)

- **nekoweb_read_file** - Read a file's source exactly as stored, SSI directives included. Images up to 5 MB are shown as images (read-only)
  - `path`: File to read, e.g. `/mysite.nekoweb.org/index.html` (string, required)
  - `offset`: Character to start reading from, for long files (number, optional)
  - `max_chars`: Maximum characters to return, default 20,000 (number, optional)

- **nekoweb_write_file** - Create a text file or replace its whole content
  - `path`: File to write, e.g. `/mysite.nekoweb.org/index.html` (string, required)
  - `content`: The complete new content of the file (string, required)
  - `mode`: `create_or_overwrite` (default) writes the file whether or not it exists; `edit_existing` fails if it doesn't (string, optional)

- **nekoweb_create** - Create an empty file or a new folder
  - `path`: Path to create, e.g. `/mysite.nekoweb.org/blog` (string, required)
  - `is_folder`: `true` for a folder, `false` for an empty file (boolean, required)

- **nekoweb_move** - Rename or move a file or folder
  - `from`: Current path (string, required)
  - `to`: New path. Its parent folder must exist (string, required)

- **nekoweb_delete** - Permanently delete a file or folder, including everything inside it
  - `path`: Path to delete (string, required)

</details>

<details>

<summary><b>Uploads</b></summary>

- **nekoweb_upload_file** - Upload files of any type into a folder, replacing files with the same name. Files over 95 MB are uploaded in chunks automatically
  - `folder`: Destination folder, e.g. `/mysite.nekoweb.org/images`. It must already exist (string, optional)
  - `local_paths`: Full paths of files on your computer (string[], optional)
  - `files`: Files given as base64, each with a `name` and `content_base64` (object[], optional)

- **nekoweb_import_zip** - Upload a `.zip` and extract it into a folder, replacing files with the same paths
  - `folder`: Folder to extract into, e.g. `/mysite.nekoweb.org` (string, optional)
  - `zip_local_path`: Full path of a `.zip` on your computer (string, optional)
  - `zip_base64`: The `.zip` as base64, if not using `zip_local_path` (string, optional)

</details>

<details>

<summary><b>Settings</b> (needs <code>NEKOWEB_SESSION_TOKEN</code>)</summary>

- **nekoweb_get_site_settings** - Show the folder a site serves and its options: main site, nice links, strict slashes, listed in Explore, posts in the global feed, HTTP access and NSFW (read-only)
  - `site`: Domain of one of your sites, e.g. `mysite.nekoweb.org`. Omit for the site the API key belongs to (string, optional)
  - `response_format`: `markdown` (default) or `json` (string, optional)

- **nekoweb_update_site_settings** - Change some of a site's settings; the ones you leave out stay as they are. Turning nice links off or changing the folder can break links to your site
  - `site`: Domain of one of your sites. Omit for the site the API key belongs to (string, optional)
  - `main`, `nice_links`, `strict_slash`, `visible`, `show_in_global_feed`, `support_http`, `nsfw`: Turn an option on or off (boolean, optional)
  - `folder`: Folder the site serves its files from, e.g. `/mysite.nekoweb.org`. It must exist (string, optional)

- **nekoweb_get_tags** - List the tags on one of your sites, and how many of the allowed tags it uses (read-only)
  - `site`: Domain of one of your sites, e.g. `mysite.nekoweb.org`. Omit for the site the API key belongs to (string, optional)
  - `response_format`: `markdown` (default) or `json` (string, optional)

- **nekoweb_add_tag** - Add a tag to one of your sites. Sites can have up to 10 tags
  - `site`: Domain of one of your sites. Omit for the site the API key belongs to (string, optional)
  - `tag`: The tag, 2 to 32 characters, e.g. `pixel-art` (string, required)

- **nekoweb_remove_tag** - Remove a tag from one of your sites
  - `site`: Domain of one of your sites. Omit for the site the API key belongs to (string, optional)
  - `tag`: The tag to remove (string, required)

- **nekoweb_get_stats_history** - Get the day-by-day history of a site's views, followers and updates, like the charts on its statistics page (read-only)
  - `site`: Domain of one of your sites. Omit for the site the API key belongs to (string, optional)
  - `period`: `month` (default), `year` or `all`. Nekoweb only shows `year` and `all` on paid tiers (string, optional)
  - `response_format`: `markdown` (default) or `json` (string, optional)

- **nekoweb_list_followers** - List the sites that follow one of your sites, with each one's title, link, screenshot and whether you follow it back (read-only)
  - `site`: Domain of one of your sites. Omit for the site the API key belongs to (string, optional)
  - `sort`: `follow_date` (default), `recently_updated` or `most_followed` (string, optional)
  - `page`: Fetch only this page. Omit to fetch every page, up to 20 (number, optional)
  - `response_format`: `markdown` (default) or `json` (string, optional)

</details>

<details>

<summary><b>Social</b> (news, the global feed and search need no key or token, the rest need <code>NEKOWEB_SESSION_TOKEN</code>)</summary>

- **nekoweb_search_sites** - Search the sites on Nekoweb's Explore page by name or tag. With the session token, results also say which sites you follow (read-only)
  - `query`: Text to search for. Name searches match part of the domain, tag searches need the exact tag. Omit to browse all sites (string, optional)
  - `by`: `name` (default) or `tag` (string, optional)
  - `sort`: `most_viewed` (default), `most_followed`, `least_viewed`, `recently_updated`, `newest` or `oldest` (string, optional)
  - `page`: Page of results, about 50 sites each, default 1 (number, optional)
  - `response_format`: `markdown` (default) or `json` (string, optional)

- **nekoweb_get_news** - Get the latest announcements from nekoweb.org's news page, newest first (read-only)
  - `limit`: How many posts to return, 1 to 100, default 5 (number, optional)
  - `response_format`: `markdown` (default) or `json` (string, optional)

- **nekoweb_get_global_feed** - Get the newest posts from all Nekoweb sites, from the global RSS feed (read-only)
  - `limit`: How many posts to return, 1 to 50, default 20 (number, optional)
  - `response_format`: `markdown` (default) or `json` (string, optional)

- **nekoweb_get_feed** - Get the latest posts from the sites you follow, as shown on your feed (read-only, needs the session token)
  - `page`: Page of the feed, newest first, default 1 (number, optional)
  - `response_format`: `markdown` (default) or `json` (string, optional)

- **nekoweb_list_following** - List the sites you follow, grouped by the day each was last updated. Nekoweb leaves out sites their owners hid from Explore (read-only, needs the session token)
  - `page`: Fetch only this page. Omit to fetch every page, up to 20 (number, optional)
  - `response_format`: `markdown` (default) or `json` (string, optional)

- **nekoweb_follow_site** - Follow or unfollow a site. Checks first, so it only changes something when needed (needs the session token)
  - `site`: Domain of the site, e.g. `fairfruit.nekoweb.org` (string, required)
  - `follow`: `true` to follow (default), `false` to unfollow (boolean, optional)

</details>

### Paths

Paths start at your account's file root, not at your site. Each site's files are in a folder named after its domain, so your homepage is `/yourname.nekoweb.org/index.html`, not `/index.html`. You don't need to remember this: the assistant finds the folder with `nekoweb_list_sites`.

## Good to know

- **Rate limits.** Nekoweb limits how many API requests you can make in a short time, with stricter limits for big uploads and zip imports. When you hit one, the tool says when it resets.
- **Deletes are permanent.** Nekoweb has no trash.
- **Uploads overwrite.** Uploading a file or a zip replaces files with the same name without asking.
- **Whole-file writes.** `nekoweb_write_file` replaces the entire file, so the assistant reads the file first and sends back the complete new version.

## Troubleshooting

| Message                                                         | Fix                                                                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| "No Nekoweb API key configured"                                 | `NEKOWEB_API_KEY` isn't set. Add it to your MCP config and restart your client.                                             |
| "redirected the request to its login page … missing or invalid" | The API key is wrong or was regenerated. Create a new one at <https://nekoweb.org/api>.                                     |
| "No Nekoweb session token configured"                           | The tool needs `NEKOWEB_SESSION_TOKEN`. See [Getting your session token](#getting-your-session-token).                      |
| "Nekoweb rejected the session"                                  | Your login session ended. Log in to nekoweb.org again and copy the new `token` cookie.                                      |
| "Rate limit exceeded"                                           | Wait until the reset time in the message, then try again.                                                                   |
| "File does not exist"                                           | The path is probably missing your site's folder, e.g. `/yourname.nekoweb.org/`. Ask the assistant to list your sites first. |
| The tools don't appear                                          | Restart your client and check that Node.js 20.3 or newer is installed (`node --version`).                                   |

Found a bug or want a feature? [Open an issue](https://github.com/Menal226/nekoweb-mcp-server/issues).

## License

This project is licensed under the [Apache 2.0](LICENSE) license.
