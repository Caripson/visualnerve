# Infrastructure capacity

Infrastructure extends the existing Process Simulator with explicitly typed CPU, RAM, network and energy pools. The same semantic model, deterministic event clock, browser worker, run snapshots, scenarios, API and MCP tools execute every domain and the combined datacenter example. Canvas coordinates are presentation only.

The four synthetic starting templates are `api-compute-capacity` (**API & Compute Capacity**), `network-multi-site-capacity` (**Network & Multi-Site Capacity**), `energy-power-capacity` (**Energy & Power Capacity**) and `datacenter-capacity` (**Datacenter Capacity**). `GET /templates` returns their complete native graphs. Template numbers are editable assumptions, not measurements or hardware benchmarks. See [the practical Help guide](../hugo/content/help/infrastructure-capacity.md) and [the acceptance tracker](INFRASTRUCTURE_CAPACITY_ACCEPTANCE.md).

The API example uses three shared pools: two CPU cores, 512 MiB of retained request RAM and eight generic database connections. Each synthetic request retains 96 MiB, uses 0.2 core-seconds on one core plus 15 ms execution overhead, and atomically holds one database connection while executing. The database pool costs 0.05 SEK per available connection/hour. The **One database connection** scenario raises CPU/RAM headroom while reducing database slots to one, exposing that constraint. This is a connection-pool assumption, not database I/O physics.

The datacenter example shares five pools: WAN, CPU, RAM, database connections and energy. After receiving a request and retaining RAM, an explicit fork runs CPU computation and its modeled energy budget concurrently. The paired join waits for both before database work and the response. No implicit conversion from CPU work to electrical energy is performed; the energy branch is an explicit budget that can delay the join.

## Versions and authoritative data

Bridge/browser API **0.10.0** announces `infrastructure-resources-v1`. `GET /simulation/capabilities` retains `schemaVersion:1` compatibility metadata and adds `supportedModelSchemaVersions:[1,2]` plus `infrastructure.requiredModelSchemaVersion:2`.

Legacy models remain `SimulationModel.schemaVersion:1` with their existing integer slot/resource interpretation. Typed infrastructure requires **model version 2** and `model.infrastructure:{schemaVersion:1}` together. Model 1 rejects infrastructure fields; model 2 rejects a missing profile. This boundary prevents an older engine, which accepts only model 1, from silently running new assumptions as legacy work. No workspace table, encrypted vault version or native graph-format migration is introduced.

The complete `graph.simulation` model and retained run snapshots stay in the existing encrypted browser workspace. The Go bridge preserves and forwards them; it adds no engine, database or hidden unit conversions. Live collaboration rooms currently reject infrastructure models before sharing or publishing them. Share an explicit native JSON export or encrypted workspace backup instead; a future negotiated collaboration contract is needed for live rooms.

## Saved fields and units

| Location | Infrastructure value                                                                                                                                 | Meaning                                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Model    | `{schemaVersion:1}`                                                                                                                                  | Required extension profile on model version 2            |
| Resource | `{kind:"cpu",unit:"cores"}`                                                                                                                          | Dedicated core reservation pool                          |
| Resource | `{kind:"memory",unit:"MiB"}`                                                                                                                         | RAM lease pool; one MiB is 1,048,576 bytes               |
| Resource | `{kind:"bandwidth",unit:"Mbps"}`                                                                                                                     | Shared decimal megabits/second link                      |
| Resource | `{kind:"energy",unit:"kW",generation:[...],gridImportLimitKW?,pricePerKWh?,battery?}`                                                                | Generation, battery and grid supply for delivered energy |
| Work     | `{cpu?:{resourceId,coreSeconds,cores},memory?:[{resourceId,amountMiB,scope}],releaseMemoryResourceIds?:[id],energy?:{resourceId,energyKWh,powerKW}}` | Explicit typed resource demands                          |
| Edge     | `{transfer:{resourceId,bytes}}`                                                                                                                      | Integer payload bytes serialized on a typed link         |

The fields above are named `infrastructure` on their respective entities. Canonical `Resource.unit` must also match the descriptor unit. `Resource.capacity` may be fractional for typed pools. Typed resources cannot appear in legacy `resourceRequirements`; use the dedicated demand fields. CPU and energy activities are mutually exclusive on a Work step. Energy Work requires `processingSeconds:0`.

