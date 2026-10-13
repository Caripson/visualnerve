import type { GameDefinition } from './types';
import { gameCollections, type GameCollection } from './references';

type IdMap = Map<string, string>;
interface LocalIds {
  entities: IdMap;
  rules: IdMap;
  parameters: IdMap;
}
const fields: Partial<Record<string, GameCollection>> = {
  entityId: 'entities',
  variableId: 'variables',
  itemId: 'items',
  questId: 'quests',
  timerId: 'timers',
  prefabId: 'prefabs',
};

/** Each declaration has a scope. Identical labels in different collections stay distinct.
 * Only typed reference slots are rewritten; literals, messages and defaults stay user data. */
export class GameIdentityCopy {
  readonly ids = new Map<GameCollection, IdMap>();
  private readonly gameId: string;
  private readonly local = new Map<string, LocalIds>();
  constructor(
    private readonly source: GameDefinition,
    makeId: () => string = () => crypto.randomUUID(),
  ) {
    this.gameId = makeId();
    for (const collection of gameCollections)
      this.ids.set(collection, new Map(source[collection].map((value) => [value.id, makeId()])));
    for (const prefab of source.prefabs)
      this.local.set(prefab.id, {
        entities: new Map(prefab.entities.map((value) => [value.id, makeId()])),
        rules: new Map(prefab.rules.map((value) => [value.id, makeId()])),
        parameters: new Map((prefab.parameters ?? []).map((value) => [value.id, makeId()])),
      });
  }
  reference(collection: GameCollection, id: string): string {
    if (collection === 'entities' && id.includes('/')) {
      const [instanceId, localId] = id.split('/');
      const instance = this.source.instances.find((entry) => entry.id === instanceId);
      const entityId = instance
        ? this.local.get(instance.prefabId)?.entities.get(localId)
        : undefined;
      return entityId ? `${this.reference('instances', instanceId)}/${entityId}` : id;
    }
    return this.ids.get(collection)?.get(id) ?? id;
  }
  private rewrite(value: unknown, local?: LocalIds, field = ''): unknown {
    if (typeof value === 'string') {
      if (field === 'parameterId') return local?.parameters.get(value) ?? value;
      if (field === 'entityId' && local?.entities.has(value)) return local.entities.get(value)!;
      const collection = fields[field];
      return collection ? this.reference(collection, value) : value;
    }
    if (Array.isArray(value)) return value.map((item) => this.rewrite(item, local));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, this.rewrite(item, local, key)]),
    );
  }
  model(): GameDefinition {
    const game = structuredClone(this.source);
    game.id = this.gameId;
    for (const collection of gameCollections) {
      // All declarations share id/name; their nested typed reference slots use the same visitor.
      const target = game as unknown as Record<
        GameCollection,
        { id: string; [key: string]: unknown }[]
      >;
      target[collection] = this.source[collection].map((entry) => ({
        ...(this.rewrite(entry) as object),
        id: this.reference(collection, entry.id),
      }));
    }
    game.prefabs = this.source.prefabs.map((prefab) => {
      const local = this.local.get(prefab.id)!;
      return {
        ...(this.rewrite(prefab, local) as GameDefinition['prefabs'][number]),
        id: this.reference('prefabs', prefab.id),
        entities: prefab.entities.map((entity) => ({
          ...(this.rewrite(entity, local) as typeof entity),
          id: local.entities.get(entity.id)!,
        })),
        rules: prefab.rules.map((rule) => ({
          ...(this.rewrite(rule, local) as typeof rule),
          id: local.rules.get(rule.id)!,
        })),
        ...(prefab.parameters
          ? {
              parameters: prefab.parameters.map((parameter) => ({
                ...parameter,
                id: local.parameters.get(parameter.id)!,
              })),
            }
          : {}),
      };
    });
    game.instances = this.source.instances.map((instance) => ({
      ...(this.rewrite(instance) as GameDefinition['instances'][number]),
      id: this.reference('instances', instance.id),
      ...(instance.parameters
        ? {
            parameters: Object.fromEntries(
              Object.entries(instance.parameters).map(([id, value]) => [
                this.local.get(instance.prefabId)?.parameters.get(id) ?? id,
                value,
              ]),
            ),
          }
        : {}),
    }));
    return game;
  }
  edgeKey(key: string): string {
    const parts = key.split(':');
    if (
      parts[0] === 'rule' &&
      parts.length === 5 &&
      gameCollections.includes(parts[3] as GameCollection)
    ) {
      parts[1] = this.reference('rules', parts[1]);
      parts[4] = this.reference(parts[3] as GameCollection, parts[4]);
    }
    if (parts[0] === 'instance' && parts.length === 3) {
      parts[1] = this.reference('instances', parts[1]);
      parts[2] = this.reference('prefabs', parts[2]);
    }
    return parts.join(':');
  }
}
