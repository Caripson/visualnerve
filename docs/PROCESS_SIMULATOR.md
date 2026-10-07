# Process Simulator

Process Simulator is a separate template and document type for seeing how work, shared capacity and economics affect a whole system. Create it from the template selector, configure assumptions, run it, inspect queues and change assumptions before another run. AI and MCP are optional.

## Guided construction and visual traffic

The UI's **Process Simulator** card starts empty (`process-simulator-blank`). A four-step wizard creates a validated Source → Work → Outcome model, with optional shared capacity, explicit arrivals, processing/transfer times, patience, revenue and hourly costs. Apply is one undoable graph/model change. **Kiosk + package pickup** keeps the original `process-simulator` example key; existing API creation defaults and example links remain compatible. Built-in template graphs are discoverable through `GET /templates`; the wizard produces the same typed model accepted by the simulation PUT endpoint.

Selected nodes expose **Add next**, **Add previous** or **Add work**. Inserting into a single existing process path preserves the original outgoing route properties. Resource-bound additions reuse the same resource ID. New connections disclose and persist three seconds of real transfer; existing zero-time transfers stay instantaneous. Node creation, edges and semantic configuration commit together and undo together.

The live 2D canvas renders traffic from current queue, capacity, utilization, blocking and shared-resource waiters. Green means clear flow; yellow means at least 85% current occupancy, a forming queue or scaling; red requires queued work with saturation or resource blocking (processing failures also show red). Labels/icons accompany colors. Incoming flow routes show their destination's congestion; dashed resource requirements carry no particle flow. Queue counts stay on node cards, while bounded queue/particle samples are drawn on one canvas. Motion interpolates observed simulation timestamps; pause/replay freezes it. Rendering never advances the engine. The UI starts at 10× for legible transfers; all speeds and headless mode retain the same deterministic results.

Main desktop KPIs use a stable card grid. More metrics expands the remaining measures; the current bottleneck is shown directly. Metrics toggles dashboard visibility without changing the run, allowing more canvas space. Mobile keeps playback in its compact strip and all settings/metrics in the existing detail sheet.

Guided construction is split between `starter.ts`, `ProcessWizard.tsx`, `StarterFields.tsx` and `StarterReview.tsx`. Connected-node edits live in `nodes/connected-node.ts` with a separate `NodeQuickAdd.tsx` control. Traffic classification, bounded scene construction and observed-clock interpolation are isolated in `traffic.ts`, `particle-scene.ts` and `render-clock.ts`; `ParticleOverlay.tsx` draws their output on one canvas. None of these modules replaces the simulation engine or stores a second business model.

## One model and one engine

The document identifies itself with `diagram.type: "process-simulator"` and an explicit `graph.simulation` payload containing `type: "process-simulator"` and `schemaVersion: 1`. Native graph nodes/edges supply positions, styling and ordinary diagram exports. The typed simulation model supplies business semantics. Canvas coordinates never determine processing, capacity or routing.

The deterministic discrete-event engine is independent of React, rendering and frame rate. Arrivals, queues, processing, resource acquisition/release, routing, abandonment, scaling and completion use a simulated clock. Seeded random streams determine stochastic arrivals and complexity. UI controls, REST and MCP call the same worker service and engine. Speed changes playback, not business results.

The live particle/queue/capacity view is currently 2D. Work and Resource capacity appears as separate full native cards: scaling a Counter from one unit to three displays Counter 1, Counter 2 and Counter 3. The cards retain the logical object's native appearance and connections and contract again when actual capacity scales down. They are read-only runtime projections of one logical Work node or shared Resource; their ordinal labels identify anonymous capacity units, not persistent named employees or independently editable process nodes. Busy/available indications derive from actual aggregate occupancy. The shared queue is displayed once, at the first capacity card.

Capacity presentation is bounded to eight full cards per bank and 256 additional cards across the live view; further capacity is explicitly labelled as an aggregate. These visual limits never reduce simulated capacity or population metrics. MCP/API clients continue to inspect and change the one logical node/resource using its semantic ID, capacity, busy count, queue, utilization and scaling events. `GET /simulation/capabilities` describes the projection under `visualCapacity`. Native JSON/backup retain the logical model and saved geometry; the temporary capacity-card projections do not become extra model nodes.