Capability `infrastructure.displayConversions` publishes explicit factors: decimal kB/MB/GB are 1,000/1,000,000/1,000,000,000 bytes; binary KiB/MiB/GiB are 1,024/1,048,576/1,073,741,824 bytes. It also distinguishes bps/Kbps/Mbps/Gbps, W/kW and Wh/kWh. These describe dimension conversions, not free-form model units: RAM fields remain MiB, payloads remain integer bytes, and saved descriptor units remain canonical.

## CPU and RAM

`Work.capacity` still limits simultaneous jobs at that step. A CPU demand reserves dedicated cores from its referenced pool, atomically with newly acquired memory and legacy requirements. If the complete allocation is unavailable, the job waits; CPU cores are not timesliced among waiting jobs.

For a CPU Work step:

```text
allocatedCores = requested cores × applicable resourceUnitsMultipliers
durationSeconds = (processingSeconds + coreSeconds / allocatedCores)
                  × particle complexity
                  × Work.complexityMultiplier
                  × enabled processingTimeMultipliers
```

Fixed processing overhead therefore occupies the reserved cores too. `coreSeconds` in runtime metrics integrates occupied core-time; `completedWorkCoreSeconds` records completed modeled computational work. These are different quantities.

CPU completion uses the engine's existing millisecond event clock: the computed duration is rounded to milliseconds with a minimum one-millisecond Work duration. This is a numerical scheduling convention, not operating-system behavior.

Stage RAM belongs to one particle and is released when that Work stage ends. Case RAM belongs to the original business case, is shared by its forked tokens and tops up to the maximum requested amount per case/pool rather than summing every repeated request. Existing case RAM remains held during CPU waits and network transit. Applicable resource-unit multipliers affect RAM acquisition/top-up demand.

One Work step may request both case and stage RAM from the same pool; admission checks their combined additional demand. Duplicate `(resourceId,scope)` entries are rejected. `releaseMemoryResourceIds` releases case RAM after a stage, cannot acquire and release the same pool in that stage, and is forbidden inside fork/join regions. Terminal completion, failure and cancellation release all leases for that root case.

CPU and RAM pools support schedules and fractional min/max/scaling increments. Legacy integer capacities and scaling retain their earlier meaning.

## Network transfers

An edge's integer payload is serialized before its fixed `travelSeconds` propagation delay:

```text
linkBytesPerSecond = capacityMbps × 125000
perTransferRate = linkBytesPerSecond / active positive-remaining transfers
```

Rates rebalance when transfers arrive, finish or link availability changes. Concurrent transfers share one pool even across different processes/sites. Bandwidth schedules are supported; automatic bandwidth scaling is not supported in extension version 1. Applicable bandwidth-pool improvements can change capacity/economics, but time, resource-unit, revenue and failure multipliers are rejected for that pool.

This is deterministic fluid payload sharing. It does not model TCP, packet loss, retransmission, congestion control, protocol headers or distance-derived latency. Enter payload size and propagation assumptions explicitly.

## Energy balance

An energy Work step requests `energyKWh × particle complexity × Work.complexityMultiplier` at up to its unchanged `powerKW`. It completes when the engine has actually delivered that energy. Limited supply slows completion; it does not fabricate delivery from the requested power. Energy activities reject nonneutral processing-time and resource-unit improvements.

`Resource.capacity` is maximum delivered load power in kW. It is distinct from generation power and `gridImportLimitKW`, and does not cap generation itself. Sorted, non-overlapping generation windows supply their stated kW; gaps supply zero. Supply prioritizes direct generation, then battery discharge, then bounded grid import. Delivered power uses max-min fair sharing: a small requested load is capped at its request and the remaining supply is shared equally among the other loads.

Generation surplus charges the battery within its power and energy bounds. Grid imports do not charge it in version 1. Remaining generation surplus is curtailed. Over each segment of simulated hours:

```text
stored-energy change = (charge input kW × chargeEfficiency
                        − discharge output kW / dischargeEfficiency) × hours
grid cost = imported kWh × pricePerKWh
```

The engine splits integration at generation boundaries, battery full/empty transitions and load completion. It tracks conversion losses, stored energy, state of charge, delivered and imported energy, curtailment and unmet requested-power energy. `unservedKWh` is integrated requested power that could not be delivered at its requested rate; a load may later receive its remaining energy. Energy resource schedules/scaling are rejected; generation windows control supply.

