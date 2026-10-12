import type { NodeKind } from '../model/types';

/** Normalized coordinates are shared by the canvas, vector export and spatial meshes. */
export type IBMPoint = readonly [number, number];
export interface IBMContentBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
const symbolIds = [
  'ibm-process',
  'ibm-annotation',
  'ibm-input-output',
  'ibm-connector',
  'ibm-offpage-connector',
  'ibm-decision',
  'ibm-preparation',
  'ibm-predefined-process',
  'ibm-terminal',
  'ibm-parallel-mode',
  'ibm-punched-card',
  'ibm-card-deck',
  'ibm-card-file',
  'ibm-document',
  'ibm-magnetic-tape',
  'ibm-transmittal-tape',
  'ibm-punched-tape',
  'ibm-online-storage',
  'ibm-keying',
  'ibm-magnetic-disk',
  'ibm-core',
  'ibm-magnetic-drum',
  'ibm-merge',
  'ibm-collate',
  'ibm-sort',
  'ibm-offline-storage',
  'ibm-extract',
  'ibm-display',
  'ibm-manual-input',
  'ibm-manual-operation',
  'ibm-auxiliary-operation',
  'ibm-communication-link',
  'ibm-sort-outline',
  'ibm-magnetic-tape-circle',
  'ibm-arrow-up',
  'ibm-arrow-down',
  'ibm-arrow-left',
  'ibm-arrow-right',
  'ibm-legacy-input-output',
  'ibm-legacy-predefined-process',
  'ibm-program-modification',
  'ibm-clerical-operation',
  'ibm-perforated-tape',
] as const;
export type IBMSymbolId = (typeof symbolIds)[number];
export type IBMStencilRevision = 'GX20-8020' | 'GX20-8020-1' | 'GX20-8020-2';
const originalCutouts: readonly IBMSymbolId[] = [
  'ibm-program-modification',
  'ibm-legacy-input-output',
  'ibm-process',
  'ibm-document',
  'ibm-auxiliary-operation',
  'ibm-online-storage',
  'ibm-keying',
  'ibm-legacy-predefined-process',
  'ibm-offpage-connector',
  'ibm-decision',
  'ibm-punched-card',
  'ibm-transmittal-tape',
  'ibm-perforated-tape',
  'ibm-manual-input',
  'ibm-terminal',
  'ibm-connector',
  'ibm-arrow-up',
  'ibm-arrow-down',
  'ibm-arrow-left',
  'ibm-arrow-right',
  'ibm-merge',
  'ibm-magnetic-tape-circle',
  'ibm-clerical-operation',
  'ibm-display',
  'ibm-communication-link',
];
export interface IBMSymbol {
  id: IBMSymbolId;
  label: string;
  nodeType: NodeKind;
  /** Exactly the 26 physical apertures of GX20-8020-1 and GX20-8020-2. */
  physicalCutout: boolean;
  category: 'symbol' | 'outline' | 'arrowhead' | 'legacy';
  construction: 'cutout' | 'composite' | 'drawn';
  /** Forms sharing this outline; historical names may differ and proportions are resizable. */
  revisions: readonly IBMStencilRevision[];
  outline: readonly IBMPoint[];
  /** Paths use a 0 0 100 100 viewBox, derived from the normalized geometry. */
  outlinePath: string;
  details: readonly (readonly IBMPoint[])[];
  detailPaths: readonly string[];
  contentBox: IBMContentBox;
}

const rect: IBMPoint[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const box: IBMContentBox = { x: 0.08, y: 0.12, width: 0.84, height: 0.76 };
const arc = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  start: number,
  end: number,
  steps = 24,
): IBMPoint[] =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const angle = start + ((end - start) * i) / steps;
    return [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)] as const;
  });
const curve = (start: IBMPoint, control: IBMPoint, end: IBMPoint, steps = 18): IBMPoint[] =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps,
      u = 1 - t;
    return [
      u * u * start[0] + 2 * u * t * control[0] + t * t * end[0],
      u * u * start[1] + 2 * u * t * control[1] + t * t * end[1],
    ] as const;
  });
const wave = (y: number, reverse = false): IBMPoint[] =>
  Array.from({ length: 33 }, (_, i) => {
    const x = reverse ? 1 - i / 32 : i / 32;
    return [x, y + 0.065 * Math.sin(x * Math.PI * 2)] as const;
  });
