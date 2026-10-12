import { lazy, type ComponentProps, type ReactNode } from 'react';
import { LazyDialogBoundary } from '../components/LazyDialogBoundary';
import { settleWorkspaceBeforeReload } from '../ui/settle-workspace-reload';
import type {
  NotationPalette,
  NotationNodeProperties,
  NotationEdgeProperties,
  NotationDiagramProperties,
} from './Controls';

const Palette = lazy(() => import('./Controls').then((m) => ({ default: m.NotationPalette })));
const NodeProperties = lazy(() =>
  import('./Controls').then((m) => ({ default: m.NotationNodeProperties })),
);
const EdgeProperties = lazy(() =>
  import('./Controls').then((m) => ({ default: m.NotationEdgeProperties })),
);
const DiagramProperties = lazy(() =>
  import('./Controls').then((m) => ({ default: m.NotationDiagramProperties })),
);
function Boundary({ children }: { children: ReactNode }) {
  return (
    <LazyDialogBoundary
      close={() => {}}
      beforeReload={settleWorkspaceBeforeReload}
      loading={<span role="status">Loading notation tools…</span>}
      failure={({ reload, saving, error }) => (
        <div role="status">
          <p>Notation tools could not load. Your saved document is preserved.</p>
          <button disabled={saving} onClick={reload}>
            Save and reload
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    >
      {children}
    </LazyDialogBoundary>
  );
}
export function LazyNotationPalette(props: ComponentProps<typeof NotationPalette>) {
  return (
    <Boundary>
      <Palette {...props} />
    </Boundary>
  );
}
export function LazyNotationNodeProperties(props: ComponentProps<typeof NotationNodeProperties>) {
  return (
    <Boundary>
      <NodeProperties {...props} />
    </Boundary>
  );
}
export function LazyNotationEdgeProperties(props: ComponentProps<typeof NotationEdgeProperties>) {
  return (
    <Boundary>
      <EdgeProperties {...props} />
    </Boundary>
  );
}
export function LazyNotationDiagramProperties(
  props: ComponentProps<typeof NotationDiagramProperties>,
) {
  return (
    <Boundary>
      <DiagramProperties {...props} />
    </Boundary>
  );
}
