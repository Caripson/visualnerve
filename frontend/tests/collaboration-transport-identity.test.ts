import { describe, expect, it } from 'vitest';
import {
  createTransportIdentity,
  decodeBytes,
  encodeBytes,
  verifyTransportSignature,
} from '../src/collaboration/transport/identity';

describe('collaboration device proof of possession', () => {
  it('verifies bound signatures and rejects mutation, a different domain and another device', async () => {
    const first = await createTransportIdentity();
    const other = await createTransportIdentity();
    const payload = { roomId: crypto.randomUUID(), sequence: 1 };
    const signature = await first.sign('command', payload);
    expect(await verifyTransportSignature(first.public, 'command', payload, signature)).toBe(true);
    expect(
      await verifyTransportSignature(
        first.public,
        'command',
        { ...payload, sequence: 2 },
        signature,
      ),
    ).toBe(false);
    expect(await verifyTransportSignature(first.public, 'policy', payload, signature)).toBe(false);
    expect(await verifyTransportSignature(other.public, 'command', payload, signature)).toBe(false);
    first.destroy();
    other.destroy();
    await expect(first.sign('command', payload)).rejects.toThrow(/closed/);
  });

  it('rejects a public key whose fingerprint does not match the approved identity', async () => {
    const identity = await createTransportIdentity();
    const signature = await identity.sign('policy', { epoch: 0 });
    expect(
      await verifyTransportSignature(
        { ...identity.public, credentialId: 'untrusted' },
        'policy',
        { epoch: 0 },
        signature,
      ),
    ).toBe(false);
    identity.destroy();
  });

  it('round trips bytes while rejecting noncanonical or oversized encodings', () => {
    const bytes = Uint8Array.from([0, 255, 20, 3]);
    expect(decodeBytes(encodeBytes(bytes))).toEqual(bytes);
    for (const invalid of ['', 'A', 'AA=', 'AA+', 'AB'])
      expect(() => decodeBytes(invalid)).toThrow();
    expect(() => decodeBytes(encodeBytes(bytes), 2)).toThrow();
  });
});
