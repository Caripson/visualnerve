---
layout: product
title: "See what capacity changes do to the whole process"
description: "Model queues, shared resources, scaling and economics with Visual Nerve Process Simulator, then compare deterministic scenarios."
eyebrow: "Process Simulator"
summary: "Run work through a real model of constraints, then compare the consequences of changing demand or capacity."
---

[Open the workspace](/app/) and choose **New diagram → Process Simulator**. [Follow the complete simulator guide](/help/simulation/).

## Start with the whole-system question

A kiosk serves 300 store customers and 10 package customers per opening day. Store purchases take two minutes; package pickup takes four. Both require the same employee and counter.

At low package volume, the flows can coexist. Change package demand to 1,000 per day and that extra work competes with the store's existing business. Waiting, abandonment and lost store revenue can increase even when each completed package earns a fee.

The bundled example uses an explicit 12-hour opening day, repeating schedules, evenly spaced arrivals, patience thresholds, travel time and paid staff. You can inspect and change every assumption.

![The kiosk process diagram with its sources, work stages, outcomes, shared resources and result metrics.](/help/images/simulation.webp "The bundled kiosk shows both business flows and their shared constraints in one editable model.")

## Model work, processing and shared capacity

| Model element | What it means                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Particle type | A customer, order, package or other work item with revenue, complexity, priority and patience. |
| Source        | Arrivals, bursts, schedules and maximum counts.                                                |
| Work          | Processing time, parallel slots, queue behavior and required resources.                        |
| Router        | A permitted choice based on configured rules, attributes or actual state.                      |
| Resource      | Shared employees, counters, machines, storage or other constrained capacity.                   |
| Outcome       | Completed, failed or rejected work, with optional realized revenue.                            |

Multiple Work nodes can require the same logical resource. Adding another processing card does not automatically add another employee. Resource contention is part of the calculation.

## Observe the constraint on the canvas

In 2D, particles follow valid model connections and remain queued until processing can begin. Node indicators and metrics reveal busy capacity, waiting and saturation. A bottleneck is identified from observed state and can move when you remove an earlier constraint.

Configured scaling can show additional capacity cards, such as Counter 1, Counter 2 and Counter 3. They represent units of one logical node or resource, with a shared queue. They are temporary capacity visuals, not separately saved employee identities.

Rendering is bounded: large populations use samples or aggregation while metrics describe all simulated work. The full live particle and capacity-bank view is in 2D; 3D retains the logical diagram and numeric metrics.

## Change an assumption and compare another run

1. Run the baseline with a chosen duration and seed.
2. Create a scenario without replacing the baseline.
3. Open Assumptions and change a source rate, processing time, resource or capacity rule.
4. Apply the draft and run it.
5. Compare saved results using the same horizon, seed and finish-workload choice.

![The simulator assumptions editor changing package arrivals from ten to one thousand per opening day.](/help/images/simulation-assumptions.webp "This scenario changes package demand while retaining the baseline model.")

The kiosk includes scenarios for higher package demand, a dedicated package employee, and additional package employees with a dedicated counter. Each intervention applies its configured cost; it does not simply make throughput better for free.

## Read economics alongside throughput

Inspect created, completed and abandoned work; queue length and waiting percentiles; resource utilization; throughput; realized and lost revenue; operating, resource and scaling cost; contribution; and time-to-revenue.

Improvements can add an investment and change processing or capacity. Comparison reports incremental cash impact and observed payback when the simulated result crosses the investment. A run that has not paid back within its horizon is reported as such.

These are consequences of the assumptions you supplied. The simulator does not validate those assumptions against a real business or promise a financial outcome.

![Saved kiosk runs selected for comparison with throughput, queues, revenue, cost and contribution.](/help/images/simulation-compare.webp "Compare the impact across both flows and shared resources, rather than evaluating one revenue stream alone.")

## Replay and automate the same model

Play, pause, stop, reset and choose 1×, 10×, 100× or MAX. Simulation time is independent of browser wall-clock time. MAX processes events without waiting for particle animation.

The discrete-event engine uses seeded randomization. The same captured model, scenario, seed and options produce the same business metrics through UI, REST or MCP. Runs retain their captured inputs, so later edits do not rewrite previous results. Replay lets you inspect an earlier simulated moment.

API and MCP expose semantic models, queues, resources, events, metrics, scenarios and controls. A client can run sequential demand multipliers and compare separately identified results. Headless execution needs no active canvas, but the browser must remain open and connected for local workers and storage.

## Keep the model and its limits visible

Models, scenarios and bounded run archives are stored in local IndexedDB. Back up work before changing browser, device or website origin. No mandatory backend or cloud database is required.

Execution has explicit limits for topology, active particles, events, route visits, workers and retained results. Exceeding a limit produces an error with partial metrics, rather than silently dropping work and reporting success. Discover the current ceilings through the API or the guide.

[Create a Process Simulator](/app/) · [Modeling and troubleshooting guide](/help/simulation/) · [Programmatic control](/developers/#run-and-inspect-a-simulation)
