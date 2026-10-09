import { useI18n } from '../i18n';
import { Layers, ChevronRight } from 'lucide-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CanvasNode } from '../canvas/projection';
import { useEditor } from '../state/editor';
import { statusLabel } from '../ui/editor-labels';
import { getOverviewConfig, overviewLimits, overviewNodeGroup, setOverviewConfig } from './types';
import { OVERVIEW_RESET_VIEW } from './Controls';
import './overview.css';

export function expandOverviewGroup(id: string) {
  const editor = useEditor.getState();
  if (!editor.graph) return;
  const config = getOverviewConfig(editor.graph);
  if (config.expanded.includes(id)) return;
  if (config.expanded.length >= overviewLimits.expanded) {
    useEditor.setState({
      message:
        'Collapse the overview before opening more groups; at most 2,000 expansions can be saved.',
    });
    return;
  }
  editor.command('Expand overview group', (graph) =>
    setOverviewConfig(graph, {
      ...getOverviewConfig(graph),
      expanded: [...getOverviewConfig(graph).expanded, id],
    }),
  );
  window.dispatchEvent(new Event(OVERVIEW_RESET_VIEW));
}
export function OverviewNode({ data }: NodeProps<CanvasNode>) {
  const { t, number } = useI18n();
  const group = overviewNodeGroup({ data } as CanvasNode);
  if (!group) return null;
  const states = Object.entries(group.statusCounts).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  return (
    <div
      className="vn-node overview-group-card"
      style={{ '--node-accent': data.node.color } as React.CSSProperties}
      data-testid="overview-group"
      data-node-id={group.id}
      data-overview-count={group.nodeIds.length}
    >
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Right} id="out" />
      <div className="overview-card-heading">
        <Layers size={18} />
        <span>
          {group.reason === 'partition'
            ? t('overview.partition')
            : group.reason === 'area'
              ? t('overview.layoutArea')
              : t('overview.semanticGroup')}
        </span>
      </div>
      <div className="node-title">{group.label}</div>
      <strong className="overview-card-count">
        {t('overview.objectCount', { count: number(group.nodeIds.length) })}
      </strong>
      <div className="overview-card-status" aria-label={t('overview.statusCounts')}>
        {states.slice(0, 3).map(([status, count]) => (
          <span
            key={status}
            className={`overview-status-${status === 'done' ? 'done' : status === 'blocked' ? 'blocked' : 'other'}`}
          >
            {statusLabel(t, status === 'none' ? '' : status)} <b>{number(count)}</b>
          </span>
        ))}
        {states.length > 3 && (
          <span>{t('overview.moreStatuses', { count: number(states.length - 3) })}</span>
        )}
      </div>
      {group.matchingNodeCount < group.nodeIds.length && (
        <small>{t('overview.filterMatches', { count: number(group.matchingNodeCount) })}</small>
      )}
      {group.internalEdgeCount > 0 && (
        <small>{t('overview.internalRelations', { count: number(group.internalEdgeCount) })}</small>
      )}
      {!data.exporting && (
        <button
          className="nodrag nopan overview-expand"
          onClick={(event) => {
            event.stopPropagation();
            expandOverviewGroup(group.id);
          }}
          aria-label={t('overview.expandGroup', { name: group.label })}
        >
          <ChevronRight size={14} />
          {t('overview.expandLevel')}
        </button>
      )}
    </div>
  );
}
