import type { Diagram } from '../model/types';

/** General notation tools never replace specialized executable/analytics editors. */
export function canUseNotation(diagram: Diagram): boolean {
  return diagram.type !== 'process-simulator' && !diagram.analytics;
}
