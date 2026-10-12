import { assignNotationCompartments } from './compartments';
import { getNotationSymbol } from './registry';
import { getIbmSymbol } from '../flowchart/ibm-symbols';
import type {
  BpmnProperties,
  NodeNotation,
  NotationAnchor,
  NotationCompartmentBox,
  NotationGeometry,
  NotationPoint,
  NotationRect,
  NotationSide,
  UmlProperties,
} from './types';
const rect: readonly NotationPoint[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const number = (value: number) => String(Math.round(value * 10000) / 10000);
export function notationPath(points: readonly NotationPoint[], close = true): string {
  return (
    points.map(([x, y], i) => `${i ? 'L' : 'M'} ${number(x * 100)} ${number(y * 100)}`).join(' ') +
    (close ? ' Z' : '')
  );
}
function ellipse(cx = 0.5, cy = 0.5, rx = 0.5, ry = 0.5, count = 64): NotationPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / count;
    return [
      Math.max(0, Math.min(1, cx + rx * Math.cos(angle))),
      Math.max(0, Math.min(1, cy + ry * Math.sin(angle))),
    ] as const;
  });
}
function rounded(inset = 0, radius = 0.1): NotationPoint[] {
  const points: NotationPoint[] = [];
  for (const [cx, cy, start] of [
    [1 - inset - radius, inset + radius, -Math.PI / 2],
    [1 - inset - radius, 1 - inset - radius, 0],
    [inset + radius, 1 - inset - radius, Math.PI / 2],
    [inset + radius, inset + radius, Math.PI],
  ])
    for (let step = 0; step <= 8; step++) {
      const angle = start + (step * Math.PI) / 16;
      points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
    }
  return points;
}
function regular(
  sides: number,
  cx = 0.5,
  cy = 0.5,
  r = 0.3,
  start = -Math.PI / 2,
): NotationPoint[] {
  return Array.from({ length: sides }, (_, i) => [
    cx + r * Math.cos(start + (i * 2 * Math.PI) / sides),
    cy + r * Math.sin(start + (i * 2 * Math.PI) / sides),
  ]);
}
function gear(cx: number, cy: number, rx: number, ry: number): NotationPoint[] {
  return Array.from({ length: 32 }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI) / 16,
      radius = Math.floor(index / 2) % 2 === 0 ? 1 : 0.72;
    return [cx + rx * radius * Math.cos(angle), cy + ry * radius * Math.sin(angle)];
  });
}
const box = (x: number, y: number, width: number, height: number): NotationRect => ({
  x,
  y,
  width,
  height,
});
function rectangle(x: number, y: number, w: number, h: number) {
  return notationPath([
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ]);
}
function ribbon(points: readonly NotationPoint[], thickness = 0.02): NotationPoint[] {
  const a = points[0],
    b = points[points.length - 1],
    length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1,
    dx = (-(b[1] - a[1]) * thickness) / 2 / length,
    dy = ((b[0] - a[0]) * thickness) / 2 / length;
  return [
    [a[0] + dx, a[1] + dy],
    [b[0] + dx, b[1] + dy],
    [b[0] - dx, b[1] - dy],
    [a[0] - dx, a[1] - dy],
  ].map(([x, y]) => [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))] as const);
}
/** Scale our trusted absolute SVG commands; imported/user paths never enter this function. */
function scalePathY(path: string, scale: number): string {
  return path
    .replace(/[A-Z][^A-Z]*/g, (segment) => {
      const command = segment[0],
        values = segment
          .slice(1)
          .trim()
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(Number);
      if (command === 'Z') return 'Z';
      const size =
        command === 'A'
          ? 7
          : command === 'C'
            ? 6
            : command === 'Q' || command === 'S'
              ? 4
              : command === 'H' || command === 'V'
                ? 1
                : 2;
      for (let i = 0; i < values.length; i++) {
        const component = i % size;
        if (
          command === 'V' ||
          (command === 'A' && (component === 1 || component === 6)) ||
          (command !== 'H' && command !== 'A' && component % 2 === 1)
        )
          values[i] *= scale;
      }
      return `${command} ${values.map(number).join(' ')} `;
    })
    .trim();
}
/** Intersect a ray at a fractional side position with the actual normalized contour. */
export function notationContourPoint(
  outline: readonly NotationPoint[],
  side: NotationSide,
  offset = 0.5,
): NotationPoint {
  const horizontal = side === 'left' || side === 'right',
    hits: number[] = [];
  const axis = outline.map((point) => (horizontal ? point[1] : point[0])),
    minimum = Math.min(...axis),
    maximum = Math.max(...axis);
  offset = minimum + (maximum - minimum) * offset;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i],
      b = outline[(i + 1) % outline.length],
      aa = horizontal ? a[1] : a[0],
      bb = horizontal ? b[1] : b[0];
    if (Math.abs(aa - bb) < 1e-10) {
      if (Math.abs(offset - aa) < 1e-10)
        hits.push(horizontal ? a[0] : a[1], horizontal ? b[0] : b[1]);
    } else if (offset >= Math.min(aa, bb) - 1e-10 && offset <= Math.max(aa, bb) + 1e-10) {
      const t = (offset - aa) / (bb - aa);
      hits.push(horizontal ? a[0] + t * (b[0] - a[0]) : a[1] + t * (b[1] - a[1]));
    }
  }
  const coordinate = hits.length
    ? side === 'left' || side === 'top'
      ? Math.min(...hits)
      : Math.max(...hits)
    : side === 'left' || side === 'top'
      ? 0
      : 1;
  return horizontal ? [coordinate, offset] : [offset, coordinate];
}
export function notationGeometry(value: NodeNotation): NotationGeometry {
  const symbol = getNotationSymbol(value.collection, value.symbol);
  if (!symbol) throw new Error(`Unknown notation symbol ${value.collection}:${value.symbol}`);
  let outline: readonly NotationPoint[] = rect,
    outlinePath = notationPath(rect),
    contentBox = box(0.08, 0.12, 0.84, 0.76),
    outlineFill: NotationGeometry['outlineFill'] = 'background',
    stroke: NotationGeometry['stroke'] = 'solid',
    strokeWidth = 1.5;
  let titleStyle: NotationGeometry['titleStyle'] = 'normal';
  let guardBox: NotationRect | undefined;
  let prefixBox: NotationRect | undefined;
  let titleRotation: -90 | undefined;
  const detailPaths: string[] = [],
    filledPaths: string[] = [],
    shadedPaths: string[] = [],
    contrastPaths: string[] = [],
    dashedPaths: string[] = [],
    reliefContours: (readonly NotationPoint[])[] = [];
  const compartmentBoxes: NotationCompartmentBox[] = [];
  const props = value.properties as
    | (BpmnProperties & UmlProperties & { detail?: string })
    | undefined;
  const set = (points: readonly NotationPoint[]) => {
    outline = points;
    outlinePath = notationPath(points);
  };
  switch (symbol.geometry) {
    case 'rectangle':
      break;
    case 'rounded':
    case 'call-activity':
    case 'transaction':
    case 'dashed-rounded':
      set(rounded());
      if (symbol.geometry === 'dashed-rounded') stroke = 'dashed';
      if (symbol.geometry === 'call-activity') strokeWidth = 4;
      if (symbol.geometry === 'transaction') detailPaths.push(notationPath(rounded(0.055, 0.08)));
      break;
    case 'circle':
    case 'ellipse':
    case 'double-circle':
    case 'end-circle':
    case 'filled-circle':
    case 'bullseye':
    case 'cross-circle':
    case 'history':
    case 'deep-history':
    case 'dashed-ellipse':
      set(ellipse());
      contentBox = box(0.2, 0.24, 0.6, 0.52);
      if (symbol.geometry === 'dashed-ellipse') stroke = 'dashed';
      if (symbol.geometry === 'end-circle') strokeWidth = 4;
      if (symbol.geometry === 'double-circle' || symbol.geometry === 'bullseye')
        detailPaths.push(notationPath(ellipse(0.5, 0.5, 0.42, 0.42)));
      if (symbol.geometry === 'filled-circle') outlineFill = 'foreground';
      if (symbol.geometry === 'bullseye')
        filledPaths.push(notationPath(ellipse(0.5, 0.5, 0.32, 0.32)));
      if (symbol.geometry === 'cross-circle') detailPaths.push('M 28 28 L 72 72 M 72 28 L 28 72');
      if (symbol.geometry === 'history' || symbol.geometry === 'deep-history') {
        detailPaths.push('M 30 28 V 72 M 65 28 V 72 M 30 50 H 65');
        if (symbol.geometry === 'deep-history')
          detailPaths.push('M 79 28 V 48 M 69 38 H 89 M 72 31 L 86 45 M 86 31 L 72 45');
      }
      break;
    case 'diamond':
    case 'exclusive-gateway':
    case 'inclusive-gateway':
    case 'parallel-gateway':
    case 'complex-gateway':
    case 'event-based-gateway':
      set([
        [0.5, 0],
        [1, 0.5],
        [0.5, 1],
        [0, 0.5],
      ]);
      contentBox = box(0.26, 0.31, 0.48, 0.38);
      break;
    case 'hexagon':
      set([
        [0.2, 0],
        [0.8, 0],
        [1, 0.5],
        [0.8, 1],
        [0.2, 1],
        [0, 0.5],
      ]);
      contentBox = box(0.22, 0.14, 0.56, 0.72);
      break;
    case 'document': {
      const points: NotationPoint[] = [
        [0, 0],
        [1, 0],
        [1, 0.89],
      ];
      for (let i = 1; i <= 24; i++) {
        const x = 1 - i / 24;
        points.push([x, 0.89 + 0.08 * Math.sin(x * Math.PI * 2)]);
      }
      set(points);
      contentBox = box(0.08, 0.12, 0.84, 0.65);
      break;
    }
    case 'manual-input':
      set([
        [0, 0.2],
        [1, 0],
        [1, 1],
        [0, 1],
      ]);
      contentBox = box(0.08, 0.3, 0.84, 0.6);
      break;
    case 'display':
      set([
        [0.15, 0],
        [0.86, 0],
        [0.96, 0.15],
        [1, 0.5],
        [0.96, 0.85],
        [0.86, 1],
        [0.15, 1],
        [0, 0.5],
      ]);
      contentBox = box(0.2, 0.16, 0.64, 0.68);
      break;
    case 'cylinder': {
      const points: NotationPoint[] = [];
      for (let i = 0; i <= 24; i++) {
        const a = Math.PI + (i * Math.PI) / 24;
        points.push([0.5 + 0.5 * Math.cos(a), 0.15 + 0.15 * Math.sin(a)]);
      }
      for (let i = 0; i <= 24; i++) {
        const a = (i * Math.PI) / 24;
        points.push([0.5 + 0.5 * Math.cos(a), 0.85 + 0.15 * Math.sin(a)]);
      }
      set(points);
      detailPaths.push('M 0 15 C 0 35 100 35 100 15');
      contentBox = box(0.1, 0.32, 0.8, 0.48);
      break;
    }
    case 'hipo-module':
    case 'hipo-reference':
      detailPaths.push('M 0 24 H 100');
      prefixBox = box(0.07, 0.025, 0.86, 0.18);
      contentBox = box(0.08, 0.3, 0.84, 0.6);
      if (symbol.geometry === 'hipo-reference')
        detailPaths.push(rectangle(0.045, 0.045, 0.91, 0.91));
      break;
    case 'hipo-ipo': {
      const detail = props?.detail === 'detail' || value.diagramKind === 'detail-ipo';
      detailPaths.push(
        'M 0 20 H 100',
        `M 33.333 20 V ${detail ? 72 : 100} M 66.667 20 V ${detail ? 72 : 100}`,
      );
      if (detail) detailPaths.push('M 0 72 H 100');
      contentBox = box(0.04, 0.025, 0.76, 0.15);
      prefixBox = box(0.82, 0.025, 0.15, 0.15);
      for (const [index, id] of ['input', 'process', 'output'].entries())
        compartmentBoxes.push({
          id,
          ...box(index / 3 + 0.015, 0.225, 1 / 3 - 0.03, detail ? 0.43 : 0.745),
        });
      if (detail)
        compartmentBoxes.push({ id: 'extended-description', ...box(0.02, 0.745, 0.96, 0.23) });
      break;
    }
    case 'dfd-process':
      set(rounded());
      detailPaths.push('M 0 25 H 100');
      prefixBox = box(0.08, 0.025, 0.84, 0.18);
      contentBox = box(0.08, 0.32, 0.84, 0.56);
      break;
    case 'open-store':
    case 'duplicate-open-store':
      outlineFill = 'none';
      outlinePath = 'M 0 0 H 100 M 0 100 H 100';
      contentBox = box(0.05, 0.15, 0.9, 0.7);
      reliefContours.push(
        [
          [0, 0],
          [1, 0],
          [1, 0.025],
          [0, 0.025],
        ],
        [
          [0, 0.975],
          [1, 0.975],
          [1, 1],
          [0, 1],
        ],
      );
      if (symbol.geometry === 'duplicate-open-store') detailPaths.push('M 0 8 H 100');
      break;
    case 'dfd-store':
    case 'duplicate-dfd-store':
      outlineFill = 'none';
      outlinePath = 'M 100 0 H 0 V 100 H 100 M 20 0 V 100';
      contentBox = box(0.26, 0.12, 0.68, 0.76);
      prefixBox = box(0.025, 0.12, 0.15, 0.76);
      reliefContours.push(
        [
          [0, 0],
          [1, 0],
          [1, 0.025],
          [0.025, 0.025],
          [0.025, 0.975],
          [1, 0.975],
          [1, 1],
          [0, 1],
        ],
        [
          [0.19, 0],
          [0.21, 0],
          [0.21, 1],
          [0.19, 1],
        ],
      );
      if (symbol.geometry === 'duplicate-dfd-store') detailPaths.push('M 6 0 V 100');
      break;
    case 'duplicate-entity':
      detailPaths.push('M 0 20 L 20 0');
      break;
    case 'note':
    case 'artifact':
      set([
        [0, 0],
        [0.8, 0],
        [1, 0.2],
        [1, 1],
        [0, 1],
      ]);
      detailPaths.push('M 80 0 V 20 H 100');
      contentBox = box(0.08, 0.26, 0.84, 0.66);
      break;
    case 'uml-class':
    case 'uml-object':
    case 'uml-component':
      if (symbol.geometry === 'uml-object') titleStyle = 'underlined';
      if (symbol.geometry === 'uml-component')
        detailPaths.push(
          rectangle(0.78, 0.08, 0.14, 0.2),
          rectangle(0.73, 0.11, 0.1, 0.05),
          rectangle(0.73, 0.2, 0.1, 0.05),
        );
      contentBox = box(0.06, 0.05, 0.88, 0.9);
      break;
    case 'uml-template': {
      set([
        [0, 0.14],
        [0.55, 0.14],
        [0.55, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]);
      outlinePath = rectangle(0, 0.14, 1, 0.86);
      dashedPaths.push(rectangle(0.55, 0, 0.45, 0.28));
      contentBox = box(0.04, 0.17, 0.46, 0.14);
      const sections = value.compartments ?? [];
      const parameters = sections.find((section) => section.id === 'parameters') ?? sections[0];
      if (parameters)
        compartmentBoxes.push({ id: parameters.id, ...box(0.565, 0.015, 0.42, 0.25) });
      const body = sections.filter((section) => section !== parameters);
      const available = 0.61 / Math.max(1, body.length);
      const padding = Math.min(0.015, available / 5);
      for (const [index, section] of body.entries()) {
        const y = 0.35 + index * available;
        detailPaths.push(`M 0 ${number(y * 100)} H 100`);
        compartmentBoxes.push({
          id: section.id,
          ...box(0.04, y + padding, 0.92, available - padding * 2),
        });
      }
      break;
    }
    case 'package':
      set([
        [0, 0],
        [0.36, 0],
        [0.36, 0.16],
        [1, 0.16],
        [1, 1],
        [0, 1],
      ]);
      detailPaths.push('M 0 16 H 36');
      contentBox = box(0.08, 0.23, 0.84, 0.7);
      break;
    case 'uml-node':
      set([
        [0, 0.14],
        [0.16, 0],
        [1, 0],
        [1, 0.86],
        [0.84, 1],
        [0, 1],
      ]);
      detailPaths.push('M 0 14 H 84 V 100 M 84 14 L 100 0');
      contentBox = box(0.08, 0.24, 0.68, 0.65);
      break;
    case 'provided-interface':
      set(ellipse(0.5, 0.4, 0.3, 0.3));
      detailPaths.push('M 50 70 V 100');
      contentBox = box(0.2, 0.15, 0.6, 0.45);
      reliefContours.push(
        ellipse(0.5, 0.4, 0.3, 0.3),
        ribbon([
          [0.5, 0.7],
          [0.5, 1],
        ]),
      );
      break;
    case 'required-interface':
      outlineFill = 'none';
      outlinePath = 'M 80 10 A 36 36 0 0 0 80 82 M 44 46 H 0';
      contentBox = box(0.48, 0.2, 0.46, 0.5);
      for (let i = 0; i < 24; i++) {
        const a = Math.PI / 2 + (i * Math.PI) / 24,
          b = Math.PI / 2 + ((i + 1) * Math.PI) / 24;
        reliefContours.push(
          ribbon([
            [0.8 + 0.36 * Math.cos(a), 0.46 + 0.36 * Math.sin(a)],
            [0.8 + 0.36 * Math.cos(b), 0.46 + 0.36 * Math.sin(b)],
          ]),
        );
      }
      reliefContours.push(
        ribbon([
          [0, 0.46],
          [0.44, 0.46],
        ]),
      );
      break;
    case 'actor': {
      outlineFill = 'none';
      outlinePath = notationPath(ellipse(0.5, 0.13, 0.13, 0.13));
      detailPaths.push('M 50 26 V 58 M 20 40 H 80 M 50 58 L 20 80 M 50 58 L 80 80');
      reliefContours.push(
        ellipse(0.5, 0.13, 0.13, 0.13),
        ...[
          [
            [0.5, 0.26],
            [0.5, 0.58],
          ],
          [
            [0.2, 0.4],
            [0.8, 0.4],
          ],
          [
            [0.5, 0.58],
            [0.2, 0.8],
          ],
          [
            [0.5, 0.58],
            [0.8, 0.8],
          ],
        ].map((points) => ribbon(points as unknown as NotationPoint[])),
      );
      contentBox = box(0.02, 0.83, 0.96, 0.16);
      break;
    }
    case 'expansion-node':
      detailPaths.push('M 25 0 V 100 M 50 0 V 100 M 75 0 V 100');
      break;
    case 'bar':
      outlineFill = 'foreground';
      break;
    case 'lane': {
      const horizontal = props?.orientation === 'horizontal',
        stripe = value.symbol === 'pool' ? 0.04 : 0.06;
      detailPaths.push(horizontal ? 'M 0 18 H 100' : `M ${stripe * 100} 0 V 100`);
      contentBox = horizontal ? box(0.03, 0.02, 0.94, 0.13) : box(0.005, 0.12, stripe - 0.01, 0.76);
      if (!horizontal) titleRotation = -90;
      break;
    }
    case 'send-signal':
      set([
        [0, 0],
        [0.75, 0],
        [1, 0.5],
        [0.75, 1],
        [0, 1],
      ]);
      contentBox = box(0.06, 0.14, 0.67, 0.72);
      break;
    case 'accept-event':
      set([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0.25, 0.5],
      ]);
      contentBox = box(0.3, 0.14, 0.64, 0.72);
      break;
    case 'hourglass':
      set([
        [0, 0],
        [1, 0],
        [0.5, 0.5],
        [1, 1],
        [0, 1],
        [0.5, 0.5],
      ]);
      contentBox = box(0.1, 0.06, 0.8, 0.22);
      reliefContours.push(
        [
          [0, 0],
          [1, 0],
          [0.5, 0.5],
        ],
        [
          [0.5, 0.5],
          [1, 1],
          [0, 1],
        ],
      );
      break;
    case 'cross':
      outlineFill = 'none';
      outlinePath = 'M 10 10 L 90 90 M 90 10 L 10 90';
      reliefContours.push(
        ribbon(
          [
            [0.1, 0.1],
            [0.9, 0.9],
          ],
          0.055,
        ),
        ribbon(
          [
            [0.9, 0.1],
            [0.1, 0.9],
          ],
          0.055,
        ),
      );
      contentBox = box(0.1, 0.03, 0.8, 0.12);
      break;
    case 'lifeline':
      outlineFill = 'none';
      outlinePath = rectangle(0, 0, 1, 0.18);
      dashedPaths.push('M 50 18 V 100');
      reliefContours.push(
        [
          [0, 0],
          [1, 0],
          [1, 0.18],
          [0, 0.18],
        ],
        ribbon(
          [
            [0.5, 0.18],
            [0.5, 1],
          ],
          0.012,
        ),
      );
      contentBox = box(0.06, 0.02, 0.88, 0.14);
      break;
    case 'interaction-frame':
      detailPaths.push('M 0 18 H 23 L 30 10 V 0');
      prefixBox = box(0.04, 0.025, 0.2, 0.12);
      contentBox =
        value.symbol === 'interaction-use'
          ? box(0.04, 0.24, 0.92, 0.5)
          : box(0.34, 0.025, 0.62, 0.12);
      if (value.symbol === 'combined-fragment') guardBox = box(0.34, 0.15, 0.62, 0.08);
      break;
    case 'timing-lifeline': {
      outlineFill = 'none';
      outlinePath = 'M 20 0 V 100 H 100';
      contentBox = box(0.01, 0.02, 0.17, 0.2);
      reliefContours.push(
        ribbon([
          [0.2, 0],
          [0.2, 1],
        ]),
        ribbon([
          [0.2, 1],
          [1, 1],
        ]),
      );
      const states = props?.timingStates ?? [];
      if (states.length) {
        const names = [...new Set(states.map((point) => point.state))],
          start = props?.timeStart ?? states[0].time,
          end = props?.timeEnd ?? states[states.length - 1].time,
          range = Math.max(1, end - start),
          x = (time: number) => 0.2 + (0.8 * (time - start)) / range,
          y = (state: string) => 0.2 + (0.6 * names.indexOf(state)) / Math.max(1, names.length - 1);
        const points: NotationPoint[] = [[x(states[0].time), y(states[0].state)]];
        for (let i = 1; i < states.length; i++)
          points.push(
            [x(states[i].time), y(states[i - 1].state)],
            [x(states[i].time), y(states[i].state)],
          );
        points.push([1, y(states[states.length - 1].state)]);
        detailPaths.push(notationPath(points, false));
        for (let i = 1; i < points.length; i++)
          reliefContours.push(ribbon([points[i - 1], points[i]], 0.012));
      }
      for (const [index, section] of (value.compartments ?? []).entries())
        compartmentBoxes.push({
          id: section.id,
          ...box(
            0.015,
            0.25 + (index * 0.6) / Math.max(1, value.compartments!.length),
            0.16,
            0.6 / Math.max(1, value.compartments!.length),
          ),
        });
      break;
    }
    case 'annotation':
      outlineFill = 'none';
      outlinePath = 'M 20 0 H 0 V 100 H 20';
      contentBox = box(0.08, 0.1, 0.88, 0.8);
      reliefContours.push([
        [0, 0],
        [0.2, 0],
        [0.2, 0.025],
        [0.025, 0.025],
        [0.025, 0.975],
        [0.2, 0.975],
        [0.2, 1],
        [0, 1],
      ]);
      break;
    case 'constraint':
      outlineFill = 'none';
      if (value.symbol === 'time-observation' || value.symbol === 'duration-observation') {
        outlinePath = 'M 0 80 H 100';
        contentBox = box(0.08, 0.12, 0.84, 0.58);
        reliefContours.push(
          ribbon([
            [0, 0.8],
            [1, 0.8],
          ]),
        );
        break;
      }
      outlinePath =
        value.symbol === 'operand-guard'
          ? 'M 12 10 H 4 V 90 H 12 M 88 10 H 96 V 90 H 88'
          : 'M 12 10 Q 4 10 4 30 V 42 Q 4 50 0 50 Q 4 50 4 58 V 70 Q 4 90 12 90 M 88 10 Q 96 10 96 30 V 42 Q 96 50 100 50 Q 96 50 96 58 V 70 Q 96 90 88 90';
      contentBox = box(0.16, 0.14, 0.68, 0.72);
      reliefContours.push(
        ribbon([
          [0.04, 0.1],
          [0.04, 0.9],
        ]),
        ribbon([
          [0.96, 0.1],
          [0.96, 0.9],
        ]),
      );
      break;
    case 'lightning':
      set([
        [0.65, 0],
        [0.2, 0.5],
        [0.5, 0.5],
        [0.35, 1],
        [0.8, 0.4],
        [0.55, 0.4],
      ]);
      outlineFill = 'foreground';
      contentBox = box(0.05, 0.02, 0.25, 0.15);
      break;
    case 'envelope':
      detailPaths.push('M 0 0 L 50 50 L 100 0');
      contentBox = box(0.1, 0.6, 0.8, 0.28);
      break;
    case 'choreography':
      set(rounded(0.0, 0.05));
      detailPaths.push('M 0 24 H 100 M 0 76 H 100');
      contentBox = box(0.06, 0.28, 0.88, 0.2);
      compartmentBoxes.push(
        {
          id:
            props?.participant === 'non-initiating'
              ? 'other-participant'
              : 'initiating-participant',
          ...box(0.06, 0.025, 0.88, 0.18),
        },
        { id: 'activity', ...box(0.06, 0.51, 0.88, 0.21) },
        {
          id:
            props?.participant === 'non-initiating'
              ? 'initiating-participant'
              : 'other-participant',
          ...box(0.06, 0.8, 0.88, 0.18),
        },
      );
      shadedPaths.push(
        props?.participant === 'non-initiating'
          ? rectangle(0, 0, 1, 0.24)
          : rectangle(0, 0.76, 1, 0.24),
      );
      if (value.symbol === 'call-choreography') strokeWidth = 4;
      break;
    default: {
      const classic = symbol.geometry.startsWith('classic-')
        ? getIbmSymbol(`ibm-${symbol.geometry.slice(8)}`)
        : undefined;
      if (!classic) throw new Error(`Geometry implementation missing: ${symbol.geometry}`);
      outline = classic.outline;
      outlinePath = classic.outlinePath;
      detailPaths.push(...classic.detailPaths);
      contentBox = classic.contentBox;
      break;
    }
  }
  if (
    value.collection === 'bpmn' &&
    value.symbol === 'participant-band' &&
    props?.participant === 'non-initiating'
  )
    shadedPaths.push(rectangle(0, 0, 1, 1));
  if (value.collection === 'uml' && props?.abstract) titleStyle = 'italic';
  if (
    value.collection === 'uml' &&
    [
      'port',
      'input-pin',
      'output-pin',
      'expansion-node',
      'initial-node',
      'initial-state',
      'junction',
      'message-endpoint',
      'activation',
      'fork',
      'join',
      'fork-state',
      'join-state',
      'destruction',
      'terminate',
      'entry-point',
      'exit-point',
      'connection-point-reference',
      'exception-handler',
      'activity-final',
      'final-state',
      'flow-final',
      'shallow-history',
      'deep-history',
    ].includes(value.symbol)
  )
    titleStyle = 'hidden';
  if (value.collection === 'bpmn') {
    if (value.symbol === 'exclusive-gateway') detailPaths.push('M 35 35 L 65 65 M 65 35 L 35 65');
    if (value.symbol === 'inclusive-gateway')
      detailPaths.push(notationPath(ellipse(0.5, 0.5, 0.22, 0.22)));
    if (value.symbol === 'parallel-gateway') detailPaths.push('M 50 27 V 73 M 27 50 H 73');
    if (value.symbol === 'complex-gateway')
      detailPaths.push('M 50 25 V 75 M 25 50 H 75 M 32 32 L 68 68 M 68 32 L 32 68');
    if (value.symbol === 'event-based-gateway') {
      detailPaths.push(notationPath(ellipse(0.5, 0.5, 0.26, 0.26)));
      if (!props?.instantiating) detailPaths.push(notationPath(ellipse(0.5, 0.5, 0.21, 0.21)));
      detailPaths.push(
        props?.parallel ? 'M 50 35 V 65 M 35 50 H 65' : notationPath(regular(5, 0.5, 0.5, 0.14)),
      );
    }
    if (value.symbol.endsWith('event')) {
      if (props?.nonInterrupting) {
        stroke = 'dashed';
        if (symbol.geometry === 'double-circle') dashedPaths.push(detailPaths.shift()!);
      }
      const event =
        props?.eventDefinition ??
        (['boundary-event', 'intermediate-catch-event'].includes(value.symbol)
          ? 'message'
          : 'none');
      const throwing = value.symbol === 'end-event' || value.symbol === 'intermediate-throw-event';
      const closed = (d: string) => {
        (throwing ? filledPaths : detailPaths).push(d);
      };
      switch (event) {
        case 'none':
          break;
        case 'message':
          closed(rectangle(0.23, 0.32, 0.54, 0.36));
          (throwing ? contrastPaths : detailPaths).push('M 23 32 L 50 53 L 77 32');
          break;
        case 'timer':
          detailPaths.push(
            notationPath(ellipse(0.5, 0.5, 0.3, 0.3)),
            'M 50 24 V 31 M 76 50 H 69 M 50 76 V 69 M 24 50 H 31 M 50 34 V 50 L 65 58',
          );
          break;
        case 'error':
          closed(
            notationPath([
              [0.32, 0.23],
              [0.61, 0.38],
              [0.44, 0.48],
              [0.68, 0.77],
              [0.39, 0.6],
              [0.55, 0.51],
            ]),
          );
          break;
        case 'escalation':
          closed(
            notationPath([
              [0.25, 0.75],
              [0.5, 0.25],
              [0.75, 0.75],
              [0.5, 0.57],
            ]),
          );
          break;
        case 'cancel':
          detailPaths.push('M 30 30 L 70 70 M 70 30 L 30 70');
          break;
        case 'compensation':
          closed(
            notationPath([
              [0.47, 0.3],
              [0.23, 0.5],
              [0.47, 0.7],
            ]),
          );
          closed(
            notationPath([
              [0.75, 0.3],
              [0.51, 0.5],
              [0.75, 0.7],
            ]),
          );
          break;
        case 'conditional':
          detailPaths.push(
            rectangle(0.3, 0.23, 0.4, 0.54),
            'M 36 35 H 64 M 36 45 H 64 M 36 55 H 64 M 36 65 H 64',
          );
          break;
        case 'link':
          closed(
            notationPath([
              [0.25, 0.38],
              [0.55, 0.38],
              [0.55, 0.23],
              [0.78, 0.5],
              [0.55, 0.77],
              [0.55, 0.62],
              [0.25, 0.62],
            ]),
          );
          break;
        case 'signal':
          closed(
            notationPath([
              [0.5, 0.22],
              [0.78, 0.75],
              [0.22, 0.75],
            ]),
          );
          break;
        case 'terminate':
          filledPaths.push(notationPath(ellipse(0.5, 0.5, 0.33, 0.33)));
          break;
        case 'multiple':
          closed(notationPath(regular(5, 0.5, 0.5, 0.3)));
          break;
        case 'parallel-multiple':
          detailPaths.push('M 50 23 V 77 M 23 50 H 77');
          break;
      }
      // The model box includes an accessible label beneath the circular event.
      outline = outline.map(([x, y]) => [x, y * 0.625]);
      outlinePath = scalePathY(outlinePath, 0.625);
      for (let i = 0; i < detailPaths.length; i++)
        detailPaths[i] = scalePathY(detailPaths[i], 0.625);
      for (let i = 0; i < filledPaths.length; i++)
        filledPaths[i] = scalePathY(filledPaths[i], 0.625);
      for (let i = 0; i < dashedPaths.length; i++)
        dashedPaths[i] = scalePathY(dashedPaths[i], 0.625);
      for (let i = 0; i < contrastPaths.length; i++)
        contrastPaths[i] = scalePathY(contrastPaths[i], 0.625);
      contentBox = box(0.02, 0.65, 0.96, 0.35);
    }
    if (value.symbol === 'task') {
      switch (props?.taskType) {
        case 'send':
          filledPaths.push(rectangle(0.06, 0.08, 0.16, 0.15));
          contrastPaths.push('M 6 8 L 14 17 L 22 8');
          break;
        case 'receive':
          detailPaths.push(rectangle(0.06, 0.08, 0.16, 0.15), 'M 6 8 L 14 17 L 22 8');
          break;
        case 'service':
          detailPaths.push(
            notationPath(gear(0.14, 0.17, 0.044, 0.08)),
            notationPath(ellipse(0.14, 0.17, 0.018, 0.033)),
          );
          break;
        case 'user':
          detailPaths.push(
            notationPath(ellipse(0.14, 0.13, 0.045, 0.045)),
            'M 8 25 Q 14 13 20 25 Z',
          );
          break;
        case 'manual':
          detailPaths.push(
            'M 6 25 V 15 Q 7 12 9 15 V 9 Q 10 6 12 9 V 17 V 7 Q 14 4 15 7 V 17 V 10 Q 17 7 18 10 V 20 L 22 17 Q 25 17 23 20 L 18 27 H 10 Z',
          );
          break;
        case 'business-rule':
          detailPaths.push(rectangle(0.06, 0.07, 0.18, 0.2), 'M 6 13 H 24 M 6 20 H 24 M 12 7 V 27');
          break;
        case 'script':
          detailPaths.push(
            'M 9 7 H 24 Q 18 12 18 20 Q 18 27 8 27 H 5 Q 11 22 11 14 Q 11 7 9 7 Z M 13 12 H 19 M 13 17 H 18 M 11 22 H 16',
          );
          break;
      }
    }
    const marks: string[] = [];
    if (props?.loop === 'standard') marks.push('M 40 87 A 7 7 0 1 1 46 94 M 40 87 L 40 93 L 46 90');
    if (props?.loop === 'parallel-multi-instance')
      marks.push('M 42 83 V 96 M 50 83 V 96 M 58 83 V 96');
    if (props?.loop === 'sequential-multi-instance')
      marks.push('M 41 84 H 59 M 41 90 H 59 M 41 96 H 59');
    if (props?.compensation) marks.push('M 28 84 L 20 90 L 28 96 Z M 38 84 L 30 90 L 38 96 Z');
    if (props?.collapsed || value.symbol === 'sub-conversation')
      marks.push('M 72 82 H 88 V 98 H 72 Z M 80 85 V 95 M 75 90 H 85');
    if (value.symbol === 'ad-hoc-subprocess') marks.push('M 60 92 Q 64 84 68 92 T 76 92');
    if (props?.isCollection) marks.push('M 42 83 V 96 M 50 83 V 96 M 58 83 V 96');
    detailPaths.push(...marks);
    if (value.symbol === 'data-input')
      detailPaths.push('M 15 35 H 36 V 28 L 47 42 L 36 56 V 49 H 15 Z');
    if (value.symbol === 'data-output')
      filledPaths.push('M 15 35 H 36 V 28 L 47 42 L 36 56 V 49 H 15 Z');
    if (value.symbol === 'call-conversation') strokeWidth = 4;
    if (value.symbol.endsWith('-gateway')) {
      const scale = 100 / 148;
      outline = outline.map(([x, y]) => [x, y * scale]);
      outlinePath = scalePathY(outlinePath, scale);
      for (let i = 0; i < detailPaths.length; i++)
        detailPaths[i] = scalePathY(detailPaths[i], scale);
      for (let i = 0; i < filledPaths.length; i++)
        filledPaths[i] = scalePathY(filledPaths[i], scale);
      contentBox = box(0.02, 0.71, 0.96, 0.29);
    }
  }
  if (symbol.compartments && compartmentBoxes.length === 0 && value.compartments?.length) {
    const prefix =
      !!props?.stereotype ||
      (value.collection === 'uml' &&
        ['interface', 'enumeration', 'data-type', 'device', 'execution-environment'].includes(
          value.symbol,
        ));
    const header = prefix ? 0.3 : 0.25,
      available = (0.95 - header) / count(value.compartments.length);
    if (symbol.geometry !== 'interaction-frame')
      contentBox = box(contentBox.x, contentBox.y, contentBox.width, prefix ? 0.24 : 0.18);
    for (const [index, section] of value.compartments.entries()) {
      const y = header + index * available;
      detailPaths.push(`M 0 ${number(y * 100)} H 100`);
      compartmentBoxes.push({ id: section.id, ...box(0.05, y + 0.025, 0.9, available - 0.04) });
    }
  }
  if (symbol.geometry === 'hipo-ipo' || symbol.geometry === 'choreography')
    compartmentBoxes.splice(
      0,
      compartmentBoxes.length,
      ...assignNotationCompartments(compartmentBoxes, value.compartments),
    );
  const anchors = new Map<string, NotationAnchor>();
  const anchorPoint = (side: NotationSide, offset = 0.5): NotationPoint => {
    if (symbol.geometry === 'lifeline') {
      if (side === 'bottom') return [0.5, 1];
      if ((side === 'left' || side === 'right') && offset > 0.18) return [0.5, offset];
    }
    return notationContourPoint(outline, side, offset);
  };
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const [x, y] = anchorPoint(side);
    anchors.set(side, { id: side, x, y, side });
  }
  for (const port of value.ports ?? []) {
    const [x, y] = anchorPoint(port.side, port.offset);
    anchors.set(port.id, { id: port.id, x, y, side: port.side });
  }
  return {
    outline,
    outlinePath,
    detailPaths,
    filledPaths,
    shadedPaths,
    contrastPaths,
    dashedPaths,
    reliefContours: reliefContours.length ? reliefContours : undefined,
    compartmentBoxes: compartmentBoxes.length ? compartmentBoxes : undefined,
    contentBox,
    prefixBox,
    guardBox,
    titleRotation,
    anchors: [...anchors.values()],
    outlineFill,
    stroke,
    strokeWidth,
    titleStyle,
  };
}
const count = (value: number) => Math.max(1, value);
