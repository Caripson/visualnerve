# Process Simulator

Process Simulator is a separate template and document type for seeing how work, shared capacity and economics affect a whole system. Create it from the template selector, configure assumptions, run it, inspect queues and change assumptions before another run. AI and MCP are optional.

## Guided construction and visual traffic

The UI's **Process Simulator** card starts empty (`process-simulator-blank`). A four-step wizard creates either a single Source → Work → Outcome flow or a main process with an ordered set of subprocesses. Each subprocess starts with a real, editable Work node and its own processing time, capacity, hourly cost and optional use of the shared pool. The wizard supports one to twelve subprocesses; deeper nesting, routing and additional Work nodes can be added in Assumptions afterwards. Arrivals, transfer times, patience, revenue and shared-resource costs remain explicit. The review lists each step and its assumptions before applying the model. Apply is one undoable graph/model change. **Kiosk + package pickup** keeps the original `process-simulator` example key; existing API creation defaults and example links remain compatible. Built-in template graphs are discoverable through `GET /templates`; the wizard produces the same typed model accepted by the simulation PUT endpoint.

Selected nodes expose **Add next**, **Add previous** or **Add work**. Inserting into a single existing process path preserves the original outgoing route properties. Resource-bound additions reuse the same resource ID. New connections disclose and persist three seconds of real transfer; existing zero-time transfers stay instantaneous. Node creation, edges and semantic configuration commit together and undo together.

The live 2D canvas renders traffic from current queue, capacity, utilization, blocking and shared-resource waiters. Green means clear flow; yellow means at least 85% current occupancy, a forming queue or scaling; red requires queued work with saturation or resource blocking (processing failures also show red). Labels/icons accompany colors. Incoming flow routes show their destination's congestion; dashed resource requirements carry no particle flow. Queue counts stay on node cards, while bounded queue/particle samples are drawn on one canvas. Motion interpolates observed simulation timestamps; pause/replay freezes it. Rendering never advances the engine. The UI starts at 10× for legible transfers; all speeds and headless mode retain the same deterministic results.

Main desktop KPIs use a stable card grid. More metrics expands the remaining measures; the current bottleneck is shown directly. Metrics toggles dashboard visibility without changing the run, allowing more canvas space. Mobile keeps playback in its compact strip and all settings/metrics in the existing detail sheet.

Guided construction is split between `starter.ts`, `ProcessWizard.tsx`, `StarterFields.tsx`, `StarterProcessFields.tsx` and `StarterReview.tsx`. `ProcessStarterBuilder` in `starter-builder.ts` constructs the validated semantic model; `ProcessStarterAnalysis` in `starter-analysis.ts` calculates review facts and capacity warnings from those same assumptions. Connected-node edits live in `nodes/connected-node.ts` with a separate `NodeQuickAdd.tsx` control. Traffic classification, bounded scene construction and observed-clock interpolation are isolated in `traffic.ts`, `particle-scene.ts` and `render-clock.ts`; `ParticleOverlay.tsx` draws their output on one canvas. None of these modules replaces the simulation engine or stores a second business model.

## One model and one engine

The document identifies itself with `diagram.type: "process-simulator"` and an explicit `graph.simulation` payload containing `type: "process-simulator"` and `schemaVersion: 1`. Native graph nodes/edges supply positions, styling and ordinary diagram exports. The typed simulation model supplies business semantics. Canvas coordinates never determine processing, capacity or routing.

The deterministic discrete-event engine is independent of React, rendering and frame rate. Arrivals, queues, processing, resource acquisition/release, routing, abandonment, scaling and completion use a simulated clock. Seeded random streams determine stochastic arrivals and complexity. UI controls, REST and MCP call the same worker service and engine. Speed changes playback, not business results.

The live particle/queue/capacity view is currently 2D. Work and Resource capacity in the full flow appears as separate full native cards: scaling a Counter from one unit to three displays Counter 1, Counter 2 and Counter 3. The cards retain the logical object's native appearance and connections and contract again when actual capacity scales down. In the full flow, the original primary card remains editable: moving, resizing or editing it changes the saved logical object. Additional capacity cards and compact hierarchy placements are read-only runtime projections; their ordinal labels identify anonymous capacity units, not persistent named employees or independently editable process nodes. Busy/available indications derive from actual aggregate occupancy. The shared queue is displayed once, at the first capacity card. Compact hierarchy views keep shared resources in one pool summary card per resource, with actual capacity, occupied-unit indicators and queue counts; Work capacity banks remain visible inside the open subprocess.

