import { BaseEdge, getBezierPath, type EdgeProps, type EdgeTypes } from '@xyflow/react';

function Branch(props: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({ ...props, curvature: 0.45 });
  return <BaseEdge {...props} path={path} labelX={labelX} labelY={labelY} />;
}
export const edgeTypes: EdgeTypes = { 'mindmap-branch': Branch };
