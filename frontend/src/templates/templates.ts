import manifest from './manifest.json';
import { base, type Graph } from '../model/types';
import { createSimulationGraph } from '../simulation/document';
import { remapSimulationModel } from '../simulation/copy';
import { createEmptySimulationModel } from '../simulation/starter';
import { DeliveryNetworkExample } from '../simulation/delivery-example';
import { ParallelDeliveryExample } from '../simulation/parallel-delivery-example';
const files = import.meta.glob<Graph>('./*.json', { eager: true, import: 'default' });
export const templates = manifest;
export function instantiate(key: string, name: string, source?: Graph): Graph {
  if (key === 'process-simulator' && !source) return createSimulationGraph(name);
  if (key === 'process-simulator-blank' && !source)
    return createSimulationGraph(name, createEmptySimulationModel());
  if (key === 'delivery-network-simulator' && !source)
    return new DeliveryNetworkExample().graph(name);
  if (key === 'parallel-delivery-simulator' && !source)
    return new ParallelDeliveryExample().graph(name);
  const graph = structuredClone(source ?? files[`./${key}.json`]);
  if (!graph) throw new Error('Unknown template.');
  graph.diagram = { ...graph.diagram, ...base(), name };
  const ids = new Map(
    [...graph.nodes, ...graph.edges, ...graph.owners].map((e) => [e.id, crypto.randomUUID()]),
  );
  graph.owners = graph.owners.map((o) => ({ ...o, ...base(), id: ids.get(o.id)! }));
  graph.nodes = graph.nodes.map((n) => ({
    ...n,
    ...base(),
    id: ids.get(n.id)!,
    diagramId: graph.diagram.id,
    parentId: n.parentId ? ids.get(n.parentId) : undefined,
    ownerId: n.ownerId ? ids.get(n.ownerId) : undefined,
    ownerIds: n.ownerIds.map((id) => ids.get(id)!),
  }));
  graph.edges = graph.edges.map((e) => ({
    ...e,
    ...base(),
    id: ids.get(e.id)!,
    diagramId: graph.diagram.id,
    sourceNodeId: ids.get(e.sourceNodeId)!,
    targetNodeId: ids.get(e.targetNodeId)!,
  }));
  if (graph.simulation) graph.simulation = remapSimulationModel(graph.simulation, ids, ids);
  if (graph.diagram.type === 'mindmap' && graph.nodes[0]) graph.nodes[0].title = name;
  if (graph.diagram.type === 'timeline') {
    const origin = Date.parse(graph.nodes[0].startDate!);
    const today = Date.parse(new Date().toISOString().slice(0, 10));
    graph.nodes = graph.nodes.map((n) => ({
      ...n,
      startDate: new Date(Date.parse(n.startDate!) + today - origin).toISOString().slice(0, 10),
      endDate: new Date(Date.parse(n.endDate!) + today - origin).toISOString().slice(0, 10),
    }));
  }
  return graph;
}
