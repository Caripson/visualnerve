import { Crosshair, Grid3X3, Magnet, Map, Pencil, Settings2 } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import type { Graph } from '../model/types';
import { useEditor } from '../state/editor';
import { getDrawingLayer } from '../drawing/types';
import { ToolbarMenu } from '../components/ToolbarMenu';
import { useCompactLayout } from '../hooks/useCompactLayout';
import './canvas-tools.css';

/** Touch users keep the canvas clear; occasional view tools live in a bounded popup. */
export function CanvasTools({
  graph,
  overview,
  minimap,
  setMinimap,
  toggle,
}: {
  graph: Graph;
  overview: boolean;
  minimap: boolean;
  setMinimap: (value: boolean) => void;
  toggle: (key: 'grid' | 'snap') => void;
}) {
  const compact = useCompactLayout();
  const drawingTool = useEditor((state) => state.drawingTool);
  const selectedNodes = useEditor((state) => state.selectedNodes);
  const flow = useReactFlow();
  const tools = (
    <>
      <button
        className={graph.diagram.settings.grid !== false ? 'active' : ''}
        title="Toggle grid"
        aria-label="Toggle grid"
        aria-pressed={graph.diagram.settings.grid !== false}
        onClick={() => toggle('grid')}
      >
        <Grid3X3 size={16} />
        {compact && <span>Grid</span>}
      </button>
      <button
        className={graph.diagram.settings.snap ? 'active' : ''}
        title="Snap to grid"
        aria-label="Snap to grid"
        aria-pressed={!!graph.diagram.settings.snap}
        onClick={() => toggle('snap')}
      >
        <Magnet size={16} />
        {compact && <span>Snap to grid</span>}
      </button>
      {!compact && (
        <button
          className={minimap ? 'active' : ''}
          title="Toggle minimap"
          aria-label="Toggle minimap"
          onClick={() => setMinimap(!minimap)}
        >
          <Map size={16} />
        </button>
      )}
      <button
        title="Center selection"
        aria-label="Center selection"
        disabled={!selectedNodes.length}
        onClick={() =>
          void flow.fitView({
            nodes: flow.getNodes().filter((node) => selectedNodes.includes(node.id)),
            padding: 0.5,
            maxZoom: 1,
          })
        }
      >
        <Crosshair size={16} />
        {compact && <span>Center selection</span>}
      </button>
    </>
  );
  return (
    <div className="canvas-toggles">
      <button
        className={drawingTool !== 'none' ? 'active' : ''}
        title="Draw on diagram"
        aria-label="Draw on diagram"
        aria-pressed={drawingTool !== 'none'}
        disabled={overview}
        onClick={() => {
          const state = useEditor.getState();
          if (state.drawingTool !== 'none') state.setDrawingTool('none');
          else {
            if (getDrawingLayer(state.graph?.diagram.settings.drawing)?.visible === false)
              state.toggleDrawingVisibility();
            state.select([]);
            useEditor.setState({ mobilePanel: null });
            state.setDrawingTool('pen');
          }
        }}
      >
        <Pencil size={16} />
      </button>
      {compact ? (
        <ToolbarMenu label="Canvas options" icon={<Settings2 size={16} />} text={false}>
          <h3>Canvas</h3>
          {tools}
        </ToolbarMenu>
      ) : (
        tools
      )}
    </div>
  );
}
