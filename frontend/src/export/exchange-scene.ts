import { projectGraph } from '../canvas/projection';
import { blankGraph, emptyFilters, type Graph } from '../model/types';
import { importedConnectionStyle } from '../imports/diagram/presentation';
import { getCsvNode } from '../data/csv';
import type { SvgTheme } from './svg-job-types';
import {
  ExchangeExportError,
  exchangeLimits,
  type ExchangeOptions,
  type ExchangeScene,
  type ExchangeWarning,
} from './exchange-types';

/** Do not traverse datasets, arbitrary metadata, notes, email addresses or private source files. */
export function exchangeGraphSnapshot(graph: Graph): Graph {
  if (
    graph.nodes.length > exchangeLimits.sourceNodes ||
    graph.edges.length > exchangeLimits.sourceEdges
  )
    throw new ExchangeExportError(
      'EXCHANGE_SOURCE_LIMIT',
      'The source exceeds 100,000 nodes or 500,000 connections. Split the document before exporting.',
    );
  const snapshot = blankGraph(graph.diagram.name, graph.diagram.type);
  snapshot.diagram.id = graph.diagram.id;
  snapshot.diagram.settings = { timelineScale: graph.diagram.settings.timelineScale };
  const names = new Map(graph.owners.map((owner) => [owner.id, owner.name]));
  const semantics = new Map(graph.simulation?.nodes.map((node) => [node.id, node]));
  const resources = new Map(graph.simulation?.resources.map((resource) => [resource.id, resource]));
  const particles = new Map(
    graph.simulation?.particleTypes.map((particle) => [particle.id, particle]),
  );
  const currency = graph.simulation?.currency ?? '';
  snapshot.nodes = graph.nodes.map((node) => {
    const detailLines: string[] = [];
    if (node.status) detailLines.push(`Status: ${node.status}`);
    const owners = node.ownerIds.map((id) => names.get(id)).filter(Boolean);
    if (owners.length) detailLines.push(`Owners: ${owners.join(', ')}`);
    const semantic = semantics.get(node.id);
    if (semantic) {
      detailLines.push(`Process: ${semantic.type}`);
      if (semantic.type === 'work') {
        detailLines.push(
          `Capacity: ${semantic.work.capacity}`,
          `Processing: ${semantic.work.processingSeconds} seconds`,
        );
        if (semantic.work.costPerHour !== undefined)
          detailLines.push(`Cost: ${semantic.work.costPerHour} ${currency}/hour`);
        if (semantic.work.costPerParticle !== undefined)
          detailLines.push(`Cost per item: ${semantic.work.costPerParticle} ${currency}`);
        for (const requirement of semantic.work.resourceRequirements ?? [])
          detailLines.push(
            `Resource: ${resources.get(requirement.resourceId)?.name ?? requirement.resourceId} × ${requirement.units}`,
          );
        if (semantic.work.scaling)
          detailLines.push(`Maximum capacity: ${semantic.work.scaling.maxCapacity}`);
      } else if (semantic.type === 'source') {
        detailLines.push(
          `Work item: ${particles.get(semantic.source.particleTypeId)?.name ?? semantic.source.particleTypeId}`,
        );
        if (semantic.source.ratePerHour !== undefined)
          detailLines.push(`Arrivals: ${semantic.source.ratePerHour}/hour`);
        if (semantic.source.burst !== undefined)
          detailLines.push(`Burst: ${semantic.source.burst}`);
      } else if (semantic.type === 'resource') {
        const resource = resources.get(semantic.resourceId);
        if (resource) {
          detailLines.push(`Capacity: ${resource.capacity} ${resource.unit}`);
          if (resource.costPerHour !== undefined)
            detailLines.push(`Cost: ${resource.costPerHour} ${currency}/hour per unit`);
        }
      } else if (semantic.type === 'router') detailLines.push(`Routing: ${semantic.router.mode}`);
      else if (semantic.type === 'outcome') {
        detailLines.push(
          `Outcome: ${semantic.outcome.status}`,
          `Revenue: ${semantic.outcome.revenue ? 'realized' : 'none'}`,
        );
        if (semantic.outcome.revenueOverride !== undefined)
          detailLines.push(`Revenue per item: ${semantic.outcome.revenueOverride} ${currency}`);
      } else if (semantic.type === 'fork')
        detailLines.push(`Parallel branches: ${semantic.fork.branchEdgeIds.length}`);
      else if (semantic.type === 'join') detailLines.push('Wait for all parallel branches');
    }
    // Enumerate the intentionally exported fields. Spreading node or diagram would copy secrets.
    return {
      id: node.id,
      diagramId: node.diagramId,
      version: node.version,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      nodeType: node.nodeType,
      title: node.title,
      description: node.description,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      parentId: node.parentId,
      color: node.color,
      startDate: node.startDate,
      endDate: node.endDate,
      dueDate: node.dueDate,
      ownerIds: [],
      tags: [],
      collapsed: false,
      metadata: {
        exchangeDetailLines: detailLines,
        // CSV parentId is structural context, not permission to recreate a removed relationship.
        ...(getCsvNode(node) ? { exchangeNoDerivedHierarchy: true } : {}),
      },
    };
  });
  snapshot.edges = graph.edges.map((edge) => ({
    id: edge.id,
    diagramId: edge.diagramId,
    version: edge.version,
    createdAt: edge.createdAt,
    updatedAt: edge.updatedAt,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    label: edge.label,
    edgeType: edge.edgeType,
    direction: edge.direction,
    style: edge.style,
    metadata: { exchangeStroke: importedConnectionStyle(edge).color },
  }));
  snapshot.diagram.metadata = { exchangeSimulation: !!graph.simulation };
  return snapshot;
}

