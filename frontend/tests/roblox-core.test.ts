import { describe, expect, it } from 'vitest';
import { SaxesParser } from 'saxes';
import {
  compileRobloxGame,
  luauLongString,
  serializeRobloxAttributes,
} from '../src/roblox/compiler';
import { expandGameDefinition, gameRotationMatrix } from '../src/roblox/expand';
import { RobloxSimulator } from '../src/roblox/simulator';
import {
  createGameEntity,
  createRobloxAdventureGame,
  createRobloxEmptyGame,
  createRobloxStarterGame,
} from '../src/roblox/starter';
import {
  ROBLOX_LIMITS,
  type GameAction,
  type GameDefinition,
  type GameRule,
} from '../src/roblox/types';
import { RobloxValidationError, validateGameDefinition } from '../src/roblox/validate';
const number = (value: number) => ({ kind: 'literal' as const, value });
const rule = (
  id: string,
  event: GameRule['event'],
  actions: GameAction[],
  extra: Partial<GameRule> = {},
): GameRule => ({
  id,
  name: id,
  enabled: true,
  event,
  actions,
  cooldown: 0,
  oncePerPlayer: false,
  ...extra,
});
function decodedAttributes(xml: string) {
  const body = xml.match(/<BinaryString name="AttributesSerialize">([^<]+)<\/BinaryString>/)![1];
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0)),
    view = new DataView(bytes.buffer),
    decoder = new TextDecoder();
  let offset = 0;
  const u32 = () => {
    const result = view.getUint32(offset, true);
    offset += 4;
    return result;
  };
  const text = () => {
    const length = u32();
    const value = decoder.decode(bytes.slice(offset, offset + length));
    offset += length;
    return value;
  };
  const count = u32(),
    result: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const name = text();
    expect(bytes[offset++]).toBe(2);
    result[name] = text();
  }
  expect(offset).toBe(bytes.length);
  return result;
}
function nativeDefinition(source: string) {
  const match = source.match(/JSONDecode\(\[(=+)\[([\s\S]*?)\]\1\]\)/)!;
  return JSON.parse(match[2]) as Omit<GameDefinition, 'prefabs' | 'instances'>;
}
function xmlClasses(source: string) {
  const parser = new SaxesParser(),
    classes: string[] = [];
  parser.on('opentag', (tag) => {
    if (tag.name === 'Item') classes.push(String(tag.attributes.class));
  });
  parser.write(source).close();
  return classes;
}

