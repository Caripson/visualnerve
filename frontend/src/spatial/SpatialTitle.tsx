import { useEffect, useState } from 'react';
import type { Graph } from '../model/types';
import { useEditor } from '../state/editor';
import { NodeTitle } from '../nodes/NodeTitle';
import './spatial-title.css';

export interface SpatialTitleAnchor {
  x: number;
  y: number;
  width: number;
}
/** A single accessible editor follows the selected face; other cards remain GPU objects. */
export function SpatialTitle({
  graph,
  project,
}: {
  graph: Graph;
  project: (id: string) => SpatialTitleAnchor | undefined;
}) {
  const id = useEditor((state) => state.editingNode);
  const node = graph.nodes.find((item) => item.id === id);
  const [anchor, setAnchor] = useState<SpatialTitleAnchor>();
  useEffect(() => {
    if (!id || !node) {
      setAnchor(undefined);
      return;
    }
    let frame = 0;
    const update = () => {
      const next = project(id);
      setAnchor((previous) =>
        next &&
        previous &&
        Math.abs(next.x - previous.x) < 1 &&
        Math.abs(next.y - previous.y) < 1 &&
        Math.abs(next.width - previous.width) < 1
          ? previous
          : next,
      );
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, [id, !!node, project]);
  if (!node || !anchor) return null;
  return (
    <div
      className="spatial-title-editor"
      style={{ left: anchor.x, top: anchor.y, width: anchor.width }}
    >
      <NodeTitle id={node.id} title={node.title} />
    </div>
  );
}
