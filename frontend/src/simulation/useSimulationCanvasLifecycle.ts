import { useLayoutEffect, useState } from 'react';
import { simulationService } from './service';
import { useSimulation } from './useSimulation';
import { simulationTopologyCompatible } from './topology';
import type { SimulationModel } from './types';

interface DetachedRun {
  diagramId: string;
  runId: string;
  error?: string;
}

/** Canvas selection is disposable; captured runs, results and programmatic replay are not. */
export function useSimulationCanvasLifecycle(diagramId?: string, model?: SimulationModel) {
  const view = useSimulation(diagramId);
  const selected = diagramId ? simulationService.current(diagramId) : undefined;
  const incompatible = !!(
    selected &&
    model &&
    !simulationTopologyCompatible(model, selected.run.model)
  );
  const [previous, setPrevious] = useState<DetachedRun>();
  const detached = previous?.diagramId === diagramId ? previous : undefined;
  useLayoutEffect(() => {
    if (!diagramId) {
      setPrevious(undefined);
      return;
    }
    if (!incompatible || !selected) {
      if (selected) setPrevious(undefined);
      return;
    }
    const runId = selected.run.id;
    setPrevious({ diagramId, runId });
    void simulationService.detachCanvasRun(diagramId, runId).catch((failure: Error) => {
      setPrevious((current) =>
        current?.diagramId === diagramId && current.runId === runId
          ? { ...current, error: failure.message }
          : current,
      );
    });
  }, [diagramId, model, selected?.run.id, incompatible]);
  return {
    view,
    resultsView: selected ?? (detached ? simulationService.view(detached.runId) : undefined),
    topologyChanged: incompatible || !!detached,
    error: detached?.error,
  };
}
