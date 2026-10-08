import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VaultKeyRotation } from '../src/security/VaultKeyRotation';
import type {
  PreparedVaultKeyRotation,
  VaultKeyRotationOptions,
} from '../src/security/vault-key-rotation';
import type { VaultSession } from '../src/security/vault-session';

const fixture = vi.hoisted(() => ({
  prepare:
    vi.fn<
      (
        session: VaultSession,
        next: string,
        options: VaultKeyRotationOptions,
      ) => Promise<PreparedVaultKeyRotation>
    >(),
}));
vi.mock('../src/security/vault-key-rotation', () => ({ prepareVaultKeyRotation: fixture.prepare }));

const previousPassword = 'The old protected workspace password';
const nextPassword = 'An independent new incident passphrase';
const session = {} as VaultSession;
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function artifact(key = 'VNREC1-new-recovery-key') {
  let disposed = false;
  const reads = vi.fn(() => {
    if (disposed) throw new Error('Disposed rotation recovery key must never be read.');
    return key;
  });
  const dispose = vi.fn(() => {
    disposed = true;
  });
  const activate = vi.fn<() => Promise<void>>(async () => undefined);
  const value: PreparedVaultKeyRotation = {
    activate,
    dispose,
    get recoveryKey() {
      return reads();
    },
  };
  return { value, reads, dispose, activate };
}
function mount() {
  const close = vi.fn();
  const view = render(
    <VaultKeyRotation session={session} close={close} closing={false} closeError="" />,
  );
  return { ...view, close };
}
function fill({
  next = nextPassword,
  confirmation = next,
  current = previousPassword,
}: {
  next?: string;
  confirmation?: string;
  current?: string;
} = {}) {
  fireEvent.change(screen.getByLabelText('New workspace password'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: confirmation },
  });
  fireEvent.change(screen.getByLabelText('Current workspace password'), {
    target: { value: current },
  });
}
function submit() {
  fireEvent.submit(screen.getByLabelText('New workspace password').closest('form')!);
}
function acknowledge() {
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'I have saved my recovery key in a protected location.' }),
  );
}
async function prepare(candidate: ReturnType<typeof artifact>) {
  fixture.prepare.mockResolvedValueOnce(candidate.value);
  fill();
  submit();
  await screen.findByLabelText('Recovery key — keep it private');
}

