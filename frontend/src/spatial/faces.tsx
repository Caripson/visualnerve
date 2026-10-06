import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow } from '@xyflow/react';
import { toSvg } from 'html-to-image';
import type { CanvasNode } from '../canvas/projection';
import type { Graph } from '../model/types';
import { overviewNodeTypes as nodeTypes } from '../overview/renderers';

/** Only a bounded set of nearby, readable cards is ever mounted for texture capture. */
export const SPATIAL_FACE_CAPTURE_LIMIT = 120;
const MAX_TEXTURE_EDGE = 2048;
const MAX_TEXTURE_PIXELS = 1024 * 1024;

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Card capture was cancelled.', 'AbortError');
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  checkAbort(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('Card capture was cancelled.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

function Ready({ done }: { done: () => void }) {
  const ready = useNodesInitialized({ includeHiddenNodes: true });
  const flow = useReactFlow();
  useEffect(() => {
    if (!ready || !flow.viewportInitialized) return;
    let second: number | undefined;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(done);
    });
    return () => {
      cancelAnimationFrame(first);
      if (second !== undefined) cancelAnimationFrame(second);
    };
  }, [ready, flow.viewportInitialized, done]);
  return null;
}

const filter = (element: HTMLElement) =>
  !element.classList?.contains('react-flow__handle') &&
  !element.classList?.contains('react-flow__resize-control') &&
  !element.classList?.contains('topic-branch-controls') &&
  !element.classList?.contains('branch-toggle');

async function captureFace(
  element: HTMLElement,
  view: CanvasNode,
  signal?: AbortSignal,
  pixelRatio = 2,
) {
  checkAbort(signal);
  const width = view.width ?? view.data.node.width;
  const height = view.height ?? view.data.node.height;
  const ratio = pixelRatio;
  const scale = Math.min(
    1,
    MAX_TEXTURE_EDGE / width,
    MAX_TEXTURE_EDGE / height,
    MAX_TEXTURE_EDGE / (width * ratio),
    MAX_TEXTURE_EDGE / (height * ratio),
    Math.sqrt(MAX_TEXTURE_PIXELS / (width * height * ratio * ratio)),
  );
  const captureWidth = Math.max(1, Math.floor(width * scale));
  const captureHeight = Math.max(1, Math.floor(height * scale));
  const style: Record<string, string> = {
    width: `${width}px`,
    height: `${height}px`,
  };
  if (scale < 1) {
    const transform = getComputedStyle(element).transform;
    style.transform = `scale(${scale}) ${transform && transform !== 'none' ? transform : ''}`;
    style.transformOrigin = 'top left';
  }
  const svg = await abortable(
    toSvg(element, {
      width: captureWidth,
      height: captureHeight,
      filter,
      style,
    }),
    signal,
  );
  checkAbort(signal);
  const image = new Image();
  image.src = svg;
  // Wait for the complete foreignObject (including SVG icons) before rasterizing.
  await abortable(image.decode(), signal);
  checkAbort(signal);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(captureWidth * ratio));
  canvas.height = Math.max(1, Math.floor(captureHeight * ratio));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not capture the diagram card.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Capture the actual 2D renderers as local textures, preserving CSS, theme, icons,
 * status, metrics and SQL columns. The isolated flow never changes editor state.
 */
export async function captureSpatialNodeFaces(
  graph: Graph,
  views: CanvasNode[],
  signal?: AbortSignal,
  options?: { pixelRatio?: number },
): Promise<Map<string, HTMLCanvasElement>> {
  checkAbort(signal);
  const ratio = options?.pixelRatio ?? 2;
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 4)
    throw new Error('Card capture resolution must be greater than zero and at most four.');
  const captures = new Map<string, HTMLCanvasElement>();
  if (!views.length) return captures;
  if (views.length > SPATIAL_FACE_CAPTURE_LIMIT)
    throw new Error(`Capture at most ${SPATIAL_FACE_CAPTURE_LIMIT} diagram cards at once.`);
  const nodes: CanvasNode[] = views.map((view) => ({
    ...view,
    position: { x: 0, y: 0 },
    parentId: undefined,
    extent: undefined,
    expandParent: false,
    selected: false,
    hidden: false,
    draggable: false,
    selectable: false,
    connectable: false,
    data: { ...view.data, exporting: true, resize: undefined },
  }));
  const container = document.createElement('div');
  container.className = `spatial-face-capture export-canvas ${graph.diagram.type === 'mindmap' ? 'mindmap-canvas' : ''}`;
  container.setAttribute('aria-hidden', 'true');
  container.setAttribute('inert', '');
  Object.assign(container.style, {
    position: 'fixed',
    left: '-50000px',
    top: '0',
    width: '1024px',
    height: '768px',
    pointerEvents: 'none',
  });
  document.body.append(container);
  const root = createRoot(container);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await abortable(
      new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Diagram card rendering took too long.')), 10000);
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        root.render(
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={[]}
              nodeTypes={nodeTypes}
              defaultViewport={{ x: 0, y: 0, zoom: 1 }}
              nodesDraggable={false}
              elementsSelectable={false}
              nodesConnectable={false}
              panOnDrag={false}
              zoomOnScroll={false}
              onlyRenderVisibleElements={false}
              proOptions={{ hideAttribution: true }}
            >
              <Ready done={done} />
            </ReactFlow>
          </ReactFlowProvider>,
        );
      }),
      signal,
    );
    if (document.fonts) await abortable(document.fonts.ready, signal);
    checkAbort(signal);
    const elements = new Map(
      Array.from(container.querySelectorAll<HTMLElement>('[data-node-id]')).map((element) => [
        element.dataset.nodeId!,
        element,
      ]),
    );
    let next = 0;
    const worker = async () => {
      while (next < views.length) {
        checkAbort(signal);
        const view = views[next++];
        const element = elements.get(view.id);
        if (!element) throw new Error(`Could not render diagram card ${view.id}.`);
        const canvas = await captureFace(element, view, signal, ratio);
        checkAbort(signal);
        captures.set(view.id, canvas);
        // Rasterizing many detailed cards must yield to pointer and camera events.
        await abortable(new Promise<void>((resolve) => setTimeout(resolve, 0)), signal);
      }
    };
    await Promise.all([worker(), worker()]);
    return captures;
  } finally {
    clearTimeout(timer);
    root.unmount();
    container.remove();
  }
}
