import { useEffect, useMemo, useState } from 'react';
import type { Graph, GraphNode } from '../model/types';
import { useEditor } from '../state/editor';
import { spatialPositions } from '../spatial/layout';
import {
  getSpatialNode,
  getSpatialView,
  setSpatialNode,
  spatialLimits,
  type SpatialNode,
} from '../spatial/types';

export function SpatialProperties({ graph, node }: { graph: Graph; node?: GraphNode }) {
  const spatial = node ? getSpatialNode(node) : undefined;
  const position = useMemo(
    () => (node ? spatialPositions(graph).get(node.id) : undefined),
    [graph.nodes, graph.edges, node?.id],
  );
  const [draft, setDraft] = useState({ x: '', y: '', z: '' });
  const [error, setError] = useState('');
  useEffect(() => {
    if (position) setDraft({ x: String(position.x), y: String(position.y), z: String(position.z) });
    setError('');
  }, [position?.x, position?.y, position?.z, node?.id]);
  const update = (value: SpatialNode) => {
    if (!node) return;
    useEditor.getState().command('3D object placement', (current) => ({
      ...current,
      nodes: current.nodes.map((item) =>
        item.id === node.id ? setSpatialNode(item, value) : item,
      ),
    }));
  };
  const commit = () => {
    const coordinates = { x: Number(draft.x), y: Number(draft.y), z: Number(draft.z) };
    if (
      Object.values(draft).some((value) => !value.trim()) ||
      Object.values(coordinates).some(
        (value) => !Number.isFinite(value) || Math.abs(value) > spatialLimits.coordinate,
      )
    ) {
      setError('Enter finite coordinates between −1,000,000 and 1,000,000.');
      return;
    }
    setError('');
    if (
      !position ||
      coordinates.x !== position.x ||
      coordinates.y !== position.y ||
      coordinates.z !== position.z
    )
      update({ version: 1, position: coordinates });
  };
  if (!node) return null;
  return (
    <details className="spatial-properties" open={getSpatialView(graph).mode === '3d'}>
      <summary>3D placement</summary>
      <p className="muted">
        3D placement leaves the 2D overview intact. Moving a card in 2D also shifts this placement.
        Y is up; Z points toward the front.
      </p>
      <div className="field-row">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <label className="field" key={axis}>
            <span>{axis.toUpperCase()}</span>
            <input
              aria-label={`3D ${axis.toUpperCase()}`}
              type="number"
              step="0.1"
              value={draft[axis]}
              onChange={(event) =>
                setDraft((previous) => ({ ...previous, [axis]: event.target.value }))
              }
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
          </label>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button disabled={!spatial?.position} onClick={() => update({ version: 1 })}>
        Automatic 3D position
      </button>
    </details>
  );
}
