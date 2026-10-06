import { Inflate } from 'fflate';
import { blankGraph, newEdge, newNode, type Graph, type NodeKind } from '../../model/types';
import {
  diagramImportLimits,
  diagramByteLimits,
  type DiagramImportPage,
  type DiagramImportResult,
} from './types';
import { assertImportBytes, DEFAULT_IMPORT_LIMIT_BYTES, utf8Bytes } from '../limits';
import {
  attr,
  children,
  descendants,
  first,
  parseXml,
  plainText,
  safeColor,
  textContent,
  type XmlNode,
} from './xml';

interface Cell {
  id: string;
  parent?: string;
  source?: string;
  target?: string;
  vertex: boolean;
  edge: boolean;
  value: string;
  link?: string;
  collapsed: boolean;
  geometry?: XmlNode;
  style: Record<string, string>;
}

interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

const sourceId = (page: string, cell: string) =>
  `drawio:${encodeURIComponent(page)}:${encodeURIComponent(cell)}`;

function styles(value: string | undefined): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const entry of (value ?? '').split(';')) {
    if (!entry) continue;
    const equals = entry.indexOf('=');
    if (equals < 0) result[entry] = '1';
    else result[entry.slice(0, equals)] = entry.slice(equals + 1);
  }
  return result;
}

function numeric(value: string | undefined, fallback: number, warnings: Set<string>): number {
  if (value === undefined || value === '') return fallback;
  const result = Number(value);
  if (Number.isFinite(result) && Math.abs(result) <= 1e8) return result;
  warnings.add('Invalid coordinates or dimensions were replaced with defaults.');
  return fallback;
}

function title(
  value: string,
  fallback: string,
  warnings: Set<string>,
  limit = 1000,
  markup = true,
): string {
  const text = (markup ? plainText(value) : value).trim();
  if (text.length > limit)
    warnings.add(`Labels longer than ${limit.toLocaleString('en-US')} characters were shortened.`);
  return text.slice(0, limit) || fallback;
}

const cellText = (cell: Cell) =>
  cell.style.html === '0'
    ? cell.value.replace(/\r\n?/g, '\n').trim()
    : plainText(cell.value).trim();

function nodeKind(cell: Cell, grouped: boolean, warnings: Set<string>): NodeKind {
  if (
    grouped ||
    cell.style.group === '1' ||
    cell.style.container === '1' ||
    cell.style.swimlane === '1'
  )
    return 'group';
  const shape =
    cell.style.shape ||
    Object.keys(cell.style).find(
      (key) =>
        cell.style[key] === '1' &&
        ['ellipse', 'rhombus', 'cylinder', 'swimlane', 'text', 'actor'].includes(key),
    ) ||
    'rectangle';
  if (shape === 'image' || cell.style.image) {
    warnings.add('Images were imported as labeled nodes; image contents were not imported.');
    return 'generic';
  }
  if (/^(?:cylinder[123]?|datastore|mxgraph\.flowchart\.(?:database|data_storage))$/.test(shape))
    return 'database';
  if (/^(?:rhombus|mxgraph\.flowchart\.decision)$/.test(shape)) return 'decision';
  if (/^(?:document|mxgraph\.flowchart\.document)$/.test(shape)) return 'document';
  if (/^(?:note[12]?|text)$/.test(shape)) return 'note';
  if (/^(?:actor|umlActor)$/.test(shape)) return 'person';
  if (/^(?:ellipse|doubleEllipse|startState|mxgraph\.flowchart\.start[_.]?end)$/.test(shape))
    return 'start';
  if (shape === 'endState') return 'end';
  if (/^(?:parallelogram|manualInput)$/.test(shape)) return 'input';
  if (/^(?:rectangle|rect2|label|process[2]?|swimlane|group|table|tableRow)$/.test(shape))
    return 'process';
  warnings.add('Custom shapes were mapped to editable Visual Nerve nodes.');
  return 'generic';
}

