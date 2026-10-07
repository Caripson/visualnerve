---
layout: product
title: "Build against one local diagram model"
description: "Use Visual Nerve's REST API and MCP tools for versioned diagrams, source analysis, 3D views and deterministic process simulations."
eyebrow: "Developers"
summary: "Discover the contract, target the browser workspace and use the same model as the interface."
---

[API reference](/api/docs/) · [Download OpenAPI](/openapi.yaml) · [Local bridge setup](/mcp/)

## Understand the execution boundary

The React application owns working state and IndexedDB persistence. The optional Go executable forwards REST and MCP requests through a local WebSocket to the connected browser. Validation and transactions apply before a mutation is reported as successful.

No application database runs in the Go process. Starting the executable alone does not provide your diagrams. Keep the intended browser workspace open, accept required storage and grant Read only or Read + write access in Settings.

An available source checkout builds with `./build.sh`, producing `public/` and `bin/visual-nerve`. The repository documents its toolchain requirements; repository access may require authorization. The original project code uses [MPL-2.0 with separate third-party terms](/license/).

```sh
./bin/visual-nerve --static ./public --bridge --addr 127.0.0.1:4317
```

Open `http://127.0.0.1:4317/app/`. For a separately hosted app, configure its exact allowed origin and any trusted local TLS required by the browser. [Connection steps](/help/api-mcp/).

## Check and read with REST

```sh
curl --fail-with-body http://127.0.0.1:4317/api/v1/health
curl --fail-with-body http://127.0.0.1:4317/api/v1/diagrams
```

Health reports server/bridge status; a healthy process does not by itself imply a connected, granted browser. Diagram inspection needs that browser and read access.

If a bridge token is configured, add `Authorization: Bearer YOUR_LOCAL_TOKEN` to integration requests. When several distinct workspaces are connected, add `X-Visual-Nerve-Workspace: WORKSPACE_UUID`; find the value in Settings → Data & Privacy → Storage details. MCP uses the equivalent `workspaceId` argument.

## Create a small diagram

Enable Read + write, then create an empty flowchart:

```sh
curl --fail-with-body \
  -X POST http://127.0.0.1:4317/api/v1/diagrams \
  -H 'Content-Type: application/json' \
  --data-binary '{"name":"Customer onboarding","type":"flowchart"}'
```

The response is a Diagram object. Copy its `id` into the following placeholder before running the node request:

```sh
DIAGRAM_ID='REPLACE_WITH_RETURNED_UUID'

curl --fail-with-body \
  -X POST "http://127.0.0.1:4317/api/v1/diagrams/${DIAGRAM_ID}/nodes" \
  -H 'Content-Type: application/json' \
  --data-binary '{"title":"Contract signed","nodeType":"process","description":"Confirm the owner and the delivery date.","x":100,"y":100}'
```

The UI reads the same saved object. For larger imports, use `POST /diagrams/{id}/bulk` with stable external IDs and `upsert: true`. Read the current diagram version before sending `baseVersion` for graph/model writes. Individual node/edge updates use their current entity version. Exact schemas and response types are in OpenAPI.

## Use MCP without inventing a second API

Point a compatible Streamable HTTP client at `http://127.0.0.1:4317/mcp`, or its matching trusted HTTPS address. Use the client's documented connection and authorization configuration rather than assuming that every Claude or Codex installation has the same menus.

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

## Work with Codex and Claude

Start either client with Read only access. Ask it to discover the API, list the available diagrams and identify the workspace and diagram IDs before making requests. A node's screen position is not a substitute for its semantic properties. Review a proposed change before granting Read + write.

For a Codex session that will build a diagram, use a concrete brief:

> Connect through the Visual Nerve MCP server. Read visual_nerve_api_docs first. Inspect the existing diagrams and propose a service-delivery mind map with clear owners and directed dependencies. Show me the objects and relationships before saving. Use stable external IDs for repeatable bulk updates, retain a readable 2D layout, and enable 3D only if I request it.

For a Claude session that will explain a process, start with inspection:

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

`GET /diagrams/{id}/simulation/hierarchy` returns roots, child groups and direct/recursive node membership. `GET /diagrams/{id}/simulation/runs/{runId}/processes/{processId}` returns observed queues, utilization, cycle time, economics and bottlenecks. These are the same values shown in the UI, independent of visual placement. Discover the complete contract through `visual_nerve_api_docs` and `/simulation/capabilities` before building a model with Codex or Claude.

Parent totals include descendants. Scope completion counts successful visits, while global completion counts final Outcomes. Scope resource costs allocate occupied units; idle shared-pool costs remain global. Read the capability metadata and full schema when comparing values across levels.

## Handle versions, failures and boundaries

| Status | Typical action                                                                             |
| ------ | ------------------------------------------------------------------------------------------ |
| 401    | Supply the configured local token.                                                         |
| 403    | Check consent, browser access, trusted origin and local-connection policy.                 |
| 409    | Read the error: refresh a stale version, wait for a result or resolve competing execution. |
| 422    | Correct the supplied fields or semantic references.                                        |
| 428    | Include a required simulation `baseVersion`.                                               |
| 503    | Start/reconnect the granted browser workspace.                                             |

The JSON/HTTP and WebSocket envelope is 32 MiB, independently of the UI's import-size preference. Analysis and simulation have their own structural limits and deadlines. Invalid or safety-limited work is not reported as a complete success.

Local integration is not a remote multi-user API. It has no cloud tenancy, account authorization or unattended server-side execution. Use the current bundled contract for supported behavior and keep the local executable in step with the app version.

[Complete API/MCP guide](/help/api-mcp/) · [Security model](/security/) · [Open the workspace](/app/)