export function validateExchangeOptions(graph: Graph, options: ExchangeOptions) {
  if (options.scope !== undefined && options.scope !== 'complete' && options.scope !== 'selected')
    throw new ExchangeExportError(
      'EXCHANGE_SCOPE_INVALID',
      'Editable export scope must be complete or selected.',
    );
  if (options.scope === 'selected') {
    const ids = new Set(graph.nodes.map((node) => node.id));
    if (
      !Array.isArray(options.nodeIds) ||
      !options.nodeIds.length ||
      options.nodeIds.length > exchangeLimits.nodes ||
      options.nodeIds.some((id) => typeof id !== 'string' || !ids.has(id)) ||
      new Set(options.nodeIds).size !== options.nodeIds.length
    )
      throw new ExchangeExportError(
        'EXCHANGE_SELECTION_INVALID',
        'Choose at most 20,000 unique existing node IDs for selected export.',
      );
  } else if (options.nodeIds !== undefined)
    throw new ExchangeExportError(
      'EXCHANGE_SELECTION_INVALID',
      'Node IDs require selected export scope.',
    );
}

/** Convert browser theme paints to portable literal colors; no URL or CSS can enter a document. */
export function exchangeColor(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;
  const color = value.trim();
  if (/^#[a-f\d]{6}$/i.test(color)) return color.toUpperCase();
  if (/^#[a-f\d]{3}$/i.test(color))
    return `#${[...color.slice(1)].map((c) => c + c).join('')}`.toUpperCase();
  const rgb = color.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*1(?:\.0*)?)?\s*\)$/i,
  );
  if (rgb)
    return (
      '#' +
      rgb
        .slice(1, 4)
        .map((n) =>
          Math.max(0, Math.min(255, Math.round(Number(n))))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
        .toUpperCase()
    );
  return fallback;
}

