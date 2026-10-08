import { webcrypto } from 'node:crypto';
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { VaultGate } from '../src/security/VaultGate';

// Exercise the production KDF. Its deliberately expensive derivation may share
// CPU with another real-crypto suite; UI waits must not assume sub-second setup.
configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let session: VaultSession, name: string;
beforeEach(() => {
  name = `vault-gate-${crypto.randomUUID()}`;
  session = new VaultSession(
    new VaultRecordStorage(name),
    new VaultCrypto(webcrypto as unknown as Crypto),
  );
});
afterEach(async () => {
  await act(async () => {
    await session.dispose();
  });
  await new Promise<void>((resolve, reject) => {
    const remove = indexedDB.deleteDatabase(name);
    remove.onsuccess = () => resolve();
    remove.onerror = () => reject(remove.error);
  });
});
function enterNewPassword() {
  fireEvent.change(screen.getByLabelText('New workspace password'), {
    target: { value: 'correct horse battery staple' },
  });
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: 'correct horse battery staple' },
  });
}

describe('encrypted workspace first-visit gate', () => {
  it('shows backup independence before setup and opens only after recovery acknowledgement', async () => {
    const open = vi.fn(async () => undefined);
    render(
      <VaultGate session={session} openWorkspace={open}>
        <p>Private workspace</p>
      </VaultGate>,
    );
    await screen.findByRole('button', { name: 'Create encrypted workspace' });
    expect(screen.getByLabelText('Security of downloaded copies')).toHaveTextContent(
      'Changing your workspace password or recovery key does not change backups you already downloaded',
    );
    expect(open).not.toHaveBeenCalled();
    enterNewPassword();
    fireEvent.click(screen.getByRole('button', { name: 'Create encrypted workspace' }));
    const key = await screen.findByLabelText('Recovery key — keep it private');
    expect((key as HTMLTextAreaElement).value.startsWith('VNREC1-')).toBe(true);
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'I have saved my recovery key in a protected location.',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Private workspace');
    expect(open).toHaveBeenCalledOnce();
  });

  it('does not let a rejected older opening lock a newly unlocked session', async () => {
    await session.initialize();
    await session.setup('correct horse battery staple');
    let rejectOld!: (reason: Error) => void;
    const old = new Promise<void>((_resolve, reject) => {
      rejectOld = reject;
    });
    const open = vi.fn().mockReturnValueOnce(old).mockResolvedValue(undefined);
    render(
      <VaultGate session={session} openWorkspace={open}>
        <p>Private workspace</p>
      </VaultGate>,
    );
    await waitFor(() => expect(open).toHaveBeenCalledOnce());
    const oldEpoch = session.getSnapshot().epoch;
    await act(async () => {
      await session.lock();
      await session.unlock('correct horse battery staple');
    });
    await screen.findByText('Private workspace');
    expect(session.getSnapshot().epoch).not.toBe(oldEpoch);
    await act(async () => {
      rejectOld(new Error('Old opening failed late'));
      await Promise.resolve();
    });
    expect(session.getSnapshot().status).toBe('unlocked');
    expect(screen.getByText('Private workspace')).toBeInTheDocument();
  });
});
