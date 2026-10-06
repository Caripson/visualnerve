import { lazy, Suspense } from 'react';
import type { DialogName } from '../App';
import { useEditor } from '../state/editor';
import { repository } from '../storage/repository';
import { flushSpatialCamera, workspace } from '../storage/workspace';

const Overview = lazy(() =>
  import('../overview/Dialog').then((module) => ({ default: module.OverviewDialog })),
);
const Questions = lazy(() =>
  import('../questions/QuestionDialog').then((module) => ({ default: module.QuestionDialog })),
);
const History = lazy(() =>
  import('../history/HistoryDialog').then((module) => ({ default: module.HistoryDialog })),
);
export function UnderstandingDialogs({
  name,
  close,
}: {
  name: DialogName | null;
  close: () => void;
}) {
  const graph = useEditor((state) => state.graph);
  if (!graph || !['overview', 'questions', 'history'].includes(name ?? '')) return null;
  return (
    <Suspense fallback={<p role="status">Opening diagram tools…</p>}>
      {name === 'overview' && <Overview key={graph.diagram.id} close={close} />}
      {name === 'questions' && <Questions key={graph.diagram.id} close={close} />}
      {name === 'history' && (
        <History
          key={graph.diagram.id}
          store={repository.history}
          diagramId={graph.diagram.id}
          onClose={close}
          beforeAction={async () => {
            flushSpatialCamera();
            useEditor.getState().finishEditing();
            await workspace.settled();
          }}
          onRestored={async (restored) => {
            await workspace.open(restored.diagram.id);
          }}
        />
      )}
    </Suspense>
  );
}
