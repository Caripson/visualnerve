import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { svgColor, svgLimits, vectorSVG } from '../src/export/vector-svg';

const rangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
beforeEach(() => {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: function (this: Range) {
      const index = this.startOffset;
      return {
        left: 20 + (index % 8) * 7,
        top: 30 + Math.floor(index / 8) * 15,
        width: 7,
        height: 15,
      };
    },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  if (rangeRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeRect);
  else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});
function scene(zoom = 1) {
  const flow = document.createElement('div');
  flow.innerHTML = `<div class="react-flow__viewport" style="transform:matrix(${zoom},0,0,${zoom},0,0)">
    <div class="react-flow__edges"><svg width="300" height="150"><defs><marker id="arrow" markerWidth="16" markerHeight="16" orient="auto"><path d="M -5 -4 L 5 0 L -5 4 Z" fill="#456"/></marker></defs><path id="edge" d="M 100 50 L 200 50" fill="none" stroke="#456" marker-end="url(#arrow)"/><text x="150" y="50">Next</text><script>alert(1)</script><image href="https://example.com/image.png"/><foreignObject/></svg></div>
    <div class="react-flow__node" style="z-index:-1" data-node-id="group"><div style="background:#eee;border:1px dashed #123;border-radius:8px">Group</div></div>
    <div class="react-flow__node" style="z-index:1" data-node-id="card"><div class="vn-node" data-node-id="card" data-node-status="done" style="background:#abc;border:1px solid #456;border-left:3px solid #456;border-radius:12px;--status-done-border:#267044">
      <div style="font-size:14px;letter-spacing:2px;overflow:hidden"><a style="font-size:14px;letter-spacing:2px" href="https://example.com">Visible text &amp; &lt;script&gt; escaped</a></div><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#345" onclick="alert(1)"><circle cx="12" cy="12" r="10" data-status-icon="done"/><path d="M 8 12 L 11 15 L 16 9"/></svg><div class="react-flow__handle">control</div>
    </div></div>
    <svg class="drawing-layer" style="z-index:2147483647" width="300" height="150" viewBox="0 0 300 150"><path data-drawing-stroke-id="pen" d="M 1 1 Q 30 40 80 20" stroke="#fa0088" stroke-width="4" fill="none"/></svg>
  </div>`;
  document.body.append(flow);
  // Set shorthand declarations individually: jsdom's combined-shorthand parser
  // does not reproduce the browser CSSOM for this fixture.
  const card = flow.querySelector<HTMLElement>('.vn-node')!;
  Object.assign(card.style, {
    backgroundColor: '#aabbcc',
    borderTop: '1px solid #445566',
    borderRight: '1px solid #445566',
    borderBottom: '1px solid #445566',
    borderLeft: '3px solid #445566',
    borderTopLeftRadius: '12px',
    borderTopRightRadius: '12px',
    borderBottomRightRadius: '12px',
    borderBottomLeftRadius: '12px',
  });
  card.style.setProperty('--status-done-border', '#267044');
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const root = this === flow;
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: root ? 400 : 200 * zoom,
      bottom: root ? 200 : 100 * zoom,
      width: root ? 400 : 200 * zoom,
      height: root ? 200 : 100 * zoom,
    } as DOMRect;
  });
  return flow;
}
function parse(xml: string) {
  return new DOMParser().parseFromString(xml, 'image/svg+xml');
}
describe('native vector SVG serializer', () => {
  it('retains paths, editable wrapped text, icons, arrow markers, status and ink with escaped metadata', () => {
    const xml = vectorSVG(scene(), 400, 200, '#ffffff', {
      format: 'visual-nerve-svg',
      value: '</metadata><script>bad</script>',
    });
    const doc = parse(xml);
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.documentElement.getAttribute('viewBox')).toBe('0 0 400 200');
    expect(doc.querySelector('#edge')?.getAttribute('d')).toBe('M 100 50 L 200 50');
    expect(doc.querySelector('#edge')?.getAttribute('marker-end')).toBe('url(#arrow)');
    expect(doc.querySelector('marker#arrow')).not.toBeNull();
    expect(doc.querySelector('circle[data-status-icon="done"]')).not.toBeNull();
    expect(doc.querySelector('[data-drawing-stroke-id="pen"]')?.getAttribute('d')).toContain(
      'Q 30 40',
    );
    expect(
      Array.from(doc.querySelectorAll('text'))
        .map((text) => text.textContent)
        .join(''),
    ).toContain('Visible text & <script> escaped');
    expect(doc.querySelectorAll('text').length).toBeGreaterThan(3);
    expect(JSON.parse(doc.querySelector('metadata')!.textContent!)).toMatchObject({
      value: '</metadata><script>bad</script>',
    });
    expect(doc.querySelector('path[stroke="#267044"]')).not.toBeNull();
    expect(doc.querySelector('clipPath')).not.toBeNull();
    expect(xml).not.toContain('control');
    expect(doc.querySelector('image,foreignObject,script,a,[href],[onclick]')).toBeNull();
    const direct = Array.from(doc.documentElement.children);
    expect(
      direct.findIndex((element) => element.getAttribute('data-node-id') === 'group'),
    ).toBeLessThan(direct.findIndex((element) => element.querySelector('#edge')));
    expect(direct.at(-1)?.querySelector('[data-drawing-stroke-id="pen"]')).not.toBeNull();
  });
  it.each([0.5, 2])(
    'scales HTML text, border widths and corner radii at viewport zoom %s',
    (zoom) => {
      const doc = parse(vectorSVG(scene(zoom), 400, 200, '#fff', {}));
      const label = Array.from(doc.querySelectorAll('text')).find(
        (element) => element.textContent === 'Visible ',
      );
      expect(label?.getAttribute('font-size')).toBe(`${14 * zoom}px`);
      expect(label?.getAttribute('letter-spacing')).toBe(`${2 * zoom}px`);
      const card = doc.querySelector('g[data-node-id="card"]')!;
      expect(card.querySelector('path')?.getAttribute('stroke-width')).toBe(String(zoom));
      expect(card.querySelector('path')?.getAttribute('d')).toContain(
        `A ${12 * zoom} ${12 * zoom}`,
      );
      expect(card.querySelector('line')?.getAttribute('stroke-width')).toBe(String(3 * zoom));
    },
  );
  it('rejects invalid layout/text work before creating any per-character ranges', () => {
    const flow = scene();
    const range = vi.spyOn(document, 'createRange');
    expect(() => vectorSVG(flow, Infinity, 200, '#fff', {})).toThrow('dimensions');
    flow.querySelector('.vn-node')!.textContent = 'a'.repeat(svgLimits.textCharacters + 1);
    expect(() => vectorSVG(flow, 400, 200, '#fff', {})).toThrow('too much rendered text');
    expect(range).not.toHaveBeenCalled();
  });
  it('converts browser sRGB color-mix values to portable RGB', () => {
    expect(svgColor('color(srgb 0.2 0.4 1 / 0.25)')).toBe('rgba(51,102,255,0.25)');
  });
  it('replaces illegal XML controls and lone surrogates while preserving Unicode text', () => {
    const flow = scene();
    flow.querySelector('a')!.textContent = 'bad\u0000\u000b\uD800 Å😀';
    const doc = parse(vectorSVG(flow, 400, 200, '#fff', {}));
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(
      Array.from(doc.querySelectorAll('text'))
        .map((element) => element.textContent)
        .join(''),
    ).toContain('bad��� Å😀');
  });
  it('keeps a collapsed space between words when a line wraps before the next word', () => {
    const flow = scene();
    flow.querySelector('a')!.textContent = 'Plan & <script>safe</script>';
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (this: Range) {
      const index = this.startOffset;
      return {
        left: 20 + (index < 7 ? index : index - 7) * 7,
        top: index < 7 ? 30 : 45,
        width: index === 6 ? 0 : 7,
        height: 15,
      } as DOMRect;
    });
    const doc = parse(vectorSVG(flow, 400, 200, '#fff', {}));
    expect(doc.querySelector('parsererror')).toBeNull();
    const labels = Array.from(
      doc.querySelector('g[data-node-id="card"]')!.querySelectorAll('text'),
    ).filter((label) => label.textContent?.trim());
    expect(labels.map((label) => label.textContent)).toEqual(['Plan & ', '<script>safe</script>']);
    expect(labels.map((label) => label.textContent).join('')).toBe('Plan & <script>safe</script>');
    expect(doc.querySelector('script')).toBeNull();
  });
});
