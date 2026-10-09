import { afterEach, expect, it, vi } from 'vitest';
import { BridgeDiagnostics } from '../src/integration/diagnostics';

afterEach(() => vi.useRealTimers());
it('warns when an older bridge never advertises tool capabilities, without blocking the workspace', () => {
  vi.useFakeTimers();
  const diagnostic = new BridgeDiagnostics();
  diagnostic.connect();
  expect(diagnostic.snapshot().state).toBe('checking');
  vi.advanceTimersByTime(5000);
  expect(diagnostic.snapshot().state).toBe('update-required');
  diagnostic.disconnect();
  expect(diagnostic.snapshot().state).toBe('disconnected');
});
it('checks actual advertised tools and capabilities rather than trusting a version label', () => {
  const diagnostic = new BridgeDiagnostics();
  diagnostic.connect();
  expect(
    diagnostic.receive({
      type: 'bridge-info',
      version: '99.0.0',
      tools: ['visual_nerve_request'],
      capabilities: ['operations-v1'],
    }),
  ).toBe(true);
  expect(diagnostic.snapshot()).toEqual({ state: 'update-required', version: '99.0.0' });
  diagnostic.receive({
    type: 'bridge-info',
    version: '0.5.0',
    tools: ['visual_nerve_request', 'visual_nerve_api_docs'],
    capabilities: ['operations-v1', 'endpoint-docs-v1', 'fork-join-v1', 'async-svg-export-v1'],
  });
  expect(diagnostic.snapshot()).toEqual({ state: 'current', version: '0.5.0' });
  expect(diagnostic.receive({ id: 'command', path: '/diagrams' })).toBe(false);
  diagnostic.disconnect();
});
it('cancels stale detection when the connection ends', () => {
  vi.useFakeTimers();
  const diagnostic = new BridgeDiagnostics();
  diagnostic.connect();
  diagnostic.disconnect();
  vi.advanceTimersByTime(5000);
  expect(diagnostic.snapshot().state).toBe('disconnected');
});
