import type { ComponentType, ReactNode } from 'react';
import type { NodeProps, NodeTypes } from '@xyflow/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { projectGraph, type CanvasNode } from '../src/canvas/projection';
import { base, blankGraph, newNode } from '../src/model/types';
import { useEditor } from '../src/state/editor';
import { captureSpatialNodeFaces, SPATIAL_FACE_CAPTURE_LIMIT } from '../src/spatial/faces';
import { appLocaleController } from '../src/i18n/runtime';
import { MessageFormatter } from '../src/i18n/message-formatter';
import swedish from '../src/i18n/catalogs/sv';

const mocks = vi.hoisted(() => ({
  toSvg: vi.fn(),
  decode: vi.fn(),
  drawImage: vi.fn(),
  flow: vi.fn(),
}));
vi.mock('html-to-image', () => ({ toSvg: mocks.toSvg }));
// Use the actual node registry, status, icons and summaries. Only the surrounding flow is mocked.
vi.mock('@xyflow/react', async (original) => ({
  ...(await original<typeof import('@xyflow/react')>()),
  Handle: () => null,
  NodeResizer: () => null,
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
  ReactFlow: (props: { children: ReactNode; nodes: CanvasNode[]; nodeTypes: NodeTypes }) => {
    mocks.flow(props);
    return (
      <div className="react-flow">
        {props.nodes.map((view) => {
          const Component = props.nodeTypes[view.type!] as ComponentType<NodeProps<CanvasNode>>;
          return (
            <div key={view.id} style={{ width: view.width, height: view.height }}>
              <Component
                id={view.id}
                data={view.data}
                type={view.type!}
                selected={false}
                dragging={false}
                draggable={false}
                selectable={false}
                deletable={false}
                isConnectable={false}
                zIndex={0}
                positionAbsoluteX={0}
                positionAbsoluteY={0}
              />
            </div>
          );
        })}
        {props.children}
      </div>
    );
  },
  useNodesInitialized: () => true,
  useReactFlow: () => ({ viewportInitialized: true }),
  useStore: (selector: (state: { transform: [number, number, number] }) => unknown) =>
    selector({ transform: [0, 0, 1] }),
}));

const fonts = Object.getOwnPropertyDescriptor(document, 'fonts');
beforeEach(() => {
  mocks.toSvg.mockResolvedValue('data:image/svg+xml;charset=utf-8,card');
  mocks.decode.mockResolvedValue(undefined);
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      decode = mocks.decode;
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: mocks.drawImage,
  } as unknown as CanvasRenderingContext2D);
  useEditor.getState().setGraph(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mocks.toSvg.mockReset();
  mocks.decode.mockReset();
  mocks.drawImage.mockReset();
  mocks.flow.mockReset();
  if (fonts) Object.defineProperty(document, 'fonts', fonts);
  else Reflect.deleteProperty(document, 'fonts');
});

it('can capture native cards at a lower video sprite resolution without dropping their content', async () => {
  const graph = blankGraph('Overview sprite');
  graph.nodes = [
    newNode(graph.diagram.id, {
      title: 'Detailed overview',
      width: 300,
      height: 120,
      color: '#965de1',
      status: 'done',
    }),
  ];
  const views = projectGraph(graph, []).nodes;
  let markup = '';
  mocks.toSvg.mockImplementation(async (element: HTMLElement) => {
    markup = element.outerHTML;
    return 'native-card';
  });
  const result = await captureSpatialNodeFaces(graph, views, undefined, { pixelRatio: 0.1 });
  expect(result.get(graph.nodes[0].id)).toMatchObject({ width: 30, height: 12 });
  expect(markup).toContain('Detailed overview');
  expect(markup).toContain('Status: Done');
  expect(mocks.toSvg).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ width: 300, height: 120 }),
  );
  await expect(captureSpatialNodeFaces(graph, views, undefined, { pixelRatio: 0 })).rejects.toThrow(
    'resolution',
  );
  expect(document.querySelector('.spatial-face-capture')).toBeNull();
});

