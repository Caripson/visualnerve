import { newEdge, newNode, type Graph, type GraphNode, type NodeKind } from '../../model/types';
import { attr, children, descendants, first, safeColor, textContent, type XmlNode } from './xml';
import { diagramImportLimits } from './types';

type Cells = Map<string, string>;
type Matrix = [number, number, number, number, number, number];
const identity: Matrix = [1, 0, 0, 1, 0, 0];
export interface VisioMaster {
  id: string;
  name: string;
  root: XmlNode;
  shapes: Map<string, XmlNode>;
}
export interface VisioShapeContext {
  master(id: string): VisioMaster | undefined;
  style(id: string): Cells;
  color(value: string | undefined): string | undefined;
  warn(message: string): void;
}
interface Shape {
  id: string;
  source: XmlNode;
  template?: XmlNode;
  cells: Cells;
  name: string;
  text: string;
  masterId?: string;
  masterName?: string;
  nested: Shape[];
}

export function visioCells(node: XmlNode | undefined): Cells {
  const result: Cells = new Map();
  if (!node) return result;
  for (const cell of children(node, 'Cell')) {
    const name = attr(cell, 'N');
    const value = attr(cell, 'V');
    if (name && value !== undefined && value !== 'Inh') result.set(name, value);
  }
  return result;
}
function number(cells: Cells, name: string, fallback: number) {
  const value = cells.get(name);
  if (value === undefined || value === 'Themed') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > 1e8)
    throw new Error(`Invalid Visio geometry cell ${name}.`);
  return parsed;
}
function multiply(left: Matrix, right: Matrix): Matrix {
  const [a, b, c, d, e, f] = left;
  const [g, h, i, j, k, l] = right;
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f,
  ];
}
function transform(matrix: Matrix, x: number, y: number) {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  };
}
function nodeKind(shape: Shape): NodeKind {
  if (
    shape.nested.length ||
    attr(shape.source, 'Type') === 'Group' ||
    attr(shape.template ?? shape.source, 'Type') === 'Group'
  )
    return 'group';
  const name = `${shape.name} ${shape.masterName ?? ''}`.toLowerCase();
  if (/decision|diamond/.test(name)) return 'decision';
  if (/database|cylinder/.test(name)) return 'database';
  if (/document/.test(name)) return 'document';
  if (/terminator|start/.test(name)) return 'start';
  if (/process|rectangle/.test(name)) return 'process';
  return 'generic';
}

