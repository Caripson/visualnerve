import { NodeToolbar, Position } from '@xyflow/react';
import { createPortal } from 'react-dom';
import { ArrowRight, Diamond, Flag, Layers, Plus, Square, StickyNote } from 'lucide-react';
import { ToolbarMenu } from '../components/ToolbarMenu';
import { useEditor } from '../state/editor';
import { connectedNodeChoices, type ConnectedNodeType } from './connected-node';
import { useQuickAddPlacement } from './quick-add-placement';
import './quick-add.css';

const choiceIcon = (type: ConnectedNodeType) =>
  type === 'decision' || type === 'router'
    ? Diamond
    : type === 'end' || type === 'outcome'
      ? Flag
      : type === 'resource'
        ? Layers
        : type === 'note'
          ? StickyNote
          : type === 'source'
            ? ArrowRight
            : Square;

/** Screen-sized controls remain usable at any canvas zoom and on touch screens. */
export function NodeQuickAdd({ id, above = false }: { id: string; above?: boolean }) {
  const graph = useEditor((state) => state.graph);
  const singleSelection = useEditor((state) => state.selectedNodes.length === 1);
  const choices = graph ? connectedNodeChoices(graph, id) : [];
  const placement = useQuickAddPlacement(!!graph && singleSelection && !!choices.length, id, above);
  if (!graph || !singleSelection) return null;
  if (!choices.length) return null;
  const node = graph.nodes.find((item) => item.id === id)!;
  const semantic = graph.simulation?.nodes.find((item) => item.id === id);
  const label =
    semantic?.type === 'outcome'
      ? 'Add previous'
      : semantic?.type === 'resource'
        ? 'Add work'
        : 'Add next';
  const control = (
    <div
      ref={placement.control}
      className={`node-quick-add nodrag nopan${placement.floating ? ' node-quick-add-floating' : ''}`}
      style={
        placement.floating
          ? {
              left: placement.floating.left,
              top: placement.floating.top,
              maxWidth: placement.floating.maxWidth,
            }
          : undefined
      }
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ToolbarMenu label={label} icon={<Plus size={16} />}>
        <h3 className="node-quick-add-title">
          {label}: {node.title}
        </h3>
        <p>
          {graph.simulation && semantic?.type !== 'router' && semantic?.type !== 'resource'
            ? 'Insert a step into the flow, or start a new path. Existing routing is retained.'
            : 'A new node and its connection are added together. Undo removes both.'}
        </p>
        {choices.map((choice) => {
          const Icon = choiceIcon(choice.type);
          return (
            <button
              key={choice.type}
              className="node-quick-add-choice"
              aria-label={choice.label}
              aria-description={choice.description}
              onClick={() => useEditor.getState().addConnectedNode(id, choice.type)}
            >
              <Icon size={17} aria-hidden="true" />
              <span>
                <strong>{choice.label}</strong>
                <small>{choice.description}</small>
              </span>
            </button>
          );
        })}
        {graph.simulation && (
          <p className="toolbar-menu-hint">
            New Work steps start with capacity 1 and one minute processing. New flow connections use
            3 seconds transfer. Change these values in Assumptions.
          </p>
        )}
      </ToolbarMenu>
    </div>
  );
  return (
    <>
      <NodeToolbar
        nodeId={id}
        isVisible
        position={above ? Position.Top : Position.Bottom}
        align="start"
        offset={12}
      >
        <div
          ref={placement.anchor}
          className="node-quick-add-anchor"
          style={
            placement.floating
              ? {
                  width: placement.floating.width,
                  height: placement.floating.height,
                }
              : undefined
          }
        >
          {!placement.floating && control}
        </div>
      </NodeToolbar>
      {placement.floating && createPortal(control, document.body)}
    </>
  );
}
