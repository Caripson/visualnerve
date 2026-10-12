import { render } from '@testing-library/react';
import type { NodeProps } from '@xyflow/react';
import type { ComponentType } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../src/canvas/projection';
import { MindmapNode } from '../src/mindmap/Topic';
import { newNode, type NodeKind } from '../src/model/types';
import { nodeRegistry, nodeTypes } from '../src/nodes/registry';
import { ProcessCard } from '../src/simulation/ProcessCard';
import { useEditor } from '../src/state/editor';
import { contrast } from '../src/ui/colors';

vi.mock('@xyflow/react', async (original) => ({
  ...(await original<typeof import('@xyflow/react')>()),
  Handle: () => null,
  NodeResizer: () => null,
  useUpdateNodeInternals: () => () => undefined,
  useStore: (selector: (state: { transform: [number, number, number] }) => unknown) =>
    selector({ transform: [0, 0, 1] }),
}));

beforeEach(() => useEditor.getState().setGraph(null));

const renderers: [string, ComponentType<NodeProps<CanvasNode>>, NodeKind, number?][] = [
  ...(Object.keys(nodeRegistry) as NodeKind[]).map(
    (kind) =>
      [kind, nodeTypes[kind], kind] as [string, ComponentType<NodeProps<CanvasNode>>, NodeKind],
  ),
  ['mindmap root', MindmapNode, 'generic', 0],
  ['mindmap main', MindmapNode, 'generic', 1],
  ['mindmap leaf', MindmapNode, 'generic', 2],
  ['process summary', ProcessCard, 'process'],
  ['IBM outline', nodeTypes.process, 'process'],
];

it.each(renderers)(
  'keeps custom fill and readable text independent of the %s accent, then restores defaults',
  (name, Component, nodeType, depth) => {
    const node = newNode('diagram', {
      title: 'Review incoming orders',
      nodeType,
      color: '#775491',
      backgroundColor: '#172d55',
      flowchartSymbol: name === 'IBM outline' ? 'ibm-process' : undefined,
      metadata: { visualNerve: { icon: 'work' } },
    });
    const props = (): NodeProps<CanvasNode> => ({
      id: node.id,
      type: nodeType,
      selected: false,
      dragging: false,
      draggable: true,
      selectable: true,
      deletable: true,
      zIndex: 0,
      isConnectable: true,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
      data: {
        node: { ...node },
        owners: [],
        childCount: 0,
        exporting: true,
        mindmap: depth === undefined ? undefined : { depth, color: node.color!, side: 'right' },
      },
    });
    const { container, rerender } = render(<Component {...props()} />);
    for (const [fill, ink] of [
      ['#172d55', '#ffffff'],
      ['#fff2c7', '#000000'],
    ]) {
      node.backgroundColor = fill;
      rerender(<Component {...props()} />);
      const element = container.querySelector<HTMLElement>('[data-testid="graph-node"]')!;
      expect(element.dataset.nodeBackground).toBe(fill);
      expect(element.style.getPropertyValue('--node-bg')).toBe(fill);
      expect(element.style.getPropertyValue('--text')).toBe(ink);
      expect(element.style.getPropertyValue('--muted')).toBe(ink);
      expect(contrast(fill, ink)).toBeGreaterThanOrEqual(4.5);
      expect(
        element.style.getPropertyValue('--node-accent') ||
          element.style.getPropertyValue('--branch-color'),
      ).toBe(node.color);
      expect(element.querySelector('.node-title')?.textContent).toBe(node.title);
      if (name === 'IBM outline') {
        expect(element.querySelector('.ibm-node-shape .ibm-symbol-outline')).not.toBeNull();
        expect(element.querySelector('[data-area-icon="work"]')).not.toBeNull();
      }
    }
    delete node.backgroundColor;
    rerender(<Component {...props()} />);
    const element = container.querySelector<HTMLElement>('[data-testid="graph-node"]')!;
    expect(element.dataset.nodeBackground).toBeUndefined();
    expect(element.style.getPropertyValue('--node-bg')).toBe('');
    expect(element.style.getPropertyValue('--text')).toBe('');
    expect(element.style.getPropertyValue('--muted')).toBe('');
  },
);
