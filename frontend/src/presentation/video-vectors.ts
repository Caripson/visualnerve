import type { VideoCanvasInfo } from './video-frame-events';
import { getDrawingLayer } from '../drawing/types';
import { strokePath } from '../drawing/geometry';
import type { Graph } from '../model/types';

type Paint = (context: CanvasRenderingContext2D) => void;
type Matrix = [number, number, number, number, number, number];
const numeric = (value: string | null | undefined, fallback = 0) => {
  const result = parseFloat(value ?? '');
  return Number.isFinite(result) ? result : fallback;
};
const visibleColor = (value: string) => value && value !== 'none' && value !== 'transparent';

/** Convert live SVG local coordinates back into diagram coordinates. */
function matrix(element: SVGGraphicsElement, info: VideoCanvasInfo): Matrix {
  const ctm = element.getScreenCTM();
  if (!ctm) return [1, 0, 0, 1, 0, 0];
  const rectangle = info.host.getBoundingClientRect();
  const { x, y, zoom } = info.viewport;
  return [
    ctm.a / zoom,
    ctm.b / zoom,
    ctm.c / zoom,
    ctm.d / zoom,
    (ctm.e - rectangle.left - x) / zoom,
    (ctm.f - rectangle.top - y) / zoom,
  ];
}
function opacity(element: Element, stop: Element) {
  let value = 1;
  for (let current: Element | null = element; current; current = current.parentElement) {
    value *= numeric(getComputedStyle(current).opacity, 1);
    if (current === stop) break;
  }
  return value;
}
function transformed(transform: Matrix, alpha: number, draw: Paint): Paint {
  return (context) => {
    context.save();
    context.transform(...transform);
    context.globalAlpha *= alpha;
    draw(context);
    context.restore();
  };
}
function markerPaint(
  path: SVGPathElement,
  position: 'start' | 'end',
  info: VideoCanvasInfo,
): Paint | undefined {
  const reference = path.getAttribute(`marker-${position}`);
  const id = reference?.match(/#([^)'"\s]+)/)?.[1];
  const marker = id && document.getElementById(id);
  if (!marker || typeof path.getTotalLength !== 'function') return;
  const length = path.getTotalLength();
  if (!length) return;
  const at = position === 'start' ? 0 : length;
  const point = path.getPointAtLength(at);
  const nearby = path.getPointAtLength(
    position === 'start' ? Math.min(length, 0.5) : Math.max(0, length - 0.5),
  );
  let angle =
    position === 'start'
      ? Math.atan2(nearby.y - point.y, nearby.x - point.x)
      : Math.atan2(point.y - nearby.y, point.x - nearby.x);
  if (position === 'start' && marker.getAttribute('orient') === 'auto-start-reverse')
    angle += Math.PI;
  const view = (marker.getAttribute('viewBox') ?? '-10 -10 20 20').split(/[ ,]+/).map(Number);
  const units =
    marker.getAttribute('markerUnits') === 'userSpaceOnUse'
      ? 1
      : numeric(getComputedStyle(path).strokeWidth, 1);
  const sx = (numeric(marker.getAttribute('markerWidth'), 12.5) / view[2]) * units;
  const sy = (numeric(marker.getAttribute('markerHeight'), 12.5) / view[3]) * units;
  const refX = numeric(marker.getAttribute('refX')),
    refY = numeric(marker.getAttribute('refY'));
  const symbols = [...marker.querySelectorAll<SVGGraphicsElement>('path,polyline,polygon')].map(
    (symbol) => {
      const data =
        symbol.tagName.toLowerCase() === 'path'
          ? (symbol.getAttribute('d') ?? '')
          : `M ${symbol.getAttribute('points') ?? ''}${symbol.tagName.toLowerCase() === 'polygon' ? ' Z' : ''}`;
      const shape = new Path2D(data),
        style = getComputedStyle(symbol);
      return {
        shape,
        fill: style.fill,
        stroke: style.stroke,
        width: numeric(style.strokeWidth, 1),
      };
    },
  );
  return transformed(
    matrix(path, info),
    opacity(path, path.closest('.react-flow__edge') ?? path),
    (context) => {
      context.translate(point.x, point.y);
      context.rotate(angle);
      context.scale(sx, sy);
      context.translate(-refX, -refY);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      for (const symbol of symbols) {
        if (visibleColor(symbol.fill)) {
          context.fillStyle = symbol.fill;
          context.fill(symbol.shape);
        }
        if (visibleColor(symbol.stroke)) {
          context.strokeStyle = symbol.stroke;
          context.lineWidth = symbol.width;
          context.stroke(symbol.shape);
        }
      }
    },
  );
}
function compileEdge(edge: Element, info: VideoCanvasInfo): Paint[] {
  const commands: Paint[] = [];
  for (const path of edge.querySelectorAll<SVGPathElement>('path.react-flow__edge-path')) {
    const shape = new Path2D(path.getAttribute('d') ?? ''),
      style = getComputedStyle(path);
    const stroke = style.stroke,
      fill = style.fill,
      width = numeric(style.strokeWidth, 1);
    const dash =
      style.strokeDasharray === 'none'
        ? []
        : style.strokeDasharray.split(/[ ,]+/).map(Number).filter(Number.isFinite);
    commands.push(
      transformed(matrix(path, info), opacity(path, edge), (context) => {
        context.lineWidth = width;
        context.lineCap = (style.strokeLinecap as CanvasLineCap) || 'butt';
        context.lineJoin = (style.strokeLinejoin as CanvasLineJoin) || 'round';
        context.setLineDash(dash);
        if (visibleColor(fill)) {
          context.fillStyle = fill;
          context.fill(shape);
        }
        if (visibleColor(stroke)) {
          context.strokeStyle = stroke;
          context.stroke(shape);
        }
        context.setLineDash([]);
      }),
    );
    for (const end of ['start', 'end'] as const) {
      const marker = markerPaint(path, end, info);
      if (marker) commands.push(marker);
    }
  }
  for (const rectangle of edge.querySelectorAll<SVGRectElement>('.react-flow__edge-textbg')) {
    const style = getComputedStyle(rectangle);
    const values = ['x', 'y', 'width', 'height', 'rx'].map((key) =>
      numeric(rectangle.getAttribute(key)),
    );
    commands.push(
      transformed(matrix(rectangle, info), opacity(rectangle, edge), (context) => {
        context.beginPath();
        context.roundRect(values[0], values[1], values[2], values[3], values[4]);
        if (visibleColor(style.fill)) {
          context.fillStyle = style.fill;
          context.fill();
        }
      }),
    );
  }
  for (const text of edge.querySelectorAll<SVGTextElement>('.react-flow__edge-text')) {
    const style = getComputedStyle(text),
      content = text.textContent ?? '';
    const x = numeric(text.getAttribute('x')),
      y = numeric(text.getAttribute('y'));
    const dy =
      numeric(text.getAttribute('dy')) *
      (text.getAttribute('dy')?.endsWith('em') ? numeric(style.fontSize, 12) : 1);
    commands.push(
      transformed(matrix(text, info), opacity(text, edge), (context) => {
        context.fillStyle = style.fill;
        context.font = `${style.fontStyle || 'normal'} ${style.fontWeight || 'normal'} ${style.fontSize || '12px'} ${style.fontFamily || 'sans-serif'}`;
        context.textAlign =
          style.textAnchor === 'middle' ? 'center' : style.textAnchor === 'end' ? 'right' : 'left';
        context.textBaseline = 'alphabetic';
        context.fillText(content, x, y + dy);
      }),
    );
  }
  return commands;
}

/** Native SVG edges are compiled once; camera movement only changes canvas transforms. */
export class VideoVectors {
  private edges = new Map<string, { signature: string; commands: Paint[] }>();
  private drawing?: Graph['diagram']['settings']['drawing'];
  private strokes: Paint[] = [];
  private dirty = true;
  private observer: MutationObserver;
  private themeObserver: MutationObserver;
  private geometryChanged(records: MutationRecord[]) {
    return records.some(
      (record) =>
        record.type !== 'attributes' ||
        (record.target as Element).closest?.('.react-flow__edge,.react-flow__marker'),
    );
  }
  constructor(host: HTMLElement) {
    this.observer = new MutationObserver((records) => {
      if (this.geometryChanged(records)) this.dirty = true;
    });
    this.observer.observe(host, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    this.themeObserver = new MutationObserver(() => {
      this.edges.clear();
      this.dirty = true;
    });
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });
  }
  update(info: VideoCanvasInfo) {
    if (this.geometryChanged(this.observer.takeRecords())) this.dirty = true;
    const active = new Set(info.edges.filter((edge) => !edge.hidden).map((edge) => edge.id));
    for (const id of this.edges.keys()) if (!active.has(id)) this.edges.delete(id);
    if (this.dirty) {
      this.dirty = false;
      for (const element of info.host.querySelectorAll('.react-flow__edge[data-id]')) {
        const id = element.getAttribute('data-id')!;
        if (!active.has(id)) continue;
        const signature = element.outerHTML;
        if (this.edges.get(id)?.signature !== signature)
          this.edges.set(id, { signature, commands: compileEdge(element, info) });
      }
    }
    if (this.drawing !== info.graph.diagram.settings.drawing) {
      this.drawing = info.graph.diagram.settings.drawing;
      const layer = getDrawingLayer(this.drawing);
      this.strokes = !layer?.visible
        ? []
        : layer.strokes.flatMap((stroke) => {
            if (!stroke.points.length) return [];
            const path =
              stroke.points.length > 1 ? new Path2D(strokePath(stroke.points)) : undefined;
            return [
              (context: CanvasRenderingContext2D) => {
                context.strokeStyle = context.fillStyle = stroke.color;
                context.lineWidth = stroke.width;
                context.lineCap = context.lineJoin = 'round';
                if (path) context.stroke(path);
                else {
                  context.beginPath();
                  context.arc(
                    stroke.points[0][0],
                    stroke.points[0][1],
                    stroke.width / 2,
                    0,
                    Math.PI * 2,
                  );
                  context.fill();
                }
              },
            ];
          });
    }
  }
  drawEdges(context: CanvasRenderingContext2D) {
    for (const edge of this.edges.values()) for (const draw of edge.commands) draw(context);
  }
  drawDrawing(context: CanvasRenderingContext2D) {
    for (const draw of this.strokes) draw(context);
  }
  dispose() {
    this.observer.disconnect();
    this.themeObserver.disconnect();
    this.edges.clear();
    this.strokes = [];
  }
}