Actual grid tariff is included once in the energy pool's resource cost and whole-system resource cost. Work/process and particle-type ledgers allocate occupied capacity costs; grid imports are not attributed to fabricated per-job energy costs. Inspect the energy pool's `gridCost` when separating tariff from capacity-hour charges.

This is an aggregate energy balance with explicit rate assumptions. It does not solve AC load flow, voltage, frequency, protection, electrical topology, battery chemistry, weather or physical renewable-generation forecasts.

## Runs, metrics and stress scenarios

Use the ordinary asynchronous `/diagrams/{id}/simulation/runs` routes. The captured model and run options remain immutable. Detailed counters are resource-keyed in `state.infrastructure` and `result.infrastructure`:

| Family | Counters                                                                                                                                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CPU    | `reservedCores`, `peakReservedCores`, `coreSeconds`, `completedWorkCoreSeconds`                                                                                                                                                 |
| RAM    | `usedMiB`, `peakUsedMiB`, `caseLeases`, `stageLeases`, `allocatedMiBSeconds`                                                                                                                                                    |
| Link   | `activeTransfers`, `peakActiveTransfers`, `transferredBytes`, `usedMbps`, `busySeconds`                                                                                                                                         |
| Energy | `generatedKWh`, `gridImportedKWh`, `deliveredKWh`, `storedKWh`, `stateOfCharge`, `chargeInputKWh`, `dischargeOutputKWh`, `conversionLossKWh`, `curtailedKWh`, `unservedKWh`, `activeLoads`, `suppliedKW`, `unmetKW`, `gridCost` |

Individual resource-inspection routes retain generic capacity, busy, queue, utilization and cost metrics. Model 2 Work displays one logical card with its exact in-flight capacity, active jobs and queue; concurrency slots are not physical server replicas. Every model 2 resource, including generic database connections, also displays one aggregate card. Typed pools show domain summaries without invented individual core/MiB/Mbps/kW identities. Legacy model 1 capacity banks are unchanged. Discovery exposes `visualCapacity.infrastructureWork:"aggregate-in-flight-concurrency"` and `infrastructureResources:"aggregate-pools"`. The existing business-case metrics still show completion, wait, throughput and economics.

Optional `nodes[id].blockedResourceIds` and `resources[id].blockedNodeIds` identify actual atomic-admission blockers. Optional particle `transferProgress` is an observed visual fraction: with positive propagation delay, actual byte serialization occupies 0–0.9 and simulated propagation elapsed occupies 0.9–1. With zero propagation, serialization uses the full 0–1 range. It is not a predicted completion time; use link counters for actual bytes.

Generic resource `queue` and wait counters retain the existing linked-Work demand accounting, including Work that may currently wait for a different pool. They do not prove that this pool is the immediate constraint. Model 2 canvas pool queues instead summarize queued Work at the currently blocked consumers; use `blockedNodeIds` and the disclosed bottleneck methodology to identify the actual admission constraint.

Finite-horizon completion is an observation of that interval and may retain outstanding work. `untilComplete` fails with `failureCode:SIMULATION_INFRASTRUCTURE_STALLED` when no future event can make outstanding infrastructure work progress. Failure releases allocations and retains partial totals; it is not successful throughput.

Equivalent runs with the same captured assumptions, seed and simulated observation time preserve discrete counts, event order, millisecond event timestamps and capacities exactly. Frame pacing can change the grouping of floating-point additions in continuous integrals. Compare those raw, unrounded totals with:

```text
abs(a − b) ≤ max(1e-9 canonical units, 1e-9 × max(abs(a), abs(b)))
```

Do not round stored totals to force equality or use elapsed browser time as simulated duration.

### Bottleneck methodology

Model 2 adds optional `bottlenecks[].methodology` to disclose a heuristic ranking method. Legacy model 1 retains its existing payload and omits the field. A pressure score helps locate an observed constraint; it is not a throughput forecast or a numerical estimate of the benefit of extra capacity. `averageQueue` and `averageWaitSeconds` remain their actual observations even when the score uses another measure.

