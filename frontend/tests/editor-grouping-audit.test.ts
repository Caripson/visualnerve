import { afterEach, expect, it } from 'vitest';
import { blankGraph, newNode } from '../src/model/types';
import { useEditor } from '../src/state/editor';
import { GroupMembership } from '../src/state/group-membership';
import { validateGraph } from '../src/model/validation';

afterEach(() => useEditor.getState().setGraph(null));

it('ungroups an inner container into its surviving outer group without moving its contents', () => {
  const graph = blankGraph('Nested containers');
  const outer = newNode(graph.diagram.id, { nodeType: 'group', x: 100, y: 100 });
  const inner = newNode(graph.diagram.id, {
    nodeType: 'group',
    parentId: outer.id,
    x: 150,
    y: 130,
  });
  const member = newNode(graph.diagram.id, { parentId: inner.id, x: 190, y: 180 });
  graph.nodes = [outer, inner, member];
  useEditor.getState().setGraph(graph);
  useEditor.getState().select([inner.id]);
  useEditor.getState().ungroup();
  const next = useEditor.getState().graph!;
  expect(next.nodes.find((node) => node.id === member.id)).toEqual({
    ...member,
    parentId: outer.id,
  });
  expect(next.nodes.map((node) => node.id)).toEqual([outer.id, member.id]);
  validateGraph(next);
  useEditor.getState().undo();
  expect(useEditor.getState().graph!.nodes).toEqual(graph.nodes);
  useEditor.getState().redo();
  expect(useEditor.getState().graph!.nodes).toEqual(next.nodes);
});

it('promotes contents through several simultaneously removed groups regardless of array order', () => {
  const graph = blankGraph('Three levels');
  const root = newNode(graph.diagram.id, { nodeType: 'group' });
  const middle = newNode(graph.diagram.id, { nodeType: 'group', parentId: root.id });
  const inner = newNode(graph.diagram.id, { nodeType: 'group', parentId: middle.id });
  const child = newNode(graph.diagram.id, { parentId: inner.id });
  const result = new GroupMembership(
    [child, inner, middle, root],
    new Set([inner.id, middle.id]),
  ).ungroup();
  expect(result).toEqual([{ ...child, parentId: root.id }, root]);
});

it('ungroups a deeply nested valid container chain without recursive stack growth', () => {
  const graph = blankGraph('Deep containers');
  for (let index = 0; index < 6000; index++) {
    graph.nodes.push(
      newNode(graph.diagram.id, { nodeType: 'group', parentId: graph.nodes.at(-1)?.id }),
    );
  }
  const child = newNode(graph.diagram.id, { parentId: graph.nodes.at(-1)!.id });
  graph.nodes.push(child);
  const result = new GroupMembership(
    graph.nodes,
    new Set(graph.nodes.slice(0, -1).map((node) => node.id)),
  ).ungroup();
  expect(result).toEqual([{ ...child, parentId: undefined }]);
});
