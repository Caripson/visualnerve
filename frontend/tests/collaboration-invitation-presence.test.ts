import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  invitationUrl,
  readInvitation,
  type CollaborationInvitation,
} from '../src/collaboration/session/invitation';
import { displayName, presenceMessage } from '../src/collaboration/session/presence';
import { encodeBytes } from '../src/collaboration/transport/identity';

const origin = 'https://app.visualnerve.com';
const relay = 'https://relay.example.test';
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
function invitation(): CollaborationInvitation {
  return {
    version: 1,
    roomId: crypto.randomUUID(),
    diagramId: crypto.randomUUID(),
    relay,
    ownerDeviceId: crypto.randomUUID(),
    ownerCredential: 'a'.repeat(64),
    ticket: encodeBytes(crypto.getRandomValues(new Uint8Array(32))),
    expiresAt: Date.now() + 600_000,
    scope: { shareMetadata: false, shareOwners: false, shareDatasets: false },
  };
}
describe('local collaboration invitation parsing', () => {
  it('round-trips the one-use secret only in a fragment with explicit sharing scope and pinned owner', () => {
    const value = invitation();
    const url = invitationUrl(value, origin);
    expect(new URL(url).search).toBe('');
    expect(url.split('#')[0]).not.toContain(value.ticket);
    expect(readInvitation(url, origin, relay)).toEqual(value);
  });
  it('rejects another app/relay, query secrets, paths, malformed or oversized fragments', () => {
    const value = invitation();
    const valid = invitationUrl(value, origin);
    for (const input of [
      valid.replace(origin, 'https://attacker.test'),
      valid.replace('/#', '/other#'),
      valid.replace('/#', '/?ticket=secret#'),
      `${origin}/#collaboration=%%%`,
      `${origin}/#collaboration=${'a'.repeat(8200)}`,
    ])
      expect(() => readInvitation(input, origin, relay)).toThrow();
    expect(() => readInvitation(valid, origin, 'https://different.example.test')).toThrow(
      /configured relay/,
    );
  });
  it('rejects expired/far-future invitations, malformed identity/ticket and undeclared sharing fields', () => {
    const value = invitation();
    for (const patch of [
      { expiresAt: Date.now() - 1 },
      { expiresAt: Date.now() + 1_000_000 },
      { ownerCredential: 'not-a-thumbprint' },
      { ticket: 'abc=' },
      { diagramId: 'not-a-diagram' },
      { scope: { ...value.scope, shareDatasets: 'true' } },
      { scope: { ...value.scope, plaintext: true } },
      { privateKey: 'must-never-be-accepted' },
    ])
      expect(() =>
        readInvitation(
          invitationUrl({ ...value, ...patch } as CollaborationInvitation, origin),
          origin,
          relay,
        ),
      ).toThrow();
  });
});
describe('encrypted presence payload validation', () => {
  it('accepts bounded display names, explicit actor and finite canvas coordinates', () => {
    expect(displayName('  Reviewer  ')).toBe('Reviewer');
    const value = {
      name: 'Reviewer',
      selectedNodeIds: [crypto.randomUUID()],
      pointer: { x: -125.5, y: 9000 },
      actor: 'human',
    };
    expect(presenceMessage(bytes(value))).toEqual(value);
    expect(presenceMessage(bytes({ ...value, actor: 'mcp' })).actor).toBe('mcp');
  });
  it('rejects control characters, excessive names/selections, invalid coordinates and plaintext extensions', () => {
    const value = { name: 'Reviewer', selectedNodeIds: [], actor: 'human' };
    for (const patch of [
      { name: '\u0000Secret' },
      { name: 'a'.repeat(81) },
      { name: '' },
      { selectedNodeIds: new Array(101).fill('node') },
      { selectedNodeIds: ['a'.repeat(129)] },
      { actor: 'administrator' },
      { pointer: { x: 1e9, y: 0 } },
      { pointer: { x: null, y: 0 } },
      { pointer: { x: 0, y: 0, z: 0 } },
      { plaintextDiagram: { nodes: [] } },
    ])
      expect(() => presenceMessage(bytes({ ...value, ...patch }))).toThrow();
    expect(() => presenceMessage(new Uint8Array(8193))).toThrow(/limit/);
    expect(() => presenceMessage(Uint8Array.of(0xff))).toThrow();
  });
});