it('captures the actual 2D node renderer with its icon, owner, status, CSV and SQL content', async () => {
  const graph = blankGraph('Styled card');
  const owner = {
    ...base(),
    name: 'Fleet team',
    kind: 'team' as const,
    color: '#e34f60',
    metadata: {},
  };
  graph.owners = [owner];
  graph.nodes = [
    newNode(graph.diagram.id, {
      title: 'Truck accounts',
      nodeType: 'database',
      width: 340,
      height: 384,
      color: '#965de1',
      status: 'done',
      ownerIds: [owner.id],
      metadata: {
        visualNerve: { icon: 'technology' },
        csv: {
          datasetId: crypto.randomUUID(),
          groupKey: '[]',
          path: [],
          rowCount: 12,
          totalChildren: 0,
          hiddenChildren: 0,
          measures: [
            {
              id: 'count',
              label: 'Vehicles',
              operation: 'count',
              value: 12,
              numericCount: 12,
              missingCount: 0,
              invalidCount: 0,
            },
          ],
        },
        sqlTable: {
          version: 1,
          name: 'trucks',
          qualifiedName: ['trucks'],
          primaryKey: ['id'],
          uniqueKeys: [],
          columns: [
            {
              name: 'id',
              dataType: 'bigint',
              nullable: false,
              primaryKey: true,
              foreignKey: false,
              unique: false,
            },
          ],
        },
      },
    }),
  ];
  useEditor.getState().setGraph(graph);
  useEditor.getState().select([graph.nodes[0].id]);
  const before = useEditor.getState();
  const views = projectGraph(graph, graph.owners).nodes;
  let markup = '';
  mocks.toSvg.mockImplementation(
    async (element: HTMLElement, options: { width: number; height: number }) => {
      markup = element.outerHTML;
      expect(element.dataset.nodeId).toBe(graph.nodes[0].id);
      expect(element.style.getPropertyValue('--node-accent')).toBe('#965de1');
      expect(options).toMatchObject({ width: 340, height: 384 });
      return 'card-svg';
    },
  );
  const result = await captureSpatialNodeFaces(graph, views);
  const element = document.createElement('div');
  element.innerHTML = markup;
  expect(element.querySelector('svg[data-area-icon="technology"]')).not.toBeNull();
  expect(element.querySelector('[aria-label="Status: Done"]')).not.toBeNull();
  expect(element.querySelector('[aria-label="CSV measures"]')?.textContent).toContain('Vehicles12');
  expect(element.querySelector('[aria-label="SQL table columns"]')?.textContent).toContain(
    'bigint',
  );
  expect(element.textContent).toContain('Fleet team');
  expect(element.querySelector('.is-selected')).toBeNull();
  expect(result.get(graph.nodes[0].id)).toMatchObject({ width: 680, height: 768 });
  expect(mocks.decode).toHaveBeenCalledOnce();
  expect(mocks.drawImage.mock.invocationCallOrder[0]).toBeGreaterThan(
    mocks.decode.mock.invocationCallOrder[0],
  );
  expect(useEditor.getState()).toBe(before);
  expect(document.querySelector('.spatial-face-capture')).toBeNull();
});

