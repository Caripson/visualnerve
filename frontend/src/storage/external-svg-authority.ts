import type { WorkspaceOperation, WorkspaceStorage } from './contracts';
import type { SvgJobAuthority } from '../export/svg-job-types';

/** A background export retains its original vault session and MCP grant, not the POST lease. */
export class ExternalSvgAuthority implements SvgJobAuthority {
  private readonly controller = new AbortController();
  private disposed = false;
  private readonly revoke = () => this.controller.abort();
  readonly guard;
  constructor(
    private readonly operation: WorkspaceOperation,
    fence: () => void,
    authorize: (storage: WorkspaceStorage) => Promise<void>,
    private readonly released: () => void,
  ) {
    const assertCurrent = () => {
      this.controller.signal.throwIfAborted();
      operation.signal.throwIfAborted();
      fence();
    };
    this.guard = {
      signal: this.controller.signal,
      assertCurrent,
      check: async () => {
        assertCurrent();
        await operation.check();
        assertCurrent();
        await authorize(operation.storage);
        assertCurrent();
        await operation.check();
        assertCurrent();
      },
    };
    operation.signal.addEventListener('abort', this.revoke, { once: true });
    if (operation.signal.aborted) this.revoke();
  }
  cancel() {
    this.revoke();
    this.dispose();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.revoke();
    this.operation.signal.removeEventListener('abort', this.revoke);
    this.operation.dispose();
    this.released();
  }
}