Capacity presentation is bounded to eight full cards per bank and 256 additional cards across the live view; further capacity is explicitly labelled as an aggregate. These visual limits never reduce simulated capacity or population metrics. MCP/API clients continue to inspect and change the one logical node/resource using its semantic ID, capacity, busy count, queue, utilization and scaling events. `GET /simulation/capabilities` exposes `visualCapacity.primaryEditable: true`, `additionalCardsReadOnly: true` and `compactHierarchyReadOnly: true`. The deprecated compatibility flag `readOnly: true` applies only to the additional and compact projections; it does not restrict the original primary card in the full flow. Native JSON/backup retain the logical model and saved geometry; the temporary capacity-card projections do not become extra model nodes.

Existing 3D diagram viewing remains available with the logical model and live numeric metrics; return to 2D for particles and full capacity-card banks. The renderer consumes actual engine state. Moving particles follow real transit timestamps and valid flow edges; queued work remains associated with its constrained Work node. A sampled processing lease may associate a particle with a visible capacity unit; without an observed lease it uses the logical hub rather than inventing hidden worker identities. Resource allocation links are dashed connections, distinct from particle-flow edges. During a run their read-only projection follows the captured scenario and enabled improvements; it does not overwrite baseline connections. Work cards name their actual required resources, including resources without a visible canvas shape. Particle snapshots are bounded samples; population metrics cover all work.

## Main processes and subprocesses

A main process is a semantic scope containing real nodes and, optionally, further subprocesses. A subprocess can contain its own Sources, Work nodes, Routers and Outcomes. Each Work node owns its processing time, capacity, queue, scaling, resource requirements and costs. Parent containers add no processing delay, capacity or economic charge of their own.

The additive schema stays at version 1:

```json
{
  "processes": [
    {"id": "order-delivery", "name": "Order delivery"},
    {"id": "validation", "name": "Validation", "parentId": "order-delivery"},
    {"id": "warehouse", "name": "Warehouse", "parentId": "order-delivery"},
    {"id": "picking", "name": "Picking", "parentId": "warehouse"}
  ],
  "nodes": [
    {
      "id": "validate-order", "name": "Validate order", "type": "work",
      "processId": "validation",
      "work": {"processingSeconds": 120, "capacity": 2, "costPerHour": 50}
    },
    {
      "id": "pick-items", "name": "Pick items", "type": "work",
      "processId": "picking",
      "work": {
        "processingSeconds": 300, "capacity": 3,
        "resourceRequirements": [{"resourceId": "warehouse-staff", "units": 1}]
      }
    }
  ]
}
```

This is a fragment of the full model: particle types, valid flow edges, the `warehouse-staff` resource, outcomes and other required collections must also be supplied. `processes` is optional in older documents; its absence means a flat process. `parentId` is optional for a root scope. `node.processId` is optional for an ungrouped step. Scope IDs are semantic strings independent of canvas node IDs. Duplicate IDs, unknown parents or members, cycles, unsupported process properties and more than 128 nested levels are rejected. The maximum number of declared scopes is 50,000, subject to the existing import, topology and execution limits.

In Assumptions → Processes, add a main process or subprocess, choose its parent and assign existing steps. Edit each actual Work step's settings in the normal node editor. Open a process card to drill into its children; breadcrumbs lead back through the parent scopes. All steps shows the complete logical flow. Collapsing a process changes presentation only: every child still executes and every required resource remains the same shared pool. Cross-boundary connections represent actual underlying model edges, and live congestion on a process card comes from its authoritative scope metrics.

Deleting a group in the UI preserves its Work nodes and lifts direct members and direct subprocesses to its parent; nested descendants retain their relationships. Apply and Undo include the hierarchy and its reference changes. The API deliberately requires an external client to reassign dependent children/members in an atomic full-model PUT before deleting a referenced group.

### Scope metrics and whole-system metrics

Every current engine snapshot and result exposes `processes`, keyed by process ID. Each entry rolls up direct members and all descendant subprocesses. It includes topology (`nodeIds`, `childProcessIds`, `resourceIds`), actual shared-unit usage, queue distributions, scope WIP, throughput, utilization, cycle time, economic values and observed bottlenecks. Parent and child entries overlap; **do not add a parent to its children**, and do not add child percentiles or maxima to create a parent statistic.

