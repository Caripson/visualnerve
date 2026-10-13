import { expandGameDefinition } from './expand';
import { RobloxValidationError, validateGameDefinition } from './validate';
import { ROBLOX_LIMITS } from './types';
import type {
  CompiledGame,
  GameAction,
  GameCondition,
  GameDefinition,
  GameEvent,
  GameExpression,
  GameValue,
  GameVector,
} from './types';

export interface SimulatorPlayer {
  id: string;
  variables: Record<string, GameValue>;
  inventory: Record<string, number>;
  quests: Record<string, { state: 'inactive' | 'active' | 'complete'; progress: number }>;
  health: number;
  position: GameVector;
  checkpoint?: string;
  won: boolean;
  messages: string[];
}
export interface SimulatorEntity {
  enabled: boolean;
  visible: boolean;
  collidable: boolean;
}
export interface SimulatorSnapshot {
  time: number;
  roundActive: boolean;
  shared: Record<string, GameValue>;
  players: SimulatorPlayer[];
  entities: Record<string, SimulatorEntity>;
  notices: string[];
}
interface ActiveTimer {
  id: string;
  playerId?: string;
  due: number;
}
const ACTION_BUDGET = ROBLOX_LIMITS.actionBudget;
const EVENT_BUDGET = ROBLOX_LIMITS.eventBudget;
const clampFinite = (value: number, min = -1e12, max = 1e12) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : 0;

/** Deterministic rule preview, using the same typed instructions as the Roblox server.
 * No physics claims: callers explicitly trigger touch/interact and advance time. */
