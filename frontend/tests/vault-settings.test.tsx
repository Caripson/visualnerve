import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultSettings } from '../src/security/VaultSettings';
import { VaultCryptoError } from '../src/security/vault-errors';
import {
  defaultVaultSessionPolicy,
  validateVaultSessionPolicy,
  type VaultSessionPolicy,
} from '../src/security/vault-storage';
import type { VaultSession } from '../src/security/vault-session';

const workspace = vi.hoisted(() => ({ settled: vi.fn() }));
vi.mock('../src/storage/workspace', () => ({ workspace }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
function fixture(policy: VaultSessionPolicy = { ...defaultVaultSessionPolicy }) {
  const session = {
    getPolicy: vi.fn(async () => ({ ...policy })),
    setPolicy: vi.fn(async (next: VaultSessionPolicy) => {
      validateVaultSessionPolicy(next);
    }),
    lock: vi.fn(async () => undefined),
    changePassword: vi.fn<(_next: string, _current: string) => Promise<void>>(
      async () => undefined,
    ),
  };
  render(<VaultSettings session={session as unknown as VaultSession} />);
  return session;
}
function submitPolicy() {
  fireEvent.click(screen.getByRole('button', { name: 'Save session limits' }));
}

beforeEach(() => {
  workspace.settled.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('browser-only vault security settings', () => {
  it('labels session controls and explains defaults, agent inactivity and the encryption boundary', async () => {
    const session = fixture();
    const inactivity = screen.getByLabelText('Lock after inactivity (minutes)');
    const absolute = screen.getByLabelText('Maximum session (hours)');
    await waitFor(() => expect(session.getPolicy).toHaveBeenCalledOnce());
    expect(inactivity).toHaveValue(15);
    expect(inactivity).toHaveAttribute('min', '1');
    expect(inactivity).toHaveAttribute('max', '240');
    expect(inactivity).toHaveAttribute('step', '1');
    expect(absolute).toHaveValue(8);
    expect(absolute).toHaveAttribute('min', '0.25');
    expect(absolute).toHaveAttribute('max', '24');
    const section = screen.getByRole('region', { name: 'Workspace security' });
    expect(section).toHaveTextContent(
      'Only your interaction with the app keeps the inactivity session alive',
    );
    expect(section).toHaveTextContent('no server password reset');
    expect(section).toHaveTextContent('compromised device, browser extension or malicious code');
    expect(section).toHaveTextContent(
      'Diagram exports and information shared with an agent leave the vault as readable content',
    );
  });

  it('loads the stored policy and converts UI minutes/hours without restarting the session clocks', async () => {
    const session = fixture({ idleTimeoutMs: 120 * 60_000, absoluteTimeoutMs: 3 * 3_600_000 });
    await waitFor(() =>
      expect(screen.getByLabelText('Lock after inactivity (minutes)')).toHaveValue(120),
    );
    expect(screen.getByLabelText('Maximum session (hours)')).toHaveValue(3);
    expect(screen.getByLabelText('Maximum session (hours)')).toHaveAttribute('min', '2');
    fireEvent.change(screen.getByLabelText('Lock after inactivity (minutes)'), {
      target: { value: '30' },
    });
    fireEvent.change(screen.getByLabelText('Maximum session (hours)'), {
      target: { value: '0.75' },
    });
    submitPolicy();
    expect(session.setPolicy).toHaveBeenCalledWith({
      idleTimeoutMs: 30 * 60_000,
      absoluteTimeoutMs: 45 * 60_000,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Session limits saved. Existing session clocks were not restarted.',
    );
    expect(session.lock).not.toHaveBeenCalled();
  });

  it('reports a rejected policy without claiming success, then allows a corrected retry', async () => {
    const session = fixture();
    await waitFor(() => expect(session.getPolicy).toHaveBeenCalled());
    const idle = screen.getByLabelText('Lock after inactivity (minutes)');
    fireEvent.change(idle, { target: { value: '241' } });
    // A programmatic submit bypasses HTML validity; the session validator must still reject it.
    fireEvent.submit(idle.closest('form')!);
    expect(await screen.findByRole('status')).toHaveTextContent('Use 1–240 minutes of inactivity');
    expect(screen.getByRole('status')).not.toHaveTextContent('Session limits saved');
    expect(screen.getByRole('button', { name: 'Save session limits' })).toBeEnabled();
    fireEvent.change(idle, { target: { value: '60' } });
    submitPolicy();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Session limits saved'),
    );
    expect(session.setPolicy).toHaveBeenCalledTimes(2);
  });

  it('keeps save and lock controls disabled while a policy write is pending', async () => {
    const waiting = deferred<void>();
    const session = fixture();
    session.setPolicy.mockImplementation(() => waiting.promise);
    submitPolicy();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Lock now' })).toBeDisabled();
    expect(screen.getByLabelText('Lock after inactivity (minutes)')).toBeDisabled();
    fireEvent.submit(screen.getByLabelText('Maximum session (hours)').closest('form')!);
    expect(session.setPolicy).toHaveBeenCalledOnce();
    await act(async () => {
      waiting.resolve();
    });
    expect(screen.getByRole('button', { name: 'Save session limits' })).toBeEnabled();
  });

  it('waits for durable pending saves before manually locking', async () => {
    const waiting = deferred<void>();
    workspace.settled.mockReturnValue(waiting.promise);
    const session = fixture();
    fireEvent.click(screen.getByRole('button', { name: 'Lock now' }));
    expect(workspace.settled).toHaveBeenCalledOnce();
    expect(session.lock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Lock now' })).toBeDisabled();
    await act(async () => {
      waiting.resolve();
    });
    expect(session.lock).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('button', { name: 'Lock and discard unsaved changes' }),
    ).not.toBeInTheDocument();
  });

  it('offers an explicit discard only after saving failed and locks when the user selects it', async () => {
    workspace.settled.mockRejectedValue(new Error('Browser storage quota reached.'));
    const session = fixture();
    expect(
      screen.queryByRole('button', { name: 'Lock and discard unsaved changes' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Lock now' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Some edits could not be saved: Browser storage quota reached.',
    );
    expect(session.lock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Lock and discard unsaved changes' }));
    await waitFor(() => expect(session.lock).toHaveBeenCalledOnce());
    expect(workspace.settled).toHaveBeenCalledOnce();
  });

  it('reauthenticates the current password in the local session and shows old-copy warnings', async () => {
    const fetch = vi.fn();
    const websocket = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('WebSocket', websocket);
    const persist = vi.spyOn(Storage.prototype, 'setItem');
    const session = fixture();
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    const dialog = screen.getByRole('dialog', { name: 'Change workspace password' });
    expect(dialog).toHaveTextContent('same content key');
    expect(dialog).toHaveTextContent('All workspace tabs lock after this change');
    expect(dialog).toContainElement(screen.getByLabelText('Security of downloaded copies'));
    expect(dialog).toHaveTextContent('Older encrypted backups can still be opened');
    expect(screen.getByRole('link', { name: 'Learn how to protect old backups' })).toHaveAttribute(
      'href',
      '/help/settings/#downloaded-copies-and-password-changes',
    );
    const newPassword = 'A new browser-only workspace password';
    const oldPassword = 'The old browser-only workspace password';
    fireEvent.change(screen.getByLabelText('New workspace password'), {
      target: { value: newPassword },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: newPassword },
    });
    fireEvent.change(screen.getByLabelText('Current workspace password'), {
      target: { value: oldPassword },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password and lock' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(session.changePassword).toHaveBeenCalledWith(newPassword, oldPassword);
    expect(fetch).not.toHaveBeenCalled();
    expect(websocket).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it('clears all password inputs after failed reauthentication and allows a new attempt', async () => {
    const session = fixture();
    session.changePassword.mockRejectedValue(new VaultCryptoError('AUTHENTICATION_FAILED'));
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    const next = 'A long new workspace passphrase';
    fireEvent.change(screen.getByLabelText('New workspace password'), { target: { value: next } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: next } });
    fireEvent.change(screen.getByLabelText('Current workspace password'), {
      target: { value: 'Incorrect old workspace passphrase' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password and lock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not authenticate the encrypted workspace or its contents.',
    );
    expect(screen.getByLabelText('New workspace password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
    expect(screen.getByLabelText('Current workspace password')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Change password and lock' })).toBeEnabled();
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Incorrect old workspace passphrase');
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not submit mismatched new passwords', () => {
    const session = fixture();
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    fireEvent.change(screen.getByLabelText('New workspace password'), {
      target: { value: 'A long new workspace passphrase' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'A different new workspace passphrase' },
    });
    fireEvent.change(screen.getByLabelText('Current workspace password'), {
      target: { value: 'Current workspace passphrase' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password and lock' }));
    expect(screen.getByRole('alert')).toHaveTextContent('enter the same password twice');
    expect(session.changePassword).not.toHaveBeenCalled();
  });

  it('keeps an in-flight password change open so dismissal cannot pretend to cancel it', async () => {
    const waiting = deferred<void>();
    const session = fixture();
    session.changePassword.mockReturnValue(waiting.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    const next = 'A long new workspace passphrase';
    fireEvent.change(screen.getByLabelText('New workspace password'), { target: { value: next } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: next } });
    fireEvent.change(screen.getByLabelText('Current workspace password'), {
      target: { value: 'Current workspace passphrase' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password and lock' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Close dialog' })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Change workspace password' })).toBeInTheDocument();
    await act(async () => {
      waiting.resolve();
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
