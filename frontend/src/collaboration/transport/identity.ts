import {
  canonical,
  signingInput,
  type DeviceIdentity,
  type TransportPublicKey,
} from '../../../../collaboration-worker/src/protocol';

export interface TransportIdentity {
  readonly public: Omit<DeviceIdentity, 'mlsSignatureKey'>;
  sign(domain: 'policy' | 'authenticate' | 'command', value: unknown): Promise<string>;
  destroy(): void;
}

export function encodeBytes(bytes: Uint8Array): string {
  let text = '';
  for (let start = 0; start < bytes.length; start += 8192)
    text += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeBytes(value: string, limit = 256 * 1024): Uint8Array {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > Math.ceil((limit * 4) / 3) + 2 ||
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    value.length % 4 === 1
  )
    throw new Error('Invalid collaboration binary message.');
  const decoded = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  if (bytes.length > limit || encodeBytes(bytes) !== value)
    throw new Error('Invalid collaboration binary message.');
  return bytes;
}

export async function credentialId(key: TransportPublicKey): Promise<string> {
  const input = new TextEncoder().encode(canonical(key));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', input)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/** A fresh device for each live room. Private signing material is never exported. */
export async function createTransportIdentity(): Promise<TransportIdentity> {
  let pair: CryptoKeyPair | undefined = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const signingKey: TransportPublicKey = { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y! };
  const device = Object.freeze({
    deviceId: crypto.randomUUID(),
    signingKey: Object.freeze(signingKey),
    credentialId: await credentialId(signingKey),
  });
  return {
    public: device,
    async sign(domain, value) {
      const current = pair;
      if (!current) throw new Error('The collaboration identity has been closed.');
      const bytes = signingInput(domain, value);
      const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        current.privateKey,
        bytes as BufferSource,
      );
      if (pair !== current) throw new Error('The collaboration identity has been closed.');
      return encodeBytes(new Uint8Array(signature));
    },
    destroy() {
      pair = undefined;
    },
  };
}

export async function verifyTransportSignature(
  identity: Pick<DeviceIdentity, 'signingKey' | 'credentialId'>,
  domain: 'policy' | 'authenticate' | 'command',
  value: unknown,
  signature: string,
): Promise<boolean> {
  try {
    if (identity.credentialId !== (await credentialId(identity.signingKey))) return false;
    const raw = decodeBytes(signature, 64);
    if (raw.length !== 64) return false;
    const key = await crypto.subtle.importKey(
      'jwk',
      identity.signingKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      raw as BufferSource,
      signingInput(domain, value) as BufferSource,
    );
  } catch {
    return false;
  }
}