| Metric | Meaning in a process scope |
| --- | --- |
| `entered` | Number of scope visits. Leaving and later re-entering creates another visit. |
| `completed` | Scope visits that finished through a boundary exit or a successful terminal Outcome. This is distinct from whole-system completed particles. |
| `exited` | The subset of completed visits that continued into a node outside this scope. |
| `terminalCompleted` | The subset completed by a final successful Outcome inside this scope. |
| `inSystem` | Current work in this scope. Outbound transit belongs to the departing scope until the particle arrives at its next actual node. |
| `abandoned`, `failed` | Visits terminated by abandonment or failure while in the scope. |
| `throughputPerHour` | Completed scope visits divided by elapsed simulated hours. |
| `cycleTime` | Entry-to-boundary-arrival or entry-to-successful-terminal time for each completed scope visit, including its actual waiting and travel. |
| `ttr` | Scope entry to a revenue-producing terminal Outcome inside this scope. Global TTR remains particle creation to revenue realization. |
| `queue` | The combined concurrent queue at descendant Work nodes, integrated over simulated time. Its maximum is the actual simultaneous peak. |
| `queue.wait` | Observed individual Work queue waits across those nodes, including immediate starts with zero wait. Percentiles are computed from these samples. |
| `processing` | Completed Work operation durations in the scope, rather than a sum of step averages. |
| `utilization` | Total occupied Work slot-time divided by available Work slot-time, including schedules and actual scaling. |

A parent keeps one visit while a particle moves between its children. Its cycle-time distribution comes from that parent visit, rather than summed child means. For each scope, `entered = completed + abandoned + failed + inSystem`; `completed = exited + terminalCompleted`. These equalities count visits and remain valid when a route loops. Global `metrics.created` and `metrics.completed` retain their original particle-level meanings.

Scope bottlenecks use actual descendant Work queue pressure and shared-resource contention. Resource candidates use the queue areas and wait observations of that scope's consuming Work nodes, along with the one pool's actual utilization. A sibling's queue is not copied into a scope that has no waiting consumers. Increasing one child's capacity can move the observed constraint into a later child; containers do not carry a static bottleneck label.

### Scoped economics

A scope's operating and scaling costs include its actual descendant Work nodes. Enabled features targeted at a member node contribute their investment and hourly overhead once. Shared-resource cost uses `resourceCostAllocation: "occupied-units"`: the engine attributes occupied units, actual use time and proportional extra-capacity operating surcharges to the consuming Work nodes and their ancestor scopes. Merely drawing a Resource node inside a group does not charge that group for the entire pool.

Idle shared capacity, fixed pool scale-up charges, pool investment and resource-targeted feature overhead remain in the whole-system ledger. Consequently, sums of disjoint process costs can be below global cost. Whole-system comparison and payback remain the complete economic assessment.

Realized revenue is recorded once at its terminal Outcome and rolled up through that Outcome's containing scopes. A Work node's processed revenue is not repeatedly added to every process along a route. Place an Outcome in the main process when its revenue should contribute to that main process's ledger. An upstream child that continues elsewhere can have completed visits and costs with zero realized revenue; inspect its throughput and carried expected value alongside whole-system contribution. `expectedRevenue` is carried potential value observed on scope entries and updates while a visit is active; re-entry can count the same work's potential value again. Lost revenue is attributed to the scopes containing the abandonment/failure. Parent and child financial totals overlap just as their other metrics do.

### Classes and execution boundary

`ProcessHierarchy` owns validation, ancestry, recursive membership and direct-child indexing. The UI projection and API discovery reuse that index. `ProcessMetricsAccumulator` receives real engine transitions for entry/exit, queue admission/departure, processing, resource acquisition/release and retirement. It keeps only current visits and bounded distributions; it does not retain every completed particle. Snapshot projection exposes accumulated statistics and any current uncommitted resource-cost interval without advancing simulation time.

`ProcessProjection` produces read-only overview/drill-down cards and aggregated connections from the logical model. `ProcessViewLayout` arranges visible cards without altering saved geometry. `ProcessConnections` supplies the same hierarchy-specific route to SVG connections and particle rendering, and puts resource requirement links in an outer gutter. `ProcessModelEditor` applies hierarchy edits. These presentation/editing classes do not execute particles or maintain another metric engine. The existing `SimulationEngine` remains the one deterministic executor used by the UI, local API and MCP.

