import type { GraphNode } from '../model/types';
import { topicInk } from '../ui/colors';
import { attrs, xml, svgPaint, svgIcon, SvgTextLayout } from '../export/svg-native';
import { notationGeometry } from './geometry';
import { notationTitleHasFill } from './appearance';
import { getNotationSymbol } from './registry';
import { nodeBackgroundColor } from '../nodes/appearance';
import { iconKey } from '../ui/icons';
import { notationGuard, notationPrefix } from './labels';
import type { EdgeNotation } from './types';
import {
  notationConnectorPaths,
  notationDecoration,
  notationEdgeAppearance,
  type NotationEdgeContext,
} from './edge-geometry';

/** Native worker SVG uses the same geometry and portable sections as the canvas. */
export class NotationSvgRenderer {
  constructor(
    private readonly write: (value: string) => void,
    private readonly text: SvgTextLayout,
  ) {}
  node(
    node: GraphNode,
    position: { x: number; y: number; width: number; height: number },
    index: number,
    theme: { node: string; text: string; muted: string },
  ) {
    const value = node.notation!,
      geometry = notationGeometry(value),
      symbol = getNotationSymbol(value.collection, value.symbol)!;
    const custom = nodeBackgroundColor(node.backgroundColor),
      background = custom ?? svgPaint(theme.node, '#ffffff'),
      ink =
        custom && notationTitleHasFill(geometry, symbol.container)
          ? topicInk(custom)
          : svgPaint(theme.text, '#1f2d28'),
      accent = svgPaint(node.color, '#31766c');
    const { width, height } = position;
    const absolute = (box: { x: number; y: number; width: number; height: number }) => ({
      x: box.x * width,
      y: box.y * height,
      width: box.width * width,
      height: box.height * height,
    });
    const region = (
      id: string,
      box: { x: number; y: number; width: number; height: number },
      render: () => void,
    ) => {
      this.write(
        `<defs><clipPath id="${id}"><rect ${attrs(box)}/></clipPath></defs><g clip-path="url(#${id})">`,
      );
      render();
      this.write('</g>');
    };
    this.write(
      `<g ${attrs({ 'data-node-id': node.id, 'data-notation-collection': value.collection, 'data-notation-symbol': value.symbol, transform: `translate(${position.x} ${position.y})` })}><title>${xml(node.title)}</title><desc>${xml([node.description, ...(value.compartments?.flatMap((section) => [section.title, ...section.lines]) ?? [])].filter(Boolean).join('\n'))}</desc><g transform="scale(${width / 100} ${height / 100})"><path ${attrs({ 'data-notation-outline': `${value.collection}:${value.symbol}`, d: geometry.outlinePath, fill: geometry.outlineFill === 'none' ? 'none' : geometry.outlineFill === 'foreground' ? accent : background, 'fill-opacity': symbol.container ? 0.035 : undefined, stroke: accent, 'stroke-width': geometry.strokeWidth ?? 1.5, 'stroke-dasharray': geometry.stroke === 'dashed' ? '5 3' : undefined, 'vector-effect': 'non-scaling-stroke' })}/>`,
    );
    for (const d of geometry.backgroundPaths ?? [])
      this.write(`<path ${attrs({ d, fill: background, stroke: 'none' })}/>`);
    for (const d of geometry.shadedPaths ?? [])
      this.write(`<path ${attrs({ d, fill: accent, 'fill-opacity': 0.12, stroke: 'none' })}/>`);
    for (const [paths, dashed] of [
      [geometry.detailPaths, false],
      [geometry.dashedPaths ?? [], true],
    ] as const)
      for (const d of paths)
        this.write(
          `<path ${attrs({ d, fill: 'none', stroke: accent, 'stroke-width': 1.5, 'stroke-dasharray': dashed ? '5 3' : undefined, 'vector-effect': 'non-scaling-stroke' })}/>`,
        );
    for (const d of geometry.filledPaths)
      this.write(
        `<path ${attrs({ d, fill: accent, stroke: accent, 'vector-effect': 'non-scaling-stroke' })}/>`,
      );
    for (const d of geometry.contrastPaths ?? [])
      this.write(
        `<path ${attrs({ d, fill: 'none', stroke: background, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' })}/>`,
      );
    this.write('</g>');
    const prefix = notationPrefix(value);
    if (prefix != null && geometry.prefixBox) {
      const box = absolute(geometry.prefixBox);
      region(`notation-prefix-${index}`, box, () =>
        this.line(String(prefix), box.x + box.width / 2, box.y + box.height / 2 + 4, 11, ink, true),
      );
    }
    const guard = notationGuard(value);
    if (guard && geometry.guardBox) {
      const guardBox = absolute(geometry.guardBox);
      region(`notation-guard-${index}`, guardBox, () =>
        this.line(
          guard,
          guardBox.x + guardBox.width / 2,
          guardBox.y + guardBox.height / 2 + 4,
          11,
          ink,
          false,
        ),
      );
    }
    const box = absolute(geometry.contentBox);
    region(`notation-content-${index}`, box, () => {
      let top = box.y + 2;
      const key = iconKey(node.metadata);
      if (prefix != null && !geometry.prefixBox) {
        this.line(String(prefix), box.x + box.width / 2, top + 11, 11, ink, true);
        top += 16;
      }
      if (geometry.titleStyle !== 'hidden') {
        if (key) this.write(svgIcon(key, box.x + 2, top, 16, ink));
        if (geometry.titleRotation)
          this.write(
            `<g transform="translate(${box.x + box.width / 2} ${box.y + box.height / 2}) rotate(${geometry.titleRotation})">`,
          );
        const title = this.text.layout(
          [{ text: node.title, size: 14, weight: 600 }],
          Math.max(1, box.width - 4 - (key ? 36 : 0)),
          top,
        );
        const rotated = geometry.titleRotation
          ? this.text.layout(
              [{ text: node.title, size: 14, weight: 600 }],
              Math.max(1, box.height - 4),
              -10,
            )
          : title;
        for (const line of rotated.lines)
          this.write(
            `<text ${attrs({ x: geometry.titleRotation ? 0 : box.x + box.width / 2, y: line.y, fill: ink, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 600, 'font-family': 'Inter, sans-serif', 'font-style': geometry.titleStyle === 'italic' ? 'italic' : undefined, 'text-decoration': geometry.titleStyle === 'underlined' ? 'underline' : undefined, 'xml:space': 'preserve' })}>${xml(line.text)}</text>`,
          );
        if (geometry.titleRotation) this.write('</g>');
        top = title.height + 4;
      }
      if (node.status) {
        this.line(node.status, box.x + box.width / 2, top + 11, 11, ink, true);
        top += 18;
      }
      if (!geometry.compartmentBoxes?.length)
        for (const section of value.compartments ?? []) {
          this.write(
            `<path d="M ${box.x} ${top} H ${box.x + box.width}" stroke="${xml(accent)}" fill="none"/>`,
          );
          top += 6;
          if (section.title) {
            this.line(section.title, box.x + box.width / 2, top + 11, 11, ink, true);
            top += 17;
          }
          const lines = this.text.layout(
            section.lines.map((text) => ({ text, size: 12, weight: 400 })),
            Math.max(1, box.width - 8),
            top,
          );
          for (const element of this.text.elements(lines.lines, box.x + 4, ink))
            this.write(element);
          top = lines.height + 6;
        }
    });
    geometry.compartmentBoxes?.forEach((sectionBox, sectionIndex) => {
      const section =
        value.compartments?.find((item) => item.id === sectionBox.id) ??
        value.compartments?.[sectionIndex];
      if (!section) return;
      const box = absolute(sectionBox);
      region(`notation-section-${index}-${sectionIndex}`, box, () => {
        let top = box.y + 4;
        if (section.title) {
          this.line(section.title, box.x + box.width / 2, top + 11, 11, ink, true);
          top += 19;
        }
        const lines = this.text.layout(
          section.lines.map((text) => ({ text, size: 12, weight: 400 })),
          Math.max(1, box.width - 8),
          top,
        );
        for (const element of this.text.elements(lines.lines, box.x + 4, ink)) this.write(element);
      });
    });
    this.write('</g>');
    return symbol;
  }
  markers(
    value: EdgeNotation,
    index: number,
    ink: string,
    surface: string,
    context: NotationEdgeContext = {},
  ) {
    const appearance = notationEdgeAppearance(value, context),
      ids = { start: `notation-start-${index}`, end: `notation-end-${index}` };
    for (const [side, decoration] of [
      ['start', appearance.sourceDecoration],
      ['end', appearance.targetDecoration],
    ] as const) {
      const shape = notationDecoration(
        decoration,
        side === 'end' && appearance.hatch,
        side === 'end' && appearance.ribbon,
      );
      this.write(
        `<defs><marker ${attrs({ id: ids[side], viewBox: '-1 -1 12 12', refX: 10, refY: 5, markerWidth: 12, markerHeight: 12, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' })}><path ${attrs({ d: shape.path, fill: shape.fill === 'foreground' ? ink : shape.fill === 'background' ? surface : 'none', stroke: ink, 'stroke-width': 1.5, 'stroke-linejoin': 'round' })}/>${shape.detailPaths.map((d) => `<path ${attrs({ d, fill: 'none', stroke: ink, 'stroke-width': 1 })}/>`).join('')}</marker></defs>`,
      );
    }
    return {
      ...appearance,
      markerStart: appearance.sourceDecoration === 'none' ? undefined : `url(#${ids.start})`,
      markerEnd: appearance.targetDecoration === 'none' ? undefined : `url(#${ids.end})`,
    };
  }
  edge(
    value: EdgeNotation,
    path: string,
    index: number,
    ink: string,
    surface: string,
    width: number,
    context: NotationEdgeContext = {},
  ) {
    const appearance = this.markers(value, index, ink, surface, context),
      geometry = notationConnectorPaths(value, path, context);
    const draw = (d: string, strokeWidth: number, markers = false, dash?: string) =>
      this.write(
        `<path ${attrs({ d, fill: 'none', stroke: ink, 'stroke-width': strokeWidth, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': dash, 'marker-start': markers ? appearance.markerStart : undefined, 'marker-end': markers ? appearance.markerEnd : undefined })}/>`,
      );
    if (appearance.double || appearance.ribbon) {
      for (const d of geometry.strokePaths) draw(d, width);
      draw(geometry.path, 0, true);
    } else
      draw(
        geometry.path,
        appearance.heavy ? Math.max(width, geometry.strokeWidth) : width,
        true,
        appearance.line === 'dashed' ? '7 4' : appearance.line === 'dotted' ? '2 4' : undefined,
      );
    for (const d of geometry.detailPaths) draw(d, appearance.hatch ? 1 : 1.5);
  }
  ends(value: EdgeNotation, a: { x: number; y: number }, b: { x: number; y: number }, ink: string) {
    this.line(
      [value.sourceLabel, value.sourceMultiplicity].filter(Boolean).join(' '),
      a.x + 16,
      a.y - 10,
      11,
      ink,
    );
    this.line(
      [value.targetLabel, value.targetMultiplicity].filter(Boolean).join(' '),
      b.x - 16,
      b.y - 10,
      11,
      ink,
      false,
      'end',
    );
  }
  private line(
    text: string,
    x: number,
    y: number,
    size: number,
    color: string,
    center = false,
    anchor?: string,
  ) {
    if (text)
      this.write(
        `<text ${attrs({ x, y, fill: color, 'font-size': size, 'font-family': 'Inter, sans-serif', 'text-anchor': anchor ?? (center ? 'middle' : 'start') })}>${xml(text)}</text>`,
      );
  }
}
