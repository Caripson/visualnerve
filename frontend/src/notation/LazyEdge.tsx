import { lazy, Suspense } from 'react';
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
const Component = lazy(() => import('./Edge').then((module) => ({ default: module.NotationEdge })));
export function LazyNotationEdge(props: EdgeProps) {
  return (
    <Suspense fallback={<BaseEdge id={props.id} path={getSmoothStepPath(props)[0]} />}>
      <Component {...props} />
    </Suspense>
  );
}
