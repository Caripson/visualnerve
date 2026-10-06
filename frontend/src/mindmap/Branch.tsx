import {
  BaseEdge,
  BezierEdge,
  SmoothStepEdge,
  getBezierPath,
  useInternalNode,
  type EdgeProps,
  type EdgeTypes,
} from '@xyflow/react';
import { selfLoopPath } from '../canvas/selfLoop';

function SelfLoop(props: EdgeProps) {
  const node = useInternalNode(props.source);
  const bounds = {
    x: node?.internals.positionAbsolute.x ?? Math.min(props.sourceX, props.targetX),
    y: node?.internals.positionAbsolute.y ?? Math.min(props.sourceY, props.targetY),
    width: node?.measured?.width ?? node?.width ?? Math.abs(props.sourceX - props.targetX),
    height: node?.measured?.height ?? node?.height ?? Math.abs(props.sourceY - props.targetY),
  };
  const geometry = selfLoopPath(
    { x: props.sourceX, y: props.sourceY, position: props.sourcePosition },
    { x: props.targetX, y: props.targetY, position: props.targetPosition },
    bounds,
  );
  return <BaseEdge {...props} {...geometry} />;
}

function RelationshipBezier(props: EdgeProps) {
  return props.source === props.target ? <SelfLoop {...props} /> : <BezierEdge {...props} />;
}

function RelationshipSmoothStep(props: EdgeProps) {
  return props.source === props.target ? <SelfLoop {...props} /> : <SmoothStepEdge {...props} />;
}

function Branch(props: EdgeProps) {
  if (props.source === props.target) return <SelfLoop {...props} />;
  const [path, labelX, labelY] = getBezierPath({ ...props, curvature: 0.45 });
  return <BaseEdge {...props} path={path} labelX={labelX} labelY={labelY} />;
}
export const edgeTypes: EdgeTypes = {
  'mindmap-branch': Branch,
  default: RelationshipBezier,
  smoothstep: RelationshipSmoothStep,
};
