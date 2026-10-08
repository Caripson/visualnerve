---
title: "Connect tools through API and MCP"
summary: "Use the optional local bridge to inspect and control the same browser workspace through semantic commands."
weight: 15
---

You can use every normal Visual Nerve workflow through the UI without AI, MCP or a backend. The optional local bridge lets an external client read and edit the same workspace, create diagrams, analyze supplied input, control presentations and run simulations.

The bridge forwards commands to your connected browser. It has no separate diagram database, cloud copy or simulation engine. Browser-owned IndexedDB and the shared validated model remain authoritative.

## Understand the addresses

| Address                                                       | Purpose                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `https://visualnerve.caripson.com/app/`                       | Browser workspace where your diagrams and Settings live                      |
| `https://visualnerve.caripson.com`                            | Website origin allowed by your bridge; use the origin without a path         |
| `ws://127.0.0.1:4317/bridge` or trusted `wss://…/bridge`      | Browser-to-local-service WebSocket connection                                  |
| `http://127.0.0.1:4317/mcp` or matching `https://…/mcp`       | Local MCP server address for a client such as Codex                            |
| `http://127.0.0.1:4317/api/v1` or matching `https://…/api/v1` | Local REST API base                                                            |

`127.0.0.1` means the computer where the connecting software runs. It remains local even when the app was downloaded from a public domain. JavaScript opens a connection to the bridge; it does not install or create that native process. A client on another machine does not reach your computer by using its own `127.0.0.1`.

Settings displays **Visual Nerve website**, API reference and **MCP server URL for Codex** separately. Its saved WebSocket connection determines the matching HTTP(S) MCP address. Do not substitute the public website domain for the local service.

![Local connection settings separating the public website, local MCP server, browser WebSocket address and optional token.](/help/images/mcp-settings.webp "The website identifies the app; the local service connects your tools to the open browser workspace.")

## Start the optional process

The bridge is the project's optional Go executable. If you are building from source, the repository's build requires Go 1.26+, Node.js 22.12+, npm and Hugo 0.140+ on Linux, WSL or macOS. Run `./build.sh` to produce `public/` and `bin/visual-nerve`. Once built, the executable and static files do not need the toolchain at runtime.

For a locally served workspace:

```sh
./bin/visual-nerve --static ./public --bridge --addr 127.0.0.1:4317
```

Open `http://127.0.0.1:4317/app/`, accept storage and configure access. The home page at `/` introduces the product; API and MCP endpoint paths keep their existing addresses. For the public HTTPS app, allow its exact origin:

```sh
./bin/visual-nerve --static ./public --bridge \
  --addr 127.0.0.1:4317 \
  --allowed-origin https://visualnerve.caripson.com
```

Browser local-network and secure-connection rules vary. If your browser requires secure local WebSockets, start the process with `--tls-cert` and `--tls-key` pointing to a certificate/key trusted by that browser for the chosen loopback hostname, then use `wss://…/bridge` in Settings. The matching MCP/REST addresses use HTTPS. Grant local-network permission if the browser requests it.

The bridge only accepts loopback integration connections. Its allowed-origin must match the website's scheme, hostname and port exactly. A bridge does not become part of the public website when it starts.

On mobile, the normal UI remains usable locally. Integration still needs a compatible bridge/client on the device making that local connection; a phone's loopback address does not automatically refer to a laptop.

## Enable the browser connection

1. Keep the intended Visual Nerve workspace open and accept local storage.
2. Open **Settings → Codex / MCP integration**. On mobile, start from **Diagram actions → Settings**.
3. Select **Read only** for inspection, or **Read + write** for editing and run/playback controls.
4. Check **MCP connection: Connected**.
5. If needed, expand **Local connection details**, enter the local WebSocket address and optional token, then choose **Save connection**.
6. Copy **Instructions for Codex** and use the displayed **MCP server URL for Codex** in your MCP client.

Access is **Off** by default. Read only permits GET inspection and supported exact unsaved previews, exports and comparisons. It does not grant general permission to POST or edit. Read + write additionally permits mutations, saving models and controlling simulations/presentations. Turning access Off closes the browser connection.

If the bridge uses `VISUAL_NERVE_BRIDGE_TOKEN`, the browser's **Integration token** must match it. That token lasts for the browser session and is excluded from backups and copied setup instructions. REST clients send `Authorization: Bearer YOUR_LOCAL_TOKEN` when a token is configured; configure the corresponding header in your MCP client. Choose the tools you grant access to, since they receive the content you ask them to inspect.

## Discover documentation before sending commands

Call the **visual_nerve_api_docs** MCP tool first:

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

Use the normal export endpoint with `format: "svg"`:

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
  "data": {"name": "Service project", "data": "<BASE64_ZIP_BYTES>", "mode": "folders"}
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
