import { lazy, useState, type ComponentType } from 'react';
import { useEditor } from '../state/editor';
import type { RobloxTab } from './ui/RobloxWorkbench';
import { LazyDialogBoundary } from '../components/LazyDialogBoundary';
import { settleWorkspaceBeforeReload } from '../ui/settle-workspace-reload';
type WorkbenchProps = { initialTab?: RobloxTab; close(): void };
export class RobloxWorkbenchModule {
  readonly Component;
  constructor(
    load: () => Promise<{ default: ComponentType<WorkbenchProps> }> = () =>
      import('./ui/RobloxWorkbench').then((module) => ({ default: module.RobloxWorkbench })),
  ) {
    this.Component = lazy(load);
  }
}
const workbench = new RobloxWorkbenchModule();
/** Cheap gate: Three, compiler, examples, and authoring controls load only for game documents. */
export function RobloxFeature({
  module = workbench,
  beforeReload = settleWorkspaceBeforeReload,
  reload,
}: {
  module?: RobloxWorkbenchModule;
  beforeReload?: () => Promise<void>;
  reload?: () => void;
} = {}) {
  const game = useEditor((state) => state.graph?.diagram.game);
  const diagramId = useEditor((state) => state.graph?.diagram.id);
  const [open, setOpen] = useState<{ id: string; tab: RobloxTab }>();
  if (!game || !diagramId) return null;
  const Workbench = module.Component;
  const show = (tab: RobloxTab) => setOpen({ id: diagramId, tab });
  return (
    <>
      <section
        className="roblox-feature-bar"
        aria-label="Roblox Game Builder"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          padding: '8px 14px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <strong>Roblox Game Builder</strong>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {game.entities.length} objects · {game.rules.length} rules
        </span>
        <button onClick={() => show('world')}>World & rules</button>
        <button onClick={() => show('build')}>Check & build</button>
        <button onClick={() => show('guide')}>Getting started</button>
        <a href="/help/roblox-game-builder/">Guide</a>
      </section>
      {open?.id === diagramId && (
        <LazyDialogBoundary
          close={() => setOpen(undefined)}
          beforeReload={beforeReload}
          reload={reload}
        >
          <Workbench
            key={`${diagramId}-${open.tab}`}
            initialTab={open.tab}
            close={() => setOpen(undefined)}
          />
        </LazyDialogBoundary>
      )}
    </>
  );
}
