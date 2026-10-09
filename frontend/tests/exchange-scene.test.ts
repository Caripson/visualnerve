import { describe, expect, it } from 'vitest';
import { blankGraph, newEdge, newNode } from '../src/model/types';
import { exchangeColor, exchangeGraphSnapshot, exchangeScene } from '../src/export/exchange-scene';
import type { SvgTheme } from '../src/export/svg-job-types';
import { createSimulationGraph } from '../src/simulation/document';

const theme: SvgTheme = {
  background: '#FAFAF7',
  node: '#FFFFFF',
  surface: '#FDFDFB',
  text: '#1F2D28',
  muted: '#56675D',
  border: '#E2E5DF',
  doneBackground: '#DCFCE7',
  doneText: '#075B2C',
  doneBorder: '#16803D',
};
describe('deliberate editable exchange content and canonical geometry', () => {
  it('does not recreate deliberately suppressed CSV parent relationships or copy raw CSV metadata', () => {
    const graph = blankGraph('CSV hierarchy', 'mindmap');
    const parent = newNode(graph.diagram.id, { title: 'All customers' });
    const child = newNode(graph.diagram.id, {
      title: 'Region',
      parentId: parent.id,
      metadata: {
        csv: {
          datasetId: crypto.randomUUID(),
          groupKey: '[]',
          path: [],
          rowCount: 100,
          measures: [],
          totalChildren: 0,
          hiddenChildren: 0,
          suppressParentConnection: true,
        },
      },
    });
    graph.nodes = [parent, child];
    const snapshot = exchangeGraphSnapshot(graph);
    expect(snapshot.nodes[1].metadata).toEqual({
      exchangeDetailLines: [],
      exchangeNoDerivedHierarchy: true,
    });
    expect(exchangeScene(snapshot, {}, theme).edges).toHaveLength(0);
    graph.edges = [newEdge(graph.diagram.id, parent.id, child.id, { label: 'User relationship' })];
    expect(exchangeScene(exchangeGraphSnapshot(graph), {}, theme).edges).toHaveLength(1);
  });
  it('retains derived mind map branches as real editable connectors without turning topic parents into groups', () => {
    const graph = blankGraph('Mind map branches', 'mindmap');
    const root = newNode(graph.diagram.id, { title: 'Root', x: 0, color: '#23664d' });
    const child = newNode(graph.diagram.id, { title: 'Child', parentId: root.id, x: 300 });
    const leaf = newNode(graph.diagram.id, { title: 'Leaf', parentId: child.id, x: 600 });
    graph.nodes = [root, child, leaf];
    const snapshot = exchangeGraphSnapshot(graph),
      full = exchangeScene(snapshot, {}, theme);
    expect(full.edges).toHaveLength(2);
    expect(full.edges.map((edge) => [edge.source, edge.target, edge.direction])).toEqual([
      [root.id, child.id, 'none'],
      [child.id, leaf.id, 'none'],
    ]);
    expect(full.nodes.every((node) => !node.parentId)).toBe(true);
    const selected = exchangeScene(
      snapshot,
      { scope: 'selected', nodeIds: [child.id, leaf.id] },
      theme,
    );
    expect(selected.edges).toHaveLength(1);
    expect(selected.edges[0]).toMatchObject({ source: child.id, target: leaf.id });
    expect(
      selected.warnings.some((warning) => warning.code === 'SELECTION_BOUNDARY_CONNECTIONS'),
    ).toBe(true);
    graph.edges = [newEdge(graph.diagram.id, root.id, child.id, { label: 'Stored relation' })];
    const represented = exchangeScene(exchangeGraphSnapshot(graph), {}, theme);
    expect(represented.edges).toHaveLength(2);
    expect(represented.edges[0].label).toBe('Stored relation');
  });
  it('never copies raw datasets, arbitrary metadata, notes, owner email or private source fields', () => {
    const graph = blankGraph('Safe deliberate text');
    graph.nodes = [
      newNode(graph.diagram.id, {
        title: 'Readable',
        description: 'Intentionally exported',
        notes: 'private',
        url: 'https://secret.test',
        metadata: {},
      }),
    ];
    const forbidden = () => {
      throw new Error('private field traversed');
    };
    Object.defineProperty(graph, 'dataset', { get: forbidden });
    Object.defineProperty(graph, 'datasets', { get: forbidden });
    Object.defineProperty(graph.diagram.metadata, 'secret', { get: forbidden, enumerable: true });
    Object.defineProperty(graph.nodes[0].metadata, 'codeSource', {
      get: forbidden,
      enumerable: true,
    });
    const snapshot = exchangeGraphSnapshot(graph);
    expect(snapshot.nodes[0]).toMatchObject({
      title: 'Readable',
      description: 'Intentionally exported',
    });
    expect(snapshot.nodes[0].notes).toBeUndefined();
    expect(snapshot.nodes[0].url).toBeUndefined();
    expect(snapshot.nodes[0].metadata).toEqual({ exchangeDetailLines: [] });
    expect(snapshot.dataset).toBeUndefined();
    expect(snapshot.datasets).toBeUndefined();
    expect(snapshot.diagram.metadata).toEqual({ exchangeSimulation: false });
  });
  it('uses absolute saved group coordinates, exposes members of collapsed groups and ignores 3D camera/depth', () => {
    const graph = blankGraph('2D authoritative');
    const group = newNode(graph.diagram.id, { nodeType: 'group', x: -100, y: 20, collapsed: true });
    const child = newNode(graph.diagram.id, { title: 'Member', x: -60, y: 70, parentId: group.id });
    graph.nodes = [child, group];
    graph.diagram.settings.spatialView = { mode: '3d', camera: { yaw: 1 } } as never;
    const scene = exchangeScene(exchangeGraphSnapshot(graph), {}, theme);
    expect(scene.nodes.find((node) => node.id === child.id)).toMatchObject({
      x: -60,
      y: 70,
      parentId: group.id,
    });
    expect(scene.nodes).toHaveLength(2);
    expect(scene.warnings[0].code).toBe('EDITABLE_FORMAT_FIDELITY');
  });
  it('selected exports retain internal connections and absolute geometry when an unselected parent is omitted', () => {
    const graph = blankGraph('Selected');
    const group = newNode(graph.diagram.id, { nodeType: 'group', x: 100, y: 100 });
    const a = newNode(graph.diagram.id, { title: 'A', parentId: group.id, x: 150, y: 150 });
    const b = newNode(graph.diagram.id, { title: 'B', x: 450, y: 150 });
    const c = newNode(graph.diagram.id, { title: 'C', x: 800, y: 150 });
    graph.nodes = [group, a, b, c];
    graph.edges = [
      newEdge(graph.diagram.id, a.id, b.id, { direction: 'both', style: 'dotted' }),
      newEdge(graph.diagram.id, b.id, c.id),
    ];
    const scene = exchangeScene(
      exchangeGraphSnapshot(graph),
      { scope: 'selected', nodeIds: [a.id, b.id] },
      theme,
    );
    expect(scene.nodes).toHaveLength(2);
    expect(scene.nodes[0]).toMatchObject({ x: 150, y: 150, parentId: undefined });
    expect(scene.edges).toHaveLength(1);
    expect(scene.edges[0]).toMatchObject({
      source: a.id,
      target: b.id,
      direction: 'both',
      style: 'dotted',
    });
    expect(
      scene.warnings.some((warning) => warning.code === 'SELECTION_BOUNDARY_CONNECTIONS'),
    ).toBe(true);
  });
  it('uses canonical timeline dates and rejects invalid time/geometry instead of generating a corrupt file', () => {
    const graph = blankGraph('Timeline', 'timeline');
    graph.diagram.settings.timelineScale = 'day';
    graph.nodes = [
      newNode(graph.diagram.id, {
        title: 'First',
        startDate: '2026-01-01',
        endDate: '2026-01-03',
        x: 900,
      }),
      newNode(graph.diagram.id, { title: 'Next', startDate: '2026-01-04', x: 100 }),
    ];
    const scene = exchangeScene(exchangeGraphSnapshot(graph), {}, theme);
    expect(scene.nodes[0]).toMatchObject({ x: 0, width: 300 });
    expect(scene.nodes[1].x).toBe(300);
    graph.nodes[0].startDate = 'invalid-date';
    expect(() => exchangeScene(exchangeGraphSnapshot(graph), {}, theme)).toThrow('finite');
  });
  it('rejects missing edges, group cycles and invalid selection without altering the authoritative model', () => {
    const graph = blankGraph('Validation');
    graph.nodes = [
      newNode(graph.diagram.id, { nodeType: 'group' }),
      newNode(graph.diagram.id, { nodeType: 'group' }),
    ];
    const snapshot = exchangeGraphSnapshot(graph);
    expect(() =>
      exchangeScene(snapshot, { scope: 'selected', nodeIds: ['unknown'] }, theme),
    ).toThrow('existing');
    graph.edges = [newEdge(graph.diagram.id, graph.nodes[0].id, 'missing')];
    expect(() => exchangeScene(exchangeGraphSnapshot(graph), {}, theme)).toThrow('missing node');
    graph.edges = [];
    graph.nodes[0].parentId = graph.nodes[1].id;
    graph.nodes[1].parentId = graph.nodes[0].id;
    expect(() => exchangeScene(exchangeGraphSnapshot(graph), {}, theme)).toThrow('Cyclic');
    expect(snapshot.nodes.every((node) => !node.parentId)).toBe(true);
  });
  it('exports explicit simulation assumptions but no live particles, hidden scenario/configuration or extra capacity nodes', () => {
    const graph = createSimulationGraph('Kiosk assumptions');
    const snapshot = exchangeGraphSnapshot(graph),
      scene = exchangeScene(snapshot, {}, theme);
    expect(snapshot.simulation).toBeUndefined();
    expect(scene.nodes).toHaveLength(graph.nodes.length);
    expect(
      scene.nodes.some((node) => node.detailLines.some((line) => line.startsWith('Processing:'))),
    ).toBe(true);
    expect(
      scene.nodes.some((node) => node.detailLines.some((line) => line.startsWith('Resource:'))),
    ).toBe(true);
    expect(scene.warnings.some((warning) => warning.code === 'SIMULATION_STRUCTURE_ONLY')).toBe(
      true,
    );
    expect(JSON.stringify(snapshot)).not.toMatch(/retention|scenarioId|ciphertext|scenarios/);
  });
  it('accepts portable literal colors and rejects CSS/URLs', () => {
    expect(exchangeColor('#abc', '#000000')).toBe('#AABBCC');
    expect(exchangeColor('rgb(31, 45, 40)', '#000000')).toBe('#1F2D28');
    expect(exchangeColor('rgba(1,2,3,1)', '#000000')).toBe('#010203');
    for (const unsafe of [
      'url(https://private.test)',
      '#fff;image=https://private.test',
      'var(--secret)',
      'rgba(1,2,3,0.1)',
    ])
      expect(exchangeColor(unsafe, '#000000')).toBe('#000000');
  });
  it('bounds the full document span as well as individual coordinates', () => {
    const graph = blankGraph('Extreme span');
    graph.nodes = [
      newNode(graph.diagram.id, { x: -16_000_000 }),
      newNode(graph.diagram.id, { x: 16_000_000 }),
    ];
    expect(() => exchangeScene(exchangeGraphSnapshot(graph), {}, theme)).toThrow(
      'document dimensions',
    );
    expect(
      exchangeScene(
        exchangeGraphSnapshot(graph),
        { scope: 'selected', nodeIds: [graph.nodes[0].id] },
        theme,
      ).nodes,
    ).toHaveLength(1);
  });
});
