import { lazy, type ComponentProps, type ReactNode } from 'react';
import { LazyDialogBoundary } from '../components/LazyDialogBoundary';
import { settleWorkspaceBeforeReload } from '../ui/settle-workspace-reload';
import type { IbmSymbolPalette, IbmSymbolProperties } from './Controls';

const Properties = lazy(() =>
  import('./Controls').then((module) => ({ default: module.IbmSymbolProperties })),
);
const Palette = lazy(() =>
  import('./Controls').then((module) => ({ default: module.IbmSymbolPalette })),
);
function Boundary({ children }: { children: ReactNode }) {
  return (
    <LazyDialogBoundary
      close={() => {}}
      beforeReload={settleWorkspaceBeforeReload}
      loading={<span role="status">Loading symbols…</span>}
      failure={({ reload, saving, error }) => (
        <div role="status">
          <p>IBM symbol tools could not load. Your diagram remains editable.</p>
          <button disabled={saving} onClick={reload}>
            {saving ? 'Saving…' : 'Save and reload'}
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    >
      {children}
    </LazyDialogBoundary>
  );
}
export function LazyIbmSymbolProperties(props: ComponentProps<typeof IbmSymbolProperties>) {
  return (
    <Boundary>
      <Properties {...props} />
    </Boundary>
  );
}
export function LazyIbmSymbolPalette(props: ComponentProps<typeof IbmSymbolPalette>) {
  return (
    <Boundary>
      <Palette {...props} />
    </Boundary>
  );
}
