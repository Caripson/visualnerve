import { useSyncExternalStore } from 'react';
import { simulationService } from './service';
import { useEditor } from '../state/editor';
import { simulationTopologyCompatible } from './topology';

const inactiveSubscribe = () => () => {};
const inactiveVersion = () => 0;

export function useSimulation(diagramId?: string, runId?: string) {
  const currentDiagramId = useEditor((state) => state.graph?.diagram.id);
  const currentModel = useEditor((state) => state.graph?.simulation);
  const active = !!diagramId || !!runId;
  useSyncExternalStore(
    active ? simulationService.subscribe : inactiveSubscribe,
    active ? simulationService.version : inactiveVersion,
    inactiveVersion,
  );
  const view = runId
    ? simulationService.view(runId)
    : diagramId
      ? simulationService.current(diagramId)
      : undefined;
  // Every canvas consumer drops stale topology during render, before a layout effect can stop it.
  if (
    !runId &&
    view &&
    currentDiagramId === diagramId &&
    currentModel &&
    !simulationTopologyCompatible(currentModel, view.run.model)
  )
    return undefined;
  return view;
}
