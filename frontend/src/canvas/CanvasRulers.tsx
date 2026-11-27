import { useReactFlow, useStore, useViewport } from '@xyflow/react';
import { Fragment, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useI18n } from '../i18n';
import {
  canvasGuideLimit,
  isCanvasGuide,
  isRulerOrigin,
  type CanvasGuide,
  type GuideAxis,
  type RulerOrigin,
} from '../model/canvas-guides';
import type { Diagram } from '../model/types';
import { useEditor } from '../state/editor';
import './canvas-rulers.css';

export const canvasRulerSize = 28;
const origin = { x: 0, y: 0 };
const axes = ['horizontal', 'vertical'] as const;
type Point = RulerOrigin;
type Drag = {
  axis: GuideAxis | 'origin';
  guide?: CanvasGuide;
  pointerId: number;
  button: HTMLButtonElement;
  start: Point;
  offset: number;
};

const coordinate = (axis: GuideAxis, point: Point) => (axis === 'horizontal' ? point.y : point.x);
const round = (value: number) => Number(value.toFixed(1));
const guidesFrom = (value: unknown): CanvasGuide[] =>
  Array.isArray(value) ? value.slice(0, canvasGuideLimit).filter(isCanvasGuide) : [];

function ticks(length: number, zero: number, zoom: number) {
  if (!Number.isFinite(zero) || !Number.isFinite(zoom) || zoom <= 0) return [];
  const rough = 55 / zoom;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const major = ([1, 2, 5, 10].find((step) => step * magnitude >= rough) ?? 10) * magnitude;
  const step = major / 5;
  const pixels = step * zoom;
  const first = Math.ceil((canvasRulerSize - zero) / pixels);
  return Array.from(
    { length: Math.max(0, Math.ceil((length - canvasRulerSize) / pixels)) },
    (_, i) => {
      const index = first + i;
      return { at: zero + index * pixels, value: index % 5 === 0 ? index * step : undefined };
    },
  );
}

