import { nodeKindLabel } from '../ui/editor-labels';
import type { MessageId } from '../i18n';
import { useI18n } from '../i18n';
import { NodeToolbar, Position } from '@xyflow/react';
import { createPortal } from 'react-dom';
import { ArrowRight, Diamond, Flag, Layers, Plus, Square, StickyNote } from 'lucide-react';
import { ToolbarMenu } from '../components/ToolbarMenu';
import { useEditor } from '../state/editor';
import { connectedNodeChoices, type ConnectedNodeType } from './connected-node';
import { useQuickAddPlacement } from './quick-add-placement';
import './quick-add.css';

const choiceMessages: Partial<
  Record<ConnectedNodeType, { label: MessageId; description: MessageId }>
> = {
  fork: {
    label: 'editor.nodes.quickAdd.choice.parallelWork',
    description: 'editor.nodes.quickAdd.choice.parallelWorkDescription',
  },
  work: {
    label: 'editor.nodes.quickAdd.choice.workStep',
    description: 'editor.nodes.quickAdd.choice.processWorkWithACapacityAndQueue',
  },
  router: {
    label: 'editor.nodes.typeLabel.decision',
    description: 'editor.nodes.quickAdd.choice.chooseWhichPathWorkFollows',
  },
  outcome: {
    label: 'editor.nodes.quickAdd.choice.outcome',
    description: 'editor.nodes.quickAdd.choice.completeWorkAndOptionallyRealizeRevenue',
  },
  source: {
    label: 'editor.nodes.quickAdd.choice.arrivals',
    description: 'editor.nodes.quickAdd.choice.generateWorkThatEntersThisStep',
  },
  resource: {
    label: 'editor.nodes.quickAdd.choice.sharedResource',
    description: 'editor.nodes.quickAdd.choice.addStaffOrEquipmentRequiredByThisStep',
  },
  timeline: {
    label: 'editor.nodes.typeLabel.timelineItem',
    description: 'editor.nodes.quickAdd.choice.addTheNextEvent',
  },
  process: {
    label: 'editor.nodes.typeLabel.process',
    description: 'editor.nodes.quickAdd.choice.addTheNextStep',
  },
  generic: {
    label: 'editor.nodes.quickAdd.choice.node',
    description: 'editor.nodes.quickAdd.choice.addAConnectedObject',
  },
  decision: {
    label: 'editor.nodes.typeLabel.decision',
    description: 'editor.nodes.quickAdd.choice.addABranchingPoint',
  },
  end: {
    label: 'editor.nodes.typeLabel.end',
    description: 'editor.nodes.quickAdd.choice.addTheFinalStep',
  },
  note: {
    label: 'editor.nodes.typeLabel.note',
    description: 'editor.nodes.quickAdd.choice.attachAnExplanation',
  },
};

const choiceIcon = (type: ConnectedNodeType) =>
  type === 'decision' || type === 'router'
    ? Diamond
    : type === 'end' || type === 'outcome'
      ? Flag
      : type === 'resource' || type === 'fork' || type === 'join'
        ? Layers
        : type === 'note'
          ? StickyNote
          : type === 'source'
            ? ArrowRight
            : Square;

/** Screen-sized controls remain usable at any canvas zoom and on touch screens. */
export function NodeQuickAdd({ id, above = false }: { id: string; above?: boolean }) {
  const { t } = useI18n();
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
      ? t('editor.nodes.quickAdd.addPrevious')
      : semantic?.type === 'resource'
        ? t('editor.nodes.quickAdd.addWork')
        : t('editor.nodes.quickAdd.addNext');
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
          {t('editor.nodes.quickAdd.heading', { actionLabel: label, nodeTitle: node.title })}
        </h3>
        <p>
          {graph.simulation && semantic?.type !== 'router' && semantic?.type !== 'resource'
            ? t('editor.nodes.quickAdd.insertAStepIntoTheFlowOrStartANewPathExisting')
            : t('editor.nodes.quickAdd.aNewNodeAndItsConnectionAreAddedTogetherUndoRemovesBoth')}
        </p>
        {choices.map((choice) => {
          const Icon = choiceIcon(choice.type);
          const copy = choiceMessages[choice.type];
          const outgoing = graph.simulation?.edges.filter((edge) => edge.sourceNodeId === id) ?? [];
          const insertion =
            graph.simulation &&
            (choice.type === 'work' || choice.type === 'router') &&
            (semantic?.type === 'outcome'
              ? graph.simulation.edges.some((edge) => edge.targetNodeId === id)
              : semantic?.type !== 'router' && outgoing.length === 1);
          const choiceLabel = insertion
            ? t(
                choice.type === 'work'
                  ? 'editor.nodes.quickAdd.insertWork'
                  : 'editor.nodes.quickAdd.insertDecision',
              )
            : copy
              ? t(copy.label)
              : nodeKindLabel(t, choice.type);
          const description = copy ? t(copy.description) : choice.description;
          return (
            <button
              key={choice.type}
              className="node-quick-add-choice"
              aria-label={choiceLabel}
              aria-description={description}
              onClick={() => useEditor.getState().addConnectedNode(id, choice.type)}
            >
              <Icon size={17} aria-hidden="true" />
              <span>
                <strong>{choiceLabel}</strong>
                <small>{description}</small>
              </span>
            </button>
          );
        })}
        {graph.simulation && (
          <p className="toolbar-menu-hint">
            {t('editor.nodes.quickAdd.newWorkStepsStartWithCapacity1AndOneMinuteProcessingNew')}
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
