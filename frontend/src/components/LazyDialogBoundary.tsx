import { Component, Suspense, type ReactNode } from 'react';
import { Modal } from './Modal';
import { useI18n } from '../i18n';

type Props = {
  children: ReactNode;
  close(): void;
  beforeReload(): Promise<void>;
  reload?(): void;
  /** Retained tools can close while their first chunk is still loading. */
  active?: boolean;
  /** Inline optional tools can reuse the same guarded recovery without a modal. */
  loading?: ReactNode;
  failure?: (options: LazyRecoveryProps) => ReactNode;
};

export interface LazyRecoveryProps {
  reload(): void;
  saving: boolean;
  error: string;
}

function ToolFailure({
  close,
  reload,
  saving,
  error,
}: {
  close(): void;
  reload(): void;
  saving: boolean;
  error: string;
}) {
  const { t } = useI18n();
  return (
    <Modal title={t('shared.toolCouldNotOpenTitle')} close={close}>
      <p>{t('shared.toolLoadFailedHint')}</p>
      <div className="dialog-actions">
        <button onClick={close}>{t('shared.continueEditing')}</button>
        <button disabled={saving} onClick={reload}>
          {saving ? t('shared.savingBeforeReload') : t('shared.saveAndReload')}
        </button>
      </div>
      {error && <p role="alert">{t('shared.saveBeforeReloadFailed', { error })}</p>}
    </Modal>
  );
}

function OpeningTools({ close }: { close(): void }) {
  const { t } = useI18n();
  return (
    <Modal title={t('shared.openingToolsTitle')} close={close}>
      <p role="status">{t('shared.openingToolsProgress')}</p>
    </Modal>
  );
}

/** A missing lazy tool must not blank the editor or discard unsaved work. */
export class LazyDialogBoundary extends Component<
  Props,
  { failed: boolean; saving: boolean; error: string }
> {
  state = { failed: false, saving: false, error: '' };
  private mounted = true;
  componentDidMount() {
    this.mounted = true;
  }
  componentWillUnmount() {
    this.mounted = false;
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  private reload = async () => {
    if (this.state.saving) return;
    this.setState({ saving: true, error: '' });
    try {
      await this.props.beforeReload();
      if (!this.mounted) return;
      (this.props.reload ?? (() => window.location.reload()))();
    } catch (error) {
      if (!this.mounted) return;
      this.setState({
        saving: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  render() {
    if (this.state.failed && this.props.active === false) return null;
    if (this.state.failed && this.props.failure)
      return this.props.failure({
        reload: () => void this.reload(),
        saving: this.state.saving,
        error: this.state.error,
      });
    if (this.state.failed)
      return (
        <ToolFailure
          close={this.props.close}
          reload={() => void this.reload()}
          saving={this.state.saving}
          error={this.state.error}
        />
      );
    return (
      <Suspense
        fallback={
          this.props.active === false
            ? null
            : (this.props.loading ?? <OpeningTools close={this.props.close} />)
        }
      >
        {this.props.children}
      </Suspense>
    );
  }
}