beforeEach(() => {
  fixture.prepare.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('requires the current password in the human form before preparation', () => {
  mount();
  fill({ current: '' });
  const current = screen.getByLabelText('Current workspace password');
  expect(current).toBeRequired();
  expect(current.closest('form')!.checkValidity()).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare new content key' }));
  expect(fixture.prepare).not.toHaveBeenCalled();
});

it.each([
  { name: 'short passphrase', next: 'short', confirmation: 'short', current: previousPassword },
  {
    name: 'mismatched confirmation',
    next: nextPassword,
    confirmation: `${nextPassword}!`,
    current: previousPassword,
  },
  {
    name: 'reused password',
    next: previousPassword,
    confirmation: previousPassword,
    current: previousPassword,
  },
])(
  'rejects a $name without preparing or retaining an artifact',
  async ({ next, confirmation, current }) => {
    mount();
    fill({ next, confirmation, current });
    // Also exercise semantic validation independently of native HTML validity.
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('different, unique passphrase');
    expect(fixture.prepare).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Recovery key — keep it private')).not.toBeInTheDocument();
  },
);

it('starts preparation synchronously with its cancellation signal and clears all password fields on submit', async () => {
  mount();
  const waiting = deferred<PreparedVaultKeyRotation>();
  const candidate = artifact();
  fixture.prepare.mockReturnValueOnce(waiting.promise);
  fill();
  submit();
  expect(fixture.prepare).toHaveBeenCalledOnce();
  const [capturedSession, next, options] = fixture.prepare.mock.calls[0];
  expect(capturedSession).toBe(session);
  expect(next).toBe(nextPassword);
  expect(options.currentPassword).toBe(previousPassword);
  expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(options.signal!.aborted).toBe(false);
  for (const label of [
    'New workspace password',
    'Confirm new password',
    'Current workspace password',
  ]) {
    expect(screen.getByLabelText(label)).toHaveValue('');
    expect(screen.getByLabelText(label)).toBeDisabled();
  }
  expect(screen.getByRole('button', { name: 'Preparing new key…' })).toBeDisabled();
  submit();
  expect(fixture.prepare).toHaveBeenCalledOnce();
  await act(async () => {
    waiting.resolve(candidate.value);
    await waiting.promise;
  });
  expect(screen.getByLabelText('Recovery key — keep it private')).toHaveValue(
    'VNREC1-new-recovery-key',
  );
  expect(candidate.activate).not.toHaveBeenCalled();
});

it('requires saved-recovery acknowledgement before activating the prepared key', async () => {
  mount();
  const candidate = artifact();
  const activation = deferred<void>();
  candidate.activate.mockReturnValueOnce(activation.promise);
  await prepare(candidate);
  const button = screen.getByRole('button', { name: 'Rotate content key and lock' });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(candidate.activate).not.toHaveBeenCalled();
  acknowledge();
  expect(button).toBeEnabled();
  fireEvent.click(button);
  expect(candidate.activate).toHaveBeenCalledOnce();
  expect(screen.queryByLabelText('Recovery key — keep it private')).not.toBeInTheDocument();
  await act(async () => {
    activation.resolve();
    await activation.promise;
  });
  expect(candidate.dispose).toHaveBeenCalledOnce();
});

it.each(['Cancel', 'Close dialog', 'Escape', 'backdrop', 'unmount'] as const)(
  'aborts preparation through %s and disposes a late artifact without reading its key',
  async (action) => {
    const view = mount();
    const waiting = deferred<PreparedVaultKeyRotation>();
    const candidate = artifact();
    fixture.prepare.mockReturnValueOnce(waiting.promise);
    fill();
    submit();
    const signal = fixture.prepare.mock.calls[0][2].signal!;
    if (action === 'unmount') view.unmount();
    else if (action === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
    else if (action === 'backdrop') fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    else fireEvent.click(screen.getByRole('button', { name: action }));
    expect(signal.aborted).toBe(true);
    if (action !== 'unmount') expect(view.close).toHaveBeenCalledOnce();
    await act(async () => {
      waiting.resolve(candidate.value);
      await waiting.promise;
    });
    expect(candidate.dispose).toHaveBeenCalledOnce();
    expect(candidate.reads).not.toHaveBeenCalled();
    expect(candidate.activate).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Recovery key — keep it private')).not.toBeInTheDocument();
  },
);

it('disposes a displayed prepared artifact and clears its recovery material when cancelled', async () => {
  const view = mount();
  const candidate = artifact();
  await prepare(candidate);
  const signal = fixture.prepare.mock.calls[0][2].signal!;
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(signal.aborted).toBe(true);
  expect(candidate.dispose).toHaveBeenCalledOnce();
  expect(candidate.activate).not.toHaveBeenCalled();
  expect(candidate.reads).toHaveBeenCalledOnce();
  expect(screen.queryByLabelText('Recovery key — keep it private')).not.toBeInTheDocument();
  expect(view.close).toHaveBeenCalledOnce();
});

it('aborts and disposes a displayed recovery artifact when its owner unmounts', async () => {
  const view = mount();
  const candidate = artifact();
  await prepare(candidate);
  const signal = fixture.prepare.mock.calls[0][2].signal!;
  view.unmount();
  expect(signal.aborted).toBe(true);
  expect(candidate.dispose).toHaveBeenCalledOnce();
  expect(candidate.reads).toHaveBeenCalledOnce();
  expect(candidate.activate).not.toHaveBeenCalled();
  expect(view.close).not.toHaveBeenCalled();
});

it('cancels the originating job on owner unmount during activation without publishing a late error', async () => {
  const view = mount();
  const candidate = artifact();
  const activation = deferred<void>();
  candidate.activate.mockReturnValueOnce(activation.promise);
  await prepare(candidate);
  acknowledge();
  fireEvent.click(screen.getByRole('button', { name: 'Rotate content key and lock' }));
  const signal = fixture.prepare.mock.calls[0][2].signal!;
  view.unmount();
  expect(signal.aborted).toBe(true);
  expect(candidate.dispose).toHaveBeenCalledOnce();
  await act(async () => {
    activation.reject(new Error('Original session was revoked.'));
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(candidate.reads).toHaveBeenCalledOnce();
  expect(view.close).not.toHaveBeenCalled();
});

it('prevents Escape, close button, backdrop and Cancel during activation, then recovers from failure without reading disposed material', async () => {
  const view = mount();
  const candidate = artifact();
  const activation = deferred<void>();
  candidate.activate.mockImplementationOnce(async () => {
    try {
      await activation.promise;
    } finally {
      candidate.dispose();
    }
  });
  await prepare(candidate);
  acknowledge();
  fireEvent.click(screen.getByRole('button', { name: 'Rotate content key and lock' }));
  expect(screen.queryByRole('button', { name: 'Close dialog' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
  submit();
  expect(view.close).not.toHaveBeenCalled();
  expect(fixture.prepare).toHaveBeenCalledOnce();
  expect(screen.getByRole('status')).toHaveTextContent(
    'new key becomes active only after every record has been verified',
  );
  await act(async () => {
    activation.reject(new Error('Storage is full; original vault retained.'));
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Storage is full; original vault retained.',
  );
  expect(candidate.reads).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Prepare new content key' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  for (const label of [
    'New workspace password',
    'Confirm new password',
    'Current workspace password',
  ])
    expect(screen.getByLabelText(label)).toHaveValue('');
  const retry = artifact('VNREC1-retried-recovery-key');
  await prepare(retry);
  expect(screen.getByLabelText('Recovery key — keep it private')).toHaveValue(
    'VNREC1-retried-recovery-key',
  );
  expect(screen.getByRole('button', { name: 'Rotate content key and lock' })).toBeDisabled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('allows a fresh preparation after authentication failure with a new original signal', async () => {
  mount();
  fixture.prepare.mockRejectedValueOnce(new Error('Current password is incorrect.'));
  fill();
  submit();
  const firstSignal = fixture.prepare.mock.calls[0][2].signal!;
  expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect.');
  expect(screen.getByRole('button', { name: 'Prepare new content key' })).toBeEnabled();
  const candidate = artifact();
  await prepare(candidate);
  expect(fixture.prepare).toHaveBeenCalledTimes(2);
  expect(firstSignal.aborted).toBe(true);
  expect(fixture.prepare.mock.calls[1][2].signal!.aborted).toBe(false);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(candidate.reads).toHaveBeenCalledOnce();
});
