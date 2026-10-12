import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { notationSymbols } from '../src/notation/registry';
import { notationGeometry } from '../src/notation/geometry';
import { notationReliefGeometry, paintNotationFace } from '../src/notation/spatial';
import { notationMarkerGeometry } from '../src/notation/spatial-markers';
import type { NodeNotation, NotationDecoration } from '../src/notation/types';
import { blankGraph, newNode, newEdge } from '../src/model/types';
import { projectGraph } from '../src/canvas/projection';
import {
  cardConnectionPoint,
  createSpatialBatches,
  disposeSpatialScene,
} from '../src/spatial/scene';
import { spatialMovementPreview } from '../src/spatial/movementScene';

afterEach(() => vi.unstubAllGlobals());
function triangles(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute('position');
  const indices = geometry.getIndex();
  const count = indices?.count ?? positions.count;
  const result: THREE.Vector3[][] = [];
  for (let index = 0; index < count; index += 3)
    result.push(
      [0, 1, 2].map((offset) =>
        new THREE.Vector3().fromBufferAttribute(
          positions,
          indices?.getX(index + offset) ?? index + offset,
        ),
      ),
    );
  return result;
}
function front(geometry: THREE.BufferGeometry, z = 0.5) {
  return triangles(geometry).filter((points) =>
    points.every((point) => Math.abs(point.z - z) < 1e-6),
  );
}
function metrics(geometry: THREE.BufferGeometry, z = 0.5) {
  let volume = 0,
    capArea = 0;
  for (const [a, b, c] of triangles(geometry)) {
    volume += a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;
    if ([a, b, c].every((point) => Math.abs(point.z - z) < 1e-6))
      capArea += Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
  }
  return { volume: Math.abs(volume), capArea };
}
function covers(geometry: THREE.BufferGeometry, x: number, y: number, z = 0.5) {
  return front(geometry, z).some(([a, b, c]) => {
    const cross = (p: THREE.Vector3, q: THREE.Vector3) =>
      (q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x);
    const values = [cross(a, b), cross(b, c), cross(c, a)];
    return values.every((value) => value >= -1e-8) || values.every((value) => value <= 1e-8);
  });
}
const value = (collection: NodeNotation['collection'], symbol: string) =>
  ({ collection, symbol }) as NodeNotation;

