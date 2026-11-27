import { notationOwnedIds } from '../notation/attachments';
import { base, type Graph, type GraphNode, type GraphEdge } from '../model/types';
import { getCsvNode } from '../data/csv';
import { graphDatasets } from '../data/model';
import { offsetSpatialNode } from '../spatial/types';
import { remapCopiedSqlQuery } from '../sql/copy';
import {
  copySimulationSelection,
  pasteSimulationSelectionWithResources,
  type SimulationClipboard,
} from '../simulation/clipboard';
import {
  behaviorReferenceParameters,
  getBehaviorLibrary,
  remapBehaviorParameters,
  validateBehaviorLibrary,
  type BehaviorLibrary,
} from '../behaviors/document';
import { StorageError } from '../model/errors';
import { remapNotationGraph } from '../notation/remap';
import { validateClipboardTopology } from './clipboard-validation';

interface BehaviorClipboard {
  diagramId: string;
  library: BehaviorLibrary;
}

export interface Clip {
  format: 'visual-nerve-clipboard';
  nodes: GraphNode[];
  edges: GraphEdge[];
  simulation?: SimulationClipboard;
  behaviors?: BehaviorClipboard;
}

export function copySelection(graph: Graph, ids: string[]): Clip {
  const set = notationOwnedIds(graph.nodes, ids, true);
  const library = getBehaviorLibrary(graph);
  const bindings = library.bindings.filter((binding) => set.has(binding.nodeId));
  const definitionIds = new Set(bindings.map((binding) => binding.definitionId));
  const definitions = library.definitions.filter((definition) => definitionIds.has(definition.id));
  const behaviorResourceIds = new Set<string>();
  if (graph.simulation && bindings.length) {
    const resourceParameters = new Map(
      definitions.map((definition) => [
        definition.id,
        behaviorReferenceParameters(definition).filter(({ type }) => type === 'resource'),
      ]),
    );
    for (const binding of bindings) {
      for (const { name } of resourceParameters.get(binding.definitionId) ?? []) {
        const id = binding.parameters[name];
        if (typeof id === 'string') behaviorResourceIds.add(id);
      }
    }
  }
  return structuredClone({
    format: 'visual-nerve-clipboard' as const,
    nodes: graph.nodes
      .filter((n) => set.has(n.id))
      .map((node) =>
        node.parentId && !set.has(node.parentId) ? { ...node, parentId: undefined } : node,
      ),
    edges: graph.edges.filter((e) => set.has(e.sourceNodeId) && set.has(e.targetNodeId)),
    ...(graph.simulation
      ? { simulation: copySimulationSelection(graph, set, behaviorResourceIds) }
      : {}),
    ...(bindings.length
      ? { behaviors: { diagramId: graph.diagram.id, library: { definitions, bindings } } }
      : {}),
  });
}

function pasteBehaviors(
  clipboard: BehaviorClipboard,
  target: Graph | string,
  nodeIds: ReadonlyMap<string, string>,
  resourceIds: ReadonlyMap<string, string> | undefined,
): BehaviorLibrary | undefined {
  if (!clipboard.library.bindings.length) return;
  const existing = typeof target === 'string' ? undefined : getBehaviorLibrary(target);
  const sameDocument = typeof target !== 'string' && target.diagram.id === clipboard.diagramId;
  const definitions = [...(existing?.definitions ?? [])];
  const usedDefinitions = new Set(
    clipboard.library.bindings.map((binding) => binding.definitionId),
  );
  const definitionIds = new Map<string, string>();
  const referenceParameters = new Map<string, ReturnType<typeof behaviorReferenceParameters>>();
  for (const definition of clipboard.library.definitions) {
    const { id, name, version, source, draftSource } = definition;
    if (!usedDefinitions.has(id)) continue;
    referenceParameters.set(id, behaviorReferenceParameters(definition));
    const current = sameDocument ? existing?.definitions.find((item) => item.id === id) : undefined;
    if (
      current?.name === name &&
      current.version === version &&
      current.source === source &&
      current.draftSource === draftSource
    ) {
      definitionIds.set(id, current.id);
    } else {
      const newId = crypto.randomUUID();
      definitionIds.set(id, newId);
      definitions.push({
        id: newId,
        name,
        version,
        source,
        ...(draftSource !== undefined ? { draftSource } : {}),
      });
    }
  }
  const bindings = clipboard.library.bindings.map((binding) => {
    const references = referenceParameters.get(binding.definitionId)!;
    const parameters = remapBehaviorParameters(
      binding.parameters,
      references,
      nodeIds,
      resourceIds,
    );
    let enabled = binding.enabled;
    if (!sameDocument) {
      // A reference outside the transfer cannot be resolved by matching a destination ID.
      for (const { name, type } of references) {
        const id = binding.parameters[name];
        const ids = type === 'node' ? nodeIds : resourceIds;
        if (typeof id === 'string' && !ids?.has(id)) {
          delete parameters[name];
          enabled = false;
        }
      }
    }
    return {
      id: crypto.randomUUID(),
      definitionId: definitionIds.get(binding.definitionId)!,
      nodeId: nodeIds.get(binding.nodeId)!,
      enabled,
      parameters,
    };
  });
  const library = { definitions, bindings: [...(existing?.bindings ?? []), ...bindings] };
  validateBehaviorLibrary(library);
  return library;
}