export function importVisioShapes(
  graph: Graph,
  page: XmlNode,
  pageHeight: number,
  context: VisioShapeContext,
  budget: { nodes: number; edges: number } = diagramImportLimits,
) {
  const allIds = new Set<string>();
  const connections = new Map<string, { begin?: string; end?: string; ambiguous?: boolean }>();
  for (const connect of descendants(page, 'Connect')) {
    const id = attr(connect, 'FromSheet');
    const target = attr(connect, 'ToSheet');
    const cell = attr(connect, 'FromCell');
    if (!id || !target || !['BeginX', 'BeginY', 'EndX', 'EndY'].includes(cell ?? '')) continue;
    const entry = connections.get(id) ?? {};
    const side = cell!.startsWith('Begin') ? 'begin' : 'end';
    if (entry[side] && entry[side] !== target) entry.ambiguous = true;
    entry[side] = target;
    connections.set(id, entry);
    if (connections.size > 40000) throw new Error('Visio pages are limited to 40,000 connections.');
  }
  let shapeCount = 0;
  const resolve = (
    source: XmlNode,
    inheritedTemplate: XmlNode | undefined,
    synthetic: string | undefined,
    masterContext: VisioMaster | undefined,
    path: Set<XmlNode>,
    scaleX = 1,
    scaleY = 1,
  ): Shape => {
    if (++shapeCount > 60000) throw new Error('Visio pages are limited to 60,000 shapes.');
    const id = synthetic ?? attr(source, 'ID');
    if (!id || allIds.has(id)) throw new Error('Visio shape IDs must be unique within a page.');
    allIds.add(id);
    const masterId = attr(source, 'Master');
    const master = masterId ? context.master(masterId) : masterContext;
    let template = inheritedTemplate;
    if (masterId && master) template = master.root;
    const masterShape = attr(source, 'MasterShape');
    if (masterShape && master) template = master.shapes.get(masterShape);
    if ((masterId && !master) || (masterShape && !template))
      context.warn('Some Visio masters are missing; available shape properties were imported.');
    if (template && path.has(template))
      throw new Error('Visio master inheritance contains a cycle.');
    const nextPath = new Set(path);
    if (template) nextPath.add(template);
    const cells: Cells = new Map();
    for (const styleName of ['FillStyle', 'LineStyle', 'TextStyle']) {
      const style = attr(source, styleName) ?? (template && attr(template, styleName));
      if (style !== undefined)
        for (const [name, value] of context.style(style)) cells.set(name, value);
    }
    for (const [name, value] of visioCells(template)) cells.set(name, value);
    // A resized master group has child coordinates in the master's coordinate system.
    // Local cached values already reflect the instance's dimensions and must not scale twice.
    for (const name of ['PinX', 'LocPinX', 'Width'])
      if (cells.has(name)) cells.set(name, String(number(cells, name, 0) * scaleX));
    for (const name of ['PinY', 'LocPinY', 'Height'])
      if (cells.has(name)) cells.set(name, String(number(cells, name, 0) * scaleY));
    for (const [name, value] of visioCells(source)) cells.set(name, value);
    const text = first(source, 'Text') ?? (template && first(template, 'Text'));
    const name =
      attr(source, 'Name') ??
      attr(source, 'NameU') ??
      (template && (attr(template, 'Name') ?? attr(template, 'NameU'))) ??
      master?.name ??
      `Shape ${id}`;
    const nested: Shape[] = [];
    const localShapes = first(source, 'Shapes');
    const inheritedShapes = template && first(template, 'Shapes');
    const localChildren = localShapes ? children(localShapes, 'Shape') : [];
    const templateChildren = inheritedShapes ? children(inheritedShapes, 'Shape') : [];
    const templateById = new Map(templateChildren.map((item) => [attr(item, 'ID'), item]));
    const templateCells = visioCells(template);
    const childScaleX = number(cells, 'Width', 1) / (number(templateCells, 'Width', 1) || 1);
    const childScaleY = number(cells, 'Height', 1) / (number(templateCells, 'Height', 1) || 1);
    const overridden = new Set(
      localChildren.map((child) => attr(child, 'MasterShape')).filter(Boolean),
    );
    for (const child of localChildren) {
      if (attr(child, 'Del') === '1') continue;
      const match = templateById.get(attr(child, 'MasterShape'));
      nested.push(resolve(child, match, undefined, master, nextPath, childScaleX, childScaleY));
    }
    for (const child of templateChildren) {
      const masterChildId = attr(child, 'ID');
      if (!masterChildId || overridden.has(masterChildId) || attr(child, 'Del') === '1') continue;
      // Master-only children have no page IDs. Synthetic external IDs keep them unique.
      const empty = {
        ...child,
        attributes: { ID: `${id}:master:${masterChildId}` },
        children: [],
        content: [],
        text: '',
      };
      nested.push(
        resolve(
          empty,
          child,
          `${id}:master:${masterChildId}`,
          master,
          nextPath,
          childScaleX,
          childScaleY,
        ),
      );
    }
    return {
      id,
      source,
      template,
      cells,
      name,
      text: text ? textContent(text).trim() : '',
      masterId: master?.id,
      masterName: master?.name,
      nested,
    };
  };
  const nodes = new Map<string, GraphNode>();
  const connectorShapes: Shape[] = [];
  const walk = (shape: Shape, parent: Matrix, parentId?: string) => {
    const isConnector =
      connections.has(shape.id) ||
      attr(shape.source, 'OneD') === '1' ||
      ['BeginX', 'BeginY', 'EndX', 'EndY'].every((name) => shape.cells.has(name));
    if (isConnector) {
      connectorShapes.push(shape);
      return;
    }
    if (graph.nodes.length >= budget.nodes)
      throw new Error('A Visio import is limited to 20,000 nodes in total.');
    const width = number(shape.cells, 'Width', 2);
    const height = number(shape.cells, 'Height', 0.9);
    if (width < 0 || height < 0) throw new Error('Visio shape dimensions cannot be negative.');
    const pinX = number(shape.cells, 'PinX', width / 2);
    const pinY = number(shape.cells, 'PinY', height / 2);
    const locX = number(shape.cells, 'LocPinX', width / 2);
    const locY = number(shape.cells, 'LocPinY', height / 2);
    const angle = number(shape.cells, 'Angle', 0);
    const flipX = number(shape.cells, 'FlipX', 0) ? -1 : 1;
    const flipY = number(shape.cells, 'FlipY', 0) ? -1 : 1;
    const cos = Math.cos(angle),
      sin = Math.sin(angle);
    const local: Matrix = [cos * flipX, sin * flipX, -sin * flipY, cos * flipY, 0, 0];
    local[4] = pinX - local[0] * locX - local[2] * locY;
    local[5] = pinY - local[1] * locX - local[3] * locY;
    const matrix = multiply(parent, local);
    const corners = [
      [0, 0],
      [width, 0],
      [0, height],
      [width, height],
    ].map(([x, y]) => transform(matrix, x, y));
    const xMin = Math.min(...corners.map((point) => point.x));
    const xMax = Math.max(...corners.map((point) => point.x));
    const yMin = Math.min(...corners.map((point) => point.y));
    const yMax = Math.max(...corners.map((point) => point.y));
    const geometry = [xMin * 96, (pageHeight - yMax) * 96, (xMax - xMin) * 96, (yMax - yMin) * 96];
    if (geometry.some((value) => !Number.isFinite(value) || Math.abs(value) > 1e8))
      throw new Error('Visio geometry exceeds supported canvas coordinates.');
    if (Math.abs(angle) > 1e-8 || flipX < 0 || flipY < 0)
      context.warn(
        'Rotated and flipped Visio shapes use their page bounds; labels remain readable.',
      );
    if (geometry[2] < 40 || geometry[3] < 30)
      context.warn('Very small Visio shapes were enlarged to the minimum editable node size.');
    if (descendants(shape.source, 'ForeignData').length)
      context.warn(
        'Embedded Visio images and objects are omitted; their labeled shapes remain editable.',
      );
    const color = context.color(shape.cells.get('FillForegnd'));
    const lineColor = context.color(shape.cells.get('LineColor'));
    const node = newNode(graph.diagram.id, {
      externalId: `vsdx:${shape.id}`,
      title: (shape.text || shape.name.trim() || `Shape ${shape.id}`).slice(0, 1000),
      notes: shape.text.length > 1000 ? shape.text : undefined,
      nodeType: nodeKind(shape),
      x: geometry[0],
      y: geometry[1],
      width: Math.max(40, geometry[2]),
      height: Math.max(30, geometry[3]),
      parentId,
      color,
      metadata: {
        diagramImport: {
          format: 'vsdx',
          sourceId: shape.id,
          sourceName: shape.name,
          ...(shape.masterId ? { masterId: shape.masterId } : {}),
          ...(lineColor ? { strokeColor: lineColor } : {}),
          ...(angle ? { rotation: angle } : {}),
          ...(flipX < 0 || flipY < 0 ? { flipX: flipX < 0, flipY: flipY < 0 } : {}),
        },
      },
    });
    graph.nodes.push(node);
    nodes.set(shape.id, node);
    for (const child of shape.nested) walk(child, matrix, node.id);
  };
  const shapes = first(page, 'Shapes');
  if (shapes)
    for (const source of children(shapes, 'Shape')) {
      if (attr(source, 'Del') !== '1')
        walk(resolve(source, undefined, undefined, undefined, new Set()), identity);
    }
  for (const shape of connectorShapes) {
    const connection = connections.get(shape.id);
    const source = connection?.begin && nodes.get(connection.begin);
    const target = connection?.end && nodes.get(connection.end);
    if (!source || !target || connection?.ambiguous) {
      context.warn('Visio connectors with missing or ambiguous endpoints were omitted.');
      continue;
    }
    if (graph.edges.length >= budget.edges)
      throw new Error('A Visio import is limited to 40,000 connections in total.');
    const beginArrow = number(shape.cells, 'BeginArrow', 0) !== 0;
    const endArrow = number(shape.cells, 'EndArrow', 0) !== 0;
    const pattern = number(shape.cells, 'LinePattern', 1);
    const color = context.color(shape.cells.get('LineColor'));
    const strokeWidth = Math.max(
      0.5,
      Math.min(12, number(shape.cells, 'LineWeight', 1.6 / 96) * 96),
    );
    graph.edges.push(
      newEdge(graph.diagram.id, source.id, target.id, {
        externalId: `vsdx:${shape.id}`,
        label: shape.text || undefined,
        direction: beginArrow ? (endArrow ? 'both' : 'backward') : endArrow ? 'forward' : 'none',
        style: pattern === 3 || pattern === 5 ? 'dotted' : pattern > 1 ? 'dashed' : 'solid',
        metadata: {
          diagramImport: {
            format: 'vsdx',
            sourceId: shape.id,
            strokeWidth,
            ...(color ? { strokeColor: color } : {}),
          },
        },
      }),
    );
    context.warn('Visio connector paths are recalculated between their imported endpoints.');
  }
}

export function visioColor(value: string | undefined, palette: Map<string, string>) {
  if (!value) return undefined;
  const direct = safeColor(value);
  if (direct) return direct;
  const fromPalette = palette.get(value);
  if (fromPalette) return fromPalette;
  const rgb = /^RGB\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(value);
  if (!rgb || rgb.slice(1).some((channel) => Number(channel) > 255)) return undefined;
  return `#${rgb
    .slice(1)
    .map((channel) => Number(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

export const defaultVisioPalette = new Map([
  ['0', '#000000'],
  ['1', '#ffffff'],
  ['2', '#ff0000'],
  ['3', '#00ff00'],
  ['4', '#0000ff'],
  ['5', '#ffff00'],
  ['6', '#ff00ff'],
  ['7', '#00ffff'],
  ['8', '#800000'],
  ['9', '#008000'],
  ['10', '#000080'],
  ['11', '#808000'],
  ['12', '#800080'],
  ['13', '#008080'],
  ['14', '#c0c0c0'],
  ['15', '#808080'],
]);