| Method                  | Observation and score                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `queue-history`         | Work's observed average queue × (1 + historical utilization)                                                  |
| `blocked-admission`     | Number of Work nodes currently blocked by this resource × (1 + current utilization)                           |
| `bandwidth-sharing`     | For more than one active transfer on a positive-rate link: (active transfers − 1) × used Mbps / capacity Mbps |
| `bandwidth-unavailable` | Active transfers when `activeTransfers>0` and `usedMbps===0`; score is `activeTransfers`                      |
| `energy-shortfall`      | Unmet kW / (supplied kW + unmet kW), when unmet demand is positive                                            |

Resource candidates in model 2 prefer actual blocked admission, then bandwidth pressure, then energy shortfall. A configured zero-capacity or scheduled-off link with active serialization reports `bandwidth-unavailable`, with reason “Active transfers have no currently available bandwidth.” Idle links and particles only in propagation do not create this candidate. They do not turn every referenced Work queue into a resource bottleneck. Historical Work candidates remain separate. Candidates sort by descending score, with ID as the tie break; the top ID becomes `metrics.currentBottleneck`. A shared saturated or currently unavailable link can therefore appear even when serialization creates no Work queue. Low use with a queue blocked by a different pool does not fabricate a RAM constraint.

Scores are dimensionless. Process views include a shared-pool candidate only for actually impacted consumers: blocked Work nodes, active serializing transfer sources or power-limited active energy jobs in that scope. Blocked-admission counts are scoped; bandwidth/energy pressure remains the shared pool's global context and must not be summed across process views.

Saved scenarios override the same resources, Work and edges. For example, change CPU capacity, case RAM demand, payload bytes, link Mbps, generation windows, battery capacity or grid limits, then run baseline and scenario with the same seed/horizon. Existing `POST .../simulation/compare` adds `comparisons[].infrastructure:{baseline,scenario,delta}` when both results have domain counters. Deltas are signed scenario-minus-baseline values only for matching family/pool IDs present in both; absent/new pools remain visible in their result side without manufactured zero counters.

## API, nulls and bounds

No endpoint or MCP tool is added. Use `visual_nerve_api_docs` for the guide, then `document:"endpoint"` with an exact path template and uppercase method. Use `visual_nerve_request` with the intended `workspaceId` for model access. Discovery does not grant access: inspection/comparison needs Read only, model/run mutation needs Read + write, accepted storage, an unlocked workspace and the same current browser session.

`PUT /diagrams/{id}/simulation` takes `{baseVersion,model}`. Existing entity POST/PATCH take `{baseVersion,value}`. PATCH recursively merges objects, preserves omitted fields, removes optional fields with `null`, and replaces arrays. Saved scenario overrides retain those null markers until resolving the complete model. Complete/new/import/replacement objects reject null. Required values cannot be removed from a still-present typed descriptor. Invalid edits return structured 422 `SIMULATION_INFRASTRUCTURE_INVALID` with issue paths and save nothing; `baseVersion` and operation recovery retain their existing behavior.

| Bound                                                            | Limit                                             |
| ---------------------------------------------------------------- | ------------------------------------------------- |
| Typed capacity, demand cores/MiB/kW, battery charge/discharge kW | 10¹²                                              |
| Core-seconds, energy kWh, battery kWh, price/kWh, transfer bytes | 10¹⁵; bytes must be an integer                    |
| Positive demand/efficiency minimum                               | 0.000001; efficiencies at most 1                  |
| RAM demands and explicit release IDs per Work                    | 32 each; release IDs unique                       |
| Generation windows per resource                                  | 4,096; positive duration, sorted, non-overlapping |
| Generation start/end simulated seconds                           | 0–315,360,000                                     |

Zero typed capacity is valid as a stress assumption; it can cause waiting or an explicit stalled run. Initial battery energy cannot exceed its capacity. Unknown properties, dimensions, reference kinds and unsupported combinations reject before persistence. Existing execution/retention/transport limits remain in [Process Simulator](PROCESS_SIMULATOR.md) and [OpenAPI](openapi.yaml).

The implementation is split under `frontend/src/simulation/infrastructure/`: types/validation, CPU and lease coordination, fluid sharing, analytic energy balance, domain metrics and dimension-aware comparison. `SimulationEngine` still owns admission, routing, parallel correlation and the only simulation clock.
