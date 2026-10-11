import { lazy, Suspense, useCallback, useMemo } from 'react';
import { useEditor } from '../state/editor';
import { workspace } from '../storage/workspace';
import { Repository } from '../storage/repository';
import { StorageError } from '../model/errors';
import type { AnalyticsExtension } from './types';

const AnalyticsWorkspace = lazy(() =>
  import('./ui/AnalyticsWorkspace').then((module) => ({ default: module.AnalyticsWorkspace })),
);

/** Uses the same authoritative versioned commands as external tools, with human workspace authority. */
export function AnalyticsFeature() {
  const graph = useEditor((state) => state.graph);
  const diagrams = useEditor((state) => state.diagrams);
  const diagramId = graph?.diagram.id;
  const processTargets = useMemo(
    () =>
      diagrams
        .filter((diagram) => diagram.type === 'process-simulator')
        .map(({ id, name }) => ({ id, name })),
    [diagrams],
  );
  const loadProcessTarget = useCallback(
    async (id: string) => {
      const operation = await workspace.repo.db.captureOperation();
      try {
        await operation.check();
        const target = await new Repository(operation.storage).getGraph(id);
        await operation.check();
        if (useEditor.getState().graph?.diagram.id !== diagramId)
          throw new StorageError(409, 'The originating analysis document is no longer open.');
        if (target.diagram.type !== 'process-simulator' || !target.simulation)
          throw new StorageError(422, 'Choose a Process Simulator document with a valid model.');
        return {
          id: target.diagram.id,
          name: target.diagram.name,
          nodes: target.simulation.nodes.map(({ id, name, type }) => ({ id, name, type })),
          scenarios: target.simulation.scenarios.map(({ id, name }) => ({ id, name })),
        };
      } finally {
        operation.dispose();
      }
    },
    [diagramId],
  );
  if (!graph?.diagram.analytics) return null;
  const diagram = graph.diagram;
  const save = async (value: AnalyticsExtension, baseVersion: number) => {
    await workspace.execute(`/diagrams/${diagram.id}/analytics`, 'PUT', { baseVersion, value });
  };
  return (
    <Suspense
      fallback={
        <div role="status" className="analytics-loading">
          Opening Time Series &amp; Signal Analysis…
        </div>
      }
    >
      <AnalyticsWorkspace
        key={diagram.id}
        diagramId={diagram.id}
        analytics={diagram.analytics!}
        version={diagram.version}
        nodes={graph.nodes.map(({ id, title }) => ({ id, title }))}
        processTargets={processTargets}
        loadProcessTarget={loadProcessTarget}
        onChange={save}
      />
    </Suspense>
  );
}
