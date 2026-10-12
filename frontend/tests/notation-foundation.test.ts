import { describe, expect, it } from 'vitest';
import { blankGraph, newNode, type GraphEdge } from '../src/model/types';
import {
  notationCollections,
  notationSymbols,
  notationEdgeSymbols,
  getNotationSymbol,
} from '../src/notation/registry';
import { notationGeometry, notationContourPoint } from '../src/notation/geometry';
import {
  notationIssues,
  validateEdgeNotation,
  validateNodeNotation,
  validateNotationGraph,
  validateNotationProfile,
  NotationValidationError,
} from '../src/notation/validation';
import { remapNotationGraph } from '../src/notation/remap';
import { notationLimits, umlDiagramKinds, type NodeNotation } from '../src/notation/types';
import { ibmSymbols } from '../src/flowchart/ibm-symbols';
const edge = (
  graph: ReturnType<typeof blankGraph>,
  source: string,
  target: string,
  notation: GraphEdge['notation'],
): GraphEdge => ({
  id: crypto.randomUUID(),
  diagramId: graph.diagram.id,
  version: 1,
  createdAt: '2026-10-12T00:00:00Z',
  updatedAt: '2026-10-12T00:00:00Z',
  sourceNodeId: source,
  targetNodeId: target,
  notation,
  direction: 'forward',
  edgeType: 'flow',
  style: 'solid',
  metadata: {},
});
const area = (points: readonly (readonly [number, number])[]) =>
  Math.abs(
    points.reduce((sum, [x, y], i) => {
      const next = points[(i + 1) % points.length];
      return sum + x * next[1] - next[0] * y;
    }, 0),
  ) / 2;