/** Canonical saved 2D geometry and logical nodes. Live capacity cards never duplicate the model. */
export function exchangeScene(
  graph: Graph,
  options: ExchangeOptions,
  theme: SvgTheme,
): ExchangeScene {
  validateExchangeOptions(graph, options);
  const all = new Map(graph.nodes.map((node) => [node.id, node]));
  if (
    all.size !== graph.nodes.length ||
    new Set(graph.edges.map((edge) => edge.id)).size !== graph.edges.length
  )
    throw new ExchangeExportError(
      'EXCHANGE_TOPOLOGY_INVALID',
      'Duplicate node or connection identifiers cannot be exported.',
    );
  for (const edge of graph.edges)
    if (!all.has(edge.sourceNodeId) || !all.has(edge.targetNodeId))
      throw new ExchangeExportError(
        'EXCHANGE_TOPOLOGY_INVALID',
        'A connection references a missing node.',
      );
  const selected = options.scope === 'selected' ? new Set(options.nodeIds) : new Set(all.keys());
  const nodes = graph.nodes.filter((node) => selected.has(node.id));
  const edges = graph.edges.filter(
    (edge) => selected.has(edge.sourceNodeId) && selected.has(edge.targetNodeId),
  );
  if (!nodes.length)
    throw new ExchangeExportError('EXCHANGE_EMPTY', 'Add or select a node before exporting.');
  if (nodes.length > exchangeLimits.nodes || edges.length > exchangeLimits.edges)
    throw new ExchangeExportError(
      'EXCHANGE_OBJECT_LIMIT',
      'Editable export supports at most 20,000 nodes and 100,000 connections. Export a selection.',
    );
  // A parent only creates a geometric container when it is a real group, as on the canvas.
  const parents = new Map(
    nodes
      .filter(
        (node) =>
          node.parentId &&
          selected.has(node.parentId) &&
          all.get(node.parentId)?.nodeType === 'group',
      )
      .map((node) => [node.id, node.parentId!]),
  );
  const done = new Set<string>();
  for (const node of nodes) {
    const seen = new Set<string>();
    let id: string | undefined = node.id;
    while (id && !done.has(id)) {
      if (seen.has(id))
        throw new ExchangeExportError(
          'EXCHANGE_TOPOLOGY_INVALID',
          'Cyclic groups cannot be exported.',
        );
      seen.add(id);
      id = parents.get(id);
    }
    for (const item of seen) done.add(item);
  }
  const projection = projectGraph({ ...graph, nodes, edges }, [], [], [], emptyFilters, true);
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const projectedEdges = projection.edges.filter(
    (edge) => edgeById.has(edge.id) || !all.get(edge.target)?.metadata.exchangeNoDerivedHierarchy,
  );
  let textCharacters = graph.diagram.name.length;
  const textColor = exchangeColor(theme.text, '#1F2D28');
  const fill = exchangeColor(theme.node, '#FFFFFF');
  const stroke = exchangeColor(theme.border, '#E2E5DF');
  const result = projection.nodes.map((view) => {
    const node = view.data.node;
    // Model positions are absolute, including grouped nodes; only timeline projects another x/width.
    const geometry = graph.diagram.type === 'timeline' ? view : undefined;
    const x = geometry?.position.x ?? node.x,
      y = geometry?.position.y ?? node.y;
    const width = Number(geometry?.width ?? node.width),
      height = Number(geometry?.height ?? node.height);
    if (
      ![x, y, width, height].every(
        (value) => Number.isFinite(value) && Math.abs(value) <= exchangeLimits.dimension,
      ) ||
      width <= 0 ||
      height <= 0
    )
      throw new ExchangeExportError(
        'EXCHANGE_GEOMETRY_INVALID',
        'Export requires finite coordinates and positive dimensions within the supported range.',
      );
    const detailLines = (node.metadata.exchangeDetailLines ?? []) as string[];
    textCharacters +=
      node.title.length +
      (node.description?.length ?? 0) +
      detailLines.reduce((sum, line) => sum + line.length, 0);
    return {
      id: node.id,
      kind: node.nodeType,
      title: node.title,
      description: node.description,
      detailLines,
      x,
      y,
      width,
      height,
      parentId: graph.diagram.type === 'timeline' ? undefined : parents.get(node.id),
      fill,
      stroke: exchangeColor(node.color ?? view.data.mindmap?.color, stroke),
      textColor,
    };
  });
  const bounds = result.reduce(
    (box, node) => ({
      left: Math.min(box.left, node.x),
      top: Math.min(box.top, node.y),
      right: Math.max(box.right, node.x + node.width),
      bottom: Math.max(box.bottom, node.y + node.height),
    }),
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
  );
  if (
    bounds.right - bounds.left > exchangeLimits.dimension ||
    bounds.bottom - bounds.top > exchangeLimits.dimension
  )
    throw new ExchangeExportError(
      'EXCHANGE_GEOMETRY_INVALID',
      'The exported diagram spans more than the supported document dimensions. Export a selection.',
    );
  if (projectedEdges.length > exchangeLimits.edges)
    throw new ExchangeExportError(
      'EXCHANGE_OBJECT_LIMIT',
      'Editable export supports at most 100,000 connections, including mind map branches. Export a selection.',
    );
  for (const edge of projectedEdges) textCharacters += String(edge.label ?? '').length;
  if (textCharacters > exchangeLimits.textCharacters)
    throw new ExchangeExportError(
      'EXCHANGE_TEXT_LIMIT',
      'Editable export exceeds five million text characters. Export a selection.',
    );
  const warnings: ExchangeWarning[] = [
    {
      code: 'EDITABLE_FORMAT_FIDELITY',
      message:
        'Native editable shapes preserve text, basic colors, groups and connections. Icons, custom stencils, pen strokes, rich formatting and 3D relief are simplified or omitted. Long labels may need resizing in the destination editor. Use Visual Nerve JSON for a complete model backup.',
    },
  ];
  if (graph.diagram.metadata.exchangeSimulation)
    warnings.push({
      code: 'SIMULATION_STRUCTURE_ONLY',
      message:
        'Process Simulator exports logical structure and selected assumptions as labels. Execution, live state, scenarios, scaling rules and investment calculations remain in Visual Nerve.',
    });
  if (options.scope !== 'selected')
    warnings.push({
      code: 'ALL_LOGICAL_NODES',
      message:
        'Complete exports include every stored logical node, including nodes hidden by filters, collapsed groups, data views or the overview. Select specific nodes to restrict shared content.',
    });
  if (
    (options.scope === 'selected' &&
      edges.length <
        graph.edges.filter(
          (edge) => selected.has(edge.sourceNodeId) || selected.has(edge.targetNodeId),
        ).length) ||
    (options.scope === 'selected' &&
      graph.diagram.type === 'mindmap' &&
      nodes.some(
        (node) =>
          node.parentId &&
          !selected.has(node.parentId) &&
          all.get(node.parentId)?.nodeType !== 'group',
      ))
  )
    warnings.push({
      code: 'SELECTION_BOUNDARY_CONNECTIONS',
      message:
        'Connections to nodes outside the selection are omitted. Select both endpoints to retain a connection.',
    });
  return {
    name: graph.diagram.name,
    nodes: result,
    edges: projectedEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: String(edge.label ?? ''),
      direction: edgeById.get(edge.id)?.direction ?? 'none',
      style: edgeById.get(edge.id)?.style ?? 'solid',
      stroke: exchangeColor(
        edgeById.get(edge.id)?.metadata.exchangeStroke ?? edge.style?.stroke,
        exchangeColor(theme.muted, '#56675D'),
      ),
    })),
    warnings,
  };
}