describe('shared notation 3D relief', () => {
  it.each(notationSymbols)(
    'builds finite nonempty front/back surfaces for $collection:$id',
    (symbol) => {
      const notation = value(symbol.collection, symbol.id),
        geometry = notationReliefGeometry(notation);
      try {
        const positions = geometry.getAttribute('position');
        expect(positions.count).toBeGreaterThan(0);
        const all = Array.from(positions.array);
        expect(all.every(Number.isFinite)).toBe(true);
        geometry.computeBoundingBox();
        expect(geometry.boundingBox!.min.z).toBeCloseTo(-0.5, 6);
        expect(geometry.boundingBox!.max.z).toBeCloseTo(0.5, 6);
        expect(geometry.boundingBox!.min.x).toBeGreaterThanOrEqual(-0.500001);
        expect(geometry.boundingBox!.max.x).toBeLessThanOrEqual(0.500001);
        expect(geometry.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.500001);
        expect(geometry.boundingBox!.max.y).toBeLessThanOrEqual(0.500001);
        const measures = metrics(geometry);
        expect(measures.capArea).toBeGreaterThan(0);
        expect(measures.volume).toBeCloseTo(measures.capArea, 5);
        expect(geometry.userData.notation).toEqual(notation);
      } finally {
        geometry.dispose();
      }
    },
  );
  it('preserves independent golden areas, open frame centers and both hourglass lobes', () => {
    const fixtures = [
      ['uml', 'class', 1],
      ['bpmn', 'pool', 0.0591],
      ['uml', 'package', 0.05304816],
      ['dfd-yourdon', 'data-store', 0.05],
      ['dfd-gane-sarson', 'data-store', 0.09375],
      ['bpmn', 'text-annotation', 0.03375],
      ['uml', 'lifeline', 0.18984],
      ['uml', 'time-event-action', 0.5],
      ['bpmn', 'parallel-gateway', (0.5 * 100) / 148],
    ] as const;
    for (const [collection, symbol, expected] of fixtures) {
      const geometry = notationReliefGeometry(value(collection, symbol));
      try {
        expect(metrics(geometry).capArea, `${collection}:${symbol} cap`).toBeCloseTo(expected, 6);
        expect(metrics(geometry).volume, `${collection}:${symbol} volume`).toBeCloseTo(expected, 6);
        if (['pool', 'package', 'data-store', 'text-annotation'].includes(symbol))
          expect(covers(geometry, 0, 0), `${collection}:${symbol} hollow center`).toBe(false);
        if (symbol === 'time-event-action') {
          let upper = 0,
            lower = 0;
          for (const [a, b, c] of front(geometry)) {
            const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
            expect(
              [a, b, c].every((p) => p.y >= -1e-8) || [a, b, c].every((p) => p.y <= 1e-8),
            ).toBe(true);
            if ([a, b, c].every((p) => p.y >= -1e-8)) upper += area;
            else lower += area;
          }
          expect(upper).toBeCloseTo(0.25, 6);
          expect(lower).toBeCloseTo(0.25, 6);
        }
      } finally {
        geometry.dispose();
      }
    }
    const circle = notationReliefGeometry(value('bpmn', 'start-event'));
    try {
      circle.computeBoundingBox();
      expect(circle.boundingBox!.min.y).toBeCloseTo(-0.125, 6);
      expect(circle.boundingBox!.max.y).toBeCloseTo(0.5, 6);
      expect(metrics(circle).capArea).toBeGreaterThan(Math.PI * 0.5 * 0.3125 - 0.001);
      expect(metrics(circle).capArea).toBeLessThan(Math.PI * 0.5 * 0.3125);
      expect(covers(circle, 0, -0.35)).toBe(false);
    } finally {
      circle.dispose();
    }
  });
  it('retains every catalog contour when the ordinary profile budget is exhausted', () => {
    const graph = blankGraph('Notation spatial inventory');
    graph.nodes = notationSymbols.map((symbol, index) =>
      newNode(graph.diagram.id, {
        title: symbol.label,
        x: index * 250,
        width: symbol.defaultSize.width,
        height: symbol.defaultSize.height,
        notation: value(symbol.collection, symbol.id),
      }),
    );
    const projection = projectGraph(graph, []);
    const batches = createSpatialBatches(
      projection.nodes,
      [],
      new Map(graph.nodes.map((node, index) => [node.id, { x: index * 3, y: 0, z: 0 }])),
    );
    try {
      expect(batches.nodes.size).toBe(notationSymbols.length);
      for (const node of graph.nodes)
        // Equal silhouettes intentionally share one mesh, regardless of the collection label.
        expect(
          notationGeometry(batches.nodes.get(node.id)!.mesh.geometry.userData.notation),
        ).toEqual(notationGeometry(node.notation!));
    } finally {
      disposeSpatialScene(batches.group);
    }
  });
  it('uses authored contour ports for cardinal and noncentral 3D endpoints', () => {
    const node: NodeNotation = {
      collection: 'uml',
      symbol: 'decision',
      ports: [{ id: 'condition', side: 'right', offset: 0.25, direction: 'out' }],
    };
    const dimensions = new THREE.Vector3(4, 2, 0.2),
      point = { x: 3, y: 5, z: 7 };
    expect(
      cardConnectionPoint(point, { x: -10, y: -20, z: 2 }, dimensions, 1, node, 'condition'),
    ).toMatchObject({ x: 4, y: 5.5, z: expect.closeTo(7.104, 8) });
    expect(cardConnectionPoint(point, { x: 10, y: 5, z: 0 }, dimensions, 1, node, 'right')).toEqual(
      { x: 5, y: 5, z: expect.closeTo(7.104, 8) },
    );
    const event = cardConnectionPoint(
      point,
      { x: 20, y: 5, z: 0 },
      new THREE.Vector3(0.8, 1.28, 0.14),
      1,
      value('bpmn', 'start-event'),
      'right',
    );
    expect(event.x).toBeCloseTo(3.4);
    expect(event.y).toBeCloseTo(5.24);
    expect(event.z).toBeCloseTo(7.074);
    const geometry = notationGeometry(node);
    expect(geometry.anchors.find((port) => port.id === 'condition')).toMatchObject({
      x: 0.75,
      y: 0.25,
    });
    const lifeline: NodeNotation = {
      collection: 'uml',
      symbol: 'lifeline',
      ports: [{ id: 'receive-call', side: 'left', offset: 0.24 }],
    };
    const message = cardConnectionPoint(
      point,
      { x: -20, y: 5, z: 0 },
      new THREE.Vector3(2.4, 8.5, 0.14),
      1,
      lifeline,
      'receive-call',
    );
    expect(message.x).toBeCloseTo(3);
    expect(message.y).toBeCloseTo(7.21);
    expect(
      notationGeometry(lifeline).anchors.find((port) => port.id === 'receive-call'),
    ).toMatchObject({ x: 0.5, y: 0.24 });
  });
});

