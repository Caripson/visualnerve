import { useEffect } from 'react';
import { useEditor } from '../state/editor';
import { getSpatialView } from '../spatial/types';
import { getPresentation } from './definition';
import { getStoryboard } from './storyboard';
import { presentation } from './service';
import { videoExport } from './video-service';

/** Runtime safety remains active even before the optional player UI is loaded. */
export function usePresentationLifecycle() {
  useEffect(() => {
    const fingerprint = () => {
      const state = useEditor.getState();
      const graph = state.graph;
      return graph
        ? JSON.stringify([
            graph.diagram.id,
            getPresentation(graph),
            getStoryboard(graph),
            graph.edges.map((edge) => [edge.id, edge.sourceNodeId, edge.targetNodeId, edge.label]),
            getSpatialView(graph).mode,
            graph.nodes.map((node) => [
              node.id,
              node.title,
              node.description,
              node.x,
              node.y,
              node.width,
              node.height,
              node.parentId,
              node.collapsed,
              node.metadata.spatial,
            ]),
          ])
        : '';
    };
    let previous = fingerprint();
    let previousGraph = useEditor.getState().graph;
    const unsubscribe = useEditor.subscribe((state) => {
      if (!state.privacyAcknowledged) {
        presentation.close();
        return;
      }
      if (state.graph === previousGraph) return;
      previousGraph = state.graph;
      const next = fingerprint();
      if (next !== previous) {
        previous = next;
        presentation.changed();
      }
    });
    const interrupt = () => presentation.pause('Camera taken over. Press Play to continue.', true);
    const hidden = () => {
      if (document.hidden) presentation.pause('Playback paused while this tab is hidden.');
    };
    window.addEventListener('visualnerve:presentation-interrupted', interrupt);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      unsubscribe();
      window.removeEventListener('visualnerve:presentation-interrupted', interrupt);
      document.removeEventListener('visibilitychange', hidden);
      presentation.close();
      videoExport.cancel();
    };
  }, []);
}
