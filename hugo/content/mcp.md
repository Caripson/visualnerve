---
layout: product
title: "Connect tools to the workspace on your computer"
description: "Understand Visual Nerve's optional local MCP bridge, browser permissions, documentation discovery and shared UI/API model."
eyebrow: "Local MCP integration"
summary: "External tools can inspect and control the same diagram you edit, with access you explicitly grant."
---

[Open the workspace](/app/) · [Detailed setup guide](/help/api-mcp/) · [API reference](/api/docs/)

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

Open its local `/app/` page, accept required local storage, then open **Settings → Codex / MCP integration**. Choose an access level and check that the connection is Connected.

When using a separately hosted app, add its exact **origin** with `--allowed-origin`. An origin consists of the scheme, host and port; it excludes `/app/` and other paths. Copy the current Visual Nerve website origin from Settings instead of assuming that a previous hostname still applies.

For example, a bridge for the existing Caripson-hosted origin uses:

```sh
./bin/visual-nerve --static ./public --bridge \
  --addr 127.0.0.1:4317 \
  --allowed-origin https://visualnerve.caripson.com
```

Use your actual app origin in that final argument. Browser local-network rules can require permission or trusted local TLS. The bridge supports `--tls-cert` and `--tls-key`; configure matching `wss`/HTTPS addresses when required. The bridge remains loopback-only.

## Choose what a connected tool may do

| Access       | Capabilities                                                                               |
| ------------ | ------------------------------------------------------------------------------------------ |
| Off          | Default. The browser does not expose workspace commands.                                   |
| Read only    | Inspect data and use supported exact unsaved previews, exports, questions and comparisons. |
| Read + write | Additionally create/edit diagrams and control presentations or simulation runs.            |

Turn access Off to disconnect. Tokens and grants are not imported from backups. If the executable uses `VISUAL_NERVE_BRIDGE_TOKEN`, enter the same token for the browser session and configure the client's authorization header. Keep it out of copied prompts and issue reports.

Tools receive the content returned by their authorized requests. Their own hosting, logging and AI settings govern what they do with that content afterward. A local bridge does not make a remote AI client private.

## Let the client discover the contract

Configure a client that supports Streamable HTTP with the displayed MCP server URL. Codex and Claude-based clients can use the same protocol when their installed client supports the necessary local connection and authorization configuration. Client setup varies; use its own documentation for those settings.

Ask it to call **visual_nerve_api_docs** first:

```json
{ "document": "guide" }
```

Use `{ "document": "openapi" }` for the complete contract. These bundled documents are discoverable without a browser content grant. Workspace requests need the connected browser and the appropriate access.

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
