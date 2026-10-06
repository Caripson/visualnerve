import { afterEach, describe, expect, it } from 'vitest';
import { csvGraph, defaultAnalysis, getCsvAnalysis, getCsvNode, parseCsv } from '../src/data/csv';
import type { CsvAnalysis } from '../src/data/types';
import type { Graph } from '../src/model/types';
import { newEdge, newNode } from '../src/model/types';
import { useEditor } from '../src/state/editor';

afterEach(() => useEditor.getState().setGraph(null));

function fixture() {
  const dataset = parseCsv('Region,Product\nNord,A\nNord,B\nSyd,C', 'Customers.csv');
  const analysis: CsvAnalysis = { ...defaultAnalysis(dataset), levels: ['c0', 'c1'] };
  const graph = csvGraph(dataset, analysis);
  const north = graph.nodes.find((node) => node.title === 'Nord')!;
  const south = graph.nodes.find((node) => node.title === 'Syd')!;
  const product = graph.nodes.find((node) => node.title === 'A')!;
  const edge = graph.edges.find((item) => item.targetNodeId === north.id)!;
  return { dataset, analysis, graph, north, south, product, edge };
}

function canonical(graph: Graph) {
  return {
    ...graph,
    nodes: [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...graph.edges].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

describe('editable CSV relationships', () => {
  it('keeps preset and custom object statuses through node edits, history and CSV navigation', () => {
    const { dataset, analysis, graph, north, product } = fixture();
    const values = ['done', 'planned', 'in-progress', 'blocked', 'Väntar på granskning'];
    graph.nodes = graph.nodes.map((node, index) => ({ ...node, status: values[index] }));
    const annotation = newNode(graph.diagram.id, {
      title: 'Manual annotation',
      status: 'Review with customer',
    });
    graph.nodes.push(annotation);
    const editor = useEditor.getState();
    editor.setGraph(graph);
    const before = graph.nodes.find((node) => node.id === north.id)!;
    editor.updateNode(north.id, { status: 'done' });
    const changed = useEditor.getState().graph!;
    expect(changed.nodes.find((node) => node.id === north.id)).toEqual({
      ...before,
      status: 'done',
    });
    expect(changed.dataset).toBe(dataset);
    expect(useEditor.getState().history.at(-1)!.nodes).toHaveLength(1);
    editor.undo();
    expect(useEditor.getState().graph!.nodes.find((node) => node.id === north.id)).toEqual(before);
    editor.redo();
    expect(useEditor.getState().graph!.nodes.find((node) => node.id === north.id)!.status).toBe(
      'done',
    );
    const statuses = new Map(changed.nodes.map((node) => [node.id, node.status]));
    editor.updateNode(product.id, { title: 'Renamed product', x: product.x + 40 });
    expect(useEditor.getState().graph!.nodes.find((node) => node.id === product.id)!.status).toBe(
      statuses.get(product.id),
    );
    const configurations: CsvAnalysis[] = [
      {
        ...analysis,
        filters: [{ id: 'south', columnId: 'c0', operation: 'equals', value: 'Syd' }],
      },
      { ...analysis, focusPath: [{ columnId: 'c0', value: 'Nord' }] },
      { ...analysis, offset: 1, limit: 1 },
      { ...analysis, levels: ['c1'] },
      analysis,
    ];
    for (const config of configurations) {
      editor.command('Configure CSV', (current) => csvGraph(dataset, config, current));
      const current = useEditor.getState().graph!;
      for (const [id, status] of statuses) {
        expect(current.nodes.find((node) => node.id === id)).toMatchObject({ id, status });
      }
      expect(current.dataset).toBe(dataset);
    }
    expect(
      getCsvNode(useEditor.getState().graph!.nodes.find((node) => node.id === north.id)!)!.visible,
    ).toBe(true);
    for (let index = 0; index < configurations.length; index++) {
      editor.undo();
      for (const [id, status] of statuses) {
        expect(useEditor.getState().graph!.nodes.find((node) => node.id === id)!.status).toBe(
          status,
        );
      }
    }
    editor.undo();
    expect(useEditor.getState().graph!.nodes.find((node) => node.id === product.id)!.title).toBe(
      product.title,
    );
    editor.undo();
    expect(useEditor.getState().graph!.nodes.find((node) => node.id === north.id)!.status).toBe(
      before.status,
    );
  });

  it('keeps an explicit hierarchy deletion through regroup/filter/focus and restores both node preference and edge with undo', () => {
    const { dataset, analysis, graph, north, edge } = fixture();
    const editor = useEditor.getState();
    editor.setGraph(graph);
    editor.select([], [edge.id]);
    editor.remove();
    const deleted = useEditor.getState().graph!;
    expect(deleted.edges.some((item) => item.id === edge.id)).toBe(false);
    expect(deleted.nodes.find((node) => node.id === north.id)?.parentId).toBe(north.parentId);
    expect(getCsvNode(deleted.nodes.find((node) => node.id === north.id)!)).toMatchObject({
      suppressParentConnection: true,
    });
    expect(useEditor.getState().history[0].nodes).toHaveLength(1);
    expect(useEditor.getState().history[0].edges).toHaveLength(1);
    editor.undo();
    expect(canonical(useEditor.getState().graph!)).toEqual(canonical(graph));
    editor.redo();
    expect(canonical(useEditor.getState().graph!)).toEqual(canonical(deleted));

    const snapshots = [deleted];
    const configurations: CsvAnalysis[] = [
      { ...analysis, levels: ['c0'] },
      {
        ...analysis,
        filters: [{ id: 'south', columnId: 'c0', operation: 'equals', value: 'Syd' }],
      },
      { ...analysis, focusPath: [{ columnId: 'c0', value: 'Nord' }] },
      analysis,
    ];
    for (const config of configurations) {
      editor.command('Configure CSV', (current) => csvGraph(dataset, config, current));
      const next = useEditor.getState().graph!;
      snapshots.push(next);
      expect(getCsvNode(next.nodes.find((node) => node.id === north.id)!)).toMatchObject({
        suppressParentConnection: true,
      });
      expect(
        next.edges.some(
          (item) => item.targetNodeId === north.id && item.metadata.csvGenerated === true,
        ),
      ).toBe(false);
    }
    expect(getCsvNode(snapshots[2].nodes.find((node) => node.id === north.id)!)?.visible).toBe(
      false,
    );
    expect(snapshots[3].nodes.find((node) => node.id === north.id)?.parentId).toBeUndefined();
    for (let index = snapshots.length - 2; index >= 0; index--) {
      editor.undo();
      expect(canonical(useEditor.getState().graph!)).toEqual(canonical(snapshots[index]));
    }
    editor.undo();
    expect(canonical(useEditor.getState().graph!)).toEqual(canonical(graph));
    editor.redo();
    expect(canonical(useEditor.getState().graph!)).toEqual(canonical(deleted));
    expect(getCsvAnalysis(useEditor.getState().graph!)).toEqual(analysis);
  });

  it.each(['source', 'target', 'both'] as const)(
    'converts a generated edge when reconnecting its %s and preserves the chosen endpoints through navigation',
    (endpoint) => {
      const { dataset, analysis, graph, north, south, product, edge } = fixture();
      Object.assign(edge, {
        label: 'Edited relationship',
        direction: 'both',
        style: 'dashed',
        description: 'Relationship notes',
        metadata: { ...edge.metadata, userComment: 'Keep this' },
      });
      const editor = useEditor.getState();
      editor.setGraph(graph);
      editor.updateEdge(edge.id, {
        ...(endpoint !== 'target' ? { sourceNodeId: product.id } : {}),
        ...(endpoint !== 'source' ? { targetNodeId: south.id } : {}),
      });
      const reconnected = useEditor.getState().graph!;
      const relation = reconnected.edges.find((item) => item.id === edge.id)!;
      expect(relation).toEqual({
        ...edge,
        sourceNodeId: endpoint === 'target' ? edge.sourceNodeId : product.id,
        targetNodeId: endpoint === 'source' ? edge.targetNodeId : south.id,
        metadata: { ...edge.metadata, csvGenerated: false },
      });
      expect(
        getCsvNode(reconnected.nodes.find((node) => node.id === north.id)!)
          ?.suppressParentConnection,
      ).toBe(true);
      editor.undo();
      expect(canonical(useEditor.getState().graph!)).toEqual(canonical(graph));
      editor.redo();
      expect(canonical(useEditor.getState().graph!)).toEqual(canonical(reconnected));
      const filtered = csvGraph(
        dataset,
        {
          ...analysis,
          filters: [{ id: 'south', columnId: 'c0', operation: 'equals', value: 'Syd' }],
        },
        reconnected,
      );
      const focused = csvGraph(
        dataset,
        { ...analysis, focusPath: [{ columnId: 'c0', value: 'Syd' }] },
        filtered,
      );
      const restored = csvGraph(dataset, analysis, focused);
      for (const current of [filtered, focused, restored]) {
        expect(current.edges.find((item) => item.id === edge.id)).toEqual(relation);
        expect(
          current.edges.some(
            (item) =>
              item.sourceNodeId === edge.sourceNodeId &&
              item.targetNodeId === edge.targetNodeId &&
              item.metadata.csvGenerated === true,
          ),
        ).toBe(false);
      }
    },
  );

  it('keeps generated status for connection style edits and does not suppress a parent when deleting a manual link', () => {
    const { graph, north, south, edge } = fixture();
    const link = newEdge(graph.diagram.id, north.id, south.id);
    graph.edges.push(link);
    const editor = useEditor.getState();
    editor.setGraph(graph);
    editor.updateEdge(edge.id, {
      label: 'My branch',
      style: 'dotted',
      sourceNodeId: edge.sourceNodeId,
    });
    expect(useEditor.getState().graph!.edges.find((item) => item.id === edge.id)).toMatchObject({
      label: 'My branch',
      style: 'dotted',
      metadata: { csvGenerated: true },
    });
    expect(
      getCsvNode(useEditor.getState().graph!.nodes.find((node) => node.id === north.id)!)
        ?.suppressParentConnection,
    ).toBeUndefined();
    editor.select([], [link.id]);
    editor.remove();
    expect(
      getCsvNode(useEditor.getState().graph!.nodes.find((node) => node.id === south.id)!)
        ?.suppressParentConnection,
    ).toBeUndefined();
  });
});
