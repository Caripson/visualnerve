import type { Graph } from '../../model/types';
import {
  checkedImportLimitBytes,
  DEFAULT_IMPORT_LIMIT_BYTES,
  MAX_IMPORT_LIMIT_BYTES,
} from '../limits';

export type DiagramFileFormat = 'drawio' | 'vsdx';
export interface DiagramImportPage {
  id: string;
  name: string;
  graph: Graph;
  warnings: string[];
}
export interface DiagramImportResult {
  format: DiagramFileFormat;
  pages: DiagramImportPage[];
  warnings: string[];
}
export interface DiagramFileInput {
  format: DiagramFileFormat;
  data: string;
  name?: string;
}
export const diagramImportLimits = {
  fileBytes: DEFAULT_IMPORT_LIMIT_BYTES,
  expandedBytes: 2 * DEFAULT_IMPORT_LIMIT_BYTES,
  entries: 2048,
  pages: 100,
  nodes: 20_000,
  edges: 40_000,
  xmlDepth: 256,
  xmlElements: 250_000,
} as const;

export function diagramByteLimits(byteLimit = DEFAULT_IMPORT_LIMIT_BYTES) {
  const fileBytes = checkedImportLimitBytes(byteLimit);
  return {
    fileBytes,
    expandedBytes: Math.min(MAX_IMPORT_LIMIT_BYTES, fileBytes * 2),
  };
}
