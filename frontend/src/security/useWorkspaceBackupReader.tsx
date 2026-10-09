import { localizedFeedback } from '../components/localized-feedback';
import { useI18n } from '../i18n';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal } from '../components/Modal';
import { assertImportBytes } from '../imports/limits';
import { currentImportLimitBytes } from '../imports/preference';
import type { WorkspaceBackup } from '../storage/database';
import type { WorkspaceOperation } from '../storage/contracts';
import { workspaceStorage } from '../storage/runtime';
import { BackupSecurityNotice } from './BackupSecurityNotice';
import { VaultCrypto, type VaultKeys } from './vault-crypto';
import { VaultCryptoError } from './vault-errors';
import { parseLogicalJson } from './vault-logical-json';
import { parseEncryptedVaultBackup, type EncryptedVaultBackup } from './vault-schema';
import { VaultStorageError } from './vault-storage';
import { StorageError } from '../model/errors';

type CredentialKind = 'password' | 'recovery';
interface PendingRead {
  id: number;
  operation?: WorkspaceOperation;
  container?: EncryptedVaultBackup;
  done: boolean;
  abort?: () => void;
  destroyKeys?: () => void;
  resolve: (backup: WorkspaceBackup) => void;
  reject: (error: unknown) => void;
}
const cancelled = () => new DOMException('Backup import cancelled.', 'AbortError');
const locked = () =>
  new VaultStorageError(
    423,
    'WORKSPACE_LOCKED',
    'Unlock the workspace in the browser to continue.',
  );
const invalid = () =>
  new VaultStorageError(
    422,
    'INVALID_WORKSPACE_BACKUP',
    'Choose a valid Visual Nerve workspace backup.',
  );

function workspaceBackup(value: unknown): WorkspaceBackup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const backup = value as WorkspaceBackup;
  if (
    backup.format !== 'visual-nerve-workspace' ||
    backup.formatVersion !== 1 ||
    !['diagrams', 'nodes', 'edges', 'owners', 'settings', 'templates'].every((field) =>
      Array.isArray(Reflect.get(backup, field)),
    )
  )
    throw invalid();
  // The existing restore preview/controller validates every entity before any write.
  return backup;
}
function safeReadError(error: unknown) {
  if (
    error instanceof StorageError ||
    error instanceof VaultCryptoError ||
    (error instanceof DOMException && error.name === 'AbortError')
  )
    return error;
  return invalid();
}

