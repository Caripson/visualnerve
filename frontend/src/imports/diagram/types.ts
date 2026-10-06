import type { Graph } from '../../model/types';

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
  fileBytes: 32 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024,
  entries: 2048,
  pages: 100,
  nodes: 20_000,
  edges: 40_000,
  xmlDepth: 256,
  xmlElements: 250_000,
} as const;
