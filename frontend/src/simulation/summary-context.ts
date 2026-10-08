import { createContext, useContext } from 'react';
import { useEditor } from '../state/editor';
import type { SimulationModel } from './types';
import type { SimulationView } from './service';
import { useSimulation } from './useSimulation';
import { resolveSimulationRenderModel } from './render-model';

/** An isolated export owns its model/run; absence keeps the live canvas behavior. */
export interface SimulationSummarySnapshot {
  diagramId: string;
  model?: SimulationModel;
  view?: SimulationView;
}
export const SimulationSummaryContext = createContext<SimulationSummarySnapshot | undefined>(
  undefined,
);

export function useSimulationSummary() {
  const snapshot = useContext(SimulationSummaryContext);
  const baseModel = useEditor((state) => (snapshot ? undefined : state.graph?.simulation));
  const diagramId = useEditor((state) =>
    snapshot ? snapshot.diagramId : state.graph?.simulation ? state.graph.diagram.id : undefined,
  );
  const live = useSimulation(snapshot ? undefined : diagramId);
  const view = snapshot ? snapshot.view : live;
  const model = snapshot
    ? snapshot.model
    : baseModel
      ? resolveSimulationRenderModel(view?.run.model ?? baseModel, view?.run.options)
      : undefined;
  return { diagramId, model, view };
}
