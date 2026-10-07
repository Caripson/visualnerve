import type { ScenarioPatch, SimulationModel } from './types';

/** Encode optional-property removal without losing it during JSON exports or API transport. */
export function toScenarioPatch<T>(value: T, previous?: unknown): ScenarioPatch<T> | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) {
    // Arrays replace the baseline array, so missing member properties already mean removal.
    return JSON.parse(JSON.stringify(value)) as ScenarioPatch<T>;
  }
  if (value && typeof value === 'object') {
    const before =
      previous && typeof previous === 'object' && !Array.isArray(previous)
        ? (previous as Record<string, unknown>)
        : {};
    const after = value as Record<string, unknown>;
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return Object.fromEntries(
      [...keys].map((key) => [
        key,
        toScenarioPatch(
          Object.hasOwn(after, key) ? after[key] : undefined,
          Object.hasOwn(before, key) ? before[key] : undefined,
        ),
      ]),
    ) as ScenarioPatch<T>;
  }
  return value as ScenarioPatch<T>;
}

/** A new scenario starts with a detached copy of all selected scenario assumptions. */
export function cloneScenario(
  model: SimulationModel,
  selectedId: string,
  name: string,
  id: string,
) {
  const selected = model.scenarios.find((scenario) => scenario.id === selectedId);
  return {
    id,
    name,
    overrides: structuredClone(selected?.overrides ?? {}),
    ...(selected?.demandMultiplier !== undefined
      ? { demandMultiplier: selected.demandMultiplier }
      : {}),
  };
}
