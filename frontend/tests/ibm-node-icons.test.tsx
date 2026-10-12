import { render } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import type { ComponentType } from 'react';
import { expect, it, vi } from 'vitest';
import { nodeTypes } from '../src/nodes/registry';
import { projectGraph, type CanvasNode } from '../src/canvas/projection';
import { blankGraph, newNode } from '../src/model/types';
import { getIbmSymbol } from '../src/flowchart/ibm-symbols';

vi.mock('@xyflow/react', async (original) => ({
  ...(await original<typeof import('@xyflow/react')>()),
  Handle: () => null,
}));

it('shows a selected custom icon without changing the IBM outline, and restores the glyph default', () => {
  const graph = blankGraph('IBM custom icon', 'flowchart');
  graph.nodes = [
    newNode(graph.diagram.id, {
      title: 'Review orders',
      width: 300,
      height: 200,
      nodeType: 'process',
      flowchartSymbol: 'ibm-predefined-process',
      metadata: { visualNerve: { icon: 'work' } },
    }),
  ];
  const draw = () => {
    const node = projectGraph(graph, []).nodes[0];
    const Renderer = nodeTypes[node.type!] as ComponentType<NodeProps<CanvasNode>>;
    return (
      <ReactFlowProvider initialNodes={[node]}>
        <Renderer
          {...node}
          selected={false}
          dragging={false}
          draggable
          selectable
          deletable
          type={node.type!}
          zIndex={1}
          width={node.width!}
          height={node.height!}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          isConnectable
        />
      </ReactFlowProvider>
    );
  };
  const { container, rerender } = render(draw());
  expect(container.querySelector('.node-topline [data-area-icon="work"]')).not.toBeNull();
  expect(container.querySelector('.node-topline .ibm-symbol-icon')).toBeNull();
  expect(container.querySelector('.ibm-node-shape')?.getAttribute('viewBox')).toBe('0 0 100 100');
  expect(container.querySelector('.ibm-node-shape .ibm-symbol-outline')?.getAttribute('d')).toBe(
    getIbmSymbol('ibm-predefined-process')!.outlinePath,
  );
  expect(container.querySelectorAll('.ibm-node-shape .ibm-symbol-detail')).toHaveLength(2);
  expect(container.querySelector('.node-title')?.textContent).toBe('Review orders');
  expect(container.querySelector('.node-title')?.getAttribute('title')).toContain('Review orders');
  expect(container.querySelector('.ibm-node-content .node-kind')).toBeNull();
  expect(container.querySelector('.node-topline')?.getAttribute('title')).toBe(
    'Predefined Process',
  );

  graph.nodes[0] = { ...graph.nodes[0], metadata: { visualNerve: { icon: '' } } };
  rerender(draw());
  expect(container.querySelector('.node-topline [data-area-icon]')).toBeNull();
  expect(container.querySelector('.node-topline .ibm-symbol-icon')).not.toBeNull();
  expect(container.querySelector('.node-topline .ibm-symbol-icon')?.getAttribute('viewBox')).toBe(
    '-1 -1 102 102',
  );
  expect(container.querySelector('.ibm-node-shape .ibm-symbol-outline')?.getAttribute('d')).toBe(
    getIbmSymbol('ibm-predefined-process')!.outlinePath,
  );
});
