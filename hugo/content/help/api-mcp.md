---
title: "Connect tools through API and MCP"
summary: "Use the optional local bridge to inspect and control the same browser workspace through semantic commands."
weight: 15
---

You can use every normal Visual Nerve workflow through the UI without AI, MCP or a backend. The optional local bridge lets an external client read and edit the same workspace, create diagrams, analyze supplied input, control presentations and run simulations.

The bridge forwards commands to your connected browser. It has no separate diagram database, cloud copy or simulation engine. Browser-owned IndexedDB and the shared validated model remain authoritative. MCP is a standard protocol: Codex, Claude Code, Cursor, Gemini CLI and other compatible local clients share the same tools, resources and permissions.

## Unlocking and tool access are separate permissions

The dedicated encrypted app surface at `https://app.visualnerve.com/` requires a password in the browser before its workspace opens. On the first visit, create the password and keep the recovery key separately. Later visits unlock that browser's local vault. No account, SSO service or mandatory backend performs this step.

Unlocking does not enable MCP or restore a previous tool grant. After each encrypted-session unlock, choose **Read only** or **Read + write** again in Settings. An agent cannot supply a password, use a recovery key, unlock the vault, change its password or change session limits through API/MCP. Never paste those credentials into an agent prompt or tool request.

The encrypted app origin is separate from an existing legacy workspace at `www.visualnerve.com` or a staging origin. An old origin's diagrams do not move or become encrypted automatically. For a complete move, use [Export encrypted transfer and Transfer existing workspace](/help/settings/#transfer-an-existing-workspace); review any readable legacy backup before sharing it. When connecting this app, use its exact `https://app.visualnerve.com` origin in the bridge's `--allowed-origin` argument.

### Discover security state safely

Use the existing **visual_nerve_request** tool:

```json
{ "path": "/workspace/security", "method": "GET" }
```

The corresponding REST route is `GET /api/v1/workspace/security`. It returns safe metadata from the connected browser, including `type: "workspace-security"`, `schemaVersion: 1`, `mode: "encrypted"` or `"legacy"`, and the current session `state`. An encrypted response identifies `vaultSchemaVersion: 1` and `cipher: "AES-256-GCM"`; the logical workspace schema remains independently versioned at 8. It contains no records, vault ID, keys, credentials, expiration timestamps or integration grants, and grants no content access. `uninitialized` describes a session that has not initialized its vault, rather than proving that no vault is saved.

| Situation                                             | Response and next step                                                                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Connected encrypted browser is locked                 | Content requests return **423** with `code: "WORKSPACE_LOCKED"`. Unlock in the browser, check access and submit a fresh request. |
| Browser is disconnected or integration is unavailable | **503** keeps its existing meaning. Open/reconnect the browser; a disconnected bridge cannot determine vault state.              |
| You only need the contract                            | **visual_nerve_api_docs** and documentation resources work without a connected or unlocked browser.                              |

Static bridge `/api/v1/health` reports connectivity, not the browser's lock state. The security-status route still needs a browser connection even though it can safely report a locked state.

The health response's `connected` count includes restricted control connections; it does not confirm permission to read diagrams. After choosing a fresh Settings grant, wait for its encrypted preference to finish saving and check that an allowed read, such as `GET /diagrams`, succeeds before sending writes. During this transition a read can briefly return `403` asking for a fresh grant or `503` while reconnecting. Repeat the safe read to check readiness; do not repeat a write as a connection test.

A connection that was already authorized and open can remain as a **restricted control connection** when the workspace locks. It exposes safe status and returns `423 WORKSPACE_LOCKED` for content. It does not reconnect after a network loss, and a fresh locked page never connects automatically. Explicit Off closes it. After human unlock, the retained connection still has no content or lock permission until a fresh Settings grant.

An authorized tool with **Read + write** can explicitly lock the encrypted workspace through the same request tool:

```json
{ "path": "/workspace/lock", "method": "POST", "data": {} }
```

`POST /api/v1/workspace/lock` accepts only an empty object or no arguments. It waits for pending saves, checks the current grant again, locks the shared vault session and returns safe security metadata. If saving fails, it does not silently discard edits. Calling it on an already-locked retained connection only reports that local locked status; it does not revoke again. A concurrent grant or saved-data change produces **409**, rather than locking from a stale authorization snapshot; the current session remains available. Inspect the saved state and grant before issuing a new request. Read-only access cannot lock an unlocked workspace. No tool can unlock it. If several tabs share a workspace, the local bridge prefers a content-enabled tab and never retries a dispatched write against another tab.

**Session timer** is enabled by default. At startup or in **Settings → Workspace security**, you can turn it off to disable both inactivity and maximum-session expiration. Manual lock, closing/reloading the page and cross-tab revocation still end the unlocked session. Only the human UI can change this choice; there is no API/MCP policy endpoint. When the timer is on, Settings controls inactivity and maximum-session limits. Only human interaction with the app renews inactivity; API/MCP requests, particle animation and background jobs do not keep it unlocked. Locking cancels jobs and invalidates in-flight requests, including requests whose results arrive after a later unlock. Other tabs sharing the vault observe revocation; each tab must obtain its own human-unlocked session. Do not assume that a simulation or export continued after lock.

Encryption protects saved records while locked. An authorized API/MCP request, diagram export or AI handoff releases readable information intentionally. `GET /workspace/export` is a readable semantic backup for authorized tools; the browser's encrypted backup download and its reviewed restore flow are separate actions. Changing the live password does not update downloaded backup files: older copies retain their own password and recovery credentials. [Security and recovery boundaries](/security/).

## Understand the addresses

