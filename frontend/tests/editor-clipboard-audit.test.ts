import { afterEach, describe, expect, it } from 'vitest';
import { blankGraph, newEdge, newNode, type Graph } from '../src/model/types';
import { copySelection, pasteSelection, type Clip } from '../src/state/clipboard';
import { useEditor } from '../src/state/editor';
import { getSpatialNode, setSpatialNode } from '../src/spatial/types';
import { createSimulationGraph } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';

afterEach(() => useEditor.getState().setGraph(null));

function nestedGroup() {
  const graph = blankGraph('Nested group');
  const outside = newNode(graph.diagram.id, { title: 'Outside' });
  const group = newNode(graph.diagram.id, { title: 'Outer', nodeType: 'group', x: 200, y: 100 });
  const inner = newNode(graph.diagram.id, {
    title: 'Inner',
    nodeType: 'group',
    parentId: group.id,
    x: 250,
    y: 160,
  });
  const first = newNode(graph.diagram.id, {
    title: 'First',
    parentId: inner.id,
    x: 270,
    y: 190,
    color: '#126783',
    metadata: { label: 'Keep' },
  });
  const second = newNode(graph.diagram.id, { title: 'Second', parentId: group.id, x: 420, y: 240 });
  graph.nodes = [
    outside,
    group,
    inner,
    setSpatialNode(first, { version: 1, position: { x: 2, y: 1, z: 3 } }),
    second,
  ];
  graph.edges = [
    newEdge(graph.diagram.id, first.id, second.id, { direction: 'backward' }),
    newEdge(graph.diagram.id, outside.id, first.id),
  ];
  return { graph, group, inner, first, second, outside };
}

describe('native group clipboard preserves its subtree', () => {
  it('copies a selected frame with nested members and internal edges exactly once', () => {
    const { graph, group, inner, first, second } = nestedGroup();
    const original = structuredClone(graph);
    const clip = copySelection(graph, [group.id, inner.id, first.id]);
    expect(clip.nodes.map((node) => node.id)).toEqual([group.id, inner.id, first.id, second.id]);
    expect(clip.edges).toEqual([graph.edges[0]]);
    const pasted = pasteSelection(clip, graph);
    const byTitle = new Map(pasted.nodes.map((node) => [node.title, node]));
    expect(byTitle.get('Inner')!.parentId).toBe(byTitle.get('Outer')!.id);
    expect(byTitle.get('First')!.parentId).toBe(byTitle.get('Inner')!.id);
    expect(byTitle.get('Second')!.parentId).toBe(byTitle.get('Outer')!.id);
    expect(byTitle.get('First')).toMatchObject({
      x: first.x + 40,
      y: first.y + 40,
      color: '#126783',
      metadata: { label: 'Keep' },
    });
    expect(getSpatialNode(byTitle.get('First')!)?.position).toEqual({
      x: 2 + 40 / 120,
      y: 1 - 40 / 120,
      z: 3,
    });
    expect(pasted.edges[0]).toMatchObject({
      sourceNodeId: byTitle.get('First')!.id,
      targetNodeId: byTitle.get('Second')!.id,
      direction: 'backward',
    });
    expect(new Set(pasted.nodes.map((node) => node.id)).size).toBe(4);
    expect(graph).toEqual(original);
  });

  it('makes duplicate and undo operate on the complete group, including collapsed children', () => {
    const { graph, group } = nestedGroup();
    group.collapsed = true;
    useEditor.getState().setGraph(graph);
    useEditor.getState().select([group.id]);
    const clip = useEditor.getState().copy()!;
    useEditor.getState().paste(clip);
    expect(useEditor.getState().graph!.nodes).toHaveLength(9);
    expect(useEditor.getState().selectedNodes).toHaveLength(4);
    expect(useEditor.getState().graph!.edges).toHaveLength(3);
    useEditor.getState().undo();
    expect(useEditor.getState().graph).toEqual(graph);
    useEditor.getState().redo();
    expect(useEditor.getState().graph!.nodes).toHaveLength(9);
  });

  it('continues copying only explicitly selected mind-map topics and detaches their external parents', () => {
    const graph = blankGraph('Mind map', 'mindmap');
    const root = newNode(graph.diagram.id, { title: 'Root' });
    const branch = newNode(graph.diagram.id, { title: 'Branch', parentId: root.id });
    const leaf = newNode(graph.diagram.id, { title: 'Leaf', parentId: branch.id });
    graph.nodes = [root, branch, leaf];
    const clip = copySelection(graph, [branch.id]);
    expect(clip.nodes).toHaveLength(1);
    expect(clip.nodes[0].parentId).toBeUndefined();
    expect(pasteSelection(clip, graph).nodes[0].parentId).toBeUndefined();
    const legacyClip = { ...clip, nodes: [{ ...clip.nodes[0], parentId: root.id }] };
    expect(pasteSelection(legacyClip, graph).nodes[0].parentId).toBeUndefined();
    expect(graph.nodes[1].parentId).toBe(root.id);
  });
});

