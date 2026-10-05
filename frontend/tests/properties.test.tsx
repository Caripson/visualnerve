import { beforeEach, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Properties } from '../src/components/Properties';
import { useEditor } from '../src/state/editor';
import { base, blankGraph, newNode } from '../src/model/types';
beforeEach(() => useEditor.getState().setGraph(null));
it('edits selected node properties and assigns a first-class owner as an undoable command', () => {
  const graph = blankGraph('Launch');
  const node = newNode(graph.diagram.id, { title: 'Research' });
  graph.nodes.push(node);
  const owner = {
    ...base(),
    name: 'Johan',
    kind: 'person' as const,
    color: '#31766c',
    metadata: {},
  };
  useEditor.getState().setGraph(graph);
  useEditor.setState({ selectedNodes: [node.id], owners: [owner] });
  render(<Properties />);
  fireEvent.change(screen.getByLabelText('Node title'), { target: { value: 'Market research' } });
  expect(useEditor.getState().graph?.nodes[0].title).toBe('Market research');
  fireEvent.change(screen.getByLabelText('Node owner'), { target: { value: owner.id } });
  expect(useEditor.getState().graph?.nodes[0].ownerIds).toEqual([owner.id]);
  useEditor.getState().undo();
  expect(useEditor.getState().graph?.nodes[0].ownerIds).toEqual([]);
});
