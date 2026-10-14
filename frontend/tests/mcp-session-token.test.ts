import { afterEach, expect, it } from 'vitest';
import { BridgeSessionToken } from '../src/integration/session-token';

const tokens = new BridgeSessionToken(sessionStorage);
const legacy = 'ws://127.0.0.1:4317/bridge';
const current = 'ws://127.0.0.1:47417/bridge';
afterEach(() => sessionStorage.clear());

it('retains a saved credential across reload only for its exact approved endpoint', () => {
  tokens.save(legacy, 'test-secret');
  expect(new BridgeSessionToken(sessionStorage).read(legacy)).toBe('test-secret');
  expect(tokens.read(current)).toBe('');
  expect(sessionStorage.getItem('vn-token')).toBeNull();
  expect(tokens.read(legacy)).toBe('');
});

it.each([
  'ws://localhost:4317/bridge',
  'wss://127.0.0.1:4317/bridge',
  'ws://remote.example:4317/bridge',
])(
  'does not carry a credential to a different host, TLS scheme or invalid destination: %s',
  (address) => {
    tokens.save(legacy, 'test-secret');
    expect(tokens.read(address)).toBe('');
  },
);

it('never forwards an older unbound credential after an app upgrade', () => {
  sessionStorage.setItem('vn-token', 'old-unbound-secret');
  expect(tokens.read(current)).toBe('');
  expect(sessionStorage.getItem('vn-token')).toBeNull();
});

it('clears both credential and address on revocation or an empty explicit save', () => {
  tokens.save(current, 'test-secret');
  tokens.save(current, '');
  expect(sessionStorage.length).toBe(0);
  tokens.save(current, 'test-secret');
  tokens.clear();
  expect(sessionStorage.length).toBe(0);
});
