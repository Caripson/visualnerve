import type { Graph } from '../model/types';
import { setSimulationModel } from './document';
import { assertSimulationModel } from './schema';
import { starterValues, type ProcessStarterDraft } from './starter';
import type { SimulationModel, SimulationNode } from './types';

/** Builds semantic topology; process containers introduce no artificial work or cost. */
export class ProcessStarterBuilder {
  build(graph: Graph, draft: ProcessStarterDraft): Graph {
    const base = graph.simulation;
    if (!base || base.nodes.length)
      throw new Error('Guided setup starts on an empty Process Simulator.');
    const values = starterValues(draft);
    const hierarchical = draft.structure === 'hierarchical';
    const itemId = crypto.randomUUID();
    const sourceId = crypto.randomUUID();
    const outcomeId = crypto.randomUUID();
    const resourceId = crypto.randomUUID();
    const resourceNodeId = crypto.randomUUID();
    const processId = crypto.randomUUID();
    const stepIds = values.steps.map(() => crypto.randomUUID());
    const processIds = values.steps.map(() => crypto.randomUUID());
    const source: SimulationNode = {
      id: sourceId,
      name: `${values.itemName} arrivals`,
      type: 'source',
      source: {
        particleTypeId: itemId,
        ...(draft.arrivalMode === 'batch'
          ? { burst: values.batchCount, maxCount: values.batchCount }
          : { ratePerHour: values.arrivalsPerHour, distribution: 'regular' as const }),
      },
    };
    const work: SimulationNode[] = values.steps.map((step, index) => ({
      id: stepIds[index],
      name: step.workName,
      ...(hierarchical ? { processId: processIds[index] } : {}),
      type: 'work',
      work: {
        capacity: step.capacity,
        processingSeconds: step.processingSeconds,
        queueDiscipline: 'fifo',
        costPerHour: step.costPerHour,
        ...(draft.sharedResource && step.usesSharedResource
          ? { resourceRequirements: [{ resourceId, units: 1 }] }
          : {}),
      },
    }));
    const route = [sourceId, ...stepIds, outcomeId];
    const model: SimulationModel = {
      ...structuredClone(base),
      currency: draft.currency,
      description: `${values.itemName}: ${draft.arrivalMode === 'batch' ? `${values.batchCount} items at time zero` : `${values.arrivalsPerHour} regular arrivals/hour`}. ${hierarchical ? `Main process ${values.mainProcessName} contains ${values.steps.length} subprocesses. ` : ''}${values.steps.map((step) => `${step.workName}: ${step.processingSeconds / 60} minutes/item, ${step.capacity} slots, ${step.costPerHour} ${draft.currency}/slot/hour`).join('; ')}. Each connection takes ${values.transferSeconds} simulated seconds.${draft.sharedResource ? ` One shared pool ${values.resourceName} has ${values.resourceCapacity} units, costing ${values.resourceCostPerHour} ${draft.currency}/unit/hour; only assigned steps consume it.` : ''} Containers add no extra processing or charge.`,
      ...(hierarchical
        ? {
            processes: [
              ...(base.processes ?? []),
              { id: processId, name: values.mainProcessName },
              ...values.steps.map((step, index) => ({
                id: processIds[index],
                name: step.name,
                parentId: processId,
              })),
            ],
          }
        : {}),
      particleTypes: [
        ...base.particleTypes,
        {
          id: itemId,
          name: values.itemName,
          color: '#2563eb',
          shape: 'circle',
          revenue: values.revenue,
          complexity: { min: 1, max: 1 },
          priority: 0,
          ...(values.patienceSeconds === undefined
            ? {}
            : { patienceSeconds: values.patienceSeconds }),
        },
      ],
      nodes: [
        source,
        ...work,
        {
          id: outcomeId,
          name: 'Completed',
          type: 'outcome',
          ...(hierarchical ? { processId: processIds.at(-1) } : {}),
          outcome: { status: 'completed', revenue: values.revenue > 0 },
        },
        ...(draft.sharedResource
          ? [
              {
                id: resourceNodeId,
                name: values.resourceName,
                type: 'resource' as const,
                resourceId,
              },
            ]
          : []),
      ],
      edges: route.slice(1).map((targetNodeId, index) => ({
        id: crypto.randomUUID(),
        sourceNodeId: route[index],
        targetNodeId,
        travelSeconds: values.transferSeconds,
      })),
      resources: [
        ...base.resources,
        ...(draft.sharedResource
          ? [
              {
                id: resourceId,
                name: values.resourceName,
                capacity: values.resourceCapacity,
                unit: 'units',
                costPerHour: values.resourceCostPerHour,
              },
            ]
          : []),
      ],
      defaults: { ...base.defaults, durationSeconds: values.durationSeconds },
    };
    assertSimulationModel(model);
    const next = setSimulationModel(graph, model);
    const positions = new Map<string, { x: number; y: number; height: number }>([
      [sourceId, { x: 60, y: 180, height: 170 }],
      ...stepIds.map((id, index): [string, { x: number; y: number; height: number }] => [
        id,
        { x: 410 + index * 350, y: 180, height: 240 },
      ]),
      [outcomeId, { x: 410 + stepIds.length * 350, y: 180, height: 170 }],
      [resourceNodeId, { x: 410, y: -120, height: 210 }],
    ]);
    const { viewport: _viewport, viewportDevice: _device, ...settings } = next.diagram.settings;
    return {
      ...next,
      diagram: { ...next.diagram, settings },
      nodes: next.nodes.map((node) =>
        positions.has(node.id) ? { ...node, width: 250, ...positions.get(node.id) } : node,
      ),
    };
  }
}
