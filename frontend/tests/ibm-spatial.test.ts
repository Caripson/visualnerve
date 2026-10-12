import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ibmSymbols } from '../src/flowchart/ibm-symbols';
import { ibmConnectionFraction, ibmReliefGeometry } from '../src/spatial/ibm-relief';
import { createSpatialBatches, disposeSpatialScene } from '../src/spatial/scene';
import { projectGraph } from '../src/canvas/projection';
import { createIbmFlowchartGraph } from '../src/flowchart/template';
import { getIbmSymbol } from '../src/flowchart/ibm-symbols';
import { paintIbmFace } from '../src/spatial/ibm-face';

describe('IBM spatial relief', () => {
  it.each(ibmSymbols)('extrudes the canonical $id silhouette with the correct volume', (symbol) => {
    const geometry = ibmReliefGeometry(symbol.id);
    const positions = geometry.getAttribute('position');
    let volume = 0;
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3();
    for (let index = 0; index < positions.count; index += 3) {
      a.fromBufferAttribute(positions, index);
      b.fromBufferAttribute(positions, index + 1);
      c.fromBufferAttribute(positions, index + 2);
      volume += a.dot(b.cross(c)) / 6;
    }
    const area =
      Math.abs(
        symbol.outline.reduce((total, point, index) => {
          const next = symbol.outline[(index + 1) % symbol.outline.length];
          return total + point[0] * next[1] - next[0] * point[1];
        }, 0),
      ) / 2;
    expect(Math.abs(volume)).toBeCloseTo(area, 5);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.z).toBe(-0.5);
    expect(geometry.boundingBox!.max.z).toBe(0.5);
    expect(geometry.userData.flowchartSymbol).toBe(symbol.id);
    for (let index = 0; index < positions.count; index++)
      expect(
        [positions.getX(index), positions.getY(index), positions.getZ(index)].every(
          Number.isFinite,
        ),
      ).toBe(true);
    geometry.dispose();
  });

  it('preserves both Collate lobes and nonzero thin-glyph caps at unit extrusion depth', () => {
    const fixtures = [
      ['ibm-collate', 0.5],
      ['ibm-annotation', 0.0835],
      ['ibm-parallel-mode', 0.03],
    ] as const;
    for (const [id, expected] of fixtures) {
      const geometry = ibmReliefGeometry(id),
        positions = geometry.getAttribute('position');
      let frontArea = 0,
        volume = 0,
        upperLobe = 0,
        lowerLobe = 0,
        frontTriangles = 0;
      const a = new THREE.Vector3(),
        b = new THREE.Vector3(),
        c = new THREE.Vector3();
      try {
        for (let index = 0; index < positions.count; index += 3) {
          a.fromBufferAttribute(positions, index);
          b.fromBufferAttribute(positions, index + 1);
          c.fromBufferAttribute(positions, index + 2);
          volume +=
            (a.x * (b.y * c.z - b.z * c.y) -
              a.y * (b.x * c.z - b.z * c.x) +
              a.z * (b.x * c.y - b.y * c.x)) /
            6;
          if (![a, b, c].every((point) => Math.abs(point.z - 0.5) < 1e-8)) continue;
          const area = ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
          expect(area).toBeGreaterThan(0);
          frontArea += area;
          frontTriangles++;
          if (id === 'ibm-collate') {
            const upper = [a, b, c].every((point) => point.y >= 0),
              lower = [a, b, c].every((point) => point.y <= 0);
            // A bridged or missing hourglass lobe must fail even if total area agrees.
            expect(upper || lower).toBe(true);
            if (upper) upperLobe += area;
            if (lower) lowerLobe += area;
          }
        }
        expect(frontArea).toBeCloseTo(expected, 6);
        expect(volume).toBeCloseTo(expected, 6);
        if (id === 'ibm-collate') {
          expect(frontTriangles).toBe(2);
          expect(upperLobe).toBeCloseTo(0.25, 8);
          expect(lowerLobe).toBeCloseTo(0.25, 8);
        }
      } finally {
        geometry.dispose();
      }
    }
  });

  it('keeps every catalog silhouette even when the ordinary profile budget is exhausted', () => {
    const graph = createIbmFlowchartGraph('Spatial inventory');
    const projected = projectGraph(graph, []);
    const positions = new Map(
      graph.nodes.map((node) => [node.id, { x: node.x / 100, y: -node.y / 100, z: 0 }]),
    );
    const batches = createSpatialBatches(projected.nodes, projected.edges, positions);
    for (const node of graph.nodes)
      expect(batches.nodes.get(node.id)!.mesh.geometry.userData.flowchartSymbol).toBe(
        node.flowchartSymbol,
      );
    expect(batches.edges.size).toBe(graph.edges.length);
    disposeSpatialScene(batches.group);
  });

  it('anchors diagonal links at a decision diamond rather than its rectangular bounding box', () => {
    expect(ibmConnectionFraction('ibm-decision', 1, 1)).toBeCloseTo(0.25, 8);
    expect(ibmConnectionFraction('ibm-process', 1, 1)).toBeCloseTo(0.5, 8);
    expect(ibmConnectionFraction('ibm-connector', 1, 0)).toBeCloseTo(0.5, 8);
    expect(ibmConnectionFraction('ibm-decision', 0, 0)).toBeUndefined();
  });

  it('places readable back text inside the reversed asymmetric silhouette', () => {
    const positions: number[] = [];
    const context = {
      canvas: { width: 512, height: 512 },
      beginPath() {},
      closePath() {},
      lineTo() {},
      moveTo() {},
      fill() {},
      stroke() {},
      measureText: () => ({ width: 10 }),
      fillText: (_text: string, x: number) => positions.push(x),
    } as unknown as CanvasRenderingContext2D;
    const symbol = getIbmSymbol('ibm-arrow-left')!;
    paintIbmFace(context, symbol, 'Label', {});
    paintIbmFace(context, symbol, 'Label', {}, true);
    expect(positions).toHaveLength(2);
    expect(positions[0]).toBeCloseTo(512 * (symbol.contentBox.x + symbol.contentBox.width / 2));
    expect(positions[1]).toBeCloseTo(512 - positions[0]);
  });

  it('keeps the existing mind-map renderer when a flowchart is converted', () => {
    const graph = createIbmFlowchartGraph('Converted IBM');
    graph.diagram.type = 'mindmap';
    const projected = projectGraph(graph, []);
    const positions = new Map(
      graph.nodes.map((node) => [node.id, { x: node.x / 100, y: -node.y / 100, z: 0 }]),
    );
    const batches = createSpatialBatches(projected.nodes, projected.edges, positions);
    for (const node of graph.nodes)
      expect(batches.nodes.get(node.id)!.mesh.geometry.userData.flowchartSymbol).toBeUndefined();
    expect(graph.nodes.every((node) => !!node.flowchartSymbol)).toBe(true);
    disposeSpatialScene(batches.group);
  });
});
