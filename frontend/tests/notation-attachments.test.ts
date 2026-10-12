import { afterEach, describe, expect, it } from 'vitest';
import { blankGraph, newEdge, newNode, type GraphNode } from '../src/model/types';
import { notationAttachmentMoves, notationOwnedIds } from '../src/notation/attachments';
import { validateGraph } from '../src/model/validation';
import { copySelection, pasteSelection } from '../src/state/clipboard';
import { useEditor } from '../src/state/editor';
import * as THREE from 'three';
import { projectGraph } from '../src/canvas/projection';
import { spatialPositions } from '../src/spatial/layout';
import { moveSpatialObjects, spatialMovementIds } from '../src/spatial/movement';
import { spatialMovementPreview } from '../src/spatial/movementScene';
import { createSpatialBatches, disposeSpatialScene } from '../src/spatial/scene';
import { getSpatialNode, setSpatialNode } from '../src/spatial/types';

afterEach(() => useEditor.getState().setGraph(null));

function attachmentExamples() {
  const graph = blankGraph('Attached notation glyphs');
  const component = newNode(graph.diagram.id, {
    title: 'Component',
    x: 100,
    y: 100,
    notation: { collection: 'uml', symbol: 'component' },
  });
  const port = newNode(graph.diagram.id, {
    title: 'Port',
    x: 280,
    y: 145,
    notation: { collection: 'uml', symbol: 'port', attachmentId: component.id },
  });
  const task = newNode(graph.diagram.id, {
    title: 'Task',
    x: 500,
    y: 100,
    notation: { collection: 'bpmn', symbol: 'task' },
  });
  const boundary = newNode(graph.diagram.id, {
    title: 'Timer',
    x: 610,
    y: 180,
    notation: {
      collection: 'bpmn',
      symbol: 'boundary-event',
      attachmentId: task.id,
      properties: { eventDefinition: 'timer' },
    },
  });
  const lifeline = newNode(graph.diagram.id, {
    title: 'Lifeline',
    x: 850,
    y: 100,
    notation: { collection: 'uml', symbol: 'lifeline' },
  });
  const execution = newNode(graph.diagram.id, {
    title: 'Execution',
    x: 925,
    y: 190,
    notation: { collection: 'uml', symbol: 'activation', attachmentId: lifeline.id },
  });
  graph.nodes = [component, port, task, boundary, lifeline, execution];
  validateGraph(graph);
  return { graph, component, port, task, boundary, lifeline, execution };
}