Existing 3D diagram viewing remains available with the logical model and live numeric metrics; return to 2D for particles and full capacity-card banks. The renderer consumes actual engine state. Moving particles follow real transit timestamps and valid flow edges; queued work remains associated with its constrained Work node. A sampled processing lease may associate a particle with a visible capacity unit; without an observed lease it uses the logical hub rather than inventing hidden worker identities. Resource allocation links are dashed connections, distinct from particle-flow edges. During a run their read-only projection follows the captured scenario and enabled improvements; it does not overwrite baseline connections. Work cards name their actual required resources, including resources without a visible canvas shape. Particle snapshots are bounded samples; population metrics cover all work.

## Configuration and units

Models contain particle types, Sources, Work nodes, Routers, shared Resources and Outcomes. Work can require several resource units simultaneously. Two Work nodes referencing one resource compete for the same capacity. A resource configuration can exist without a visible shape; add a Resource node with `resourceId` to place it on the canvas.

Time values use **simulated seconds**. Arrival rates and operating costs use **per-hour** units. Work/resource `costPerHour` is per available capacity unit, including idle time while scheduled open and active overtime outside availability. Scaling `additionalCostPerHour` is a surcharge on extra units in addition to their regular cost; it accrues continuously until those units scale down, including closed/idle periods. All money uses the model's three-letter currency code. Complexity changes processing requirements. Source schedules, bursts/counts, accepted types, priority/FIFO queues, patience, overflow and router conditions remain explicit editable assumptions. Schedule windows may repeat: `{startSeconds:0,endSeconds:43200,repeatSeconds:86400}` opens twelve hours each day, including week/year runs. Omit `repeatSeconds` for a single window and use `maxCount` only when arrivals should have a finite total limit.

Scaling rules specify minimum/maximum capacity, increments, queue/utilization triggers, delays, cooldowns and optional extra operating/scale-up cost. Scale-down waits for the low-utilization period and respects active allocations/minimum capacity. Improvements describe investment, operating cost and processing/resource/capacity/cost/revenue changes.

A Resource's `minCapacity` is the scaling floor when `scaling.minCapacity` is omitted; an explicit lower scaling minimum is rejected. First-match routers evaluate rules in their configured order. Weighted routing with no positive eligible branch uses its explicit, type-compatible fallback, or records a failed particle when no valid fallback exists.

An improvement needs a valid Work/Outcome node or shared resource target; every supplied target must exist. A resource improvement remains scoped to that resource: reducing staff units does not reduce counter units, and staff capacity/cost modifiers do not change a Work node's slots or per-item cost. Its processing/revenue/failure effects apply to Work nodes using that resource. A Work improvement can adjust its own processing, capacity, costs and resource requirements. Work/resource revenue modifiers update carried expected revenue when processing completes, including its value if later lost. An Outcome improvement supports revenue and economic effects and aligns expected/realized value at completion; non-neutral processing/capacity/failure settings are rejected. Enabled capacity increases must respect configured maximums, and any failure route requires a real outgoing flow edge from each affected Work node.

Play, Pause, Stop and Reset operate on a captured model/scenario. Speeds are 1×, 10×, 100× and MAX. MAX/headless processes events without waiting for animation. Choose duration or use the model default. A run freezes model, scenario, seed and duration; later edits cannot change its recorded result. Reset creates a new run and preserves the previous result. Choose Finish workload to stop arrivals at the configured horizon and drain existing work. Editing assumptions during a run offers Rerun against the changed model; metrics remain associated with their captured run until then. Normal editors cover routes, schedules, shared-resource bindings, investments and scaling; full JSON remains available for advanced configurations. UI deletion cleans dependent references in one undoable Apply operation, while API deletion rejects unresolved dependencies so an external caller can choose its own replacement.

Headless requires no selected diagram, canvas or animation loop. **A connected browser remains required** for local IndexedDB and Web Worker execution. Closing the browser ends execution. Reopening preserves models/results; deterministic replay reconstructs saved inputs. There is no mandatory backend, cloud database, SQLite or AI dependency.

## Kiosk example