describe('Roblox game v1 contract', () => {
  it('allows unfinished source but refuses building without a spawn', () => {
    const game = createRobloxEmptyGame();
    expect(validateGameDefinition(game).valid).toBe(true);
    expect(
      validateGameDefinition(game, { playable: true }).diagnostics.map((d) => d.code),
    ).toContain('spawn-required');
    expect(() => compileRobloxGame(game)).toThrow(RobloxValidationError);
  });
  it('accepts starter and advanced templates with actual parameterized prefab semantics', () => {
    expect(
      validateGameDefinition(createRobloxStarterGame(), { playable: true }).diagnostics,
    ).toEqual([]);
    const game = createRobloxAdventureGame();
    expect(validateGameDefinition(game, { playable: true }).diagnostics).toEqual([]);
    const expanded = expandGameDefinition(game);
    expect(expanded.entities).toHaveLength(13);
    expect(expanded.rules).toHaveLength(15);
    expect(expanded.entities.find((entity) => entity.id === 'second-crystal/crystal')!.color).toBe(
      '#a78bfa',
    );
    expect(expanded.rules.find((rule) => rule.id === 'third-crystal/pick-up')!.actions[2]).toEqual({
      kind: 'addVariable',
      variableId: 'score',
      value: number(30),
    });
    expect(JSON.stringify(expanded)).not.toContain('"kind":"parameter"');
    expect(game.prefabs[0].rules[0].actions[2]).toEqual({
      kind: 'addVariable',
      variableId: 'score',
      value: { kind: 'parameter', parameterId: 'points' },
    });
  });
  it('rejects executable fields, invalid numbers, broken refs and non-XML Unicode', () => {
    const game = createRobloxStarterGame();
    Object.assign(game.entities[0], { luau: 'os.execute("no")' });
    game.entities[1].transform.position.x = Infinity;
    expect(validateGameDefinition(game).diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(['unsupported-field', 'number']),
    );
    delete (game.entities[0] as unknown as Record<string, unknown>).luau;
    game.entities[1].transform.position.x = 0;
    game.rules[0].actions = [{ kind: 'setVariable', variableId: 'missing', value: number(5) }];
    expect(validateGameDefinition(game).diagnostics.map((d) => d.code)).toContain(
      'variable-reference',
    );
    game.name = 'bad\u0000name';
    expect(validateGameDefinition(game).diagnostics.map((d) => d.code)).toContain('text');
    game.name = 'bad\ud800name';
    expect(validateGameDefinition(game).diagnostics.map((d) => d.code)).toContain('text');
  });
  it('rejects wrong comparisons and player-dependent shared timer instructions', () => {
    const game = createRobloxAdventureGame();
    game.rules.push(
      rule('shared-player', { kind: 'timer', timerId: 'round-clock' }, [
        { kind: 'giveItem', itemId: 'crystal', amount: number(1) },
      ]),
    );
    game.rules.push(
      rule('bad-compare', { kind: 'playerJoin' }, [{ kind: 'message', text: 'no' }], {
        condition: {
          kind: 'compare',
          operator: '>',
          left: { kind: 'literal', value: 'text' },
          right: number(2),
        },
      }),
    );
    expect(validateGameDefinition(game).diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(['shared-timer-player', 'comparison-type']),
    );
  });
  it('validates prefab parameter types, colors and expanded world bounds', () => {
    const game = createRobloxAdventureGame();
    game.instances[0].parameters = { points: 'wrong' };
    expect(validateGameDefinition(game).diagnostics.map((d) => d.code)).toContain('parameter-type');
    game.instances[0].parameters = { shade: 'not-a-colour' };
    expect(validateGameDefinition(game).diagnostics.map((d) => d.code)).toContain('color');
    game.instances[0].parameters = {};
    game.instances[0].position.x = 100000;
    game.prefabs[0].entities[0].transform.position.x = 1;
    expect(validateGameDefinition(game).diagnostics.map((d) => d.code)).toContain(
      'expanded-entity',
    );
  });
  it('checks unused prefab defaults and permits typed references to existing expanded instances', () => {
    const game = createRobloxAdventureGame();
    game.prefabs[1].rules[0].actions.push({ kind: 'teleport', entityId: 'first-crystal/crystal' });
    expect(validateGameDefinition(game).valid).toBe(true);
    game.prefabs.push({
      id: 'unused',
      name: 'Unused prefab',
      entities: [createGameEntity('platform', 'block')],
      rules: [],
      parameters: [{ id: 'size', name: 'Size', default: 0 }],
      bindings: [{ entityId: 'block', property: 'size.y', parameterId: 'size' }],
    });
    expect(validateGameDefinition(game).diagnostics.map((d) => d.code)).toContain('number');
    const valid = createRobloxStarterGame();
    valid.entities[0].color = '#123456\n';
    valid.id = 'valid-id\n';
    expect(validateGameDefinition(valid).diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(['id', 'color']),
    );
  });
  it('composes prefab rotations and movement offsets without mutating the source', () => {
    const game = createRobloxEmptyGame(),
      part = createGameEntity('movingPlatform', 'part');
    part.transform.position.x = 10;
    part.transform.rotation.x = 30;
    game.prefabs = [{ id: 'prefab', name: 'Prefab', entities: [part], rules: [] }];
    game.instances = [
      {
        id: 'clone',
        name: 'Clone',
        prefabId: 'prefab',
        position: { x: 3, y: 4, z: 5 },
        rotation: { x: 0, y: 90, z: 0 },
      },
    ];
    const expanded = expandGameDefinition(game).entities[0];
    expect(expanded.transform.position.x).toBeCloseTo(3);
    expect(expanded.transform.position.z).toBeCloseTo(-5);
    expect(expanded.movement!.offset.x).toBeCloseTo(12);
    expect(expanded.movement!.offset.z).toBeCloseTo(0);
    expect(gameRotationMatrix(expanded.transform.rotation)[2]).toBeCloseTo(Math.cos(Math.PI / 6));
    expect(part.transform.position.x).toBe(10);
  });
  it('admits a 100-player 64-action round and rejects larger declared compositions', () => {
    const game = createRobloxStarterGame();
    game.settings.maxPlayers = 100;
    const actions: GameAction[] = Array.from({ length: 64 }, () => ({
      kind: 'addVariable',
      variableId: 'score',
      value: number(1),
    }));
    game.rules.push(rule('round', { kind: 'roundStart' }, actions));
    expect(validateGameDefinition(game).valid).toBe(true);
    game.rules.push(rule('overflow', { kind: 'roundStart' }, actions));
    expect(validateGameDefinition(game).diagnostics.map((d) => d.code)).toContain('action-budget');
    expect(ROBLOX_LIMITS.actionBudget).toBe(8192);
  });
});

