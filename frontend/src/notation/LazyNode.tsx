import { lazy, Suspense } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { CanvasNode } from '../canvas/projection';
const Component = lazy(() => import('./Node').then((module) => ({ default: module.NotationNode })));
export function LazyNotationNode(props: NodeProps<CanvasNode>) {
  return (
    <Suspense
      fallback={
        <div className="vn-node" role="status">
          {props.data.node.title}
        </div>
      }
    >
      <Component {...props} />
    </Suspense>
  );
}