describe('malformed clipboard cannot mutate authoritative editor state', () => {
  it('preserves selection when semantic validation rejects an otherwise valid simulation clipboard', () => {
    const graph = createSimulationGraph('Rejected simulation paste', createBasicModel());
    const work = graph.simulation!.nodes.find((node) => node.type === 'work')!;
    const clip = copySelection(graph, [work.id]);
    const copiedWork = clip.simulation!.model.nodes.find((node) => node.type === 'work')!;
    if (copiedWork.type === 'work') copiedWork.work.capacity = -1;
    useEditor.getState().setGraph(graph);
    useEditor.getState().select([graph.nodes[0].id], [graph.edges[0].id]);
    const before = useEditor.getState();
    useEditor.getState().paste(clip);
    const after = useEditor.getState();
    expect(after.graph).toBe(before.graph);
    expect(after.history).toBe(before.history);
    expect(after.selectedNodes).toBe(before.selectedNodes);
    expect(after.selectedEdges).toBe(before.selectedEdges);
    expect(after.editRevision).toBe(before.editRevision);
    expect(after.status).toBe('error');
    expect(after.commandError).toContain('work capacity');
    expect(after.message).toBe(after.commandError);
  });

  const mutations: Array<[string, (clip: Clip, graph: Graph) => void]> = [
    [
      'duplicate node IDs',
      (clip) => {
        clip.nodes.push(structuredClone(clip.nodes[0]));
      },
    ],
    [
      'non-UUID node ID',
      (clip) => {
        clip.nodes[0].id = 'invalid';
      },
    ],
    [
      'missing source',
      (clip) => {
        clip.edges[0].sourceNodeId = crypto.randomUUID();
      },
    ],
    [
      'missing target',
      (clip) => {
        clip.edges[0].targetNodeId = crypto.randomUUID();
      },
    ],
    [
      'duplicate edge ID',
      (clip) => {
        clip.edges.push(structuredClone(clip.edges[0]));
      },
    ],
    [
      'invalid parent ID',
      (clip) => {
        clip.nodes[0].parentId = 'invalid';
      },
    ],
    [
      'self parent',
      (clip) => {
        clip.nodes[0].parentId = clip.nodes[0].id;
      },
    ],
    [
      'parent cycle',
      (clip) => {
        clip.nodes[0].parentId = clip.nodes[1].id;
        clip.nodes[1].parentId = clip.nodes[0].id;
      },
    ],
    [
      'unsafe geometry',
      (clip) => {
        clip.nodes[0].x = Number.NaN;
      },
    ],
    [
      'missing node metadata',
      (clip) => {
        Reflect.deleteProperty(clip.nodes[0], 'metadata');
      },
    ],
    [
      'invalid node tags',
      (clip) => {
        Reflect.set(clip.nodes[0], 'tags', 'wrong');
      },
    ],
    [
      'invalid edge direction',
      (clip) => {
        Reflect.set(clip.edges[0], 'direction', 'wrong');
      },
    ],
    [
      'null node',
      (clip) => {
        Reflect.set(clip.nodes, '0', null);
      },
    ],
  ];
  it.each(mutations)('rejects %s before graph/history/selection changes', (_, mutate) => {
    const { graph, group, first } = nestedGroup();
    const clip = copySelection(graph, [group.id]);
    mutate(clip, graph);
    useEditor.getState().setGraph(graph);
    useEditor.getState().select([first.id]);
    const before = useEditor.getState();
    useEditor.getState().paste(clip);
    const after = useEditor.getState();
    expect(after.status).toBe('error');
    expect(after.message).toBeTruthy();
    expect(after.graph).toBe(before.graph);
    expect(after.history).toBe(before.history);
    expect(after.selectedNodes).toBe(before.selectedNodes);
    expect(after.selectedEdges).toBe(before.selectedEdges);
  });
});