| Address                                                       | Purpose                                                                     |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `https://app.visualnerve.com/` | Encrypted browser workspace where your diagrams and Settings live |
| `https://app.visualnerve.com` | Exact app origin allowed by your bridge; use it without a path |
| `ws://127.0.0.1:4317/bridge` or trusted `wss://…/bridge`      | Browser-to-local-service WebSocket connection                               |
| `http://127.0.0.1:4317/mcp` or matching `https://…/mcp`       | Local MCP server address for any compatible client                          |
| `http://127.0.0.1:4317/api/v1` or matching `https://…/api/v1` | Local REST API base                                                         |

`127.0.0.1` means the computer where the connecting software runs. It remains local even when the app was downloaded from a public domain. JavaScript opens a connection to the bridge; it does not install or create that native process. A client on another machine does not reach your computer by using its own `127.0.0.1`.

Settings displays the **Visual Nerve website**, API reference and local **MCP server URL** separately. Its saved WebSocket connection determines the matching HTTP(S) MCP address. Use that MCP URL for your client; it is shared across vendors. Do not substitute the public website domain or the browser WebSocket `/bridge` for this service.

![Local connection settings separating the public website, local MCP server, browser WebSocket address and optional token.](/help/images/mcp-settings.webp "The website identifies the app; the local service connects your tools to the open browser workspace.")

## Start the optional process

The bridge is the project's optional Go executable. If you are building from source, the repository's build requires Go 1.26+, Node.js 22.12+, npm and Hugo 0.140+ on Linux, WSL or macOS. Run `./build.sh` to produce `public/` and `bin/visual-nerve`. Once built, the executable and static files do not need the toolchain at runtime.

For the production encrypted workspace, open `https://app.visualnerve.com/` and start the local bridge with its exact allowed origin:

```sh
./bin/visual-nerve --static ./public-app --bridge \
  --addr 127.0.0.1:4317 \
  --allowed-origin https://app.visualnerve.com
```

Unlock in the browser and configure integration access there. The public website's former `/app` path redirects to the app root; `/app` on the isolated app returns 404. The redirect never migrates older origin-bound browser records. Restore an existing backup or encrypted transfer explicitly.

The separate app package is built with `node scripts/build-app-surface.mjs public public-app` after `./build.sh`. A local source-development build may retain its development-only `http://127.0.0.1:4317/app/` test editor. For a separately reviewed preview workspace, copy the exact **Visual Nerve website** value from its Settings into `--allowed-origin`. Preview, local development and production have separate browser storage.

Browser local-network and secure-connection rules vary. If your browser requires secure local WebSockets, start the process with `--tls-cert` and `--tls-key` pointing to a certificate/key trusted by that browser for the chosen loopback hostname, then use `wss://…/bridge` in Settings. The matching MCP/REST addresses use HTTPS. Grant local-network permission if the browser requests it.

The bridge only accepts loopback integration connections. Its allowed-origin must match the website's scheme, hostname and port exactly. A bridge does not become part of the public website when it starts.

On mobile, the normal UI remains usable locally. Integration still needs a compatible bridge/client on the device making that local connection; a phone's loopback address does not automatically refer to a laptop.

### Choose a dedicated local port

Visual Nerve uses **4317** by default. One bridge listener serves the MCP `/mcp` endpoint, the browser WebSocket `/bridge` and the REST `/api/v1` routes. MCP does not need a second listener or a vendor-specific port.

If another plugin or process already uses 4317, choose an available port explicitly. For example, to configure the isolated app connection through 4318, after including that port in its app build and response-header policy:

```sh
./bin/visual-nerve --static ./public-app --bridge \
  --addr 127.0.0.1:4318 \
  --allowed-origin https://app.visualnerve.com
```

Then save `ws://127.0.0.1:4318/bridge` under **Local connection details** in the app, and set your MCP client's URL to `http://127.0.0.1:4318/mcp`. REST requests use `http://127.0.0.1:4318/api/v1`. With trusted local TLS, use the matching `wss` and `https` schemes. Change the port in the client examples below to match your chosen listener.

For the stdio adapter, select the existing listener with `--mcp-url`, rather than the bridge's `--addr` flag. Its client configuration would use these arguments:

```json
["--mcp-stdio", "--mcp-url", "http://127.0.0.1:4318/mcp"]
```

Neither 4317 nor 4318 is guaranteed to be free. If the chosen address is occupied, the bridge reports a bind error; it does not silently switch to a random port. Stop the conflicting process or choose another available port, then update the saved browser connection and client URLs together.

On the isolated encrypted app, the deployed Content Security Policy also restricts browser bridge connections to explicitly approved ports. A custom port must be included in that app build and its response-header policy; changing Settings alone cannot override it. The reviewed default is 4317.

## Enable the browser connection

1. Keep the intended Visual Nerve workspace open and accept local storage.
2. Open **Settings → MCP / API integration**. On mobile, start from **Diagram actions → Settings**.
3. Select **Read only** for inspection, or **Read + write** for editing and run/playback controls.
4. Check **MCP connection: Connected**.
5. If needed, expand **Local connection details**, enter the local WebSocket address and optional token, then choose **Save connection**.
6. Use the displayed **MCP server URL** in your chosen client. Expand **Instructions for your MCP client** and choose **Copy MCP instructions** for a setup note describing the same API and tools for any compatible agent.

Access is **Off** by default. Read only permits GET inspection and supported exact unsaved previews, exports and comparisons. It does not grant general permission to POST or edit. Read + write additionally permits mutations, saving models and controlling simulations/presentations. Turning access Off closes the browser connection.

Access changes and **Save connection** take effect in the open workspace without a page reload. If the local process is unavailable or the browser temporarily blocks a connection, Visual Nerve retries every few seconds while access remains enabled. Start the bridge and grant any requested local-network permission, then watch for **Connected**. If it stays on **Error**, check the exact allowed origin, trusted local certificate and address; an invalid address must be corrected and saved. Turning access Off also cancels connection retries.

