import type { Diagram } from '../model/types';

/** Symbols are reusable diagram appearances; simulation and analytics retain their own tools. */
export function canUseFlowchartSymbols(diagram: Pick<Diagram, 'type' | 'analytics'>): boolean {
  return diagram.type !== 'process-simulator' && !diagram.analytics;
}
