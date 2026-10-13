import { expandGameDefinition } from './expand';
import {
  ROBLOX_LIMITS,
  type GameAction,
  type GameCondition,
  type GameDefinition,
  type GameDiagnostic,
  type GameEntity,
  type GameExpression,
  type GameRule,
  type GameValidation,
} from './types';

type ObjectValue = Record<string, unknown>;
const kinds = new Set([
  'spawn',
  'platform',
  'checkpoint',
  'hazard',
  'collectible',
  'door',
  'goal',
  'npc',
  'zone',
  'decoration',
  'movingPlatform',
]);
const materials = new Set([
  'Plastic',
  'SmoothPlastic',
  'Neon',
  'Wood',
  'Metal',
  'Glass',
  'Grass',
  'Concrete',
]);
const entityProperties = new Set([
  'color',
  'enabled',
  'visible',
  'collidable',
  'position.x',
  'position.y',
  'position.z',
  'size.x',
  'size.y',
  'size.z',
  'movement.duration',
]);
const isObject = (value: unknown): value is ObjectValue =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const scalar = (value: unknown) =>
  typeof value === 'boolean' ||
  (typeof value === 'string' && value.length <= ROBLOX_LIMITS.textLength) ||
  (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12);

/** Strict JSON contract; rejects unknown/executable properties and unfinished references. */
export function validateGameDefinition(
  input: unknown,
  options: { playable?: boolean } = {},
): GameValidation {
  const diagnostics: GameDiagnostic[] = [];
  const error = (code: string, path: string, message: string) =>
    diagnostics.push({ severity: 'error', code, path, message });
  const warning = (code: string, path: string, message: string) =>
    diagnostics.push({ severity: 'warning', code, path, message });
  function object(value: unknown, path: string, allowed: string[]): value is ObjectValue {
    if (!isObject(value)) {
      error('shape', path, 'Use an object with the shown settings.');
      return false;
    }
    for (const key of Object.keys(value))
      if (!allowed.includes(key))
        error(
          'unsupported-field',
          `${path}.${key}`,
          'This setting is not supported in game format 1.',
        );
    return true;
  }
  function text(
    value: unknown,
    path: string,
    max: number = ROBLOX_LIMITS.textLength,
    empty = true,
  ) {
    if (
      typeof value !== 'string' ||
      value.length > max ||
      (!empty && !value.trim()) ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\p{Surrogate}]/u.test(value)
    )
      error(
        'text',
        path,
        `Use ${empty ? 'text' : 'a name'} with at most ${max} characters and no control characters.`,
      );
  }
  function id(value: unknown, path: string) {
    if (
      typeof value !== 'string' ||
      value !== value.trim() ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value)
    )
      error('id', path, 'Use a stable ID of 1–96 letters, numbers, dashes or underscores.');
  }
  function number(value: unknown, path: string, min: number, max: number, integer = false) {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isInteger(value))
    )
      error(
        'number',
        path,
        `Use ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}.`,
      );
  }
  function bool(value: unknown, path: string) {
    if (typeof value !== 'boolean') error('boolean', path, 'Choose on or off.');
  }
  function color(value: unknown, path: string) {
    if (typeof value !== 'string' || value.length !== 7 || !/^#[\da-f]{6}$/i.test(value))
      error('color', path, 'Choose a six-digit colour, such as #38bdf8.');
  }
  function array(value: unknown, path: string, limit: number): unknown[] {
    if (!Array.isArray(value)) {
      error('array', path, 'Use a list.');
      return [];
    }
    if (value.length > limit)
      error('limit', path, `This version supports at most ${limit} entries here.`);
    return value.slice(0, limit);
  }
  function vector(value: unknown, path: string, min: number, max: number) {
    if (object(value, path, ['x', 'y', 'z']))
      for (const key of ['x', 'y', 'z']) number(value[key], `${path}.${key}`, min, max);
  }
  function entities(value: unknown, path: string, expanded = false) {
    array(value, path, ROBLOX_LIMITS.entities).forEach((entry, index) => {
      const p = `${path}[${index}]`;
      if (
        !object(entry, p, [
          'id',
          'name',
          'kind',
          'transform',
          'color',
          'material',
          'anchored',
          'collidable',
          'visible',
          'enabled',
          'movement',
        ])
      )
        return;
      if (!expanded) id(entry.id, `${p}.id`);
      text(entry.name, `${p}.name`, expanded ? 260 : 120, false);
      if (!kinds.has(entry.kind as string))
        error('entity-kind', `${p}.kind`, 'Choose a supported game object.');
      if (!materials.has(entry.material as string))
        error('material', `${p}.material`, 'Choose a supported material.');
      color(entry.color, `${p}.color`);
      for (const key of ['anchored', 'collidable', 'visible', 'enabled'])
        bool(entry[key], `${p}.${key}`);
      if (object(entry.transform, `${p}.transform`, ['position', 'rotation', 'size'])) {
        vector(
          entry.transform.position,
          `${p}.transform.position`,
          -ROBLOX_LIMITS.coordinate,
          ROBLOX_LIMITS.coordinate,
        );
        vector(entry.transform.rotation, `${p}.transform.rotation`, -36000, 36000);
        vector(entry.transform.size, `${p}.transform.size`, 0.05, ROBLOX_LIMITS.size);
      }
      if (entry.kind === 'movingPlatform' && !entry.movement)
        error(
          'movement-required',
          `${p}.movement`,
          'Set how far the moving platform travels and how long one trip takes.',
        );
      if (entry.movement !== undefined) {
        if (entry.kind !== 'movingPlatform')
          error('movement-kind', `${p}.movement`, 'Movement is available on moving platforms.');
        if (object(entry.movement, `${p}.movement`, ['offset', 'duration'])) {
          vector(
            entry.movement.offset,
            `${p}.movement.offset`,
            -ROBLOX_LIMITS.coordinate,
            ROBLOX_LIMITS.coordinate,
          );
          number(entry.movement.duration, `${p}.movement.duration`, 0.1, 3600);
        }
      }
      if (entry.kind === 'movingPlatform' && entry.anchored !== true)
        error(
          'moving-platform-anchored',
          `${p}.anchored`,
          'Keep moving platforms anchored so the movement follows its path.',
        );
      if (entry.kind === 'npc' && entry.anchored !== true)
        error(
          'npc-anchored',
          `${p}.anchored`,
          'These characters stand in one place. Keep them anchored.',
        );
    });
  }
  function expression(value: unknown, path: string, depth = 0) {
    if (depth > ROBLOX_LIMITS.expressionDepth) {
      error(
        'expression-depth',
        path,
        'This calculation is too deeply nested. Split it into variables.',
      );
      return;
    }
    if (!isObject(value)) {
      error('expression', path, 'Choose a value, variable or calculation.');
      return;
    }
    const keys: Record<string, string[]> = {
      literal: ['kind', 'value'],
      parameter: ['kind', 'parameterId'],
      variable: ['kind', 'variableId'],
      inventory: ['kind', 'itemId'],
      questProgress: ['kind', 'questId'],
      questState: ['kind', 'questId'],
      arithmetic: ['kind', 'operator', 'left', 'right'],
    };
    if (!keys[value.kind as string]) {
      error('expression-kind', path, 'Choose a supported calculation.');
      return;
    }
    object(value, path, keys[value.kind as string]);
    if (value.kind === 'literal') {
      if (!scalar(value.value))
        error('literal', `${path}.value`, 'Use finite numbers, text or on/off values.');
      if (typeof value.value === 'string') text(value.value, `${path}.value`);
    } else if (value.kind === 'arithmetic') {
      if (!['+', '-', '*', '/'].includes(value.operator as string))
        error('operator', `${path}.operator`, 'Choose +, −, × or ÷.');
      expression(value.left, `${path}.left`, depth + 1);
      expression(value.right, `${path}.right`, depth + 1);
    } else
      text(
        value[Object.keys(value).find((key) => key.endsWith('Id')) ?? ''],
        `${path}.reference`,
        200,
        false,
      );
  }
  function condition(value: unknown, path: string, depth = 0) {
    if (depth > ROBLOX_LIMITS.conditionDepth) {
      error('condition-depth', path, 'This condition is too deeply nested. Split it into rules.');
      return;
    }
    if (!isObject(value)) {
      error('condition', path, 'Choose a comparison or a group of conditions.');
      return;
    }
    if (value.kind === 'compare') {
      object(value, path, ['kind', 'operator', 'left', 'right']);
      if (!['==', '!=', '>', '>=', '<', '<='].includes(value.operator as string))
        error('comparison', `${path}.operator`, 'Choose a supported comparison.');
      expression(value.left, `${path}.left`);
      expression(value.right, `${path}.right`);
    } else if (value.kind === 'all' || value.kind === 'any') {
      object(value, path, ['kind', 'conditions']);
      const children = array(value.conditions, `${path}.conditions`, 64);
      if (!children.length) error('empty-condition', path, 'Add at least one condition.');
      children.forEach((entry, index) =>
        condition(entry, `${path}.conditions[${index}]`, depth + 1),
      );
    } else if (value.kind === 'not') {
      object(value, path, ['kind', 'condition']);
      condition(value.condition, `${path}.condition`, depth + 1);
    } else error('condition-kind', path, 'Choose a supported condition.');
  }
  function rules(value: unknown, path: string) {
    array(value, path, ROBLOX_LIMITS.rules).forEach((entry, index) => {
      const p = `${path}[${index}]`;
      if (
        !object(entry, p, [
          'id',
          'name',
          'enabled',
          'event',
          'condition',
          'actions',
          'cooldown',
          'oncePerPlayer',
        ])
      )
        return;
      id(entry.id, `${p}.id`);
      text(entry.name, `${p}.name`, 120, false);
      bool(entry.enabled, `${p}.enabled`);
      bool(entry.oncePerPlayer, `${p}.oncePerPlayer`);
      number(entry.cooldown, `${p}.cooldown`, 0, 86400);
      if (isObject(entry.event)) {
        const kind = entry.event.kind;
        if (['playerJoin', 'roundStart', 'roundEnd'].includes(kind as string))
          object(entry.event, `${p}.event`, ['kind']);
        else if (kind === 'touch' || kind === 'interact') {
          object(entry.event, `${p}.event`, ['kind', 'entityId']);
          text(entry.event.entityId, `${p}.event.entityId`, 200, false);
        } else if (kind === 'timer') {
          object(entry.event, `${p}.event`, ['kind', 'timerId']);
          text(entry.event.timerId, `${p}.event.timerId`, 96, false);
        } else error('event-kind', `${p}.event`, 'Choose a supported event.');
      } else error('event', `${p}.event`, 'Choose when this rule runs.');
      if (entry.condition !== undefined) condition(entry.condition, `${p}.condition`);
      const actions = array(entry.actions, `${p}.actions`, ROBLOX_LIMITS.actionsPerRule);
      if (!actions.length)
        error('empty-actions', `${p}.actions`, 'Add something that happens when this rule runs.');
      actions.forEach((action, actionIndex) => {
        const a = `${p}.actions[${actionIndex}]`;
        if (!isObject(action)) {
          error('action', a, 'Choose an action.');
          return;
        }
        const fields: Record<string, string[]> = {
          setVariable: ['variableId', 'value'],
          addVariable: ['variableId', 'value'],
          giveItem: ['itemId', 'amount'],
          removeItem: ['itemId', 'amount'],
          startQuest: ['questId'],
          completeQuest: ['questId'],
          advanceQuest: ['questId', 'amount'],
          startTimer: ['timerId'],
          stopTimer: ['timerId'],
          setEntityEnabled: ['entityId', 'value'],
          setEntityVisible: ['entityId', 'value'],
          setEntityCollidable: ['entityId', 'value'],
          teleport: ['entityId'],
          setCheckpoint: ['entityId'],
          message: ['text'],
          damage: ['amount'],
          heal: ['amount'],
          win: ['message'],
          startRound: [],
          endRound: [],
        };
        const allowed = fields[action.kind as string];
        if (!allowed) {
          error('action-kind', a, 'Choose a supported action.');
          return;
        }
        object(action, a, ['kind', ...allowed]);
        for (const field of allowed) {
          if (field.endsWith('Id')) text(action[field], `${a}.${field}`, 200, false);
          else if (field === 'text' || field === 'message') text(action[field], `${a}.${field}`);
          else if ((action.kind as string).startsWith('setEntity'))
            bool(action[field], `${a}.${field}`);
          else expression(action[field], `${a}.${field}`);
        }
      });
    });
  }
  function namedList(
    value: unknown,
    path: string,
    limit: number,
    allowed: string[],
    check: (entry: ObjectValue, path: string) => void,
  ) {
    array(value, path, limit).forEach((entry, index) => {
      const p = `${path}[${index}]`;
      if (!object(entry, p, ['id', 'name', ...allowed])) return;
      id(entry.id, `${p}.id`);
      text(entry.name, `${p}.name`, 120, false);
      check(entry, p);
    });
  }
  if (
    !object(input, 'game', [
      'schemaVersion',
      'id',
      'name',
      'description',
      'settings',
      'entities',
      'prefabs',
      'instances',
      'variables',
      'items',
      'quests',
      'timers',
      'rules',
    ])
  )
    return { valid: false, diagnostics };
  if (input.schemaVersion !== 1)
    error('schema-version', 'game.schemaVersion', 'This builder supports game format 1.');
  id(input.id, 'game.id');
  text(input.name, 'game.name', 120, false);
  text(input.description, 'game.description');
  if (
    object(input.settings, 'game.settings', [
      'maxPlayers',
      'gravity',
      'walkSpeed',
      'jumpPower',
      'respawnSeconds',
      'ambient',
    ])
  ) {
    number(input.settings.maxPlayers, 'game.settings.maxPlayers', 1, 100, true);
    number(input.settings.gravity, 'game.settings.gravity', 0, 1000);
    number(input.settings.walkSpeed, 'game.settings.walkSpeed', 1, 100);
    number(input.settings.jumpPower, 'game.settings.jumpPower', 0, 200);
    number(input.settings.respawnSeconds, 'game.settings.respawnSeconds', 0, 60);
    color(input.settings.ambient, 'game.settings.ambient');
  }
  entities(input.entities, 'game.entities');
  rules(input.rules, 'game.rules');
  namedList(
    input.variables,
    'game.variables',
    ROBLOX_LIMITS.variables,
    ['scope', 'initial', 'min', 'max'],
    (entry, p) => {
      if (!['player', 'shared'].includes(entry.scope as string))
        error('scope', `${p}.scope`, 'Choose each player or everyone together.');
      if (!scalar(entry.initial))
        error('initial', `${p}.initial`, 'Use a number, text or on/off value.');
      if (typeof entry.initial === 'string') text(entry.initial, `${p}.initial`);
      if (entry.min !== undefined) number(entry.min, `${p}.min`, -1e12, 1e12);
      if (entry.max !== undefined) number(entry.max, `${p}.max`, -1e12, 1e12);
      if ((entry.min !== undefined || entry.max !== undefined) && typeof entry.initial !== 'number')
        error('variable-range', p, 'Only number variables have minimum and maximum values.');
      if (typeof entry.min === 'number' && typeof entry.max === 'number' && entry.min > entry.max)
        error('variable-range', p, 'The minimum must be below the maximum.');
      if (
        typeof entry.initial === 'number' &&
        ((typeof entry.min === 'number' && entry.initial < entry.min) ||
          (typeof entry.max === 'number' && entry.initial > entry.max))
      )
        error(
          'variable-initial-range',
          `${p}.initial`,
          'Start inside the variable’s minimum and maximum.',
        );
    },
  );
  namedList(input.items, 'game.items', ROBLOX_LIMITS.items, ['maxStack'], (entry, p) =>
    number(entry.maxStack, `${p}.maxStack`, 1, 1000000, true),
  );
  namedList(
    input.quests,
    'game.quests',
    ROBLOX_LIMITS.quests,
    ['description', 'target'],
    (entry, p) => {
      text(entry.description, `${p}.description`);
      number(entry.target, `${p}.target`, 1, 1000000, true);
    },
  );
  namedList(
    input.timers,
    'game.timers',
    ROBLOX_LIMITS.timers,
    ['scope', 'duration', 'repeat'],
    (entry, p) => {
      if (!['player', 'shared'].includes(entry.scope as string))
        error('scope', `${p}.scope`, 'Choose each player or everyone together.');
      number(entry.duration, `${p}.duration`, 0.1, 86400);
      bool(entry.repeat, `${p}.repeat`);
    },
  );
  namedList(
    input.prefabs,
    'game.prefabs',
    ROBLOX_LIMITS.prefabs,
    ['entities', 'rules', 'parameters', 'bindings'],
    (entry, p) => {
      entities(entry.entities, `${p}.entities`);
      rules(entry.rules, `${p}.rules`);
      if (entry.parameters !== undefined)
        namedList(entry.parameters, `${p}.parameters`, 64, ['default'], (parameter, pp) => {
          if (!scalar(parameter.default))
            error('parameter', `${pp}.default`, 'Use a number, text or on/off default.');
          if (typeof parameter.default === 'string') text(parameter.default, `${pp}.default`);
        });
      if (entry.bindings !== undefined)
        array(entry.bindings, `${p}.bindings`, 256).forEach((binding, index) => {
          const bp = `${p}.bindings[${index}]`;
          if (!object(binding, bp, ['entityId', 'property', 'parameterId'])) return;
          text(binding.entityId, `${bp}.entityId`, 96, false);
          text(binding.parameterId, `${bp}.parameterId`, 96, false);
          if (!entityProperties.has(binding.property as string))
            error('prefab-property', `${bp}.property`, 'Choose a supported prefab setting.');
        });
    },
  );
  namedList(
    input.instances,
    'game.instances',
    ROBLOX_LIMITS.instances,
    ['prefabId', 'position', 'rotation', 'parameters'],
    (entry, p) => {
      text(entry.prefabId, `${p}.prefabId`, 96, false);
      vector(entry.position, `${p}.position`, -ROBLOX_LIMITS.coordinate, ROBLOX_LIMITS.coordinate);
      vector(entry.rotation, `${p}.rotation`, -36000, 36000);
      if (entry.parameters !== undefined && isObject(entry.parameters))
        for (const [key, value] of Object.entries(entry.parameters)) {
          id(key, `${p}.parameters.${key}`);
          if (!scalar(value))
            error('parameter', `${p}.parameters.${key}`, 'Use a number, text or on/off value.');
          if (typeof value === 'string') text(value, `${p}.parameters.${key}`);
        }
      else if (entry.parameters !== undefined)
        error('parameters', `${p}.parameters`, 'Use named parameter values.');
    },
  );
  if (diagnostics.some((d) => d.severity === 'error')) return { valid: false, diagnostics };
  const game = input as unknown as GameDefinition;
  function unique(entries: { id: string }[], path: string) {
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      if (seen.has(entry.id))
        error('duplicate-id', `${path}[${index}].id`, 'Every object needs its own ID.');
      seen.add(entry.id);
    });
  }
  for (const key of [
    'entities',
    'rules',
    'variables',
    'items',
    'quests',
    'timers',
    'prefabs',
    'instances',
  ] as const)
    unique(game[key], `game.${key}`);
  const globalEntityIds = new Set(game.entities.map((entity) => entity.id));
  for (const instance of game.instances) {
    const prefab = game.prefabs.find((entry) => entry.id === instance.prefabId);
    for (const entity of prefab?.entities ?? []) globalEntityIds.add(`${instance.id}/${entity.id}`);
  }
  for (const [index, prefab] of game.prefabs.entries()) {
    const p = `game.prefabs[${index}]`;
    unique(prefab.entities, `${p}.entities`);
    unique(prefab.rules, `${p}.rules`);
    unique(prefab.parameters ?? [], `${p}.parameters`);
    const parameters = new Map((prefab.parameters ?? []).map((entry) => [entry.id, entry]));
    for (const [bindingIndex, binding] of (prefab.bindings ?? []).entries()) {
      const bp = `${p}.bindings[${bindingIndex}]`,
        target = prefab.entities.find((entry) => entry.id === binding.entityId),
        parameter = parameters.get(binding.parameterId);
      if (!target)
        error('entity-reference', `${bp}.entityId`, 'Choose an object inside this prefab.');
      if (!parameter)
        error(
          'parameter-reference',
          `${bp}.parameterId`,
          'Choose a parameter declared by this prefab.',
        );
      else {
        const expected =
          binding.property === 'color'
            ? 'string'
            : ['enabled', 'visible', 'collidable'].includes(binding.property)
              ? 'boolean'
              : 'number';
        if (typeof parameter.default !== expected)
          error('parameter-type', bp, `This setting needs a ${expected} parameter.`);
        if (binding.property === 'color') color(parameter.default, `${bp}.default`);
        if (binding.property.startsWith('size.'))
          number(parameter.default, `${bp}.default`, 0.05, ROBLOX_LIMITS.size);
        if (binding.property.startsWith('position.'))
          number(
            parameter.default,
            `${bp}.default`,
            -ROBLOX_LIMITS.coordinate,
            ROBLOX_LIMITS.coordinate,
          );
        if (binding.property === 'movement.duration')
          number(parameter.default, `${bp}.default`, 0.1, 3600);
      }
      if (binding.property === 'movement.duration' && !target?.movement)
        error('movement-binding', bp, 'Duration parameters need a moving platform.');
    }
    // Unused prefabs are still validated: they can be instantiated later without hidden errors.
    checkRules(
      prefab.rules,
      `${p}.rules`,
      new Set([...globalEntityIds, ...prefab.entities.map((e) => e.id)]),
      parameters,
    );
  }
  for (const [index, instance] of game.instances.entries()) {
    const p = `game.instances[${index}]`,
      prefab = game.prefabs.find((entry) => entry.id === instance.prefabId);
    if (!prefab) {
      error('prefab-reference', `${p}.prefabId`, 'Choose an existing reusable prefab.');
      continue;
    }
    for (const [key, value] of Object.entries(instance.parameters ?? {})) {
      const parameter = prefab.parameters?.find((entry) => entry.id === key);
      if (!parameter)
        error(
          'parameter-reference',
          `${p}.parameters.${key}`,
          'This prefab does not have that parameter.',
        );
      else if (typeof value !== typeof parameter.default)
        error(
          'parameter-type',
          `${p}.parameters.${key}`,
          'Use the same value type as the parameter default.',
        );
    }
  }
  if (diagnostics.some((d) => d.severity === 'error')) return { valid: false, diagnostics };
  const expanded = expandGameDefinition(game);
  if (expanded.entities.length > ROBLOX_LIMITS.entities)
    error(
      'expanded-limit',
      'game.instances',
      `Prefabs expand to ${expanded.entities.length} objects. This version supports ${ROBLOX_LIMITS.entities}.`,
    );
  if (expanded.rules.length > ROBLOX_LIMITS.rules)
    error(
      'expanded-limit',
      'game.instances',
      `Prefabs expand to ${expanded.rules.length} rules. This version supports ${ROBLOX_LIMITS.rules}.`,
    );
  unique(expanded.entities, 'game.expanded.entities');
  unique(expanded.rules, 'game.expanded.rules');
  // Parameter bindings and parent transforms must obey the same bounds as normal entities.
  const initialErrors = diagnostics.length;
  entities(expanded.entities, 'game.expanded.entities', true);
  if (diagnostics.length !== initialErrors)
    error(
      'expanded-entity',
      'game.instances',
      'A prefab parameter or position creates an unsupported world object.',
    );
  const entityIds = new Set(expanded.entities.map((e) => e.id));
  checkRules(expanded.rules, 'game.expanded.rules', entityIds, new Map());
  const actionGroups = new Map<string, number>();
  for (const rule of expanded.rules)
    if (rule.enabled) {
      const key =
        rule.event.kind +
        ('entityId' in rule.event
          ? ':' + rule.event.entityId
          : 'timerId' in rule.event
            ? ':' + rule.event.timerId
            : '');
      actionGroups.set(key, (actionGroups.get(key) ?? 0) + rule.actions.length);
    }
  for (const [event, count] of actionGroups) {
    const multiplier =
      event === 'roundStart' || event === 'roundEnd' ? game.settings.maxPlayers : 1;
    if (count * multiplier > ROBLOX_LIMITS.actionBudget)
      error(
        'action-budget',
        'game.rules',
        `Rules for ${event} could run ${count * multiplier} actions at once. Split this work with timers; the limit is ${ROBLOX_LIMITS.actionBudget}.`,
      );
  }
  if (options.playable && !expanded.entities.some((e) => e.kind === 'spawn' && e.enabled))
    error(
      'spawn-required',
      'game.entities',
      'Add an enabled spawn so players have somewhere to start.',
    );
  for (const [index, entity] of expanded.entities.entries()) {
    if (
      ['checkpoint', 'hazard', 'collectible', 'door', 'goal', 'npc'].includes(entity.kind) &&
      !expanded.rules.some(
        (r) => 'entityId' in r.event && r.event.entityId === entity.id && r.enabled,
      )
    )
      warning(
        'object-without-rule',
        `game.expanded.entities[${index}]`,
        'This object needs a rule to do something in the game.',
      );
  }
  return { valid: !diagnostics.some((d) => d.severity === 'error'), diagnostics };

  function checkRules(
    entries: GameRule[],
    path: string,
    entityIds: Set<string>,
    parameters: Map<string, { default: unknown }>,
  ) {
    const vars = new Map(game.variables.map((v) => [v.id, v])),
      items = new Set(game.items.map((v) => v.id)),
      quests = new Set(game.quests.map((v) => v.id)),
      timers = new Map(game.timers.map((v) => [v.id, v]));
    function exprType(expr: GameExpression, p: string): string | undefined {
      if (expr.kind === 'literal') return typeof expr.value;
      if (expr.kind === 'parameter') {
        if (!parameters.has(expr.parameterId))
          error(
            'parameter-reference',
            p,
            'Parameters can only refer to defaults inside their prefab.',
          );
        return typeof parameters.get(expr.parameterId)?.default;
      }
      if (expr.kind === 'variable') {
        if (!vars.has(expr.variableId))
          error('variable-reference', p, 'Choose an existing variable.');
        return typeof vars.get(expr.variableId)?.initial;
      }
      if (expr.kind === 'inventory') {
        if (!items.has(expr.itemId))
          error('item-reference', p, 'Choose an existing inventory item.');
        return 'number';
      }
      if (expr.kind === 'questProgress' || expr.kind === 'questState') {
        if (!quests.has(expr.questId)) error('quest-reference', p, 'Choose an existing quest.');
        return expr.kind === 'questState' ? 'string' : 'number';
      }
      const left = exprType(expr.left, `${p}.left`),
        right = exprType(expr.right, `${p}.right`);
      if (left !== 'number' || right !== 'number')
        error('arithmetic-type', p, 'Calculations need numbers on both sides.');
      if (expr.operator === '/' && expr.right.kind === 'literal' && expr.right.value === 0)
        error('division-zero', p, 'Choose a divisor other than zero.');
      return 'number';
    }
    function conditionTypes(c: GameCondition, p: string) {
      if (c.kind === 'compare') {
        const a = exprType(c.left, `${p}.left`),
          b = exprType(c.right, `${p}.right`);
        if (a !== b || (!['==', '!='].includes(c.operator) && a !== 'number'))
          error(
            'comparison-type',
            p,
            'Compare matching value types; bigger/smaller comparisons use numbers.',
          );
      } else if (c.kind === 'not') conditionTypes(c.condition, `${p}.condition`);
      else c.conditions.forEach((entry, i) => conditionTypes(entry, `${p}.conditions[${i}]`));
    }
    function playerExpr(expr: GameExpression): boolean {
      return (
        expr.kind === 'inventory' ||
        expr.kind === 'questProgress' ||
        expr.kind === 'questState' ||
        (expr.kind === 'variable' && vars.get(expr.variableId)?.scope === 'player') ||
        (expr.kind === 'arithmetic' && (playerExpr(expr.left) || playerExpr(expr.right)))
      );
    }
    function playerCondition(c: GameCondition): boolean {
      return c.kind === 'compare'
        ? playerExpr(c.left) || playerExpr(c.right)
        : c.kind === 'not'
          ? playerCondition(c.condition)
          : c.conditions.some(playerCondition);
    }
    entries.forEach((rule, index) => {
      const p = `${path}[${index}]`;
      if ('entityId' in rule.event && !entityIds.has(rule.event.entityId))
        error('entity-reference', `${p}.event`, 'Choose an existing world object.');
      if (rule.event.kind === 'timer' && !timers.has(rule.event.timerId))
        error('timer-reference', `${p}.event`, 'Choose an existing timer.');
      if (rule.condition) conditionTypes(rule.condition, `${p}.condition`);
      const sharedEvent =
        rule.event.kind === 'timer' && timers.get(rule.event.timerId)?.scope === 'shared';
      if (sharedEvent && rule.oncePerPlayer)
        error(
          'shared-timer-player',
          `${p}.oncePerPlayer`,
          'Shared timers run once for everyone; use a player timer for once-per-player rules.',
        );
      if (sharedEvent && rule.condition && playerCondition(rule.condition))
        error(
          'shared-timer-player',
          `${p}.condition`,
          'Shared timers have no individual player. Use shared variables or a player timer.',
        );
      rule.actions.forEach((action: GameAction, i) => {
        const ap = `${p}.actions[${i}]`;
        if ('entityId' in action && !entityIds.has(action.entityId))
          error('entity-reference', ap, 'Choose an existing world object.');
        if ('variableId' in action && !vars.has(action.variableId))
          error('variable-reference', ap, 'Choose an existing variable.');
        if ('itemId' in action && !items.has(action.itemId))
          error('item-reference', ap, 'Choose an existing inventory item.');
        if ('questId' in action && !quests.has(action.questId))
          error('quest-reference', ap, 'Choose an existing quest.');
        if ('timerId' in action && !timers.has(action.timerId))
          error('timer-reference', ap, 'Choose an existing timer.');
        if ('amount' in action && exprType(action.amount, `${ap}.amount`) !== 'number')
          error('amount-type', ap, 'Use a number for this amount.');
        if ('value' in action && typeof action.value === 'object') {
          const type = exprType(action.value, `${ap}.value`),
            variable = 'variableId' in action ? vars.get(action.variableId) : undefined;
          if (
            variable &&
            (type !== typeof variable.initial ||
              (action.kind === 'addVariable' && type !== 'number'))
          )
            error(
              'variable-type',
              ap,
              'Use a matching value type; adding needs a number variable.',
            );
        }
        const needsPlayer =
          [
            'giveItem',
            'removeItem',
            'startQuest',
            'advanceQuest',
            'completeQuest',
            'teleport',
            'setCheckpoint',
            'message',
            'damage',
            'heal',
            'win',
          ].includes(action.kind) ||
          ('variableId' in action && vars.get(action.variableId)?.scope === 'player') ||
          ('timerId' in action && timers.get(action.timerId)?.scope === 'player') ||
          ('amount' in action && playerExpr(action.amount)) ||
          ('value' in action && typeof action.value === 'object' && playerExpr(action.value));
        if (sharedEvent && needsPlayer)
          error(
            'shared-timer-player',
            ap,
            'Shared timers have no individual player. Use shared changes or a player timer.',
          );
      });
    });
  }
}

export class RobloxValidationError extends Error {
  readonly code = 'roblox-game-invalid';
  readonly diagnostics: GameDiagnostic[];
  constructor(diagnostics: GameDiagnostic[]) {
    super('Your game needs a few fixes before it can be built.');
    this.name = 'RobloxValidationError';
    this.diagnostics = diagnostics;
  }
}
