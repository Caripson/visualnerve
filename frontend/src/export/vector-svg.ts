const namespace = 'http://www.w3.org/2000/svg';
const svgTags = new Set([
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'defs',
  'marker',
  'clipPath',
  'linearGradient',
  'radialGradient',
  'stop',
]);
const svgAttributes = new Set([
  'id',
  'd',
  'x',
  'y',
  'dx',
  'dy',
  'x1',
  'x2',
  'y1',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'viewBox',
  'preserveAspectRatio',
  'points',
  'transform',
  'markerWidth',
  'markerHeight',
  'markerUnits',
  'orient',
  'refX',
  'refY',
  'clipPathUnits',
  'gradientUnits',
  'gradientTransform',
  'offset',
  'data-node-id',
  'data-drawing-stroke-id',
  'data-status-icon',
]);
const paintProperties = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  'marker-start',
  'marker-end',
  'clip-path',
  'stop-color',
  'stop-opacity',
];
const excluded =
  '.react-flow__handle,.react-flow__edge-interaction,.react-flow__resize-control,' +
  '.topic-branch-controls,.node-quick-add,.drawing-draft';
const number = (value: number) => String(Math.round(value * 1000) / 1000);
const xmlText = (value: string) =>
  value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uD800-\uDFFF\uFFFE\uFFFF]/gu, '\uFFFD');
export const svgLimits = { elements: 100000, textCharacters: 250000, bytes: 16 * 1024 * 1024 };
const length = (value: string, total: number) =>
  value.endsWith('%') ? (parseFloat(value) * total) / 100 : parseFloat(value) || 0;

/** Computed color-mix often resolves to color(srgb), which older SVG readers lack. */
export function svgColor(value: string) {
  const color = value.match(
    /^color\(srgb\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)(?:\s*\/\s*([\d.e+-]+))?\)$/i,
  );
  if (!color) return value;
  const channels = color
    .slice(1, 4)
    .map((part) => Math.round(Math.max(0, Math.min(1, Number(part))) * 255));
  return color[4] === undefined
    ? `rgb(${channels.join(',')})`
    : `rgba(${channels.join(',')},${color[4]})`;
}
function create(tag: string, attributes: Record<string, string | number> = {}) {
  const element = document.createElementNS(namespace, tag);
  for (const [name, value] of Object.entries(attributes))
    element.setAttribute(name, xmlText(String(value)));
  return element;
}