## Configuration and units

Models contain particle types, Sources, Work nodes, Routers, shared Resources and Outcomes. Work can require several resource units simultaneously. Two Work nodes referencing one resource compete for the same capacity. A resource configuration can exist without a visible shape; add a Resource node with `resourceId` to place it on the canvas.

Time values use **simulated seconds**. Arrival rates and operating costs use **per-hour** units. Work/resource `costPerHour` is per available capacity unit, including idle time while scheduled open and active overtime outside availability. Scaling `additionalCostPerHour` is a surcharge on extra units in addition to their regular cost; it accrues continuously until those units scale down, including closed/idle periods. All money uses the model's three-letter currency code. Complexity changes processing requirements. Source schedules, bursts/counts, accepted types, priority/FIFO queues, patience, overflow and router conditions remain explicit editable assumptions. Schedule windows may repeat: `{startSeconds:0,endSeconds:43200,repeatSeconds:86400}` opens twelve hours each day, including week/year runs. Omit `repeatSeconds` for a single window and use `maxCount` only when arrivals should have a finite total limit.

Scaling rules specify minimum/maximum capacity, increments, queue/utilization triggers, delays, cooldowns and optional extra operating/scale-up cost. Scale-down waits for the low-utilization period and respects active allocations/minimum capacity. Improvements describe investment, operating cost and processing/resource/capacity/cost/revenue changes.

A Resource's `minCapacity` is the scaling floor when `scaling.minCapacity` is omitted; an explicit lower scaling minimum is rejected. First-match routers evaluate rules in their configured order. Weighted routing with no positive eligible branch uses its explicit, type-compatible fallback, or records a failed particle when no valid fallback exists.

An improvement needs a valid Work/Outcome node or shared resource target; every supplied target must exist. A resource improvement remains scoped to that resource: reducing staff units does not reduce counter units, and staff capacity/cost modifiers do not change a Work node's slots or per-item cost. Its processing/revenue/failure effects apply to Work nodes using that resource. A Work improvement can adjust its own processing, capacity, costs and resource requirements. Work/resource revenue modifiers update carried expected revenue when processing completes, including its value if later lost. An Outcome improvement supports revenue and economic effects and aligns expected/realized value at completion; non-neutral processing/capacity/failure settings are rejected. Enabled capacity increases must respect configured maximums, and any failure route requires a real outgoing flow edge from each affected Work node.

Play, Pause, Stop and Reset operate on a captured model/scenario. Speeds are 1×, 10×, 100× and MAX. MAX/headless processes events without waiting for animation. Choose duration or use the model default. A run freezes model, scenario, seed and duration; later edits cannot change its recorded result. Reset creates a new run and preserves the previous result. Choose Finish workload to stop arrivals at the configured horizon and drain existing work. Editing assumptions during a run offers Rerun against the changed model; metrics remain associated with their captured run until then. Normal editors cover routes, schedules, shared-resource bindings, investments and scaling; full JSON remains available for advanced configurations. UI deletion cleans dependent references in one undoable Apply operation, while API deletion rejects unresolved dependencies so an external caller can choose its own replacement.

Saved-run labels use each captured model's scenario name and currency, including after the current scenario is renamed/deleted or the document currency changes. API/MCP run summaries expose these as `scenarioName` and `currency`. Comparisons return a common captured `currency` and reject mixed currencies with structured 422 `SIMULATION_CURRENCY_MISMATCH`; no exchange-rate conversion is assumed.

Changing process membership/parents, node identities/types, source particle types, shared-resource bindings or flow edge identities/endpoints detaches the previous run from the canvas before it can overlay the new structure. A UI-started active run stops and saves its actual partial result; completed results stay unchanged. Results still allows comparison and deterministic inspection of the captured run, with an explicit notice that it is no longer overlaid on the edited diagram. Play starts a new run. Position, size, appearance, processing time, capacity, binding unit quantities and economics are assumption/presentation edits; they keep the captured overlay with the existing assumptions notice. Scenario-specific routing/bindings remain a view of the captured scenario. `topology.ts` caches compatibility for immutable models, `useSimulation.ts` guards every canvas consumer synchronously, and `useSimulationCanvasLifecycle.ts` manages canvas detachment through the shared service. API/MCP runs continue independently of canvas selection, and their results/state/replay always use the captured model.

