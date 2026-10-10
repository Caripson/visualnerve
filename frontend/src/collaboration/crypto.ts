import type {
  MlsCommit,
  MlsDeviceCredential,
  MlsGroupInfo,
  MlsProcessResult,
  MlsWireProcessResult,
} from './crypto-types';
import { decodeMlsResult } from './crypto-types';
import { decodeBytes } from './transport/identity';

export { assertMlsPolicy } from './crypto-types';
export type { MlsCommit, MlsGroupInfo, MlsMemberInfo, MlsProcessResult } from './crypto-types';
interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}
interface CryptoResponse {
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** A fresh live MLS client. Private state stays in one disposable WASM worker.
 * It deliberately offers no key export or ratchet restore: reloading needs a new
 * approved membership, so browser crashes cannot reuse a saved sender generation.
 */
export class MlsSession {
  private readonly pending = new Map<number, PendingCall>();
  private sequence = 0;
  private closed = false;
  private constructor(private readonly worker: Worker) {
    worker.onmessage = (event: MessageEvent<CryptoResponse>) => {
      const response = event.data;
      const call = this.pending.get(response?.id);
      if (!call) return;
      clearTimeout(call.timer);
      this.pending.delete(response.id);
      if (response.ok) call.resolve(response.value);
      else
        call.reject(
          new Error(response.error || 'The encrypted collaboration message was rejected.'),
        );
    };
    worker.onerror = () => this.dispose(new Error('The collaboration encryption worker failed.'));
    worker.onmessageerror = () =>
      this.dispose(new Error('The collaboration encryption response was invalid.'));
  }

  static async create(identity: MlsDeviceCredential): Promise<MlsSession> {
    const session = new MlsSession(
      new Worker(new URL('./crypto.worker.ts', import.meta.url), {
        type: 'module',
        name: 'visual-nerve-private-collaboration-crypto',
      }),
    );
    try {
      await session.call('init', identity);
      return session;
    } catch (error) {
      session.dispose();
      throw error;
    }
  }

  signaturePublicKey(): Promise<string> {
    return this.call('signature-public-key');
  }
  keyPackage(): Promise<string> {
    return this.call('key-package');
  }
  createGroup(roomId: string): Promise<void> {
    return this.call('create-group', { roomId });
  }
  join(input: {
    welcome: string;
    roomId: string;
    ownerDeviceId: string;
    ownerSignatureKey: string;
  }): Promise<void> {
    decodeBytes(input.welcome, 128 * 1024);
    if (decodeBytes(input.ownerSignatureKey, 32).length !== 32)
      return Promise.reject(new Error('Invalid pinned owner signing key.'));
    return this.call('join', input);
  }
  info(): Promise<MlsGroupInfo> {
    return this.call('info');
  }
  prepareAddMember(
    input: MlsDeviceCredential & { keyPackage: string; expectedSignatureKey: string },
  ): Promise<MlsCommit> {
    decodeBytes(input.keyPackage, 32 * 1024);
    if (decodeBytes(input.expectedSignatureKey, 32).length !== 32)
      return Promise.reject(new Error('Invalid admitted device signing key.'));
    return this.call('add-member', input);
  }
  prepareRemoveMember(deviceId: string): Promise<MlsCommit> {
    return this.call('remove-member', { deviceId });
  }
  prepareRotate(): Promise<MlsCommit> {
    return this.call('rotate');
  }
  confirmPendingCommit(): Promise<void> {
    return this.call('confirm-commit');
  }
  discardPendingCommit(): Promise<void> {
    return this.call('discard-commit');
  }
  encrypt(payload: Uint8Array): Promise<string> {
    if (!(payload instanceof Uint8Array) || payload.byteLength > 64 * 1024)
      return Promise.reject(new Error('Collaboration updates must be chunked below 64 KiB.'));
    return this.call('encrypt', { payload: payload.slice() });
  }
  async process(input: {
    ciphertext: string;
    expectedDeviceId: string;
  }): Promise<MlsProcessResult> {
    decodeBytes(input.ciphertext, 128 * 1024);
    return decodeMlsResult(await this.call<MlsWireProcessResult>('process', input));
  }

  dispose(reason = new Error('The collaboration encryption session was closed.')): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(reason);
    }
    this.pending.clear();
  }

  private call<T>(operation: string, input?: unknown): Promise<T> {
    if (this.closed)
      return Promise.reject(new Error('The collaboration encryption session was closed.'));
    if (this.pending.size >= 64)
      return Promise.reject(new Error('Collaboration encryption is busy.'));
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.dispose(
            new Error('Collaboration encryption timed out. Rejoin with a new invitation.'),
          ),
        30_000,
      );
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      try {
        this.worker.postMessage({ id, operation, input });
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('Could not send the collaboration encryption request.'));
      }
    });
  }
}