If the bridge uses `VISUAL_NERVE_BRIDGE_TOKEN`, the browser's **Integration token** must match it. That token lasts for the browser session and is excluded from backups and copied setup instructions. Configure the client's matching Authorization header through protected local settings or supported environment-variable references. Do not put real tokens in shared configuration files or prompts. Choose the tools you grant access to, since they receive the content you ask them to inspect.

## Configure your MCP client

### Check the bridge and discovered tools

The app, the local bridge executable and your MCP client are three separate programs. Updating the website does not update a bridge binary already running on your computer. Your client's version also does not identify the bridge version.

Before giving an agent workspace commands:

1. Inspect the local `GET /api/v1/health` address shown in the copied instructions. The current bridge reports version **0.6.0**, both MCP tool names, and the capabilities `operations-v1`, `endpoint-docs-v1`, `fork-join-v1`, `async-svg-export-v1` and `exchange-export-v1`. Health contains public transport metadata; it does not read diagrams or unlock the workspace.
2. Reconnect or initialize the MCP client, then inspect its discovered tools. It should show both **visual_nerve_request** and **visual_nerve_api_docs**. A client can retain an old tool list until you reconnect it.
3. Ask the agent to read the compact guide before making commands. For a particular endpoint, it can request a smaller contract containing that operation and every referenced schema:

```json
{
  "name": "visual_nerve_api_docs",
  "arguments": {
    "document": "endpoint",
    "path": "/nodes/{nodeId}",
    "method": "PATCH"
  }
}
```

Use the exact OpenAPI template path, including `{nodeId}` rather than an individual node's UUID. The guide, endpoint contract and full OpenAPI work without a connected browser.

If these tools or capabilities are missing, stop the old bridge, replace or rebuild the executable from the current repository using its [build instructions](https://github.com/Caripson/visualnerve#run-locally), then restart it with your existing port, allowed origin and protected token settings. Reconnect the MCP client and refresh its tool discovery. Re-enable browser access if its grant has ended. **Connected** only confirms the browser transport; it does not prove that the client has current tools. Settings now shows an update reminder when the bridge cannot advertise the current capabilities. The reminder does not prevent normal UI editing.

Older browser tabs and older bridge binaries can still perform one-shot commands, but do not provide the current retry protection. Refresh the app when saved work permits, update the bridge and rediscover the tools before using operation IDs.

### Recover an uncertain write without creating it twice

A transport timeout is not a rollback. A command can take longer than the bridge's response deadline and still commit in IndexedDB. Do not issue the same creation with a new ID simply because you received **504**.

For work that must survive a lost response, reserve its operation ID before sending it:

```json
{ "path": "/operations", "method": "POST", "data": {} }
```

The response contains an opaque `operationId` and `state: "reserved"`. Use that ID as an argument on the subsequent write:

```json
{
  "path": "/diagrams",
  "method": "POST",
  "data": { "name": "Delivery process", "type": "process-simulator" },
  "operationId": "<the reserved operationId>"
}
```

REST callers reserve with `POST /api/v1/operations` and pass the returned ID in the `X-Visual-Nerve-Operation-Id` header. Successful writes keep their normal response body. A write without an explicit ID receives one automatically from the current bridge; REST exposes it in the response header and MCP in `structuredContent.operationId`. Reserving first gives you the ID even if the entire later response is lost.

After **504** with `code: "OPERATION_OUTCOME_UNKNOWN"`, inspect the operation through the same request tool:

```json
{ "path": "/operations/<operationId>", "method": "GET" }
```

| State | Meaning and next step |
| ----- | --------------------- |
| `reserved` | The command has not started in this browser. Send the intended write with this ID. |
| `running` | The command is still being handled. Poll status; do not start a second copy. |
| `succeeded` | The browser handled the command successfully. Inspect its result or reread saved data. |
| `failed` | The browser returned an error. Inspect that response and saved state before preparing a corrected operation. |
| `unknown`, expired or unavailable authority | The retained transport information cannot prove the outcome. Reread saved data and current versions before issuing new work. |

An invalid browser acknowledgment can also produce **502 OPERATION_OUTCOME_UNKNOWN**. `failed` reports a browser command error, without guaranteeing rollback of every multi-phase runtime side effect. This is at-most-once command execution within retained browser/grant scope, not exactly-once transactions across page or bridge lifetimes.

Retrying an identical write with the same ID reuses its in-flight or retained result. Changing the method, path or body under that ID returns **409 OPERATION_CONFLICT**. The bridge binds an operation to one browser tab, origin, workspace and access grant; it never moves an ambiguous write to another tab. Turning MCP Off, locking, reloading, changing the connection or starting a fresh grant can end this protection. A restarted bridge rejects IDs from its previous process. These errors do not prove that an earlier write failed.

This is bounded session protection, not a permanent transaction log. Browser operation records expire after 15 minutes when inactive, are limited to 256 entries and retain up to 8 MiB of response text. Large results or older response bodies may be dropped while their status remains available. If `resultAvailable` is false, read the saved model; never execute the write again just to recover its response. The bridge keeps up to 1,024 routing records in memory, with the same retention period, and stores no request/result bodies or application database. Active operations are not evicted to make room for new ones; new work can receive an explicit limit error. Operation records are absent from backups and are cleared when the browser grant ends.

The following direct HTTP examples connect to an **already running bridge on this computer**. They do not start it, grant browser access or unlock an encrypted workspace. Replace the URL if your saved connection uses a different loopback hostname, port or trusted HTTPS. Merge settings into the client's existing configuration rather than replacing other servers.

These examples follow current official client documentation. They do not claim that every client version, account policy or vendor GUI has been tested. Keep normal tool confirmations enabled. On a remote host or inside a container, loopback identifies that host or container, not automatically the computer running Visual Nerve.

### Codex

Register the HTTP bridge and inspect the configured entry:

```sh
codex mcp add visual-nerve --url http://127.0.0.1:4317/mcp
codex mcp list
```

Alternatively, add or edit its entry in `~/.codex/config.toml`. A longer tool timeout accommodates the project's bounded ZIP scan:

```toml
[mcp_servers.visual-nerve]
url = "http://127.0.0.1:4317/mcp"
tool_timeout_sec = 180
```

The URL selects Streamable HTTP; a command entry selects stdio. Use the configuration for the host running Codex. [Official Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

### Claude Code

Use the local Claude Code CLI, selecting HTTP explicitly:

```sh
claude mcp add --transport http --scope user visual-nerve http://127.0.0.1:4317/mcp
claude mcp get visual-nerve
```

Check `/mcp` in the Claude Code session before asking it to use the tools. [Official Claude Code MCP setup](https://code.claude.com/docs/en/mcp).

### Cursor

For the local Cursor IDE, add this entry to `~/.cursor/mcp.json` or the project's `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "visual-nerve": {
      "url": "http://127.0.0.1:4317/mcp"
    }
  }
}
```

Review the server and tools in Cursor's MCP settings. This URL entry selects the HTTP connection. Launching the bridge with `--bridge` as a command is not a stdio configuration. [Official Cursor MCP configuration](https://cursor.com/docs/mcp).

### Gemini CLI

Use **Gemini CLI**, running locally, with HTTP selected explicitly:

```sh
gemini mcp add --transport http --scope user visual-nerve http://127.0.0.1:4317/mcp
gemini mcp list
```

Alternatively, merge this entry into `~/.gemini/settings.json` or the project's `.gemini/settings.json`:

```json
{
  "mcpServers": {
    "visual-nerve": {
      "httpUrl": "http://127.0.0.1:4317/mcp",
      "timeout": 180000,
      "trust": false
    }
  }
}
```

Use **`httpUrl`**, not `url`: Gemini CLI uses `url` for the older SSE transport. Keep `trust: false` so its tool confirmations remain enabled. Check `/mcp` in the session. This configuration does not add a connector to the Gemini website or a cloud-hosted agent. [Official Gemini CLI MCP configuration](https://geminicli.com/docs/tools/mcp-server/).

### Claude Desktop

Visual Nerve includes a native **stdio adapter** for local clients. It forwards newline-delimited MCP messages to the same already-running HTTP bridge; it does not start a bridge, open a browser, store diagrams or grant access. Start the bridge and enable the browser connection first.

In Claude Desktop's local developer configuration, merge an entry like this into `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "visual-nerve": {
      "command": "/ABSOLUTE/PATH/visual-nerve",
      "args": ["--mcp-stdio"]
    }
  }
}
```

Replace the command with the absolute path to your newly built executable. The usual configuration locations are `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS and `%APPDATA%\Claude\claude_desktop_config.json` on Windows; use a binary for the OS running Desktop and escape Windows backslashes in JSON. Restart Desktop after updating the entry. [Official local MCP configuration guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers), [Claude Desktop local setup](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).

