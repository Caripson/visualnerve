import type { GraphEdge } from './types';
import { reconnectedSqlEdge } from '../sql/relationships';
import { reconnectedCodeEdge } from '../code/relationships';

export const reconnectedAnalysisEdge = (previous: GraphEdge, next: GraphEdge) =>
  reconnectedCodeEdge(previous, reconnectedSqlEdge(previous, next));