function BackupCredentials({
  request,
  decrypt,
  cancel,
}: {
  request: PendingRead;
  decrypt: (request: PendingRead, kind: CredentialKind, secret: string) => Promise<void>;
  cancel: (request: PendingRead) => void;
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState<CredentialKind>('password');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const close = () => {
    setSecret('');
    cancel(request);
  };
  return (
    <Modal title={t('security.backupReader.title')} close={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !secret) return;
          const credential = secret;
          setSecret('');
          setError('');
          setBusy(true);
          void decrypt(request, kind, credential)
            .catch((failure: unknown) => {
              if (mounted.current && !request.done) setError((failure as Error).message);
            })
            .finally(() => {
              if (mounted.current) {
                setBusy(false);
                setSecret('');
              }
            });
        }}
      >
        <p>{t('security.backupReader.originalCredentialNotice')}</p>
        <p className="muted">{t('security.backupReader.localCredentialNotice')}</p>
        <label className="field">
          <span>{t('security.backupReader.unlockWith')}</span>
          <select
            aria-label={t('security.backupReader.credentialType')}
            value={kind}
            disabled={busy}
            onChange={(event) => {
              setKind(event.target.value as CredentialKind);
              setSecret('');
              setError('');
            }}
          >
            <option value="password">{t('security.backupReader.originalPasswordOption')}</option>
            <option value="recovery">{t('security.backupReader.originalRecoveryOption')}</option>
          </select>
        </label>
        <label className="field">
          <span>
            {kind === 'password'
              ? t('security.backupReader.passwordLabel')
              : t('security.backupReader.recoveryLabel')}
          </span>
          <input
            type="password"
            autoComplete="off"
            autoFocus
            required
            disabled={busy}
            maxLength={1024}
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
          />
        </label>
        <BackupSecurityNotice encrypted />
        {error && (
          <p className="form-error" role="alert">
            {localizedFeedback(error, t)}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" onClick={close}>
            {t('security.backupReader.cancel')}
          </button>
          <button className="primary" type="submit" disabled={busy || !secret}>
            {busy ? t('security.backupReader.verifying') : t('security.backupReader.read')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Browser-only credentials; every result remains bound to the original workspace session. */
export function useWorkspaceBackupReader(): {
  readBackup: (file: File) => Promise<WorkspaceBackup>;
  backupDialog: ReactNode;
} {
  const [dialog, setDialog] = useState<PendingRead>();
  const current = useRef<PendingRead | undefined>(undefined);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const finish = useCallback((request: PendingRead, backup?: WorkspaceBackup, error?: unknown) => {
    if (request.done) return;
    request.done = true;
    if (request.abort) request.operation?.signal.removeEventListener('abort', request.abort);
    request.destroyKeys?.();
    request.destroyKeys = undefined;
    request.operation?.dispose();
    request.container = undefined;
    if (current.current === request) {
      current.current = undefined;
      if (mounted.current) setDialog(undefined);
    }
    if (backup) request.resolve(backup);
    else request.reject(error ?? cancelled());
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (current.current) finish(current.current, undefined, cancelled());
    };
  }, [finish]);
  const check = useCallback(async (request: PendingRead) => {
    if (request.done || !mounted.current || current.current !== request) throw cancelled();
    if (request.operation?.signal.aborted) throw locked();
    await request.operation!.check();
    if (request.done || !mounted.current || current.current !== request) throw cancelled();
  }, []);
  const readBackup = useCallback(
    (file: File): Promise<WorkspaceBackup> => {
      if (current.current) finish(current.current, undefined, cancelled());
      return new Promise<WorkspaceBackup>((resolve, reject) => {
        const request: PendingRead = { id: ++sequence.current, done: false, resolve, reject };
        current.current = request;
        void (async () => {
          if (!mounted.current) throw cancelled();
          assertImportBytes(file.size, currentImportLimitBytes(), 'Backup file');
          const operation = await workspaceStorage.captureOperation();
          if (request.done) {
            operation.dispose();
            return;
          }
          request.operation = operation;
          request.abort = () => finish(request, undefined, locked());
          operation.signal.addEventListener('abort', request.abort, { once: true });
          await check(request);
          const text = await file.text();
          await check(request);
          const data = parseLogicalJson(text, { bytes: 0, values: 0 });
          if (
            data &&
            typeof data === 'object' &&
            Reflect.get(data, 'format') === 'visual-nerve-workspace'
          ) {
            const backup = workspaceBackup(data);
            await check(request);
            finish(request, backup);
            return;
          }
          request.container = parseEncryptedVaultBackup(data);
          assertImportBytes(
            request.container.totalBytes,
            currentImportLimitBytes(),
            'Decrypted backup',
          );
          await check(request);
          setDialog(request);
        })().catch((error: unknown) => finish(request, undefined, safeReadError(error)));
      });
    },
    [check, finish],
  );
  const decrypt = useCallback(
    async (request: PendingRead, kind: CredentialKind, secret: string) => {
      const cipher = new VaultCrypto();
      let keys: VaultKeys | undefined;
      let bytes: Uint8Array<ArrayBuffer> | undefined;
      const destroy = () => {
        if (keys) cipher.destroyKeys(keys);
      };
      request.destroyKeys = destroy;
      try {
        await check(request);
        const container = request.container!;
        keys =
          kind === 'password'
            ? await cipher.unlockWithPassword(container.header, secret)
            : await cipher.unlockWithRecovery(container.header, secret);
        secret = '';
        await check(request);
        bytes = await cipher.decryptBackup(keys, container);
        await check(request);
        const backup = workspaceBackup(
          parseLogicalJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), {
            bytes: 0,
            values: 0,
          }),
        );
        await check(request);
        finish(request, backup);
      } catch (error) {
        if (request.done) return;
        if (request.operation?.signal.aborted) {
          finish(request, undefined, locked());
          return;
        }
        if (
          error instanceof VaultCryptoError &&
          ['LIMIT_EXCEEDED', 'UNSUPPORTED_CRYPTO'].includes(error.code)
        )
          throw error;
        throw new VaultCryptoError('AUTHENTICATION_FAILED');
      } finally {
        secret = '';
        bytes?.fill(0);
        destroy();
        if (request.destroyKeys === destroy) request.destroyKeys = undefined;
      }
    },
    [check, finish],
  );
  return {
    readBackup,
    backupDialog: dialog ? (
      <BackupCredentials
        key={dialog.id}
        request={dialog}
        decrypt={decrypt}
        cancel={(request) => finish(request, undefined, cancelled())}
      />
    ) : null,
  };
}
