import type {
  GameAction,
  GameDefinition,
  GameEntity,
  GameEntityKind,
  GameExpression,
  GameRule,
} from './types';

const literal = (value: number | string | boolean): GameExpression => ({ kind: 'literal', value });
const rule = (
  id: string,
  name: string,
  event: GameRule['event'],
  actions: GameAction[],
  extra: Partial<GameRule> = {},
): GameRule => ({
  id,
  name,
  enabled: true,
  event,
  actions,
  cooldown: 1,
  oncePerPlayer: false,
  ...extra,
});
export function createGameEntity(kind: GameEntityKind, id: string): GameEntity {
  const colors: Record<GameEntityKind, string> = {
    spawn: '#22c55e',
    platform: '#60a5fa',
    checkpoint: '#a78bfa',
    hazard: '#f43f5e',
    collectible: '#facc15',
    door: '#c084fc',
    goal: '#34d399',
    npc: '#fb923c',
    zone: '#94a3b8',
    decoration: '#38bdf8',
    movingPlatform: '#2dd4bf',
  };
  const tall = kind === 'door' || kind === 'npc';
  return {
    id,
    name: kind === 'movingPlatform' ? 'Moving platform' : kind[0].toUpperCase() + kind.slice(1),
    kind,
    transform: {
      position: { x: 0, y: tall ? 3 : 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      size:
        kind === 'npc'
          ? { x: 3, y: 5, z: 2 }
          : tall
            ? { x: 4, y: 8, z: 1 }
            : kind === 'collectible'
              ? { x: 2, y: 2, z: 2 }
              : { x: 12, y: 1, z: 12 },
    },
    color: colors[kind],
    material: ['hazard', 'collectible', 'goal', 'checkpoint'].includes(kind)
      ? 'Neon'
      : 'SmoothPlastic',
    anchored: true,
    collidable: !['hazard', 'collectible', 'zone'].includes(kind),
    visible: kind !== 'zone',
    enabled: true,
    ...(kind === 'movingPlatform'
      ? { movement: { offset: { x: 0, y: 0, z: 12 }, duration: 3 } }
      : {}),
  };
}
export function createRobloxEmptyGame(name = 'My Roblox game'): GameDefinition {
  return {
    schemaVersion: 1,
    id: 'roblox-game',
    name,
    description: 'Build a world, connect its rules, test it, and open it in Roblox Studio.',
    settings: {
      maxPlayers: 12,
      gravity: 196.2,
      walkSpeed: 16,
      jumpPower: 50,
      respawnSeconds: 3,
      ambient: '#808080',
    },
    entities: [],
    prefabs: [],
    instances: [],
    variables: [],
    items: [],
    quests: [],
    timers: [],
    rules: [],
  };
}
export function createRobloxStarterGame(): GameDefinition {
  const game = createRobloxEmptyGame('My first Roblox adventure');
  game.description =
    'Jump across the platforms, save a checkpoint, collect a star and reach the finish. Change anything to make it yours.';
  const spawn = createGameEntity('spawn', 'start');
  spawn.name = 'Start here';
  const first = createGameEntity('platform', 'first-jump');
  first.name = 'First jump';
  first.transform.position.x = 18;
  const checkpoint = createGameEntity('checkpoint', 'checkpoint');
  checkpoint.name = 'Save my place';
  checkpoint.transform.position.x = 36;
  const moving = createGameEntity('movingPlatform', 'moving-bridge');
  moving.name = 'Moving bridge';
  moving.transform.position.x = 54;
  moving.movement = { offset: { x: 0, y: 0, z: 6 }, duration: 3 };
  const finish = createGameEntity('goal', 'finish');
  finish.name = 'Finish';
  finish.transform.position.x = 72;
  const star = createGameEntity('collectible', 'star');
  star.name = 'A bonus star';
  star.transform.position = { x: 36, y: 3, z: 0 };
  const lava = createGameEntity('hazard', 'lava');
  lava.name = 'Lava below';
  lava.transform.position = { x: 36, y: -9, z: 0 };
  lava.transform.size = { x: 100, y: 1, z: 40 };
  game.entities = [spawn, first, checkpoint, moving, finish, star, lava];
  game.variables = [
    { id: 'score', name: 'Score', scope: 'player', initial: 0, min: 0, max: 1000000 },
  ];
  game.rules = [
    rule('welcome', 'Explain the adventure', { kind: 'playerJoin' }, [
      {
        kind: 'message',
        text: 'Jump to the purple checkpoint. Collect the yellow star, then reach the green finish. You can change this whole game!',
      },
    ]),
    rule(
      'save-place',
      'Checkpoint remembers my place',
      { kind: 'touch', entityId: checkpoint.id },
      [
        { kind: 'setCheckpoint', entityId: checkpoint.id },
        { kind: 'message', text: 'Checkpoint saved! You come back here if you fall.' },
      ],
      { oncePerPlayer: true },
    ),
    rule(
      'collect-star',
      'Star gives ten points',
      { kind: 'touch', entityId: star.id },
      [
        { kind: 'addVariable', variableId: 'score', value: literal(10) },
        { kind: 'message', text: '+10 points! Other players can collect their own star.' },
      ],
      { oncePerPlayer: true },
    ),
    rule('lava-hurts', 'Lava sends me back', { kind: 'touch', entityId: lava.id }, [
      { kind: 'damage', amount: literal(100) },
    ]),
    rule(
      'win-game',
      'Finish the adventure',
      { kind: 'touch', entityId: finish.id },
      [{ kind: 'win', message: 'You finished your first Roblox adventure! Now make it your own.' }],
      { oncePerPlayer: true },
    ),
  ];
  return game;
}
export function createRobloxAdventureGame(): GameDefinition {
  const game = createRobloxEmptyGame('Crystal Island: a multiplayer quest');
  game.id = 'crystal-island';
  game.description =
    'Collect three crystals, turn on the shared power switch, and open the gate. Reusable crystal and lava prefabs show how to create a bigger game with your own rules.';
  const floor = createGameEntity('platform', 'island');
  floor.name = 'Crystal Island';
  floor.material = 'Grass';
  floor.color = '#4ade80';
  floor.transform.position = { x: 45, y: -1, z: 0 };
  floor.transform.size = { x: 120, y: 2, z: 64 };
  const spawn = createGameEntity('spawn', 'camp');
  spawn.name = 'Camp';
  spawn.transform.position = { x: -5, y: 0.5, z: 0 };
  const npc = createGameEntity('npc', 'guide');
  npc.name = 'Mira the island guide';
  npc.transform.position = { x: 7, y: 3, z: -13 };
  const power = createGameEntity('decoration', 'power-switch');
  power.name = 'Power switch';
  power.material = 'Neon';
  power.transform.position = { x: 45, y: 2, z: -15 };
  power.transform.size = { x: 3, y: 4, z: 3 };
  const door = createGameEntity('door', 'crystal-gate');
  door.name = 'Crystal gate';
  door.transform.position = { x: 75, y: 4, z: 0 };
  door.transform.rotation.y = 90;
  door.transform.size = { x: 14, y: 8, z: 2 };
  const goal = createGameEntity('goal', 'treasure');
  goal.name = 'Island treasure';
  goal.transform.position = { x: 93, y: 1, z: 0 };
  goal.transform.size = { x: 8, y: 2, z: 8 };
  const checkpoint = createGameEntity('checkpoint', 'safe-camp');
  checkpoint.name = 'Safe camp';
  checkpoint.transform.position = { x: 38, y: 0.5, z: 0 };
  const moving = createGameEntity('movingPlatform', 'sky-lift');
  moving.name = 'Sky lift';
  moving.transform.position = { x: 24, y: 2, z: 17 };
  moving.transform.size = { x: 10, y: 1, z: 10 };
  moving.movement = { offset: { x: 0, y: 14, z: 0 }, duration: 4 };
  game.entities = [floor, spawn, npc, power, door, goal, checkpoint, moving];
  game.variables = [
    { id: 'level', name: 'Explorer level', scope: 'player', initial: 1, min: 1, max: 100 },
    { id: 'score', name: 'Adventure score', scope: 'player', initial: 0, min: 0, max: 1000000 },
    { id: 'power', name: 'Island power', scope: 'shared', initial: 0, min: 0, max: 10 },
  ];
  game.items = [{ id: 'crystal', name: 'Crystals', maxStack: 99 }];
  game.quests = [
    {
      id: 'find-crystals',
      name: 'Find three crystals',
      description:
        'Collect the three glowing crystals. Turn on the power, then use the crystal gate.',
      target: 3,
    },
  ];
  game.timers = [
    { id: 'hint', name: 'Friendly hint', scope: 'player', duration: 20, repeat: false },
    { id: 'round-clock', name: 'Island round', scope: 'shared', duration: 120, repeat: false },
  ];
  const crystal = createGameEntity('collectible', 'crystal');
  crystal.name = 'Glowing crystal';
  crystal.transform.position = { x: 0, y: 2, z: 0 };
  const lava = createGameEntity('hazard', 'lava');
  lava.name = 'Lava patch';
  lava.transform.size = { x: 8, y: 0.2, z: 8 };
  lava.transform.position.y = 0.2;
  game.prefabs = [
    {
      id: 'crystal-prefab',
      name: 'Reusable crystal reward',
      entities: [crystal],
      parameters: [
        { id: 'points', name: 'Score reward', default: 10 },
        { id: 'shade', name: 'Crystal colour', default: '#facc15' },
      ],
      bindings: [{ entityId: 'crystal', property: 'color', parameterId: 'shade' }],
      rules: [
        rule(
          'pick-up',
          'Each player can collect this crystal',
          { kind: 'touch', entityId: 'crystal' },
          [
            { kind: 'giveItem', itemId: 'crystal', amount: literal(1) },
            { kind: 'advanceQuest', questId: 'find-crystals', amount: literal(1) },
            {
              kind: 'addVariable',
              variableId: 'score',
              value: { kind: 'parameter', parameterId: 'points' },
            },
            { kind: 'message', text: 'A crystal! Your quest and score have updated.' },
          ],
          { oncePerPlayer: true },
        ),
      ],
    },
    {
      id: 'lava-prefab',
      name: 'Reusable lava trap',
      entities: [lava],
      parameters: [{ id: 'damage', name: 'Damage per touch', default: 30 }],
      rules: [
        rule('hurt', 'Lava damages the player', { kind: 'touch', entityId: 'lava' }, [
          { kind: 'damage', amount: { kind: 'parameter', parameterId: 'damage' } },
        ]),
      ],
    },
  ];
  game.instances = [
    {
      id: 'first-crystal',
      name: 'Camp crystal',
      prefabId: 'crystal-prefab',
      position: { x: 18, y: 0, z: -10 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    {
      id: 'second-crystal',
      name: 'River crystal',
      prefabId: 'crystal-prefab',
      position: { x: 45, y: 0, z: 11 },
      rotation: { x: 0, y: 25, z: 0 },
      parameters: { points: 20, shade: '#a78bfa' },
    },
    {
      id: 'third-crystal',
      name: 'Gate crystal',
      prefabId: 'crystal-prefab',
      position: { x: 62, y: 0, z: -9 },
      rotation: { x: 0, y: -20, z: 0 },
      parameters: { points: 30, shade: '#38bdf8' },
    },
    {
      id: 'river-lava',
      name: 'River lava',
      prefabId: 'lava-prefab',
      position: { x: 31, y: 0, z: 10 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    {
      id: 'gate-lava',
      name: 'Hot gate lava',
      prefabId: 'lava-prefab',
      position: { x: 61, y: 0, z: 8 },
      rotation: { x: 0, y: 0, z: 0 },
      parameters: { damage: 60 },
    },
  ];
  game.rules = [
    rule('welcome', 'Start each player’s quest', { kind: 'playerJoin' }, [
      { kind: 'startQuest', questId: 'find-crystals' },
      { kind: 'startTimer', timerId: 'hint' },
      {
        kind: 'message',
        text: 'Welcome to Crystal Island! Talk to Mira, collect three crystals, then power the gate. Each player has their own quest.',
      },
    ]),
    rule(
      'guide-talk',
      'Mira starts an island round',
      { kind: 'interact', entityId: npc.id },
      [
        {
          kind: 'message',
          text: 'Find three crystals. The power switch is shared with your friends. The gate needs your crystals and island power.',
        },
        { kind: 'startRound' },
      ],
      { cooldown: 5 },
    ),
    rule('round-begins', 'Start the shared round clock', { kind: 'roundStart' }, [
      { kind: 'startTimer', timerId: 'round-clock' },
      {
        kind: 'message',
        text: 'A new island round begins! You have two minutes before the round ends.',
      },
    ]),
    rule('time-up', 'The clock ends this round', { kind: 'timer', timerId: 'round-clock' }, [
      { kind: 'endRound' },
    ]),
    rule('round-finishes', 'Tell everyone the round ended', { kind: 'roundEnd' }, [
      {
        kind: 'message',
        text: 'Round over. Your progress is safe for this session. Talk to Mira to start another round.',
      },
    ]),
    rule('hint-timer', 'Give a friendly hint', { kind: 'timer', timerId: 'hint' }, [
      {
        kind: 'message',
        text: 'Hint: the glowing crystals are near camp, the river and the gate. Press E or tap the prompt at the power switch.',
      },
    ]),
    rule(
      'power-on',
      'Each switch press charges the island',
      { kind: 'interact', entityId: power.id },
      [
        { kind: 'addVariable', variableId: 'power', value: literal(1) },
        { kind: 'message', text: 'The island has power! Everyone can see the shared power meter.' },
      ],
      { cooldown: 2 },
    ),
    rule(
      'save-camp',
      'Remember a safe checkpoint',
      { kind: 'touch', entityId: checkpoint.id },
      [{ kind: 'setCheckpoint', entityId: checkpoint.id }],
      { oncePerPlayer: true },
    ),
    rule(
      'open-gate',
      'Crystals and power open the gate',
      { kind: 'interact', entityId: door.id },
      [
        { kind: 'removeItem', itemId: 'crystal', amount: literal(3) },
        { kind: 'setEntityCollidable', entityId: door.id, value: false },
        { kind: 'setEntityVisible', entityId: door.id, value: false },
        { kind: 'message', text: 'You opened the gate for everyone! Find the island treasure.' },
      ],
      {
        oncePerPlayer: true,
        condition: {
          kind: 'all',
          conditions: [
            {
              kind: 'compare',
              operator: '>=',
              left: { kind: 'inventory', itemId: 'crystal' },
              right: literal(3),
            },
            {
              kind: 'compare',
              operator: '==',
              left: { kind: 'questState', questId: 'find-crystals' },
              right: literal('complete'),
            },
            {
              kind: 'compare',
              operator: '>=',
              left: { kind: 'variable', variableId: 'power' },
              right: literal(1),
            },
          ],
        },
      },
    ),
    rule(
      'treasure-wins',
      'Treasure increases my explorer level',
      { kind: 'touch', entityId: goal.id },
      [
        { kind: 'addVariable', variableId: 'level', value: literal(1) },
        { kind: 'addVariable', variableId: 'score', value: literal(100) },
        {
          kind: 'win',
          message:
            'You found the island treasure and gained an explorer level! Add a new island, harder quests or your own reusable traps.',
        },
      ],
      {
        oncePerPlayer: true,
        condition: {
          kind: 'compare',
          operator: '==',
          left: { kind: 'questState', questId: 'find-crystals' },
          right: literal('complete'),
        },
      },
    ),
  ];
  return game;
}