function cellsFor(model: XmlNode, warnings: Set<string>): Cell[] {
  const root = first(model, 'root');
  if (!root) throw new Error('The draw.io page has no graph root.');
  const result: Cell[] = [];
  const ids = new Set<string>();
  for (const entry of children(root)) {
    const cell = entry.name === 'mxCell' ? entry : first(entry, 'mxCell');
    if (!cell) continue;
    const wrapper = cell === entry ? undefined : entry;
    const id = (wrapper && attr(wrapper, 'id')) || attr(cell, 'id');
    if (!id) {
      if (attr(cell, 'vertex') === '1' || attr(cell, 'edge') === '1')
        throw new Error('A draw.io shape or connector has no source ID.');
      continue;
    }
    if (ids.has(id)) throw new Error(`Duplicate draw.io cell ID: ${id.slice(0, 100)}.`);
    ids.add(id);
    const value =
      (wrapper && (attr(wrapper, 'label') ?? attr(wrapper, 'value'))) ?? attr(cell, 'value') ?? '';
    const style = styles(attr(cell, 'style'));
    if (attr(cell, 'visible') === '0')
      warnings.add('Hidden source layers/objects are imported as visible objects.');
    if (attr(cell, 'vertex') === '1' && attr(cell, 'edge') === '1')
      throw new Error('A draw.io cell cannot be both a shape and a connector.');
    if (/[<>]/.test(value) && style.html !== '0')
      warnings.add('Rich text labels were converted to plain text.');
    if (style.rotation && Number(style.rotation) % 360 !== 0)
      warnings.add('Rotated shapes were imported without rotation.');
    if (style.flipH === '1' || style.flipV === '1')
      warnings.add('Flipped shapes were imported without mirroring.');
    result.push({
      id,
      parent: attr(cell, 'parent'),
      source: attr(cell, 'source'),
      target: attr(cell, 'target'),
      vertex: attr(cell, 'vertex') === '1',
      edge: attr(cell, 'edge') === '1',
      value,
      link: (wrapper && attr(wrapper, 'link')) || attr(cell, 'link'),
      collapsed: attr(cell, 'collapsed') === '1',
      geometry: first(cell, 'mxGeometry'),
      style,
    });
  }
  return result;
}

