import type {
  CompiledGame,
  GameDefinition,
  GameEntity,
  GameExpression,
  GamePrefabProperty,
  GameRule,
  GameValue,
  GameVector,
} from './types';

/** Y-X-Z convention, matching Roblox CFrame.fromOrientation (radians). */
export function rotateGameVector(vector: GameVector, rotation: GameVector): GameVector {
  const x = (rotation.x * Math.PI) / 180,
    y = (rotation.y * Math.PI) / 180,
    z = (rotation.z * Math.PI) / 180;
  const cz = Math.cos(z),
    sz = Math.sin(z),
    cx = Math.cos(x),
    sx = Math.sin(x),
    cy = Math.cos(y),
    sy = Math.sin(y);
  const zx = vector.x * cz - vector.y * sz,
    zy = vector.x * sz + vector.y * cz;
  const xy = zy * cx - vector.z * sx,
    xz = zy * sx + vector.z * cx;
  return { x: zx * cy + xz * sy, y: xy, z: -zx * sy + xz * cy };
}

export function gameRotationMatrix(rotation: GameVector): number[] {
  const a = rotateGameVector({ x: 1, y: 0, z: 0 }, rotation),
    b = rotateGameVector({ x: 0, y: 1, z: 0 }, rotation),
    c = rotateGameVector({ x: 0, y: 0, z: 1 }, rotation);
  return [a.x, b.x, c.x, a.y, b.y, c.y, a.z, b.z, c.z];
}

function composeRotation(parent: GameVector, child: GameVector): GameVector {
  const a = gameRotationMatrix(parent),
    b = gameRotationMatrix(child);
  const m = Array.from({ length: 9 }, (_, n) => {
    const row = Math.floor(n / 3),
      column = n % 3;
    return a[row * 3] * b[column] + a[row * 3 + 1] * b[column + 3] + a[row * 3 + 2] * b[column + 6];
  });
  const x = Math.asin(Math.max(-1, Math.min(1, -m[5]))),
    cosX = Math.cos(x);
  const y = Math.abs(cosX) > 1e-8 ? Math.atan2(m[2], m[8]) : Math.atan2(-m[6], m[0]);
  const z = Math.abs(cosX) > 1e-8 ? Math.atan2(m[3], m[4]) : 0;
  const degrees = (value: number) => (Math.abs(value) < 1e-14 ? 0 : (value * 180) / Math.PI);
  return { x: degrees(x), y: degrees(y), z: degrees(z) };
}

function bindEntity(entity: GameEntity, property: GamePrefabProperty, value: GameValue): void {
  if (property === 'color') entity.color = value as string;
  else if (property === 'enabled' || property === 'visible' || property === 'collidable')
    entity[property] = value as boolean;
  else if (property === 'movement.duration' && entity.movement)
    entity.movement.duration = value as number;
  else if (property.startsWith('position.') || property.startsWith('size.')) {
    const [group, coordinate] = property.split('.') as ['position' | 'size', 'x' | 'y' | 'z'];
    entity.transform[group][coordinate] = value as number;
  }
}

function replaceParameters(value: unknown, parameters: Record<string, GameValue>): unknown {
  if (Array.isArray(value)) return value.map((entry) => replaceParameters(entry, parameters));
  if (!value || typeof value !== 'object') return value;
  const expression = value as Partial<GameExpression> & { parameterId?: string };
  if (expression.kind === 'parameter')
    return { kind: 'literal', value: parameters[expression.parameterId!] };
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, replaceParameters(entry, parameters)]),
  );
}

/** Call only with a structurally valid definition; does not require a spawn or a finished game. */
export function expandGameDefinition(game: GameDefinition): CompiledGame {
  const { prefabs, instances, ...base } = structuredClone(game);
  const entities = base.entities,
    rules = base.rules;
  for (const instance of instances) {
    const prefab = prefabs.find((entry) => entry.id === instance.prefabId);
    if (!prefab) continue;
    const parameters = Object.fromEntries(
      (prefab.parameters ?? []).map((entry) => [entry.id, entry.default]),
    );
    Object.assign(parameters, instance.parameters ?? {});
    const localIds = new Set(prefab.entities.map((entity) => entity.id));
    const mapRef = (id: string) => (localIds.has(id) ? `${instance.id}/${id}` : id);
    for (const original of prefab.entities) {
      const entity = structuredClone(original);
      for (const binding of prefab.bindings ?? [])
        if (binding.entityId === entity.id)
          bindEntity(entity, binding.property, parameters[binding.parameterId]);
      const rotated = rotateGameVector(entity.transform.position, instance.rotation);
      entity.id = `${instance.id}/${entity.id}`;
      entity.name = `${instance.name} · ${entity.name}`;
      entity.transform.position = {
        x: instance.position.x + rotated.x,
        y: instance.position.y + rotated.y,
        z: instance.position.z + rotated.z,
      };
      entity.transform.rotation = composeRotation(instance.rotation, entity.transform.rotation);
      if (entity.movement)
        entity.movement.offset = rotateGameVector(entity.movement.offset, instance.rotation);
      entities.push(entity);
    }
    for (const original of prefab.rules) {
      const rule = replaceParameters(structuredClone(original), parameters) as GameRule;
      rule.id = `${instance.id}/${rule.id}`;
      rule.name = `${instance.name} · ${rule.name}`;
      if ('entityId' in rule.event) rule.event.entityId = mapRef(rule.event.entityId);
      for (const action of rule.actions)
        if ('entityId' in action) action.entityId = mapRef(action.entityId);
      rules.push(rule);
    }
  }
  return { ...base, entities, rules };
}
