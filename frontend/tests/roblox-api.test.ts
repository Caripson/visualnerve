import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGameGraph, reconcileGameGraph } from '../src/roblox/document';
import { createRobloxStarterGame } from '../src/roblox/starter';
import { compileRobloxGame } from '../src/roblox/compiler';
import { robloxCommand } from '../src/storage/roblox-commands';
import { RobloxApiJobs } from '../src/storage/roblox-api-jobs';
import type { Graph } from '../src/model/types';
import { assertMcpAccess } from '../src/integration/access';
import { bridgeResponseStatus } from '../src/integration/bridge';
import { runRobloxPreview } from '../src/roblox/preview';
import { validateGameDefinition } from '../src/roblox/validate';
import { gameCollections } from '../src/roblox/references';
import type { GameDefinition } from '../src/roblox/types';

const registries: RobloxApiJobs[] = [];
afterEach(() => {
  for (const jobs of registries.splice(0)) jobs.clear();
  vi.restoreAllMocks();
});
function authority() {
  const controller = new AbortController();
  return {
    controller,
    guard: {
      signal: controller.signal,
      assertCurrent: () => controller.signal.throwIfAborted(),
      check: async () => controller.signal.throwIfAborted(),
    },
    dispose: vi.fn(),
  };
}
function fixture() {
  let graph = createGameGraph('Private game', createRobloxStarterGame());
  graph.diagram.version = 1;
  const repo = {
    getGraph: async () => structuredClone(graph),
    saveGraph: vi.fn(
      async (next: Graph, version: number, beforeWrite?: (...args: never[]) => Promise<void>) => {
        if (version !== graph.diagram.version)
          throw Object.assign(new Error('Conflict'), { status: 409 });
        await beforeWrite?.();
        graph = { ...next, diagram: { ...next.diagram, version: version + 1 } };
        return structuredClone(graph);
      },
    ),
  };
  const a = authority();
  const authorize = vi.fn(async () => a.guard.check());
  const jobs = new RobloxApiJobs(async (game) => compileRobloxGame(game));
  registries.push(jobs);
  const request = (path = '', method = 'GET', data?: unknown) => {
    const url = new URL(`/diagrams/${graph.diagram.id}/roblox${path}`, 'http://local');
    return robloxCommand(
      repo,
      graph.diagram.id,
      url.pathname.split('/').filter(Boolean),
      url,
      method,
      data,
      { authorize, createAuthority: async () => a },
      jobs,
    );
  };
  return { request, graph: () => graph, repo, a, authorize, jobs };
}
describe('authoritative Roblox UI/API commands', () => {
  it('reconstructs a large unfinished game through bounded configuration and collection reads', async () => {
    const f = fixture();
    const game = f.graph().diagram.game!;
    game.entities = [];
    game.rules = Array.from({ length: 1000 }, (_, index) => ({
      id: `message-${index}`,
      name: `Message ${index}`,
      enabled: true,
      event: { kind: 'playerJoin' },
      actions: [{ kind: 'message', text: 'x'.repeat(1000) }],
      cooldown: 0,
      oncePerPlayer: true,
    }));
    expect(validateGameDefinition(game).valid).toBe(true);
    expect(validateGameDefinition(game, { playable: true }).diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'spawn-required' })]),
    );
    expect(() => compileRobloxGame(game)).toThrow();
    await expect(f.request()).rejects.toMatchObject({ status: 413 });
    const snapshot = (await f.request('/configuration')) as {
      baseVersion: number;
      configuration: Omit<GameDefinition, (typeof gameCollections)[number]>;
    };
    expect(JSON.stringify(snapshot).length).toBeLessThan(8192);
    const reconstructed = { ...snapshot.configuration } as GameDefinition;
    for (const collection of gameCollections) {
      const items: unknown[] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const page = (await f.request(`/${collection}?offset=${offset}&limit=100`)) as {
          baseVersion: number;
          nextOffset: number | null;
          items: unknown[];
        };
        expect(page.baseVersion).toBe(snapshot.baseVersion);
        items.push(...page.items);
        offset = page.nextOffset;
      }
      Object.assign(reconstructed, { [collection]: items });
    }
    expect(reconstructed).toEqual(game);
    const before = structuredClone(game);
    const mutation = await f.request('/configuration', 'PATCH', {
      baseVersion: snapshot.baseVersion,
      value: { description: 'Updated configuration', settings: { maxPlayers: 6 } },
    });
    expect(mutation).toMatchObject({ baseVersion: 2, summary: { rules: 1000 } });
    expect(f.graph().diagram.game).toEqual({
      ...before,
      description: 'Updated configuration',
      settings: { ...before.settings, maxPlayers: 6 },
    });
    expect(await f.request('/configuration')).toMatchObject({
      baseVersion: 2,
      configuration: { id: before.id, settings: { maxPlayers: 6 } },
    });
    expect(f.repo.saveGraph).toHaveBeenCalledOnce();
  });
  it('validates bounded configuration atomically and retains version and access boundaries', async () => {
    const f = fixture();
    const before = structuredClone(f.graph());
    for (const value of [
      { id: 'another-game' },
      { schemaVersion: 2 },
      { name: null },
      { settings: null },
      { settings: { gravity: -1 } },
      { settings: { unexpected: null } },
      { settings: { maxPlayers: null } },
    ])
      await expect(
        f.request('/configuration', 'PATCH', { baseVersion: 1, value }),
      ).rejects.toMatchObject({ status: 422 });
    await expect(
      f.request('/configuration', 'PATCH', { value: { name: 'Missing version' } }),
    ).rejects.toMatchObject({ status: 428 });
    await expect(
      f.request('/configuration', 'PATCH', { baseVersion: 2, value: { name: 'Stale' } }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(f.request('/configuration?unknown=1')).rejects.toMatchObject({ status: 422 });
    const path = `/diagrams/${before.diagram.id}/roblox/configuration`;
    expect(() => assertMcpAccess('read', path, 'GET')).not.toThrow();
    expect(() => assertMcpAccess('read', path, 'PATCH')).toThrow(/read-only/i);
    expect(() => assertMcpAccess('off', path, 'GET')).toThrow(/off/i);
    expect(f.repo.saveGraph).not.toHaveBeenCalled();
    expect(f.graph()).toEqual(before);
  });
  it('preserves omitted object fields, rejects stale writes and checks references before commit', async () => {
    const f = fixture();
    const before = f.graph().diagram.game!.entities[0];
    const ack = await f.request(`/entities/${before.id}`, 'PATCH', {
      baseVersion: 1,
      value: { name: 'Arrival', transform: { position: { x: 12 } } },
    });
    expect(ack).toMatchObject({
      baseVersion: 2,
      summary: { entities: f.graph().diagram.game!.entities.length },
    });
    expect(f.graph().diagram.game!.entities[0]).toEqual({
      ...before,
      name: 'Arrival',
      transform: { ...before.transform, position: { ...before.transform.position, x: 12 } },
    });
    const card = f
      .graph()
      .nodes.find((node) => (node.metadata.roblox as { id?: string })?.id === before.id)!;
    expect(card.title).toBe('Arrival');
    await expect(
      f.request(`/entities/${before.id}`, 'PATCH', { baseVersion: 1, value: { name: 'Stale' } }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.request('/rules', 'POST', {
        baseVersion: 2,
        value: {
          id: 'missing',
          name: 'Broken',
          enabled: true,
          event: { kind: 'touch', entityId: 'nonexistent' },
          actions: [{ kind: 'win', message: 'Win' }],
          cooldown: 1,
          oncePerPlayer: true,
        },
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(f.repo.saveGraph).toHaveBeenCalledOnce();
  });
  it.each([
    { field: 'min', code: 'number' },
    { field: 'unexpected', code: 'unsupported-field' },
  ])(
    'rejects complete collection POST values with $field:null before saving',
    async ({ field, code }) => {
      const f = fixture();
      const before = structuredClone(f.graph());
      await expect(
        f.request('/variables', 'POST', {
          baseVersion: 1,
          value: {
            id: 'new-score',
            name: 'New score',
            scope: 'player',
            initial: 0,
            [field]: null,
          },
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: 'ROBLOX_GAME_INVALID',
        issues: expect.arrayContaining([
          expect.objectContaining({ code, path: `game.variables[1].${field}` }),
        ]),
      });
      expect(f.repo.saveGraph).not.toHaveBeenCalled();
      expect(f.graph()).toEqual(before);
    },
  );
  it.each([
    { value: { unexpected: null }, path: 'game.entities[0].unexpected' },
    {
      value: { transform: { position: { unexpected: null } } },
      path: 'game.entities[0].transform.position.unexpected',
    },
  ])('rejects unknown null fields in partial objects at $path', async ({ value, path }) => {
    const f = fixture();
    const before = structuredClone(f.graph());
    await expect(
      f.request(`/entities/${before.diagram.game!.entities[0].id}`, 'PATCH', {
        baseVersion: 1,
        value: { ...value, name: 'Must not save', movement: null },
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'ROBLOX_GAME_INVALID',
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'unsupported-field', path }),
      ]),
    });
    expect(f.repo.saveGraph).not.toHaveBeenCalled();
    expect(f.graph()).toEqual(before);
  });
  it('retains null fields inside complete replacement arrays for canonical validation', async () => {
    const f = fixture();
    const rule = f.graph().diagram.game!.rules[0];
    await expect(
      f.request(`/rules/${rule.id}`, 'PATCH', {
        baseVersion: 1,
        value: { actions: [{ kind: 'message', text: 'Must not save', unexpected: null }] },
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'ROBLOX_GAME_INVALID',
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: 'unsupported-field',
          path: 'game.rules[0].actions[0].unexpected',
        }),
      ]),
    });
    await expect(
      f.request('/prefabs', 'POST', {
        baseVersion: 1,
        value: {
          id: 'new-prefab',
          name: 'New prefab',
          entities: [],
          rules: [{ ...rule, condition: null }],
        },
      }),
    ).rejects.toMatchObject({ status: 422, code: 'ROBLOX_GAME_INVALID' });
    expect(f.repo.saveGraph).not.toHaveBeenCalled();
    await f.request('/prefabs', 'POST', {
      baseVersion: 1,
      value: { id: 'new-prefab', name: 'New prefab', entities: [], rules: [] },
    });
    await expect(
      f.request('/prefabs/new-prefab', 'PATCH', {
        baseVersion: 2,
        value: { rules: [{ ...rule, condition: null }] },
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'ROBLOX_GAME_INVALID',
      issues: expect.arrayContaining([
        expect.objectContaining({ path: 'game.prefabs[0].rules[0].condition' }),
      ]),
    });
    expect(f.repo.saveGraph).toHaveBeenCalledOnce();
    expect(f.graph().diagram.game!.prefabs[0].rules).toEqual([]);
  });
  it('clears optional partial fields even when absent and replaces valid action arrays', async () => {
    const f = fixture();
    const variable = f.graph().diagram.game!.variables[0];
    for (const baseVersion of [1, 2]) {
      await f.request(`/variables/${variable.id}`, 'PATCH', {
        baseVersion,
        value: { min: null },
      });
      expect(f.graph().diagram.game!.variables[0]).toEqual({
        id: variable.id,
        name: variable.name,
        scope: variable.scope,
        initial: variable.initial,
        max: variable.max,
      });
    }
    const rule = f.graph().diagram.game!.rules[1];
    await f.request(`/rules/${rule.id}`, 'PATCH', {
      baseVersion: 3,
      value: { condition: null, actions: [{ kind: 'message', text: 'Replacement action' }] },
    });
    expect(f.graph().diagram.game!.rules[1]).toEqual({
      ...rule,
      actions: [{ kind: 'message', text: 'Replacement action' }],
    });
    expect(f.repo.saveGraph).toHaveBeenCalledTimes(3);
  });
  it('does not validate null as the current game and never executes imported expressions', async () => {
    const f = fixture();
    expect(await f.request('/validate', 'POST', { game: null })).toMatchObject({ valid: false });
    const rule = f.graph().diagram.game!.rules[0];
    await expect(
      f.request(`/rules/${rule.id}`, 'PATCH', {
        baseVersion: 1,
        value: { actions: [{ kind: 'eval', source: 'globalThis.injected=true' }] },
      }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      f.request(`/rules/${rule.id}`, 'PATCH', {
        baseVersion: 1,
        value: JSON.parse('{"__proto__":{"injected":true}}'),
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect((globalThis as { injected?: boolean }).injected).toBeUndefined();
    expect(f.repo.saveGraph).not.toHaveBeenCalled();
  });
  it('exposes paginated semantic data and readonly preview identical to the UI rule engine', async () => {
    const f = fixture();
    const game = f.graph().diagram.game!;
    const spawn = game.entities.find((entity) => entity.kind === 'spawn')!;
    const page = await f.request('/entities?offset=0&limit=1');
    expect(page).toMatchObject({
      total: game.entities.length,
      offset: 0,
      nextOffset: 1,
      items: [game.entities[0]],
    });
    const steps = [
      { kind: 'join' as const, playerId: 'one' },
      { kind: 'join' as const, playerId: 'two' },
      { kind: 'touch' as const, playerId: 'one', entityId: spawn.id },
      { kind: 'advance' as const, seconds: 2 },
    ];
    const result = await f.request('/preview', 'POST', { steps });
    expect(result).toMatchObject(runRobloxPreview(game, steps));
    expect(f.repo.saveGraph).not.toHaveBeenCalled();
    for (const endpoint of ['validate', 'preview', 'builds'])
      assertMcpAccess('read', `/diagrams/${f.graph().diagram.id}/roblox/${endpoint}`, 'POST');
    expect(() =>
      assertMcpAccess('read', `/diagrams/${f.graph().diagram.id}/roblox/entities`, 'POST'),
    ).toThrow(/read-only/);
    expect(() => assertMcpAccess('off', `/diagrams/${f.graph().diagram.id}/roblox`, 'GET')).toThrow(
      /off/,
    );
  });
  it('builds canonical native bytes asynchronously and retrieves bounded UTF-8 byte chunks', async () => {
    const f = fixture();
    const started = (await f.request('/builds', 'POST', { baseVersion: 1 })) as { jobId: string };
    await expect
      .poll(async () => ((await f.request(`/builds/${started.jobId}`)) as { state: string }).state)
      .toBe('succeeded');
    const manifest = (await f.request(`/builds/${started.jobId}/result`)) as {
      artifacts: { name: string; totalBytes: number; sha256: string }[];
    };
    const expected = compileRobloxGame(f.graph().diagram.game!);
    const bytes = new TextEncoder().encode(expected.placeXml);
    expect(manifest.artifacts[0]).toMatchObject({
      name: 'game.rbxlx',
      totalBytes: bytes.length,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const page = (await f.request(
      `/builds/${started.jobId}/artifacts/game.rbxlx?offset=7&limit=19`,
    )) as { content: string; nextOffset: number; encoding: string };
    expect(page).toMatchObject({ encoding: 'base64', nextOffset: 26 });
    expect([...Uint8Array.from(atob(page.content), (char) => char.charCodeAt(0))]).toEqual([
      ...bytes.slice(7, 26),
    ]);
    expect(bridgeResponseStatus(`/diagrams/${f.graph().diagram.id}/roblox/builds`, 'POST')).toBe(
      202,
    );
    f.a.controller.abort();
    await expect(f.request(`/builds/${started.jobId}/result`)).rejects.toBeDefined();
  });
  it('refuses destructive generic projection edits instead of silently recreating deleted work', () => {
    const f = fixture();
    const original = f.graph();
    const duplicate = structuredClone(original);
    duplicate.nodes.push({ ...duplicate.nodes[0], id: crypto.randomUUID() });
    expect(() => reconcileGameGraph(original, duplicate)).toThrow(/duplicate/i);
    const noConnection = structuredClone(original);
    noConnection.edges.shift();
    expect(() => reconcileGameGraph(original, noConnection)).toThrow(/rule builder/i);
  });
});
describe('transient build authority', () => {
  it('never releases a late private result after revocation and never lets another diagram retrieve it', async () => {
    let finish!: (build: ReturnType<typeof compileRobloxGame>) => void;
    const jobs = new RobloxApiJobs(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    registries.push(jobs);
    const a = authority();
    const game = createRobloxStarterGame();
    const status = await jobs.start('a', 7, game, a);
    await expect(jobs.status('b', status.jobId, async () => {})).rejects.toMatchObject({
      status: 404,
    });
    a.controller.abort();
    finish(compileRobloxGame(game));
    await Promise.resolve();
    await expect(jobs.result('a', status.jobId, async () => {})).rejects.toMatchObject({
      status: 404,
    });
    expect(a.dispose).toHaveBeenCalledOnce();
  });
});
