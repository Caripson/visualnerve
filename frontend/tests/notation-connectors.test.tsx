import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Position, type EdgeProps } from '@xyflow/react';
import * as THREE from 'three';
import type { EdgeNotation } from '../src/notation/types';
import {
  notationConnectorGeometry,
  notationConnectorPaths,
  notationDecoration,
  notationEdgeAppearance,
  notationPathPoints,
} from '../src/notation/edge-geometry';
import { NotationEdge } from '../src/notation/Edge';
import { NotationSvgRenderer } from '../src/notation/svg';
import { SvgTextLayout } from '../src/export/svg-native';
import { notationSpatialSegments } from '../src/notation/spatial-markers';
import { blankGraph, newEdge, newNode } from '../src/model/types';
import { projectGraph, type RenderCache } from '../src/canvas/projection';
import {
  createSpatialBatches,
  disposeSpatialScene,
  selectSpatialBatches,
  spatialIntersectionIdentity,
} from '../src/spatial/scene';
import { spatialMovementPreview } from '../src/spatial/movementScene';
import { spatialNotationWaypoints } from '../src/spatial/notation-route';

const notation = (
  collection: EdgeNotation['collection'],
  symbol: string,
  properties?: Record<string, unknown>,
) => ({ collection, symbol, ...(properties ? { properties } : {}) }) as EdgeNotation;
const line = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
];
const coordinate = (point: { x: number; y: number }) => [point.x, point.y];
function native(value: EdgeNotation, path = 'M 0 0 L 100 0', sourceIsGateway = false) {
  const chunks: string[] = [];
  new NotationSvgRenderer(
    (value) => chunks.push(value),
    new SvgTextLayout({ measure: (text) => text.length * 7 }),
  ).edge(value, path, 1, '#123456', '#ffffff', 1.6, { sourceIsGateway });
  return new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${chunks.join('')}</svg>`,
    'image/svg+xml',
  );
}
function canvas(value: EdgeNotation, sourceIsGateway = false) {
  return render(
    <svg>
      <NotationEdge
        {...({
          id: 'semantic',
          source: 'a',
          target: 'b',
          sourceX: 0,
          sourceY: 0,
          targetX: 100,
          targetY: 0,
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          data: { notation: value, sourceIsGateway },
          style: { stroke: '#123456' },
        } as EdgeProps)}
      />
    </svg>,
  );
}

describe('source-defined connector geometry', () => {
  it('uses a hollow conditional source diamond only outside gateways and keeps default flows distinct', () => {
    const conditional = notation('bpmn', 'sequence-flow', { condition: 'approved' }),
      fallback = notation('bpmn', 'sequence-flow', { default: true });
    expect(notationEdgeAppearance(conditional).sourceDecoration).toBe('hollow-diamond');
    expect(notationEdgeAppearance(conditional, { sourceIsGateway: true }).sourceDecoration).toBe(
      'none',
    );
    expect(notationEdgeAppearance(fallback)).toMatchObject({
      sourceDecoration: 'none',
      defaultFlow: true,
      conditional: false,
    });
    expect(notationDecoration('hollow-diamond').fill).toBe('background');
    for (const sourceIsGateway of [false, true]) {
      const document = native(conditional, undefined, sourceIsGateway),
        view = canvas(conditional, sourceIsGateway);
      expect(document.querySelector('path[marker-start]') != null).toBe(!sourceIsGateway);
      expect(view.container.querySelector('path[marker-start]') != null).toBe(!sourceIsGateway);
      view.unmount();
    }
  });
  it('rotates the default slash with the actual initial route tangent', () => {
    const value = notation('bpmn', 'sequence-flow', { default: true });
    const horizontal = notationConnectorGeometry(value, line),
      vertical = notationConnectorGeometry(value, [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ]);
    expect(horizontal.details[0].map(coordinate)).toEqual([
      [8, 7],
      [16, -7],
    ]);
    expect(vertical.details[0].map(coordinate)).toEqual([
      [-7, 8],
      [7, 16],
    ]);
    expect(horizontal.route[0]).toMatchObject({ x: 0, y: 0 });
    expect(vertical.route.at(-1)).toMatchObject({ x: 0, y: 100 });
  });
  it('separates conversation rails around the original logical route', () => {
    const geometry = notationConnectorGeometry(notation('bpmn', 'conversation-link'), line);
    expect(geometry.strokes).toHaveLength(2);
    expect(geometry.strokes.map((points) => coordinate(points[0]))).toEqual([
      [0, 2],
      [0, -2],
    ]);
    expect(geometry.strokes.map((points) => coordinate(points.at(-1)!))).toEqual([
      [100, 2],
      [100, -2],
    ]);
    expect(coordinate(geometry.route[0])).toEqual([0, 0]);
    expect(coordinate(geometry.route.at(-1)!)).toEqual([100, 0]);
  });
  it('distinguishes broad open data arrows, hatched alteration, solid heavy action and dotted reference', () => {
    const data = notation('hipo', 'data-flow'),
      reference = notation('hipo', 'reference');
    expect(notationEdgeAppearance(data)).toMatchObject({
      ribbon: true,
      hatch: false,
      heavy: false,
      line: 'solid',
    });
    const geometry = notationConnectorGeometry(data, line);
    expect(geometry.strokes.map((points) => coordinate(points.at(-1)!))).toEqual([
      [90, 3],
      [90, -3],
    ]);
    expect(geometry.details).toHaveLength(0);
    const head = notationDecoration('open-arrow', false, true);
    expect(head.path).toContain('Z');
    expect(head.fill).toBe('background');
    expect(head.detailPaths).toHaveLength(0);
    const document = native(data),
      view = canvas(data);
    expect(document.querySelector('#notation-end-1')!.querySelectorAll('path')).toHaveLength(1);
    expect(
      view.container.querySelector('#notation-end-semantic')!.querySelectorAll('path'),
    ).toHaveLength(1);
    view.unmount();
    expect(notationEdgeAppearance(notation('hipo', 'action-flow'))).toMatchObject({
      heavy: true,
      ribbon: false,
      line: 'solid',
    });
    expect(notationEdgeAppearance(reference)).toMatchObject({
      ribbon: false,
      line: 'dotted',
      targetDecoration: 'open-arrow',
    });
    const referenceSvg = native(reference);
    expect(referenceSvg.querySelector('path[marker-end]')!.getAttribute('stroke-dasharray')).toBe(
      '2 4',
    );
  });
  it('outlines and hatches the complete HIPO alteration shaft and arrowhead', () => {
    const value = notation('hipo', 'alteration-flow'),
      geometry = notationConnectorGeometry(value, line),
      head = notationDecoration('open-arrow', true);
    expect(notationEdgeAppearance(value)).toMatchObject({ line: 'solid', hatch: true });
    expect(geometry.strokes.map((points) => coordinate(points.at(-1)!))).toEqual([
      [90, 3],
      [90, -3],
    ]);
    expect(geometry.details.length).toBeGreaterThan(8);
    for (const [a, b] of geometry.details) {
      expect(a.x).toBeLessThan(b.x);
      expect(a.y).toBeGreaterThan(b.y);
    }
    expect(head.path).toContain('Z');
    expect(head.detailPaths.length).toBeGreaterThan(2);
    const document = native(value),
      view = canvas(value);
    expect(document.querySelector('#notation-end-1')!.querySelectorAll('path').length).toBe(
      head.detailPaths.length + 1,
    );
    expect(
      view.container.querySelector('#notation-end-semantic')!.querySelectorAll('path').length,
    ).toBe(head.detailPaths.length + 1);
    expect(document.querySelector('[stroke-dasharray]')).toBeNull();
    expect(view.container.querySelector('[stroke-dasharray]')).toBeNull();
    view.unmount();
  });
  it.each(['exception-flow', 'interrupting-flow'])(
    'renders a real UML %s zigzag while preserving the ports',
    (symbol) => {
      const value = notation('uml', symbol),
        geometry = notationConnectorPaths(value, 'M 0 0 L 100 0');
      expect(geometry.path).not.toBe('M 0 0 L 100 0');
      expect(geometry.route.some((point) => point.y === 8)).toBe(true);
      expect(geometry.route.some((point) => point.y === -8)).toBe(true);
      expect(coordinate(geometry.route[0])).toEqual([0, 0]);
      expect(coordinate(geometry.route.at(-1)!)).toEqual([100, 0]);
      const document = native(value),
        view = canvas(value);
      expect(document.querySelector('path[marker-end]')!.getAttribute('d')).toBe(geometry.path);
      // ReactFlow supplies its normal 20px endpoint lead-ins; they stay part of the route.
      const path = view.container.querySelector('.react-flow__edge-path')!.getAttribute('d')!;
      expect(notationPathPoints(path)[0]).toEqual({ x: 0, y: 0 });
      expect(notationPathPoints(path).at(-1)).toEqual({ x: 100, y: 0 });
      expect(notationPathPoints(path).some((point) => point.y !== 0)).toBe(true);
      view.unmount();
    },
  );
  it('samples generated quadratic and cubic paths without browser geometry APIs', () => {
    const points = notationPathPoints('M 0 0 L 20 0 Q 30 0 30 10 C 30 20 50 20 50 30');
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)).toEqual({ x: 50, y: 30 });
    expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(
      true,
    );
    expect(
      notationConnectorPaths(notation('dfd-yourdon', 'data-flow'), 'M 0 0 Q 20 0 20 20').path,
    ).toBe('M 0 0 Q 20 0 20 20');
  });
  it('invalidates cached gateway context when only the source symbol changes', () => {
    const graph = blankGraph('Connector fixture'),
      a = newNode(graph.diagram.id, { notation: { collection: 'bpmn', symbol: 'task' } }),
      b = newNode(graph.diagram.id, { x: 400, notation: { collection: 'bpmn', symbol: 'task' } });
    graph.nodes = [a, b];
    graph.edges = [
      newEdge(graph.diagram.id, a.id, b.id, {
        notation: notation('bpmn', 'sequence-flow', { condition: 'approved' }),
      }),
    ];
    const cache: RenderCache = { nodes: new Map(), edges: new Map() };
    const before = projectGraph(graph, [], [], [], undefined, false, undefined, undefined, cache);
    const after = projectGraph(
      {
        ...graph,
        nodes: [{ ...a, notation: { collection: 'bpmn', symbol: 'exclusive-gateway' } }, b],
      },
      [],
      [],
      [],
      undefined,
      false,
      undefined,
      undefined,
      cache,
    );
    expect(before.edges[0].data?.sourceIsGateway).toBe(false);
    expect(after.edges[0].data?.sourceIsGateway).toBe(true);
    expect(after.edges[0]).not.toBe(before.edges[0]);
  });
});

describe('actual 3D connector strokes and reversible movement', () => {
  it('maps canonical bends using the actual sheet origin and interpolates endpoint depth', () => {
    const points = spatialNotationWaypoints(
      [
        [700, 800],
        [1000, 800],
      ],
      { x: 1, y: 2, z: 0.2 },
      { x: 7, y: -2, z: 1.2 },
      { centerX: 400, centerY: 500 },
      0.5,
    );
    expect(points[1].x).toBe(1.5);
    expect(points[1].y).toBe(-1.5);
    expect(points[2].x).toBe(3);
    expect(points[2].y).toBe(-1.5);
    expect(points[0].toArray()).toEqual([1, 2, 0.2]);
    expect(points.at(-1)!.toArray()).toEqual([7, -2, 1.2]);
    expect(points[1].z).toBeGreaterThan(0.2);
    expect(points[2].z).toBeLessThan(1.2);
  });
  it.each([
    notation('bpmn', 'sequence-flow'),
    notation('bpmn', 'conversation-link'),
    notation('hipo', 'alteration-flow'),
    notation('uml', 'exception-flow'),
  ])('preserves $symbol saved bends and endpoint label positions while a node moves', (value) => {
    const graph = blankGraph('Saved waypoint'),
      a = newNode(graph.diagram.id, {
        width: 200,
        height: 100,
        notation: { collection: 'bpmn', symbol: 'task' },
      }),
      b = newNode(graph.diagram.id, {
        x: 600,
        width: 200,
        height: 100,
        notation: { collection: 'bpmn', symbol: 'task' },
      });
    const edge = newEdge(graph.diagram.id, a.id, b.id, {
      notation: {
        ...value,
        sourcePort: 'right',
        targetPort: 'left',
        waypoints: [
          [300, 200],
          [500, 200],
        ],
      },
    });
    graph.nodes = [a, b];
    graph.edges = [edge];
    const projected = projectGraph(graph, []),
      batches = createSpatialBatches(
        projected.nodes,
        projected.edges,
        new Map([
          [a.id, { x: -3, y: 0, z: 0.2 }],
          [b.id, { x: 3, y: 0, z: 0.7 }],
        ]),
        1,
        { centerX: 400, centerY: 50 },
      ),
      labels = new THREE.Group();
    const sourceLabel = new THREE.Object3D(),
      targetLabel = new THREE.Object3D();
    sourceLabel.userData = { edgeId: edge.id, edgeEndpoint: 'source' };
    targetLabel.userData = { edgeId: edge.id, edgeEndpoint: 'target' };
    labels.add(sourceLabel, targetLabel);
    const range = batches.edges.get(edge.id)!,
      attribute = range.line.geometry.getAttribute('position'),
      original = new Float32Array(attribute.array),
      preview = spatialMovementPreview(batches, labels, new Set([a.id]), projected.edges, 1);
    try {
      const points = batches.edgePoints.get(edge.id)!;
      expect(points).toHaveLength(4);
      expect(points[1].x).toBe(-1);
      expect(points[1].y).toBe(-1.5);
      expect(points[2].x).toBe(1);
      expect(points[2].y).toBe(-1.5);
      const has = (x: number, y: number) =>
        Array.from({ length: attribute.count }, (_, index) => [
          attribute.getX(index),
          attribute.getY(index),
        ]).some(([px, py]) => Math.abs(px - x) < 1e-6 && Math.abs(py - y) < 1e-6);
      // A standard flow and a zigzag retain the authored vertices, with no corner shortcuts.
      if (!['conversation-link', 'alteration-flow'].includes(value.symbol)) {
        expect(has(-1, -1.5)).toBe(true);
        expect(has(1, -1.5)).toBe(true);
      }
      preview.update({ x: 1, y: 1, z: 0 });
      const moved = batches.edgePoints.get(edge.id)!;
      expect(moved[1].x).toBe(-1);
      expect(moved[1].y).toBe(-1.5);
      expect(moved[2].x).toBe(1);
      expect(moved[2].y).toBe(-1.5);
      expect(sourceLabel.position.x).toBeCloseTo(moved[0].x);
      expect(targetLabel.position.x).toBeCloseTo(moved.at(-1)!.x);
      expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      preview.restore();
      expect(new Float32Array(attribute.array)).toEqual(original);
    } finally {
      disposeSpatialScene(batches.group);
    }
  });
  it('keeps the conditional diamond center clear of the actual 3D line', () => {
    const points = Array.from({ length: 25 }, (_, index) => new THREE.Vector3(index / 24, 0, 0));
    const value = notation('bpmn', 'sequence-flow', { condition: 'approved' }),
      ordinary = notationSpatialSegments(value, points, 1),
      gateway = notationSpatialSegments(value, points, 1, undefined, { sourceIsGateway: true });
    expect(ordinary.segments[0][0].x).toBeCloseTo(0.24);
    expect(gateway.segments[0][0].x).toBe(0);
    expect(ordinary.segments.at(-1)![1].x).toBe(1);
  });
  it.each([
    notation('bpmn', 'conversation-link'),
    notation('bpmn', 'sequence-flow', { default: true }),
    notation('bpmn', 'sequence-flow', { condition: 'approved' }),
    notation('hipo', 'alteration-flow'),
    notation('hipo', 'data-flow'),
    notation('hipo', 'reference'),
    notation('hipo', 'action-flow'),
    notation('uml', 'exception-flow'),
    notation('uml', 'interrupting-flow'),
  ])(
    'moves and restores $collection:$symbol physical strokes, selection and pick identity',
    (value) => {
      const graph = blankGraph('Connector fixture'),
        a = newNode(graph.diagram.id, { notation: { collection: 'bpmn', symbol: 'task' } }),
        b = newNode(graph.diagram.id, { x: 500, notation: { collection: 'bpmn', symbol: 'task' } });
      graph.nodes = [a, b];
      graph.edges = [newEdge(graph.diagram.id, a.id, b.id, { notation: value })];
      const projected = projectGraph(graph, []),
        id = graph.edges[0].id,
        batches = createSpatialBatches(
          projected.nodes,
          projected.edges,
          new Map([
            [a.id, { x: 0, y: 0, z: 0 }],
            [b.id, { x: 5, y: 0, z: 0 }],
          ]),
        ),
        range = batches.edges.get(id)!;
      const positions = range.line.geometry.getAttribute('position') as THREE.BufferAttribute,
        original = new Float32Array(positions.array),
        ribbon = range.ribbon?.mesh.geometry.getAttribute('position') as
          | THREE.BufferAttribute
          | undefined,
        originalRibbon = ribbon && new Float32Array(ribbon.array);
      const preview = spatialMovementPreview(
        batches,
        new THREE.Group(),
        new Set([a.id]),
        projected.edges,
        1,
      );
      try {
        const baseSegments = batches.edgePoints.get(id)!.length - 1;
        if (value.symbol === 'conversation-link') expect(range.count).toBe(baseSegments * 4);
        if (value.symbol === 'alteration-flow') {
          expect(range.count).toBeGreaterThan(baseSegments * 4);
          expect(batches.arrows.get(id)![0].mesh.geometry.userData.hatched).toBe(true);
        }
        if (value.symbol === 'action-flow') {
          expect(ribbon).toBeDefined();
          expect(ribbon!.count).toBe(range.count * 3);
          expect(
            spatialIntersectionIdentity({
              object: range.ribbon!.mesh,
              faceIndex: 0,
            } as unknown as THREE.Intersection),
          ).toEqual({ edgeId: id });
          selectSpatialBatches(batches, new Set(), new Set([id]));
          const color = range.ribbon!.mesh.geometry.getAttribute('color');
          expect(color.getX(range.ribbon!.start)).toBeCloseTo(new THREE.Color('#286cc6').r);
          selectSpatialBatches(batches, new Set(), new Set(), new Set(), new Set([id]));
        }
        preview.update({ x: 1, y: 2, z: 0 });
        expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
        expect(new Float32Array(positions.array)).not.toEqual(original);
        if (ribbon) expect(new Float32Array(ribbon.array)).not.toEqual(originalRibbon);
        preview.restore();
        expect(new Float32Array(positions.array)).toEqual(original);
        if (ribbon) expect(new Float32Array(ribbon.array)).toEqual(originalRibbon);
      } finally {
        disposeSpatialScene(batches.group);
      }
    },
  );
});
