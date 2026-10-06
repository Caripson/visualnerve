import { Fragment, memo, useEffect, useRef, type CSSProperties } from 'react';
import { Handle, NodeResizer, Position, useStore, type NodeProps } from '@xyflow/react';
import { Lightbulb, Minus, Plus } from 'lucide-react';
import type { CanvasNode } from '../canvas/projection';
import { useEditor } from '../state/editor';
import { AreaIcon, iconKey } from '../ui/icons';
import { topicInk } from '../ui/colors';
import { MetricSummary } from '../components/MetricSummary';
import { NodeStatus } from '../ui/NodeStatus';

export const MindmapNode = memo(({ id, data, selected }: NodeProps<CanvasNode>) => {
  const { node, mindmap: topic, exporting, owners } = data;
  const editing = useEditor((state) => state.editingNode === id);
  const title = useEditor((state) => (state.editingNode === id ? state.editingTitle : ''));
  const input = useRef<HTMLTextAreaElement>(null);
  const smallZoom = useStore((state) => state.transform[2] < 0.2);
  const overview = smallZoom && !exporting && !selected;
  const root = topic?.depth === 0;
  const main = topic?.depth === 1;
  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.select();
      });
    }
  }, [editing]);
  const finish = (commit: boolean, refocus = false) => {
    if (useEditor.getState().editingNode !== id) return;
    useEditor.getState().finishEditing(commit);
    if (refocus) document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)?.focus();
  };
  const add = () => {
    useEditor.getState().select([id]);
    const child = useEditor.getState().child();
    if (child) useEditor.getState().beginEditing(child);
  };
  const color = topic?.color || '#23664d';
  const ink = topicInk(color);
  return (
    <div
      className={`mindmap-topic ${root ? 'mindmap-root' : main ? 'mindmap-main' : 'mindmap-leaf'} topic-${topic?.side ?? 'right'} ${selected && !exporting ? 'is-selected' : ''} ${overview ? 'topic-overview' : ''}`}
      style={{ '--branch-color': color, '--topic-ink': ink } as CSSProperties}
      data-testid="graph-node"
      data-node-id={id}
      data-node-status={node.status || undefined}
      data-topic-depth={topic?.depth ?? 0}
      onDoubleClick={() => {
        if (!exporting) useEditor.getState().beginEditing(id);
      }}
      title={exporting ? undefined : `${node.title} · Double-click or F2 to edit`}
    >
      {selected && !exporting && (
        <NodeResizer
          minWidth={100}
          minHeight={40}
          color={color}
          onResizeEnd={(_, p) =>
            data.resize?.(id, { x: p.x, y: p.y, width: p.width, height: p.height })
          }
        />
      )}
      {(['left', 'right'] as const).map((side) => (
        <Fragment key={side}>
          <Handle
            type="target"
            position={side === 'left' ? Position.Left : Position.Right}
            id={`target-${side}`}
          />
          <Handle
            type="source"
            position={side === 'left' ? Position.Left : Position.Right}
            id={`source-${side}`}
          />
        </Fragment>
      ))}
      {root && !overview && (
        <AreaIcon
          metadata={node.metadata}
          fallback={Lightbulb}
          className="topic-root-icon"
          size={24}
        />
      )}
      {editing && !exporting ? (
        <textarea
          ref={input}
          className="topic-edit nodrag nopan nowheel"
          aria-label="Edit topic"
          value={title}
          onChange={(e) => useEditor.setState({ editingTitle: e.target.value })}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              finish(true, true);
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              finish(false, true);
            }
            if (e.key === 'Tab') {
              e.preventDefault();
              finish(true, true);
              add();
            }
          }}
        />
      ) : (
        <div
          className={`node-title topic-title ${!root && iconKey(node.metadata) ? 'topic-with-icon' : ''}`}
        >
          {!root && !overview && <AreaIcon metadata={node.metadata} size={18} />}
          <span>{node.title}</span>
        </div>
      )}
      {overview && <NodeStatus status={node.status} overview />}
      {!overview && <MetricSummary node={node} />}
      {!overview && (owners.length > 0 || node.status || node.startDate) && (
        <div className="topic-details">
          <NodeStatus status={node.status} />
          {owners.length > 0 && <span>{owners.map((owner) => owner.name).join(', ')}</span>}
          {node.startDate && (
            <span>
              {node.startDate.slice(5)}
              {node.endDate && ` → ${node.endDate.slice(5)}`}
            </span>
          )}
        </div>
      )}
      {!exporting && !overview && (
        <div className="topic-branch-controls nodrag nopan">
          {data.childCount > 0 && (
            <button
              className="topic-collapse"
              aria-label={node.collapsed ? 'Expand branch' : 'Collapse branch'}
              onClick={(e) => {
                e.stopPropagation();
                useEditor.getState().updateNode(id, { collapsed: !node.collapsed });
              }}
              title={`${data.childCount} subtopics`}
            >
              {node.collapsed ? <span>{data.childCount}</span> : <Minus size={11} />}
            </button>
          )}
          <button
            className="topic-add"
            aria-label={`Add subtopic to ${node.title}`}
            title="Add subtopic (Tab)"
            onClick={(e) => {
              e.stopPropagation();
              add();
            }}
          >
            <Plus size={12} />
          </button>
        </div>
      )}
    </div>
  );
});
MindmapNode.displayName = 'MindmapNode';
