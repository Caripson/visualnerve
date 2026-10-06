import type { ComponentType } from 'react';
import type { NodeProps } from '@xyflow/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CanvasNode } from '../src/canvas/projection';
import { MindmapNode } from '../src/mindmap/Topic';
import { newNode } from '../src/model/types';
import { nodeTypes } from '../src/nodes/registry';
import { useEditor } from '../src/state/editor';
import { NodeStatus } from '../src/ui/NodeStatus';
import { nodeStatuses, statusLabel } from '../src/ui/status';

const viewport = vi.hoisted(() => ({ zoom: 1 }));
vi.mock('@xyflow/react', async (original) => ({
  ...(await original<typeof import('@xyflow/react')>()),
  Handle: () => null,
  NodeResizer: () => null,
  useStore: (selector: (state: { transform: [number, number, number] }) => unknown) =>
    selector({ transform: [0, 0, viewport.zoom] }),
}));

beforeEach(() => {
  viewport.zoom = 1;
  useEditor.getState().setGraph(null);
});

it('uses readable shared labels and preserves custom statuses without treating them as CSS classes', () => {
  expect(statusLabel()).toBe('None');
  expect(statusLabel('')).toBe('None');
  expect(nodeStatuses.map((status) => statusLabel(status.value))).toEqual([
    'Planned',
    'In progress',
    'Blocked',
    'Done',
  ]);
  expect(statusLabel('Needs legal review')).toBe('Needs legal review');
  const { rerender } = render(<NodeStatus status="Needs legal review" />);
  const badge = screen.getByRole('img', { name: 'Status: Needs legal review' });
  expect(badge).toHaveTextContent('Needs legal review');
  expect(badge).toHaveClass('status-custom');
  rerender(<NodeStatus status="" />);
  expect(screen.queryByTestId('node-status')).toBeNull();
});

const renderers: [string, ComponentType<NodeProps<CanvasNode>>][] = [
  ['ordinary object', nodeTypes.generic],
  ['group', nodeTypes.group],
  ['mindmap topic', MindmapNode],
];

it.each(renderers)(
  'keeps Done text and a check visible in %s overview and export while preserving its color',
  (_, Component) => {
    const node = newNode('diagram', {
      title: 'Ready to publish',
      color: '#965de1',
      status: 'done',
    });
    const props = (exporting = false, selected = false): NodeProps<CanvasNode> => ({
      id: node.id,
      type: 'generic',
      selected,
      dragging: false,
      draggable: true,
      selectable: true,
      deletable: true,
      zIndex: 0,
      isConnectable: true,
      positionAbsoluteX: node.x,
      positionAbsoluteY: node.y,
      data: {
        node,
        owners: [],
        childCount: 0,
        exporting,
        mindmap: { depth: 1, color: node.color!, side: 'right' },
      },
    });
    const { rerender } = render(<Component {...props()} />);
    const checkStatus = () => {
      const object = screen.getByTestId('graph-node');
      const badge = screen.getByRole('img', { name: 'Status: Done' });
      expect(object).toHaveAttribute('data-node-status', 'done');
      expect(object).toHaveTextContent('Ready to publish');
      expect(badge).toHaveTextContent('Done');
      expect(badge.querySelector('svg[data-status-icon="done"]')).not.toBeNull();
      expect(
        object.style.getPropertyValue('--node-accent') ||
          object.style.getPropertyValue('--branch-color'),
      ).toBe('#965de1');
      return badge;
    };
    expect(checkStatus()).not.toHaveClass('node-status-overview');
    viewport.zoom = 0.15;
    rerender(<Component {...props()} />);
    expect(checkStatus()).toHaveClass('node-status-overview');
    rerender(<Component {...props(true)} />);
    expect(checkStatus()).not.toHaveClass('node-status-overview');
    rerender(<Component {...props(false, true)} />);
    checkStatus();
    expect(screen.getByTestId('graph-node')).toHaveClass('is-selected');
  },
);