const circle = arc(0.5, 0.5, 0.5, 0.5, 0, 2 * Math.PI, 64).slice(0, -1);
const terminal = [
  ...arc(0.22, 0.5, 0.22, 0.5, Math.PI / 2, Math.PI * 1.5),
  ...arc(0.78, 0.5, 0.22, 0.5, -Math.PI / 2, Math.PI / 2),
];
const document = [[0, 0], [1, 0], ...wave(0.91, true)] as IBMPoint[];
const card: IBMPoint[] = [
  [0.09, 0],
  [1, 0],
  [1, 1],
  [0, 1],
  [0, 0.17],
];
const keying = [
  ...arc(0.12, 0.5, 0.12, 0.5, Math.PI / 2, Math.PI * 1.5),
  ...arc(0.88, 0.5, 0.12, 0.5, -Math.PI / 2, Math.PI / 2),
];
const diamond: IBMPoint[] = [
  [0.5, 0],
  [1, 0.5],
  [0.5, 1],
  [0, 0.5],
];
const merge: IBMPoint[] = [
  [0, 0],
  [1, 0],
  [0.5, 1],
];
const extract: IBMPoint[] = [
  [0.5, 0],
  [1, 1],
  [0, 1],
];
const path = (points: readonly IBMPoint[], close: boolean) =>
  points
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${Number((p[0] * 100).toFixed(4))} ${Number((p[1] * 100).toFixed(4))}`,
    )
    .join(' ') + (close ? ' Z' : '');
function symbol(
  id: IBMSymbolId,
  label: string,
  nodeType: NodeKind,
  physicalCutout: boolean,
  outline: readonly IBMPoint[],
  contentBox = box,
  details: readonly (readonly IBMPoint[])[] = [],
): IBMSymbol {
  const normalized = (points: readonly IBMPoint[]) =>
    points.map(([x, y]) => [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))] as const);
  outline = normalized(outline);
  details = details.map(normalized);
  const legacy =
    id.startsWith('ibm-legacy-') ||
    ['ibm-program-modification', 'ibm-clerical-operation', 'ibm-perforated-tape'].includes(id);
  const category = legacy
    ? 'legacy'
    : id.startsWith('ibm-arrow-')
      ? 'arrowhead'
      : id === 'ibm-sort-outline' || id === 'ibm-magnetic-tape-circle'
        ? 'outline'
        : 'symbol';
  const construction =
    physicalCutout || legacy
      ? 'cutout'
      : id === 'ibm-annotation' || id === 'ibm-parallel-mode'
        ? 'drawn'
        : 'composite';
  const revisions: IBMStencilRevision[] = legacy
    ? ['GX20-8020']
    : [
        ...(originalCutouts.includes(id) ? ['GX20-8020' as const] : []),
        'GX20-8020-1',
        'GX20-8020-2',
      ];
  return {
    id,
    label,
    nodeType,
    physicalCutout,
    category,
    construction,
    revisions,
    outline,
    outlinePath: path(outline, true),
    details,
    detailPaths: details.map((line) => path(line, false)),
    contentBox,
  };
}
const diamondBox = { x: 0.25, y: 0.28, width: 0.5, height: 0.44 };
const circleBox = { x: 0.19, y: 0.22, width: 0.62, height: 0.56 };
const triangleBox = { x: 0.28, y: 0.18, width: 0.44, height: 0.34 };
const upwardBox = { x: 0.28, y: 0.49, width: 0.44, height: 0.34 };

/** IBM's 1970 sleeve describes 32 completed symbols. Twelve use additions to cutouts. */
export const ibmSymbols: readonly IBMSymbol[] = [
  symbol('ibm-process', 'Process', 'process', true, rect),
  symbol(
    'ibm-annotation',
    'Comment / Annotation',
    'note',
    false,
    [
      [1, 0],
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0.97],
      [0.025, 0.97],
      [0.025, 0.03],
      [1, 0.03],
    ],
    { x: 0.09, y: 0.12, width: 0.84, height: 0.76 },
  ),
  symbol(
    'ibm-input-output',
    'Input / Output',
    'input',
    true,
    [
      [0.15, 0],
      [1, 0],
      [0.85, 1],
      [0, 1],
    ],
    { x: 0.2, y: 0.12, width: 0.6, height: 0.76 },
  ),
  symbol('ibm-connector', 'Connector', 'generic', true, circle, circleBox),
  symbol(
    'ibm-offpage-connector',
    'Offpage Connector',
    'generic',
    true,
    [
      [0, 0],
      [1, 0],
      [1, 0.65],
      [0.5, 1],
      [0, 0.65],
    ],
    { x: 0.12, y: 0.12, width: 0.76, height: 0.48 },
  ),
  symbol('ibm-decision', 'Decision', 'decision', true, diamond, diamondBox),
  symbol(
    'ibm-preparation',
    'Preparation',
    'process',
    true,
    [
      [0.17, 0],
      [0.83, 0],
      [1, 0.5],
      [0.83, 1],
      [0.17, 1],
      [0, 0.5],
    ],
    { x: 0.22, y: 0.12, width: 0.56, height: 0.76 },
  ),
  symbol(
    'ibm-predefined-process',
    'Predefined Process',
    'process',
    false,
    rect,
    { x: 0.19, y: 0.12, width: 0.62, height: 0.76 },
    [
      [
        [0.12, 0],
        [0.12, 1],
      ],
      [
        [0.88, 0],
        [0.88, 1],
      ],
    ],
  ),
  symbol('ibm-terminal', 'Terminal / Interrupt', 'start', true, terminal, {
    x: 0.24,
    y: 0.16,
    width: 0.52,
    height: 0.68,
  }),
  symbol(
    'ibm-parallel-mode',
    'Parallel Mode',
    'process',
    false,
    [
      [0, 0.08],
      [1, 0.08],
      [1, 0.11],
      [0, 0.11],
    ],
    { x: 0.08, y: 0.24, width: 0.84, height: 0.52 },
    [
      [
        [0, 0.89],
        [1, 0.89],
      ],
    ],
  ),
  symbol('ibm-punched-card', 'Punched Card', 'input', true, card),
  symbol(
    'ibm-card-deck',
    'Card Deck',
    'input',
    false,
    [
      [0.13, 0],
      [1, 0],
      [1, 0.88],
      [0.88, 1],
      [0, 1],
      [0, 0.16],
    ],
    { x: 0.12, y: 0.22, width: 0.7, height: 0.62 },
    [
      [
        [0, 0.16],
        [0.88, 0.16],
        [0.88, 1],
      ],
      [
        [0.88, 0.16],
        [1, 0],
      ],
    ],
  ),
  symbol(
    'ibm-card-file',
    'Card File',
    'input',
    false,
    [
      [0.09, 0.15],
      [0.85, 0.15],
      [0.85, 1],
      [0, 1],
      [0, 0.24],
    ],
    { x: 0.08, y: 0.28, width: 0.69, height: 0.6 },
    [
      [
        [0.66, 0],
        [1, 0],
        [1, 0.38],
      ],
    ],
  ),
  symbol('ibm-document', 'Document', 'document', true, document, {
    x: 0.08,
    y: 0.1,
    width: 0.84,
    height: 0.66,
  }),
  symbol('ibm-magnetic-tape', 'Magnetic Tape', 'database', false, circle, circleBox, [
    [
      [0.5, 1],
      [1, 1],
    ],
  ]),
  symbol(
    'ibm-transmittal-tape',
    'Transmittal Tape',
    'input',
    true,
    [[0, 0], [1, 0], [1, 1], ...curve([1, 1], [0.6, 0.75], [0, 0.8])],
    { x: 0.1, y: 0.1, width: 0.8, height: 0.62 },
  ),
  symbol('ibm-punched-tape', 'Punched Tape', 'input', true, [...wave(0.08), ...wave(0.92, true)], {
    x: 0.08,
    y: 0.24,
    width: 0.84,
    height: 0.52,
  }),
  symbol(
    'ibm-online-storage',
    'Online Storage',
    'database',
    true,
    [
      [0.12, 0],
      [1, 0],
      ...curve([1, 0], [0.75, 0.5], [1, 1]),
      [0.12, 1],
      ...arc(0.12, 0.5, 0.12, 0.5, Math.PI / 2, Math.PI * 1.5),
    ],
    { x: 0.18, y: 0.12, width: 0.62, height: 0.76 },
  ),
  symbol('ibm-keying', 'Keying', 'input', true, keying, {
    x: 0.17,
    y: 0.12,
    width: 0.66,
    height: 0.76,
  }),
  symbol(
    'ibm-magnetic-disk',
    'Magnetic Disk',
    'database',
    false,
    [
      [0, 0.16],
      ...arc(0.5, 0.16, 0.5, 0.16, Math.PI, Math.PI * 2),
      [1, 0.84],
      ...arc(0.5, 0.84, 0.5, 0.16, 0, Math.PI),
    ],
    { x: 0.12, y: 0.36, width: 0.76, height: 0.44 },
    [arc(0.5, 0.16, 0.5, 0.16, 0, Math.PI), arc(0.5, 0.24, 0.5, 0.16, 0, Math.PI)],
  ),
  symbol(
    'ibm-core',
    'Core',
    'database',
    false,
    rect,
    { x: 0.24, y: 0.25, width: 0.66, height: 0.61 },
    [
      [
        [0.17, 0],
        [0.17, 1],
      ],
      [
        [0, 0.17],
        [1, 0.17],
      ],
    ],
  ),
  symbol(
    'ibm-magnetic-drum',
    'Magnetic Drum',
    'database',
    false,
    keying,
    { x: 0.17, y: 0.12, width: 0.6, height: 0.76 },
    [arc(0.88, 0.5, 0.12, 0.5, Math.PI / 2, Math.PI * 1.5)],
  ),
  symbol('ibm-merge', 'Merge', 'process', true, merge, triangleBox),
  symbol(
    'ibm-collate',
    'Collate',
    'process',
    false,
    [
      [0, 0],
      [1, 0],
      [0.5, 0.5],
      [1, 1],
      [0, 1],
      [0.5, 0.5],
    ],
    { x: 0.29, y: 0.09, width: 0.42, height: 0.23 },
  ),
  symbol(
    'ibm-sort',
    'Sort',
    'process',
    false,
    diamond,
    { x: 0.31, y: 0.15, width: 0.38, height: 0.25 },
    [
      [
        [0, 0.5],
        [1, 0.5],
      ],
    ],
  ),
  symbol('ibm-offline-storage', 'Offline Storage', 'database', false, merge, triangleBox, [
    [
      [0.35, 0.7],
      [0.65, 0.7],
    ],
  ]),
  symbol('ibm-extract', 'Extract', 'process', true, extract, upwardBox),
  symbol(
    'ibm-display',
    'Display',
    'output',
    true,
    [
      [0.22, 0],
      [0.87, 0],
      ...arc(0.87, 0.5, 0.13, 0.5, -Math.PI / 2, Math.PI / 2),
      [0.22, 1],
      [0, 0.5],
    ],
    { x: 0.29, y: 0.12, width: 0.53, height: 0.76 },
  ),
  symbol(
    'ibm-manual-input',
    'Manual Input',
    'input',
    true,
    [
      [0, 0.25],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    { x: 0.1, y: 0.34, width: 0.8, height: 0.52 },
  ),
  symbol(
    'ibm-manual-operation',
    'Manual Operation',
    'process',
    true,
    [
      [0, 0],
      [1, 0],
      [0.76, 1],
      [0.24, 1],
    ],
    { x: 0.28, y: 0.12, width: 0.44, height: 0.76 },
  ),
  symbol('ibm-auxiliary-operation', 'Auxiliary Operation', 'process', true, rect),
  symbol(
    'ibm-communication-link',
    'Communication Link',
    'generic',
    true,
    [
      [0.23, 0],
      [0.29, 0],
      [0.29, 0.49],
      [0.76, 0.28],
      [0.76, 1],
      [0.7, 1],
      [0.7, 0.38],
      [0.23, 0.6],
    ],
    { x: 0.34, y: 0.46, width: 0.3, height: 0.2 },
  ),
  symbol('ibm-sort-outline', 'Sort aperture', 'process', true, diamond, diamondBox),
  symbol('ibm-magnetic-tape-circle', 'Magnetic Tape aperture', 'database', true, circle, circleBox),
  symbol('ibm-arrow-up', 'Arrowhead Up', 'generic', true, extract, upwardBox),
  symbol('ibm-arrow-down', 'Arrowhead Down', 'generic', true, merge, triangleBox),
  symbol(
    'ibm-arrow-left',
    'Arrowhead Left',
    'generic',
    true,
    [
      [0, 0.5],
      [1, 0],
      [1, 1],
    ],
    { x: 0.53, y: 0.28, width: 0.34, height: 0.44 },
  ),
  symbol(
    'ibm-arrow-right',
    'Arrowhead Right',
    'generic',
    true,
    [
      [0, 0],
      [1, 0.5],
      [0, 1],
    ],
    { x: 0.13, y: 0.28, width: 0.34, height: 0.44 },
  ),
  symbol(
    'ibm-legacy-input-output',
    'Input / Output (original)',
    'input',
    false,
    [
      [0, 0],
      [1, 0],
      [0.76, 1],
      [0.24, 1],
    ],
    { x: 0.28, y: 0.12, width: 0.44, height: 0.76 },
  ),
  symbol(
    'ibm-legacy-predefined-process',
    'Predefined Process (original)',
    'process',
    false,
    [
      [0.17, 0],
      [0.83, 0],
      [1, 0.5],
      [0.83, 1],
      [0.17, 1],
      [0, 0.5],
    ],
    { x: 0.22, y: 0.12, width: 0.56, height: 0.76 },
  ),
  symbol(
    'ibm-program-modification',
    'Program Modification (original)',
    'process',
    false,
    [
      [0, 0],
      [0.72, 0],
      [1, 0.5],
      [0.72, 1],
      [0, 1],
    ],
    { x: 0.08, y: 0.12, width: 0.6, height: 0.76 },
  ),
  symbol(
    'ibm-clerical-operation',
    'Clerical Operation (original)',
    'process',
    false,
    [
      [0.15, 0],
      [1, 0],
      [0.85, 1],
      [0, 1],
    ],
    { x: 0.2, y: 0.12, width: 0.6, height: 0.76 },
  ),
  symbol(
    'ibm-perforated-tape',
    'Perforated Tape (original)',
    'input',
    false,
    [...wave(0.08), ...wave(0.92, true)].map(([x, y]) => [x, 1 - y] as const),
    { x: 0.08, y: 0.24, width: 0.84, height: 0.52 },
  ),
];
export const ibmSymbolIds: readonly IBMSymbolId[] = symbolIds;
/** Physical holes per stencil form, independent of composite semantic glyphs. */
export const ibmStencilForms: readonly {
  revision: IBMStencilRevision;
  label: string;
  physicalCutoutSymbolIds: readonly IBMSymbolId[];
  /** Labels printed on a form when they differ from the revised catalog meaning. */
  symbolLabels?: Readonly<Partial<Record<IBMSymbolId, string>>>;
}[] = [
  {
    revision: 'GX20-8020',
    label: 'Original IBM Flowcharting Template (25 apertures)',
    physicalCutoutSymbolIds: originalCutouts,
    symbolLabels: {
      'ibm-program-modification': 'Program Modification',
      'ibm-legacy-input-output': 'Input/Output',
      'ibm-process': 'Processing/Annotation',
      'ibm-document': 'Document',
      'ibm-auxiliary-operation': 'Auxiliary Operation',
      'ibm-online-storage': 'Disk/Drum/Random Access File',
      'ibm-keying': 'Keying Operation',
      'ibm-legacy-predefined-process': 'Predefined Process',
      'ibm-offpage-connector': 'Offpage Connector',
      'ibm-decision': 'Decision',
      'ibm-punched-card': 'Punched Card',
      'ibm-transmittal-tape': 'Transmittal Tape',
      'ibm-perforated-tape': 'Perforated Tape',
      'ibm-manual-input': 'Online Keyboard',
      'ibm-terminal': 'Terminal',
      'ibm-connector': 'Connector',
      'ibm-arrow-up': 'Flow',
      'ibm-arrow-down': 'Flow',
      'ibm-arrow-left': 'Flow',
      'ibm-arrow-right': 'Flow',
      'ibm-merge': 'Offline Storage File',
      'ibm-magnetic-tape-circle': 'Magnetic Tape/Sorting/Collating',
      'ibm-clerical-operation': 'Clerical Operation',
      'ibm-display': 'Display',
      'ibm-communication-link': 'Communication Link',
    },
  },
  ...(['GX20-8020-1', 'GX20-8020-2'] as const).map((revision) => ({
    revision,
    label: `${revision} (26 apertures)`,
    physicalCutoutSymbolIds: ibmSymbols
      .filter((item) => item.physicalCutout)
      .map((item) => item.id),
  })),
];
const byId = new Map(ibmSymbols.map((item) => [item.id, item]));
export function getIbmSymbol(id: unknown): IBMSymbol | undefined {
  return typeof id === 'string' ? byId.get(id as IBMSymbolId) : undefined;
}