The adapter defaults to `http://127.0.0.1:4317/mcp`. For another local port or trusted HTTPS, add `"--mcp-url"` and its exact URL as separate arguments. It accepts only loopback HTTP(S) URLs with an explicit port and `/mcp` path. TLS uses normal system trust; the adapter does not bypass certificate validation. If the bridge requires a token, supply its matching `VISUAL_NERVE_BRIDGE_TOKEN` through the adapter's protected local environment, not the URL or shared example. Closing Desktop ends its adapter, not the shared bridge. Frames are limited to 32 MiB, with eight active and eight pending requests. Saturation stops the adapter rather than buffering indefinitely. Interrupted mutations can have an unknown outcome and are not automatically retried; inspect saved state before repeating them. No vendor GUI compatibility test is claimed here.

Claude Desktop's local setup is separate from its **remote custom connectors**. A remote connector connects from Anthropic's infrastructure even when configured through Desktop, so it cannot reach this loopback-only bridge. Do not substitute a remote connector for the local command above. [Claude's remote-connector network requirements](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## Discover documentation before sending commands

Every client discovers the same standard MCP tools and resources. The connection uses JSON-RPC 2.0; clients perform initialization, then `tools/list` and `resources/list`. Visual Nerve exposes **visual_nerve_request** for semantic commands and **visual_nerve_api_docs** for the bundled contract. Ask the client to call **visual_nerve_api_docs** first:

```json
{ "document": "guide" }
```

The compact guide explains native diagrams, optional 3D, simulations and the other workflows. Request the complete exact contract when you need schemas:

```json
{ "document": "openapi" }
```

Calling without arguments also returns the compact guide. The same documents are available as MCP resources at `visual-nerve://docs/guide` and `visual-nerve://docs/openapi`.

Documentation discovery does not require a connected browser or content grant. Workspace commands do. The [interactive API reference](/api/docs/) is a public read-only reference when hosted on the website; its local version can use **Try it out** against the local origin. [Download OpenAPI](/openapi.yaml) for the bundled contract.

After updating the local executable, restart it and reconnect the MCP client to refresh discovered tools. Updating public app files is separate from updating this local process.

## Export a vector diagram through MCP

For a small diagram, the existing export endpoint with `format: "svg"` returns a string. For large diagrams, use [background SVG export](#background-svg-export) to start a job, poll progress and retrieve bounded result chunks:

```json
{
  "path": "/export",
  "method": "POST",
  "data": {
    "diagramId": "YOUR_DIAGRAM_ID",
    "format": "svg",
    "scope": "complete"
  }
}
```

The response is an SVG XML string, which the client can save as a `.svg` file. Read-only access is sufficient. The connected browser renders the same 2D scene as the UI export; the bridge does not create a separate copy of the model. For `scope: "selected"`, include `nodeIds` containing the saved node UUIDs. `scope: "viewport"` uses the saved 2D viewport and the browser's canvas size, including while exploring in 3D. [Sharing and exports](/help/sharing/) explains appearance, font handling and what visual files preserve.

## Send a workspace command

Use **visual_nerve_request** with paths that omit `/api/v1`:

```json
{ "path": "/diagrams", "method": "GET" }
```

The tool's structured result contains **status** and **body**. Failed commands also report `isError`. REST uses the same command path with `/api/v1` in the URL, for example `GET http://127.0.0.1:4317/api/v1/diagrams`.

Do not send `/api/docs` or `/api/openapi.yaml` through visual_nerve_request; they are HTTP documentation routes, not browser graph commands. Use the documentation tool or normal HTTP links for those.

When several distinct workspaces are connected, pass `workspaceId` with MCP requests, or `X-Visual-Nerve-Workspace` with REST. Find the ID under **Settings → Data & Privacy → Storage details**. Multiple tabs of one browser/origin share one workspace and use transactional version checks.

## Preview code, then save it deliberately

Discover supported language IDs with `GET /code/languages`. This read-only preview analyzes a supplied script without executing it or saving a project:

```json
{
  "path": "/code/preview",
  "method": "POST",
  "data": {
    "name": "Invoice calculation",
    "files": [
      {
        "path": "billing.py",
        "language": "python",
        "content": "def calculate_total(amount, tax):\n    return amount + tax\n\ndef invoice():\n    return calculate_total(100, 25)\n"
      }
    ],
    "mode": "symbols"
  }
}
```

Inspect returned objects, counts, warnings and syntax/heuristic/unresolved relationships. Use the same data with **POST `/code/diagrams`** to save and open the graph; that requires Read + write. Omitting mode matches the UI: one file defaults to declarations (`symbols`), multiple files to file overview (`files`).

Original source is temporary. Saved diagrams retain recognized identifiers, paths, source lines and relationship evidence rather than complete code. See [code visualization](/help/code/) for capabilities and bounds. SQL preview uses **POST `/sql/preview`** with `{sql,name?}`; creation uses `/sql/diagrams`. Draw.io/Visio uses `/diagram-files/preview` and a selected-page `/import`. These share the browser's importers and validation.

## Inspect a code or documentation ZIP

Use `/code/project/preview` with strict base64 ZIP bytes. Read only can inspect the unsaved result; `/code/project/diagrams` requires Read + write and opens the saved graph.

```json
{
  "path": "/code/project/preview",
  "method": "POST",
  "data": {
    "name": "Service project",
    "data": "<BASE64_ZIP_BYTES>",
    "mode": "folders"
  }
}
```

Choose `files`, `symbols` or `folders`. Folder nodes expose semantic `projectDirectory` metadata, combined dependencies expose `codeRelation.occurrences`, and `codeAnalysis.project` explains scan counts. Code and internal Markdown links use the same browser analysis as the UI. The 32 MiB envelope includes base64, so compressed archives must be below approximately 24 MiB and may need to be smaller. ZIP scan permits 120 seconds, followed by 30 seconds for analysis; these exact bridge routes allow 165 seconds. See [ZIP project help](/help/code/#import-a-zip-project) for exclusions, supported links and limits.

## Create ordinary diagram cards in 3D

Create a spatial diagram through visual_nerve_request:

```json
{
  "path": "/spatial-diagrams",
  "method": "POST",
  "data": { "name": "Truck lifecycle", "type": "mindmap" }
}
```

Read the returned graph's `diagram.id` and `diagram.version`. Replace `DIAGRAM_UUID` with that ID, and use `baseVersion: 7` only if the latest read returned version 7:

```json
{
  "path": "/diagrams/DIAGRAM_UUID/bulk",
  "method": "POST",
  "data": {
    "baseVersion": 7,
    "upsert": true,
    "nodes": [
      { "externalId": "truck", "title": "Truck lifecycle", "x": 0, "y": 0 },
      { "externalId": "build", "title": "Manufacturing", "x": 350, "y": -120 },
      {
        "externalId": "service",
        "title": "Operation and service",
        "x": 350,
        "y": 120
      }
    ],
    "edges": [
      {
        "externalId": "truck-build",
        "sourceExternalId": "truck",
        "targetExternalId": "build"
      },
      {
        "externalId": "truck-service",
        "sourceExternalId": "truck",
        "targetExternalId": "service"
      }
    ]
  }
}
```

`baseVersion` is the actual integer version from your latest read. Stable `externalId` values support repeatable upsert; they are distinct from local UUIDs. Ordinary node coordinates and dimensions remain useful for 2D. Add descriptions for explanation and use validated spatial metadata only when independent depth is needed.

3D is relief of the same styled cards and relationships, not a separate 3D-model format. Keep a readable 2D layout for toggling back and PNG/PDF/SVG. [3D diagrams](/help/3d/) explains placement, camera controls and native appearance.

## Inspect and change semantic simulation properties

Start with **GET `/simulation/capabilities`** and **GET `/diagrams?type=process-simulator`**. Read **GET `/diagrams/DIAGRAM_UUID/simulation`** for nodes, flow edges, particle types, shared resources, improvements, scenarios, defaults, economics and retention.

A visible capacity card such as Counter 2 is a read-only projection of one logical Work node/resource. Change semantic capacity on that logical ID rather than inventing a second model from canvas coordinates. Read its canonical IDs after creation.

To change a Work node's capacity, first read the diagram's latest version, then send:

```json
{
  "path": "/diagrams/DIAGRAM_UUID/simulation/nodes/WORK_NODE_UUID",
  "method": "PATCH",
  "data": { "baseVersion": 7, "value": { "work": { "capacity": 3 } } }
}
```

Use `7` only if the latest graph read returned that version. The nested patch preserves processing time and other Work settings. The returned graph contains the new diagram version for the next edit. The UI displays the same model, and the same engine uses its new capacity on the next run.

Entity collections also support particle types, resources, edges, improvements and scenarios. API model time units are **seconds**, with arrivals and operating costs **per hour** in the model currency. UI fields may show minutes where labelled. [Process Simulator](/help/simulation/) explains shared resources, queues, scaling, economics and scenario isolation.

## Run without animation and collect a result

For an existing configured simulator:

```json
{
  "path": "/diagrams/DIAGRAM_UUID/simulation/runs",
  "method": "POST",
  "data": {
    "durationSeconds": 86400,
    "seed": 12345,
    "demandMultiplier": 1.0,
    "animated": false,
    "speed": "max"
  }
}
```

The response returns an asynchronous run with an **id**. Poll `/diagrams/DIAGRAM_UUID/simulation/runs/RUN_ID` for status, then read `/result`. Reading a result before it is available can return 409. Inspect live `/state`, `/metrics`, `/queues`, `/bottlenecks`, `/nodes`, `/resources`, `/particle-types` and paged `/events` beneath that run.

Pause, resume, stop and reset use POST to the matching run action with exact `{}`. Replay seek uses POST `/seek` with `{timeSeconds}` after pausing or completing. Model/run changes need write access; inspection and exact scenario comparison permit read access.

**Headless means no active canvas or animation loop is required. The browser must still remain connected and open** for IndexedDB and worker execution. Closing it ends execution. A run freezes its model, scenario, seed and options; later edits do not rewrite that result.

## Automate a demand stress test

Client-side pseudocode for sequential runs:

```text
Read the simulator and choose a fixed seed and duration.
For multiplier in [1.0, 1.1, 1.2, 1.3, 1.4, 1.5]:
    POST /diagrams/DIAGRAM_UUID/simulation/runs
        {durationSeconds:86400, seed:12345,
         demandMultiplier:multiplier, animated:false}
    Save the returned run id.
    Poll the run until completed, stopped or failed.
    Read its result; retain status and any error with the metrics.
Compare the completed runs using their distinct run ids.
```

Use **POST `/diagrams/DIAGRAM_UUID/simulation/compare`** with `{runIds:[...]}` to compare 2–20 distinct runs from that diagram. Inspect throughput, queue length/waiting, utilization, TTR, revenue, costs, contribution and abandonment across demand. Do not treat a failed safety-limited run as a successful completed scenario.

Using the same model, scenario, seed and duration produces the same deterministic business metrics whether controlled by UI, API or MCP, and whether animated or MAX. Demand multipliers and scenario changes intentionally change those inputs.

## Review versions, errors and limits

Single-node edits use the latest node `version`; graph/model writes generally use the latest diagram `baseVersion`. Read before writing. Bulk upsert matches stable external IDs, not UUIDs. Validation and transactional writes prevent partial mutations from invalid requests.

| Status or symptom               | Meaning and next action                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Waiting / Error** in Settings | Start the bridge; check exact app origin, local URL, TLS trust and browser local-network permission.          |
| **503**                         | No available connected/granted browser, disabled bridge or disconnection; keep the intended workspace open.   |
| **401**                         | A configured bridge token is missing or does not match; check the client header and browser token.            |
| **403**                         | Access/consent does not permit the command; a Read only client cannot edit or run.                            |
| **404**                         | The referenced object/run/route does not exist in the targeted workspace.                                     |
| **409**                         | Stale version, unavailable-yet result or competing execution; read the error, refresh or wait as appropriate. |
| **422**                         | Invalid fields, references or model assumptions; correct the structured validation details.                   |
| **428**                         | A required simulation version was omitted.                                                                    |

Simulation validation can return `error`, `code` and `issues` with semantic field paths. It does not require guessing from graphic positions. Workspace request/response and WebSocket envelopes are **32 MiB** regardless of Settings' local import limit. Expensive analysis and runs have their own bounds; discover simulation execution ceilings through capabilities.

Ordinary diagram evidence excludes raw code/source scripts. An explicit CSV measure-evidence request can return original cells to the requesting client; ask for that only when needed. Unsent question/app-brief previews do not publish data to an external service. Rendering exports or final video downloads happen in the connected browser.

For complete schemas use the [API reference](/api/docs/). For connection and import recovery use [troubleshooting](/help/troubleshooting/); for permissions and backups use [Settings](/help/settings/).

## Parallel processes through the API

`GET /simulation/capabilities` exposes `fork` and `join` node types and the `parallel` contract. Read the current model and canonical IDs before editing. Configure a complete block in one versioned `PUT /diagrams/{diagramId}/simulation` with `{baseVersion,model}`; creating an unpaired node through individual CRUD is rejected. The following is a fragment, to insert alongside the model's valid Sources, Work nodes, Outcomes and edges:

```json
{
  "nodes": [
    {"id":"fork-id","name":"Start prerequisites","type":"fork",
     "fork":{"joinNodeId":"join-id","branchEdgeIds":["access-edge","equipment-edge"]}},
    {"id":"join-id","name":"All prerequisites ready","type":"join",
     "join":{"forkNodeId":"fork-id"}}
  ],
  "edges": [
    {"id":"access-edge","sourceNodeId":"fork-id","targetNodeId":"access-work-id"},
    {"id":"equipment-edge","sourceNodeId":"fork-id","targetNodeId":"equipment-work-id"},
    {"id":"access-ready-edge","sourceNodeId":"access-work-id","targetNodeId":"join-id"},
    {"id":"equipment-ready-edge","sourceNodeId":"equipment-work-id","targetNodeId":"join-id"}
  ]
}
```

The IDs above are explanatory placeholders. Supply unique canonical node/edge UUIDs for the actual document, retain existing identifiers, and read the returned model before further updates. `branchEdgeIds` must declare **all** outgoing fork edges; particle-type filters on those edges are rejected. Every branch must have a path to the paired join. The engine rejects unmatched/crossed pairs, cycles inside the region, foreign incoming connections, more than 64 branches or more than 16 nested pairs with structured validation issues. Failure/rejection paths can end the entire case; successful outcomes must follow the join.

Run the model through the existing simulation run endpoints. Original-case population and revenue remain single-counted; child tasks have their own processing, queues and resource allocations. `state.parallel` exposes active groups/branches, waiting parents and bounded correlated group summaries with `droppedGroups` describing omitted active groups. Particle tokens carry `rootParticleId`, `parentParticleId`, `forkGroupId`, `forkNodeId`, `joinNodeId` and `branchEdgeId` where applicable. A suspended parent and an arrived child can have status `waiting`; retired children have `joined` or `cancelled`. Node metrics at a join expose `join.waitingGroups`, `arrivedBranches`, `expectedBranches`, `completedGroups`, `cancelledGroups` and the observed synchronization-wait distribution. Its current queue counts arrived tasks waiting for their siblings. `PARTICLE_FORKED`, `BRANCH_JOINED`, `JOIN_COMPLETED`, `BRANCH_CANCELLED` and `PROCESS_CANCELLED` events provide correlation without inspecting coordinates. Retained live tokens and sampled particles include branches and suspended parents; business `created`, `completed`, `abandoned`, `failed` and `inSystem` count original cases. The 200,000 active-token limit applies to parents and children together.

Discover the **Parallel SD-WAN delivery** template through `GET /templates` for a complete editable example. Headless, animated, scenario and replay runs use the same deterministic engine.

Route metrics retain exact connection-ID labels up to 2,000 characters. Longer histories use a bounded identifier: the first 200 characters followed by ` … [route:<8hex>-<8hex>; edges=N]`. The ordered dual digest and edge count are deterministic grouping identifiers, not a cryptographic integrity guarantee, and cannot reconstruct the complete itinerary. At most 256 distinct route buckets plus `[other routes]` are retained; all completed cases still contribute to metrics. This bounds nested branch history without dropping visited Work-node revenue attribution or changing case counts, costs or TTR.

## Background SVG export

Prefer the asynchronous export for large diagrams. All operations below are available with **Read only** access and do not change the model:

```json
{"path":"/exports/svg","method":"POST","data":{"diagramId":"YOUR_DIAGRAM_UUID","scope":"complete"}}
```

The `201` response includes `jobId`, `diagramId`, `state`, `progress` (0–100), `phase`, timestamps and object counts. Poll `GET /exports/svg/{jobId}` with a short backoff until `succeeded`, `failed` or `cancelled`. Fetch `GET /exports/svg/{jobId}/result?offset=0&limit=1048576`. Each response is `{jobId,offset,nextOffset,totalCharacters,text,complete}`. Append `text`, then request the returned `nextOffset` until `complete:true`. Offsets use UTF-16 code units; returned boundaries preserve Unicode characters. Save the concatenated XML as `.svg` (`image/svg+xml`). A result requested before success returns `409 SVG_JOB_NOT_READY`. Cancel/remove a job with exact `DELETE /exports/svg/{jobId}` and no arguments or `{}`; this returns its cancelled status (`200`).

`GET /exports/capabilities` discovers the complete limits and scope options. The local Web Worker preserves canonical 2D bounds, connections, current appearance, icons and visible drawing. It keeps full source descriptions while clipping visible content to each saved card. Selection and saved-viewport scopes follow the normal export conventions. Large exports use no hidden React node per object; simulation and UI responsiveness are independent of vector generation.

Jobs are transient browser memory, with at most two running jobs, four retained terminal jobs and 128 MiB of retained SVG results. Limits are 20,000 rendered nodes, 100,000 rendered connections, 5,000,000 source characters, 64 MiB XML, 16,777,216 pixels per dimension and a 120-second worker deadline. A scoped export can snapshot up to 100,000 source nodes and 500,000 source edges, while its projected scene must remain within the rendered limits. Results expire 15 minutes after job creation. Lock, reload, workspace stop, app-cache clearing or an explicit MCP grant change cancels/removes jobs; a later unlock or grant cannot restore old plaintext. Start a fresh export. The POST's short-lived bridge lease ending does **not** cancel an otherwise authorized job. Individual result chunks stay below the 32 MiB transport envelope. Unknown fields, duplicate query parameters and invalid ranges are rejected rather than guessed.

The existing `POST /export` JSON/Markdown behavior is unchanged. Source graphs with at most 100 nodes and 20,000 title/description/serialized metadata characters before projection retain its SVG JSON-string response and 16 MiB limit. Larger sources return `409 SVG_BACKGROUND_REQUIRED` even for a small selection, with instructions to use `/exports/svg`, avoiding a command timeout with an uncertain export result. The UI chooses the background route automatically, displays progress and offers Cancel. Review SVG source before sharing: an encrypted workspace does not encrypt diagram exports.

## Export an editable Draw.io or Visio document

Use editable exports when you want to continue working on the drawing in another editor. They preserve basic shapes, text, colors, groups and attached connectors using the saved 2D layout, including when the app is showing 3D. They do not transfer raw datasets, original source files, live capacity copies or complete simulation execution and scenarios. Keep native JSON or an encrypted workspace backup for a faithful model transfer.

1. Read `GET /exports/capabilities` first. Its existing SVG fields remain unchanged; `diagrams` describes the editable formats, scopes, compatibility and separate limits. Bridge 0.6.0 advertises `exchange-export-v1`.
2. Start an export with the existing **visual_nerve_request** tool:

```json
{"path":"/exports/diagrams","method":"POST","data":{"diagramId":"YOUR_DIAGRAM_UUID","format":"drawio","scope":"complete"}}
```

3. The **201** response contains a `jobId`, not the file. Poll `GET /exports/diagrams/{jobId}` with a short backoff. Status reports real progress, phases and warnings. Continue until `succeeded`, `failed` or `cancelled`; inspect `error` if it fails.
4. After success, read `GET /exports/diagrams/{jobId}/result?offset=0&limit=786432`. Decode that chunk's `data` from base64, then request its `nextOffset` until `complete:true`. Save the concatenated **decoded bytes** as `.drawio` or `.vsdx` using the returned format and MIME type.
5. Review warnings and open the file in the destination editor. Exact `DELETE /exports/diagrams/{jobId}` with no body or `{}` cancels/removes it and returns **200** once; later reads return **404**.

Result offsets count **raw binary bytes**. They are different from SVG's UTF-16 offsets. Each response contains `{jobId,format,mimeType,encoding:"base64",offset,nextOffset,totalBytes,data,complete,warnings}`. The default and maximum chunk limit is 786,432 bytes, which produces at most 1,048,576 base64 characters. **Decode every chunk separately. Never join the base64 strings:** padding can occur in any chunk.

Complete exports include all stored logical nodes, including nodes hidden in temporary CSV or overview views. For `scope:"selected"`, supply 1–20,000 unique existing canonical node UUIDs in `nodeIds`; only those nodes and connections with both endpoints selected are included. API selection does not expand a process group automatically: include its actual descendant IDs. The normal app selector performs that expansion for its process cards and maps a capacity card back to its single logical node. `nodeIds` is forbidden outside selected scope.

**VSDX is a compatibility preview requiring verification in Microsoft Visio.** Automatic package checks and a Visual Nerve re-import do not establish real Visio rendering/editing fidelity. Capabilities report `requiresMicrosoftVisioVerification:true`. Icons, custom stencils, pen strokes, rich formatting and 3D relief can be simplified or omitted; long labels may need resizing.

### A local REST example

With the bridge running and the intended browser unlocked with **Read only** or **Read + write**, inspect capabilities:

```sh
curl --fail-with-body http://127.0.0.1:4317/api/v1/exports/capabilities
```

If your bridge requires a token, use your client's protected Authorization configuration. For the following Node.js 22 example, set `VISUAL_NERVE_BRIDGE_TOKEN` in your local environment if needed and set `VISUAL_NERVE_DIAGRAM_ID` to the canonical UUID returned by `GET /diagrams`. Do not put real tokens in the script. Save it as `export-diagram.mjs`, then run `node export-diagram.mjs`. Adjust the base address to your configured listener. When multiple workspaces are connected, also set `VISUAL_NERVE_WORKSPACE_ID` to the intended workspace ID.

```javascript
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const base = 'http://127.0.0.1:4317/api/v1';
const diagramId = process.env.VISUAL_NERVE_DIAGRAM_ID;
if (!diagramId) throw new Error('Set VISUAL_NERVE_DIAGRAM_ID first.');
const headers = { 'Content-Type': 'application/json' };
if (process.env.VISUAL_NERVE_BRIDGE_TOKEN)
  headers.Authorization = `Bearer ${process.env.VISUAL_NERVE_BRIDGE_TOKEN}`;
if (process.env.VISUAL_NERVE_WORKSPACE_ID)
  headers['X-Visual-Nerve-Workspace'] = process.env.VISUAL_NERVE_WORKSPACE_ID;
async function request(path, options = {}) {
  const response = await fetch(base + path, {
    ...options, headers, signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  return body;
}

const capabilities = await request('/exports/capabilities');
if (!capabilities.diagrams) throw new Error('Update the app and local bridge.');
let job = await request('/exports/diagrams', {
  method: 'POST',
  body: JSON.stringify({ diagramId, format: 'drawio', scope: 'complete' }),
});
while (['queued', 'running'].includes(job.state)) {
  await delay(250);
  job = await request(`/exports/diagrams/${job.jobId}`);
}
if (job.state !== 'succeeded')
  throw new Error(job.error?.message ?? `Export ${job.state}`);

const chunks = [];
let offset = 0, chunk;
do {
  chunk = await request(
    `/exports/diagrams/${job.jobId}/result?offset=${offset}&limit=786432`,
  );
  chunks.push(Buffer.from(chunk.data, 'base64')); // Decode each chunk independently.
  offset = chunk.nextOffset;
} while (!chunk.complete);
await writeFile(`diagram.${chunk.format}`, Buffer.concat(chunks));
console.log(chunk.warnings);
await request(`/exports/diagrams/${job.jobId}`, { method: 'DELETE' });
```

Change `format` to `vsdx` to produce the Visio preview. The example never automatically repeats a POST after a transport error. If a write response is uncertain, use the [operation receipt workflow](#recover-an-uncertain-write-without-creating-it-twice); safe status/result reads can be repeated while the original job remains authorized.

### Limits, permissions and readable output

All four editable-job routes permit **Read only**. Their exact POST/DELETE exceptions do not grant permission to edit or delete diagrams. Unknown fields, invalid references, duplicate query parameters and unsupported ranges return **422**; requesting a result before success returns **409 EXCHANGE_JOB_NOT_READY**. A busy browser returns **429 EXCHANGE_JOB_BUSY**.

The source graph can contain up to 100,000 nodes/500,000 connections; the selected export is limited to 20,000 nodes/100,000 internal connections, 5,000,000 exported text characters and 64 MiB. Two jobs may run at once; four terminal jobs and 128 MiB of result bytes may be retained. Jobs expire 15 minutes after creation, with a two-minute worker deadline. Discover exact limits through capabilities and reduce the selection when needed; the exporter does not silently truncate it.

Jobs retain the **original unlocked session and MCP grant**, beyond the POST response. Lock, reload, stop, cache clearing or an explicit grant change removes them; a later unlock or grant cannot recover the old result. Locked content requests return **423**, and authorized reads of expired, removed or cancelled jobs return **404**. Temporary results stay in browser memory. Downloaded files are readable and cannot be recalled by locking the workspace. Review titles, descriptions, owner/status labels, process assumptions and scope before sharing. See [sharing and exports](/help/sharing/#continue-editing-in-drawio-or-visio) and the [complete API contract](https://github.com/Caripson/visualnerve/blob/main/API.md#editable-diagram-exchange).