The bundled kiosk explicitly assumes a repeating **12-hour opening day followed by twelve closed hours**, evenly spaced regular arrivals, 300 store customers and 10 package customers per opening day. Arrival and resource availability windows repeat every 86,400 seconds without a one-day total arrival cap. Purchases take 120 seconds; packages 240 seconds; each flow edge adds 3 seconds of travel. Both require one shared employee and counter. Staff costs 180 SEK/hour while scheduled available. Store revenue is 85 SEK/customer; package fee 20 SEK/customer. Patience is 240 seconds for store customers and 480 seconds for packages. All assumptions are illustrative, editable and persisted.

The 12-hour opening assumption matters: one eight-hour employee cannot supply the baseline's 640 processing minutes. The template does not hide that shortfall by inventing throughput.

Scenarios retain Baseline and change explicit overrides:

- **1,000 packages/day** exposes pressure on the shared staff/counter.
- **+1 package employee** moves packages to paid package staff while retaining shared-counter contention.
- **+2 package employees and dedicated counter** removes shared-counter demand from package work and supplies two paid workers and parallel processing slots.

Compare package throughput/waiting with core waiting/lost revenue, resource utilization, cost and contribution. Added paid capacity applies its configured cost.

## Metrics and comparison

Metrics cover created, completed, abandoned, failed and active work; current/average/maximum queues; throughput; node/resource utilization and capacity; emergent bottlenecks; expected/realized/lost revenue; operating/resource/scaling/investment cost; contribution and cash impact. Waiting, cycle time and time-to-revenue derive from simulation timestamps. TTR is creation-to-revenue realization, with type/route distributions. Particle/type costs allocate per-item charges and processing-time Work/resource costs by cumulative per-slot/resource-unit integrals, including proportional surcharges from actual extra capacity and changes during processing. Idle capacity, feature overhead, investments and fixed scale-up charges may remain in the whole-system ledger, so summing type costs does not necessarily reproduce total system cost.

P95/P99 are null when observations are insufficient. Larger populations use bounded histograms; `approximate` and `resolutionSeconds` disclose precision. Average queues/utilization integrate actual state over simulated time. Bottlenecks rank observed queue/wait/utilization and can migrate after capacity changes.

Scenarios use typed overrides keyed by semantic IDs and never mutate Baseline. Within entity and economics overrides, JSON `null` removes an inherited optional property; arrays replace complete values. For example, `overrides.nodes[workId].work.scaling = null` disables inherited scaling, while `overrides.economics.maximumBudget = null` removes the baseline budget for that scenario. These removal markers survive save/export/reload. Required properties, entity IDs and node types cannot be removed; the resolved model is validated. Comparison reports whole-system deltas, incremental cash impact and a payback time only when observed simulated cash crosses the investment; otherwise `paybackReached:false` and `paybackTimeSeconds:null`. An observed crossing at simulation time zero is valid and reported as zero. Cash timeline points expose `operatingCostFixed` for per-item charges, preserving their event-time jumps separately from continuously accrued operating costs when calculating payback. Outcomes depend on the user's persisted assumptions, horizon and distributions.

## Local API and MCP

Use the existing local `/api/v1` API or `visual_nerve_request` with paths **without** `/api/v1`. Start with `visual_nerve_api_docs`; `{"document":"openapi"}` returns every exact schema. Documentation works without a browser. Workspace/model/run commands require its storage acceptance and MCP grant.

| Operation | Route/input |
| --- | --- |
| Capabilities | `GET /simulation/capabilities` |
| Discover documents | `GET /diagrams?type=process-simulator` |
| Create | `POST /diagrams {name,type:"process-simulator"}` |
| Full model | `GET /diagrams/{id}/simulation` |
| Replace model | `PUT .../simulation {baseVersion,model}` |
| Entity collections | `.../simulation/nodes`, `edges`, `particle-types`, `resources`, `improvements`, `scenarios` |
| Read/create collection | `GET`; `POST {baseVersion,value}` |
| Read/patch/delete entity | `GET .../{entityId}`; `PATCH {baseVersion,value}`; `DELETE .../{entityId}?baseVersion=N` |
| Economics/defaults/retention | `GET/PUT .../simulation/{field}`; PUT takes `{baseVersion,value}` |
| Start run | `POST .../simulation/runs {durationSeconds?,seed?,scenarioId?,demandMultiplier?,speed?,animated?,untilComplete?}` |
| Run list/info | `GET .../simulation/runs[/{runId}]` |
| Inspect | `GET .../runs/{runId}/state`, `result`, `metrics`, `queues`, `bottlenecks` |
| Entity metrics | `GET .../runs/{runId}/nodes[/{id}]`, `resources[/{id}]`, `particle-types[/{id}]` |
| Events | `GET .../runs/{runId}/events?offset=0&limit=100` (limit 1–1,000) |
| Controls | `POST .../runs/{runId}/pause`, `resume`, `stop`, `reset` with exact `{}` |
| Live speed | `POST .../runs/{runId}/speed {speed:1\|10\|100\|"max"}` |
| Replay | `POST .../runs/{runId}/seek {timeSeconds}` after pausing/completing |
| Compare | Exact `POST .../simulation/compare {runIds:[baselineRunId,scenarioRunId,...]}` |

