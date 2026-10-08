---
layout: product
title: "Connect tools to the workspace on your computer"
description: "Connect Codex, Claude Code, Cursor or Gemini CLI through Visual Nerve's standard local MCP bridge and explicit browser permissions."
eyebrow: "Local MCP integration"
summary: "External tools can inspect and control the same diagram you edit, with access you explicitly grant."
---

[Open the workspace](/app/) · [Detailed setup guide](/help/api-mcp/) · [API reference](/api/docs/)

Visual Nerve uses the **Model Context Protocol**, rather than a vendor-specific agent integration. Codex, Claude Code, Cursor, Gemini CLI and other compatible local clients discover the same tools, documentation and semantic workspace model. Choosing a different client does not create a separate diagram or simulation engine.

## The website and the MCP service have different jobs

The website delivers the application files. Your browser stores the workspace. The optional Go bridge is a separate process running on your own computer; JavaScript can connect to it but does not install or start it.

```text
MCP client → local bridge → open Visual Nerve browser → IndexedDB
```

The bridge forwards commands to the browser. It has no independent workspace database and no second simulation engine. The UI, REST API and MCP use the same validated model and local persistence.

| Address                         | Role                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------- |
| The Visual Nerve website origin | Where the app was loaded; the exact origin trusted by the bridge.            |
| `ws://127.0.0.1:4317/bridge`    | Browser connection to a local service, with `wss` available for trusted TLS. |
| `http://127.0.0.1:4317/mcp`     | Streamable HTTP MCP endpoint for a local client, or HTTPS with trusted TLS.  |
| `http://127.0.0.1:4317/api/v1`  | REST commands to that same local service.                                    |

`127.0.0.1` means the computer making the connection. It does not become a public server because the website is public. A phone's loopback address does not point to a laptop.

![Integration settings with distinct website, MCP server and local WebSocket addresses.](/help/images/mcp-settings.webp "The website identifies the application origin; the local addresses connect software on this computer.")

## Start a bridge and grant access

With a built source checkout, start the local executable:

```sh
./bin/visual-nerve --static ./public --bridge --addr 127.0.0.1:4317
```

Open its local `/app/` page, accept required local storage, then open **Settings → MCP / API integration**. Choose an access level and check that the connection is Connected.

When using a separately hosted app, add its exact **origin** with `--allowed-origin`. An origin consists of the scheme, host and port; it excludes `/app/` and other paths. Copy the current Visual Nerve website origin from Settings instead of assuming that a previous hostname still applies.

For the public workspace at `https://www.visualnerve.com/app/`, start the bridge with:

```sh
./bin/visual-nerve --static ./public --bridge \
  --addr 127.0.0.1:4317 \
  --allowed-origin https://www.visualnerve.com
```

For the separate **staging** workspace at `https://visualnerve.caripson.com/app/`, replace the final argument with `--allowed-origin https://visualnerve.caripson.com`. Staging and production have separate browser workspaces.

Use your actual app origin in that final argument. Browser local-network rules can require permission or trusted local TLS. The bridge supports `--tls-cert` and `--tls-key`; configure matching `wss`/HTTPS addresses when required. The bridge remains loopback-only.

The dedicated encrypted app at `app.visualnerve.com` is under release review. When using that surface, allow `https://app.visualnerve.com` instead, unlock in the browser and grant access there. It does not share the old website's browser storage; [transfer the existing workspace explicitly](/help/settings/#transfer-an-existing-workspace).

## Choose your local MCP client

Start the bridge first. Configure the client with its local **HTTP(S) `/mcp` address**, using the same hostname, port and TLS choice as the browser's saved connection. The browser's WebSocket `/bridge` address is not an MCP client endpoint.

