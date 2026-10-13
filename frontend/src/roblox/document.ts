import { blankGraph, newEdge, newNode, type Graph, type GraphNode } from '../model/types';
import { RobloxError } from './errors';
import type { GameDefinition } from './types';
import { validateGameDefinition } from './validate';
import { gameCollections, ruleReferences, type GameCollection } from './references';
import { GameIdentityCopy } from './copy';

export interface GameProjection {
  schemaVersion: 1;
  kind: GameCollection;
  id: string;
}
const colors: Record<GameCollection, string> = {
  entities: '#25634d',
  rules: '#3e67a8',
  variables: '#956320',
  items: '#bd872c',
  quests: '#8063a7',
  timers: '#3e8795',
  prefabs: '#696198',
  instances: '#447d69',
};
export function gameProjection(node: GraphNode): GameProjection | undefined {
  const value = node.metadata.roblox;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const ref = value as GameProjection;
  return ref.schemaVersion === 1 && gameCollections.includes(ref.kind) && typeof ref.id === 'string'
    ? ref
    : undefined;
}
export function assertGameDefinition(value: unknown): asserts value is GameDefinition {
  const checked = validateGameDefinition(value);
  if (!checked.valid)
    throw new RobloxError(
      422,
      checked.diagnostics.map((issue) => `${issue.path}: ${issue.message}`).join('\n'),
      'ROBLOX_GAME_INVALID',
      checked.diagnostics,
    );
}
function key(ref: GameProjection) {
  return `${ref.kind}:${ref.id}`;
}

/** One model owns gameplay. Native cards own only diagram presentation and annotations. */
export function setGameDefinition(graph: Graph, input: GameDefinition): Graph {
  assertGameDefinition(input);
  if (graph.diagram.type !== 'flowchart' || graph.simulation || graph.diagram.analytics)
    throw new RobloxError(
      422,
      'A game blueprint cannot also contain a simulation or time-series model.',
      'ROBLOX_DOCUMENT_INCOMPATIBLE',
    );
  const game = structuredClone(input);
  const previous = new Map(
    graph.nodes.flatMap((node) => {
      const ref = gameProjection(node);
      return ref ? [[key(ref), node] as const] : [];
    }),
  );
  const nodes = graph.nodes.filter((node) => !gameProjection(node));
  const nodeByKey = new Map<string, GraphNode>();
  let column = 0;
  for (const collection of gameCollections) {
    let row = 0;
    for (const entity of game[collection]) {
      const ref: GameProjection = { schemaVersion: 1, kind: collection, id: entity.id };
      const existing = previous.get(key(ref));
      const isObject = collection === 'entities';
      const object = isObject ? game.entities.find((value) => value.id === entity.id) : undefined;
      const node = {
        ...(existing ??
          newNode(graph.diagram.id, { x: column * 290, y: row * 135, width: 250, height: 100 })),
        title: entity.name,
        nodeType: (object?.kind === 'spawn'
          ? 'start'
          : object?.kind === 'goal'
            ? 'end'
            : collection === 'rules'
              ? 'decision'
              : collection === 'variables' || collection === 'items'
                ? 'database'
                : collection === 'prefabs'
                  ? 'group'
                  : 'process') as GraphNode['nodeType'],
        color: existing?.color ?? colors[collection],
        ...(object ? { backgroundColor: object.color } : {}),
        metadata: { ...(existing?.metadata ?? {}), roblox: ref },
      };
      nodes.push(node);
      nodeByKey.set(key(ref), node);
      row++;
    }
    column++;
  }
  const nodeIds = new Set(nodes.map((node) => node.id));
  const removedCards = new Set(
    graph.nodes
      .filter((node) => gameProjection(node) && !nodeIds.has(node.id))
      .map((node) => node.id),
  );
  for (let index = 0; index < nodes.length; index++) {
    if (nodes[index].parentId && removedCards.has(nodes[index].parentId!))
      nodes[index] = { ...nodes[index], parentId: undefined };
  }
  const edges = graph.edges.filter(
    (edge) =>
      edge.metadata.robloxGenerated !== true &&
      nodeIds.has(edge.sourceNodeId) &&
      nodeIds.has(edge.targetNodeId),
  );
  const oldEdges = new Map(
    graph.edges
      .filter((edge) => edge.metadata.robloxGenerated === true)
      .map((edge) => [String(edge.metadata.robloxKey), edge]),
  );
  const attach = (
    source: GraphNode | undefined,
    target: GraphNode | undefined,
    label: string,
    semanticKey: string,
  ) => {
    if (!source || !target) return;
    const existing = oldEdges.get(semanticKey);
    edges.push({
      ...(existing ?? newEdge(graph.diagram.id, source.id, target.id)),
      sourceNodeId: source.id,
      targetNodeId: target.id,
      label,
      edgeType: 'game-relationship',
      metadata: { ...(existing?.metadata ?? {}), robloxGenerated: true, robloxKey: semanticKey },
    });
  };
  const referenceNode = (collection: GameCollection, id: string) =>
    nodeByKey.get(`${collection}:${id}`) ??
    (collection === 'entities' && id.includes('/')
      ? nodeByKey.get(`instances:${id.split('/')[0]}`)
      : undefined);
  for (const rule of game.rules) {
    const ruleNode = nodeByKey.get(`rules:${rule.id}`);
    const refs = ruleReferences(rule);
    refs.forEach((ref, index) => {
      const target = referenceNode(ref.collection, ref.id);
      attach(
        ref.output ? ruleNode : target,
        ref.output ? target : ruleNode,
        ref.label,
        `rule:${rule.id}:${index}:${ref.collection}:${ref.id}`,
      );
    });
  }
  for (const instance of game.instances)
    attach(
      nodeByKey.get(`prefabs:${instance.prefabId}`),
      nodeByKey.get(`instances:${instance.id}`),
      'Uses prefab',
      `instance:${instance.id}:${instance.prefabId}`,
    );
  return { ...graph, diagram: { ...graph.diagram, game }, nodes, edges };
}
export function createGameGraph(name: string, input: GameDefinition): Graph {
  const graph = blankGraph(name, 'flowchart');
  return setGameDefinition(graph, new GameIdentityCopy({ ...input, name }).model());
}

