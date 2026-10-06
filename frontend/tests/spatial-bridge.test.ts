import { describe, expect, it } from 'vitest';
import { bridgeResponseStatus } from '../src/integration/bridge';

describe('spatial creation bridge response', () => {
  it('acknowledges canonical graph creation as Created through either API path', () => {
    expect(bridgeResponseStatus('/spatial-diagrams', 'POST')).toBe(201);
    expect(bridgeResponseStatus('/api/v1/spatial-diagrams', 'POST')).toBe(201);
    expect(bridgeResponseStatus('/diagrams', 'POST')).toBe(201);
    expect(bridgeResponseStatus('/diagrams/id/bulk', 'POST')).toBe(200);
    expect(bridgeResponseStatus('/diagrams/id', 'PATCH')).toBe(200);
    expect(bridgeResponseStatus('/export', 'POST')).toBe(200);
    expect(bridgeResponseStatus('/diagrams/id', 'DELETE')).toBe(204);
  });
});