Headless requires no selected diagram, canvas or animation loop. **A connected browser remains required** for local IndexedDB and Web Worker execution. Closing the browser ends execution. Reopening preserves models/results; deterministic replay reconstructs saved inputs. There is no mandatory backend, cloud database, SQLite or AI dependency.

## Kiosk example

The bundled kiosk explicitly assumes a repeating **12-hour opening day followed by twelve closed hours**, evenly spaced regular arrivals, 300 store customers and 10 package customers per opening day. Arrival and resource availability windows repeat every 86,400 seconds without a one-day total arrival cap. Purchases take 120 seconds; packages 240 seconds; each flow edge adds 3 seconds of travel. Both require one shared employee and counter. Staff costs 180 SEK/hour while scheduled available. Store revenue is 85 SEK/customer; package fee 20 SEK/customer. Patience is 240 seconds for store customers and 480 seconds for packages. All assumptions are illustrative, editable and persisted.

The 12-hour opening assumption matters: one eight-hour employee cannot supply the baseline's 640 processing minutes. The template does not hide that shortfall by inventing throughput.

Scenarios retain Baseline and change explicit overrides:

- **1,000 packages/day** exposes pressure on the shared staff/counter.
- **+1 package employee** moves packages to paid package staff while retaining shared-counter contention.
- **+2 package employees and dedicated counter** removes shared-counter demand from package work and supplies two paid workers and parallel processing slots.

Compare package throughput/waiting with core waiting/lost revenue, resource utilization, cost and contribution. Added paid capacity applies its configured cost.

## Delivery network and returns example

**Delivery network + returns** (`delivery-network-simulator`) demonstrates two main processes competing for five paid global pools: operations staff, drivers, field technicians, a loading dock and service engineers. Order fulfilment contains acceptance, planning, warehouse preparation, delivery/installation and billing. Delivery has deeper Transport and Field service subprocesses. Returns has separate inspection and refurbishment subprocesses, while sharing staff, the dock and technicians with outgoing orders.

The default horizon is one eight-hour opening day with seed 42. Standard orders arrive at 18/hour and carry 750 SEK; enterprise orders arrive at 4/hour, carry 3,500 SEK and have complexity 1.5–2.0; returns arrive at 2/hour with a 20 SEK recovery fee. Standard/return patience is one hour and enterprise patience two hours. Enterprise routing adds design work before equipment reservation. Every flow edge adds three simulated seconds. Resource schedules repeat daily, and all assumptions, priority, step times, slots and costs are persisted in the model.

The baseline has a deliberately constrained picking slot. Compare Baseline with **10× returns, same staff** to inspect interference between the main processes. **Expand warehouse capacity** adds paid operations staff and processing slots; **Expand warehouse and field delivery** also increases the downstream pools and slots. Their queues and bottlenecks derive from the resulting flows. **Assisted picking investment** enables a 250,000 SEK investment with a 0.65 processing-time multiplier and 20 SEK/hour operating overhead. Compare whole-system cash impact over a suitable horizon; the engine reports whether observed savings actually reach payback.

Open Warehouse preparation to inspect picking and packing separately, or open Delivery and installation → Field service to inspect installation and quality. Raising an upstream capacity can reveal a downstream constraint instead of making the entire process appear healthy. The example is constructed by `DeliveryNetworkExample` in `delivery-example.ts`; it uses the same public model and engine as a graph built through the wizard or API/MCP.

## Metrics and comparison

Metrics cover created, completed, abandoned, failed and active work; current/average/maximum queues; throughput; node/resource utilization and capacity; emergent bottlenecks; expected/realized/lost revenue; operating/resource/scaling/investment cost; contribution and cash impact. Waiting, cycle time and time-to-revenue derive from simulation timestamps. TTR is creation-to-revenue realization, with type/route distributions. Particle/type costs allocate per-item charges and processing-time Work/resource costs by cumulative per-slot/resource-unit integrals, including proportional surcharges from actual extra capacity and changes during processing. Idle capacity, feature overhead, investments and fixed scale-up charges may remain in the whole-system ledger, so summing type costs does not necessarily reproduce total system cost.

P95/P99 are null when observations are insufficient. Larger populations use bounded histograms; `approximate` and `resolutionSeconds` disclose precision. Average queues/utilization integrate actual state over simulated time. Bottlenecks rank observed queue/wait/utilization and can migrate after capacity changes.

