import { nodeTypes } from '../nodes/registry';
import { edgeTypes } from '../mindmap/Branch';
import { OverviewNode } from './OverviewNode';
import { OverviewEdge } from './OverviewEdge';
import { ProcessConnectionEdge } from '../simulation/ProcessConnectionEdge';
export const overviewNodeTypes = { ...nodeTypes, 'overview-group': OverviewNode };
export const overviewEdgeTypes = {
  ...edgeTypes,
  'overview-relation': OverviewEdge,
  'simulation-process-connection': ProcessConnectionEdge,
};
