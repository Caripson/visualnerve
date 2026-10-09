import { lazy, useRef, type ComponentType } from 'react';
import { useI18n } from '../i18n';
import { useEditor } from '../state/editor';
import { settleWorkspaceBeforeReload } from '../ui/settle-workspace-reload';
import { LazyDialogBoundary, type LazyRecoveryProps } from './LazyDialogBoundary';
import type { PropertiesProps } from './Properties';

/** A stable lazy component belongs to one inspector module, independent of UI language. */
export class PropertyInspectorModule {
  readonly Component;

  constructor(
    load: () => Promise<{ default: ComponentType<PropertiesProps> }> = () =>
      import('./Properties').then((module) => ({ default: module.Properties })),
  ) {
    this.Component = lazy(load);
  }
}

const inspector = new PropertyInspectorModule();
const noClose = () => {};

function InspectorPlaceholder({ loading = false }: { loading?: boolean }) {
  const { t } = useI18n();
  return (
    <aside className="properties">
      <div className="panel-heading">{t('editor.properties.title')}</div>
      <div className="property-empty" role={loading ? 'status' : undefined}>
        {t(loading ? 'shared.openingToolsProgress' : 'editor.properties.selectAnObjectToInspectIt')}
      </div>
    </aside>
  );
}

function InspectorFailure({ reload, saving, error }: LazyRecoveryProps) {
  const { t } = useI18n();
  return (
    <aside className="properties">
      <div className="panel-heading">{t('editor.properties.title')}</div>
      <div className="property-content">
        <p role="alert">{t('shared.toolLoadFailedHint')}</p>
        <button disabled={saving} onClick={reload}>
          {t(saving ? 'shared.savingBeforeReload' : 'shared.saveAndReload')}
        </button>
        {error && <p role="alert">{t('shared.saveBeforeReloadFailed', { error })}</p>}
      </div>
    </aside>
  );
}

/** Empty workspaces and unopened mobile panels do not initialize inspector tools. */
export function PropertiesFeature({
  active = true,
  module = inspector,
  beforeReload = settleWorkspaceBeforeReload,
  reload,
  ...props
}: PropertiesProps & {
  active?: boolean;
  module?: PropertyInspectorModule;
  beforeReload?: () => Promise<void>;
  reload?: () => void;
}) {
  const graph = useEditor((state) => state.graph);
  const requested = useRef(false);
  if (graph && active) requested.current = true;
  // Retain the mounted view after its first use, including while a mobile sheet
  // is closed or navigation temporarily clears the graph. Lock unmounts App.
  if (!requested.current) return <InspectorPlaceholder />;
  const Inspector = module.Component;
  return (
    <LazyDialogBoundary
      active={active}
      close={noClose}
      beforeReload={beforeReload}
      reload={reload}
      loading={<InspectorPlaceholder loading />}
      failure={(options) => <InspectorFailure {...options} />}
    >
      <Inspector {...props} />
    </LazyDialogBoundary>
  );
}
