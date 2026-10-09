import {
  getBezierPath,
  getSmoothStepPath,
  getViewportForBounds,
  Position,
  type Edge,
} from '@xyflow/react';
import type { CanvasNode } from '../canvas/projection';
import { strokePath } from '../drawing/geometry';
import { topicInk } from '../ui/colors';
import { svgScene } from './svg-scene';
import { SvgNodeContent } from './svg-content';
import {
  attrs,
  xml,
  svgIcon,
  svgPaint,
  SvgWriter,
  SvgTextLayout,
  type SvgTextLine,
  type SvgTextMeasurer,
} from './svg-native';
import {
  svgJobLimits,
  SvgExportError,
  type SvgWorkerRequest,
  type SvgWorkerResponse,
} from './svg-job-types';
import type { MessageFormatter } from '../i18n/message-formatter';

const mix = (accent: string, base: string, ratio: number) => {
  const rgb = (value: string) =>
    /^#[a-f\d]{6}$/i.test(value)
      ? [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16))
      : undefined;
  const a = rgb(accent),
    b = rgb(base);
  return a && b
    ? `rgb(${a.map((channel, index) => Math.round(channel * ratio + b[index] * (1 - ratio))).join(',')})`
    : base;
};
const shapeNames: Record<string, string> = {
  start: 'pill',
  end: 'pill',
  decision: 'decision',
  milestone: 'milestone',
  timeline: 'timeline',
  system: 'system',
  external: 'system',
  input: 'io',
  output: 'io',
  document: 'document',
  database: 'database',
  note: 'note',
  group: 'group',
};
interface Card {
  view: CanvasNode;
  x: number;
  y: number;
  width: number;
  height: number;
  content: ReturnType<SvgNodeContent['read']>;
}