Scenarios use typed overrides keyed by semantic IDs and never mutate Baseline. `overrides.processes` can change an existing group's name, description or parent; node overrides can change `processId` or its own processing settings. Resolved hierarchies are validated, so an override cannot create a cycle or reference a missing group. Creating/removing groups is a baseline topology change; a scenario modifies existing groups and nodes. Within entity and economics overrides, JSON `null` removes an inherited optional property; arrays replace complete values. For example, `overrides.nodes[workId].work.scaling = null` disables inherited scaling, while `overrides.economics.maximumBudget = null` removes the baseline budget for that scenario. These removal markers survive save/export/reload. Required properties, entity IDs and node types cannot be removed; the resolved model is validated. Comparison reports whole-system deltas, incremental cash impact and a payback time only when observed simulated cash crosses the investment; otherwise `paybackReached:false` and `paybackTimeSeconds:null`. An observed crossing at simulation time zero is valid and reported as zero. Cash timeline points expose `operatingCostFixed` for per-item charges, preserving their event-time jumps separately from continuously accrued operating costs when calculating payback. Outcomes depend on the user's persisted assumptions, horizon and distributions.

## Local API and MCP

Use the existing local `/api/v1` API or `visual_nerve_request` with paths **without** `/api/v1`. Start with `visual_nerve_api_docs`; `{"document":"openapi"}` returns every exact schema. Documentation works without a browser. Workspace/model/run commands require its storage acceptance and MCP grant.

| Operation | Route/input |
| --- | --- |
| Capabilities | `GET /simulation/capabilities` |
| Discover documents | `GET /diagrams?type=process-simulator` |
| Create | `POST /diagrams {name,type:"process-simulator"}` |
| Full model | `GET /diagrams/{id}/simulation` |
| Hierarchy discovery | `GET .../simulation/hierarchy` (root groups and direct/recursive membership; read the complete model for ungrouped steps) |
| Replace model | `PUT .../simulation {baseVersion,model}` |
| Entity collections | `.../simulation/processes`, `nodes`, `edges`, `particle-types`, `resources`, `improvements`, `scenarios` |
| Read/create collection | `GET`; `POST {baseVersion,value}` |
| Read/patch/delete entity | `GET .../{entityId}`; `PATCH {baseVersion,value}`; `DELETE .../{entityId}?baseVersion=N` |
| Economics/defaults/retention | `GET/PUT .../simulation/{field}`; PUT takes `{baseVersion,value}` |
| Start run | `POST .../simulation/runs {durationSeconds?,seed?,scenarioId?,demandMultiplier?,speed?,animated?,untilComplete?}` |
| Run list/info | `GET .../simulation/runs[/{runId}]` |
| Inspect | `GET .../runs/{runId}/state`, `result`, `metrics`, `queues`, `bottlenecks` |
| Entity metrics | `GET .../runs/{runId}/processes[/{id}]`, `nodes[/{id}]`, `resources[/{id}]`, `particle-types[/{id}]` |
| Events | `GET .../runs/{runId}/events?offset=0&limit=100` (limit 1–1,000) |
| Controls | `POST .../runs/{runId}/pause`, `resume`, `stop`, `reset` with exact `{}` |
| Live speed | `POST .../runs/{runId}/speed {speed:1\|10\|100\|"max"}` |
| Replay | `POST .../runs/{runId}/seek {timeSeconds}` after pausing/completing |
| Compare | Exact `POST .../simulation/compare {runIds:[baselineRunId,scenarioRunId,...]}` |

Model/entity mutation returns the updated Graph. Use its latest `diagram.version` as the next `baseVersion`. Missing versions return 428, stale versions 409 and invalid models 422 without partial writes. Native node/edge IDs are UUIDs; readable IDs supplied during creation are retained as external aliases and remapped consistently. Read back the canonical model before subsequent entity edits. Process/resource/type/scenario IDs may remain readable strings and must be URL-encoded when used in path segments.

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

