import { svgJobLimits, SvgExportError } from './svg-job-types';
import { svgIcons } from './svg-icons';

export const SVG_FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const xml = (value: unknown) =>
  String(value ?? '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\ufffd')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '\ufffd')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
/** Paint is a literal, never an external URL, CSS variable or embedded markup. */
export function svgPaint(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const color = value.trim();
  if (
    /^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(color) ||
    /^(?:rgb|rgba|hsl|hsla)\([\d.,%\s/+-]+\)$/i.test(color) ||
    /^(?:transparent|none|black|white|red|green|blue|orange|yellow|purple|grey|gray)$/i.test(color)
  )
    return color;
  return fallback;
}
export const attrs = (properties: Record<string, unknown>) =>
  Object.entries(properties)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}="${xml(value)}"`)
    .join(' ');
export function svgIcon(
  name: string,
  x: number,
  y: number,
  size: number,
  color: string,
  extra: Record<string, unknown> = {},
) {
  const parts = svgIcons[name] ?? svgIcons.box;
  return `<g ${attrs({ transform: `translate(${x} ${y}) scale(${size / 24})`, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...extra })}>${parts.map(([tag, properties]) => `<${tag} ${attrs(properties)}/>`).join('')}</g>`;
}
export class SvgWriter {
  private readonly chunks: string[] = [];
  bytes = 0;
  private readonly encoder = new TextEncoder();
  add(value: string) {
    this.bytes += this.encoder.encode(value).byteLength;
    if (this.bytes > svgJobLimits.bytes)
      throw new SvgExportError(
        'SVG_SIZE_LIMIT',
        'SVG exceeds the 64 MiB export limit. Export a selection or use the semantic overview.',
      );
    this.chunks.push(value);
  }
  finish() {
    return this.chunks.join('');
  }
}
export interface SvgTextRun {
  text: string;
  size: number;
  weight: number;
  mono?: boolean;
  color?: string;
  gap?: number;
}
export interface SvgTextLine extends SvgTextRun {
  y: number;
}
export interface SvgTextMeasurer {
  measure(text: string, size: number, weight: number, mono?: boolean): number;
}
export class CanvasSvgTextMeasurer implements SvgTextMeasurer {
  private readonly context: OffscreenCanvasRenderingContext2D;
  constructor() {
    const context = new OffscreenCanvas(1, 1).getContext('2d');
    if (!context)
      throw new SvgExportError(
        'SVG_WORKER_UNAVAILABLE',
        'This browser cannot measure vector text in a background worker. Use a current browser.',
      );
    this.context = context;
  }
  measure(text: string, size: number, weight: number, mono = false) {
    this.context.font = `${weight} ${size}px ${mono ? 'monospace' : SVG_FONT}`;
    return this.context.measureText(text).width;
  }
}
/** Preserves every character, including long unbroken identifiers; never ellipsizes. */
export class SvgTextLayout {
  constructor(
    private readonly measurer: SvgTextMeasurer,
    private readonly maximumBytes = svgJobLimits.bytes,
  ) {}
  wrap(text: string, width: number, size: number, weight: number, mono = false) {
    return [...this.wrapped(text, width, size, weight, mono)];
  }
  private *wrapped(
    text: string,
    width: number,
    size: number,
    weight: number,
    mono = false,
  ): Generator<string> {
    for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
      let line = '';
      for (const token of paragraph.match(/\s+|\S+/g) ?? ['']) {
        if (this.prefix(token, 0, width, size, weight, mono, line).complete) {
          line += token;
          continue;
        }
        if (line) {
          yield line;
          line = '';
        }
        let offset = 0;
        while (offset < token.length) {
          const { take } = this.prefix(token, offset, width, size, weight, mono),
            end = offset + take;
          if (end === token.length) {
            line = token.slice(offset);
            break;
          }
          yield token.slice(offset, end);
          offset = end;
        }
      }
      yield line;
    }
  }
  /** Probe only a line-sized prefix, never repeatedly measure the entire remaining token. */
  private prefix(
    text: string,
    offset: number,
    width: number,
    size: number,
    weight: number,
    mono: boolean,
    leading = '',
  ) {
    const remaining = text.length - offset,
      fits = (length: number) =>
        this.measurer.measure(leading + text.slice(offset, offset + length), size, weight, mono) <=
        width;
    let low = 0,
      high = 1;
    while (fits(high)) {
      low = high;
      if (high === remaining) return { take: high, complete: true };
      high = Math.min(remaining, high * 2);
    }
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (fits(middle)) low = middle;
      else high = middle;
    }
    let take = Math.max(1, low);
    if (/[\uD800-\uDBFF]/.test(text[offset + take - 1]) && take < remaining) take++;
    return { take, complete: false };
  }
  layout(runs: SvgTextRun[], width: number, start = 0) {
    const lines: SvgTextLine[] = [],
      encoder = new TextEncoder();
    let y = start,
      minimumBytes = 0;
    for (const run of runs) {
      y += run.gap ?? 0;
      // Every actual text element has at least these attributes. Reject impossible
      // output sizes while iterating, before allocating millions of line objects.
      const overhead = encoder.encode(this.element({ ...run, text: '', y: 0 }, 0, 'red')).length;
      for (const text of this.wrapped(run.text, width, run.size, run.weight, run.mono)) {
        minimumBytes += overhead + encoder.encode(xml(text)).length;
        if (minimumBytes > this.maximumBytes)
          throw new SvgExportError('SVG_SIZE_LIMIT', 'SVG exceeds the 64 MiB export limit.');
        y += run.size * 1.4;
        lines.push({ ...run, text, y });
      }
    }
    return { lines, height: y };
  }
  render(lines: SvgTextLine[], x: number, color: string) {
    return [...this.elements(lines, x, color)].join('');
  }
  *elements(lines: SvgTextLine[], x: number, color: string) {
    for (const line of lines) yield this.element(line, x, color);
  }
  private element(line: SvgTextLine, x: number, color: string) {
    return `<text ${attrs({ x, y: line.y, 'font-family': line.mono ? 'monospace' : SVG_FONT, 'font-size': line.size, 'font-weight': line.weight, fill: line.color ?? color, 'xml:space': 'preserve' })}>${xml(line.text)}</text>`;
  }
}
