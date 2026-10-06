import { diagramTypes, nodeKinds, type Graph, type Owner } from './types';
import type { CsvDataset } from '../data/types';
import {
  analysisForDataset,
  graphDatasets,
  isGeneratedCsvNode,
  validateDataModel,
} from '../data/model';
import {
  validateExploration,
  validateNamedAnalysisViews,
  validateFilters,
} from '../analysis/types';
import { getCsvNode, validateAnalysis, validateCsvNode, validateDataset } from '../data/csv';
import { drawingLimits, type DrawingLayer } from '../drawing/types';
import { validateSpatialGraph } from '../spatial/types';
import { validateSqlQueryGraph } from '../sql/query-schema';
import { validateCodeGraph } from '../code/schema';
import { StorageError } from './errors';
import { validatePresentation } from '../presentation/types';
import { validateStoryboard } from '../presentation/storyboard';
import { validateOverviewConfig } from '../overview/types';
import { validateBuildSpecification } from '../export/build-specification';

export { StorageError } from './errors';
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const requireValue = (condition: unknown, message: string) => {
  if (!condition) throw new StorageError(422, message);
};
export function validateDrawingLayer(value: unknown): asserts value is DrawingLayer {
  requireValue(
    value && typeof value === 'object' && !Array.isArray(value),
    'Invalid drawing layer.',
  );
  const layer = value as DrawingLayer;
  requireValue(
    layer.version === 1 && typeof layer.visible === 'boolean' && Array.isArray(layer.strokes),
    'Unsupported or invalid drawing layer.',
  );
  requireValue(layer.strokes.length <= drawingLimits.strokes, 'Drawing has too many strokes.');
  const ids = new Set<string>();
  let points = 0;
  for (const stroke of layer.strokes) {
    requireValue(
      stroke && typeof stroke === 'object' && !Array.isArray(stroke),
      'Invalid drawing stroke.',
    );
    requireValue(
      typeof stroke.id === 'string' && uuid.test(stroke.id),
      'Drawing stroke id must be a UUID.',
    );
    requireValue(!ids.has(stroke.id), 'Duplicate drawing stroke id.');
    ids.add(stroke.id);
    requireValue(
      typeof stroke.color === 'string' &&
        /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(stroke.color),
      'Drawing color must use a hex color.',
    );
    requireValue(
      Number.isFinite(stroke.width) && stroke.width >= 1 && stroke.width <= 32,
      'Drawing width must be between 1 and 32.',
    );
    requireValue(
      Array.isArray(stroke.points) &&
        stroke.points.length > 0 &&
        stroke.points.length <= drawingLimits.pointsPerStroke,
      'Drawing stroke must contain between 1 and 20,000 points.',
    );
    points += stroke.points.length;
    requireValue(points <= drawingLimits.points, 'Drawing has too many points.');
    requireValue(
      stroke.points.every(
        (point) =>
          Array.isArray(point) &&
          point.length === 2 &&
          point.every((coordinate) => Number.isFinite(coordinate) && Math.abs(coordinate) <= 1e8),
      ),
      'Invalid drawing coordinates.',
    );
  }
}
function validateBase(entity: { version: number; createdAt: string; updatedAt: string }) {
  requireValue(
    Number.isSafeInteger(entity.version) &&
      entity.version > 0 &&
      Number.isFinite(Date.parse(entity.createdAt)) &&
      Number.isFinite(Date.parse(entity.updatedAt)),
    'Invalid entity version or timestamps.',
  );
}
export function validateOwner(owner: Owner) {
  requireValue(owner && typeof owner === 'object', 'Invalid owner.');
  validateBase(owner);
  requireValue(uuid.test(owner.id), 'Owner id must be a UUID.');
  requireValue(
    typeof owner.name === 'string' && owner.name.trim() && owner.name.length <= 300,
    'Owner name is required and limited to 300 characters.',
  );
  requireValue(
    ['person', 'team', 'department', 'system', 'organization', 'external'].includes(owner.kind),
    'Unsupported owner kind.',
  );
}
export function validateGraph(graph: Graph, trustedDataset?: CsvDataset | CsvDataset[]) {
  requireValue(
    graph && graph.diagram && [graph.nodes, graph.edges, graph.owners].every(Array.isArray),
    'Invalid graph structure.',
  );
  validateBase(graph.diagram);
  requireValue(
    graph.format === 'visual-nerve' && graph.formatVersion === 1,
    'Unsupported graph format.',
  );
  requireValue(uuid.test(graph.diagram.id), 'Diagram id must be a UUID.');
  requireValue(
    typeof graph.diagram.name === 'string' &&
      graph.diagram.name.trim() &&
      graph.diagram.name.length <= 500,
    'Diagram name is required and limited to 500 characters.',
  );
  requireValue(diagramTypes.includes(graph.diagram.type), 'Unsupported diagram mode.');
  requireValue(
    graph.diagram.settings &&
      typeof graph.diagram.settings === 'object' &&
      !Array.isArray(graph.diagram.settings),
    'Invalid diagram settings.',
  );
  const drawing = graph.diagram.settings.drawing;
  // Settings have always allowed custom keys. Only recognizable drawing-layer
  // contracts reserve this field; older freeform values remain intact.
  if (drawing && typeof drawing === 'object' && !Array.isArray(drawing)) {
    const candidate = drawing as unknown as Record<string, unknown>;
    if (
      (candidate.version === 1 && ('visible' in candidate || 'strokes' in candidate)) ||
      ('visible' in candidate && 'strokes' in candidate)
    )
      validateDrawingLayer(drawing);
  }
  const sources = graphDatasets(graph);
  if (graph.diagram.settings.presentation !== undefined)
    validatePresentation(graph.diagram.settings.presentation, graph);
  if (graph.diagram.settings.storyboard !== undefined)
    validateStoryboard(graph.diagram.settings.storyboard, graph);
  if (graph.diagram.settings.overview !== undefined)
    validateOverviewConfig(graph.diagram.settings.overview);
  if (graph.diagram.settings.buildSpecification !== undefined)
    validateBuildSpecification(graph.diagram.settings.buildSpecification);
  const trusted = new Set(
    Array.isArray(trustedDataset) ? trustedDataset : trustedDataset ? [trustedDataset] : [],
  );
  try {
    validateSpatialGraph(graph);
    validateSqlQueryGraph(graph);
    validateCodeGraph(graph);
    validateDataModel(graph);
    for (const dataset of sources) {
      if (!trusted.has(dataset)) validateDataset(dataset);
      requireValue(
        dataset.diagramId === graph.diagram.id,
        'CSV dataset belongs to another diagram.',
      );
    }
    if (graph.diagram.settings.csvAnalysis !== undefined) {
      requireValue(graph.dataset, 'CSV analysis requires its source dataset.');
      validateAnalysis(graph.dataset!, graph.diagram.settings.csvAnalysis);
    }
    if (graph.diagram.settings.analysisFilters !== undefined)
      validateFilters(graph.diagram.settings.analysisFilters);
    if (graph.diagram.settings.relationshipExploration !== undefined)
      validateExploration(graph.diagram.settings.relationshipExploration);
    if (graph.diagram.settings.namedAnalysisViews !== undefined)
      validateNamedAnalysisViews(
        graph,
        graph.diagram.settings.namedAnalysisViews,
        validateDataModel,
      );
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError(422, (error as Error).message);
  }
  const owners = new Set<string>();
  for (const owner of graph.owners) {
    validateOwner(owner);
    requireValue(!owners.has(owner.id), 'Duplicate owner id.');
    owners.add(owner.id);
  }
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  requireValue(nodes.size === graph.nodes.length, 'Duplicate node id.');
  const externalNodes = new Set<string>();
  for (const node of graph.nodes) {
    validateBase(node);
    requireValue(Array.isArray(node.ownerIds), 'Invalid owner references.');
    requireValue(
      uuid.test(node.id) && node.diagramId === graph.diagram.id,
      'Node must belong to its diagram and have a UUID.',
    );
    requireValue(
      typeof node.title === 'string' && node.title.trim() && node.title.length <= 1000,
      'Node title is required and limited to 1000 characters.',
    );
    requireValue(nodeKinds.includes(node.nodeType), 'Unsupported node type.');
    requireValue(
      [node.x, node.y, node.width, node.height].every(
        (value) => Number.isFinite(value) && Math.abs(value) <= 1e8,
      ) &&
        node.width >= 40 &&
        node.height >= 30,
      'Invalid node coordinates or dimensions.',
    );
    requireValue(
      node.ownerIds.every((id) => owners.has(id)),
      'Unknown owner.',
    );
    for (const date of [node.startDate, node.endDate, node.dueDate]) {
      if (!date) continue;
      requireValue(
        /^\d{4}-\d{2}-\d{2}$/.test(date) &&
          Number.isFinite(Date.parse(date)) &&
          new Date(date).toISOString().slice(0, 10) === date,
        'Dates must use valid YYYY-MM-DD values.',
      );
    }
    requireValue(
      !node.startDate || !node.endDate || node.startDate <= node.endDate,
      'End date cannot precede start date.',
    );
    if (node.url) {
      let valid = false;
      try {
        const url = new URL(node.url);
        valid = ['http:', 'https:'].includes(url.protocol) && !!url.host;
      } catch {
        /* Invalid URL. */
      }
      requireValue(valid, 'URL must be an absolute http or https URL.');
    }
    if (node.externalId) {
      requireValue(!externalNodes.has(node.externalId), 'Duplicate external node id.');
      externalNodes.add(node.externalId);
    }
    const csv = node.metadata?.csv !== undefined ? getCsvNode(node) : undefined;
    if (
      node.metadata?.csv !== undefined &&
      (sources.length || graph.diagram.settings.csvAnalysis !== undefined || csv)
    ) {
      const dataset = sources.find((source) => source.id === csv?.datasetId);
      const analysis = dataset ? analysisForDataset(graph, dataset.id) : undefined;
      requireValue(csv && dataset && analysis, 'CSV node requires a valid source and analysis.');
      try {
        validateCsvNode(csv!);
      } catch (error) {
        throw new StorageError(422, (error as Error).message);
      }
      requireValue(csv!.datasetId === dataset!.id, 'CSV node refers to another dataset.');
      requireValue(csv!.groupKey === JSON.stringify(csv!.path), 'Invalid CSV group key.');
      requireValue(
        csv!.path.length <= 8 &&
          new Set(csv!.path.map((entry) => entry.columnId)).size === csv!.path.length &&
          csv!.path.every((entry) =>
            dataset!.columns.some((column) => column.id === entry.columnId),
          ) &&
          (!isGeneratedCsvNode(node) ||
            csv!.visible === false ||
            (csv!.path.length <= analysis!.levels.length &&
              csv!.path.every((entry, index) => entry.columnId === analysis!.levels[index]))) &&
          Number.isSafeInteger(csv!.rowCount) &&
          csv!.rowCount >= 0 &&
          csv!.rowCount <= dataset!.rows.length,
        'Invalid CSV group path or row count.',
      );
      requireValue(
        (!csv!.displayColumns ||
          csv!.displayColumns.every((id) => dataset!.columns.some((column) => column.id === id))) &&
          csv!.measures.every(
            (measure) =>
              (measure.columnId === undefined
                ? measure.operation === 'count'
                : dataset!.columns.some((column) => column.id === measure.columnId)) &&
              measure.numericCount + measure.missingCount + measure.invalidCount <= csv!.rowCount &&
              (measure.operation !== 'count' || measure.value === csv!.rowCount),
          ),
        'CSV measure counts do not match their group.',
      );
    }
  }
  const visited = new Set<string>();
  for (const node of graph.nodes) {
    const path = new Set<string>();
    let id: string | undefined = node.id;
    while (id && !visited.has(id)) {
      requireValue(!path.has(id), 'Parent cycle.');
      path.add(id);
      const parent = nodes.get(id);
      requireValue(parent, 'Unknown parent.');
      id = parent!.parentId;
    }
    path.forEach((id) => visited.add(id));
  }
  const edges = new Set<string>(),
    externalEdges = new Set<string>();
  for (const edge of graph.edges) {
    validateBase(edge);
    requireValue(
      uuid.test(edge.id) &&
        edge.diagramId === graph.diagram.id &&
        nodes.has(edge.sourceNodeId) &&
        nodes.has(edge.targetNodeId),
      'Connection must refer to nodes in the same diagram.',
    );
    requireValue(!edges.has(edge.id), 'Duplicate connection id.');
    requireValue(
      ['forward', 'backward', 'both', 'none'].includes(edge.direction) &&
        ['solid', 'dashed', 'dotted'].includes(edge.style),
      'Invalid connection direction or style.',
    );
    edges.add(edge.id);
    if (edge.externalId) {
      requireValue(!externalEdges.has(edge.externalId), 'Duplicate external connection id.');
      externalEdges.add(edge.externalId);
    }
  }
}