Models/scenarios, including complete process declarations and member references, persist locally and accompany native JSON, history/duplication and workspace backup. The additive optional hierarchy needs no IndexedDB schema migration. Current run/checkpoint snapshots include scope metrics; saved runs from before hierarchy support may omit `processes` and remain valid. Full document copies preserve semantic process IDs within their separate document. Selected-node copies include their containing scopes and ancestors; pasting into the same document retains group membership and the shared pool, while cross-document paste remaps copied scopes and dependencies. Restoring backups remaps node references in scope metrics together with the model and canvas. Simulator schema version 1 is separate from exchange format version 1 and IndexedDB schema version 8. Existing diagram types stay unchanged; absent simulation content never reinterprets them as simulators.

Defaults retain 300 particle snapshots and 2,000 semantic events, capped at 10,000 and 100,000. Event pages disclose retained/dropped counts. Population metrics remain complete. Archives retain up to 30 runs per diagram. `retention.checkpoints` controls checkpoints per run, capped at 240 and defaulting to 240 when omitted: zero stores none, one keeps the latest, and two or more retain a thinned set including the endpoints. Replay uses immutable model/seed/options, so it does not require every frame, checkpoint or event.

Active work remains materialized for correctness. Rendering is sampled/aggregated separately; large arrivals may still consume substantial worker memory. Validated topology ceilings are 50,000 semantic nodes and 200,000 flow edges; the maximum configured horizon is ten simulated years. These ceilings do not promise interactive performance for every workload.

Execution safety limits are discoverable at `/simulation/capabilities` under `execution.limits`: 200,000 simultaneously active particles, 50,000,000 scheduled or semantic events per run, 10,000 route visits per particle, four resident execution/replay workers and sixty cached runs. The `activeRuns` compatibility field includes paused resident workers, transient replay workers and synchronous startup reservations. Simultaneous external starts/seeks cannot exceed that shared worker ceiling; a fifth is rejected with 409 before another worker starts. The compatibility field `semanticEvents` includes popped internal scheduled events in its ceiling, including repeating availability while draining a workload beyond the arrival horizon. Reaching an active-particle/event ceiling stops that run with `status:"failed"`, an explicit `message` and partial population metrics; the engine does not silently discard excess work or report success. An excessively looping particle fails with a semantic event. Cache eviction preserves the separately retained local run archive.

## Implementation modules

- `frontend/src/simulation/types.ts`, `schema.ts` and `scenario-patch.ts`: public versioned model, semantic validation, serializable scenario differences and resolution.
- `process-hierarchy.ts`, `process-metrics.ts`: shared hierarchy validation/indexing and incremental authoritative scope metrics, isolated in `ProcessHierarchy` and `ProcessMetricsAccumulator`.
- `process-projection.ts`, `process-view-layout.ts`, `process-connections.ts`, `ProcessConnectionEdge.tsx`, `process-navigation.ts`, `process-traffic.ts`, `ProcessCard.tsx`, `ResourcePoolCard.tsx`, `editor/ProcessEditor.tsx`: compact scope/pool cards and connections, drill-down navigation and semantic membership editing using `ProcessProjection`, `ProcessViewLayout`, `ProcessConnections` and `ProcessModelEditor`. Compact placement never changes the full editable graph's world coordinates.
- `starter-builder.ts`, `starter-analysis.ts`, `StarterProcessFields.tsx`: guided hierarchical construction and capacity review with `ProcessStarterBuilder` and `ProcessStarterAnalysis`.
- `engine.ts`, `engine-state.ts`, `event-queue.ts`, `random.ts`, `ring.ts`, `statistics.ts`, `economics.ts`: deterministic execution, bounded state, statistics and cash comparison.
- `worker.ts`, `client.ts`, `protocol.ts`, `service.ts`, `useSimulation.ts`: one execution/inspection/control service used by UI and the local API.
- `SimulationFeature.tsx`, `ScenarioControls.tsx`, `ModelEditor.tsx`, `editor/*`, `fields.tsx`, `MetricsDashboard.tsx`, `NodeSummary.tsx`, `ParticleOverlay.tsx`, `render-model.ts`, `simulation.css`: controls, assumption editing, comparisons, actual state rendering, scenario/resource projection and bounded particles.
- `capacity-projection.ts`, `capacity-layout.ts`, `capacity-edges.ts`, `presentation-slots.ts`, `particle-view.ts`: bounded full native capacity cards, collision layout, shared-input edge fans, observed processing placements and semantic particle paths. These modules do not change business state or persist visual clones.
- `document.ts`, `deletion.ts`, `copy.ts`, `clipboard.ts`, `storage.ts`, `run-store.ts`, `backup.ts`, `archive-validation.ts`, `examples.ts`, `delivery-example.ts`: native canvas identity, reference cleanup, kiosk/delivery examples and local archives.
- `frontend/src/storage/simulation-commands.ts`: semantic REST/MCP command routing; `repository.ts` delegates using existing conventions.
- Existing integration changes: `App.tsx`, `canvas/{Canvas.tsx,navigation.ts}`, `nodes/registry.tsx`, `components/Properties.tsx`, `model/{types,validation}.ts`, `storage/database.ts`, `state/{editor,history,clipboard}.ts`, `history/{backup,compare,store}.ts`, `export/semantic.ts`, `templates/{manifest.json,templates.ts}`, `integration/{access,bridge,setup}.ts`.
- Go contract/discovery changes: `backend/cmd/openapi/{main,simulation,processes}.go`, `backend/internal/model/model.go`, `backend/internal/server/{server,mcp,mcp_description,mcp_discovery,mcp_tools,simulation_description,process_description}.go`. Go forwards to the connected browser rather than owning another simulation engine.
- Documentation: `API.md`, `EXPORT_FORMAT.md`, `docs/openapi.yaml`, `docs/PROCESS_SIMULATOR.md`, `docs/PROCESS_SIMULATOR_ACCEPTANCE.md`, `hugo/content/help.md`.
- Tests: `frontend/tests/simulation-*.test.{ts,tsx}`, `frontend/tests/process-{starter,wizard}.test.{ts,tsx}`, `frontend/tests/workspace-sync.test.ts`, `frontend/tests/e2e/simulation-{ui,api}.spec.ts`, `frontend/tests/e2e/process-{wizard,building,hierarchy}.spec.ts`, new Go simulation/OpenAPI tests and existing fixture updates for the additive IndexedDB v8 upgrade and template selection.

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

