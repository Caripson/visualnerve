import init, { MlsCryptoSession } from './generated/mls';
import { decodeBytes, encodeBytes } from './transport/identity';

let session: MlsCryptoSession | undefined;
let work = Promise.resolve();
self.onmessage = (event: MessageEvent<{ id: number; operation: string; input?: any }>) => {
  // MLS sender/receiver generations are mutable. Serialize all operations even
  // while the module is loading; concurrent mutation must never reuse a ratchet.
  work = work.then(async () => {
    const { id, operation, input } = event.data;
    try {
      let value: unknown;
      if (operation === 'init') {
        if (session) throw new Error('Encryption session already initialized.');
        await init({ module_or_path: new URL('./generated/mls_bg.wasm', import.meta.url) });
        session = new MlsCryptoSession(input.deviceId, input.credentialId);
      } else {
        if (!session) throw new Error('Encryption session is unavailable.');
        switch (operation) {
          case 'signature-public-key':
            value = encodeBytes(session.signature_public_key());
            break;
          case 'key-package':
            value = encodeBytes(session.key_package());
            break;
          case 'create-group':
            session.create_group(input.roomId);
            break;
          case 'join':
            session.join(
              decodeBytes(input.welcome, 128 * 1024),
              input.roomId,
              input.ownerDeviceId,
              decodeBytes(input.ownerSignatureKey, 32),
            );
            break;
          case 'info':
            value = JSON.parse(session.info());
            break;
          case 'add-member':
            value = JSON.parse(
              session.add_member(
                decodeBytes(input.keyPackage, 32 * 1024),
                input.deviceId,
                input.credentialId,
                decodeBytes(input.expectedSignatureKey, 32),
              ),
            );
            break;
          case 'remove-member':
            value = JSON.parse(session.remove_member(input.deviceId));
            break;
          case 'rotate':
            value = JSON.parse(session.rotate());
            break;
          case 'confirm-commit':
            session.merge_pending_commit();
            break;
          case 'discard-commit':
            session.discard_pending_commit();
            break;
          case 'encrypt':
            value = encodeBytes(session.encrypt(input.payload));
            break;
          case 'process':
            value = JSON.parse(
              session.process(decodeBytes(input.ciphertext, 128 * 1024), input.expectedDeviceId),
            );
            break;
          default:
            throw new Error('Unknown encryption operation.');
        }
      }
      self.postMessage({ id, ok: true, value });
    } catch (error) {
      // Errors contain fixed adapter messages, never plaintext or cryptographic state.
      self.postMessage({
        id,
        ok: false,
        error: error instanceof Error ? error.message : 'Encrypted message rejected.',
      });
    }
  });
};