function importPage(
  model: XmlNode,
  id: string,
  name: string,
  filename: string,
  budget: { nodes: number; edges: number } = diagramImportLimits,
): DiagramImportPage {
  if (model.name !== 'mxGraphModel')
    throw new Error('The draw.io page does not contain an mxGraphModel.');
  const warnings = new Set<string>();
  const cells = cellsFor(model, warnings);
  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  const vertices = cells.filter((cell) => cell.vertex && !byId.get(cell.parent ?? '')?.edge);
  const edges = cells.filter((cell) => cell.edge);
  if (vertices.length > diagramImportLimits.nodes || edges.length > diagramImportLimits.edges)
    throw new Error('The draw.io page exceeds the node or connector import limit.');
  if (vertices.length > budget.nodes || edges.length > budget.edges)
    throw new Error('A draw.io import is limited to 20,000 nodes and 40,000 connections in total.');
  const groupIds = new Set(
    vertices.flatMap((cell) => (byId.get(cell.parent ?? '')?.vertex ? [cell.parent!] : [])),
  );
  const graph: Graph = blankGraph(name, 'freeform');
  graph.diagram.metadata.diagramImport = { format: 'drawio', filename, pageId: id, pageName: name };
  graph.diagram.settings.grid = attr(model, 'grid') !== '0';
  graph.diagram.settings.snap = false;
  const geometries = new Map<string, Geometry>();
  const groupDepths = new Map<string, number>();
  const resolving = new Set<string>();
  const geometry = (cell: Cell, depth = 0): Geometry => {
    const cached = geometries.get(cell.id);
    if (cached) return cached;
    if (resolving.has(cell.id)) throw new Error('The draw.io page contains cyclic groups.');
    if (depth > diagramImportLimits.xmlDepth)
      throw new Error('The draw.io group nesting exceeds the import limit.');
    resolving.add(cell.id);
    const parent = byId.get(cell.parent ?? '');
    const origin = parent?.vertex
      ? geometry(parent, depth + 1)
      : { x: 0, y: 0, width: 0, height: 0 };
    const groupDepth = parent?.vertex ? groupDepths.get(parent.id)! + 1 : 0;
    if (groupDepth > diagramImportLimits.xmlDepth)
      throw new Error('The draw.io group nesting exceeds the import limit.');
    if (!cell.geometry)
      warnings.add('Shapes with missing geometry were given default dimensions and coordinates.');
    const relative = cell.geometry && attr(cell.geometry, 'relative') === '1' && parent?.vertex;
    const offset =
      cell.geometry &&
      children(cell.geometry, 'mxPoint').find((point) => attr(point, 'as') === 'offset');
    const rawWidth = numeric(cell.geometry && attr(cell.geometry, 'width'), 160, warnings);
    const rawHeight = numeric(cell.geometry && attr(cell.geometry, 'height'), 70, warnings);
    if (rawWidth < 40 || rawHeight < 30)
      warnings.add('Very small shapes were enlarged to the editable minimum size.');
    const result = {
      x:
        origin.x +
        numeric(cell.geometry && attr(cell.geometry, 'x'), 0, warnings) *
          (relative ? origin.width : 1) +
        (relative && offset ? numeric(attr(offset, 'x'), 0, warnings) : 0),
      y:
        origin.y +
        numeric(cell.geometry && attr(cell.geometry, 'y'), 0, warnings) *
          (relative ? origin.height : 1) +
        (relative && offset ? numeric(attr(offset, 'y'), 0, warnings) : 0),
      width: Math.max(40, rawWidth),
      height: Math.max(30, rawHeight),
    };
    if (Math.abs(result.x) > 1e8 || Math.abs(result.y) > 1e8)
      throw new Error('The draw.io page contains coordinates outside the supported range.');
    resolving.delete(cell.id);
    geometries.set(cell.id, result);
    groupDepths.set(cell.id, groupDepth);
    return result;
  };
  const importedNodes = new Map<string, ReturnType<typeof newNode>>();
  for (const cell of vertices) {
    const node = newNode(graph.diagram.id, {
      ...geometry(cell),
      externalId: sourceId(id, cell.id),
      title: title(
        cellText(cell),
        groupIds.has(cell.id) || cell.style.group === '1' ? 'Group' : 'Untitled node',
        warnings,
        1000,
        false,
      ),
      nodeType: nodeKind(cell, groupIds.has(cell.id), warnings),
      color: safeColor(cell.style.fillColor),
      collapsed: cell.collapsed,
      metadata: {
        diagramImport: {
          format: 'drawio',
          pageId: id,
          sourceId: cell.id,
          ...(cell.style.shape ? { shape: cell.style.shape.slice(0, 200) } : {}),
          ...(safeColor(cell.style.strokeColor)
            ? { strokeColor: safeColor(cell.style.strokeColor) }
            : {}),
          ...(safeColor(cell.style.fontColor)
            ? { fontColor: safeColor(cell.style.fontColor) }
            : {}),
        },
      },
    });
    if (cell.link) {
      try {
        const url = new URL(cell.link);
        if (
          (url.protocol === 'https:' || url.protocol === 'http:') &&
          url.host &&
          !url.username &&
          !url.password
        )
          node.url = url.href;
        else warnings.add('Unsupported or unsafe links were omitted.');
      } catch {
        warnings.add('Unsupported or unsafe links were omitted.');
      }
    }
    importedNodes.set(cell.id, node);
    graph.nodes.push(node);
  }
  for (const cell of vertices) {
    const node = importedNodes.get(cell.id)!;
    const parent = importedNodes.get(cell.parent ?? '');
    if (parent?.nodeType === 'group') node.parentId = parent.id;
    else if (cell.parent && !byId.has(cell.parent))
      warnings.add('Missing parent groups were omitted.');
  }
  const labels = new Map<string, string[]>();
  for (const cell of cells) {
    if (!cell.vertex || !cell.parent || !byId.get(cell.parent)?.edge) continue;
    const label = cellText(cell);
    if (label) labels.set(cell.parent, [...(labels.get(cell.parent) ?? []), label]);
  }
  for (const cell of edges) {
    const source = importedNodes.get(cell.source ?? '');
    const target = importedNodes.get(cell.target ?? '');
    if (!source || !target) {
      warnings.add('Connectors with missing or unattached endpoints were omitted.');
      continue;
    }
    if (
      cell.geometry &&
      (descendants(cell.geometry, 'mxPoint').length || first(cell.geometry, 'Array'))
    )
      warnings.add('Manual connector routes were replaced by Visual Nerve routing.');
    const start = !!cell.style.startArrow && cell.style.startArrow !== 'none';
    const end = (cell.style.endArrow ?? 'classic') !== 'none';
    const label = [cellText(cell), ...(labels.get(cell.id) ?? [])].filter(Boolean).join(' · ');
    const strokeWidth = numeric(cell.style.strokeWidth, 1.6, warnings);
    graph.edges.push(
      newEdge(graph.diagram.id, source.id, target.id, {
        externalId: sourceId(id, cell.id),
        ...(label ? { label: title(label, '', warnings, 1000, false) } : {}),
        direction: start && end ? 'both' : start ? 'backward' : end ? 'forward' : 'none',
        style:
          cell.style.dashed === '1'
            ? /^1(?:\s|$)/.test(cell.style.dashPattern ?? '')
              ? 'dotted'
              : 'dashed'
            : 'solid',
        metadata: {
          diagramImport: {
            format: 'drawio',
            pageId: id,
            sourceId: cell.id,
            ...(safeColor(cell.style.strokeColor)
              ? { strokeColor: safeColor(cell.style.strokeColor) }
              : {}),
            strokeWidth: Math.max(0.5, Math.min(16, strokeWidth)),
          },
        },
      }),
    );
  }
  return { id, name, graph, warnings: [...warnings] };
}

