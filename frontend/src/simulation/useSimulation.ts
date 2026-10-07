import { useSyncExternalStore } from 'react';
import { simulationService } from './service';

const inactiveSubscribe = () => () => {};
const inactiveVersion = () => 0;

export function useSimulation(diagramId?: string, runId?: string) {
  const active = !!diagramId || !!runId;
  useSyncExternalStore(
    active ? simulationService.subscribe : inactiveSubscribe,
    active ? simulationService.version : inactiveVersion,
    inactiveVersion,
  );
  return runId
    ? simulationService.view(runId)
    : diagramId
      ? simulationService.current(diagramId)
      : undefined;
}
