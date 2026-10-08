import { Component, Suspense, type ReactNode } from 'react';
import { Modal } from './Modal';

type Props = {
  children: ReactNode;
  close(): void;
  beforeReload(): Promise<void>;
  reload?(): void;
};

/** A missing lazy tool must not blank the editor or discard unsaved work. */
export class LazyDialogBoundary extends Component<
  Props,
  { failed: boolean; saving: boolean; error: string }
> {
  state = { failed: false, saving: false, error: '' };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  private reload = async () => {
    if (this.state.saving) return;
    this.setState({ saving: true, error: '' });
    try {
      await this.props.beforeReload();
      (this.props.reload ?? (() => window.location.reload()))();
    } catch (error) {
      this.setState({
        saving: false,
        error: `Could not save before reloading. ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };
  render() {
    if (this.state.failed)
      return (
        <Modal title="Tool could not open" close={this.props.close}>
          <p>This tool could not load. Continue editing or reload after saving to try again.</p>
          <div className="dialog-actions">
            <button onClick={this.props.close}>Continue editing</button>
            <button disabled={this.state.saving} onClick={() => void this.reload()}>
              {this.state.saving ? 'Saving before reload…' : 'Save and reload'}
            </button>
          </div>
          {this.state.error && <p role="alert">{this.state.error}</p>}
        </Modal>
      );
    return (
      <Suspense
        fallback={
          <Modal title="Opening tools" close={this.props.close}>
            <p role="status">Opening tools…</p>
          </Modal>
        }
      >
        {this.props.children}
      </Suspense>
    );
  }
}