/** Generic title edits remain semantic; presentation coordinates never move world objects. */
export function reconcileGameGraph(previous: Graph | undefined, next: Graph): Graph {
  if (!previous?.diagram.game && !next.diagram.game) return next;
  if (!previous && next.diagram.game) return setGameDefinition(next, next.diagram.game);
  if (!next.diagram.game)
    throw new RobloxError(
      422,
      'Use the game commands to remove a game blueprint.',
      'ROBLOX_MODEL_REQUIRED',
    );
  if (JSON.stringify(next.diagram.game) !== JSON.stringify(previous?.diagram.game))
    return setGameDefinition(next, next.diagram.game);
  const game = structuredClone(next.diagram.game);
  validateGameGraph(next);
  const previousIds = new Set(previous!.nodes.map((node) => node.id));
  if (next.nodes.some((node) => gameProjection(node) && !previousIds.has(node.id)))
    throw new RobloxError(
      422,
      'Duplicate game objects in the builder. Copying a diagram card does not create a world object.',
      'ROBLOX_MANAGED_NODE',
    );
  for (const oldEdge of previous!.edges.filter((edge) => edge.metadata.robloxGenerated === true)) {
    const edge = next.edges.find((value) => value.id === oldEdge.id);
    if (
      !edge ||
      edge.sourceNodeId !== oldEdge.sourceNodeId ||
      edge.targetNodeId !== oldEdge.targetNodeId ||
      edge.metadata.robloxKey !== oldEdge.metadata.robloxKey ||
      edge.metadata.robloxGenerated !== true
    )
      throw new RobloxError(
        422,
        'Edit game relationships in the rule builder. Their diagram connections are generated from gameplay.',
        'ROBLOX_MANAGED_EDGE',
      );
  }
  for (const previousNode of previous!.nodes) {
    const ref = gameProjection(previousNode);
    if (!ref) continue;
    const current = next.nodes.find((node) => node.id === previousNode.id);
    if (!current)
      throw new RobloxError(
        422,
        'Remove this game object in the game builder so its rule references can be checked.',
        'ROBLOX_MANAGED_NODE',
      );
    const currentRef = gameProjection(current);
    if (!currentRef || key(currentRef) !== key(ref))
      throw new RobloxError(
        422,
        'Game references cannot be changed through generic node metadata.',
        'ROBLOX_MANAGED_NODE',
      );
    const entity = game[ref.kind].find((value) => value.id === ref.id);
    if (entity && current.title !== previousNode.title) entity.name = current.title;
    if (ref.kind === 'entities' && current.backgroundColor !== previousNode.backgroundColor) {
      const object = game.entities.find((value) => value.id === ref.id)!;
      object.color = current.backgroundColor ?? '#ffffff';
    }
  }
  return setGameDefinition(next, game);
}
export function validateGameGraph(graph: Graph) {
  if (!graph.diagram.game) {
    if (graph.nodes.some((node) => node.metadata.roblox !== undefined))
      throw new RobloxError(
        422,
        'Game object references require a game definition.',
        'ROBLOX_MODEL_REQUIRED',
      );
    return;
  }
  assertGameDefinition(graph.diagram.game);
  if (graph.diagram.type !== 'flowchart' || graph.simulation || graph.diagram.analytics)
    throw new RobloxError(
      422,
      'Game blueprints cannot contain simulation or analytics payloads.',
      'ROBLOX_DOCUMENT_INCOMPATIBLE',
    );
  const seen = new Set<string>();
  for (const node of graph.nodes) {
    if (node.metadata.roblox === undefined) continue;
    const ref = gameProjection(node);
    if (
      !ref ||
      Object.keys(node.metadata.roblox as object).some(
        (field) => !['schemaVersion', 'kind', 'id'].includes(field),
      ) ||
      !graph.diagram.game[ref.kind].some((entity) => entity.id === ref.id) ||
      seen.has(key(ref))
    )
      throw new RobloxError(
        422,
        'Invalid, missing or duplicate projected game reference.',
        'ROBLOX_PROJECTION_INVALID',
      );
    seen.add(key(ref));
  }
}
