import { expandGameDefinition } from './expand';
import { RobloxError } from './errors';
import { RobloxSimulator, type SimulatorSnapshot } from './simulator';
import type { GameDefinition } from './types';
import { RobloxValidationError, validateGameDefinition } from './validate';

export type RobloxPreviewStep =
  | { kind: 'join'; playerId: string }
  | { kind: 'leave'; playerId: string }
  | { kind: 'respawn'; playerId: string }
  | { kind: 'touch' | 'interact'; playerId: string; entityId: string }
  | { kind: 'advance'; seconds: number };
export interface RobloxPreviewResult {
  snapshot: SimulatorSnapshot;
  history?: SimulatorSnapshot[];
}
export const robloxPreviewLimits = {
  players: 16,
  steps: 128,
  totalSeconds: 86400,
  active: 2,
  deadlineMs: 30000,
  resultBytes: 8 * 1024 * 1024,
} as const;

/** Validates the entire trace before running it. Only physical/input events can be requested;
 * timer and round events arise from the game's own instructions. */
export function validateRobloxPreviewSteps(
  game: GameDefinition,
  input: unknown,
): RobloxPreviewStep[] {
  if (!Array.isArray(input) || input.length > robloxPreviewLimits.steps)
    throw new RobloxError(
      422,
      'Use a list with at most 128 rule-test steps.',
      'ROBLOX_PREVIEW_STEPS',
    );
  const entityIds = new Set(expandGameDefinition(game).entities.map((entity) => entity.id));
  const active = new Set<string>(),
    seen = new Set<string>();
  let totalTime = 0;
  return input.map((value, index) => {
    const fail = (message: string): never => {
      throw new RobloxError(422, `Step ${index + 1}: ${message}`, 'ROBLOX_PREVIEW_STEP', [
        { path: `steps[${index}]`, message },
      ]);
    };
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return fail('Choose a supported rule-test action.');
    const step = value as Record<string, unknown>;
    if (step.kind === 'advance') {
      if (
        Object.keys(step).some((key) => !['kind', 'seconds'].includes(key)) ||
        typeof step.seconds !== 'number' ||
        !Number.isFinite(step.seconds) ||
        step.seconds < 0
      )
        return fail('Advance time with a finite nonnegative number of seconds.');
      totalTime += step.seconds;
      if (totalTime > robloxPreviewLimits.totalSeconds)
        return fail('A rule test can advance at most one day in total.');
      return { kind: 'advance', seconds: step.seconds };
    }
    if (!['join', 'leave', 'respawn', 'touch', 'interact'].includes(step.kind as string))
      return fail('Use join, leave, respawn, touch, interact or advance.');
    const allowed =
      step.kind === 'touch' || step.kind === 'interact'
        ? ['kind', 'playerId', 'entityId']
        : ['kind', 'playerId'];
    if (Object.keys(step).some((key) => !allowed.includes(key)))
      return fail('This rule-test action has an unsupported setting.');
    if (
      typeof step.playerId !== 'string' ||
      step.playerId !== step.playerId.trim() ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(step.playerId)
    )
      return fail('Choose a player ID of 1–96 letters, numbers, dashes or underscores.');
    const playerId = step.playerId;
    if (step.kind === 'join') {
      if (active.has(playerId)) return fail('This player has already joined.');
      seen.add(playerId);
      active.add(playerId);
      if (
        seen.size > robloxPreviewLimits.players ||
        active.size > Math.min(game.settings.maxPlayers, robloxPreviewLimits.players)
      )
        return fail('The test exceeds its player limit or the game’s server size.');
    } else {
      if (!active.has(playerId)) return fail('Join this player before using this action.');
      if (step.kind === 'leave') active.delete(playerId);
    }
    if (step.kind === 'touch' || step.kind === 'interact') {
      if (typeof step.entityId !== 'string' || !entityIds.has(step.entityId))
        return fail('Choose an object in this game, including its prefab instance ID when needed.');
      return { kind: step.kind, playerId, entityId: step.entityId };
    }
    return { kind: step.kind as 'join' | 'leave' | 'respawn', playerId };
  });
}

export function runRobloxPreview(
  game: GameDefinition,
  input: unknown,
  options: { history?: boolean } = {},
): RobloxPreviewResult {
  const validation = validateGameDefinition(game);
  if (!validation.valid) throw new RobloxValidationError(validation.diagnostics);
  const steps = validateRobloxPreviewSteps(game, input),
    simulator = new RobloxSimulator(game);
  const history = options.history ? [simulator.snapshot()] : undefined;
  for (const step of steps) {
    if (step.kind === 'advance') simulator.advance(step.seconds);
    else if (step.kind === 'join') simulator.join(step.playerId);
    else if (step.kind === 'leave') simulator.leave(step.playerId);
    else if (step.kind === 'respawn') simulator.respawn(step.playerId);
    else simulator.trigger({ kind: step.kind, entityId: step.entityId }, step.playerId);
    if (history) history.push(simulator.snapshot());
  }
  const result = { snapshot: simulator.snapshot(), ...(history ? { history } : {}) };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > robloxPreviewLimits.resultBytes)
    throw new RobloxError(
      413,
      'The test history is too large. Use fewer steps or request only the final state.',
      'ROBLOX_PREVIEW_LIMIT',
    );
  return result;
}
