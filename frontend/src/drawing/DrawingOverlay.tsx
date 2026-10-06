import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Panel, useReactFlow, ViewportPortal } from '@xyflow/react';
import { Eraser, Eye, EyeOff, Pencil, Trash2, X } from 'lucide-react';
import { useEditor, type DrawingTool } from '../state/editor';
import { DrawingSvg } from './DrawingSvg';
import { strokeBounds, strokeHitTest, type DrawingBounds } from './geometry';
import { drawingLimits, getDrawingLayer, type DrawingStroke } from './types';
import './drawing.css';

type Gesture = {
  pointerId: number;
  diagramId: string;
  tool: DrawingTool;
  stroke?: DrawingStroke;
  limit: number;
  erased: Set<string>;
  sources: { stroke: DrawingStroke; bounds: DrawingBounds }[];
  last: [number, number];
};

export function DrawingOverlay() {
  const graph = useEditor((state) => state.graph);
  const tool = useEditor((state) => state.drawingTool);
  const color = useEditor((state) => state.drawingColor);
  const width = useEditor((state) => state.drawingWidth);
  const layer = useMemo(
    () => getDrawingLayer(graph?.diagram.settings.drawing),
    [graph?.diagram.settings.drawing],
  );
  const flow = useReactFlow();
  const [draft, setDraft] = useState<DrawingStroke | null>(null);
  const [erased, setErased] = useState<string[]>([]);
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef<number | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const active = tool !== 'none';
  const shown = layer?.visible !== false;
  const strokes = useMemo(() => {
    if (!shown || !layer) return [];
    if (!erased.length) return layer.strokes;
    const removed = new Set(erased);
    return layer.strokes.filter((stroke) => !removed.has(stroke.id));
  }, [layer, shown, erased]);
  // A moving pen redraws its draft, not every saved path in the layer.
  const savedDrawing = useMemo(() => <DrawingSvg strokes={strokes} />, [strokes]);

  const discard = () => {
    const previous = gesture.current;
    gesture.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setDraft(null);
    setErased([]);
    if (previous && surface.current?.hasPointerCapture(previous.pointerId))
      surface.current.releasePointerCapture(previous.pointerId);
  };
  const failure = (message: string) => {
    discard();
    useEditor.setState({ status: 'error', message });
  };
  useEffect(() => {
    discard();
  }, [graph?.diagram.id, tool, shown]);
  useEffect(() => {
    if (!active) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      discard();
      useEditor.getState().setDrawingTool('none');
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [active]);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      gesture.current = null;
    },
    [],
  );

  const preview = () => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const current = gesture.current;
      if (!current) return;
      if (current.stroke) setDraft({ ...current.stroke, points: [...current.stroke.points] });
      else setErased([...current.erased]);
    });
  };
  const point = (event: { clientX: number; clientY: number }): [number, number] => {
    const result = flow.screenToFlowPosition(
      { x: event.clientX, y: event.clientY },
      { snapToGrid: false },
    );
    return [result.x, result.y];
  };
  const eraseAt = (current: Gesture, position: [number, number]) => {
    const radius = 12 / flow.getZoom();
    const distance = Math.hypot(position[0] - current.last[0], position[1] - current.last[1]);
    const steps = Math.max(1, Math.min(64, Math.ceil(distance / (radius * 0.75))));
    for (let step = 1; step <= steps; step++) {
      const sample: [number, number] = [
        current.last[0] + ((position[0] - current.last[0]) * step) / steps,
        current.last[1] + ((position[1] - current.last[1]) * step) / steps,
      ];
      for (const { stroke, bounds } of current.sources) {
        if (
          current.erased.has(stroke.id) ||
          sample[0] < bounds.x - radius ||
          sample[0] > bounds.x + bounds.width + radius ||
          sample[1] < bounds.y - radius ||
          sample[1] > bounds.y + bounds.height + radius
        )
          continue;
        if (strokeHitTest(stroke, sample, radius)) current.erased.add(stroke.id);
      }
    }
    current.last = position;
  };
  const collect = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const sample of coalesced.length ? coalesced : [event.nativeEvent]) {
      const position = point(sample);
      if (current.stroke) {
        const last = current.stroke.points.at(-1)!;
        if (Math.hypot(position[0] - last[0], position[1] - last[1]) * flow.getZoom() < 0.7)
          continue;
        if (current.stroke.points.length >= current.limit) {
          failure('Drawing limit reached. Erase some strokes or draw shorter lines.');
          return;
        }
        current.stroke.points.push(position);
      } else eraseAt(current, position);
    }
    preview();
  };
  const begin = (event: PointerEvent<HTMLDivElement>) => {
    if (!graph || !active || !shown || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.isPrimary === false || gesture.current) return;
    event.currentTarget.focus({ preventScroll: true });
    const source = getDrawingLayer(useEditor.getState().graph?.diagram.settings.drawing);
    const existing = source?.strokes ?? [];
    const remaining =
      drawingLimits.points - existing.reduce((sum, item) => sum + item.points.length, 0);
    if (tool === 'pen' && (existing.length >= drawingLimits.strokes || remaining <= 0)) {
      failure('Drawing limit reached. Erase some strokes before adding more.');
      return;
    }
    const position = point(event);
    const current: Gesture = {
      pointerId: event.pointerId,
      diagramId: graph.diagram.id,
      tool,
      ...(tool === 'pen'
        ? { stroke: { id: crypto.randomUUID(), color, width, points: [position] } }
        : {}),
      limit: Math.min(drawingLimits.pointsPerStroke, remaining),
      erased: new Set(),
      sources:
        tool === 'eraser'
          ? existing.map((stroke) => ({ stroke, bounds: strokeBounds(stroke)! }))
          : [],
      last: position,
    };
    gesture.current = current;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'eraser') eraseAt(current, position);
    preview();
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    collect(event);
    if (gesture.current !== current) return;
    const state = useEditor.getState();
    try {
      if (state.graph?.diagram.id === current.diagramId) {
        if (current.stroke) state.addDrawingStroke(current.stroke);
        else state.eraseDrawingStrokes([...current.erased]);
      }
      discard();
    } catch (error) {
      failure((error as Error).message);
    }
  };

  return (
    <>
      <ViewportPortal>
        {savedDrawing}
        {draft && <DrawingSvg strokes={[draft]} draft />}
      </ViewportPortal>
      {active && shown && (
        <div
          ref={surface}
          className={`drawing-surface drawing-${tool}`}
          data-testid="drawing-surface"
          aria-label="Drawing surface"
          tabIndex={-1}
          onPointerDown={begin}
          onPointerMove={collect}
          onPointerUp={finish}
          onPointerCancel={discard}
          onLostPointerCapture={discard}
          onContextMenu={(event) => event.preventDefault()}
          onWheel={(event) => {
            if (gesture.current) event.stopPropagation();
          }}
        />
      )}
      {active && (
        <Panel position="top-left" className="drawing-panel">
          <div className="drawing-tools" role="toolbar" aria-label="Drawing tools">
            <button
              aria-label="Pen"
              title="Pen"
              aria-pressed={tool === 'pen'}
              className={tool === 'pen' ? 'active' : ''}
              onClick={() => useEditor.getState().setDrawingTool('pen')}
            >
              <Pencil size={17} />
            </button>
            <button
              aria-label="Eraser"
              title="Erase whole strokes"
              aria-pressed={tool === 'eraser'}
              className={tool === 'eraser' ? 'active' : ''}
              onClick={() => useEditor.getState().setDrawingTool('eraser')}
            >
              <Eraser size={17} />
            </button>
            <input
              type="color"
              aria-label="Drawing color"
              title="Drawing color"
              value={color}
              onChange={(event) => useEditor.setState({ drawingColor: event.target.value })}
            />
            <select
              aria-label="Drawing width"
              title="Drawing width"
              value={width}
              onChange={(event) => useEditor.setState({ drawingWidth: Number(event.target.value) })}
            >
              {[1, 3, 5, 8, 12].map((value) => (
                <option key={value} value={value}>
                  {value} px
                </option>
              ))}
            </select>
            <button
              aria-label={shown ? 'Hide drawing' : 'Show drawing'}
              title={shown ? 'Hide drawing' : 'Show drawing'}
              disabled={!layer?.strokes.length}
              onClick={() => {
                discard();
                useEditor.getState().toggleDrawingVisibility();
                useEditor.getState().setDrawingTool('none');
              }}
            >
              {shown ? <Eye size={17} /> : <EyeOff size={17} />}
            </button>
            <button
              aria-label="Clear drawing"
              title="Clear drawing (can be undone)"
              disabled={!layer?.strokes.length}
              onClick={() => {
                discard();
                useEditor.getState().clearDrawing();
              }}
            >
              <Trash2 size={17} />
            </button>
            <button
              aria-label="Done drawing"
              title="Done drawing (Escape)"
              onClick={() => useEditor.getState().setDrawingTool('none')}
            >
              <X size={17} />
            </button>
          </div>
          <p className="drawing-hint">
            {tool === 'eraser'
              ? 'Touch a stroke to erase it.'
              : 'Draw with your mouse, finger or pen.'}{' '}
            Escape finishes drawing.
          </p>
        </Panel>
      )}
      {!active && !!layer?.strokes.length && (
        <Panel position="top-right" className="drawing-visibility">
          <button
            aria-label={shown ? 'Hide drawing' : 'Show drawing'}
            title={shown ? 'Hide drawing' : 'Show drawing'}
            onClick={() => useEditor.getState().toggleDrawingVisibility()}
          >
            {shown ? <Eye size={17} /> : <EyeOff size={17} />}
          </button>
        </Panel>
      )}
    </>
  );
}
