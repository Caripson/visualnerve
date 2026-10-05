import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, ReactFlowProvider, useNodesInitialized, type Viewport } from '@xyflow/react';
import { toPng } from 'html-to-image';
import { nodeTypes } from '../nodes/registry';
import { edgeTypes } from '../mindmap/Branch';
import { projectGraph, projectedBounds } from '../canvas/projection';
import { emptyFilters, type Graph } from '../model/types';
import { download, safeName } from './semantic';
export interface RenderOptions {
  scope: 'complete' | 'viewport' | 'selected';
  multiplier: 1 | 2 | 4;
  page: 'a4' | 'a3';
  orientation: 'landscape' | 'portrait';
  tiled: boolean;
}
function Ready({ done }: { done: () => void }) {
  const ready = useNodesInitialized({ includeHiddenNodes: true });
  useEffect(() => {
    if (ready) {
      requestAnimationFrame(() => requestAnimationFrame(done));
    }
  }, [ready, done]);
  return null;
}
const filter = (node: HTMLElement) =>
  !node.classList?.contains('react-flow__controls') &&
  !node.classList?.contains('react-flow__minimap') &&
  !node.classList?.contains('react-flow__panel') &&
  !node.classList?.contains('react-flow__resize-control') &&
  !node.classList?.contains('topic-branch-controls');
function canvasColor(graph: Graph) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(graph.diagram.type === 'mindmap' ? '--node-bg' : '--canvas')
    .trim();
}
export async function graphPNG(
  graph: Graph,
  options: RenderOptions,
  selection: string[],
): Promise<string> {
  if (options.scope === 'viewport') {
    const flow = document.querySelector<HTMLElement>('.canvas-shell .react-flow');
    if (!flow) throw new Error('Open a diagram first.');
    return toPng(flow, {
      pixelRatio: options.multiplier,
      backgroundColor: canvasColor(graph),
      filter,
    });
  }
  const selected = new Set(selection);
  const source =
    options.scope === 'selected'
      ? {
          ...graph,
          nodes: graph.nodes.filter((n) => selected.has(n.id)),
          edges: graph.edges.filter(
            (e) => selected.has(e.sourceNodeId) && selected.has(e.targetNodeId),
          ),
        }
      : graph;
  if (!source.nodes.length)
    throw new Error(
      options.scope === 'selected'
        ? 'Select one or more nodes to export.'
        : 'Add a node before exporting an image.',
    );
  const { nodes, edges } = projectGraph(
    source,
    source.owners,
    [],
    [],
    emptyFilters,
    true,
    undefined,
    undefined,
    undefined,
    graph.nodes,
  );
  const bounds = projectedBounds(nodes);
  const width = Math.ceil(bounds.width + 80),
    height = Math.ceil(bounds.height + 80);
  if (
    width * options.multiplier > 16384 ||
    height * options.multiplier > 16384 ||
    width * height * options.multiplier ** 2 > 80000000
  )
    throw new Error(
      'This image exceeds the browser canvas limit. Use a smaller resolution, export a selection, or use JSON/Markdown.',
    );
  const container = document.createElement('div');
  container.className = `export-canvas ${graph.diagram.type === 'mindmap' ? 'mindmap-canvas' : ''}`;
  Object.assign(container.style, {
    position: 'fixed',
    left: '-50000px',
    top: '0',
    width: `${width}px`,
    height: `${height}px`,
    background: canvasColor(graph),
  });
  document.body.append(container);
  const root = createRoot(container);
  const viewport: Viewport = { x: 40 - bounds.x, y: 40 - bounds.y, zoom: 1 };
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Graph rendering took too long. Try a smaller selection.')),
        15000,
      );
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      root.render(
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultViewport={viewport}
            minZoom={0.01}
            maxZoom={4}
            nodesDraggable={false}
            elementsSelectable={false}
            nodesConnectable={false}
            onlyRenderVisibleElements={false}
          >
            <Ready done={done} />
          </ReactFlow>
        </ReactFlowProvider>,
      );
    });
    await document.fonts.ready;
    // Capture the inner flow: the offscreen wrapper's computed logical insets
    // otherwise override physical left/top when html-to-image clones its styles.
    const flow = container.querySelector<HTMLElement>('.react-flow')!;
    return await toPng(flow, {
      width,
      height,
      pixelRatio: options.multiplier,
      backgroundColor: getComputedStyle(container).backgroundColor,
      filter,
    });
  } finally {
    root.unmount();
    container.remove();
  }
}
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode graph rendering.'));
    image.src = url;
  });
}
export async function exportRendered(
  graph: Graph,
  format: 'png' | 'pdf',
  options: RenderOptions,
  selection: string[],
) {
  const png = await graphPNG(graph, options, selection);
  const filename = safeName(graph.diagram.name);
  if (format === 'png') {
    const link = document.createElement('a');
    link.href = png;
    link.download = `${filename}.png`;
    link.click();
    return;
  }
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({
    orientation: options.orientation,
    format: options.page,
    unit: 'mm',
    compress: true,
  });
  const image = await loadImage(png);
  const margin = 10;
  const pageWidth = pdf.internal.pageSize.getWidth() - margin * 2,
    pageHeight = pdf.internal.pageSize.getHeight() - margin * 2 - (options.tiled ? 8 : 0);
  if (!options.tiled) {
    const ratio = Math.min(pageWidth / image.width, pageHeight / image.height);
    const w = image.width * ratio,
      h = image.height * ratio;
    pdf.addImage(
      png,
      'PNG',
      margin + (pageWidth - w) / 2,
      margin + (pageHeight - h) / 2,
      w,
      h,
      undefined,
      'FAST',
    );
  } else {
    const pixelsPerMM = 2.5 * options.multiplier,
      tileWidth = Math.floor(pageWidth * pixelsPerMM),
      tileHeight = Math.floor(pageHeight * pixelsPerMM);
    const cols = Math.ceil(image.width / tileWidth),
      rows = Math.ceil(image.height / tileHeight);
    if (cols * rows > 200)
      throw new Error(
        'Tiled export would exceed 200 pages. Choose a larger paper size or export a selection.',
      );
    const canvas = document.createElement('canvas');
    canvas.width = tileWidth;
    canvas.height = tileHeight;
    const context = canvas.getContext('2d')!;
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        if (row || col) pdf.addPage();
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, tileWidth, tileHeight);
        context.drawImage(
          image,
          col * tileWidth,
          row * tileHeight,
          tileWidth,
          tileHeight,
          0,
          0,
          tileWidth,
          tileHeight,
        );
        pdf.addImage(
          canvas.toDataURL('image/png'),
          'PNG',
          margin,
          margin,
          pageWidth,
          pageHeight,
          undefined,
          'FAST',
        );
        pdf.setFontSize(9);
        pdf.text(
          `${graph.diagram.name} · ${col + 1}/${cols}, ${row + 1}/${rows}`,
          margin,
          pdf.internal.pageSize.getHeight() - 8,
        );
      }
  }
  download(`${filename}.pdf`, pdf.output('blob'), 'application/pdf');
}