describe('semantic relationship marker meshes', () => {
  const decorations: NotationDecoration[] = [
    'open-arrow',
    'filled-arrow',
    'hollow-triangle',
    'filled-triangle',
    'hollow-diamond',
    'filled-diamond',
    'circle',
    'cross',
  ];
  it.each(decorations)(
    'keeps $0 oriented along the forward X axis with a real surface',
    (decoration) => {
      const geometry = notationMarkerGeometry(decoration, 1);
      try {
        expect(geometry.userData).toMatchObject({
          notationDecoration: decoration,
          forwardAxis: 'x',
        });
        const positions = geometry.getAttribute('position');
        expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
        geometry.computeBoundingBox();
        expect(geometry.boundingBox!.max.x).toBeLessThan(0.01);
        expect(geometry.boundingBox!.min.x).toBeLessThan(-0.1);
        expect(metrics(geometry, 0.018).capArea).toBeGreaterThan(0);
        if (decoration === 'hollow-triangle')
          expect(covers(geometry, -0.146666, 0, 0.018)).toBe(false);
        if (decoration === 'hollow-diamond') expect(covers(geometry, -0.12, 0, 0.018)).toBe(false);
        if (decoration === 'circle') expect(covers(geometry, -0.07, 0, 0.018)).toBe(false);
        if (decoration === 'filled-triangle')
          expect(covers(geometry, -0.146666, 0, 0.018)).toBe(true);
        if (decoration === 'filled-diamond') expect(covers(geometry, -0.12, 0, 0.018)).toBe(true);
      } finally {
        geometry.dispose();
      }
    },
  );
  it('moves both relationship ends with the actual tangent and restores all preview buffers', () => {
    const graph = blankGraph('Moving semantic markers');
    const a = newNode(graph.diagram.id, { notation: value('uml', 'class') }),
      b = newNode(graph.diagram.id, { x: 600, notation: value('uml', 'class') });
    graph.nodes = [a, b];
    graph.edges = [
      newEdge(graph.diagram.id, a.id, b.id, {
        notation: {
          collection: 'uml',
          symbol: 'duration',
          sourcePort: 'bottom',
          targetPort: 'top',
        },
      }),
    ];
    const projected = projectGraph(graph, []),
      batches = createSpatialBatches(
        projected.nodes,
        projected.edges,
        new Map([
          [a.id, { x: 0, y: 0, z: 0 }],
          [b.id, { x: 6, y: 0, z: 0 }],
        ]),
      ),
      labels = new THREE.Group();
    const original = batches.edgePoints.get(graph.edges[0].id)!.map((point) => point.clone());
    const arrowMatrices = batches.arrows.get(graph.edges[0].id)!.map((entry) => {
      const matrix = new THREE.Matrix4();
      entry.mesh.getMatrixAt(entry.index, matrix);
      return matrix;
    });
    const preview = spatialMovementPreview(batches, labels, new Set([a.id]), projected.edges, 1);
    try {
      expect(batches.arrows.get(graph.edges[0].id)).toHaveLength(2);
      preview.update({ x: 1, y: 2, z: 0 });
      const points = batches.edgePoints.get(graph.edges[0].id)!;
      const markers = batches.arrows.get(graph.edges[0].id)!;
      for (const [index, marker] of markers.entries()) {
        const matrix = new THREE.Matrix4();
        marker.mesh.getMatrixAt(marker.index, matrix);
        const at = index === 0 ? points.length - 1 : 0;
        expect(
          new THREE.Vector3().setFromMatrixPosition(matrix).distanceTo(points[at]),
        ).toBeLessThan(1e-6);
        const orientation = new THREE.Vector3(1, 0, 0).transformDirection(matrix),
          expected = points[at]
            .clone()
            .sub(points[index === 0 ? at - 1 : 1])
            .normalize();
        expect(orientation.dot(expected)).toBeCloseTo(1, 6);
        expect(marker.mesh.geometry.userData.notationDecoration).toBe('open-arrow');
      }
      preview.restore();
      expect(batches.edgePoints.get(graph.edges[0].id)!.map((point) => point.toArray())).toEqual(
        original.map((point) => point.toArray()),
      );
      for (const [index, marker] of markers.entries()) {
        const matrix = new THREE.Matrix4();
        marker.mesh.getMatrixAt(marker.index, matrix);
        expect(matrix.elements).toEqual(arrowMatrices[index].elements);
      }
    } finally {
      disposeSpatialScene(batches.group);
    }
  });
});