Model/entity mutation returns the updated Graph. Use its latest `diagram.version` as the next `baseVersion`. Missing versions return 428, stale versions 409 and invalid models 422 without partial writes. Native node/edge IDs are UUIDs; readable IDs supplied during creation are retained as external aliases and remapped consistently. Read back the canonical model before subsequent entity edits. Resource/type/scenario IDs may remain readable strings and must be URL-encoded when used in path segments.

Entity PATCH merges nested objects, replaces arrays and uses JSON `null` to remove optional properties. Scenario PATCH retains null markers inside `overrides` so they continue to remove baseline properties when the scenario resolves. Complete model/configuration PUT and collection POST accept complete validated values, rather than removal markers. External run creation, Reset and replay seek are governed by the current write grant even when the original run was created in the UI or loaded from the archive; revoking that grant stops the external execution/replay without changing an already saved final result.

PATCH merges nested fields: `{value:{work:{capacity:8}}}` preserves processing time and other Work settings. Referenced-resource deletion fails validation rather than erasing processing requirements. Deleting a node removes incident flow edges; other invalid references must be corrected explicitly.

Inspection and exact comparison permit **Read only**. Model/run changes require **Read + write**. External runs stop when their grant or storage consent is revoked. Go forwards commands/responses; it has no shadow model or separate engine. Structured errors preserve `error` and may add `code` and `issues` with semantic paths.

Runs return asynchronous IDs immediately. Poll state/result. A result not yet available, or a worker initializing before its first snapshot, returns 409. Existing JSON/WebSocket envelopes remain 32 MiB; do not hold one HTTP request open for a long simulation.

### Deterministic example

Replace a new model at its current `baseVersion` with:

```json
{
  "type": "process-simulator", "schemaVersion": 1, "currency": "SEK",
  "particleTypes": [{"id":"customer","name":"Customer","color":"#2563eb","revenue":100,"complexity":{"min":1,"max":1},"priority":1}],
  "nodes": [
    {"id":"source","name":"Arrivals","type":"source","source":{"particleTypeId":"customer","burst":10,"maxCount":10}},
    {"id":"work","name":"Service","type":"work","work":{"processingSeconds":60,"capacity":1,"queueDiscipline":"fifo"}},
    {"id":"revenue","name":"Revenue","type":"outcome","outcome":{"status":"completed","revenue":true}}
  ],
  "edges": [
    {"id":"arrival","sourceNodeId":"source","targetNodeId":"work","travelSeconds":0},
    {"id":"complete","sourceNodeId":"work","targetNodeId":"revenue","travelSeconds":0}
  ],
  "resources": [], "improvements": [], "scenarios": [],
  "defaults": {"durationSeconds":3600,"seed":42}
}
```

Start with `{"seed":42,"durationSeconds":3600,"untilComplete":true,"animated":false}`. Poll `/result` using the returned ID. Ten particles complete, revenue is 1,000 SEK, no one abandons and the last completion is at 600 simulated seconds. Repeat identical inputs to compare deterministic metrics/events. Stress tests can run `demandMultiplier` 1.0 through 1.5 and compare separately identified results without manual canvas edits.

## Retention, persistence and compatibility

Models/scenarios persist locally and accompany native JSON, history/duplication and workspace backup. Simulator schema version 1 is separate from exchange format version 1 and IndexedDB schema version 8. Existing diagram types stay unchanged; absent simulation content never reinterprets them as simulators.