Run the model through the existing simulation run endpoints. Original-case population and revenue remain single-counted; child tasks have their own processing, queues and resource allocations. `state.parallel` exposes active groups/branches, waiting parents and bounded correlated group summaries. Particle tokens carry `rootParticleId`, `parentParticleId`, `forkGroupId`, `forkNodeId`, `joinNodeId` and `branchEdgeId` where applicable. A suspended parent and an arrived child can have status `waiting`; retired children have `joined` or `cancelled`. Node metrics at a join expose `join.waitingGroups`, `arrivedBranches`, `expectedBranches`, `completedGroups`, `cancelledGroups` and the observed synchronization-wait distribution. Its current queue counts arrived tasks waiting for their siblings. `PARTICLE_FORKED`, `BRANCH_JOINED`, `JOIN_COMPLETED`, `BRANCH_CANCELLED` and `PROCESS_CANCELLED` events provide correlation without inspecting coordinates. Retained live tokens and sampled particles include branches and suspended parents; business `created`, `completed`, `abandoned`, `failed` and `inSystem` count original cases. The 200,000 active-token limit applies to parents and children together.

Discover the **Parallel SD-WAN delivery** template through `GET /templates` for a complete editable example. Headless, animated, scenario and replay runs use the same deterministic engine.

Route metrics retain exact connection-ID labels up to 2,000 characters. Longer histories use a bounded identifier: the first 200 characters followed by ` … [route:<8hex>-<8hex>; edges=N]`. The ordered dual digest and edge count are deterministic grouping identifiers, not a cryptographic integrity guarantee; they cannot reconstruct the complete itinerary. This bounds nested branch history without dropping visited Work-node revenue attribution or changing case counts, costs or TTR.

## Parallel execution modules

`ParallelTopology` validates closed paired regions without recursion over graph depth. `ParallelExecution` coordinates correlated child tokens in the one `SimulationEngine`; it does not introduce a second worker or clock. `engine-state`, process rollups and archives distinguish logical case metrics from task/tokens and validate retained lineage. `ParallelFlowDraft` creates complete pairs, synchronizes required connection IDs and removes explicitly selected whole regions. `ParallelConnectedNodes` inserts the same block through the canvas control and preserves downstream edges. `ParticleRoute` merges bounded prefixes, ordered digests and deduplicated Work attribution without retaining every repeated branch connection. `ParallelDeliveryExample` supplies the editable SD-WAN template. Existing schemaVersion 1 documents without parallel nodes retain their earlier interpretation.