/** Native SVG only: HTML layout is measured, never embedded or rasterized. */
export function vectorSVG(
  flow: HTMLElement,
  width: number,
  height: number,
  background: string,
  metadata: Record<string, unknown>,
) {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0 && value <= 16777216))
    throw new Error('SVG dimensions exceed browser layout limits. Export a smaller selection.');
  if (flow.querySelectorAll('*').length > svgLimits.elements)
    throw new Error('SVG has too many rendered elements. Export a smaller selection.');
  const textNodes = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
  let characters = 0;
  while (textNodes.nextNode()) {
    characters += textNodes.currentNode.textContent?.length ?? 0;
    if (characters > svgLimits.textCharacters)
      throw new Error('SVG has too much rendered text. Export a smaller selection.');
  }
  const origin = flow.getBoundingClientRect();
  const viewport = flow.querySelector('.react-flow__viewport');
  const transform = viewport ? getComputedStyle(viewport).transform : '';
  const matrix = transform
    .match(/^matrix\(([^)]+)\)$/)?.[1]
    .split(',')
    .map(Number);
  const zoom = matrix
    ? Math.hypot(matrix[0], matrix[1])
    : Number(transform.match(/scale\(([^)]+)\)/)?.[1]) || 1;
  const root = create('svg', {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
  });
  const description = create('metadata');
  description.textContent = JSON.stringify(metadata);
  root.append(description, create('rect', { width, height, fill: svgColor(background) }));
  const defs = create('defs');
  root.append(defs);
  let clipIndex = 0;
  const ids = new Set(Array.from(flow.querySelectorAll('[id]')).map((element) => element.id));
  const safePaint = (value: string) => {
    if (!/url\(/i.test(value)) return svgColor(value);
    // Browsers may expand a same-document fragment to an absolute URL.
    const fragment = value.match(/^url\(["']?(?:[^"'()]*#)([^"'()]+)["']?\)$/);
    return fragment && ids.has(fragment[1]) ? `url(#${fragment[1]})` : undefined;
  };
  const copySVG = (source: Element): SVGElement | undefined => {
    if (!svgTags.has(source.localName) || source.matches(excluded)) return;
    const style = getComputedStyle(source);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    const target = create(source.localName);
    for (const attribute of source.attributes)
      if (svgAttributes.has(attribute.name))
        target.setAttribute(attribute.name, xmlText(attribute.value));
    for (const property of paintProperties) {
      const value = safePaint(
        style.getPropertyValue(property) || source.getAttribute(property) || '',
      );
      if (value) target.setAttribute(property, value);
    }
    // Text stays text; XMLSerializer escapes source-derived characters.
    for (const child of source.childNodes) {
      if (child.nodeType === Node.TEXT_NODE)
        target.append(document.createTextNode(xmlText(child.textContent ?? '')));
      else if (child instanceof Element) {
        const copied = copySVG(child);
        if (copied) target.append(copied);
      }
    }
    return target;
  };
  for (const source of flow.querySelectorAll('svg defs'))
    for (const child of source.children) {
      const copied = copySVG(child);
      if (copied) defs.append(copied);
    }
  const rectangle = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left - origin.left,
      y: rect.top - origin.top,
      width: rect.width,
      height: rect.height,
    };
  };
  const roundedPath = (x: number, y: number, w: number, h: number, style: CSSStyleDeclaration) => {
    const corners = [
      'border-top-left-radius',
      'border-top-right-radius',
      'border-bottom-right-radius',
      'border-bottom-left-radius',
    ].map((property) => {
      const parts = style.getPropertyValue(property).split(/\s+/);
      const radius = (value: string, total: number) =>
        length(value, total) * (value.endsWith('%') ? 1 : zoom);
      return [
        Math.min(w / 2, radius(parts[0] || '0', w)),
        Math.min(h / 2, radius(parts[1] || parts[0] || '0', h)),
      ];
    });
    const [a, b, c, d] = corners;
    const arc = (radius: number[], endX: number, endY: number) =>
      radius[0] && radius[1]
        ? `A ${radius.map(number).join(' ')} 0 0 1 ${number(endX)} ${number(endY)}`
        : `L ${number(endX)} ${number(endY)}`;
    return `M ${number(x + a[0])} ${number(y)} H ${number(x + w - b[0])} ${arc(b, x + w, y + b[1])} V ${number(y + h - c[1])} ${arc(c, x + w - c[0], y + h)} H ${number(x + d[0])} ${arc(d, x, y + h - d[1])} V ${number(y + a[1])} ${arc(a, x + a[0], y)} Z`;
  };
  const drawBox = (element: HTMLElement, target: SVGElement, style: CSSStyleDeclaration) => {
    const rect = rectangle(element);
    if (!rect.width || !rect.height) return;
    const shape = roundedPath(rect.x, rect.y, rect.width, rect.height, style);
    const fill = svgColor(style.backgroundColor || 'transparent');
    const borders = ['top', 'right', 'bottom', 'left']
      .map((side) => ({
        side,
        width: (parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0) * zoom,
        color: svgColor(style.getPropertyValue(`border-${side}-color`)),
        style: style.getPropertyValue(`border-${side}-style`),
      }))
      .filter((border) => border.width > 0 && border.style !== 'none');
    const base = [...borders].sort((a, b) => a.width - b.width)[0];
    if (!base && /^(?:transparent|rgba\([^)]*,\s*0\))$/.test(fill)) return;
    const path = create('path', { d: shape, fill });
    if (base) {
      path.setAttribute('stroke', base.color);
      path.setAttribute('stroke-width', String(base.width));
      if (base.style === 'dashed' || base.style === 'dotted')
        path.setAttribute(
          'stroke-dasharray',
          base.style === 'dashed' ? `${5 * zoom} ${4 * zoom}` : `${zoom} ${3 * zoom}`,
        );
    }
    // Skewed input/output cards have counter-skewed content.
    const matrix = style.transform
      .match(/^matrix\(([^)]+)\)$/)?.[1]
      .split(',')
      .map(Number);
    if (matrix && (matrix[1] || matrix[2]) && element.offsetWidth && element.offsetHeight) {
      const corners = [
        [0, 0],
        [element.offsetWidth, 0],
        [element.offsetWidth, element.offsetHeight],
        [0, element.offsetHeight],
      ].map(([x, y]) => [matrix[0] * x + matrix[2] * y, matrix[1] * x + matrix[3] * y]);
      const left = Math.min(...corners.map(([x]) => x)),
        top = Math.min(...corners.map(([, y]) => y));
      const sx = rect.width / (Math.max(...corners.map(([x]) => x)) - left);
      const sy = rect.height / (Math.max(...corners.map(([, y]) => y)) - top);
      path.setAttribute(
        'd',
        corners
          .map(
            ([x, y], i) =>
              `${i ? 'L' : 'M'} ${number(rect.x + (x - left) * sx)} ${number(rect.y + (y - top) * sy)}`,
          )
          .join(' ') + ' Z',
      );
    }
    target.append(path);
    for (const border of borders) {
      if (
        border.width === base?.width &&
        border.color === base?.color &&
        border.style === base?.style
      )
        continue;
      const { x, y, width: w, height: h } = rect;
      const inset = border.width / 2;
      const coordinates: Record<string, number[]> = {
        top: [x, y + inset, x + w, y + inset],
        right: [x + w - inset, y, x + w - inset, y + h],
        bottom: [x, y + h - inset, x + w, y + h - inset],
        left: [x + inset, y, x + inset, y + h],
      };
      const [x1, y1, x2, y2] = coordinates[border.side];
      target.append(
        create('line', { x1, y1, x2, y2, stroke: border.color, 'stroke-width': border.width }),
      );
    }
    if (element.dataset.nodeStatus === 'done' && element.matches('.vn-node,.mindmap-topic'))
      target.append(
        create('path', {
          d: roundedPath(
            rect.x + 2 * zoom,
            rect.y + 2 * zoom,
            rect.width - 4 * zoom,
            rect.height - 4 * zoom,
            style,
          ),
          fill: 'none',
          stroke: svgColor(style.getPropertyValue('--status-done-border').trim()),
          'stroke-width': 2 * zoom,
        }),
      );
  };
  const drawText = (text: Text, target: SVGElement, style: CSSStyleDeclaration) => {
    const range = document.createRange();
    const runs: { text: string; x: number; y: number }[] = [];
    let offset = 0;
    for (const character of Array.from(text.data)) {
      range.setStart(text, offset);
      offset += character.length;
      range.setEnd(text, offset);
      const rect = range.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        // A collapsed space at a wrapped line end has no painted rectangle,
        // but it still separates the words in editable/exported text.
        const previous = runs.at(-1);
        if (previous && /\s/u.test(character)) previous.text += character;
        continue;
      }
      const x = rect.left - origin.left,
        y = rect.top - origin.top;
      const previous = runs.at(-1);
      if (previous && Math.abs(previous.y - y) < 0.5) previous.text += character;
      else runs.push({ text: character, x, y });
    }
    range.detach();
    for (const run of runs) {
      const label = create('text', {
        x: number(run.x),
        y: number(run.y),
        fill: svgColor(style.color),
        'dominant-baseline': 'text-before-edge',
        'xml:space': 'preserve',
      });
      for (const property of [
        'font-family',
        'font-size',
        'font-weight',
        'font-style',
        'letter-spacing',
        'text-decoration',
      ]) {
        const value = style.getPropertyValue(property);
        if (value)
          label.setAttribute(
            property,
            ['font-size', 'letter-spacing'].includes(property) && Number.isFinite(parseFloat(value))
              ? `${parseFloat(value) * zoom}px`
              : value,
          );
      }
      label.textContent = xmlText(
        style.textTransform === 'uppercase'
          ? run.text.toUpperCase()
          : style.textTransform === 'lowercase'
            ? run.text.toLowerCase()
            : run.text,
      );
      target.append(label);
    }
  };
  const visit = (element: Element, target: SVGElement) => {
    if (element.matches(excluded)) return;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
    if (element instanceof SVGElement) {
      const copied = copySVG(element);
      const rect = rectangle(element);
      if (!copied || !rect.width || !rect.height) return;
      copied.querySelectorAll('defs').forEach((child) => child.remove());
      copied.setAttribute('x', number(rect.x));
      copied.setAttribute('y', number(rect.y));
      copied.setAttribute('width', number(rect.width));
      copied.setAttribute('height', number(rect.height));
      if (!copied.hasAttribute('viewBox'))
        copied.setAttribute(
          'viewBox',
          `0 0 ${parseFloat(style.width) || rect.width} ${parseFloat(style.height) || rect.height}`,
        );
      copied.setAttribute('overflow', 'visible');
      target.append(copied);
      return;
    }
    if (!(element instanceof HTMLElement)) return;
    const group = create('g');
    if (element.dataset.nodeId) group.setAttribute('data-node-id', element.dataset.nodeId);
    if (style.opacity && style.opacity !== '1') group.setAttribute('opacity', style.opacity);
    drawBox(element, group, style);
    if (
      ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflow) ||
      ['hidden', 'clip'].includes(style.overflowY)
    ) {
      const rect = rectangle(element),
        id = `vn-vector-clip-${++clipIndex}`;
      const clip = create('clipPath', { id });
      clip.append(create('rect', rect));
      defs.append(clip);
      const content = create('g', { 'clip-path': `url(#${id})` });
      group.append(content);
      target.append(group);
      for (const child of element.childNodes) {
        if (child instanceof Text) drawText(child, content, style);
        else if (child instanceof Element) visit(child, content);
      }
      return;
    }
    for (const child of element.childNodes) {
      if (child instanceof Text) drawText(child, group, style);
      else if (child instanceof Element) visit(child, group);
    }
    target.append(group);
  };
  // Group frames sit below relationships; pen marks sit above all cards.
  const layers = Array.from(
    flow.querySelectorAll('.react-flow__node,.react-flow__edges,.drawing-layer'),
  );
  layers.sort(
    (a, b) =>
      (parseInt(getComputedStyle(a).zIndex) || 0) - (parseInt(getComputedStyle(b).zIndex) || 0),
  );
  for (const layer of layers) visit(layer, root);
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(root);
  if (new TextEncoder().encode(xml).byteLength > svgLimits.bytes)
    throw new Error('SVG exceeds the 16 MiB file limit. Export a smaller selection.');
  return xml;
}
