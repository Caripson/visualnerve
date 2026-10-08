import type { Graph } from '../model/types';
import { StorageError } from '../model/errors';
import { markdown } from './semantic';
import { checkExportActive, waitForExport, type ExportGuard } from './guard';

/** Read-only export: SVG rendering is lazy and never opens or changes a project. */
export async function exportCommand(
  graph: Graph,
  data: Record<string, unknown>,
  guard?: ExportGuard,
) {
  await checkExportActive(guard);
  if (typeof data.format !== 'string' || !['json', 'markdown', 'svg'].includes(data.format))
    throw new StorageError(422, 'Choose json, markdown or svg for diagram export.');
  if (data.format !== 'svg') {
    if (Object.keys(data).some((key) => !['diagramId', 'format'].includes(key)))
      throw new StorageError(422, 'Export area options are available only for SVG.');
    return data.format === 'markdown' ? markdown(graph) : graph;
  }
  if (Object.keys(data).some((key) => !['diagramId', 'format', 'scope', 'nodeIds'].includes(key)))
    throw new StorageError(422, 'Unsupported SVG export option.');
  const scope = data.scope === undefined ? 'complete' : data.scope;
  if (scope !== 'complete' && scope !== 'viewport' && scope !== 'selected')
    throw new StorageError(422, 'SVG scope must be complete, viewport or selected.');
  const nodes = new Set(graph.nodes.map((node) => node.id));
  if (data.nodeIds !== undefined && scope !== 'selected')
    throw new StorageError(422, 'SVG nodeIds requires selected scope.');
  if (
    scope === 'selected' &&
    (!Array.isArray(data.nodeIds) ||
      !data.nodeIds.length ||
      data.nodeIds.length > 20000 ||
      data.nodeIds.some((id) => typeof id !== 'string' || !nodes.has(id)) ||
      new Set(data.nodeIds).size !== data.nodeIds.length)
  )
    throw new StorageError(422, 'Choose unique existing node UUIDs for selected SVG export.');
  const { graphSVG } = await waitForExport(import('./svg'), guard);
  await checkExportActive(guard);
  return guard
    ? graphSVG(graph, scope, (data.nodeIds ?? []) as string[], guard)
    : graphSVG(graph, scope, (data.nodeIds ?? []) as string[]);
}