describe('portable notation registry and geometry', () => {
  it('keeps five source-backed collections, fourteen UML diagram kinds and the established IBM catalog', () => {
    expect(notationCollections.map((value) => value.id)).toEqual([
      'hipo',
      'dfd-yourdon',
      'dfd-gane-sarson',
      'uml',
      'bpmn',
    ]);
    expect(
      notationCollections
        .find((value) => value.id === 'uml')
        ?.diagramKinds.map((value) => value.id),
    ).toEqual(umlDiagramKinds);
    expect(ibmSymbols).toHaveLength(43);
    expect(new Set(notationSymbols.map((value) => `${value.collection}:${value.id}`)).size).toBe(
      notationSymbols.length,
    );
    expect(
      new Set(notationEdgeSymbols.map((value) => `${value.collection}:${value.id}`)).size,
    ).toBe(notationEdgeSymbols.length);
    for (const collection of notationCollections)
      for (const kind of collection.diagramKinds)
        expect(
          notationSymbols.some(
            (symbol) =>
              symbol.collection === collection.id && symbol.diagramKinds.includes(kind.id),
          ),
        ).toBe(true);
    for (const id of ['magnetic-tape', 'punched-card', 'magnetic-disk'])
      expect(getNotationSymbol('hipo', id)?.source.title).toContain('supplemental');
    expect(getNotationSymbol('dfd-yourdon', 'process')?.geometry).not.toBe(
      getNotationSymbol('dfd-gane-sarson', 'process')?.geometry,
    );
  });
  it('implements every registered geometry, without unknown-symbol rectangle fallbacks', () => {
    for (const symbol of notationSymbols) {
      const value = { collection: symbol.collection, symbol: symbol.id } as NodeNotation;
      validateNodeNotation(value);
      expect(symbol.defaultSize.width).toBeGreaterThanOrEqual(40);
      expect(symbol.defaultSize.height).toBeGreaterThanOrEqual(30);
      const shape = notationGeometry(value);
      expect(shape.outlinePath).toMatch(/^M/);
      expect(shape.anchors).toHaveLength(4);
      expect(shape.contentBox.width).toBeGreaterThan(0);
      expect(shape.contentBox.height).toBeGreaterThan(0);
      for (const [x, y] of [...shape.outline, ...(shape.reliefContours?.flat() ?? [])]) {
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
        expect(y).toBeLessThanOrEqual(1);
      }
      if (shape.reliefContours)
        expect(shape.reliefContours.some((contour) => area(contour) > 0)).toBe(true);
      expect(symbol.source.url).toMatch(/^https:\/\//);
    }
    for (const symbol of notationEdgeSymbols)
      validateEdgeNotation({ collection: symbol.collection, symbol: symbol.id });
    expect(() => notationGeometry({ collection: 'uml', symbol: 'unknown' })).toThrow(
      'Unknown notation symbol',
    );
  });
  it('uses separate IPO columns and a real extended-description region', () => {
    const overview = notationGeometry({
        collection: 'hipo',
        symbol: 'ipo-chart',
        diagramKind: 'overview-ipo',
      }),
      detail = notationGeometry({
        collection: 'hipo',
        symbol: 'ipo-chart',
        diagramKind: 'detail-ipo',
      });
    expect(overview.compartmentBoxes?.map((value) => value.id)).toEqual([
      'input',
      'process',
      'output',
    ]);
    const columns = overview.compartmentBoxes!;
    expect(columns[0].y).toBe(columns[1].y);
    expect(columns[0].x + columns[0].width).toBeLessThan(columns[1].x);
    expect(columns[1].x + columns[1].width).toBeLessThan(columns[2].x);
    expect(detail.compartmentBoxes?.map((value) => value.id)).toEqual([
      'input',
      'process',
      'output',
      'extended-description',
    ]);
    expect(detail.compartmentBoxes![3].y).toBeGreaterThan(
      detail.compartmentBoxes![0].y + detail.compartmentBoxes![0].height,
    );
  });
  it('keeps open actors/lifelines/stores as explicit relief surfaces, and places custom ports on the contour', () => {
    for (const value of [
      { collection: 'uml', symbol: 'actor' },
      { collection: 'uml', symbol: 'lifeline' },
      { collection: 'dfd-yourdon', symbol: 'data-store' },
    ] as NodeNotation[]) {
      const shape = notationGeometry(value);
      expect(shape.outlineFill).toBe('none');
      expect(shape.reliefContours).toBeDefined();
      expect(shape.reliefContours!.reduce((sum, contour) => sum + area(contour), 0)).toBeLessThan(
        0.4,
      );
    }
    expect(notationGeometry({ collection: 'uml', symbol: 'lifeline' }).dashedPaths).toEqual([
      'M 50 18 V 100',
    ]);
    const diamond = notationGeometry({
      collection: 'uml',
      symbol: 'decision',
      ports: [{ id: 'condition', side: 'right', offset: 0.25, direction: 'out' }],
    });
    expect(diamond.anchors.find((value) => value.id === 'condition')).toMatchObject({
      x: 0.75,
      y: 0.25,
      side: 'right',
    });
    expect(
      notationContourPoint(
        [
          [0.5, 0],
          [1, 0.5],
          [0.5, 1],
          [0, 0.5],
        ],
        'left',
        0.25,
      ),
    ).toEqual([0.25, 0.25]);
  });
  it('draws timing data from authored state/time points and never fabricates a default waveform', () => {
    const empty = notationGeometry({ collection: 'uml', symbol: 'timing-lifeline' });
    expect(empty.detailPaths).toHaveLength(0);
    const shape = notationGeometry({
      collection: 'uml',
      symbol: 'timing-lifeline',
      properties: {
        timeStart: 0,
        timeEnd: 20,
        timingStates: [
          { time: 0, state: 'Idle' },
          { time: 10, state: 'Busy' },
          { time: 15, state: 'Idle' },
        ],
      },
    });
    expect(shape.detailPaths).toEqual(['M 20 20 L 60 20 L 60 80 L 80 80 L 80 20 L 100 20']);
    const changed = notationGeometry({
      collection: 'uml',
      symbol: 'timing-lifeline',
      properties: {
        timeStart: 0,
        timeEnd: 20,
        timingStates: [
          { time: 0, state: 'Idle' },
          { time: 5, state: 'Busy' },
        ],
      },
    });
    expect(changed.detailPaths).not.toEqual(shape.detailPaths);
  });
  it('reserves identifiers, vertical lane headers and visible event/gateway labels separately from glyphs', () => {
    for (const value of [
      { collection: 'hipo', symbol: 'vtoc-module' },
      { collection: 'dfd-gane-sarson', symbol: 'process' },
    ] as NodeNotation[]) {
      const shape = notationGeometry(value);
      expect(shape.prefixBox).toBeDefined();
      expect(shape.prefixBox!.y + shape.prefixBox!.height).toBeLessThan(shape.contentBox.y);
    }
    expect(notationGeometry({ collection: 'bpmn', symbol: 'pool' }).titleRotation).toBe(-90);
    expect(
      notationGeometry({
        collection: 'uml',
        symbol: 'partition',
        properties: { orientation: 'horizontal' },
      }).titleRotation,
    ).toBeUndefined();
    const event = notationGeometry({ collection: 'bpmn', symbol: 'start-event' });
    expect(getNotationSymbol('bpmn', 'start-event')!.defaultSize).toEqual({
      width: 80,
      height: 128,
    });
    expect(event.anchors.find((value) => value.id === 'right')).toMatchObject({ x: 1, y: 0.3125 });
    expect(event.anchors.find((value) => value.id === 'bottom')).toMatchObject({
      x: 0.5,
      y: 0.625,
    });
    expect(Math.max(...event.outline.map((point) => point[1]))).toBeLessThan(event.contentBox.y);
    const gateway = notationGeometry({ collection: 'bpmn', symbol: 'parallel-gateway' });
    expect(getNotationSymbol('bpmn', 'parallel-gateway')!.defaultSize).toEqual({
      width: 100,
      height: 148,
    });
    expect(gateway.anchors.find((value) => value.id === 'right')!.y * 148).toBeCloseTo(50);
    expect(Math.max(...gateway.outline.map((point) => point[1]))).toBeLessThan(
      gateway.contentBox.y,
    );
    expect(notationGeometry({ collection: 'uml', symbol: 'actor' }).contentBox).toMatchObject({
      y: 0.83,
      height: 0.16,
    });
    expect(notationGeometry({ collection: 'uml', symbol: 'activation' }).titleStyle).toBe('hidden');
    const message = notationGeometry({
      collection: 'bpmn',
      symbol: 'end-event',
      properties: { eventDefinition: 'message' },
    });
    expect(message.contrastPaths).toEqual(['M 23 20 L 50 33.125 L 77 20']);
    const boundary = notationGeometry({
      collection: 'bpmn',
      symbol: 'boundary-event',
      properties: { eventDefinition: 'timer', nonInterrupting: true },
    });
    expect(boundary.stroke).toBe('dashed');
    expect(boundary.dashedPaths).toHaveLength(1);
    expect(boundary.dashedPaths![0]).toContain('M 50 5');
  });
});

describe('strict saved values and advisory model semantics', () => {
  it('rejects malformed nested values, unknown properties and bounded overflows', () => {
    const invalid = [
      null,
      [],
      {},
      { collection: 'uml', symbol: 'class', unknown: true },
      { collection: 'uml', symbol: 'class', properties: { unknown: true } },
      { collection: 'uml', symbol: 'actor', compartments: [] },
      { collection: 'uml', symbol: 'class', ports: [{ id: 'bad\n', side: 'left' }] },
      {
        collection: 'uml',
        symbol: 'class',
        ports: [
          { id: 'p', side: 'left' },
          { id: 'p', side: 'right' },
        ],
      },
      { collection: 'uml', symbol: 'class', ports: [{ id: 'p', side: 'left', offset: 1.01 }] },
      {
        collection: 'uml',
        symbol: 'class',
        compartments: [{ id: 'attributes', lines: ['x'.repeat(notationLimits.text + 1)] }],
      },
      { collection: 'uml', symbol: 'class', properties: null },
      { collection: 'uml', symbol: 'timing-lifeline', properties: { timeStart: 10, timeEnd: 0 } },
      {
        collection: 'uml',
        symbol: 'timing-lifeline',
        properties: {
          timingStates: [
            { time: 1, state: 'a' },
            { time: 1, state: 'b' },
          ],
        },
      },
      {
        collection: 'uml',
        symbol: 'timing-lifeline',
        properties: { timeEnd: 5, timingStates: [{ time: 6, state: 'a' }] },
      },
    ];
    for (const value of invalid)
      expect(() => validateNodeNotation(value)).toThrow(NotationValidationError);
    expect(() =>
      validateEdgeNotation({
        collection: 'uml',
        symbol: 'association',
        targetMultiplicity: '0..1\n',
      }),
    ).toThrow(NotationValidationError);
    expect(() =>
      validateEdgeNotation({
        collection: 'uml',
        symbol: 'association',
        targetMultiplicity: '2..1',
      }),
    ).toThrow(NotationValidationError);
    expect(() =>
      validateEdgeNotation({
        collection: 'bpmn',
        symbol: 'sequence-flow',
        sourceMultiplicity: '*',
      }),
    ).toThrow(NotationValidationError);
    expect(() =>
      validateEdgeNotation({ collection: 'bpmn', symbol: 'message-flow', properties: {} }),
    ).toThrow(NotationValidationError);
    expect(() =>
      validateEdgeNotation({
        collection: 'bpmn',
        symbol: 'sequence-flow',
        properties: { default: true, condition: 'approved' },
      }),
    ).toThrow(NotationValidationError);
    expect(() =>
      validateNotationProfile({ collection: 'uml', diagramKind: 'process', schemaVersion: 1 }),
    ).toThrow(NotationValidationError);
    expect(() =>
      validateNotationProfile({ collection: 'uml', diagramKind: 'class', schemaVersion: 2 }),
    ).toThrow(NotationValidationError);
    validateEdgeNotation({
      collection: 'uml',
      symbol: 'association',
      sourceMultiplicity: '0..*',
      targetMultiplicity: '1',
      waypoints: [
        [0, 1],
        [20, 30],
      ],
    });
  });
  it('enforces the BPMN event context matrix rather than inventing every trigger/event combination', () => {
    const valid = [
      { symbol: 'start-event', properties: { eventDefinition: 'none', nonInterrupting: false } },
      { symbol: 'start-event', properties: { eventSubProcess: true, eventDefinition: 'error' } },
      {
        symbol: 'start-event',
        properties: { eventSubProcess: true, nonInterrupting: true, eventDefinition: 'timer' },
      },
      { symbol: 'boundary-event', properties: { eventDefinition: 'cancel' } },
      { symbol: 'intermediate-catch-event', properties: { eventDefinition: 'parallel-multiple' } },
      { symbol: 'intermediate-throw-event', properties: { eventDefinition: 'link' } },
      { symbol: 'end-event', properties: { eventDefinition: 'terminate' } },
      { symbol: 'event-based-gateway', properties: { parallel: true, instantiating: true } },
    ];
    const invalid = [
      { symbol: 'start-event', properties: { eventDefinition: 'error' } },
      { symbol: 'start-event', properties: { eventSubProcess: true, eventDefinition: 'none' } },
      {
        symbol: 'start-event',
        properties: {
          eventSubProcess: true,
          nonInterrupting: true,
          eventDefinition: 'compensation',
        },
      },
      { symbol: 'start-event', properties: { nonInterrupting: true, eventDefinition: 'message' } },
      {
        symbol: 'boundary-event',
        properties: { nonInterrupting: true, eventDefinition: 'cancel' },
      },
      { symbol: 'intermediate-catch-event', properties: { eventDefinition: 'none' } },
      { symbol: 'intermediate-throw-event', properties: { eventDefinition: 'timer' } },
      { symbol: 'end-event', properties: { eventDefinition: 'parallel-multiple' } },
      { symbol: 'event-based-gateway', properties: { parallel: true } },
    ];
    for (const value of valid) validateNodeNotation({ collection: 'bpmn', ...value });
    for (const value of invalid)
      expect(() => validateNodeNotation({ collection: 'bpmn', ...value })).toThrow(
        NotationValidationError,
      );
    const catching = notationGeometry({
        collection: 'bpmn',
        symbol: 'intermediate-catch-event',
        properties: { eventDefinition: 'message' },
      }),
      throwing = notationGeometry({
        collection: 'bpmn',
        symbol: 'intermediate-throw-event',
        properties: { eventDefinition: 'message' },
      });
    expect(catching.filledPaths).toHaveLength(0);
    expect(throwing.filledPaths).toHaveLength(1);
  });
  it('checks native attachments, named port existence and direction while allowing drafts and mixed profiles', () => {
    const graph = blankGraph('Notation draft');
    graph.diagram.notation = { collection: 'hipo', diagramKind: 'vtoc', schemaVersion: 1 };
    const task = newNode(graph.diagram.id, {
        notation: {
          collection: 'bpmn',
          symbol: 'task',
          ports: [{ id: 'result', side: 'right', direction: 'out' }],
        },
      }),
      boundary = newNode(graph.diagram.id, {
        notation: { collection: 'bpmn', symbol: 'boundary-event' },
      });
    graph.nodes = [task, boundary];
    validateNotationGraph(graph);
    expect(notationIssues(graph)).toContainEqual(
      expect.objectContaining({ code: 'BOUNDARY_ATTACHMENT' }),
    );
    boundary.notation!.attachmentId = task.id;
    graph.edges = [
      edge(graph, task.id, boundary.id, {
        collection: 'bpmn',
        symbol: 'sequence-flow',
        sourcePort: 'result',
        targetPort: 'top',
      }),
    ];
    validateNotationGraph(graph);
    graph.edges[0].notation!.targetPort = 'result';
    expect(() => validateNotationGraph(graph)).toThrow('port does not exist');
    graph.edges[0].notation!.targetPort = 'top';
    task.notation!.ports![0].direction = 'in';
    expect(() => validateNotationGraph(graph)).toThrow('direction');
    task.notation!.ports![0].direction = 'out';
    boundary.notation!.attachmentId = 'missing';
    expect(() => validateNotationGraph(graph)).toThrow('existing node');
    const line = newNode(graph.diagram.id, { notation: { collection: 'uml', symbol: 'lifeline' } }),
      activation = newNode(graph.diagram.id, {
        notation: { collection: 'uml', symbol: 'activation', attachmentId: line.id },
      });
    graph.nodes = [line, activation];
    graph.edges = [];
    validateNotationGraph(graph);
    activation.notation!.attachmentId = activation.id;
    expect(() => validateNotationGraph(graph)).toThrow('another existing node');
  });
  it('reports forbidden DFD direct-store flows and BPMN cross-pool sequence flow without blocking draft save', () => {
    const graph = blankGraph('Notation');
    const a = newNode(graph.diagram.id, {
        notation: { collection: 'dfd-yourdon', symbol: 'data-store' },
      }),
      b = newNode(graph.diagram.id, {
        notation: { collection: 'dfd-yourdon', symbol: 'external-entity' },
      });
    graph.nodes = [a, b];
    graph.edges = [edge(graph, a.id, b.id, { collection: 'dfd-yourdon', symbol: 'data-flow' })];
    validateNotationGraph(graph);
    expect(notationIssues(graph).some((value) => value.code === 'DFD_TRANSFORMATION')).toBe(true);
    const p1 = newNode(graph.diagram.id, { notation: { collection: 'bpmn', symbol: 'pool' } }),
      p2 = newNode(graph.diagram.id, { notation: { collection: 'bpmn', symbol: 'pool' } });
    a.notation = { collection: 'bpmn', symbol: 'task' };
    b.notation = { collection: 'bpmn', symbol: 'task' };
    a.parentId = p1.id;
    b.parentId = p2.id;
    graph.nodes.push(p1, p2);
    graph.edges[0].notation = { collection: 'bpmn', symbol: 'sequence-flow' };
    validateNotationGraph(graph);
    expect(notationIssues(graph).some((value) => value.code === 'SEQUENCE_POOL')).toBe(true);
  });
  it('remaps internal references and prunes outside selection without mutating the source graph', () => {
    const graph = blankGraph('Notation');
    const a = newNode(graph.diagram.id, { notation: { collection: 'bpmn', symbol: 'task' } }),
      b = newNode(graph.diagram.id, {
        notation: {
          collection: 'bpmn',
          symbol: 'boundary-event',
          attachmentId: a.id,
          relatedNodeId: 'outside',
        },
      });
    graph.nodes = [a, b];
    const remapped = remapNotationGraph(
      graph,
      new Map([
        [a.id, 'copied-task'],
        [b.id, 'copied-boundary'],
      ]),
    );
    expect(remapped.nodes[1].notation).toMatchObject({ attachmentId: 'copied-task' });
    expect(remapped.nodes[1].notation?.relatedNodeId).toBeUndefined();
    expect(graph.nodes[1].notation).toMatchObject({ attachmentId: a.id, relatedNodeId: 'outside' });
  });
});
