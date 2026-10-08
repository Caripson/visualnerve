import { lazy } from 'react';
import { LazyDialogBoundary } from '../components/LazyDialogBoundary';
import type { Graph } from '../model/types';
import { settleWorkspaceBeforeReload } from '../ui/settle-workspace-reload';

const ModelEditor = lazy(() =>
  import('./ModelEditor').then((module) => ({ default: module.ModelEditor })),
);
const ProcessWizard = lazy(() =>
  import('./ProcessWizard').then((module) => ({ default: module.ProcessWizard })),
);

/** Optional forms share authoritative graph state; loading a form never writes a model. */
export function SimulationModelDialogs({
  kind,
  graph,
  scenarioId,
  close,
  created,
}: {
  kind: 'settings' | 'setup';
  graph: Graph;
  scenarioId?: string;
  close: () => void;
  created?: (options: { durationSeconds: number; untilComplete: boolean }) => void;
}) {
  return (
    <LazyDialogBoundary
      key={`${graph.diagram.id}:${kind}`}
      close={close}
      beforeReload={settleWorkspaceBeforeReload}
    >
      {kind === 'settings' ? (
        <ModelEditor graph={graph} scenarioId={scenarioId} close={close} />
      ) : (
        <ProcessWizard graph={graph} close={close} created={created} />
      )}
    </LazyDialogBoundary>
  );
}
