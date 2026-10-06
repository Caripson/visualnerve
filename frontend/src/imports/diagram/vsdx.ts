import { blankGraph } from '../../model/types';
import { diagramImportLimits, type DiagramImportResult } from './types';
import { attr, children, descendants, first, parseXml, safeColor, type XmlNode } from './xml';
import { VisioPackage, relationshipPart, resolveVisioPart } from './vsdx-zip';
import {
  defaultVisioPalette,
  importVisioShapes,
  visioCells,
  visioColor,
  type VisioMaster,
} from './vsdx-shapes';

interface Relationship {
  id: string;
  type: string;
  target: string;
}

/** Import structural Visio content, without evaluating ShapeSheet formulas or loading media. */
export function parseVsdx(bytes: Uint8Array, name: string): DiagramImportResult {
  const archive = new VisioPackage(bytes);
  const warnings = new Set<string>();
  const warn = (message: string) => {
    if (warnings.size < 100) warnings.add(message);
  };
  const relations = (part: string): Map<string, Relationship> => {
    const path = relationshipPart(part);
    if (!archive.has(path)) return new Map();
    const root = parseXml(archive.text(path));
    if (root.name !== 'Relationships') throw new Error('Invalid Visio package relationships.');
    const result = new Map<string, Relationship>();
    for (const relation of children(root, 'Relationship')) {
      const id = attr(relation, 'Id');
      const type = attr(relation, 'Type');
      const target = attr(relation, 'Target');
      if (!id || !type || !target || result.has(id)) throw new Error('Invalid Visio relationship.');
      if (attr(relation, 'TargetMode') === 'External') {
        warn('External Visio links and resources are not fetched.');
        continue;
      }
      result.set(id, { id, type, target: resolveVisioPart(part, target) });
    }
    return result;
  };
  const typedPart = (relationships: Map<string, Relationship>, suffix: string) =>
    [...relationships.values()].find((relationship) => relationship.type.endsWith(`/${suffix}`))
      ?.target;
  const packageRelations = relations('');
  const documentPath = typedPart(packageRelations, 'document') ?? 'visio/document.xml';
  if (!archive.has(documentPath)) throw new Error('This ZIP package is not a Visio .vsdx drawing.');
  const document = parseXml(archive.text(documentPath));
  if (document.name !== 'VisioDocument')
    throw new Error('This package does not contain a Visio document.');
  const documentRelations = relations(documentPath);
  const pagesPath = typedPart(documentRelations, 'pages') ?? 'visio/pages/pages.xml';
  const pagesXml = parseXml(archive.text(pagesPath));
  if (pagesXml.name !== 'Pages') throw new Error('Invalid Visio pages part.');
  const pageRelations = relations(pagesPath);
  const pageElements = children(pagesXml, 'Page');
  if (!pageElements.length) throw new Error('Visio drawing has no pages.');
  if (pageElements.length > 100) throw new Error('Visio drawings are limited to 100 pages.');
  const palette = new Map(defaultVisioPalette);
  for (const entry of descendants(document, 'ColorEntry')) {
    const index = attr(entry, 'IX');
    const color = safeColor(attr(entry, 'RGB') ?? '');
    if (index && color) palette.set(index, color);
  }
  const rawStyles = new Map<string, XmlNode>();
  for (const style of descendants(document, 'StyleSheet')) {
    const id = attr(style, 'ID');
    if (id) rawStyles.set(id, style);
  }
  const styleCache = new Map<string, Map<string, string>>();
  const getStyle = (id: string, path = new Set<string>()): Map<string, string> => {
    if (path.has(id)) throw new Error('Visio style inheritance contains a cycle.');
    if (path.size >= diagramImportLimits.xmlDepth)
      throw new Error('Visio style inheritance is nested too deeply.');
    const cached = styleCache.get(id);
    if (cached) return cached;
    const source = rawStyles.get(id);
    if (!source) return new Map();
    const nextPath = new Set(path);
    nextPath.add(id);
    const values = new Map<string, string>();
    for (const key of ['FillStyle', 'LineStyle', 'TextStyle']) {
      const parent = attr(source, key);
      if (parent && parent !== id)
        for (const [name, value] of getStyle(parent, nextPath)) values.set(name, value);
    }
    for (const [name, value] of visioCells(source)) values.set(name, value);
    styleCache.set(id, values);
    return values;
  };
  const mastersPath = typedPart(documentRelations, 'masters') ?? 'visio/masters/masters.xml';
  const masterSources = new Map<string, { name: string; target: string }>();
  if (archive.has(mastersPath)) {
    const mastersRoot = parseXml(archive.text(mastersPath));
    if (mastersRoot.name !== 'Masters') throw new Error('Invalid Visio masters part.');
    const masterRelations = relations(mastersPath);
    for (const master of children(mastersRoot, 'Master')) {
      const id = attr(master, 'ID');
      const relationId = first(master, 'Rel') && attr(first(master, 'Rel')!, 'r:id');
      const target = relationId && masterRelations.get(relationId)?.target;
      if (!id || masterSources.has(id)) throw new Error('Visio master IDs must be unique.');
      if (!target) {
        warn('Some Visio masters are missing; available shape properties were imported.');
        continue;
      }
      masterSources.set(id, {
        name: attr(master, 'Name') ?? attr(master, 'NameU') ?? `Master ${id}`,
        target,
      });
    }
  }
  const masterCache = new Map<string, VisioMaster>();
  const getMaster = (id: string, path = new Set<string>()): VisioMaster | undefined => {
    if (path.has(id)) throw new Error('Visio master inheritance contains a cycle.');
    if (path.size >= diagramImportLimits.xmlDepth)
      throw new Error('Visio master inheritance is nested too deeply.');
    const cached = masterCache.get(id);
    if (cached) return cached;
    const source = masterSources.get(id);
    if (!source || !archive.has(source.target)) return undefined;
    const masterXml = parseXml(archive.text(source.target));
    if (masterXml.name !== 'MasterContents') throw new Error('Invalid Visio master contents.');
    const shapes = descendants(masterXml, 'Shape');
    const roots = first(masterXml, 'Shapes');
    const root = roots && first(roots, 'Shape');
    if (!root) return undefined;
    const nextPath = new Set(path);
    nextPath.add(id);
    for (const shape of shapes) {
      const dependency = attr(shape, 'Master');
      if (dependency) {
        getMaster(dependency, nextPath);
        warn('Cross-master Visio inheritance uses locally cached shape properties.');
      }
    }
    const shapeIds = new Map<string, XmlNode>();
    for (const shape of shapes) {
      const shapeId = attr(shape, 'ID');
      if (!shapeId || shapeIds.has(shapeId))
        throw new Error('Visio master shape IDs must be unique.');
      shapeIds.set(shapeId, shape);
    }
    const master = { id, name: source.name, root, shapes: shapeIds };
    masterCache.set(id, master);
    return master;
  };
  const pageIds = new Set<string>();
  let nodeCount = 0;
  let edgeCount = 0;
  const pages = pageElements.map((source, index) => {
    const id = attr(source, 'ID') ?? String(index);
    if (pageIds.has(id)) throw new Error('Visio page IDs must be unique.');
    pageIds.add(id);
    const pageName =
      (attr(source, 'Name') ?? attr(source, 'NameU') ?? `Page ${index + 1}`).trim().slice(0, 500) ||
      `Page ${index + 1}`;
    const relationNode = first(source, 'Rel');
    const relationId = relationNode && attr(relationNode, 'r:id');
    const relationship = relationId && pageRelations.get(relationId);
    if (!relationship || !relationship.type.endsWith('/page'))
      throw new Error(`Visio page ${pageName} has no valid page relationship.`);
    const page = parseXml(archive.text(relationship.target));
    if (page.name !== 'PageContents') throw new Error('Invalid Visio page contents.');
    const localWarnings = new Set<string>();
    const pageWarn = (message: string) => {
      if (localWarnings.size < 100) localWarnings.add(message);
    };
    // Inspect relationships to report external/embedded resources, never open them.
    const dependencies = relations(relationship.target);
    if (
      [...dependencies.values()].some((relation) =>
        /\/(image|oleObject|control)$/.test(relation.type),
      )
    )
      pageWarn(
        'Embedded Visio images and objects are omitted; their labeled shapes remain editable.',
      );
    const sheet = visioCells(first(source, 'PageSheet'));
    const rawHeight = Number(sheet.get('PageHeight'));
    const pageHeight = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 11;
    if (!(Number.isFinite(rawHeight) && rawHeight > 0))
      pageWarn('Missing Visio page height uses 11 inches for vertical positioning.');
    const graph = blankGraph(pageName, 'freeform');
    graph.diagram.metadata.diagramImport = { format: 'vsdx', filename: name, pageId: id, pageName };
    importVisioShapes(
      graph,
      page,
      pageHeight,
      {
        master: getMaster,
        style: getStyle,
        color: (value) => {
          const color = visioColor(value, palette);
          if (value && !color)
            pageWarn('Some formula-based or themed Visio colors could not be reproduced.');
          return color;
        },
        warn: pageWarn,
      },
      {
        nodes: diagramImportLimits.nodes - nodeCount,
        edges: diagramImportLimits.edges - edgeCount,
      },
    );
    for (const entity of [...graph.nodes, ...graph.edges])
      (entity.metadata.diagramImport as Record<string, unknown>).pageId = id;
    nodeCount += graph.nodes.length;
    edgeCount += graph.edges.length;
    if (nodeCount > diagramImportLimits.nodes || edgeCount > diagramImportLimits.edges)
      throw new Error('A Visio import is limited to 20,000 nodes and 40,000 connections in total.');
    pageWarn(
      'Visio stencils and detailed formatting use editable native node shapes and color accents.',
    );
    return { id, name: pageName, graph, warnings: [...localWarnings] };
  });
  if (archive.names().some((part) => /vba|\.bin$|activex/i.test(part)))
    warn('Visio macros, controls and executable attachments are not imported or executed.');
  return { format: 'vsdx', pages, warnings: [...warnings] };
}