describe('readable native face fallback', () => {
  function context() {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    vi.stubGlobal(
      'Path2D',
      class {
        constructor(public path: string) {}
      },
    );
    const result = {
      canvas: { width: 600, height: 400 },
      save: () => calls.push({ name: 'save', args: [] }),
      restore: () => calls.push({ name: 'restore', args: [] }),
      scale: (...args: unknown[]) => calls.push({ name: 'scale', args }),
      translate: (...args: unknown[]) => calls.push({ name: 'translate', args }),
      rotate: (...args: unknown[]) => calls.push({ name: 'rotate', args }),
      setLineDash: (...args: unknown[]) => calls.push({ name: 'dash', args }),
      fill: (...args: unknown[]) => calls.push({ name: 'fill', args }),
      stroke: (...args: unknown[]) => calls.push({ name: 'stroke', args }),
      fillText: (...args: unknown[]) => calls.push({ name: 'text', args }),
    } as unknown as CanvasRenderingContext2D;
    return { result, calls };
  }
  it('mirrors asymmetric geometry on the back while keeping the title itself readable', () => {
    const front = context(),
      back = context(),
      notation = value('hipo', 'display');
    paintNotationFace(front.result, notation, 'Output preview', {});
    paintNotationFace(back.result, notation, 'Output preview', {}, true);
    const frontText = front.calls.find((call) => call.name === 'text')!,
      backText = back.calls.find((call) => call.name === 'text')!;
    expect(frontText.args[0]).toBe('Output preview');
    expect(backText.args[0]).toBe('Output preview');
    expect(back.calls).toContainEqual({ name: 'scale', args: [-1, 1] });
    expect(Number(frontText.args[1]) + Number(backText.args[1])).toBeCloseTo(600);
    const mirrorIndex = back.calls.findIndex(
        (call) => call.name === 'scale' && call.args[0] === -1,
      ),
      restoreIndex = back.calls.findIndex(
        (call, index) => index > mirrorIndex && call.name === 'restore',
      ),
      textIndex = back.calls.findIndex((call) => call.name === 'text');
    expect(textIndex).toBeGreaterThan(restoreIndex);
  });
  it('keeps tiny marker titles as accessible metadata rather than painting over the glyph', () => {
    const marker = context();
    paintNotationFace(marker.result, value('uml', 'activation'), 'Work execution', {});
    expect(marker.calls.some((call) => call.name === 'text')).toBe(false);
    expect(marker.calls.some((call) => call.name === 'stroke')).toBe(true);
  });
});
