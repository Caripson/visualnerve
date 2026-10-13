import { describe, expect, it } from 'vitest';
import { blankGraph, newNode, type Graph } from '../src/model/types';
import { validateGraph } from '../src/model/validation';
import { GameIdentityCopy } from '../src/roblox/copy';
import {
  createGameGraph,
  gameProjection,
  reconcileGameGraph,
  setGameDefinition,
  validateGameGraph,
} from '../src/roblox/document';
import { remapGameGraph } from '../src/roblox/remap';
import {
  createGameEntity,
  createRobloxAdventureGame,
  createRobloxEmptyGame,
} from '../src/roblox/starter';
import { validateGameDefinition } from '../src/roblox/validate';
import type { GameDefinition } from '../src/roblox/types';

function overlappingIds(): GameDefinition {
  const game = createRobloxEmptyGame('Same names, different scopes');
  game.id = 'same';
  game.entities = [createGameEntity('spawn', 'same')];
  game.variables = [
    { id: 'same', name: 'same', scope: 'player', initial: 0 },
    { id: 'label', name: 'Label', scope: 'player', initial: 'same' },
  ];
  game.items = [{ id: 'same', name: 'same', maxStack: 3 }];
  game.quests = [{ id: 'same', name: 'same', description: 'same', target: 2 }];
  game.timers = [{ id: 'same', name: 'same', scope: 'player', duration: 5, repeat: false }];
  game.prefabs = [
    {
      id: 'same',
      name: 'same',
      entities: [createGameEntity('platform', 'same')],
      parameters: [{ id: 'same', name: 'same', default: 2 }],
      bindings: [{ entityId: 'same', parameterId: 'same', property: 'position.x' }],
      rules: [
        {
          id: 'same',
          name: 'same',
          enabled: true,
          event: { kind: 'touch', entityId: 'same' },
          actions: [
            {
              kind: 'addVariable',
              variableId: 'same',
              value: { kind: 'parameter', parameterId: 'same' },
            },
            { kind: 'message', text: 'same' },
          ],
          cooldown: 1,
          oncePerPlayer: true,
        },
      ],
    },
  ];
  game.instances = [
    {
      id: 'same',
      name: 'same',
      prefabId: 'same',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      parameters: { same: 3 },
    },
  ];
  game.rules = [
    {
      id: 'same',
      name: 'same',
      enabled: true,
      event: { kind: 'touch', entityId: 'same' },
      condition: {
        kind: 'compare',
        operator: '==',
        left: { kind: 'variable', variableId: 'label' },
        right: { kind: 'literal', value: 'same' },
      },
      actions: [
        { kind: 'addVariable', variableId: 'same', value: { kind: 'literal', value: 1 } },
        { kind: 'giveItem', itemId: 'same', amount: { kind: 'literal', value: 1 } },
        { kind: 'startQuest', questId: 'same' },
        { kind: 'startTimer', timerId: 'same' },
        { kind: 'teleport', entityId: 'same/same' },
        { kind: 'message', text: 'same' },
      ],
      cooldown: 1,
      oncePerPlayer: false,
    },
  ];
  return game;
}

