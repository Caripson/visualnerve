import { useI18n } from '../i18n';
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
  const { t } = useI18n();
  const compact = useCompactLayout();
  const drawingTool = useEditor((state) => state.drawingTool);
  const selectedNodes = useEditor((state) => state.selectedNodes);
  const flow = useReactFlow();
  const tools = (
    <>
      <button
        className={graph.diagram.settings.grid !== false ? 'active' : ''}
        title={t('editor.canvas.tools.toggleGrid')}
        aria-label={t('editor.canvas.tools.toggleGrid')}
        aria-pressed={graph.diagram.settings.grid !== false}
        onClick={() => toggle('grid')}
      >
        <Grid3X3 size={16} />
        {compact && <span>{t('editor.canvas.tools.grid')}</span>}
      </button>
      <button
        className={graph.diagram.settings.snap ? 'active' : ''}
        title={t('editor.canvas.tools.snapToGrid')}
        aria-label={t('editor.canvas.tools.snapToGrid')}
        aria-pressed={!!graph.diagram.settings.snap}
        onClick={() => toggle('snap')}
      >
        <Magnet size={16} />
        {compact && <span>{t('editor.canvas.tools.snapToGrid')}</span>}
      </button>
      {!compact && (
        <button
          className={minimap ? 'active' : ''}
          title={t('editor.canvas.tools.toggleMinimap')}
          aria-label={t('editor.canvas.tools.toggleMinimap')}
          onClick={() => setMinimap(!minimap)}
        >
          <Map size={16} />
        </button>
      )}
      <button
        title={t('editor.canvas.tools.centerSelection')}
        aria-label={t('editor.canvas.tools.centerSelection')}
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
        {compact && <span>{t('editor.canvas.tools.centerSelection')}</span>}
      </button>
    </>
  );
  return (
    <div className="canvas-toggles">
      <button
        className={drawingTool !== 'none' ? 'active' : ''}
        title={t('editor.canvas.tools.drawOnDiagram')}
        aria-label={t('editor.canvas.tools.drawOnDiagram')}
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
        <ToolbarMenu
          label={t('editor.canvas.tools.canvasOptions')}
          icon={<Settings2 size={16} />}
          text={false}
        >
          <h3>{t('editor.canvas.tools.canvas')}</h3>
          {tools}
        </ToolbarMenu>
      ) : (
        tools
      )}
    </div>
  );
}