export class RobloxSimulator {
  readonly game: CompiledGame;
  private time = 0;
  private roundActive = false;
  private shared: Record<string, GameValue> = {};
  private players = new Map<string, SimulatorPlayer>();
  private entities: Record<string, SimulatorEntity> = {};
  private timers = new Map<string, ActiveTimer>();
  private cooldowns = new Map<string, number>();
  private once = new Set<string>();
  private notices: string[] = [];
  private queue: { event: GameEvent; playerId?: string }[] = [];
  private dispatching = false;
  constructor(game: GameDefinition) {
    const result = validateGameDefinition(game);
    if (!result.valid) throw new RobloxValidationError(result.diagnostics);
    this.game = expandGameDefinition(game);
    for (const variable of this.game.variables)
      if (variable.scope === 'shared') this.shared[variable.id] = variable.initial;
    for (const entity of this.game.entities)
      this.entities[entity.id] = {
        enabled: entity.enabled,
        visible: entity.visible,
        collidable: entity.collidable,
      };
  }
  join(playerId: string): SimulatorSnapshot {
    if (this.players.has(playerId)) return this.snapshot();
    if (this.players.size >= this.game.settings.maxPlayers) {
      this.notice('The game is full.');
      return this.snapshot();
    }
    const spawn = this.game.entities.find(
      (entry) => entry.kind === 'spawn' && this.entities[entry.id]?.enabled,
    );
    const player: SimulatorPlayer = {
      id: playerId,
      variables: {},
      inventory: {},
      quests: {},
      health: 100,
      position: spawn
        ? {
            ...spawn.transform.position,
            y: spawn.transform.position.y + spawn.transform.size.y / 2 + 3,
          }
        : { x: 0, y: 3, z: 0 },
      won: false,
      messages: [],
    };
    for (const variable of this.game.variables)
      if (variable.scope === 'player') player.variables[variable.id] = variable.initial;
    for (const item of this.game.items) player.inventory[item.id] = 0;
    for (const quest of this.game.quests)
      player.quests[quest.id] = { state: 'inactive', progress: 0 };
    this.players.set(playerId, player);
    this.emit({ kind: 'playerJoin' }, playerId);
    return this.snapshot();
  }
  leave(playerId: string): SimulatorSnapshot {
    this.players.delete(playerId);
    for (const [key, timer] of this.timers)
      if (timer.playerId === playerId) this.timers.delete(key);
    for (const key of this.cooldowns.keys())
      if (key.startsWith(`${playerId}\u0000`)) this.cooldowns.delete(key);
    for (const key of this.once) if (key.startsWith(`${playerId}\u0000`)) this.once.delete(key);
    return this.snapshot();
  }
  respawn(playerId: string): SimulatorSnapshot {
    const player = this.players.get(playerId);
    if (!player) return this.snapshot();
    const target =
      this.game.entities.find((e) => e.id === player.checkpoint && this.entities[e.id]?.enabled) ??
      this.game.entities.find((e) => e.kind === 'spawn' && this.entities[e.id]?.enabled);
    player.health = 100;
    player.position = target
      ? {
          ...target.transform.position,
          y: target.transform.position.y + target.transform.size.y / 2 + 3,
        }
      : { x: 0, y: 3, z: 0 };
    return this.snapshot();
  }
  trigger(event: GameEvent, playerId?: string): SimulatorSnapshot {
    if (event.kind === 'touch' || event.kind === 'interact') {
      if (
        !playerId ||
        !this.players.has(playerId) ||
        this.players.get(playerId)!.health <= 0 ||
        !this.entities[event.entityId]?.enabled
      )
        return this.snapshot();
    }
    this.emit(event, playerId);
    return this.snapshot();
  }
  advance(seconds: number): SimulatorSnapshot {
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new Error('Advance time with a positive number of seconds.');
    const target = this.time + Math.min(seconds, 86400);
    let count = 0;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.due <= target)
        .sort((a, b) => a[1].due - b[1].due || a[0].localeCompare(b[0]))[0];
      if (!next) break;
      if (++count > 4096) {
        this.notice('Too many timer ticks. The preview stopped this time step.');
        for (const pending of this.timers.values())
          if (pending.due <= target) {
            const definition = this.game.timers.find((entry) => entry.id === pending.id)!;
            pending.due = target + (definition.repeat ? definition.duration : 0.1);
          }
        break;
      }
      const [key, timer] = next,
        definition = this.game.timers.find((entry) => entry.id === timer.id)!;
      this.time = timer.due;
      if (definition.repeat)
        this.timers.set(key, { ...timer, due: this.time + definition.duration });
      else this.timers.delete(key);
      this.emit({ kind: 'timer', timerId: timer.id }, timer.playerId);
    }
    this.time = target;
    return this.snapshot();
  }
  snapshot(): SimulatorSnapshot {
    return structuredClone({
      time: this.time,
      roundActive: this.roundActive,
      shared: this.shared,
      players: [...this.players.values()],
      entities: this.entities,
      notices: this.notices,
    });
  }
  private notice(message: string) {
    this.notices.push(message);
    if (this.notices.length > 20) this.notices.shift();
  }
  private emit(event: GameEvent, playerId?: string) {
    this.queue.push({ event, playerId });
    if (this.dispatching) return;
    this.dispatching = true;
    let actionBudget: number = ACTION_BUDGET,
      events = 0;
    try {
      while (this.queue.length && actionBudget > 0 && events++ < EVENT_BUDGET) {
        const next = this.queue.shift()!,
          player = next.playerId ? this.players.get(next.playerId) : undefined;
        if (next.playerId && !player) continue;
        for (const rule of this.game.rules) {
          if (
            !rule.enabled ||
            rule.event.kind !== next.event.kind ||
            ('entityId' in rule.event &&
              (!('entityId' in next.event) || rule.event.entityId !== next.event.entityId)) ||
            ('timerId' in rule.event &&
              (!('timerId' in next.event) || rule.event.timerId !== next.event.timerId))
          )
            continue;
          const key = `${next.playerId ?? 'shared'}\u0000${rule.id}`;
          if (
            (rule.oncePerPlayer && this.once.has(key)) ||
            (this.cooldowns.get(key) ?? -Infinity) > this.time ||
            (rule.condition && !this.condition(rule.condition, player))
          )
            continue;
          this.cooldowns.set(
            key,
            this.time +
              Math.max(
                rule.cooldown,
                next.event.kind === 'touch' || next.event.kind === 'interact' ? 0.1 : 0,
              ),
          );
          if (rule.oncePerPlayer) this.once.add(key);
          for (const action of rule.actions) {
            if (actionBudget-- <= 0) break;
            this.action(action, player);
          }
          if (actionBudget <= 0) break;
        }
      }
      if (this.queue.length || actionBudget <= 0) {
        this.notice(
          'Rule chain stopped after the safety limit. Check rules that trigger each other.',
        );
        this.queue = [];
      }
    } finally {
      this.dispatching = false;
    }
  }
  private value(expr: GameExpression, player?: SimulatorPlayer): GameValue | undefined {
    if (expr.kind === 'literal') return expr.value;
    if (expr.kind === 'parameter') return undefined;
    if (expr.kind === 'variable') {
      const variable = this.game.variables.find((v) => v.id === expr.variableId);
      return variable?.scope === 'shared'
        ? this.shared[expr.variableId]
        : player?.variables[expr.variableId];
    }
    if (expr.kind === 'inventory') return player?.inventory[expr.itemId];
    if (expr.kind === 'questProgress') return player?.quests[expr.questId]?.progress;
    if (expr.kind === 'questState') return player?.quests[expr.questId]?.state;
    const a = this.value(expr.left, player),
      b = this.value(expr.right, player);
    if (typeof a !== 'number' || typeof b !== 'number') return undefined;
    return clampFinite(
      expr.operator === '+'
        ? a + b
        : expr.operator === '-'
          ? a - b
          : expr.operator === '*'
            ? a * b
            : b === 0
              ? 0
              : a / b,
    );
  }
  private condition(condition: GameCondition, player?: SimulatorPlayer): boolean {
    if (condition.kind === 'all')
      return condition.conditions.every((entry) => this.condition(entry, player));
    if (condition.kind === 'any')
      return condition.conditions.some((entry) => this.condition(entry, player));
    if (condition.kind === 'not') return !this.condition(condition.condition, player);
    const a = this.value(condition.left, player),
      b = this.value(condition.right, player);
    if (a === undefined || b === undefined) return false;
    if (condition.operator === '==') return a === b;
    if (condition.operator === '!=') return a !== b;
    if (typeof a !== 'number' || typeof b !== 'number') return false;
    return condition.operator === '>'
      ? a > b
      : condition.operator === '>='
        ? a >= b
        : condition.operator === '<'
          ? a < b
          : a <= b;
  }
  private action(action: GameAction, player?: SimulatorPlayer) {
    if (action.kind === 'setVariable' || action.kind === 'addVariable') {
      const definition = this.game.variables.find((v) => v.id === action.variableId)!;
      const values = definition.scope === 'shared' ? this.shared : player?.variables;
      if (!values) return;
      let value = this.value(action.value, player);
      if (action.kind === 'addVariable')
        value =
          typeof value === 'number' && typeof values[action.variableId] === 'number'
            ? (values[action.variableId] as number) + value
            : undefined;
      if (typeof value !== typeof definition.initial) return;
      values[action.variableId] =
        typeof value === 'number'
          ? clampFinite(value, definition.min ?? -1e12, definition.max ?? 1e12)
          : value!;
    } else if (action.kind === 'giveItem' || action.kind === 'removeItem') {
      const amount = this.value(action.amount, player),
        item = this.game.items.find((entry) => entry.id === action.itemId)!;
      if (player && typeof amount === 'number')
        player.inventory[action.itemId] = clampFinite(
          player.inventory[action.itemId] +
            (action.kind === 'giveItem' ? 1 : -1) * Math.max(0, Math.floor(amount)),
          0,
          item.maxStack,
        );
    } else if (
      action.kind === 'startQuest' ||
      action.kind === 'advanceQuest' ||
      action.kind === 'completeQuest'
    ) {
      const quest = player?.quests[action.questId],
        definition = this.game.quests.find((entry) => entry.id === action.questId)!;
      if (!quest) return;
      if (action.kind === 'startQuest' && quest.state === 'inactive') quest.state = 'active';
      else if (action.kind === 'advanceQuest' && quest.state === 'active') {
        const amount = this.value(action.amount, player);
        if (typeof amount === 'number') {
          quest.progress = clampFinite(
            quest.progress + Math.max(0, Math.floor(amount)),
            0,
            definition.target,
          );
          if (quest.progress >= definition.target) quest.state = 'complete';
        }
      } else if (action.kind === 'completeQuest' && quest.state === 'active') {
        quest.state = 'complete';
        quest.progress = definition.target;
      }
    } else if (action.kind === 'startTimer' || action.kind === 'stopTimer') {
      const definition = this.game.timers.find((entry) => entry.id === action.timerId)!;
      if (definition.scope === 'player' && !player) return;
      const owner = definition.scope === 'player' ? player!.id : undefined,
        key = `${owner ?? 'shared'}\u0000${definition.id}`;
      if (action.kind === 'startTimer')
        this.timers.set(key, {
          id: definition.id,
          playerId: owner,
          due: this.time + definition.duration,
        });
      else this.timers.delete(key);
    } else if (
      action.kind === 'setEntityEnabled' ||
      action.kind === 'setEntityVisible' ||
      action.kind === 'setEntityCollidable'
    ) {
      const target = this.entities[action.entityId];
      if (target)
        target[
          action.kind === 'setEntityEnabled'
            ? 'enabled'
            : action.kind === 'setEntityVisible'
              ? 'visible'
              : 'collidable'
        ] = action.value;
    } else if (action.kind === 'teleport' || action.kind === 'setCheckpoint') {
      const target = this.game.entities.find((entry) => entry.id === action.entityId)!;
      if (!player) return;
      if (action.kind === 'setCheckpoint') player.checkpoint = target.id;
      else
        player.position = {
          ...target.transform.position,
          y: target.transform.position.y + target.transform.size.y / 2 + 3,
        };
    } else if (action.kind === 'message') {
      if (player) {
        player.messages.push(action.text);
        if (player.messages.length > 50) player.messages.shift();
      }
    } else if (action.kind === 'damage' || action.kind === 'heal') {
      const amount = this.value(action.amount, player);
      if (player && typeof amount === 'number')
        player.health = clampFinite(
          player.health + (action.kind === 'heal' ? 1 : -1) * Math.max(0, amount),
          0,
          100,
        );
    } else if (action.kind === 'win') {
      if (player) {
        player.won = true;
        player.messages.push(action.message);
      }
    } else if (action.kind === 'startRound' && !this.roundActive) {
      this.roundActive = true;
      for (const actor of this.players.values())
        this.queue.push({ event: { kind: 'roundStart' }, playerId: actor.id });
    } else if (action.kind === 'endRound' && this.roundActive) {
      this.roundActive = false;
      for (const actor of this.players.values())
        this.queue.push({ event: { kind: 'roundEnd' }, playerId: actor.id });
    }
  }
}
