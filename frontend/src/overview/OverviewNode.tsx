import { Layers, ChevronRight } from 'lucide-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CanvasNode } from '../canvas/projection';
import { useEditor } from '../state/editor';
import { statusLabel } from '../ui/status';
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
            ? 'Bounded partition'
            : group.reason === 'area'
              ? 'Layout area'
              : 'Semantic group'}
        </span>
      </div>
      <div className="node-title">{group.label}</div>
      <strong className="overview-card-count">
        {group.nodeIds.length.toLocaleString()} <span>objects</span>
      </strong>
      <div className="overview-card-status" aria-label="Group status counts">
        {states.slice(0, 3).map(([status, count]) => (
          <span
            key={status}
            className={`overview-status-${status === 'done' ? 'done' : status === 'blocked' ? 'blocked' : 'other'}`}
          >
            {statusLabel(status === 'none' ? undefined : status)} <b>{count.toLocaleString()}</b>
          </span>
        ))}
        {states.length > 3 && <span>+{states.length - 3} statuses</span>}
      </div>
      {group.matchingNodeCount < group.nodeIds.length && (
        <small>{group.matchingNodeCount.toLocaleString()} match the filters</small>
      )}
      {group.internalEdgeCount > 0 && (
        <small>{group.internalEdgeCount.toLocaleString()} internal relationships</small>
      )}
      {!data.exporting && (
        <button
          className="nodrag nopan overview-expand"
          onClick={(event) => {
            event.stopPropagation();
            expandOverviewGroup(group.id);
          }}
          aria-label={`Expand overview group ${group.label}`}
        >
          <ChevronRight size={14} />
          Expand one level
        </button>
      )}
    </div>
  );
}
