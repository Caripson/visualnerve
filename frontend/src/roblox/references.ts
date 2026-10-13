import type { GameAction, GameCondition, GameDefinition, GameExpression, GameRule } from './types';

export const gameCollections = [
  'entities',
  'rules',
  'variables',
  'items',
  'quests',
  'timers',
  'prefabs',
  'instances',
] as const;
export type GameCollection = (typeof gameCollections)[number];
export interface GameReference {
  collection: GameCollection;
  id: string;
  label: string;
  output?: boolean;
}

export function expressionReferences(expression: GameExpression): GameReference[] {
  switch (expression.kind) {
    case 'variable':
      return [{ collection: 'variables', id: expression.variableId, label: 'Reads variable' }];
    case 'inventory':
      return [{ collection: 'items', id: expression.itemId, label: 'Checks inventory' }];
    case 'questProgress':
    case 'questState':
      return [{ collection: 'quests', id: expression.questId, label: 'Checks quest' }];
    case 'arithmetic':
      return [...expressionReferences(expression.left), ...expressionReferences(expression.right)];
    default:
      return [];
  }
}
export function conditionReferences(condition: GameCondition): GameReference[] {
  switch (condition.kind) {
    case 'compare':
      return [...expressionReferences(condition.left), ...expressionReferences(condition.right)];
    case 'all':
    case 'any':
      return condition.conditions.flatMap(conditionReferences);
    case 'not':
      return conditionReferences(condition.condition);
  }
}
export function actionReferences(action: GameAction): GameReference[] {
  if ('entityId' in action)
    return [{ collection: 'entities', id: action.entityId, label: action.kind, output: true }];
  if ('variableId' in action)
    return [
      { collection: 'variables', id: action.variableId, label: action.kind, output: true },
      ...expressionReferences(action.value),
    ];
  if ('itemId' in action)
    return [
      { collection: 'items', id: action.itemId, label: action.kind, output: true },
      ...expressionReferences(action.amount),
    ];
  if ('questId' in action)
    return [
      { collection: 'quests', id: action.questId, label: action.kind, output: true },
      ...('amount' in action ? expressionReferences(action.amount) : []),
    ];
  if ('timerId' in action)
    return [{ collection: 'timers', id: action.timerId, label: action.kind, output: true }];
  if ('amount' in action) return expressionReferences(action.amount);
  return [];
}
export function ruleReferences(rule: GameRule): GameReference[] {
  return [
    ...('entityId' in rule.event
      ? [{ collection: 'entities' as const, id: rule.event.entityId, label: rule.event.kind }]
      : []),
    ...('timerId' in rule.event
      ? [{ collection: 'timers' as const, id: rule.event.timerId, label: 'Timer fires' }]
      : []),
    ...(rule.condition ? conditionReferences(rule.condition) : []),
    ...rule.actions.flatMap(actionReferences),
  ];
}
export function referencedGameEntities(
  game: GameDefinition,
  collection: GameCollection,
  id: string,
): string[] {
  const users = game.rules
    .filter((rule) =>
      ruleReferences(rule).some(
        (ref) =>
          ref.collection === collection &&
          (ref.id === id || (collection === 'entities' && ref.id.startsWith(`${id}/`))),
      ),
    )
    .map((rule) => rule.name);
  if (collection === 'prefabs')
    users.push(
      ...game.instances
        .filter((instance) => instance.prefabId === id)
        .map((instance) => instance.name),
    );
  for (const prefab of game.prefabs) {
    if (collection === 'entities' && prefab.entities.some((entity) => entity.id === id)) continue;
    for (const rule of prefab.rules)
      if (ruleReferences(rule).some((ref) => ref.collection === collection && ref.id === id))
        users.push(`${prefab.name}: ${rule.name}`);
  }
  return [...new Set(users)];
}