export function CanvasRulers({ diagram, drawing }: { diagram: Diagram; drawing: boolean }) {
  const { t, number } = useI18n();
  const flow = useReactFlow();
  const viewport = useViewport();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const layer = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<{ drag: Drag; point: Point } | null>(null);
  const guides = useMemo(
    () => guidesFrom(diagram.settings.canvasGuides),
    [diagram.settings.canvasGuides],
  );
  const savedOrigin = isRulerOrigin(diagram.settings.rulerOrigin)
    ? diagram.settings.rulerOrigin
    : origin;
  const zero = preview?.drag.axis === 'origin' ? preview.point : savedOrigin;

  const screen = (axis: GuideAxis, value: number) =>
    value * viewport.zoom + coordinate(axis, viewport);
  const viewPoint = ({ clientX, clientY }: { clientX: number; clientY: number }) =>
    flow.screenToFlowPosition({ x: clientX, y: clientY }, { snapToGrid: false });

  const save = (label: string, change: (settings: Diagram['settings']) => Diagram['settings']) => {
    const state = useEditor.getState();
    if (state.graph?.diagram.id !== diagram.id) return;
    state.command(label, (graph) => {
      const settings = change(graph.diagram.settings);
      return settings === graph.diagram.settings
        ? graph
        : { ...graph, diagram: { ...graph.diagram, settings } };
    });
  };
  const setOrigin = (point: Point) => {
    if (!isRulerOrigin(point)) return;
    save('Set ruler origin', (settings) => {
      const next = { x: round(point.x), y: round(point.y) };
      if (next.x === 0 && next.y === 0) {
        if (settings.rulerOrigin === undefined) return settings;
        const { rulerOrigin: _, ...rest } = settings;
        return rest;
      }
      return { ...settings, rulerOrigin: next };
    });
  };
  const addGuide = (axis: GuideAxis, position: number) => {
    if (!Number.isFinite(position)) return;
    save('Add guide', (settings) => {
      const current = guidesFrom(settings.canvasGuides);
      if (current.length >= canvasGuideLimit) return settings;
      return {
        ...settings,
        canvasGuides: [...current, { id: crypto.randomUUID(), axis, position: round(position) }],
      };
    });
  };
  const changeGuide = (guide: CanvasGuide, position?: number) => {
    if (position !== undefined && !Number.isFinite(position)) return;
    save(position === undefined ? 'Remove guide' : 'Move guide', (settings) => {
      const current = guidesFrom(settings.canvasGuides);
      return {
        ...settings,
        canvasGuides:
          position === undefined
            ? current.filter(({ id }) => id !== guide.id)
            : current.map((item) =>
                item.id === guide.id ? { ...item, position: round(position) } : item,
              ),
      };
    });
  };

  const start = (
    event: PointerEvent<HTMLButtonElement>,
    axis: Drag['axis'],
    guide?: CanvasGuide,
  ) => {
    if (event.button !== 0 || !event.isPrimary || drag.current) return;
    if (!guide && axis !== 'origin' && guides.length >= canvasGuideLimit) return;
    const button = event.currentTarget;
    button.focus({ preventScroll: true });
    button.setPointerCapture(event.pointerId);
    drag.current = {
      axis,
      guide,
      pointerId: event.pointerId,
      button,
      start: { x: event.clientX, y: event.clientY },
      offset: guide ? guide.position - coordinate(guide.axis, viewPoint(event)) : 0,
    };
  };
  const cancel = () => {
    const active = drag.current;
    drag.current = null;
    setPreview(null);
    if (active?.button.hasPointerCapture(active.pointerId))
      active.button.releasePointerCapture(active.pointerId);
  };
  const dragPoint = (event: PointerEvent, active: Drag) => {
    const point = viewPoint(event);
    if (active.axis === 'horizontal') point.y += active.offset;
    if (active.axis === 'vertical') point.x += active.offset;
    return point;
  };
  const moved = (event: PointerEvent, active: Drag) =>
    Math.hypot(event.clientX - active.start.x, event.clientY - active.start.y) >= 3;
  const place = (event: PointerEvent) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    cancel();
    const bounds = layer.current?.getBoundingClientRect();
    if (!bounds || !moved(event, active)) return;
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (x < 0 || x >= bounds.width || y < 0 || y >= bounds.height) return;
    if (x >= canvasRulerSize && y >= canvasRulerSize) {
      const point = dragPoint(event, active);
      if (active.axis === 'origin') setOrigin(point);
      else if (active.guide) changeGuide(active.guide, coordinate(active.axis, point));
      else addGuide(active.axis, coordinate(active.axis, point));
    } else if (active.guide && coordinate(active.guide.axis, { x, y }) < canvasRulerSize) {
      changeGuide(active.guide);
    }
  };
  const addCentered = (axis: GuideAxis) => {
    const bounds = layer.current?.getBoundingClientRect();
    if (!bounds) return;
    const point = viewPoint({
      clientX: bounds.left + (bounds.width + canvasRulerSize) / 2,
      clientY: bounds.top + (bounds.height + canvasRulerSize) / 2,
    });
    addGuide(axis, coordinate(axis, point));
  };
  const guideKey = (event: KeyboardEvent, guide: CanvasGuide) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      changeGuide(guide);
      layer.current
        ?.querySelector<HTMLButtonElement>(`.canvas-ruler[data-axis="${guide.axis}"]`)
        ?.focus();
      return;
    }
    const [previous, next] =
      guide.axis === 'horizontal' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
    if (event.key !== previous && event.key !== next) return;
    event.preventDefault();
    changeGuide(guide, guide.position + (event.key === next ? 1 : -1) * (event.shiftKey ? 10 : 1));
  };

  const lineStyle = (axis: GuideAxis, value: number) =>
    axis === 'horizontal'
      ? { top: screen(axis, value) - canvasRulerSize }
      : { left: screen(axis, value) - canvasRulerSize };
  return (
    <div
      className="canvas-ruler-layer"
      ref={layer}
      onPointerMove={(event) => {
        const active = drag.current;
        if (active?.pointerId === event.pointerId && moved(event, active))
          setPreview({ drag: active, point: dragPoint(event, active) });
      }}
      onPointerUp={place}
      onPointerCancel={(event) => {
        if (event.pointerId === drag.current?.pointerId) cancel();
      }}
      onLostPointerCapture={(event) => {
        if (event.pointerId === drag.current?.pointerId) cancel();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && drag.current) {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <button
        type="button"
        className="canvas-ruler-corner"
        aria-label={t('editor.canvas.ruler.origin')}
        title={t('editor.canvas.ruler.originHint')}
        onPointerDown={(event) => start(event, 'origin')}
        onDoubleClick={() => setOrigin(origin)}
        onClick={(event) => {
          if (event.detail === 0) setOrigin(origin);
        }}
      >
        <span aria-hidden="true">+</span>
      </button>
      {axes.map((axis) => {
        const horizontal = axis === 'horizontal';
        const marks = ticks(
          horizontal ? width : height,
          screen(horizontal ? 'vertical' : 'horizontal', horizontal ? zero.x : zero.y),
          viewport.zoom,
        );
        return (
          <Fragment key={axis}>
            <button
              type="button"
              className="canvas-ruler"
              data-axis={axis}
              aria-label={t(
                horizontal ? 'editor.canvas.ruler.horizontal' : 'editor.canvas.ruler.vertical',
              )}
              aria-disabled={guides.length >= canvasGuideLimit}
              title={t('editor.canvas.ruler.guideHint')}
              onPointerDown={(event) => start(event, axis)}
              onClick={(event) => {
                if (event.detail === 0) addCentered(axis);
              }}
            />
            <span className="canvas-ruler-marks" data-axis={axis} aria-hidden="true">
              {marks.map(({ at, value }, index) => (
                <span
                  key={index}
                  className={value === undefined ? 'canvas-ruler-tick' : 'canvas-ruler-tick major'}
                  style={horizontal ? { left: at } : { top: at }}
                >
                  {value !== undefined && <span>{number(value)}</span>}
                </span>
              ))}
            </span>
          </Fragment>
        );
      })}
      <div className="canvas-guide-area">
        {guides.map((guide) => {
          const at = screen(guide.axis, guide.position);
          const shown =
            at >= canvasRulerSize && at < (guide.axis === 'horizontal' ? height : width);
          if (!shown && drag.current?.guide?.id !== guide.id) return null;
          const label = t(
            guide.axis === 'horizontal'
              ? 'editor.canvas.ruler.horizontalGuide'
              : 'editor.canvas.ruler.verticalGuide',
            {
              position: number(guide.position - coordinate(guide.axis, savedOrigin)),
            },
          );
          return (
            <button
              type="button"
              key={guide.id}
              className={
                preview?.drag.guide?.id === guide.id ? 'canvas-guide is-dragged' : 'canvas-guide'
              }
              data-axis={guide.axis}
              data-position={guide.position}
              disabled={drawing}
              style={lineStyle(guide.axis, guide.position)}
              aria-label={label}
              title={label}
              onPointerDown={(event) => start(event, guide.axis, guide)}
              onKeyDown={(event) => guideKey(event, guide)}
            />
          );
        })}
        {preview &&
          axes
            .filter((axis) => preview.drag.axis === axis || preview.drag.axis === 'origin')
            .map((axis) => (
              <span
                key={axis}
                className="canvas-guide-preview"
                data-axis={axis}
                style={lineStyle(axis, coordinate(axis, preview.point))}
              />
            ))}
      </div>
    </div>
  );
}