it('captures localized card metadata while retaining private text, canonical status and both camera layouts', async () => {
  const graph = blankGraph('My own diagram');
  graph.nodes = [
    newNode(graph.diagram.id, {
      title: 'My private title',
      description: 'My unchanged narration',
      status: 'done',
      x: 150,
      y: 250,
      width: 320,
      height: 120,
    }),
  ];
  graph.diagram.settings.spatialView = {
    version: 1,
    mode: '3d',
    camera: {
      position: { x: 14, y: 18, z: 31 },
      target: { x: 0, y: 0, z: 0 },
    },
  };
  const original = structuredClone(graph);
  const markup: string[] = [];
  mocks.toSvg.mockImplementation(async (element: HTMLElement) => {
    markup.push(element.outerHTML);
    return 'card-svg';
  });
  try {
    await captureSpatialNodeFaces(graph, projectGraph(graph, []).nodes);
    await appLocaleController.selectLocale('sv');
    await captureSpatialNodeFaces(graph, projectGraph(graph, []).nodes);
    const labels = markup.map((value) => {
      const container = document.createElement('div');
      container.innerHTML = value;
      expect(container.textContent).toContain('My private title');
      return container.querySelector('[data-testid="node-status"]')?.getAttribute('aria-label');
    });
    const translated = new MessageFormatter('sv', swedish);
    expect(labels).toEqual([
      'Status: Done',
      translated.t('editor.status.accessible', {
        label: translated.t('editor.selection.done'),
      }),
    ]);
    expect(graph).toEqual(original);
    expect(document.querySelector('.spatial-face-capture')).toBeNull();
  } finally {
    await appLocaleController.selectLocale('en');
  }
});

it('uses the actual inherited mind-map styling and icons without changing its 2D positions', async () => {
  const graph = blankGraph('Lifecycle', 'mindmap');
  const root = newNode(graph.diagram.id, { title: 'Truck lifecycle', color: '#b65344' });
  const branch = newNode(graph.diagram.id, {
    title: 'Maintenance',
    parentId: root.id,
    color: '#226d72',
    x: 480,
    y: 80,
    metadata: { visualNerve: { icon: 'work' } },
  });
  graph.nodes = [root, branch];
  const views = projectGraph(graph, []).nodes;
  const before = structuredClone(graph);
  let captured: HTMLElement | undefined;
  mocks.toSvg.mockImplementation(async (element: HTMLElement) => {
    captured = element.cloneNode(true) as HTMLElement;
    return 'card-svg';
  });
  await captureSpatialNodeFaces(graph, [views[1]]);
  expect(captured).toHaveClass('mindmap-topic', 'mindmap-main');
  expect(captured!.style.getPropertyValue('--branch-color')).toBe('#226d72');
  expect(captured!.querySelector('svg[data-area-icon="work"]')).not.toBeNull();
  expect(captured!.querySelector('.topic-branch-controls')).toBeNull();
  expect(graph).toEqual(before);
  expect(views[1]).toMatchObject({ position: { x: 480, y: 80 }, data: { exporting: false } });
  expect(mocks.flow.mock.calls[0][0]).toMatchObject({
    nodesDraggable: false,
    nodesConnectable: false,
    elementsSelectable: false,
    onlyRenderVisibleElements: false,
  });
});

it('cancels an in-flight capture and removes its isolated renderer', async () => {
  const graph = blankGraph('Cancelled');
  graph.nodes = [newNode(graph.diagram.id, { title: 'Preserved card' })];
  let finish: (value: string) => void = () => undefined;
  mocks.toSvg.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  const pending = captureSpatialNodeFaces(graph, projectGraph(graph, []).nodes, controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(mocks.toSvg).toHaveBeenCalledOnce());
  controller.abort();
  await rejected;
  expect(document.querySelector('.spatial-face-capture')).toBeNull();
  expect(mocks.decode).not.toHaveBeenCalled();
  finish('late-svg');
});

it('bounds mounted cards and allocates no renderer for an empty or cancelled request', async () => {
  const graph = blankGraph('Capture bounds');
  graph.nodes = Array.from({ length: SPATIAL_FACE_CAPTURE_LIMIT + 1 }, () =>
    newNode(graph.diagram.id),
  );
  expect(await captureSpatialNodeFaces(graph, [])).toEqual(new Map());
  await expect(captureSpatialNodeFaces(graph, projectGraph(graph, []).nodes)).rejects.toThrow(
    'at most 120',
  );
  const controller = new AbortController();
  controller.abort();
  await expect(captureSpatialNodeFaces(graph, [], controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(mocks.flow).not.toHaveBeenCalled();
  expect(document.querySelector('.spatial-face-capture')).toBeNull();
});
