import { memo } from 'react';
import {
  Handle,
  NodeResizer,
  Position,
  useStore,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import {
  Box,
  Circle,
  Diamond,
  FileText,
  Database,
  Flag,
  Users,
  User,
  Server,
  StickyNote,
  Layers,
  Play,
  Square,
  ArrowDownToLine,
  ArrowUpFromLine,
  Globe,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import type { CanvasNode } from '../canvas/projection';
import type { NodeKind } from '../model/types';
import { useEditor } from '../state/editor';
import { MindmapNode } from '../mindmap/Topic';
import { AreaIcon } from '../ui/icons';
import { MetricSummary } from '../components/MetricSummary';
import { NodeStatus } from '../ui/NodeStatus';
import { SqlTableSummary } from '../components/SqlTableSummary';
import { CodeSummary } from '../components/CodeSummary';
import { SqlQuerySummary } from '../components/SqlQuerySummary';

export const nodeRegistry: Record<NodeKind, { label: string; icon: LucideIcon; shape: string }> = {
  generic: { label: 'Generic', icon: Box, shape: 'box' },
  process: { label: 'Process', icon: Square, shape: 'box' },
  decision: { label: 'Decision', icon: Diamond, shape: 'decision' },
  start: { label: 'Start', icon: Play, shape: 'pill' },
  end: { label: 'End', icon: Circle, shape: 'pill' },
  milestone: { label: 'Milestone', icon: Flag, shape: 'milestone' },
  timeline: { label: 'Timeline item', icon: CalendarDays, shape: 'timeline' },
  person: { label: 'Person', icon: User, shape: 'box' },
  team: { label: 'Team', icon: Users, shape: 'box' },
  system: { label: 'System', icon: Server, shape: 'system' },
  external: { label: 'External system', icon: Globe, shape: 'system' },
  input: { label: 'Input', icon: ArrowDownToLine, shape: 'io' },
  output: { label: 'Output', icon: ArrowUpFromLine, shape: 'io' },
  document: { label: 'Document', icon: FileText, shape: 'document' },
  database: { label: 'Database', icon: Database, shape: 'database' },
  note: { label: 'Note', icon: StickyNote, shape: 'note' },
  group: { label: 'Group', icon: Layers, shape: 'group' },
};
function renderer(kind: NodeKind) {
  const config = nodeRegistry[kind];
  const Icon = config.icon;
  const Component = memo(({ id, data, selected }: NodeProps<CanvasNode>) => {
    const { node, owners, exporting } = data;
    const smallZoom = useStore((state) => state.transform[2] < 0.2);
    const overview = smallZoom && !exporting && !selected;
    const updateNode = useEditor((s) => s.updateNode);
    const color = node.color || owners[0]?.color || '#31766c';
    return (
      <div
        className={`vn-node shape-${config.shape} ${overview ? 'node-overview' : ''} ${selected && !exporting ? 'is-selected' : ''}`}
        style={{ '--node-accent': color } as React.CSSProperties}
        data-testid="graph-node"
        data-node-id={id}
        data-node-status={node.status || undefined}
      >
        {selected && !exporting && (
          <NodeResizer
            minWidth={100}
            minHeight={50}
            color="#267b6a"
            onResizeEnd={(_, p) =>
              data.resize?.(id, { x: p.x, y: p.y, width: p.width, height: p.height })
            }
          />
        )}
        <Handle type="target" position={Position.Left} id="in" />
        <Handle type="source" position={Position.Right} id="out" />
        {!overview && (
          <>
            <Handle type="target" position={Position.Top} id="in-top" />
            <Handle type="source" position={Position.Bottom} id="out-bottom" />
          </>
        )}
        {!overview && (
          <div className="node-topline">
            <AreaIcon metadata={node.metadata} fallback={Icon} size={13} />
            <span className="node-kind">{config.label}</span>
            <NodeStatus status={node.status} />
          </div>
        )}
        <div className="node-title">{node.title}</div>
        {overview && <NodeStatus status={node.status} overview />}
        {!overview && <MetricSummary node={node} />}
        {!overview && <SqlTableSummary node={node} />}
        {!overview && <SqlQuerySummary node={node} />}
        {!overview && <CodeSummary node={node} />}
        {!overview && (
          <div className="node-bottomline">
            {owners.length > 0 && (
              <span className="node-owner">
                <i style={{ background: owners[0].color }} />
                {owners.map((o) => o.name).join(', ')}
              </span>
            )}
            {node.startDate && (
              <span className="node-date">
                {node.startDate.slice(5)}
                {node.endDate && ` → ${node.endDate.slice(5)}`}
              </span>
            )}
            {data.childCount > 0 && !exporting && (
              <button
                className="nodrag nopan branch-toggle"
                aria-label={node.collapsed ? 'Expand branch' : 'Collapse branch'}
                onClick={(e) => {
                  e.stopPropagation();
                  updateNode(id, { collapsed: !node.collapsed });
                }}
              >
                {node.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                {data.childCount}
              </button>
            )}
          </div>
        )}
      </div>
    );
  });
  Component.displayName = `${config.label}Node`;
  return Component;
}
export const nodeTypes: NodeTypes = {
  ...Object.fromEntries(
    (Object.keys(nodeRegistry) as NodeKind[]).map((kind) => [kind, renderer(kind)]),
  ),
  'mindmap-topic': MindmapNode,
};
