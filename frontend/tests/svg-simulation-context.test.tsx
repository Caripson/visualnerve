import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CanvasNode } from '../src/canvas/projection';
import { blankGraph } from '../src/model/types';
import { useEditor } from '../src/state/editor';
import { createSimulationGraph } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import { SimulationNodeSummary } from '../src/simulation/NodeSummary';
import { SimulationEngine } from '../src/simulation/engine';
import { simulationService, type SimulationView } from '../src/simulation/service';
import { Repository } from '../src/storage/repository';
import { WorkspaceDatabase } from '../src/storage/database';

vi.mock('@xyflow/react', async (original) => {
  const actual = await original<typeof import('@xyflow/react')>();
  return {
    ...actual,
    ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
    ViewportPortal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    ReactFlow: ({ nodes, children }: { nodes: CanvasNode[]; children: ReactNode }) => (
      <div className="react-flow">
        <div className="react-flow__viewport">
          {nodes.map((node) => (
            <div key={node.id} className="react-flow__node" data-node-id={node.id}>
              <SimulationNodeSummary id={node.id} node={node.data.node} />
            </div>
          ))}
          {children}
        </div>
      </div>
    ),
    useNodesInitialized: () => true,
    useReactFlow: () => ({ viewportInitialized: true, setViewport: () => Promise.resolve(true) }),
  };
});
const fonts = Object.getOwnPropertyDescriptor(document, 'fonts');
const rangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
let db: WorkspaceDatabase;
beforeEach(() => {
  db = new WorkspaceDatabase(`svg-simulation-${crypto.randomUUID()}`);
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: function (this: Range) {
      return { left: 20 + this.startOffset * 7, top: 20, width: 7, height: 15 } as DOMRect;
    },
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    x: 0,
    y: 0,
    width: 640,
    height: 480,
    right: 640,
    bottom: 480,
  } as DOMRect);
});
afterEach(async () => {
  vi.restoreAllMocks();
  useEditor.getState().setGraph(null);
  db.close();
  await db.delete();
  if (fonts) Object.defineProperty(document, 'fonts', fonts);
  else Reflect.deleteProperty(document, 'fonts');
  if (rangeRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeRect);
  else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});
const text = (xml: string) =>
  Array.from(new DOMParser().parseFromString(xml, 'image/svg+xml').querySelectorAll('text'))
    .map((node) => node.textContent)
    .join('');

describe('isolated API SVG simulator summaries', () => {
  it.each(['ordinary', 'simulator'] as const)(
    'uses simulator B summaries while %s A remains open',
    async (kind) => {
      const repo = new Repository(db);
      const source = createSimulationGraph('Export B', createBasicModel({ capacity: 3 }));
      const saved = await repo.saveGraph(source);
      const opened =
        kind === 'ordinary'
          ? blankGraph('Open A')
          : createSimulationGraph('Open simulator A', createBasicModel({ capacity: 1 }));
      useEditor.getState().setGraph(opened);
      const before = useEditor.getState();
      const xml = await repo.request<string>('/export', 'POST', {
        diagramId: saved.diagram.id,
        format: 'svg',
      });
      const labels = text(xml);
      expect(labels).toContain('Capacity 3');
      expect(labels).toContain('Unit 1 of 3');
      expect(labels).toContain('Unit 2 of 3');
      expect(labels).toContain('Unit 3 of 3');
      expect(labels).not.toContain('Capacity 1');
      expect(useEditor.getState().graph).toBe(before.graph);
      expect(useEditor.getState().history).toBe(before.history);
      expect(useEditor.getState().selectedNodes).toBe(before.selectedNodes);
      expect(await repo.getGraph(saved.diagram.id)).toEqual(saved);
      expect(document.querySelector('.export-canvas')).toBeNull();
    },
  );
  it('uses only B’s compatible selected run/scenario state while another simulator is open', async () => {
    const source = createSimulationGraph('Scenario export B', createBasicModel({ capacity: 3 }));
    const work = source.simulation!.nodes.find((node) => node.type === 'work')!;
    source.simulation!.scenarios = [
      {
        id: 'four',
        name: 'Four workers',
        overrides: { nodes: { [work.id]: { work: { capacity: 4 } } } },
      },
    ];
    const repo = new Repository(db),
      saved = await repo.saveGraph(source);
    const run = {
      id: 'b-run',
      diagramId: saved.diagram.id,
      model: saved.simulation!,
      options: { scenarioId: 'four', seed: 42, durationSeconds: 86400 },
      status: 'paused' as const,
      createdAt: '',
      updatedAt: '',
    };
    const engine = new SimulationEngine(run.model, run.options);
    engine.advance(1);
    const view: SimulationView = { run, state: engine.state() };
    vi.spyOn(simulationService, 'current').mockImplementation((id) =>
      id === saved.diagram.id ? view : undefined,
    );
    useEditor
      .getState()
      .setGraph(createSimulationGraph('Open A', createBasicModel({ capacity: 1 })));
    const before = useEditor.getState().graph;
    const xml = await repo.request<string>('/export', 'POST', {
      diagramId: saved.diagram.id,
      format: 'svg',
    });
    expect(text(xml)).toContain('Capacity 4');
    expect(text(xml)).toContain('Unit 4 of 4');
    expect(useEditor.getState().graph).toBe(before);
    expect(await repo.getGraph(saved.diagram.id)).toEqual(saved);
  });
});