Defaults retain 300 particle snapshots and 2,000 semantic events, capped at 10,000 and 100,000. Event pages disclose retained/dropped counts. Population metrics remain complete. Archives retain up to 30 runs per diagram. `retention.checkpoints` controls checkpoints per run, capped at 240 and defaulting to 240 when omitted: zero stores none, one keeps the latest, and two or more retain a thinned set including the endpoints. Replay uses immutable model/seed/options, so it does not require every frame, checkpoint or event.

Active work remains materialized for correctness. Rendering is sampled/aggregated separately; large arrivals may still consume substantial worker memory. Validated topology ceilings are 50,000 semantic nodes and 200,000 flow edges; the maximum configured horizon is ten simulated years. These ceilings do not promise interactive performance for every workload.

Execution safety limits are discoverable at `/simulation/capabilities` under `execution.limits`: 200,000 simultaneously active particles, 50,000,000 scheduled or semantic events per run, 10,000 route visits per particle, four resident execution/replay workers and sixty cached runs. The `activeRuns` compatibility field includes paused resident workers, transient replay workers and synchronous startup reservations. Simultaneous external starts/seeks cannot exceed that shared worker ceiling; a fifth is rejected with 409 before another worker starts. The compatibility field `semanticEvents` includes popped internal scheduled events in its ceiling, including repeating availability while draining a workload beyond the arrival horizon. Reaching an active-particle/event ceiling stops that run with `status:"failed"`, an explicit `message` and partial population metrics; the engine does not silently discard excess work or report success. An excessively looping particle fails with a semantic event. Cache eviction preserves the separately retained local run archive.

## Implementation modules

- `frontend/src/simulation/types.ts`, `schema.ts` and `scenario-patch.ts`: public versioned model, semantic validation, serializable scenario differences and resolution.
- `engine.ts`, `engine-state.ts`, `event-queue.ts`, `random.ts`, `ring.ts`, `statistics.ts`, `economics.ts`: deterministic execution, bounded state, statistics and cash comparison.
- `worker.ts`, `client.ts`, `protocol.ts`, `service.ts`, `useSimulation.ts`: one execution/inspection/control service used by UI and the local API.
- `SimulationFeature.tsx`, `ScenarioControls.tsx`, `ModelEditor.tsx`, `editor/*`, `fields.tsx`, `MetricsDashboard.tsx`, `NodeSummary.tsx`, `ParticleOverlay.tsx`, `render-model.ts`, `simulation.css`: controls, assumption editing, comparisons, actual state rendering, scenario/resource projection and bounded particles.
- `capacity-projection.ts`, `capacity-layout.ts`, `capacity-edges.ts`, `presentation-slots.ts`, `particle-view.ts`: bounded full native capacity cards, collision layout, shared-input edge fans, observed processing placements and semantic particle paths. These modules do not change business state or persist visual clones.
- `document.ts`, `deletion.ts`, `copy.ts`, `clipboard.ts`, `storage.ts`, `run-store.ts`, `backup.ts`, `archive-validation.ts`, `examples.ts`: native canvas identity, reference cleanup, kiosk example and local archives.
- `frontend/src/storage/simulation-commands.ts`: semantic REST/MCP command routing; `repository.ts` delegates using existing conventions.
- Existing integration changes: `App.tsx`, `canvas/{Canvas.tsx,navigation.ts}`, `nodes/registry.tsx`, `components/Properties.tsx`, `model/{types,validation}.ts`, `storage/database.ts`, `state/{editor,history,clipboard}.ts`, `history/{backup,compare,store}.ts`, `export/semantic.ts`, `templates/{manifest.json,templates.ts}`, `integration/{access,bridge,setup}.ts`.
- Go contract/discovery changes: `backend/cmd/openapi/{main,simulation}.go`, `backend/internal/model/model.go`, `backend/internal/server/{server,mcp,mcp_description,mcp_discovery,mcp_tools,simulation_description}.go`. Go forwards to the connected browser rather than owning another simulation engine.
- Documentation: `API.md`, `EXPORT_FORMAT.md`, `docs/openapi.yaml`, `docs/PROCESS_SIMULATOR.md`, `docs/PROCESS_SIMULATOR_ACCEPTANCE.md`, `hugo/content/help.md`.
- Tests: `frontend/tests/simulation-*.test.{ts,tsx}`, `frontend/tests/e2e/simulation-{ui,api}.spec.ts`, new Go simulation/OpenAPI tests and existing fixture updates for the additive IndexedDB v8 upgrade and template selection.