The default **4317** listener serves MCP, the browser connection and REST together. If another plugin already uses it, select an available port with `--addr 127.0.0.1:4318`, then update the app's saved `/bridge` URL and the client's `/mcp` URL to 4318. A stdio adapter targets that listener with `--mcp-url http://127.0.0.1:4318/mcp`. Ports are not guaranteed to be free, and the bridge does not switch ports automatically. [Choose a dedicated local port](/help/api-mcp/#choose-a-dedicated-local-port).

| Client         | Local connection example                                                   |
| -------------- | -------------------------------------------------------------------------- |
| Codex          | [HTTP command and TOML settings](/help/api-mcp/#codex)                     |
| Claude Code    | [HTTP command](/help/api-mcp/#claude-code)                                 |
| Cursor         | [Local IDE `mcp.json`](/help/api-mcp/#cursor)                              |
| Gemini CLI     | [HTTP command and `settings.json`](/help/api-mcp/#gemini-cli)              |
| Claude Desktop | [Local stdio adapter, under release review](/help/api-mcp/#claude-desktop) |

These examples follow each client's official configuration documentation. They are not a claim that every installed version or vendor interface has been tested. A cloud agent runs on a different computer and cannot reach your laptop through its own `127.0.0.1`. **Gemini CLI** is the local command-line client; these instructions do not describe the Gemini website.

The release under review also offers `visual-nerve --mcp-stdio` for a client that launches local stdio processes. It forwards to the same existing loopback HTTP bridge; it does not start another browser service or create a vendor-specific implementation. Stop that adapter without stopping the shared bridge. The browser's `/bridge` WebSocket and older SSE transports are not MCP alternatives exposed by this server.

On the isolated encrypted app, the deployed Content Security Policy also restricts browser bridge connections to explicitly approved ports. A custom port must be included in that app build and its response-header policy; changing Settings alone cannot override it. The reviewed default is 4317.

## Choose what a connected tool may do

| Access       | Capabilities                                                                               |
| ------------ | ------------------------------------------------------------------------------------------ |
| Off          | Default. The browser does not expose workspace commands.                                   |
| Read only    | Inspect data and use supported exact unsaved previews, exports, questions and comparisons. |
| Read + write | Additionally create/edit diagrams and control presentations or simulation runs.            |

Turn access Off to disconnect. Tokens and grants are not imported from backups. If the executable uses `VISUAL_NERVE_BRIDGE_TOKEN`, enter the same token for the browser session and configure the client's authorization header. Keep it out of copied prompts and issue reports.

On the encrypted app, every client needs the same human unlock and a fresh Settings grant. Unlock does not reactivate a prior grant, and agent requests do not extend session time. An already-authorized live connection may retain safe control status while locked; content returns **423 `WORKSPACE_LOCKED`**. A cold locked page does not connect, and a lost connection remains **503**. Explicit Off closes the transport. No client can submit a workspace password, recovery key or programmatic unlock. [Exact lock and access behavior](/help/api-mcp/#discover-security-state-safely).

Tools receive the content returned by their authorized requests. Their own hosting, logging and AI settings govern what they do with that content afterward. A local bridge does not make a remote AI client private.

## Let the client discover the contract

The bridge exposes standard MCP tools and resources through JSON-RPC 2.0. Your client handles initialization and discovery; the browser applies the same permissions and validation regardless of the client vendor.

Ask it to call **visual_nerve_api_docs** first:

```json
{ "document": "guide" }
```

Use `{ "document": "openapi" }` for the complete contract. These bundled documents are discoverable without a browser content grant. Workspace requests need the connected browser and the appropriate access.

Clients can also read the standard MCP resources `visual-nerve://docs/guide` and `visual-nerve://docs/openapi`. They do not need to infer capabilities from screenshots or canvas coordinates.

Then use **visual_nerve_request** for a command:

```json
{ "path": "/diagrams", "method": "GET" }
```

Paths omit `/api/v1`. When distinct workspaces are connected, pass `workspaceId` explicitly. Stable semantic IDs and version checks let the client work with actual diagram content instead of guessing from rendered coordinates.

## Useful requests to give a client

- “Read the API guide, list my diagrams and explain the relationships in this process.” Start with Read only.
- “Preview these source files and show which dependencies are unresolved before creating a diagram.”
- “Create a mind map in 3D using native cards, preserving a readable 2D arrangement.” Creation needs write access.
- “Inspect this simulator's shared resources, run demand multipliers 1.0 to 1.5 with a fixed seed and compare the results.” Execution needs write access.

Presentation controls, source previews, semantic questions and simulation metrics all use the browser's implementation. Headless simulation removes the animation requirement; it does not remove the need for an open, connected browser.

[Connect your local client](/help/api-mcp/) · [Copy API examples](/developers/) · [Review the security boundary](/security/)