describe('canonical Roblox diagrams', () => {
  it('copies collection and prefab-local scopes independently while preserving literals/defaults', () => {
    const source = overlappingIds();
    expect(validateGameDefinition(source).valid).toBe(true);
    let sequence = 0;
    const copy = new GameIdentityCopy(source, () => `copied-${++sequence}`),
      game = copy.model();
    expect(validateGameDefinition(game).diagnostics).toEqual([]);
    const declarations = [
      game.id,
      ...[
        game.entities,
        game.variables,
        game.items,
        game.quests,
        game.timers,
        game.prefabs,
        game.instances,
        game.rules,
      ].flatMap((items) => items.map((item) => item.id)),
      ...[game.prefabs[0].entities, game.prefabs[0].rules, game.prefabs[0].parameters!].flatMap(
        (items) => items.map((item) => item.id),
      ),
    ];
    expect(new Set(declarations).size).toBe(declarations.length);
    expect(game.rules[0].event).toEqual({ kind: 'touch', entityId: game.entities[0].id });
    expect(game.rules[0].actions[0]).toMatchObject({ variableId: game.variables[0].id });
    expect(game.rules[0].actions[1]).toMatchObject({ itemId: game.items[0].id });
    expect(game.rules[0].actions[2]).toMatchObject({ questId: game.quests[0].id });
    expect(game.rules[0].actions[3]).toMatchObject({ timerId: game.timers[0].id });
    expect(game.rules[0].actions[4]).toMatchObject({
      entityId: `${game.instances[0].id}/${game.prefabs[0].entities[0].id}`,
    });
    expect(game.rules[0].condition).toMatchObject({ right: { value: 'same' } });
    expect(game.rules[0].actions[5]).toEqual({ kind: 'message', text: 'same' });
    expect(game.variables[1].initial).toBe('same');
    expect(game.quests[0].description).toBe('same');
    const prefab = game.prefabs[0];
    expect(prefab.rules[0].event).toEqual({ kind: 'touch', entityId: prefab.entities[0].id });
    expect(prefab.rules[0].actions[0]).toMatchObject({
      variableId: game.variables[0].id,
      value: { parameterId: prefab.parameters![0].id },
    });
    expect(prefab.bindings![0]).toMatchObject({
      entityId: prefab.entities[0].id,
      parameterId: prefab.parameters![0].id,
    });
    expect(game.instances[0].parameters).toEqual({ [prefab.parameters![0].id]: 3 });
    expect(prefab.parameters![0].default).toBe(2);
    expect(copy.edgeKey('rule:same:0:entities:same')).toBe(
      `rule:${game.rules[0].id}:0:entities:${game.entities[0].id}`,
    );
    expect(copy.edgeKey('rule:same:1:variables:same')).toBe(
      `rule:${game.rules[0].id}:1:variables:${game.variables[0].id}`,
    );
    expect(source).toEqual(overlappingIds());
  });
  it('projects all typed resources into stable cards and causal links without losing annotations', () => {
    let graph = blankGraph('Island', 'flowchart');
    const note = newNode(graph.diagram.id, {
      title: 'My notes',
      x: 987,
      y: 654,
      description: 'Keep me',
    });
    graph.nodes.push(note);
    graph = setGameDefinition(graph, createRobloxAdventureGame());
    validateGraph(graph);
    const game = graph.diagram.game!;
    expect(graph.nodes.filter((node) => gameProjection(node))).toHaveLength(
      Object.values(game)
        .filter(Array.isArray)
        .reduce((sum, list) => sum + list.length, 0),
    );
    const floor = graph.nodes.find((node) => gameProjection(node)?.id === 'island')!;
    floor.x = 1200;
    floor.description = 'My design notes';
    floor.metadata.note = 'Keep metadata';
    const updated = structuredClone(game);
    updated.entities.find((entity) => entity.id === 'island')!.name = 'My bigger island';
    const next = setGameDefinition(graph, updated),
      projected = next.nodes.find((node) => node.id === floor.id)!;
    expect(projected).toMatchObject({
      id: floor.id,
      x: 1200,
      title: 'My bigger island',
      description: 'My design notes',
      metadata: { note: 'Keep metadata' },
    });
    expect(next.nodes.find((node) => node.id === note.id)).toEqual(note);
    expect(next.edges.map((edge) => edge.id)).toEqual(graph.edges.map((edge) => edge.id));
  });
  it('reconciles generic title/background edits and keeps diagram coordinates out of the world model', () => {
    const original = createGameGraph('Island', createRobloxAdventureGame()),
      next = structuredClone(original);
    const node = next.nodes.find((entry) => gameProjection(entry)?.kind === 'entities')!;
    const ref = gameProjection(node)!;
    const position = original.diagram.game!.entities.find((entity) => entity.id === ref.id)!
      .transform.position;
    node.title = 'My new island';
    node.backgroundColor = '#112233';
    node.x += 1000;
    node.y -= 800;
    const reconciled = reconcileGameGraph(original, next);
    validateGameGraph(reconciled);
    expect(reconciled.diagram.game!.entities.find((entity) => entity.id === ref.id)).toMatchObject({
      name: 'My new island',
      color: '#112233',
      transform: { position },
    });
    expect(reconciled.nodes.find((entry) => entry.id === node.id)!.x).toBe(node.x);
    const invalid = structuredClone(original);
    invalid.nodes = invalid.nodes.filter((entry) => entry.id !== node.id);
    expect(() => reconcileGameGraph(original, invalid)).toThrow(/Remove this game object/);
  });
  it('preserves ordinary child notes when their managed parent is removed semantically', () => {
    const graph = createGameGraph('Notes stay mine', createRobloxEmptyGame());
    const entity = createGameEntity('decoration', 'temporary');
    const game = graph.diagram.game!;
    game.entities.push(entity);
    const projected = setGameDefinition(graph, game);
    const parent = projected.nodes.find((node) => gameProjection(node)?.id === entity.id)!;
    const note = newNode(projected.diagram.id, {
      title: 'Keep this design decision',
      description: 'The idea still matters after removing the object.',
      parentId: parent.id,
      x: 120,
      y: 340,
    });
    projected.nodes.push(note);
    const updated = structuredClone(game);
    updated.entities = updated.entities.filter((value) => value.id !== entity.id);
    const next = setGameDefinition(projected, updated);
    validateGraph(next);
    expect(next.nodes.some((node) => node.id === parent.id)).toBe(false);
    expect(next.nodes.find((node) => node.id === note.id)).toEqual({
      ...note,
      parentId: undefined,
    });
  });
  it('remaps semantic projection refs and generated edge keys while preserving native layout and literal data', () => {
    const graph = createGameGraph('Island', createRobloxAdventureGame());
    const oldGame = graph.diagram.game!;
    const before = JSON.stringify(graph);
    const remapped = remapGameGraph(graph);
    validateGraph(remapped);
    expect(JSON.stringify(graph)).toBe(before);
    expect(remapped.diagram.game!.id).not.toBe(oldGame.id);
    expect(remapped.nodes.map((node) => [node.id, node.x, node.y])).toEqual(
      graph.nodes.map((node) => [node.id, node.x, node.y]),
    );
    expect(remapped.edges.map((edge) => edge.id)).toEqual(graph.edges.map((edge) => edge.id));
    for (const node of remapped.nodes) {
      const ref = gameProjection(node)!;
      expect(remapped.diagram.game![ref.kind].some((entity) => entity.id === ref.id)).toBe(true);
      expect(oldGame[ref.kind].some((entity) => entity.id === ref.id)).toBe(false);
    }
    expect(remapped.diagram.game!.rules.map((rule) => rule.name)).toEqual(
      oldGame.rules.map((rule) => rule.name),
    );
    expect(
      remapped.diagram.game!.instances.map(
        (instance) => instance.parameters && Object.values(instance.parameters),
      ),
    ).toEqual(
      oldGame.instances.map(
        (instance) => instance.parameters && Object.values(instance.parameters),
      ),
    );
  });
});
