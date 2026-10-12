import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { notationSymbols } from '../src/notation/registry';
import { notationGeometry } from '../src/notation/geometry';
import { notationReliefGeometry, paintNotationFace } from '../src/notation/spatial';
import { notationMarkerGeometry } from '../src/notation/spatial-markers';
import type { NodeNotation, NotationDecoration } from '../src/notation/types';
import { createNotationGraph, notationTemplates } from '../src/notation/templates';
import { readSpatialNodeTheme, readSpatialTheme } from '../src/spatial/appearance';
import { blankGraph, newNode, newEdge } from '../src/model/types';
import { projectGraph } from '../src/canvas/projection';
import {
  cardConnectionPoint,
  createSpatialBatches,
  disposeSpatialScene,
  spatialNodeAppearance,
  refreshSpatialNotationAppearance,
  applySpatialCapturedColor,
  selectSpatialBatches,
  spatialTextPlane,
  spatialFaceSurfaces,
  setSpatialFaceOpacity,
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
  it('preserves the rounded Gane-Sarson body and empty corners on both physical caps', () => {
    const geometry = notationReliefGeometry(value('dfd-gane-sarson', 'process'));
    try {
      for (const z of [-0.5, 0.5]) {
        expect(covers(geometry, 0, 0, z)).toBe(true);
        expect(covers(geometry, 0.49, 0.49, z)).toBe(false);
        expect(covers(geometry, -0.49, -0.49, z)).toBe(false);
        expect(metrics(geometry, z).capArea).toBeCloseTo(0.99121445, 7);
      }
      expect(metrics(geometry).volume).toBeCloseTo(0.99121445, 7);
    } finally {
      geometry.dispose();
    }
  });
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

describe('notation relief palette and starting sets', () => {
  function palette(background: string, color: string) {
    const root = document.documentElement,
      previous = root.getAttribute('style');
    root.style.setProperty('--node-bg', background);
    root.style.setProperty('--text', color);
    return () => {
      if (previous === null) root.removeAttribute('style');
      else root.setAttribute('style', previous);
    };
  }
  function batch(graph: ReturnType<typeof blankGraph>) {
    const projected = projectGraph(graph, []);
    return {
      projected,
      batches: createSpatialBatches(
        projected.nodes,
        [],
        new Map(graph.nodes.map((node) => [node.id, { x: node.x / 100, y: -node.y / 100, z: 0 }])),
      ),
    };
  }
  function colorAt(
    entry: ReturnType<typeof createSpatialBatches>['nodes'] extends Map<string, infer T>
      ? T
      : never,
  ) {
    const color = new THREE.Color();
    entry.mesh.getColorAt(entry.index, color);
    return `#${color.getHexString()}`;
  }
  it.each([
    ['dfd-gane-sarson', 'process', '#ffffff', '#000000', '#ffffff'],
    ['dfd-gane-sarson', 'process', '#172d55', '#ffffff', '#172d55'],
    ['dfd-gane-sarson', 'data-store', '#ffffff', '#e1e7e1', '#31766c'],
    ['dfd-gane-sarson', 'data-store', '#172d55', '#e1e7e1', '#31766c'],
    ['bpmn', 'start-event', '#ffffff', '#e1e7e1', '#ffffff'],
    ['uml', 'actor', '#ffffff', '#e1e7e1', '#31766c'],
    ['uml', 'package', '#ffffff', '#e1e7e1', '#31766c'],
  ] as const)(
    'uses the actual title surface for %s:%s custom-fill contrast (%s)',
    (collection, symbol, background, color, relief) => {
      const restore = palette('#242d27', '#e1e7e1'),
        graph = blankGraph('Actual title surface'),
        node = newNode(graph.diagram.id, {
          title: 'Readable title',
          backgroundColor: background,
          notation: value(collection, symbol),
        });
      graph.nodes = [node];
      const { projected, batches } = batch(graph);
      try {
        expect(spatialNodeAppearance(projected.nodes[0])).toEqual({
          background,
          color,
          accent: '#31766c',
        });
        expect(colorAt(batches.nodes.get(node.id)!)).toBe(relief);
      } finally {
        disposeSpatialScene(batches.group);
        restore();
      }
    },
  );
  it('matches the native notation accent for omitted colors and explicit mind-map overrides', () => {
    const graph = blankGraph('Palette frame'),
      store = newNode(graph.diagram.id, {
        title: 'Orders',
        notation: value('dfd-gane-sarson', 'data-store'),
      });
    graph.nodes = [store];
    const { projected, batches } = batch(graph),
      view = projected.nodes[0];
    try {
      expect(spatialNodeAppearance(view).accent).toBe('#31766c');
      expect(colorAt(batches.nodes.get(store.id)!)).toBe('#31766c');
      view.data.mindmap = { depth: 1, side: 'right', color: '#aa3377' };
      expect(spatialNodeAppearance(view).accent).toBe('#aa3377');
      view.data.node.color = '#284b67';
      expect(spatialNodeAppearance(view).accent).toBe('#284b67');
      refreshSpatialNotationAppearance(batches, projected.nodes);
      expect(colorAt(batches.nodes.get(store.id)!)).toBe('#284b67');
    } finally {
      disposeSpatialScene(batches.group);
    }
  });
  it('retains canonical relief colors before and after native raster capture, including sparse open frames', () => {
    const restore = palette('#242d27', '#e1e7e1'),
      graph = blankGraph('Native raster ink');
    const process = newNode(graph.diagram.id, {
      title: 'Receive order',
      backgroundColor: '#172d55',
      color: '#47766b',
      notation: value('dfd-gane-sarson', 'process'),
    });
    const store = newNode(graph.diagram.id, {
      title: 'Orders',
      color: '#47766b',
      notation: value('dfd-gane-sarson', 'data-store'),
    });
    const ordinary = newNode(graph.diagram.id, { title: 'Ordinary', x: 400 });
    const ibm = newNode(graph.diagram.id, {
      title: 'Classic',
      x: 600,
      flowchartSymbol: 'ibm-process',
    });
    graph.nodes = [process, store, ordinary, ibm];
    const { projected, batches } = batch(graph),
      ink = new THREE.Color('#e1e7e1');
    try {
      expect(colorAt(batches.nodes.get(process.id)!)).toBe('#172d55');
      expect(colorAt(batches.nodes.get(store.id)!)).toBe('#47766b');
      for (const node of graph.nodes) applySpatialCapturedColor(batches, node.id, ink, false);
      expect(colorAt(batches.nodes.get(process.id)!)).toBe('#172d55');
      expect(colorAt(batches.nodes.get(store.id)!)).toBe('#47766b');
      expect(colorAt(batches.nodes.get(ordinary.id)!)).toBe('#e1e7e1');
      expect(colorAt(batches.nodes.get(ibm.id)!)).toBe('#e1e7e1');
      selectSpatialBatches(batches, new Set([process.id, store.id]), new Set());
      applySpatialCapturedColor(batches, store.id, new THREE.Color('#ffffff'), true);
      expect(colorAt(batches.nodes.get(store.id)!)).toBe('#47766b');
      document.documentElement.style.setProperty('--node-bg', '#ffffff');
      refreshSpatialNotationAppearance(batches, projected.nodes);
      expect(colorAt(batches.nodes.get(process.id)!)).toBe('#172d55');
      expect(colorAt(batches.nodes.get(store.id)!)).toBe('#47766b');
    } finally {
      disposeSpatialScene(batches.group);
      restore();
    }
  });
  it.each([
    ['light', '#ffffff', '#1f2d28'],
    ['dark', '#242d27', '#e1e7e1'],
  ])(
    'inherits %s theme in a new Gane-Sarson example without erasing explicit fills',
    (_, background, color) => {
      const restore = palette(background, color),
        graph = createNotationGraph('dfd-gane-sarson', 'Theme relief')!,
        process = graph.nodes.find((node) => node.notation?.symbol === 'process')!;
      expect(process.backgroundColor).toBeUndefined();
      const { projected, batches } = batch(graph);
      try {
        expect(readSpatialNodeTheme()).toEqual({ background, color });
        const view = projected.nodes.find((node) => node.id === process.id)!;
        expect(spatialNodeAppearance(view)).toEqual({ background, color, accent: '#47766B' });
        expect(colorAt(batches.nodes.get(process.id)!)).toBe(background);
        view.data.node.backgroundColor = '#172d55';
        refreshSpatialNotationAppearance(batches, projected.nodes);
        expect(spatialNodeAppearance(view)).toEqual({
          background: '#172d55',
          color: '#ffffff',
          accent: '#47766B',
        });
        expect(colorAt(batches.nodes.get(process.id)!)).toBe('#172d55');
        selectSpatialBatches(batches, new Set([process.id]), new Set());
        expect(colorAt(batches.nodes.get(process.id)!)).toBe('#172d55');
        const cue = batches.frames.get(process.id)![0],
          matrix = new THREE.Matrix4(),
          cueColor = new THREE.Color();
        cue.mesh.getMatrixAt(cue.index, matrix);
        cue.mesh.getColorAt(cue.index, cueColor);
        expect(new THREE.Vector3().setFromMatrixScale(matrix).length()).toBeGreaterThan(0);
        expect(cueColor.getHexString()).toBe('286cc6');
        selectSpatialBatches(batches, new Set(), new Set(), new Set([process.id]));
        expect(colorAt(batches.nodes.get(process.id)!)).toBe('#172d55');
        delete view.data.node.backgroundColor;
        document.documentElement.style.setProperty('--node-bg', '#313b34');
        refreshSpatialNotationAppearance(batches, projected.nodes);
        expect(colorAt(batches.nodes.get(process.id)!)).toBe('#313b34');
      } finally {
        disposeSpatialScene(batches.group);
        restore();
      }
    },
  );
  it.each(notationTemplates.filter((template) => template.collection === 'uml'))(
    'keeps actual $key starter-set extrusions visible, including semantic group frames',
    (template) => {
      const graph = createNotationGraph(template.key, 'UML relief')!,
        { batches } = batch(graph);
      try {
        expect(batches.nodes.size).toBe(graph.nodes.length);
        for (const node of graph.nodes) {
          const entry = batches.nodes.get(node.id)!;
          expect(
            (entry.mesh.material as THREE.MeshStandardMaterial).opacity,
            node.notation?.symbol,
          ).toBe(1);
          expect((entry.mesh.material as THREE.MeshStandardMaterial).depthWrite).toBe(true);
          const matrix = new THREE.Matrix4();
          entry.mesh.getMatrixAt(entry.index, matrix);
          expect(new THREE.Vector3().setFromMatrixScale(matrix).z).toBeCloseTo(0.14, 7);
          expect(metrics(entry.mesh.geometry).volume).toBeGreaterThan(0);
          if (
            node.nodeType === 'group' &&
            ['package', 'profile', 'use-case-subject', 'device', 'execution-environment'].includes(
              node.notation!.symbol,
            )
          )
            expect(colorAt(entry)).toBe('#47766b');
        }
      } finally {
        disposeSpatialScene(batches.group);
      }
    },
  );
  it('hits actual class and open activity side walls obliquely from front and back', () => {
    const graph = blankGraph('Oblique semantic extrusion');
    graph.nodes = ['class', 'activity'].map((symbol, index) =>
      newNode(graph.diagram.id, {
        title: symbol,
        x: index * 400,
        width: 280,
        height: 210,
        nodeType: 'group',
        notation: value('uml', symbol),
      }),
    );
    const { batches } = batch(graph);
    batches.group.updateMatrixWorld(true);
    try {
      for (const [id, entry] of batches.nodes) {
        const target = entry.position.clone().add(new THREE.Vector3(entry.dimensions.x / 2, 0, 0));
        for (const z of [-0.02, 0.02]) {
          const origin = target.clone().add(new THREE.Vector3(2, 0, z)),
            direction = target.clone().sub(origin).normalize(),
            hits = new THREE.Raycaster(origin, direction).intersectObject(entry.mesh, false);
          expect(hits.length).toBeGreaterThan(0);
          expect(hits[0].instanceId).toBe(entry.index);
          expect(hits[0].face!.normal.x).toBeGreaterThan(0.9);
          expect(Math.abs(hits[0].point.z - entry.position.z)).toBeLessThan(0.07);
        }
        expect((entry.mesh.material as THREE.MeshStandardMaterial).opacity, id).toBe(1);
      }
      const activity = batches.nodes.get(graph.nodes[1].id)!;
      expect(covers(activity.mesh.geometry, 0, 0)).toBe(false);
    } finally {
      disposeSpatialScene(batches.group);
    }
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
      beginPath: () => calls.push({ name: 'begin-path', args: [] }),
      moveTo: (...args: unknown[]) => calls.push({ name: 'move-to', args }),
      lineTo: (...args: unknown[]) => calls.push({ name: 'line-to', args }),
      closePath: () => calls.push({ name: 'close-path', args: [] }),
      setLineDash: (...args: unknown[]) => calls.push({ name: 'dash', args }),
      measureText: (text: string) => ({ width: text.length * 8 }),
      fill: (...args: unknown[]) => calls.push({ name: 'fill', args: [...args, result.fillStyle] }),
      fillRect: (...args: unknown[]) =>
        calls.push({ name: 'rectangle-fill', args: [...args, result.fillStyle] }),
      stroke: (...args: unknown[]) =>
        calls.push({ name: 'stroke', args: [...args, result.strokeStyle] }),
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
  it.each([
    ['light', '#ffffff', '#fdfdfb', '#1f2d28'],
    ['dark', '#242d27', '#202522', '#e1e7e1'],
  ])(
    'paints %s relationship captions from the root edge-label palette',
    (_, node, surface, ink) => {
      const root = document.documentElement,
        previous = root.getAttribute('style'),
        records: ReturnType<typeof context>[] = [];
      root.style.setProperty('--node-bg', node);
      root.style.setProperty('--surface', surface);
      root.style.setProperty('--text', ink);
      const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
        this: HTMLCanvasElement,
      ) {
        const mock = context();
        Object.defineProperty(mock.result, 'canvas', { value: this });
        records.push(mock);
        return mock.result;
      });
      const theme = readSpatialTheme(),
        face = spatialTextPlane('«uses»', {
          width: 1.3,
          height: 0.22,
          color: theme.color,
          background: theme.surface,
        })!;
      try {
        expect(theme).toEqual({ background: node, surface, color: ink });
        expect(records).toHaveLength(1);
        expect(records[0].calls.find((call) => call.name === 'rectangle-fill')!.args.at(-1)).toBe(
          surface,
        );
        expect(records[0].result.fillStyle).toBe(ink);
        const customGraph = blankGraph('Independent node paint');
        customGraph.nodes = [newNode(customGraph.diagram.id, { backgroundColor: '#172d55' })];
        const customView = projectGraph(customGraph, []).nodes[0];
        expect(spatialNodeAppearance(customView, theme).background).toBe('#172d55');
        expect(readSpatialTheme().surface).toBe(surface);
      } finally {
        disposeSpatialScene(face);
        spy.mockRestore();
        if (previous === null) root.removeAttribute('style');
        else root.setAttribute('style', previous);
      }
    },
  );
  it('keeps tiny marker titles as accessible metadata rather than painting over the glyph', () => {
    const marker = context();
    paintNotationFace(marker.result, value('uml', 'activation'), 'Work execution', {});
    expect(marker.calls.some((call) => call.name === 'text')).toBe(false);
    expect(marker.calls.some((call) => call.name === 'stroke')).toBe(true);
  });
  it('paints the template parameter surface with the same custom background on both sides', () => {
    for (const back of [false, true]) {
      const mock = context();
      paintNotationFace(
        mock.result,
        value('uml', 'template-classifier'),
        'Result',
        { background: '#f5f1de', color: '#000000', accent: '#31766c' },
        back,
      );
      const fills = mock.calls.filter((call) => call.name === 'fill');
      expect(fills).toHaveLength(2);
      expect(fills[1].args.at(-1)).toBe('#f5f1de');
      expect((fills[1].args[0] as { path: string }).path).toContain('M 55 0');
      expect(mock.calls.filter((call) => call.name === 'rectangle-fill')).toHaveLength(0);
      const fillIndex = mock.calls.indexOf(fills[1]),
        dashedIndex = mock.calls.findIndex(
          (call, index) =>
            index > fillIndex && call.name === 'dash' && call.args[0]?.toString() === '2,1',
        );
      expect(dashedIndex).toBeGreaterThan(fillIndex);
    }
  });
  it('keeps both shaped face textures transparent outside the outline and separates fill, stroke and text', () => {
    const records: ReturnType<typeof context>[] = [],
      spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
        this: HTMLCanvasElement,
      ) {
        const mock = context();
        Object.defineProperty(mock.result, 'canvas', { value: this });
        records.push(mock);
        return mock.result;
      });
    const face = spatialTextPlane('Receive order', {
      width: 2.8,
      height: 1.8,
      depth: 0.14,
      background: '#242d27',
      color: '#e1e7e1',
      accent: '#47766B',
      notation: { collection: 'dfd-gane-sarson', symbol: 'process', properties: { number: '1' } },
    })!;
    try {
      expect(records).toHaveLength(2);
      for (const record of records) {
        expect(record.calls.filter((call) => call.name === 'rectangle-fill')).toHaveLength(0);
        const fills = record.calls.filter((call) => call.name === 'fill');
        expect(fills).toHaveLength(1);
        expect(fills[0].args.at(-1)).toBe('#242d27');
        expect((fills[0].args[0] as { path: string }).path).toContain('M 90 0');
        expect(
          record.calls
            .filter((call) => call.name === 'stroke')
            .every((call) => call.args.at(-1) === '#47766B'),
        ).toBe(true);
        expect(record.result.fillStyle).toBe('#e1e7e1');
      }
      const surfaces = spatialFaceSurfaces(face);
      expect(surfaces).toHaveLength(2);
      expect(surfaces[0].material.map).not.toBe(surfaces[1].material.map);
      expect(surfaces[1].rotation.y).toBe(Math.PI);
      for (const opacity of [0.2, 1]) {
        setSpatialFaceOpacity(face, opacity);
        for (const surface of surfaces) {
          expect(surface.material.transparent).toBe(true);
          expect(surface.material.alphaTest).toBe(0.01);
          expect(surface.material.side).toBe(THREE.FrontSide);
        }
      }
    } finally {
      disposeSpatialScene(face);
      spy.mockRestore();
    }
  });
  it('does not let translucent nested Deployment faces write over child text on either side', () => {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
        this: HTMLCanvasElement,
      ) {
        const mock = context();
        Object.defineProperty(mock.result, 'canvas', { value: this });
        return mock.result;
      }),
      graph = createNotationGraph('uml-deployment', 'Nested Deployment')!,
      projected = projectGraph(graph, []),
      batches = createSpatialBatches(
        projected.nodes,
        projected.edges,
        new Map(graph.nodes.map((node) => [node.id, { x: node.x / 100, y: node.y / 100, z: 0 }])),
      );
    const server = graph.nodes.find((node) => node.title === 'Application server')!,
      runtime = graph.nodes.find((node) => node.title === 'Service runtime')!,
      faces: THREE.Object3D[] = [];
    try {
      expect(runtime.parentId).toBe(server.id);
      for (const node of [server, runtime]) {
        const body = batches.nodes.get(node.id)!;
        const material = body.mesh.material as THREE.MeshStandardMaterial;
        expect(material.depthWrite).toBe(true);
        expect(material.opacity).toBe(1);
        const face = spatialTextPlane(node.title, {
          notation: node.notation,
          width: body.dimensions.x,
          height: body.dimensions.y,
          depth: body.dimensions.z,
        })!;
        faces.push(face);
        for (const source of ['fallback', '2d-node']) {
          face.userData.faceSource = source;
          setSpatialFaceOpacity(face, 1);
          for (const surface of spatialFaceSurfaces(face)) {
            expect(surface.material.transparent).toBe(true);
            expect(surface.material.alphaTest).toBe(0.01);
            expect(surface.material.depthTest).toBe(true);
            expect(surface.material.depthWrite).toBe(false);
          }
        }
      }
      for (const options of [
        {},
        { flowchartSymbol: 'ibm-process' as const },
        { notation: value('uml', 'class') },
      ]) {
        const face = spatialTextPlane('Ordinary filled body', options)!;
        faces.push(face);
        expect(spatialFaceSurfaces(face).every((surface) => surface.material.depthWrite)).toBe(
          true,
        );
      }
    } finally {
      for (const face of faces) disposeSpatialScene(face);
      disposeSpatialScene(batches.group);
      spy.mockRestore();
    }
  });
});
