import type { Graph } from '../model/types';
import { getPresentation } from './definition';
import { getStoryboard, type PresentationSource, type StoryboardView } from './storyboard';
export interface PresentationStep {
  id: string;
  name: string;
  nodeIds: string[];
  edgeIds: string[];
  narration: string;
  seconds: number;
  transitionMs: number;
  view?: StoryboardView;
}
export function presentationSteps(graph: Graph, source: PresentationSource): PresentationStep[] {
  if (source === 'storyboard') return getStoryboard(graph).scenes;
  const definition = getPresentation(graph),
    byId = new Map(graph.nodes.map((node) => [node.id, node]));
  return definition.nodeIds.map((id) => {
    const node = byId.get(id);
    return {
      id,
      name: node?.title ?? 'Missing node',
      nodeIds: [id],
      edgeIds: [],
      narration: node?.description ?? '',
      seconds: definition.secondsPerNode,
      transitionMs: definition.transitionMs,
    };
  });
}
