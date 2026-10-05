import { beforeEach, expect, it } from 'vitest';
import { blankGraph, newNode } from '../src/model/types';
import { useEditor } from '../src/state/editor';
import { colorPalette, contrast, topicInk } from '../src/ui/colors';
import { iconKey, withIcon } from '../src/ui/icons';
import { mindmapTopics } from '../src/mindmap/tree';

beforeEach(() => useEditor.getState().setGraph(null));

it('keeps topic text readable across the palette and custom pale or mid-tone colors', () => {
  for (const color of [
    ...colorPalette.map((choice) => choice.value),
    '#ffffff',
    '#000000',
    '#777777',
    '#888888',
    '#92cc8c',
    '#b8e9c4',
    '#00ff00',
  ])
    expect(contrast(color, topicInk(color))).toBeGreaterThanOrEqual(4.5);
  expect(contrast('#23664d', '#e7f0e9')).toBeGreaterThanOrEqual(4.5);
});

it('preserves custom metadata when assigning, copying and clearing domain icons', () => {
  const metadata = { integration: { externalId: 'launch-1' }, visualNerve: { pinned: true } };
  const changed = withIcon(metadata, 'work');
  expect(changed).toEqual({ ...metadata, visualNerve: { pinned: true, icon: 'work' } });
  expect(metadata.visualNerve).toEqual({ pinned: true });
  expect(iconKey(changed)).toBe('work');
  expect(iconKey(withIcon(changed, 'unknown-plugin-icon'))).toBe('');
  const graph = blankGraph('Icons', 'mindmap');
  const node = newNode(graph.diagram.id, { metadata: changed });
  graph.nodes = [node];
  useEditor.getState().setGraph(graph);
  useEditor.getState().select([node.id]);
  useEditor.getState().paste(useEditor.getState().copy()!);
  expect(useEditor.getState().graph!.nodes[1].metadata).toEqual(changed);
  expect(withIcon(changed, '').visualNerve).toEqual({ pinned: true, icon: '' });
});

it('commits an inline draft when changing selection and retains a single undoable edit', () => {
  const graph = blankGraph('Editing', 'mindmap');
  const first = newNode(graph.diagram.id, { title: 'First' });
  const second = newNode(graph.diagram.id, { title: 'Second' });
  graph.nodes = [first, second];
  useEditor.getState().setGraph(graph);
  useEditor.getState().select([first.id]);
  useEditor.getState().beginEditing(first.id);
  useEditor.setState({ editingTitle: 'A useful draft' });
  useEditor.getState().beginEditing(first.id);
  expect(useEditor.getState().editingTitle).toBe('A useful draft');
  useEditor.getState().select([second.id]);
  expect(useEditor.getState().graph!.nodes[0].title).toBe('A useful draft');
  expect(useEditor.getState().editingNode).toBeNull();
  expect(useEditor.getState().history).toHaveLength(1);
  useEditor.getState().undo();
  expect(useEditor.getState().graph).toEqual(graph);
  useEditor.getState().beginEditing(first.id);
  useEditor.setState({ editingTitle: 'Cancelled' });
  useEditor.getState().finishEditing(false);
  expect(useEditor.getState().graph).toEqual(graph);
});

it('creates thirty topic levels with inherited colors and restores an entire deleted branch', () => {
  const graph = blankGraph('Many levels', 'mindmap');
  const root = newNode(graph.diagram.id, { title: 'Root' });
  graph.nodes = [root];
  useEditor.getState().setGraph(graph);
  useEditor.getState().select([root.id]);
  const ids: string[] = [];
  for (let depth = 1; depth <= 30; depth++) {
    const id = useEditor.getState().child()!;
    ids.push(id);
    useEditor.getState().beginEditing(id);
    useEditor.setState({ editingTitle: `Level ${depth}` });
    useEditor.getState().finishEditing();
  }
  useEditor.getState().updateNode(ids[0], { color: '#226d72' });
  const deep = structuredClone(useEditor.getState().graph!);
  const topics = mindmapTopics(deep.nodes);
  ids.forEach((id, index) =>
    expect(topics.get(id)).toEqual({
      depth: index + 1,
      color: '#226d72',
      side: 'right',
    }),
  );
  useEditor.getState().select([ids[0]]);
  useEditor.getState().remove(true);
  expect(useEditor.getState().graph!.nodes).toEqual([root]);
  expect(useEditor.getState().graph!.edges).toEqual([]);
  useEditor.getState().undo();
  expect(useEditor.getState().graph).toEqual(deep);
  useEditor.getState().select([ids[0]]);
  useEditor.getState().remove();
  expect(useEditor.getState().graph!.nodes).toHaveLength(30);
  expect(
    useEditor.getState().graph!.nodes.find((node) => node.id === ids[1])?.parentId,
  ).toBeUndefined();
});