function compressedModel(value: string, maxBytes: number): { model: XmlNode; bytes: number } {
  const encoded = value.replace(/\s/g, '');
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
    throw new Error('The compressed draw.io page is not valid Base64.');
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    throw new Error('The compressed draw.io page is not valid Base64.');
  }
  const input = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const chunks: Uint8Array[] = [];
  let size = 0;
  const inflater = new Inflate((chunk) => {
    size += chunk.length;
    if (size > maxBytes) throw new Error('The expanded draw.io file exceeds the import limit.');
    chunks.push(chunk.slice());
  });
  try {
    for (let offset = 0; offset < input.length; offset += 1024)
      inflater.push(input.subarray(offset, offset + 1024), offset + 1024 >= input.length);
  } catch (error) {
    if (error instanceof Error && error.message.includes('exceeds the import limit')) throw error;
    throw new Error('The compressed draw.io page contains invalid DEFLATE data.');
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let xml: string;
  try {
    xml = decodeURIComponent(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('The compressed draw.io page contains invalid encoded XML.');
  }
  return { model: parseXml(xml, Math.max(1, maxBytes)), bytes: size };
}

/** Convert draw.io pages to editable native diagrams without a DOM or network access. */
export function parseDrawio(
  text: string,
  filename: string,
  byteLimit = DEFAULT_IMPORT_LIMIT_BYTES,
): DiagramImportResult {
  const limits = diagramByteLimits(byteLimit);
  const fileSize = utf8Bytes(text);
  assertImportBytes(fileSize, limits.fileBytes, 'draw.io file');
  const document = parseXml(text, limits.expandedBytes);
  const fallback =
    plainText(filename.replace(/\.(?:drawio|xml)$/i, ''))
      .trim()
      .slice(0, 200) || 'Imported draw.io diagram';
  if (document.name === 'mxGraphModel')
    return {
      format: 'drawio',
      pages: [importPage(document, 'page-1', fallback, filename)],
      warnings: [],
    };
  if (document.name !== 'mxfile')
    throw new Error('Choose a draw.io mxfile or mxGraphModel document.');
  const pages = children(document, 'diagram');
  if (!pages.length) throw new Error('The draw.io file contains no diagram pages.');
  if (pages.length > diagramImportLimits.pages)
    throw new Error('The draw.io file exceeds the page import limit.');
  const ids = new Set<string>();
  let expandedSize = fileSize;
  let nodeCount = 0;
  let edgeCount = 0;
  const result = pages.map((page, index) => {
    const id = attr(page, 'id') || `page-${index + 1}`;
    if (ids.has(id)) throw new Error('The draw.io file contains duplicate page IDs.');
    ids.add(id);
    const nameWarnings = new Set<string>();
    const name = title(
      attr(page, 'name') || '',
      pages.length > 1 ? `${fallback} — Page ${index + 1}` : fallback,
      nameWarnings,
      500,
    );
    const convert = (model: XmlNode) => {
      const imported = importPage(model, id, name, filename, {
        nodes: diagramImportLimits.nodes - nodeCount,
        edges: diagramImportLimits.edges - edgeCount,
      });
      nodeCount += imported.graph.nodes.length;
      edgeCount += imported.graph.edges.length;
      imported.warnings.push(...nameWarnings);
      return imported;
    };
    const inline = first(page, 'mxGraphModel');
    if (inline) return convert(inline);
    const payload = textContent(page).trim();
    if (payload.startsWith('<')) return convert(parseXml(payload, limits.expandedBytes));
    const inflated = compressedModel(payload, limits.expandedBytes - expandedSize);
    expandedSize += inflated.bytes;
    return convert(inflated.model);
  });
  return { format: 'drawio', pages: result, warnings: [] };
}
