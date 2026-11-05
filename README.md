[![npm](https://img.shields.io/npm/v/nekoweb-mcp-server?style=flat-square)](https://www.npmjs.com/package/nekoweb-mcp-server) [![License](https://img.shields.io/badge/license-Apache_2.0-blue?style=flat-square)](LICENSE)

# Nekoweb MCP Server

## Installation

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square)](https://insiders.vscode.dev/redirect/mcp/install?name=nekoweb&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22nekoweb_api_key%22%2C%22description%22%3A%22Nekoweb%20API%20key%20%28from%20https%3A%2F%2Fnekoweb.org%2Fapi%29%22%2C%22password%22%3Atrue%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22nekoweb-mcp-server%22%5D%2C%22env%22%3A%7B%22NEKOWEB_API_KEY%22%3A%22%24%7Binput%3Anekoweb_api_key%7D%22%7D%7D) [![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_Server-24bfa5?style=flat-square)](https://insiders.vscode.dev/redirect/mcp/install?name=nekoweb&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22nekoweb_api_key%22%2C%22description%22%3A%22Nekoweb%20API%20key%20%28from%20https%3A%2F%2Fnekoweb.org%2Fapi%29%22%2C%22password%22%3Atrue%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22nekoweb-mcp-server%22%5D%2C%22env%22%3A%7B%22NEKOWEB_API_KEY%22%3A%22%24%7Binput%3Anekoweb_api_key%7D%22%7D%7D&quality=insiders) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/en/install-mcp?name=nekoweb&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIm5la293ZWItbWNwLXNlcnZlciJdLCJlbnYiOnsiTkVLT1dFQl9BUElfS0VZIjoieW91ci1hcGkta2V5In19) [![Download for Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Download_Extension-D97757?style=flat-square&logo=claude&logoColor=white)](https://github.com/Menal226/nekoweb-mcp-server/releases/latest/download/nekoweb-mcp-server.mcpb)

### Prerequisites

1. [Node.js](https://nodejs.org) 20.3 or newer. The Claude Desktop extension doesn't need it, because Claude Desktop includes its own.
2. **A Nekoweb API key.** Log in to Nekoweb, open <https://nekoweb.org/api> and generate a key. The key gives full access to your site's files, so keep it private.

<details><summary><b>Keeping your API key safe</b></summary>

- **Don't commit it.** If your MCP config lives in a project (e.g. `.vscode/mcp.json`), use your client's secret prompt, like the VS Code button above does, instead of pasting the key into the file.
- **Regenerate it if it leaks.** Generating a new key at <https://nekoweb.org/api> makes the old one stop working.
- **Limit local uploads.** Set `NEKOWEB_LOCAL_ROOT` to your site project's folder so the assistant can only upload files from there. See [Configuration](#configuration).

</details>

### Claude Code

```bash
claude mcp add nekoweb -e NEKOWEB_API_KEY=your-api-key -- npx -y nekoweb-mcp-server
```

### Claude Desktop

Download [nekoweb-mcp-server.mcpb](https://github.com/Menal226/nekoweb-mcp-server/releases/latest/download/nekoweb-mcp-server.mcpb) and open it. Claude Desktop shows an install screen that asks for your API key.

<details><summary>Or add it to the config file</summary>

Open **Settings → Developer → Edit Config**, add the server to `claude_desktop_config.json`, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "nekoweb": {
      "command": "npx",
      "args": ["-y", "nekoweb-mcp-server"],
      "env": { "NEKOWEB_API_KEY": "your-api-key" }
    }
  }
}
```

</details>

### VS Code

Use the install button above. VS Code asks for your API key when the server first starts. Or add this to `.vscode/mcp.json` or your user MCP configuration:

```json
{
  "inputs": [
    { "type": "promptString", "id": "nekoweb_api_key", "description": "Nekoweb API key", "password": true }
  ],
  "servers": {
    "nekoweb": {
      "command": "npx",
      "args": ["-y", "nekoweb-mcp-server"],
      "env": { "NEKOWEB_API_KEY": "${input:nekoweb_api_key}" }
    }
  }
}
```

### Cursor

Use the install button above, then replace `your-api-key` with your key. Or add this to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "nekoweb": {
      "command": "npx",
      "args": ["-y", "nekoweb-mcp-server"],
      "env": { "NEKOWEB_API_KEY": "your-api-key" }
    }
  }
}
```

### Other MCP hosts

Any host that supports local (stdio) MCP servers works. Configure it to run `npx -y nekoweb-mcp-server` with the `NEKOWEB_API_KEY` environment variable set. Most hosts use the same JSON format as the Claude Desktop and Cursor examples above.

### Build from source

Clone this repository and run `npm install` and `npm run build`. Then use `node /path/to/nekoweb-mcp-server/build/index.js` as the command in your host's config instead of `npx -y nekoweb-mcp-server`.

### Check that it works

Ask your assistant: *"What's on my Nekoweb site?"* It should list your site's files.

---

## Configuration

| Environment variable | Required | Description |
|---|---|---|
| `NEKOWEB_API_KEY` | Yes | Your API key from <https://nekoweb.org/api>. Without it, only public site lookups work. |
| `NEKOWEB_LOCAL_ROOT` | No | A folder on your computer. When set, the upload tools can only read files inside it. When unset, any file you name can be uploaded. |

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

### Paths

Paths start at your account's file root, not at your site. Each site's files are in a folder named after its domain, so your homepage is `/yourname.nekoweb.org/index.html`, not `/index.html`. You don't need to remember this: the assistant finds the folder with `nekoweb_list_sites`.

## Good to know

- **Rate limits.** Nekoweb limits how many API requests you can make in a short time, with stricter limits for big uploads and zip imports. When you hit one, the tool says when it resets.
- **Deletes are permanent.** Nekoweb has no trash.
- **Uploads overwrite.** Uploading a file or a zip replaces files with the same name without asking.
- **Whole-file writes.** `nekoweb_write_file` replaces the entire file, so the assistant reads the file first and sends back the complete new version.

## Troubleshooting

| Message | Fix |
|---|---|
| "No Nekoweb API key configured" | `NEKOWEB_API_KEY` isn't set. Add it to your MCP config and restart your client. |
| "redirected the request to its login page … missing or invalid" | The API key is wrong or was regenerated. Create a new one at <https://nekoweb.org/api>. |
| "Rate limit exceeded" | Wait until the reset time in the message, then try again. |
| "File does not exist" | The path is probably missing your site's folder, e.g. `/yourname.nekoweb.org/`. Ask the assistant to list your sites first. |
| The tools don't appear | Restart your client and check that Node.js 20.3 or newer is installed (`node --version`). |

Found a bug or want a feature? [Open an issue](https://github.com/Menal226/nekoweb-mcp-server/issues).

## License

This project is licensed under the [Apache 2.0](LICENSE) license.