export function pasteSelection(
  clip: Clip,
  target: Graph | string,
  offset = 40,
): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  simulation?: Graph['simulation'];
  behaviors?: BehaviorLibrary;
} {
  validateClipboardTopology(clip);
  if (clip.behaviors !== undefined) {
    const clipboard = clip.behaviors;
    if (
      !clipboard ||
      typeof clipboard.diagramId !== 'string' ||
      !clipboard.diagramId ||
      clip.nodes.some((node) => node.diagramId !== clipboard.diagramId) ||
      (clip.simulation && clip.simulation.diagramId !== clipboard.diagramId)
    )
      throw new StorageError(422, 'Invalid Behavior clipboard source diagram.');
    validateBehaviorLibrary(clipboard.library);
    const selectedNodes = new Set(clip.nodes.map(({ id }) => id));
    if (clipboard.library.bindings.some(({ nodeId }) => !selectedNodes.has(nodeId)))
      throw new StorageError(422, 'Behavior clipboard binding refers to a missing node.');
  }
  const diagramId = typeof target === 'string' ? target : target.diagram.id;
  const datasetIds = new Set(
    typeof target === 'string' ? [] : graphDatasets(target).map((source) => source.id),
  );
  const remap = new Map(clip.nodes.map((n) => [n.id, crypto.randomUUID()]));
  const result = remapCopiedSqlQuery(
    clip.nodes.map((n) => {
      const copy = offsetSpatialNode(structuredClone(n), offset / 120);
      const csv = getCsvNode(copy);
      if (csv && copy.metadata.csv !== undefined) {
        if (!datasetIds.has(csv.datasetId)) {
          const { csv: _binding, ...metadata } = copy.metadata;
          copy.metadata = { ...metadata, csvSnapshot: { ...csv, visible: true } };
        } else copy.metadata = { ...copy.metadata, csv: { ...csv, visible: true } };
      } else if (csv && copy.metadata.csvSnapshot !== undefined) {
        copy.metadata = { ...copy.metadata, csvSnapshot: { ...csv, visible: true } };
      }
      return {
        ...copy,
        ...base(),
        id: remap.get(n.id)!,
        diagramId,
        externalId: undefined,
        parentId: n.parentId ? remap.get(n.parentId) : undefined,
        x: n.x + offset,
        y: n.y + offset,
      };
    }),
    clip.edges.map((e) => ({
      ...structuredClone(e),
      ...base(),
      diagramId,
      externalId: undefined,
      sourceNodeId: remap.get(e.sourceNodeId)!,
      targetNodeId: remap.get(e.targetNodeId)!,
      ...(e.metadata.csvGenerated === true || e.metadata.csvModelGenerated === true
        ? {
            metadata: {
              ...structuredClone(e.metadata),
              csvGenerated: false,
              csvModelGenerated: false,
            },
          }
        : {}),
    })),
  );
  const simulation =
    clip.simulation && typeof target !== 'string' && target.simulation
      ? pasteSimulationSelectionWithResources(
          clip.simulation,
          target,
          remap,
          new Map(clip.edges.map((edge, index) => [edge.id, result.edges[index].id])),
        )
      : undefined;
  const behaviors = clip.behaviors
    ? pasteBehaviors(clip.behaviors, target, remap, simulation?.resourceIds)
    : undefined;
  const remapped = remapNotationGraph({ ...result, diagram: { id: diagramId } } as Graph, remap);
  return {
    nodes: remapped.nodes,
    edges: remapped.edges,
    ...(simulation ? { simulation: simulation.model } : {}),
    ...(behaviors ? { behaviors } : {}),
  };
}
