import {
  ExchangeExportError,
  type ExchangeEdge,
  type ExchangeNode,
  type ExchangeProgress,
  type ExchangeResult,
  type ExchangeScene,
} from './exchange-types';
import { exchangeXML, ExchangeXmlWriter } from './exchange-xml';

const failScene = (message: string): never => {
  throw new ExchangeExportError('invalid_scene', message);
};

// These values cannot add another style entry, URL, image, stencil or markup.
function color(value: string): string {
  const result = value.trim();
  if (!/^(?:#(?:[a-f\d]{3}|[a-f\d]{6}|[a-f\d]{8})|[a-z]+)$/i.test(result))
    return failScene('A diagram colour cannot be represented safely in draw.io.');
  return result;
}

function shape(node: ExchangeNode): string {
  switch (node.kind) {
    case 'decision':
      return 'shape=rhombus;perimeter=rhombusPerimeter;';
    case 'start':
    case 'end':
      return 'shape=ellipse;perimeter=ellipsePerimeter;';
    case 'database':
      return 'shape=cylinder3;perimeter=rectanglePerimeter;boundedLbl=1;';
    case 'document':
      return 'shape=document;perimeter=rectanglePerimeter;';
    case 'note':
      return 'shape=note;perimeter=rectanglePerimeter;';
    case 'input':
    case 'output':
      return 'shape=parallelogram;perimeter=parallelogramPerimeter;';
    case 'group':
      return 'shape=rectangle;rounded=1;group=1;container=1;collapsible=0;recursiveResize=0;dashed=1;align=left;verticalAlign=top;';
    case 'process':
      return 'shape=rectangle;rounded=0;';
    case 'system':
    case 'external':
      return 'shape=rectangle;rounded=1;dashed=1;';
    default:
      return 'shape=rectangle;rounded=1;';
  }
}

const label = (node: ExchangeNode) =>
  [node.title, node.description, ...node.detailLines].filter(Boolean).join('\n');

function nodeStyle(node: ExchangeNode): string {
  return `${shape(node)}html=0;whiteSpace=wrap;overflow=visible;spacing=8;fontSize=12;fillColor=${color(node.fill)};strokeColor=${color(node.stroke)};fontColor=${color(node.textColor)};`;
}

function edgeStyle(edge: ExchangeEdge): string {
  const start = edge.direction === 'both' || edge.direction === 'backward';
  const end = edge.direction === 'both' || edge.direction === 'forward';
  const dash =
    edge.style === 'dotted'
      ? 'dashed=1;dashPattern=1 3;'
      : edge.style === 'dashed'
        ? 'dashed=1;dashPattern=6 4;'
        : 'dashed=0;';
  return `edgeStyle=orthogonalEdgeStyle;rounded=0;html=0;whiteSpace=wrap;strokeWidth=1.6;strokeColor=${color(edge.stroke)};fontColor=${color(edge.stroke)};startArrow=${start ? 'classic' : 'none'};endArrow=${end ? 'classic' : 'none'};startFill=1;endFill=1;${dash}`;
}

/** Validate references and index the parent tree for bounded common-ancestor lookup. */
class DrawioHierarchy {
  readonly ids: string[];
  readonly parents: number[];
  readonly depths: number[];
  private readonly indices: Map<string, number>;
  private readonly ancestors: number[][];

  constructor(readonly nodes: ExchangeNode[]) {
    this.ids = nodes.map((_, index) => `n${index + 1}`);
    this.indices = new Map(nodes.map((node, index) => [node.id, index]));
    if (this.indices.size !== nodes.length) failScene('Diagram node IDs must be unique.');
    this.parents = nodes.map((node) => {
      if (!node.parentId) return -1;
      const parent = this.indices.get(node.parentId);
      if (parent === undefined || nodes[parent].kind !== 'group')
        return failScene('A diagram node references a missing or invalid parent group.');
      return parent;
    });
    this.depths = nodes.map(() => -1);
    for (let index = 0; index < nodes.length; index++) {
      const path: number[] = [];
      const visiting = new Set<number>();
      let current = index;
      while (current >= 0 && this.depths[current] < 0) {
        if (visiting.has(current)) failScene('Diagram parent groups contain a cycle.');
        visiting.add(current);
        path.push(current);
        current = this.parents[current];
      }
      let depth = current < 0 ? -1 : this.depths[current];
      for (let offset = path.length - 1; offset >= 0; offset--) this.depths[path[offset]] = ++depth;
    }
    this.ancestors = [this.parents];
    const maxDepth = Math.max(0, ...this.depths);
    for (let level = 1; 2 ** level <= maxDepth; level++) {
      const previous = this.ancestors[level - 1];
      this.ancestors.push(previous.map((parent) => (parent < 0 ? -1 : previous[parent])));
    }
  }

  index(id: string): number {
    const index = this.indices.get(id);
    if (index === undefined) return failScene('A diagram connection references a missing node.');
    return index;
  }

  parent(index: number): string {
    return this.parents[index] < 0 ? '1' : this.ids[this.parents[index]];
  }

  commonParent(source: string, target: string): string {
    let a = this.parents[this.index(source)];
    let b = this.parents[this.index(target)];
    if (a < 0 || b < 0) return '1';
    if (this.depths[a] < this.depths[b]) [a, b] = [b, a];
    const difference = this.depths[a] - this.depths[b];
    for (let level = 0; 2 ** level <= difference; level++)
      if (Math.floor(difference / 2 ** level) % 2) a = this.ancestors[level][a];
    if (a === b) return this.ids[a];
    for (let level = this.ancestors.length - 1; level >= 0; level--) {
      if (this.ancestors[level][a] !== this.ancestors[level][b]) {
        a = this.ancestors[level][a];
        b = this.ancestors[level][b];
      }
    }
    return this.parents[a] < 0 ? '1' : this.ids[this.parents[a]];
  }
}

/** Native mxCells remain separately editable; no images, HTML or graph backup. */
export function serializeDrawio(
  scene: ExchangeScene,
  progress: ExchangeProgress = () => undefined,
): ExchangeResult {
  const hierarchy = new DrawioHierarchy(scene.nodes);
  const writer = new ExchangeXmlWriter();
  const warnings = [...scene.warnings];
  if (
    scene.nodes.some((node) =>
      ['end', 'output', 'milestone', 'timeline', 'person', 'team', 'system', 'external'].includes(
        node.kind,
      ),
    )
  )
    warnings.push({
      code: 'drawio_shape_simplified',
      message:
        'Specialised card kinds and decorations are simplified to standard editable draw.io shapes. Start/end and input/output kinds share shapes.',
    });
  writer.write(
    `<?xml version="1.0" encoding="UTF-8"?><mxfile compressed="false"><diagram id="page-1" name="${exchangeXML(scene.name)}"><mxGraphModel grid="0" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>`,
  );
  // Parent cells precede their children even if the source list uses a different order.
  const order = scene.nodes
    .map((_, index) => index)
    .sort((a, b) => hierarchy.depths[a] - hierarchy.depths[b]);
  progress(20, 'nodes');
  for (let offset = 0; offset < order.length; offset++) {
    const index = order[offset];
    const node = scene.nodes[index];
    if (
      ![node.x, node.y, node.width, node.height].every(Number.isFinite) ||
      node.width <= 0 ||
      node.height <= 0
    )
      failScene('Diagram node geometry must contain finite coordinates and positive dimensions.');
    const parent =
      hierarchy.parents[index] >= 0 ? scene.nodes[hierarchy.parents[index]] : undefined;
    writer.write(
      `<mxCell id="${hierarchy.ids[index]}" value="${exchangeXML(label(node))}" style="${exchangeXML(nodeStyle(node))}" vertex="1" parent="${hierarchy.parent(index)}"><mxGeometry x="${node.x - (parent?.x ?? 0)}" y="${node.y - (parent?.y ?? 0)}" width="${node.width}" height="${node.height}" as="geometry"/></mxCell>`,
    );
    if (offset % 100 === 0)
      progress(20 + Math.round((45 * offset) / Math.max(1, order.length)), 'nodes');
  }
  progress(65, 'edges');
  for (let index = 0; index < scene.edges.length; index++) {
    const edge = scene.edges[index];
    writer.write(
      `<mxCell id="e${index + 1}" value="${exchangeXML(edge.label)}" style="${exchangeXML(edgeStyle(edge))}" edge="1" parent="${hierarchy.commonParent(edge.source, edge.target)}" source="${hierarchy.ids[hierarchy.index(edge.source)]}" target="${hierarchy.ids[hierarchy.index(edge.target)]}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
    );
    if (index % 250 === 0)
      progress(65 + Math.round((25 * index) / Math.max(1, scene.edges.length)), 'edges');
  }
  writer.write('</root></mxGraphModel></diagram></mxfile>');
  progress(95, 'packaging');
  const bytes = writer.bytes();
  progress(100, 'packaging');
  return {
    format: 'drawio',
    mimeType: 'application/vnd.jgraph.mxfile',
    bytes,
    nodeCount: scene.nodes.length,
    edgeCount: scene.edges.length,
    warnings,
  };
}
