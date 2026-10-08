import { StrictMode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceLoader } from '../src/security/WorkspaceLoader';
import type {
  VaultSession,
  VaultSessionOperation,
  VaultSessionSnapshot,
} from '../src/security/vault-session';

afterEach(cleanup);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function PrivateEditor() {
  return <div>Private editor mounted</div>;
}
const surface = { default: PrivateEditor };

function sessionFixture(status: VaultSessionSnapshot['status'] = 'unlocked') {
  let snapshot: VaultSessionSnapshot = { status, epoch: 1 };
  const listeners = new Set<() => void>();
  const operations: (VaultSessionOperation & { dispose: ReturnType<typeof vi.fn> })[] = [];
  let validation = async () => {};
  let valid = true;
  const events: string[] = [];
  const session = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    captureOperation: vi.fn(async (parent: AbortSignal) => {
      events.push('capture');
      const epoch = snapshot.epoch;
      const controller = new AbortController();
      const cancel = () => controller.abort();
      parent.addEventListener('abort', cancel, { once: true });
      if (parent.aborted) cancel();
      const assertActive = () => {
        if (controller.signal.aborted || snapshot.epoch !== epoch || !valid)
          throw new Error('Original session revoked');
      };
      const operation = {
        signal: controller.signal,
        check: async () => {
          events.push('check');
          assertActive();
          await validation();
          assertActive();
        },
        assertActive: () => {
          events.push('assert');
          assertActive();
        },
        dispose: vi.fn(() => {
          parent.removeEventListener('abort', cancel);
          cancel();
        }),
        run: vi.fn(),
      } as VaultSessionOperation & { dispose: ReturnType<typeof vi.fn> };
      operations.push(operation);
      return operation;
    }),
  } as unknown as VaultSession;
  return {
    session,
    events,
    operations,
    validate: (work: () => Promise<void>) => {
      validation = work;
    },
    invalidate: () => {
      valid = false;
    },
    publish: (status: VaultSessionSnapshot['status']) => {
      snapshot = { status, epoch: snapshot.epoch! + 1 };
      for (const listener of listeners) listener();
    },
  };
}

describe('private workspace dynamic entry', () => {
  it('does not import private editor modules while locked', async () => {
    const fixture = sessionFixture('locked');
    const load = vi.fn(async () => surface);
    render(<WorkspaceLoader session={fixture.session} load={load} />);
    expect(load).not.toHaveBeenCalled();
    expect(fixture.session.captureOperation).not.toHaveBeenCalled();
    await act(async () => fixture.publish('unlocked'));
    await screen.findByText('Private editor mounted');
    expect(load).toHaveBeenCalledOnce();
  });

  it('captures before module loading and waits for the original durable check before mounting', async () => {
    const fixture = sessionFixture();
    const checked = deferred<void>();
    fixture.validate(() => checked.promise);
    const load = vi.fn(async () => {
      fixture.events.push('load');
      return surface;
    });
    render(<WorkspaceLoader session={fixture.session} load={load} />);
    await waitFor(() => expect(fixture.events).toEqual(['capture', 'load', 'check']));
    expect(screen.queryByText('Private editor mounted')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Loading workspace');
    await act(async () => checked.resolve());
    await screen.findByText('Private editor mounted');
    expect(fixture.events).toEqual(['capture', 'load', 'check', 'assert']);
    expect(fixture.operations[0].dispose).toHaveBeenCalledOnce();
  });

  it('discards a late old import after lock and allows a fresh epoch to load', async () => {
    const fixture = sessionFixture();
    const old = deferred<typeof surface>();
    const load = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(surface);
    render(<WorkspaceLoader session={fixture.session} load={load} />);
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    await act(async () => fixture.publish('locked'));
    expect(fixture.operations[0].signal.aborted).toBe(true);
    expect(screen.queryByText('Private editor mounted')).toBeNull();
    await act(async () => fixture.publish('unlocked'));
    await screen.findByText('Private editor mounted');
    await act(async () => old.resolve({ default: () => <div>Stale private editor</div> }));
    expect(screen.queryByText('Stale private editor')).toBeNull();
    expect(screen.getByText('Private editor mounted')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('rejects a failed lease check and disposes without rendering any private content', async () => {
    const fixture = sessionFixture();
    fixture.validate(async () => {
      fixture.invalidate();
    });
    render(<WorkspaceLoader session={fixture.session} load={async () => surface} />);
    await screen.findByRole('alert');
    expect(screen.queryByText('Private editor mounted')).toBeNull();
    expect(fixture.operations[0].signal.aborted).toBe(true);
    expect(fixture.operations[0].dispose).toHaveBeenCalledOnce();
  });

  it('aborts and disposes a pending capability immediately when its loader unmounts', async () => {
    const fixture = sessionFixture();
    const pending = deferred<typeof surface>();
    const load = vi.fn(() => pending.promise);
    const view = render(<WorkspaceLoader session={fixture.session} load={load} />);
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    view.unmount();
    expect(fixture.operations[0].signal.aborted).toBe(true);
    expect(fixture.operations[0].dispose).toHaveBeenCalledOnce();
    await act(async () => pending.resolve(surface));
    expect(screen.queryByText('Private editor mounted')).toBeNull();
  });

  it('handles StrictMode cleanup with a fresh capability rather than reusing the aborted one', async () => {
    const fixture = sessionFixture();
    const load = vi.fn(async () => surface);
    render(
      <StrictMode>
        <WorkspaceLoader session={fixture.session} load={load} />
      </StrictMode>,
    );
    await screen.findByText('Private editor mounted');
    expect(fixture.operations).toHaveLength(2);
    expect(fixture.operations[0].signal.aborted).toBe(true);
    expect(fixture.operations[1].dispose).toHaveBeenCalledOnce();
  });

  it('keeps the legacy editor loadable and reports missing application chunks', async () => {
    const load = vi.fn(async () => surface);
    const view = render(<WorkspaceLoader load={load} />);
    await screen.findByText('Private editor mounted');
    expect(load).toHaveBeenCalledOnce();
    view.unmount();
    render(
      <WorkspaceLoader
        load={async () => {
          throw new TypeError('Network failure');
        }}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Reload to retry');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.queryByText('Private editor mounted')).toBeNull();
  });
});