/** Native vector generation never creates a React tree, DOM node or raster image. */
export class SvgModelRenderer {
  private readonly writer = new SvgWriter();
  private readonly text: SvgTextLayout;
  constructor(private readonly measure: SvgTextMeasurer) {
    this.text = new SvgTextLayout(measure);
  }
  render(
    request: SvgWorkerRequest,
    formatter: MessageFormatter,
    progress: (event: SvgWorkerResponse) => void = () => undefined,
  ) {
    const { graph, theme, options } = request;
    progress({ type: 'progress', progress: 3, phase: 'projection' });
    const scene = svgScene(request);
    if (scene.nodes.length > svgJobLimits.nodes || scene.edges.length > svgJobLimits.edges)
      throw new SvgExportError(
        'SVG_OBJECT_LIMIT',
        'Projected SVG exceeds 20,000 nodes or 100,000 connections. Export a selection or use the semantic overview.',
      );
    const content = new SvgNodeContent(scene.summary, formatter),
      cards: Card[] = [],
      byId = new Map<string, Card>();
    let characters = 0;
    for (const view of scene.nodes) {
      const position = scene.positions.get(view.id)!;
      const card = {
        view,
        ...position,
        width: Number(view.width ?? view.data.node.width),
        height: Number(view.height ?? view.data.node.height),
        content: content.read(view),
      };
      if (
        [card.x, card.y, card.width, card.height].some(
          (value) => !Number.isFinite(value) || Math.abs(value) > svgJobLimits.dimension,
        ) ||
        card.width <= 0 ||
        card.height <= 0
      )
        throw new SvgExportError(
          'SVG_GEOMETRY_INVALID',
          'SVG node geometry is invalid or exceeds the supported dimensions.',
        );
      characters +=
        view.data.node.title.length +
        (view.data.node.description?.length ?? 0) +
        card.content.runs.reduce((sum, run) => sum + run.text.length, 0);
      if (characters > svgJobLimits.textCharacters)
        throw new SvgExportError(
          'SVG_TEXT_LIMIT',
          'SVG exceeds 5,000,000 rendered text characters. Export a selection or use the semantic overview.',
        );
      cards.push(card);
      byId.set(view.id, card);
    }
    characters += scene.edges.reduce((sum, edge) => sum + String(edge.label ?? '').length, 0);
    if (characters > svgJobLimits.textCharacters)
      throw new SvgExportError('SVG_TEXT_LIMIT', 'SVG exceeds 5,000,000 rendered text characters.');
    const viewport = options.scope === 'viewport';
    const width = viewport ? request.viewportSize.width : Math.ceil(scene.bounds.width + 80),
      height = viewport ? request.viewportSize.height : Math.ceil(scene.bounds.height + 80);
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0 ||
      width > svgJobLimits.dimension ||
      height > svgJobLimits.dimension
    )
      throw new SvgExportError(
        'SVG_DIMENSION_LIMIT',
        'SVG dimensions exceed 16,777,216 units. Export a smaller selection.',
      );
    const saved = graph.diagram.settings.viewport;
    const transform = viewport
      ? saved && [saved.x, saved.y, saved.zoom].every(Number.isFinite) && saved.zoom > 0
        ? saved
        : getViewportForBounds(scene.bounds, width, height, 0.01, 1, 0.2)
      : { x: 40 - scene.bounds.x, y: 40 - scene.bounds.y, zoom: 1 };
    this.writer.add(
      `<svg xmlns="http://www.w3.org/2000/svg" ${attrs({ width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': graph.diagram.name })}><title>${xml(graph.diagram.name)}</title><metadata>${xml(JSON.stringify({ format: 'visual-nerve-svg', formatVersion: 1, diagramId: graph.diagram.id, scope: options.scope ?? 'complete', view: '2d', renderer: 'model-vector-v1', nodeCount: cards.length, edgeCount: scene.edges.length }))}</metadata><rect width="100%" height="100%" fill="${xml(svgPaint(theme.background, '#fafaf7'))}"/><defs><marker id="vn-svg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs><g transform="translate(${transform.x} ${transform.y}) scale(${transform.zoom})">`,
    );
    progress({
      type: 'progress',
      progress: 20,
      phase: 'layout',
      nodeCount: cards.length,
      edgeCount: scene.edges.length,
    });
    // The canvas places group cards behind every connection and ordinary card.
    // Projection already orders parents before children; retain those original indexes
    // so nested group backgrounds and clip identifiers stay consistent.
    for (let index = 0; index < cards.length; index++)
      if (cards[index].view.data.node.nodeType === 'group') this.node(cards[index], index, request);
    for (let index = 0; index < scene.edges.length; index++) {
      this.edge(scene.edges[index], byId, theme.text, theme.surface, index);
      if (index % 250 === 0)
        progress({
          type: 'progress',
          progress: 20 + Math.round((20 * index) / Math.max(1, scene.edges.length)),
          phase: 'edges',
        });
    }
    for (let index = 0; index < cards.length; index++) {
      if (cards[index].view.data.node.nodeType !== 'group') this.node(cards[index], index, request);
      if (index % 100 === 0)
        progress({
          type: 'progress',
          progress: 40 + Math.round((50 * index) / Math.max(1, cards.length)),
          phase: 'nodes',
        });
    }
    progress({ type: 'progress', progress: 92, phase: 'drawing' });
    for (const stroke of scene.strokes) {
      const color = svgPaint(stroke.color, '#31766c');
      this.writer.add(
        stroke.points.length === 1
          ? `<circle ${attrs({ 'data-drawing-stroke-id': stroke.id, cx: stroke.points[0][0], cy: stroke.points[0][1], r: stroke.width / 2, fill: color })}/>`
          : `<path ${attrs({ 'data-drawing-stroke-id': stroke.id, d: strokePath(stroke.points), fill: 'none', stroke: color, 'stroke-width': stroke.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })}/>`,
      );
    }
    this.writer.add('</g></svg>');
    return {
      svg: this.writer.finish(),
      bytes: this.writer.bytes,
      nodeCount: cards.length,
      edgeCount: scene.edges.length,
    };
  }
  private node(card: Card, index: number, request: SvgWorkerRequest) {
    const { view, width, height, content } = card,
      node = view.data.node,
      topic = view.data.mindmap,
      theme = request.theme;
    const accent = svgPaint(topic?.color ?? node.color ?? view.data.owners[0]?.color, '#31766c');
    const shape = shapeNames[node.nodeType] ?? 'box',
      mindmap = !!topic,
      root = topic?.depth === 0,
      main = topic?.depth === 1;
    let background = svgPaint(theme.node, '#ffffff'),
      border = svgPaint(theme.border, '#e2e5df'),
      ink = svgPaint(theme.text, '#1f2d28'),
      radius = shape === 'pill' ? 44 : shape === 'database' ? 20 : shape === 'note' ? 2 : 6;
    if (mindmap) {
      background = main ? accent : mix(accent, background, root ? 0.07 : 0.14);
      border = main ? accent : mix(accent, border, root ? 0.35 : 0.4);
      radius = root ? 24 : main ? 14 : 12;
      if (main) ink = topicInk(accent);
    }
    if (shape === 'decision' || shape === 'timeline') background = mix(accent, background, 0.05);
    if (shape === 'note') {
      background = mix('#eacd77', background, 0.13);
      border = '#d0bb74';
    }
    if (node.status === 'done') border = svgPaint(theme.doneBorder, '#16803d');
    const left = shape === 'pill' ? 23 : root ? 22 : mindmap ? 14 : 14;
    const clip = `vn-svg-node-${index}`,
      titleClip = `vn-svg-title-${index}`;
    const titleSize = mindmap ? (root ? 21 : 17) : 12,
      titleWeight = root ? 650 : main ? 600 : mindmap ? 500 : 600;
    const titleStart = mindmap ? (root ? 45 : 10) : 33;
    const title = this.text.layout(
      [{ text: node.title, size: titleSize, weight: titleWeight }],
      Math.max(1, width - left * 2),
      titleStart,
    );
    const titleHeight = Math.min(title.height - titleStart, titleSize * (root ? 2.5 : 2.8));
    const detail = this.text.layout(
      content.runs,
      Math.max(1, width - left * 2),
      titleStart + titleHeight + 4,
    );
    this.writer.add(
      `<g ${attrs({ 'data-node-id': view.id, 'data-node-status': node.status, 'data-capacity-unit': node.metadata.simulationCapacityUnit, transform: `translate(${card.x} ${card.y})` })}><title>${xml(node.title)}</title><desc>${xml([node.description, ...content.runs.map((run) => run.text)].filter(Boolean).join('\n'))}</desc><defs><clipPath id="${clip}"><rect x="${left}" y="5" width="${Math.max(1, width - left * 2)}" height="${Math.max(1, height - 10)}"/></clipPath><clipPath id="${titleClip}"><rect x="${left}" y="${titleStart}" width="${Math.max(1, width - left * 2)}" height="${titleHeight + 2}"/></clipPath></defs>`,
    );
    const skew = shape === 'io' ? 'skewX(-4)' : undefined;
    if (shape !== 'group')
      this.writer.add(
        `<rect ${attrs({ x: 0.5, y: 0.5, width: width - 1, height: height - 1, rx: radius, ry: shape === 'database' ? 8 : radius, fill: background, stroke: border, 'stroke-width': root ? 2 : 1, 'stroke-dasharray': shape === 'system' ? '4 3' : undefined, transform: skew })}/>`,
      );
    if (!mindmap && shape !== 'group')
      this.writer.add(
        `<path ${attrs({ d: `M 2 5 V ${height - 5}`, stroke: shape === 'note' ? '#c2a653' : accent, 'stroke-width': shape === 'milestone' ? 5 : 3, 'stroke-linecap': 'round', fill: 'none' })}/>`,
      );
    if (shape === 'group')
      this.writer.add(
        `<rect width="${width}" height="${height}" rx="7" fill="${xml(accent)}" fill-opacity="0.03" stroke="${xml(accent)}" stroke-dasharray="4 3"/>`,
      );
    this.writer.add(`<g clip-path="url(#${clip})">`);
    if (!mindmap) {
      this.writer.add(svgIcon(content.icon, left, 12, 12, accent));
      this.writer.add(
        `<text ${attrs({ x: left + 17, y: 22, 'font-size': 8, 'font-family': 'Inter, sans-serif', 'letter-spacing': 0.7, fill: theme.muted })}>${xml(content.kind.toUpperCase())}</text>`,
      );
    } else if (root) this.writer.add(svgIcon(content.icon, (width - 24) / 2, 12, 24, accent));
    else if ((node.metadata.visualNerve as { icon?: string } | undefined)?.icon)
      this.writer.add(svgIcon(content.icon, left, 9, 17, main ? ink : accent));
    this.writer.add(`<g clip-path="url(#${titleClip})">`);
    this.textLines(title.lines, left, ink);
    this.writer.add('</g>');
    this.textLines(detail.lines, left, ink);
    this.writer.add('</g>');
    if (content.status) {
      const statusIcon: Record<string, string> = {
        done: 'circle-check',
        blocked: 'circle-alert',
        planned: 'circle-dashed',
        'in-progress': 'clock-3',
      };
      const statusWidth = Math.min(
          width - left * 2,
          this.measure.measure(content.status, 8, 600) + 24,
        ),
        statusY = mindmap ? Math.max(5, height - 20) : 13;
      const statusX = Math.max(left, width - statusWidth - left);
      const palette =
        node.status === 'done'
          ? { background: theme.doneBackground, text: theme.doneText }
          : theme.statusColors?.[node.status ?? ''];
      const statusInk = palette?.text ?? ink,
        statusBorder = node.status === 'done' ? theme.doneBorder : (palette?.text ?? border);
      this.writer.add(
        `<rect ${attrs({ 'data-status-badge': node.status, x: statusX - 3, y: statusY - 2, width: statusWidth + 4, height: 16, rx: 5, fill: palette?.background ?? background, stroke: statusBorder, 'stroke-width': 1 })}/>`,
      );
      this.writer.add(
        svgIcon(statusIcon[node.status ?? ''] ?? 'flag', statusX, statusY, 12, statusInk, {
          'data-status-icon': node.status,
        }),
      );
      this.writer.add(
        `<text ${attrs({ x: statusX + 16, y: statusY + 9, 'font-size': 8, 'font-family': 'Inter, sans-serif', 'font-weight': 600, fill: statusInk })}>${xml(content.status)}</text>`,
      );
    }
    if (view.data.presentationNumber)
      this.writer.add(
        `<circle cx="${width - 4}" cy="0" r="10" fill="${xml(accent)}"/><text x="${width - 4}" y="4" text-anchor="middle" font-size="10" font-family="Inter, sans-serif" fill="${xml(topicInk(accent))}">${view.data.presentationNumber}</text>`,
      );
    this.writer.add('</g>');
  }
  private textLines(lines: SvgTextLine[], x: number, color: string) {
    for (const element of this.text.elements(lines, x, color)) this.writer.add(element);
  }
  private edge(edge: Edge, cards: Map<string, Card>, ink: string, surface: string, index: number) {
    const source = cards.get(edge.source),
      target = cards.get(edge.target);
    if (!source || !target)
      throw new SvgExportError(
        'SVG_CONNECTION_INVALID',
        'A projected connection references a missing node.',
      );
    const side = (card: Card, handle: string | undefined, fallback: 'left' | 'right') => {
      const direction = handle?.includes('top')
        ? 'top'
        : handle?.includes('bottom')
          ? 'bottom'
          : handle?.includes('left')
            ? 'left'
            : handle?.includes('right')
              ? 'right'
              : fallback;
      return direction === 'top'
        ? { x: card.x + card.width / 2, y: card.y, position: Position.Top }
        : direction === 'bottom'
          ? { x: card.x + card.width / 2, y: card.y + card.height, position: Position.Bottom }
          : direction === 'left'
            ? { x: card.x, y: card.y + card.height / 2, position: Position.Left }
            : { x: card.x + card.width, y: card.y + card.height / 2, position: Position.Right };
    };
    const a = side(source, edge.sourceHandle ?? undefined, 'right'),
      b = side(target, edge.targetHandle ?? undefined, 'left');
    let path: string, labelX: number, labelY: number;
    const args = {
      sourceX: a.x,
      sourceY: a.y,
      targetX: b.x,
      targetY: b.y,
      sourcePosition: a.position,
      targetPosition: b.position,
    };
    if (edge.type === 'simulation-process-connection' && typeof edge.data?.path === 'string') {
      path = edge.data.path;
      labelX = Number(edge.data.labelX ?? (a.x + b.x) / 2);
      labelY = Number(edge.data.labelY ?? (a.y + b.y) / 2);
    } else if (edge.type === 'overview-relation') {
      const lane = Number(edge.data?.lane ?? 0),
        dx = b.x - a.x,
        dy = b.y - a.y,
        length = Math.max(1, Math.hypot(dx, dy));
      if (edge.source === edge.target) {
        const top = Math.min(a.y, b.y) - 90 - lane * 28;
        path = `M ${a.x} ${a.y} C ${a.x + 80} ${top}, ${b.x - 80} ${top}, ${b.x} ${b.y}`;
        labelX = (a.x + b.x) / 2;
        labelY = top + 14;
      } else {
        const nx = (-dy / length) * (24 + lane * 30),
          ny = (dx / length) * (24 + lane * 30);
        path = `M ${a.x} ${a.y} C ${a.x + dx / 3 + nx} ${a.y + dy / 3 + ny}, ${a.x + (dx * 2) / 3 + nx} ${a.y + (dy * 2) / 3 + ny}, ${b.x} ${b.y}`;
        labelX = (a.x + b.x) / 2 + nx * 0.75;
        labelY = (a.y + b.y) / 2 + ny * 0.75;
      }
    } else
      [path, labelX, labelY] =
        edge.type === 'mindmap-branch' || edge.type === 'default'
          ? getBezierPath({ ...args, curvature: edge.type === 'mindmap-branch' ? 0.45 : 0.25 })
          : getSmoothStepPath(args);
    if (![labelX, labelY].every(Number.isFinite) || /NaN|Infinity/.test(path))
      throw new SvgExportError(
        'SVG_GEOMETRY_INVALID',
        'A projected connection has invalid geometry.',
      );
    const stroke = svgPaint(edge.style?.stroke, '#8a9694'),
      width = Number(edge.style?.strokeWidth ?? 1.6);
    this.writer.add(
      `<g ${attrs({ 'data-edge-id': edge.id })}><path ${attrs({ d: path, fill: 'none', stroke, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-dasharray': edge.style?.strokeDasharray, 'marker-end': edge.markerEnd ? 'url(#vn-svg-arrow)' : undefined, 'marker-start': edge.markerStart ? 'url(#vn-svg-arrow)' : undefined })}/>`,
    );
    if (edge.label) {
      const label = String(edge.label),
        size = edge.type === 'overview-relation' ? 12 : 11;
      const lines = this.text.layout([{ text: label, size, weight: 400 }], 320);
      const labelWidth = Math.min(
          320,
          Math.max(1, ...lines.lines.map((line) => this.measure.measure(line.text, size, 400))),
        ),
        height = lines.height + 8;
      this.writer.add(
        `<g transform="translate(${labelX - labelWidth / 2 - 5} ${labelY - height / 2})"><rect width="${labelWidth + 10}" height="${height}" rx="3" fill="${xml(svgPaint(surface, '#fdfdfb'))}"/>`,
      );
      this.textLines(
        lines.lines.map((line) => ({ ...line, y: line.y + 2 })),
        5,
        svgPaint(ink, '#1f2d28'),
      );
      this.writer.add('</g>');
    }
    this.writer.add('</g>');
  }
}
