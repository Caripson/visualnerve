import type { Graph } from '../model/types';
import { StorageError } from '../model/errors';
import { getCodeAnalysis, getCodeObject, getProjectDirectory } from '../code/schema';
import { getSqlTable } from '../sql/schema';
import { getSqlQueryResult, getSqlQuerySource } from '../sql/query-schema';
import { getCsvNode } from '../data/csv';
import { analysisForDataset, graphDatasets } from '../data/model';
import { QualityClient } from '../data/qualityClient';
import type { MeasureExplanation } from '../data/quality';

/** Explicit read request: original CSV cells are returned only for a chosen measure page. */
export async function diagramSourceEvidence(graph: Graph, query: URLSearchParams) {
  if (
    [...query.keys()].some(
      (key) => !['nodeId', 'metricId', 'offset', 'disposition'].includes(key),
    ) ||
    [...query.keys()].some((key) => query.getAll(key).length !== 1)
  )
    throw new StorageError(
      422,
      'Evidence accepts nodeId, optional metricId, offset and disposition only.',
    );
  const node = graph.nodes.find((item) => item.id === query.get('nodeId'));
  if (!node) throw new StorageError(404, 'Choose an object in this diagram.');
  const metricId = query.get('metricId');
  const csv = getCsvNode(node);
  const code = getCodeObject(node);
  const projectDirectory = getProjectDirectory(node);
  if (!metricId)
    return {
      diagramId: graph.diagram.id,
      graphVersion: graph.diagram.version,
      nodeId: node.id,
      code,
      projectDirectory,
      codeAnalysis: code || projectDirectory ? getCodeAnalysis(graph) : undefined,
      sqlTable: getSqlTable(node),
      sqlSource: getSqlQuerySource(node),
      sqlResult: getSqlQueryResult(node),
      csv,
      warnings:
        csv?.visible === false
          ? [
              'This retained group is outside the current data view; its saved aggregates may be old.',
            ]
          : [],
    };
  const offset = Number(query.get('offset') ?? 0);
  const disposition = query.get('disposition') ?? 'all';
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !['all', 'included', 'excluded'].includes(disposition)
  )
    throw new StorageError(
      422,
      'Evidence requires a non-negative offset and all, included or excluded disposition.',
    );
  if (!csv || csv.visible === false)
    throw new StorageError(422, 'Measure evidence requires a group in the current CSV view.');
  const dataset = graphDatasets(graph).find((source) => source.id === csv.datasetId);
  const analysis = dataset && analysisForDataset(graph, dataset.id);
  if (!dataset || !analysis)
    throw new StorageError(422, 'The shared CSV source or current analysis is missing.');
  const client = new QualityClient();
  try {
    const explanation = await client.request<MeasureExplanation>({
      operation: 'measure',
      dataset,
      model: graph,
      analysis,
      path: csv.path,
      metricId,
      offset,
      disposition: disposition as 'all' | 'included' | 'excluded',
    });
    return {
      diagramId: graph.diagram.id,
      graphVersion: graph.diagram.version,
      nodeId: node.id,
      datasetId: dataset.id,
      columns: dataset.columns,
      explanation,
      warnings: [
        'Evidence includes original source cells from this explicitly requested measure page.',
      ],
    };
  } finally {
    client.dispose();
  }
}
