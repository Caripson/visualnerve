import { blankGraph, newEdge, newNode, type Graph } from '../model/types';
import { ibmSymbols, getIbmSymbol, type IBMSymbolId } from './ibm-symbols';

/** Aspect ratios follow the stencil: Decision is wide; Sort is tall. */
export function ibmSymbolSize(id: IBMSymbolId) {
  if (id === 'ibm-decision') return { width: 310, height: 215 };
  if (id === 'ibm-sort' || id === 'ibm-sort-outline') return { width: 220, height: 310 };
  if (id === 'ibm-connector' || id === 'ibm-magnetic-tape' || id === 'ibm-magnetic-tape-circle')
    return { width: 220, height: 220 };
  if (id === 'ibm-auxiliary-operation' || id === 'ibm-core') return { width: 220, height: 220 };
  if (id === 'ibm-terminal') return { width: 310, height: 120 };
  if (id === 'ibm-transmittal-tape' || id === 'ibm-offpage-connector')
    return { width: 180, height: 240 };
  if (id === 'ibm-communication-link') return { width: 240, height: 310 };
  if (id === 'ibm-magnetic-disk') return { width: 220, height: 270 };
  if (id === 'ibm-collate') return { width: 240, height: 280 };
  if (id.startsWith('ibm-arrow-')) return { width: 240, height: 210 };
  return { width: 300, height: 200 };
}

/** An editable stencil inventory and a connected batch-processing example. */
export function createIbmFlowchartGraph(name: string): Graph {
  const graph = blankGraph(name, 'flowchart');
  graph.diagram.description =
    'Classic Flowcharting. Based on the IBM GX20-8020 stencil and GX20-8020-1 / GX20-8020-2 revisions: 25 original apertures, 26 revised apertures, the revised sleeve’s 32 completed symbols, five original variants, and an editable batch-processing example. Select a node to change its IBM symbol. IBM is a trademark of International Business Machines Corporation. Visual Nerve is not affiliated with or endorsed by IBM.';
  graph.diagram.tags = ['IBM', 'flowchart', 'stencil'];
  const physical = ibmSymbols.filter((symbol) => symbol.physicalCutout);
  const completed = ibmSymbols.filter((symbol) => !symbol.physicalCutout);
  for (const [index, symbol] of [...physical, ...completed].entries()) {
    const row = Math.floor(index / 7),
      column = index % 7,
      size = ibmSymbolSize(symbol.id);
    graph.nodes.push(
      newNode(graph.diagram.id, {
        title: symbol.label,
        nodeType: symbol.nodeType,
        flowchartSymbol: symbol.id,
        x: column * 360 + (320 - size.width) / 2,
        y: row * 350 + (310 - size.height) / 2,
        ...size,
        color:
          symbol.category === 'legacy' ? '#946249' : symbol.physicalCutout ? '#31766c' : '#37648d',
        description: `${symbol.category === 'legacy' ? 'Original GX20-8020 aperture' : symbol.physicalCutout ? 'Revised stencil aperture' : 'Completed revised sleeve symbol'}: ${symbol.label}.`,
        tags: [
          'IBM',
          symbol.category === 'legacy'
            ? 'legacy-symbol'
            : symbol.physicalCutout
              ? 'stencil-cutout'
              : 'completed-symbol',
        ],
        metadata: {
          ibmFlowchart: {
            specimen: true,
            physicalCutout: symbol.physicalCutout,
            revisions: [...symbol.revisions],
          },
        },
      }),
    );
  }
  const exampleY = Math.ceil(ibmSymbols.length / 7) * 350 + 100;
  const example: { id: IBMSymbolId; title: string; x: number; y: number; nodeType?: 'end' }[] = [
    { id: 'ibm-terminal', title: 'Begin batch', x: 0, y: 60 },
    { id: 'ibm-input-output', title: 'Read input records', x: 400, y: 20 },
    { id: 'ibm-process', title: 'Validate records', x: 800, y: 20 },
    { id: 'ibm-decision', title: 'Records valid?', x: 1200, y: 15 },
    { id: 'ibm-magnetic-disk', title: 'Store accepted records', x: 1620, y: 0 },
    { id: 'ibm-document', title: 'Print batch report', x: 2000, y: 20 },
    { id: 'ibm-manual-operation', title: 'Correct rejected records', x: 1200, y: 370 },
    { id: 'ibm-terminal', title: 'Batch complete', x: 2000, y: 370, nodeType: 'end' },
  ];
  const nodes = example.map((item) =>
    newNode(graph.diagram.id, {
      title: item.title,
      nodeType: item.nodeType ?? getIbmSymbol(item.id)!.nodeType,
      flowchartSymbol: item.id,
      x: item.x,
      y: exampleY + item.y,
      ...ibmSymbolSize(item.id),
      color: '#8b6230',
      tags: ['IBM', 'batch-example'],
      description: 'Editable batch-processing example using the IBM symbol catalogue.',
    }),
  );
  graph.nodes.push(...nodes);
  const connect = (source: number, target: number, label?: string, bottom = false) =>
    graph.edges.push(
      newEdge(graph.diagram.id, nodes[source].id, nodes[target].id, {
        edgeType: 'flow',
        label,
        metadata: bottom ? { sourceHandle: 'out-bottom', targetHandle: 'in-top' } : {},
      }),
    );
  connect(0, 1);
  connect(1, 2);
  connect(2, 3);
  connect(3, 4, 'Yes');
  connect(4, 5);
  connect(3, 6, 'No', true);
  connect(6, 2, 'Retry');
  connect(5, 7, undefined, true);
  return graph;
}