describe('deterministic multiplayer instructions', () => {
  it('executes per-player quests/rewards and shared power/gates with timed rounds', () => {
    const simulator = new RobloxSimulator(createRobloxAdventureGame());
    simulator.join('alex');
    simulator.join('sam');
    simulator.trigger({ kind: 'interact', entityId: 'crystal-gate' }, 'alex');
    expect(simulator.snapshot().entities['crystal-gate'].collidable).toBe(true);
    for (const id of ['first-crystal/crystal', 'second-crystal/crystal', 'third-crystal/crystal'])
      simulator.trigger({ kind: 'touch', entityId: id }, 'alex');
    simulator.trigger({ kind: 'touch', entityId: 'third-crystal/crystal' }, 'alex');
    expect(simulator.snapshot().players.find((p) => p.id === 'alex')).toMatchObject({
      inventory: { crystal: 3 },
      variables: { score: 60 },
      quests: { 'find-crystals': { state: 'complete', progress: 3 } },
    });
    expect(simulator.snapshot().players.find((p) => p.id === 'sam')!.inventory.crystal).toBe(0);
    simulator.trigger({ kind: 'interact', entityId: 'power-switch' }, 'sam');
    expect(simulator.snapshot().shared.power).toBe(1);
    simulator.trigger({ kind: 'interact', entityId: 'crystal-gate' }, 'alex');
    expect(simulator.snapshot().entities['crystal-gate']).toEqual({
      enabled: true,
      visible: false,
      collidable: false,
    });
    expect(simulator.snapshot().players.find((p) => p.id === 'alex')!.inventory.crystal).toBe(0);
    simulator.trigger({ kind: 'touch', entityId: 'treasure' }, 'alex');
    expect(simulator.snapshot().players.find((p) => p.id === 'alex')).toMatchObject({
      won: true,
      variables: { level: 2, score: 160 },
    });
    simulator.trigger({ kind: 'interact', entityId: 'guide' }, 'sam');
    expect(simulator.snapshot().roundActive).toBe(true);
    simulator.advance(20);
    expect(
      simulator
        .snapshot()
        .players.every((p) => p.messages.some((message) => message.startsWith('Hint:'))),
    ).toBe(true);
    simulator.advance(100);
    expect(simulator.snapshot().roundActive).toBe(false);
    expect(
      simulator
        .snapshot()
        .players.every((p) => p.messages.some((message) => message.startsWith('Round over.'))),
    ).toBe(true);
  });
  it('delivers 6400 round actions to all 100 players without starving the last player', () => {
    const game = createRobloxEmptyGame();
    game.entities.push(createGameEntity('spawn', 'start'));
    game.settings.maxPlayers = 100;
    game.variables.push({ id: 'points', name: 'Points', scope: 'player', initial: 0 });
    game.rules = [
      rule('start', { kind: 'interact', entityId: 'start' }, [{ kind: 'startRound' }]),
      rule(
        'reward',
        { kind: 'roundStart' },
        Array.from({ length: 64 }, () => ({
          kind: 'addVariable',
          variableId: 'points',
          value: number(1),
        })),
      ),
    ];
    const simulator = new RobloxSimulator(game);
    for (let i = 0; i < 100; i++) simulator.join(`player${i}`);
    simulator.trigger({ kind: 'interact', entityId: 'start' }, 'player0');
    expect(simulator.snapshot().players).toHaveLength(100);
    expect(simulator.snapshot().players.every((p) => p.variables.points === 64)).toBe(true);
    expect(simulator.snapshot().notices).toEqual([]);
  });
  it('executes repeating timers and clamps inventory, health and calculations; saves checkpoints', () => {
    const game = createRobloxStarterGame();
    game.items = [{ id: 'coins', name: 'Coins', maxStack: 3 }];
    game.timers = [{ id: 'tick', name: 'Tick', scope: 'player', duration: 2, repeat: true }];
    game.rules.push(
      rule('begin-tick', { kind: 'playerJoin' }, [{ kind: 'startTimer', timerId: 'tick' }]),
    );
    game.rules.push(
      rule('tick-score', { kind: 'timer', timerId: 'tick' }, [
        { kind: 'addVariable', variableId: 'score', value: number(2) },
      ]),
    );
    game.rules.push(
      rule('clamp', { kind: 'interact', entityId: 'start' }, [
        { kind: 'giveItem', itemId: 'coins', amount: number(99.5) },
        {
          kind: 'addVariable',
          variableId: 'score',
          value: { kind: 'arithmetic', operator: '*', left: number(1e12), right: number(1e12) },
        },
        { kind: 'heal', amount: number(1000) },
      ]),
    );
    const simulator = new RobloxSimulator(game);
    simulator.join('alex');
    simulator.advance(6);
    expect(simulator.snapshot().players[0].variables.score).toBe(6);
    simulator.trigger({ kind: 'touch', entityId: 'checkpoint' }, 'alex');
    simulator.trigger({ kind: 'touch', entityId: 'lava' }, 'alex');
    expect(simulator.snapshot().players[0].health).toBe(0);
    simulator.respawn('alex');
    expect(simulator.snapshot().players[0]).toMatchObject({
      health: 100,
      checkpoint: 'checkpoint',
      position: { x: 36, y: 3.5, z: 0 },
    });
    simulator.trigger({ kind: 'interact', entityId: 'start' }, 'alex');
    expect(simulator.snapshot().players[0]).toMatchObject({
      health: 100,
      inventory: { coins: 3 },
      variables: { score: 1000000 },
    });
  });
  it('disables touch behavior while preserving the separate visibility and collision settings', () => {
    const game = createRobloxStarterGame();
    game.rules.push(
      rule('disable', { kind: 'interact', entityId: 'start' }, [
        { kind: 'setEntityEnabled', entityId: 'star', value: false },
      ]),
    );
    const simulator = new RobloxSimulator(game);
    simulator.join('alex');
    simulator.trigger({ kind: 'interact', entityId: 'start' }, 'alex');
    simulator.trigger({ kind: 'touch', entityId: 'star' }, 'alex');
    expect(simulator.snapshot().players[0].variables.score).toBe(0);
    expect(simulator.snapshot().entities.star).toEqual({
      enabled: false,
      visible: true,
      collidable: false,
    });
  });
  it('joins and respawns at the first currently enabled spawn with checkpoint fallback', () => {
    const game = createRobloxEmptyGame();
    game.entities = [
      createGameEntity('spawn', 'first'),
      createGameEntity('spawn', 'second'),
      createGameEntity('checkpoint', 'saved'),
    ];
    game.entities.forEach((entity, index) => (entity.transform.position.x = 10 + index * 30));
    game.rules = [
      rule('disable-first', { kind: 'interact', entityId: 'first' }, [
        { kind: 'setEntityEnabled', entityId: 'first', value: false },
      ]),
      rule('disable-second', { kind: 'interact', entityId: 'second' }, [
        { kind: 'setEntityEnabled', entityId: 'second', value: false },
      ]),
      rule('save', { kind: 'touch', entityId: 'saved' }, [
        { kind: 'setCheckpoint', entityId: 'saved' },
      ]),
      rule('disable-checkpoint', { kind: 'interact', entityId: 'saved' }, [
        { kind: 'setEntityEnabled', entityId: 'saved', value: false },
      ]),
    ];
    const simulator = new RobloxSimulator(game);
    const player = (id: string) => simulator.snapshot().players.find((entry) => entry.id === id)!;
    simulator.join('alex');
    expect(player('alex').position.x).toBe(10);
    simulator.trigger({ kind: 'touch', entityId: 'saved' }, 'alex');
    simulator.trigger({ kind: 'interact', entityId: 'first' }, 'alex');
    simulator.join('sam');
    expect(player('sam').position.x).toBe(40);
    simulator.respawn('alex');
    expect(player('alex').position.x).toBe(70);
    simulator.trigger({ kind: 'interact', entityId: 'saved' }, 'alex');
    simulator.respawn('alex');
    expect(player('alex').position.x).toBe(40);
    simulator.trigger({ kind: 'interact', entityId: 'second' }, 'alex');
    simulator.respawn('alex');
    simulator.join('jo');
    expect(player('alex').position).toEqual({ x: 0, y: 3, z: 0 });
    expect(player('jo').position).toEqual({ x: 0, y: 3, z: 0 });
  });
  it('runs playerJoin teleport and health actions once, after the initial virtual spawn', () => {
    const game = createRobloxEmptyGame();
    game.entities = [createGameEntity('spawn', 'start'), createGameEntity('platform', 'arrival')];
    game.entities[1].transform.position.x = 200;
    game.variables = [{ id: 'joins', name: 'Joins', scope: 'player', initial: 0 }];
    game.rules = [
      rule('ready', { kind: 'playerJoin' }, [
        { kind: 'addVariable', variableId: 'joins', value: number(1) },
        { kind: 'teleport', entityId: 'arrival' },
        { kind: 'damage', amount: number(40) },
        { kind: 'heal', amount: number(5) },
      ]),
    ];
    const simulator = new RobloxSimulator(game);
    simulator.join('alex');
    expect(simulator.snapshot().players[0]).toMatchObject({
      variables: { joins: 1 },
      health: 65,
      position: { x: 200 },
    });
    simulator.respawn('alex');
    expect(simulator.snapshot().players[0]).toMatchObject({
      variables: { joins: 1 },
      health: 100,
      position: { x: 0 },
    });
  });
  it('assigns typed variables, explicitly completes a quest, and stops player/shared timers in scope', () => {
    const game = createRobloxEmptyGame();
    game.entities = [createGameEntity('spawn', 'start'), createGameEntity('platform', 'control')];
    game.variables = [
      { id: 'points', name: 'Points', scope: 'player', initial: 0, min: 0, max: 10 },
      { id: 'label', name: 'Label', scope: 'player', initial: '' },
      { id: 'switch', name: 'Switch', scope: 'shared', initial: false },
      { id: 'ticks', name: 'Ticks', scope: 'player', initial: 0 },
      { id: 'shared-ticks', name: 'Shared ticks', scope: 'shared', initial: 0 },
    ];
    game.quests = [{ id: 'objective', name: 'Objective', description: '', target: 5 }];
    game.timers = [
      { id: 'clock', name: 'Clock', scope: 'player', duration: 1, repeat: true },
      { id: 'shared-clock', name: 'Shared clock', scope: 'shared', duration: 1, repeat: true },
    ];
    game.rules = [
      rule('prepare', { kind: 'playerJoin' }, [
        { kind: 'startQuest', questId: 'objective' },
        { kind: 'startTimer', timerId: 'clock' },
        { kind: 'startTimer', timerId: 'shared-clock' },
      ]),
      rule('player-tick', { kind: 'timer', timerId: 'clock' }, [
        { kind: 'addVariable', variableId: 'ticks', value: number(1) },
      ]),
      rule('shared-tick', { kind: 'timer', timerId: 'shared-clock' }, [
        { kind: 'addVariable', variableId: 'shared-ticks', value: number(1) },
      ]),
      rule('control', { kind: 'interact', entityId: 'control' }, [
        { kind: 'setVariable', variableId: 'points', value: number(99) },
        { kind: 'setVariable', variableId: 'label', value: { kind: 'literal', value: 'Approved' } },
        { kind: 'setVariable', variableId: 'switch', value: { kind: 'literal', value: true } },
        { kind: 'completeQuest', questId: 'objective' },
        { kind: 'startQuest', questId: 'objective' },
        { kind: 'stopTimer', timerId: 'clock' },
        { kind: 'stopTimer', timerId: 'shared-clock' },
      ]),
    ];
    const simulator = new RobloxSimulator(game);
    simulator.join('alex');
    simulator.join('sam');
    simulator.advance(2);
    expect(simulator.snapshot().players.map((player) => player.variables.ticks)).toEqual([2, 2]);
    expect(simulator.snapshot().shared['shared-ticks']).toBe(2);
    simulator.trigger({ kind: 'interact', entityId: 'control' }, 'alex');
    simulator.advance(3);
    expect(simulator.snapshot()).toMatchObject({
      shared: { switch: true, 'shared-ticks': 2 },
      players: [
        {
          id: 'alex',
          variables: { points: 10, label: 'Approved', ticks: 2 },
          quests: { objective: { state: 'complete', progress: 5 } },
        },
        {
          id: 'sam',
          variables: { points: 0, label: '', ticks: 5 },
          quests: { objective: { state: 'active', progress: 0 } },
        },
      ],
      notices: [],
    });
  });
  it('bounds recursive round rules and exposes an understandable diagnostic', () => {
    const game = createRobloxEmptyGame();
    game.entities = [createGameEntity('spawn', 'start')];
    game.rules = [
      rule('go', { kind: 'playerJoin' }, [{ kind: 'startRound' }]),
      rule('end', { kind: 'roundStart' }, [{ kind: 'endRound' }]),
      rule('repeat', { kind: 'roundEnd' }, [{ kind: 'startRound' }]),
    ];
    const simulator = new RobloxSimulator(game);
    simulator.join('alex');
    expect(simulator.snapshot().notices).toContain(
      'Rule chain stopped after the safety limit. Check rules that trigger each other.',
    );
    expect(simulator.snapshot().time).toBe(0);
  });
});

