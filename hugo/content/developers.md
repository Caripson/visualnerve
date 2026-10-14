---
layout: product
title: "Build against one local diagram model"
description: "Use Visual Nerve's standard REST and MCP interfaces with Codex, Claude Code, Cursor, Gemini CLI or your own client."
eyebrow: "Developers"
summary: "Discover the contract, target the browser workspace and use the same model as the interface."
---

[API reference](/api/docs/) · [Download OpenAPI](/openapi.yaml) · [Local bridge setup](/mcp/)

## Understand the execution boundary

The React application owns working state and IndexedDB persistence. The optional Go executable forwards REST and MCP requests through a local WebSocket to the connected browser. Validation and transactions apply before a mutation is reported as successful. MCP is vendor-independent: Codex, Claude Code, Cursor, Gemini CLI and custom clients use the same semantic commands, rather than separate implementations.

No application database runs in the Go process. Starting the executable alone does not provide your diagrams. Keep the intended browser workspace open, accept required storage and grant Read only or Read + write access in Settings.

## Respect the encrypted session boundary

The dedicated app surface at `app.visualnerve.com` uses a browser-local encrypted workspace. A human creates or unlocks its password in the browser; an agent receives only the access subsequently granted in Settings. The UI, API and MCP use one authoritative storage backend and the same revocable session. Existing legacy origins remain separate; the complete move uses [Export encrypted transfer and Transfer existing workspace](/help/settings/#transfer-an-existing-workspace), rather than an automatic cross-domain migration or the ordinary Merge/Replace importer.

Before requesting content, use **visual_nerve_request** with `{ "path": "/workspace/security", "method": "GET" }`. The safe versioned response distinguishes `mode: "encrypted"` from `"legacy"`, reports session `state`, and identifies the independently versioned logical workspace and vault formats. It exposes no workspace records, identifiers, keys, credentials, grants or session expiration timestamps. It can describe a locked browser while connected; static bridge health cannot infer that state.

Handle **423 `WORKSPACE_LOCKED`** by asking the human to unlock in the browser and choose a fresh MCP grant in Settings, then making a fresh authorized request. Previous tool grants are not automatically reactivated after encrypted-session unlock. Preserve that code from REST or MCP's `structuredContent.body`; do not interpret it as validation failure. **503** continues to mean an unavailable/disconnected browser. Documentation discovery is independent of both content access and unlock.

An already-authorized live browser connection may remain restricted to safe control status while locked. Cold locked startup creates no connection; connection loss remains unavailable, and explicit Off disconnects. A later unlock does not restore content or lock permission. For the same workspace, the bridge prefers a content-enabled tab without retrying dispatched writes.

Use `{ "path": "/workspace/lock", "method": "POST", "data": {} }` to explicitly lock an encrypted workspace with current **Read + write** access. The body must be empty or omitted. Pending saves must succeed, then the original session and authoritative grant are rechecked before revocation. The durable lock compares the workspace revision captured before the grant snapshot. Concurrent changes return **409** and do not invalidate local keys; inspect the current saved state and permission before a fresh request. The success response is safe security metadata; intentional revocation does not invalidate this acknowledgement. An already-locked retained control connection returns idempotent local status without another revocation. A fresh grant is required after unlock.

There are no password, recovery, unlock or timeout-policy write endpoints. Reserved `/settings/vault-*` writes are rejected. Requests do not renew the inactivity timeout, and lock cancels jobs and revokes originating operations even if the user later unlocks again. Do not build an agent keepalive or retry a revoked write blindly; inspect the current saved state after a fresh unlock.

Authorized responses and ordinary diagram exports are readable content. `GET /workspace/export` returns a readable semantic workspace backup to the granted client; the UI's encrypted backup download is a different format and is restored through the browser. Existing downloaded encrypted copies keep their own password/recovery credentials after a live password change. Encryption does not constrain what a connected client does with received content. This architecture requires no mandatory backend or SSO and does not claim regulatory or security certification.

From a confirmed source checkout, `./scripts/build-bridge.sh` needs Go 1.26+ and produces a native `bin/visual-nerve` executable plus its matching `bin/bridge-docs/openapi.yaml`. Node, npm and Hugo are only needed if you also build the website. Do not guess an installed executable path. The original project code uses [MPL-2.0 with separate third-party terms](/license/).

```sh
./scripts/build-bridge.sh
./bin/visual-nerve --static ./bin/bridge-docs --bridge \
  --addr 127.0.0.1:47417 --allowed-origin https://app.visualnerve.com
```

Open `https://app.visualnerve.com/`, unlock locally and grant access in Settings. Start the bridge with `--allowed-origin https://app.visualnerve.com` and any trusted local TLS required by the browser. `/app` is retired on production; it is not an app alias. Local development builds can retain a development-only `/app/` test editor. [Connection steps](/help/api-mcp/).

Each listener serves `/mcp`, `/bridge` and `/api/v1`. New setups use 47417 as a product default, not an official MCP port. With `--bridge` and no explicit `--addr` or nonempty `VISUAL_NERVE_ADDR`, bridge **0.11.1 or newer** also attempts legacy `127.0.0.1:4317`; both listeners share the same handler, workspace registry, grants and operation state. An unavailable legacy port is skipped with a warning; primary-port failure stops startup. The explicit example above starts only 47417. No port scan or client fallback occurs. [Port and host diagnostics](/help/api-mcp/#verify-the-listener-before-connecting).

Saved browser addresses remain unchanged. To move a legacy connection, use the human **Use port 47417** action in Settings after verifying that listener. It revokes access, clears the session token, preserves hostname/TLS and leaves MCP Off for a fresh grant. Update HTTP clients and explicit stdio `--mcp-url` to the Settings URL. This leaves the hosted app's IndexedDB origin unchanged. [Upgrade instructions](/help/api-mcp/#upgrade-an-existing-4317-connection).

The isolated app permits only explicitly approved loopback WebSocket ports. This release prepares **47417** for new setups and retains **4317** for existing connections. Both the app package and its HTTP response policy must allow a port; changing Settings alone cannot override CSP. An older live release may still allow only 4317 until the coordinated manual app/policy deployment. Existing saved addresses are preserved; switch the listener, browser connection and client together only after that rollout.

## Check and read with REST

```sh
curl --fail-with-body http://127.0.0.1:47417/api/v1/health
curl --fail-with-body http://127.0.0.1:47417/api/v1/diagrams
```

Require HTTP 200 JSON health with `status: "ok"`, `storage: "indexeddb"`, `bridge: true`, a version and both MCP tool names before proceeding. Empty, binary and HTTP/0.9 responses are not valid; port 4317 is also used by OpenTelemetry gRPC. Test from the actual client and browser hosts, particularly with WSL or containers. A healthy bridge does not imply a connected, granted browser. Diagram inspection needs that browser and read access.

If a bridge token is configured, set the client's Authorization header from its protected local configuration. Keep actual tokens out of shared examples, prompts and issue reports. When several distinct workspaces are connected, add `X-Visual-Nerve-Workspace: WORKSPACE_UUID`; find the value in Settings → Data & Privacy → Storage details. MCP uses the equivalent `workspaceId` argument.

## Create a small diagram

Enable Read + write, then create an empty flowchart:

```sh
curl --fail-with-body \
  -X POST http://127.0.0.1:47417/api/v1/diagrams \
  -H 'Content-Type: application/json' \
  --data-binary '{"name":"Customer onboarding","type":"flowchart"}'
```

The response is a Diagram object. Copy its `id` into the following placeholder before running the node request:

```sh
DIAGRAM_ID='REPLACE_WITH_RETURNED_UUID'

curl --fail-with-body \
  -X POST "http://127.0.0.1:47417/api/v1/diagrams/${DIAGRAM_ID}/nodes" \
  -H 'Content-Type: application/json' \
  --data-binary '{"title":"Contract signed","nodeType":"process","description":"Confirm the owner and the delivery date.","x":100,"y":100}'
```

The UI reads the same saved object. For larger imports, use `POST /diagrams/{id}/bulk` with stable external IDs and `upsert: true`. Read the current diagram version before sending `baseVersion` for graph/model writes. Individual node/edge updates use their current entity version. Exact schemas and response types are in OpenAPI.

## Use MCP without inventing a second API

Point a local Streamable HTTP client at `http://127.0.0.1:47417/mcp`, or its matching trusted HTTPS address. Start the bridge separately and keep the granted browser open. [Codex](/help/api-mcp/#codex), [Claude Code](/help/api-mcp/#claude-code), [Cursor](/help/api-mcp/#cursor) and [Gemini CLI](/help/api-mcp/#gemini-cli) have different configuration formats; they receive the same tools and resources.

For a local stdio host such as [Claude Desktop](/help/api-mcp/#claude-desktop), Visual Nerve provides `visual-nerve --mcp-stdio`. This adapter forwards to the already-running bridge at `http://127.0.0.1:47417/mcp`; `--mcp-url` selects another exact loopback HTTP(S) endpoint with an explicit port. It has no independent workspace, permission grant or command engine. It sends only MCP messages on stdout, supports normal trusted TLS and can take the bridge token from `VISUAL_NERVE_BRIDGE_TOKEN` in its protected process environment. It does not expose an older SSE endpoint or turn the public website into a remote MCP service.

MCP uses JSON-RPC 2.0. Standard `initialize`, `tools/list`, `tools/call`, `resources/list` and `resources/read` operations discover and use the contract. For example, after initialization, a client can send this tool-discovery message to the local MCP endpoint:

```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {} }
```

The browser WebSocket `/bridge` is an internal forwarding connection, not an MCP transport URL. The public `/mcp/` page documents setup; it is not the loopback `/mcp` service. Cloud-hosted clients cannot reach a user's loopback service merely by receiving this address.

Call **visual_nerve_api_docs** with:

```json
{ "document": "guide" }
```

Request `openapi` when you need exact schemas. The bundled guide and OpenAPI are also MCP resources at `visual-nerve://docs/guide` and `visual-nerve://docs/openapi`.

Call **visual_nerve_request** with:

```json
{ "path": "/diagrams", "method": "GET" }
```

Its structured response contains `status` and `body`; failed tool calls also report `isError`. Command paths omit `/api/v1`.

## Use the same workflow with any client

Start Codex, Claude Code, Cursor, Gemini CLI or another compatible client with Read only access. Ask it to discover the API, list the available diagrams and identify the workspace and diagram IDs before making requests. A node's screen position is not a substitute for its semantic properties. Review a proposed change before granting Read + write. Client-side tool approvals are an additional control; they do not replace the browser grant.

For a session that will build a diagram, use a concrete brief:

> Connect through the Visual Nerve MCP server. Read visual_nerve_api_docs first. Inspect the existing diagrams and propose a service-delivery mind map with clear owners and directed dependencies. Show me the objects and relationships before saving. Use stable external IDs for repeatable bulk updates, retain a readable 2D layout, and enable 3D only if I request it.

For a session that will explain a process, start with inspection:

> Use Visual Nerve in Read only mode. Inspect this Process Simulator's semantic model, assumptions and latest run. Explain which shared resources constrain throughput, using the actual queue and utilization metrics. Separate modeled evidence from your interpretation. Propose one isolated scenario and tell me its costs before requesting permission to run or save it.

These are task prompts, not client configuration files. Follow the installed client's own MCP connection instructions. Tool results can be forwarded to the client's AI service, so review the client's data policy before exposing sensitive diagrams. Keep tokens out of prompts. After an authorized change, read the saved model again and report its IDs, version and any warnings; do not claim that a timeout means the write failed or completed.

## Preview source before saving it

This MCP request performs an unsaved local analysis, permitted with Read only:

```json
{
  "path": "/code/preview",
  "method": "POST",
  "data": {
    "name": "Invoice helper",
    "mode": "symbols",
    "files": [
      {
        "path": "billing.py",
        "language": "python",
        "content": "def total(amount, tax):\n    return amount + tax\n\ndef invoice():\n    return total(100, 25)\n"
      }
    ]
  }
}
```

Review objects, warnings and relationship confidence. Send the same data to `/code/diagrams` to save it with write access. SQL and diagram-file import have corresponding preview and creation contracts. Source is analyzed rather than executed.

For a requested 3D graph, create through `POST /spatial-diagrams` with `{ "name": "Truck lifecycle", "type": "mindmap" }`, then populate its returned graph through standard node/edge or bulk commands. These are native styled cards; 3D does not require a separate mesh model. Keep the canonical 2D arrangement readable.

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

## Run and inspect a simulation

Discover `GET /simulation/capabilities`, list process-simulator documents and inspect `/diagrams/{id}/simulation`. The semantic model exposes sources, Work nodes, routes, particle types, shared resources, improvements, economics, scenarios and retention.

For an existing configured simulator, call visual_nerve_request with:

```json
{
  "path": "/diagrams/DIAGRAM_UUID/simulation/runs",
  "method": "POST",
  "data": {
    "durationSeconds": 86400,
    "seed": 12345,
    "animated": false,
    "speed": "max"
  }
}
```

Replace `DIAGRAM_UUID` with the actual saved diagram UUID. The asynchronous response contains a run `id`. Poll `/diagrams/{id}/simulation/runs/{runId}`, then read its `/result`. Live `/state`, `/metrics`, `/queues`, `/bottlenecks`, `/nodes`, `/resources`, `/particle-types` and paged `/events` expose the same state as the UI.

Times are simulated seconds; arrivals and operating costs are per hour. `untilComplete: true` stops arrivals at the horizon and drains remaining work. The same captured inputs and seed produce the same deterministic metrics at every speed.

For a stress test, run sequential `demandMultiplier` values such as 1.0, 1.1 and 1.2. Retain each run ID and its status. Compare 2–20 distinct runs using `POST /diagrams/{id}/simulation/compare` with `{ "runIds": ["RUN_A", "RUN_B"] }`. Starting or controlling runs requires write access; inspection and exact comparison permit read access. Headless runs still need the browser open and connected.

## Inspect and control nested processes

Process Simulator models optionally contain `processes: [{id, name, parentId?}]`; real nodes refer to their group through `processId`. Create and update groups through `/diagrams/{id}/simulation/processes` using the same versioned write envelope as other simulation entities. Groups organize real work and add no processing or cost.

`GET /diagrams/{id}/simulation/hierarchy` returns roots, child groups and direct/recursive node membership. `GET /diagrams/{id}/simulation/runs/{runId}/processes/{processId}` returns observed queues, utilization, cycle time, economics and bottlenecks. These are the same values shown in the UI, independent of visual placement. Discover the complete contract through `visual_nerve_api_docs` and `/simulation/capabilities` before building a model with any client.

Parent totals include descendants. Scope completion counts successful visits, while global completion counts final Outcomes. Scope resource costs allocate occupied units; idle shared-pool costs remain global. Read the capability metadata and full schema when comparing values across levels.

## Time-series analysis

**Import → Explore → Measure → Detect → Validate → Simulate.** The Time Series & Signal Analysis template adds strictly typed, versioned `diagram.analytics` to the same encrypted local document. It does not need AI, a cloud database or a Process Simulator model. UI, REST and MCP use the same deterministic worker calculations. [User guide](/help/time-series-analysis/) · [Exact API schemas](/api/docs/).

First check direct `GET http://127.0.0.1:47417/api/v1/health` for `analytics-v1`. An old bridge binary needs an explicit update; refreshing the website does not update it. In an MCP client, begin with **visual_nerve_api_docs** and `{ "document": "guide" }`, then read exact schemas using `{ "document": "endpoint", "path": "/diagrams/{diagramId}/analytics/import/commit", "method": "POST" }`. The same **visual_nerve_request** tool handles every analysis command, with paths omitting `/api/v1`.

Discover `/analytics/capabilities` for methods, defaults, warm-up, units, permissions and limits. List `/diagrams?analytics=true` for compact analysis-document metadata; it omits the observations and retained result inputs. Create the bundled synthetic example with write access:

```json
{
  "path": "/diagrams",
  "method": "POST",
  "data": {
    "name": "Illustrative Growth & Churn",
    "template": "time-series-analysis",
    "mode": "example"
  }
}
```

Use `mode:"import"` to begin empty. Creation returns an ordinary Diagram UUID. Read `/diagrams/DIAGRAM_UUID/analytics` for the current `baseVersion` and canonical analysis identities. Writes return `{diagramId,baseVersion,analytics}` with the new saved version and compact configuration. Use those identities rather than names or canvas coordinates. Stored/API timestamps use canonical UTC millisecond ISO, for example `2025-01-01T00:00:00.000Z`.

For a complete executable example, run this from a current repository checkout with Node.js and an isolated, connected browser granted Read + write:

```sh
# REST commands through the existing local browser bridge.
node scripts/examples/analytics.mjs

# Identical workflow through MCP, beginning with tool/docs discovery.
node scripts/examples/analytics.mjs --mcp
```

[Read the synthetic example source](https://github.com/Caripson/visualnerve/blob/main/scripts/examples/analytics.mjs). Each invocation intentionally creates one new **Illustrative example data** document. It discovers capabilities, previews and commits CSV, measures 2% → 3% as +1 percentage point and +50% relative change, evaluates a confirmed churn rule, reproduces historical signal episodes, compares three reviewed scenarios and archives a worker result with its original observations. Optional protected `VISUAL_NERVE_BRIDGE_TOKEN`, `VISUAL_NERVE_WORKSPACE_ID` and `VISUAL_NERVE_BRIDGE_ORIGIN` settings use the existing bridge conventions; secrets are not printed.

The sequence below uses `D=/diagrams/DIAGRAM_UUID/analytics`. Read the exact endpoint schema before filling a definition:

| Step     | Operation                                                                                | Review and effect                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Inspect  | `POST D/import/inspect` with `{source,seriesColumn?}`                                    | Read-only columns, samples, worksheets and optional long-format series names                                                          |
| Preview  | `POST D/import/preview` with `{datasetId,source,mapping}`                                | Explicit wide/long layout, date/timezone, decimal, percent, dimensions, duplicate and missing-value policies; review localized issues |
| Commit   | `POST D/import/commit` with `{baseVersion,input,mode,confirmed:true}`                    | Write; atomic create/replace/update after review                                                                                      |
| Measure  | Save `POST D/measurements` with `{baseVersion,value}`, then `POST D/measure` with `{id}` | Definitions are persistent writes; calculation is an unsaved read-only preview                                                        |
| Detect   | Save `POST D/rules` with `{baseVersion,value}`, then `POST D/evaluate` with `{ruleIds}`  | Validated JSON rules, causal baselines and explicit warm-up; calculated evidence is separate from acknowledgement                     |
| Validate | Save `POST D/backtests` with `{baseVersion,value}`, then `POST D/validate` with `{id}`   | Chronological train/validation/holdout; no precision/recall without a defined outcome/horizon                                         |
| Simulate | Save reviewed `POST D/scenarios`, then `POST D/project` with `{id}`                      | Separate assumption-based customer/MRC projections; observed history is preserved                                                     |
| Compare  | `POST D/compare` with `{scenarioIds:[...]}`                                              | Same start, resolution, horizon and currency; scenario spread is not a confidence interval                                            |

For example, a saved rule definition can use:

```json
{
  "id": "retention-pressure",
  "name": "Retention pressure",
  "version": 1,
  "enabled": true,
  "family": "sustained",
  "seriesId": "churn",
  "severity": "warning",
  "parameters": { "comparator": ">", "threshold": 0.02, "consecutive": 3 }
}
```

Here `churn` must be the actual semantic ID of an imported ratio series whose risk population is defined. Wrap the definition in `{baseVersion,value}` when saving. The rule confirms only after three consecutive complete valid periods; a gap breaks confirmation. Severity is configured, not a probability. Signal `value` keeps the observed unit, while `deviationMagnitude`, `deviationUnit` and `thresholdUnit` report method scores separately.

Use `/query?offset=0&limit=100` for bounded original-data pages. Explicit aggregation obeys snapshot/flow/rate meaning. `/waterfall` reconciles real opening/closing/component values, and OHLC queries require real intraperiod observations or validated imported OHLC. Missing observations stay missing. Neither pooled segment rates nor a monthly scalar invents temporal cohort churn or candlestick wick variation.

Long calculations use `POST D/jobs` with `{kind,input}`. Inspect `/jobs/ID` for progress, `/jobs/ID/result` for item pages and DELETE `/jobs/ID` to cancel/erase. Import, query, waterfall, measurement, indicator, signal, validation and scenario computations use the same engine as UI previews. Saving an analysis archive uses `POST /jobs/ID/archive` at the current version. Saved `/results/ID/content` pages numerical content; `/results/ID/input?datasetId=ID&offset=0&limit=100` reconstructs the retained original observations after a refresh. Query/inspection/waterfall view jobs do not create archives.

Response pages allow 1–1,000 items and analytics responses have an 8 MiB budget, separate from the existing 32 MiB request transport. The browser file-size preference does not enlarge either. Two API jobs can run concurrently; four terminal jobs and 32 MiB total transient inputs/results remain for up to 15 minutes, with a 120-second calculation deadline. Lock, reload or original-grant revocation erases them. Saved encrypted archives have explicit retention of 12 results and 3 dataset-version sets; removing an archive also removes its original input.

An available, unlocked browser with the right grant remains necessary for headless analysis. Analysis and polling never extend its idle session. Read only allows pure previews, data/result queries and transient cancellation; saving imports, definitions, histories or archives requires write access. Existing operation reservations, exact retry identities and `baseVersion` checks apply. Inspect a timed-out write's receipt and saved model before retrying; it may already have committed.

## Handle versions, failures and boundaries

| Status | Typical action                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------- |
| 401    | Supply the configured local token.                                                                   |
| 403    | Check consent, browser access, trusted origin and local-connection policy.                           |
| 409    | Read the error: refresh a stale version, wait for a result or resolve competing execution.           |
| 423    | Human unlock required: preserve `WORKSPACE_LOCKED`, unlock in the browser and issue a fresh request. |
| 422    | Correct the supplied fields or semantic references.                                                  |
| 428    | Include a required simulation `baseVersion`.                                                         |
| 503    | Start/reconnect the granted browser workspace.                                                       |

The JSON/HTTP and WebSocket envelope is 32 MiB, independently of the UI's import-size preference. Analysis and simulation have their own structural limits and deadlines. Invalid or safety-limited work is not reported as a complete success.

Local integration is not a remote multi-user API. It has no cloud tenancy, account authorization or unattended server-side execution. Use the current bundled contract for supported behavior and keep the local executable in step with the app version.

[Complete API/MCP guide](/help/api-mcp/) · [Security model](/security/) · [Open the workspace](/app/)
