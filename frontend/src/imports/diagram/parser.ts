import { validateGraph } from '../../model/validation';
import { parseDrawio } from './drawio';
import { parseVsdx } from './vsdx';
import { decodeXmlBytes } from './input';
import {
  diagramImportLimits,
  diagramByteLimits,
  type DiagramFileFormat,
  type DiagramImportResult,
} from './types';
import { assertImportBytes, DEFAULT_IMPORT_LIMIT_BYTES, LARGE_IMPORT_WARNING } from '../limits';

export function parseDiagramBytes(
  format: DiagramFileFormat,
  bytes: Uint8Array,
  name: string,
  byteLimit = DEFAULT_IMPORT_LIMIT_BYTES,
): DiagramImportResult {
  const limits = diagramByteLimits(byteLimit);
  assertImportBytes(bytes.byteLength, limits.fileBytes, 'Diagram file');
  const result =
    format === 'drawio'
      ? parseDrawio(decodeXmlBytes(bytes), name, limits.fileBytes)
      : parseVsdx(bytes, name, limits.fileBytes);
  if (!result.pages.length || result.pages.length > diagramImportLimits.pages)
    throw new Error('Choose a diagram with between 1 and 100 pages.');
  let nodes = 0,
    edges = 0;
  const pages = new Set<string>();
  for (const page of result.pages) {
    if (
      !page.id.trim() ||
      [...page.id].length > 500 ||
      !page.name.trim() ||
      [...page.name].length > 500 ||
      pages.has(page.id)
    )
      throw new Error('Diagram pages need unique identifiers and names within 500 characters.');
    pages.add(page.id);
    nodes += page.graph.nodes.length;
    edges += page.graph.edges.length;
    if (nodes > diagramImportLimits.nodes || edges > diagramImportLimits.edges)
      throw new Error('Diagram exceeds 20,000 objects or 40,000 connections across all pages.');
    validateGraph(page.graph);
    page.warnings = [...new Set(page.warnings)].slice(0, 200);
  }
  result.warnings = [...new Set(result.warnings)].slice(0, 200);
  if (bytes.byteLength > DEFAULT_IMPORT_LIMIT_BYTES)
    result.warnings = [LARGE_IMPORT_WARNING, ...result.warnings].slice(0, 200);
  return result;
}