describe('deterministic native Roblox export', () => {
  it('exports real XML/services/NPCs, correct source coordinates and the same typed instructions', () => {
    const source = createRobloxAdventureGame(),
      build = compileRobloxGame(source);
    expect(build.placeXml).toBe(compileRobloxGame(source).placeXml);
    expect(build.artifacts.map((a) => a.name)).toEqual([
      'game.rbxlx',
      'game.json',
      'VisualNerve.server.luau',
      'VisualNerve.client.luau',
      'VisualNerveImporter.plugin.luau',
      'README.txt',
    ]);
    const classes = xmlClasses(build.placeXml);
    expect(classes).toEqual(
      expect.arrayContaining([
        'Workspace',
        'ServerScriptService',
        'StarterPlayer',
        'StarterPlayerScripts',
        'Players',
        'SpawnLocation',
        'Model',
        'Humanoid',
        'Script',
        'LocalScript',
      ]),
    );
    expect(classes.filter((name) => name === 'Humanoid')).toHaveLength(1);
    expect(build.placeXml).toContain('<int name="Duration">0</int>');
    expect(build.placeXml).not.toContain('<float name="Duration">');
    expect(nativeDefinition(build.serverLuau)).toEqual(build.game);
    expect(build.placeXml).toContain('<X>45</X><Y>-1</Y><Z>0</Z>');
    expect(build.placeXml).toContain('<Vector3 name="size"><X>120</X><Y>2</Y><Z>64</Z></Vector3>');
    expect(build.serverLuau).toContain('local budget, eventBudget = 8192, 256');
    expect(build.serverLuau).toContain('validActor(player, part, true)');
    expect(build.serverLuau).not.toContain('OnServerEvent:Connect');
    expect(build.serverLuau).not.toContain('loadstring');
    expect(build.clientLuau).not.toContain('FireServer');
    expect(build.pluginLuau).toContain('ScriptEditorService:UpdateSourceAsync');
    expect(build.pluginLuau).toContain('ScriptEditorService:GetEditorSource');
    expect(build.pluginLuau).not.toMatch(/\.Source\s*=/);
    expect(JSON.parse(build.artifacts.find((a) => a.name === 'game.json')!.content)).toEqual(
      source,
    );
    const instructions = build.artifacts.find(
      (artifact) => artifact.name === 'README.txt',
    )!.content;
    expect(instructions).toContain('not a complete diagram backup');
    expect(instructions).toContain('cannot be reopened with Import JSON');
    expect(instructions).toContain('Export > JSON or an encrypted workspace backup');
    expect(instructions).toContain('replaces the generated server and HUD script objects');
  });
  it('writes persistent ownership as documented little-endian UTF-8 AttributesSerialize', () => {
    const attributes = {
      VNGameId: 'abc-123',
      VNEntityId: 'first/crystal',
      VNManaged: 'VisualNerve/Roblox/v1',
      Label: 'Åäö ✨',
    };
    expect(decodedAttributes(serializeRobloxAttributes(attributes))).toEqual(attributes);
    expect(
      decodedAttributes(
        compileRobloxGame(createRobloxStarterGame()).placeXml.split(
          '<string name="Name">Start here</string>',
        )[1],
      ),
    ).toEqual({ VNEntityId: 'start', VNGameId: 'roblox-game', VNManaged: 'VisualNerve/Roblox/v1' });
  });
  it('escapes hostile XML, preserves Unicode and isolates data from executable Luau', () => {
    const game = createRobloxStarterGame();
    game.name = '<x>" & Åäö 🎮 ]=] ]==]';
    game.rules[0].actions = [
      {
        kind: 'message',
        text: '</ProtectedString><Item class="Script"> os.execute("BAD") ]=] \n \\u2028 🎮',
      },
    ];
    const build = compileRobloxGame(game);
    expect(xmlClasses(build.placeXml).filter((name) => name === 'Script')).toHaveLength(1);
    expect(nativeDefinition(build.serverLuau).name).toBe(game.name);
    expect(nativeDefinition(build.serverLuau).rules[0].actions).toEqual(game.rules[0].actions);
    expect(build.placeXml).toContain('&lt;/ProtectedString&gt;');
    expect(luauLongString('a]=]b]==]c')).toBe('[===[a]=]b]==]c]===]');
  });
  it('offers an explicit merge preview with ownership, changed-world and rollback guards', () => {
    const plugin = compileRobloxGame(createRobloxAdventureGame()).pluginLuau;
    expect(plugin).toContain('previewButton.MouseButton1Click:Connect');
    expect(plugin).toContain('applyButton.MouseButton1Click:Connect');
    expect(plugin).toContain('assert(fingerprint() == approvedFingerprint');
    expect(plugin).toContain('TryBeginRecording');
    expect(plugin).toContain('Enum.FinishRecordingOperation.Cancel');
    expect(plugin).toContain('child.Parent = destination');
    expect(plugin).toContain('child:GetAttribute("VNManaged")');
    expect(plugin).toContain('assert(not RunService:IsRunning()');
    expect(plugin).not.toContain('game:HttpGet');
    expect(plugin).not.toContain('InsertService');
  });
});