describe('host-relative notation ownership', () => {
  it.each([
    ['component', 'port'],
    ['task', 'boundary'],
    ['lifeline', 'execution'],
  ] as const)('moves a %s with its %s at the same authored offset', (hostKey, glyphKey) => {
    const fixture = attachmentExamples(),
      host = fixture[hostKey],
      glyph = fixture[glyphKey];
    const original = structuredClone(fixture.graph.nodes);
    const moved = notationAttachmentMoves(
      fixture.graph.nodes,
      new Map([[host.id, { x: host.x + 70, y: host.y - 25 }]]),
    );
    expect(moved.get(glyph.id)).toEqual({ x: glyph.x + 70, y: glyph.y - 25 });
    expect([...moved.keys()].sort()).toEqual([host.id, glyph.id].sort());
    expect(fixture.graph.nodes).toEqual(original);
    expect(notationOwnedIds(fixture.graph.nodes, [host.id])).toEqual(new Set([host.id, glyph.id]));
  });

  it('preserves independent explicit coordinates in either bulk entry order and merges style-only patches', () => {
    const { graph, component, port } = attachmentExamples();
    for (const entries of [
      [
        [component.id, { x: 200, y: 220 }],
        [port.id, { x: 405 }],
      ],
      [
        [port.id, { x: 405 }],
        [component.id, { x: 200, y: 220 }],
      ],
    ] as Array<Array<[string, Partial<GraphNode>]>>) {
      expect(notationAttachmentMoves(graph.nodes, new Map(entries)).get(port.id)).toEqual({
        x: 405,
      });
    }
    const styled = notationAttachmentMoves(
      graph.nodes,
      new Map<string, Partial<GraphNode>>([
        [component.id, { x: 200 }],
        [port.id, { color: '#123456' }],
      ]),
    );
    expect(styled.get(port.id)).toEqual({ color: '#123456', x: 380, y: 145 });
    expect(
      notationAttachmentMoves(graph.nodes, new Map([[component.id, { title: 'Renamed' }]])),
    ).toEqual(new Map([[component.id, { title: 'Renamed' }]]));
  });

  it('translates overlapping native-group descendants and attached children once, including nested hosts', () => {
    const { graph, component, port } = attachmentExamples();
    const group = newNode(graph.diagram.id, { nodeType: 'group', x: 50, y: 50 });
    component.parentId = group.id;
    port.parentId = component.id;
    const action = newNode(graph.diagram.id, {
      x: 290,
      y: 155,
      parentId: component.id,
      notation: { collection: 'uml', symbol: 'action' },
    });
    const leaf = newNode(graph.diagram.id, {
      x: 300,
      y: 165,
      parentId: action.id,
      notation: { collection: 'uml', symbol: 'input-pin', attachmentId: action.id },
    });
    const nodes = [leaf, port, action, component, group];
    validateGraph({ ...graph, nodes });
    // The closure is independent of array order and retains every native descendant.
    expect(notationOwnedIds(nodes, [group.id, component.id])).toEqual(
      new Set(nodes.map((node) => node.id)),
    );
    const moved = notationAttachmentMoves(
      nodes,
      new Map([
        [group.id, { x: 130, y: 40 }],
        [component.id, { x: 180, y: 90 }],
      ]),
    );
    expect(moved.get(port.id)).toEqual({ x: 360, y: 135 });
    expect(moved.get(leaf.id)).toEqual({ x: 380, y: 155 });
    expect(moved.get(action.id)).toEqual({ x: 370, y: 145 });
    expect(moved.size).toBe(5);
    const skipped = notationAttachmentMoves(
      nodes,
      new Map([[group.id, { x: 130, y: 40 }]]),
      new Set([action.id]),
    );
    expect(skipped.has(port.id)).toBe(true);
    expect(skipped.has(action.id)).toBe(false);
    expect(skipped.has(leaf.id)).toBe(false);
  });

  it('copies hosts, attached glyphs and internal links, remapping references and retaining relative offsets', () => {
    const { graph, component, port, task, boundary } = attachmentExamples();
    graph.edges = [
      newEdge(graph.diagram.id, component.id, port.id, {
        notation: { collection: 'uml', symbol: 'dependency' },
      }),
      newEdge(graph.diagram.id, component.id, task.id),
    ];
    const original = structuredClone(graph);
    for (const selected of [[component.id], [port.id], [port.id, component.id]]) {
      const clip = copySelection(graph, selected);
      expect(clip.nodes.map((node) => node.id)).toEqual([component.id, port.id]);
      expect(clip.edges).toEqual([graph.edges[0]]);
      const pasted = pasteSelection(clip, graph, 40),
        host = pasted.nodes[0],
        glyph = pasted.nodes[1];
      expect(glyph.notation?.attachmentId).toBe(host.id);
      expect(glyph.x - host.x).toBe(port.x - component.x);
      expect(glyph.y - host.y).toBe(port.y - component.y);
      expect(pasted.edges[0]).toMatchObject({ sourceNodeId: host.id, targetNodeId: glyph.id });
      validateGraph({
        ...graph,
        nodes: [...graph.nodes, ...pasted.nodes],
        edges: [...graph.edges, ...pasted.edges],
      });
    }
    expect(copySelection(graph, [task.id]).nodes.map((node) => node.id)).toEqual([
      task.id,
      boundary.id,
    ]);
    expect(graph).toEqual(original);
  });

  it('preserves ordinary topic selection and does not treat related-node annotations as owned glyphs', () => {
    const { graph, component, port } = attachmentExamples();
    const topic = newNode(graph.diagram.id, { parentId: component.id, title: 'Topic' }),
      reference = newNode(graph.diagram.id, {
        notation: { collection: 'uml', symbol: 'time-observation', relatedNodeId: component.id },
      });
    graph.nodes.push(topic, reference);
    expect(copySelection(graph, [component.id]).nodes.map((node) => node.id)).toEqual([
      component.id,
      port.id,
    ]);
    const clip = copySelection(graph, [reference.id]);
    expect(clip.nodes).toHaveLength(1);
    expect(pasteSelection(clip, graph).nodes[0].notation?.relatedNodeId).toBeUndefined();
    expect(copySelection(graph, [topic.id]).nodes[0].parentId).toBeUndefined();
  });

  it('uses the same translation for editor updates and restores hosts and attached glyphs together on undo', () => {
    const { graph, task, boundary } = attachmentExamples();
    useEditor.getState().setGraph(graph);
    useEditor.getState().updateNode(task.id, { x: 575, y: 60 });
    const next = useEditor.getState().graph!;
    expect(next.nodes.find((node) => node.id === boundary.id)).toMatchObject({ x: 685, y: 140 });
    validateGraph(next);
    useEditor.getState().undo();
    expect(useEditor.getState().graph).toEqual(graph);
    useEditor.getState().redo();
    expect(useEditor.getState().graph).toEqual(next);
  });

  it.each([
    ['component', 'port'],
    ['task', 'boundary'],
    ['lifeline', 'execution'],
  ] as const)(
    'previews and commits 3D host movement with its %s/%s pair while retaining independent depths',
    (hostKey, glyphKey) => {
      const fixture = attachmentExamples(),
        host = fixture[hostKey],
        glyph = fixture[glyphKey];
      fixture.graph.nodes = fixture.graph.nodes.map((node) =>
        node.id === host.id
          ? setSpatialNode(node, { version: 1, position: { x: 2, y: 3, z: 4 } })
          : node.id === glyph.id
            ? setSpatialNode(node, { version: 1, position: { x: 2.5, y: 2, z: -3 } })
            : node,
      );
      const topic = newNode(fixture.graph.diagram.id, {
        parentId: host.id,
        title: 'Independent topic',
      });
      fixture.graph.nodes.push(topic);
      const graph = fixture.graph,
        original = structuredClone(graph),
        chosen = spatialMovementIds(graph, [host.id]);
      expect(chosen).toEqual(new Set([host.id, glyph.id]));
      const projected = projectGraph(graph, []),
        positions = spatialPositions(graph),
        batches = createSpatialBatches(projected.nodes, projected.edges, positions),
        preview = spatialMovementPreview(batches, new THREE.Group(), chosen, projected.edges, 1);
      try {
        preview.update({ x: 1.25, y: -0.75, z: 0 });
        for (const id of chosen)
          expect(batches.nodes.get(id)!.position.toArray()).toEqual([
            positions.get(id)!.x + 1.25,
            positions.get(id)!.y - 0.75,
            positions.get(id)!.z,
          ]);
        expect(graph).toEqual(original);
        preview.restore();
        for (const id of chosen)
          expect(batches.nodes.get(id)!.position.toArray()).toEqual([
            positions.get(id)!.x,
            positions.get(id)!.y,
            positions.get(id)!.z,
          ]);
        const moved = moveSpatialObjects(graph, [host.id], { x: 1.25, y: -0.75, z: 99 });
        for (const node of moved.nodes) {
          const before = graph.nodes.find((candidate) => candidate.id === node.id)!;
          expect([node.x, node.y, node.parentId]).toEqual([before.x, before.y, before.parentId]);
          if (chosen.has(node.id))
            expect(getSpatialNode(node)!.position).toEqual({
              x: positions.get(node.id)!.x + 1.25,
              y: positions.get(node.id)!.y - 0.75,
              z: positions.get(node.id)!.z,
            });
          else expect(node).toBe(before);
        }
        validateGraph(moved);
      } finally {
        disposeSpatialScene(batches.group);
      }
    },
  );
});
