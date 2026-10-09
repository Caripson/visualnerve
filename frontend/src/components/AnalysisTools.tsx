import { useI18n } from '../i18n';
import { lazy, useState } from 'react';
import { Network } from 'lucide-react';
import { useEditor } from '../state/editor';
import { getExploration } from '../analysis/types';
import { LazyDialogBoundary } from './LazyDialogBoundary';
import { settleWorkspaceBeforeReload } from '../ui/settle-workspace-reload';
import './analysis-tools.css';

const RelationshipDialog = lazy(() =>
  import('./AnalysisDialog').then((module) => ({ default: module.AnalysisDialog })),
);

export function AnalysisTools({ onOpen }: { onOpen?: () => void } = {}) {
  const { t } = useI18n();
  const graph = useEditor((state) => state.graph);
  const selected = useEditor((state) => state.selectedNodes);
  const [open, setOpen] = useState(false);
  if (!graph) return null;
  return (
    <div className="analysis-tools">
      <button className="full" onClick={() => (onOpen ? onOpen() : setOpen(true))}>
        <Network size={16} />
        {t('toolbar.exploreRelationshipsAction')}
      </button>
      {!!getExploration(graph) && (
        <button className="full" onClick={() => useEditor.getState().explore()}>
          {t('toolbar.resetExplorationAction')}
        </button>
      )}
      {!onOpen && open && (
        <AnalysisDialog key={graph.diagram.id} close={() => setOpen(false)} startId={selected[0]} />
      )}
    </div>
  );
}
/** Optional relationship editor; the exploration state remains in the shared workspace. */
export function AnalysisDialog(props: { close: () => void; startId?: string }) {
  return (
    <LazyDialogBoundary close={props.close} beforeReload={settleWorkspaceBeforeReload}>
      <RelationshipDialog {...props} />
    </LazyDialogBoundary>
  );
}
