import { collaborationPermissions } from '../collaboration/access';
import type { Graph } from '../model/types';
import { useEditor } from '../state/editor';
import {
  behaviorDocumentLimits,
  bindBehavior,
  getBehaviorLibrary,
  isBehaviorCompatible,
  type BehaviorDefinition,
} from './document';

export const behaviorDragType = 'application/x-visualnerve-behavior';

export interface BehaviorDrag {
  diagramId: string;
  definitionId: string;
}

let activeBehaviorDrag: BehaviorDrag | undefined;

export function startBehaviorDrag(transfer: DataTransfer, drag: BehaviorDrag): void {
  activeBehaviorDrag = drag;
  transfer.setData(behaviorDragType, JSON.stringify(drag));
  transfer.effectAllowed = 'copy';
}

export function getActiveBehaviorDrag(): BehaviorDrag | undefined {
  return activeBehaviorDrag;
}

export function endBehaviorDrag(): void {
  activeBehaviorDrag = undefined;
}

export function readBehaviorDrag(transfer: DataTransfer): BehaviorDrag | undefined {
  try {
    const value: unknown = JSON.parse(transfer.getData(behaviorDragType));
    if (
      value &&
      typeof value === 'object' &&
      'diagramId' in value &&
      typeof value.diagramId === 'string' &&
      'definitionId' in value &&
      typeof value.definitionId === 'string'
    )
      return { diagramId: value.diagramId, definitionId: value.definitionId };
  } catch {
    return undefined;
  }
}

export function behaviorEditAllowed(diagramId: string): boolean {
  return collaborationPermissions.role(diagramId) === undefined;
}

export function canAttachBehavior(
  graph: Graph,
  nodeId: string,
  definition: BehaviorDefinition,
): boolean {
  const { bindings } = getBehaviorLibrary(graph);
  return (
    bindings.length < behaviorDocumentLimits.bindings &&
    !bindings.some(
      (binding) => binding.nodeId === nodeId && binding.definitionId === definition.id,
    ) &&
    isBehaviorCompatible(graph, nodeId, definition)
  );
}

export function editBehaviors(
  diagramId: string,
  label: string,
  change: (graph: Graph) => Graph,
): void {
  const editor = useEditor.getState();
  if (editor.graph?.diagram.id !== diagramId || !behaviorEditAllowed(diagramId)) return;
  editor.command(label, change);
}

export function attachBehavior(diagramId: string, nodeId: string, definitionId: string): void {
  editBehaviors(diagramId, 'Attach behavior', (graph) => bindBehavior(graph, nodeId, definitionId));
}
