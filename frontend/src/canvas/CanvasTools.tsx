import { useI18n } from '../i18n';
import {
  Crosshair,
  Grid3X3,
  Magnet,
  Map,
  PaintBucket,
  Pencil,
  Ruler,
  Settings2,
} from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import type { Graph } from '../model/types';
import { useEditor } from '../state/editor';
import { collaborationPermissions } from '../collaboration/access';
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
  editingToolsAvailable,
  toggleRulers,
}: {
  graph: Graph;
  overview: boolean;
  minimap: boolean;
  setMinimap: (value: boolean) => void;
  toggle: (key: 'grid' | 'snap') => void;
  editingToolsAvailable: boolean;
  toggleRulers: () => void;
}) {
  const { t } = useI18n();
  const compact = useCompactLayout();
  const canvasTool = useEditor((state) => state.canvasTool);
  const toolColor = useEditor((state) => state.toolColor);
  const selectedNodes = useEditor((state) => state.selectedNodes);
  const flow = useReactFlow();
  const drawing = canvasTool === 'pen' || canvasTool === 'eraser';
  const filling = editingToolsAvailable && canvasTool === 'fill';
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
      {editingToolsAvailable && (
        <button
          className={graph.diagram.settings.showRulers !== false ? 'active' : ''}
          title={t('editor.canvas.tools.rulers')}
          aria-label={t('editor.canvas.tools.rulers')}
          aria-keyshortcuts="Control+R Meta+R"
          aria-pressed={graph.diagram.settings.showRulers !== false}
          onClick={toggleRulers}
        >
          <Ruler size={16} />
          {compact && <span>{t('editor.canvas.tools.rulers')}</span>}
        </button>
      )}
      {editingToolsAvailable && (
        <button
          className={filling ? 'active' : ''}
          title={`${t('editor.canvas.tools.fillNodes')} (G)`}
          aria-label={t('editor.canvas.tools.fillNodes')}
          aria-keyshortcuts="G"
          aria-pressed={filling}
          disabled={collaborationPermissions.role(graph.diagram.id) === 'viewer'}
          onClick={() => useEditor.getState().setCanvasTool(filling ? 'none' : 'fill')}
        >
          <PaintBucket size={16} />
          {compact && <span>{t('editor.canvas.tools.fillNodes')}</span>}
        </button>
      )}
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
        className={drawing ? 'active' : ''}
        title={`${t('editor.canvas.tools.drawOnDiagram')} (B)`}
        aria-label={t('editor.canvas.tools.drawOnDiagram')}
        aria-keyshortcuts="B"
        aria-pressed={drawing}
        disabled={overview}
        onClick={() => useEditor.getState().setCanvasTool(drawing ? 'none' : 'pen')}
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
      {filling && (
        <input
          type="color"
          className="canvas-fill-color"
          aria-label={t('editor.canvas.tools.fillColor')}
          title={t('editor.canvas.tools.fillColor')}
          value={toolColor}
          onChange={(event) => useEditor.setState({ toolColor: event.target.value })}
        />
      )}
    </div>
  );
}
