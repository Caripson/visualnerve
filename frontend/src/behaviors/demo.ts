import { blankGraph, newNode } from '../model/types';
import { createSimulationGraph } from '../simulation/document';
import { createBasicModel } from '../simulation/examples';
import { setBehaviorLibrary, type BehaviorDefinition } from './document';
import { BEHAVIOR_PREVIEW_VERSION } from './language';

export type BehaviorDemo =
  | 'behaviors-editor'
  | 'behaviors-cashier'
  | 'behaviors-cashier-busy'
  | 'behaviors-cashier-off';

function definition(name: string, source: string): BehaviorDefinition {
  return { id: crypto.randomUUID(), name, version: BEHAVIOR_PREVIEW_VERSION, source };
}

export function createBehaviorDemo(demo: BehaviorDemo) {
  if (demo === 'behaviors-editor') {
    const graph = blankGraph('Behavior demo: Rename');
    graph.nodes = [
      newNode(graph.diagram.id, { title: 'Källa A', x: 80, y: 100 }),
      newNode(graph.diagram.id, { title: 'Källa B', x: 80, y: 270 }),
      newNode(graph.diagram.id, { title: 'Mål A', x: 430, y: 100 }),
      newNode(graph.diagram.id, { title: 'Mål B', x: 430, y: 270 }),
    ];
    return setBehaviorLibrary(graph, {
      definitions: [
        definition(
          'Namnge nästa nod',
          `parameter nextName as text = "Kvalitetskontroll"

on connectionAdded
  rename event.target to nextName
end`,
        ),
      ],
      bindings: [],
    });
  }

  const busy = demo === 'behaviors-cashier-busy';
  const enabled = demo !== 'behaviors-cashier-off';
  const model = createBasicModel({ particles: 17, capacity: 1, processingSeconds: 60 });
  model.description =
    '17 customers arrive together. Kassor has one regular checkout and one closed reserve checkout. Both require one person from the same staff pool.';
  model.defaults = { seed: 42, durationSeconds: 75 };
  model.particleTypes[0].name = 'Kund';
  model.nodes[0].name = 'Ankomster';
  model.nodes[2].name = 'Klart';
  const checkout = model.nodes.find((node) => node.type === 'work')!;
  checkout.name = 'Kassor';
  checkout.work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
  model.resources = [{ id: 'staff', name: 'Personal', capacity: busy ? 1 : 2, unit: 'person' }];
  const label = busy ? ' / 1 person' : enabled ? ' / 2 people' : ' / Behavior off';
  const graph = createSimulationGraph(`Behavior demo: Checkout${label}`, model);
  const nodeId = graph.simulation!.nodes.find((node) => node.type === 'work')!.id;
  const threshold = definition(
    'Kötröskel',
    `parameter threshold as number = 15
parameter receiver as node

on queueChanged
  if queue.previousLength <= threshold and queue.length > threshold then
    send "öppna" to node receiver
  end if
end`,
  );
  const reserve = definition(
    'Öppna reservkassa',
    `parameter staffing as resource

on "öppna"
  open reserve slot using resource staffing
end`,
  );
  return setBehaviorLibrary(graph, {
    definitions: [threshold, reserve],
    bindings: [
      {
        id: crypto.randomUUID(),
        definitionId: threshold.id,
        nodeId,
        enabled,
        parameters: { receiver: nodeId },
      },
      {
        id: crypto.randomUUID(),
        definitionId: reserve.id,
        nodeId,
        enabled: true,
        parameters: { staffing: 'staff' },
      },
    ],
  });
}
