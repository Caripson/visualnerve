import type { OverviewConfig, OverviewGroup } from './types';

/** Back follows saved expansion order; zoom/reveal-only openings remain transient. */
export function lastOverviewExpansion(config: OverviewConfig, groups: OverviewGroup[]) {
  const active = new Map(
    groups.filter((group) => group.expanded).map((group) => [group.id, group]),
  );
  for (const id of [...config.expanded].reverse()) if (active.has(id)) return active.get(id);
}
export function collapseOverviewLevel(
  config: OverviewConfig,
  groups: OverviewGroup[],
): OverviewConfig {
  const chosen = lastOverviewExpansion(config, groups);
  if (!chosen) return config;
  const byId = new Map(groups.map((group) => [group.id, group])),
    closed = new Set<string>(),
    queue = [chosen.id];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (closed.has(id)) continue;
    closed.add(id);
    queue.push(...(byId.get(id)?.childGroupIds ?? []));
  }
  return { ...config, expanded: config.expanded.filter((id) => !closed.has(id)) };
}
