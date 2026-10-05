import { diagramTypes, nodeKinds, type Graph, type Owner } from './types';

export class StorageError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const requireValue = (condition: unknown, message: string) => {
  if (!condition) throw new StorageError(422, message);
};
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
export function validateGraph(graph: Graph) {
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
