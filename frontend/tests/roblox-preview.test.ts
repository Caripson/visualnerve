import { afterEach, describe, expect, it, vi } from 'vitest';
import { runRobloxPreview, type RobloxPreviewStep } from '../src/roblox/preview';
import { RobloxPreviewService } from '../src/roblox/preview-service';
import { RobloxSimulator } from '../src/roblox/simulator';
import { createRobloxAdventureGame } from '../src/roblox/starter';
import { clearRobloxIfLoaded } from '../src/roblox/lifecycle';

const trace: RobloxPreviewStep[] = [
  { kind: 'join', playerId: 'alex' },
  { kind: 'join', playerId: 'sam' },
  ...['first-crystal/crystal', 'second-crystal/crystal', 'third-crystal/crystal'].map(
    (entityId) => ({ kind: 'touch' as const, playerId: 'alex', entityId }),
  ),
  { kind: 'interact', playerId: 'sam', entityId: 'power-switch' },
  { kind: 'interact', playerId: 'alex', entityId: 'crystal-gate' },
  { kind: 'touch', playerId: 'alex', entityId: 'treasure' },
  { kind: 'interact', playerId: 'sam', entityId: 'guide' },
  { kind: 'advance', seconds: 120 },
];
afterEach(() => {
  clearRobloxIfLoaded();
  vi.unstubAllGlobals();
});
describe('bounded Roblox preview protocol', () => {
  it('returns exactly the incremental UI simulator state with optional bounded history', async () => {
    const game = createRobloxAdventureGame(),
      simulator = new RobloxSimulator(game);
    simulator.join('alex');
    simulator.join('sam');
    for (const id of ['first-crystal/crystal', 'second-crystal/crystal', 'third-crystal/crystal'])
      simulator.trigger({ kind: 'touch', entityId: id }, 'alex');
    simulator.trigger({ kind: 'interact', entityId: 'power-switch' }, 'sam');
    simulator.trigger({ kind: 'interact', entityId: 'crystal-gate' }, 'alex');
    simulator.trigger({ kind: 'touch', entityId: 'treasure' }, 'alex');
    simulator.trigger({ kind: 'interact', entityId: 'guide' }, 'sam');
    simulator.advance(120);
    const service = new RobloxPreviewService(),
      result = await service.execute(game, trace, { history: true });
    expect(result.snapshot).toEqual(simulator.snapshot());
    expect(result.history).toHaveLength(trace.length + 1);
    expect(result.history!.at(-1)).toEqual(result.snapshot);
    expect(result.snapshot.players[0].won).toBe(true);
  });
  it('rejects synthetic events, missing players/objects, extra fields and budget violations', () => {
    const game = createRobloxAdventureGame();
    for (const invalid of [
      [{ kind: 'roundStart', playerId: 'alex' }],
      [{ kind: 'touch', playerId: 'alex', entityId: 'guide' }],
      [{ kind: 'join', playerId: 'alex', script: 'ignored' }],
      [{ kind: 'advance', seconds: NaN }],
      [{ kind: 'advance', seconds: 86401 }],
      [{ kind: 'join', playerId: 'alex\n' }],
      [
        { kind: 'join', playerId: 'alex' },
        { kind: 'touch', playerId: 'alex', entityId: 'missing' },
      ],
      Array.from({ length: 129 }, () => ({ kind: 'advance', seconds: 0 })),
    ])
      expect(() => runRobloxPreview(game, invalid)).toThrow();
    game.settings.maxPlayers = 100;
    expect(() =>
      runRobloxPreview(
        game,
        Array.from({ length: 17 }, (_, i) => ({ kind: 'join', playerId: `player${i}` })),
      ),
    ).toThrow(/player limit/);
  });
  it('resets session progress through leave/rejoin and rejects invalid lifetime traces', () => {
    const game = createRobloxAdventureGame();
    const result = runRobloxPreview(game, [
      { kind: 'join', playerId: 'alex' },
      { kind: 'touch', playerId: 'alex', entityId: 'first-crystal/crystal' },
      { kind: 'leave', playerId: 'alex' },
      { kind: 'join', playerId: 'alex' },
    ]);
    expect(result.snapshot.players[0].inventory.crystal).toBe(0);
    expect(() =>
      runRobloxPreview(game, [
        { kind: 'join', playerId: 'alex' },
        { kind: 'join', playerId: 'alex' },
      ]),
    ).toThrow(/already joined/);
    expect(() => runRobloxPreview(game, [{ kind: 'respawn', playerId: 'missing' }])).toThrow(
      /Join this player/,
    );
  });
  it('revokes pending workers and drops a late result after workspace lock', async () => {
    const workers: MockWorker[] = [];
    class MockWorker {
      onmessage?: (event: MessageEvent) => void;
      onerror?: () => void;
      terminated = false;
      constructor() {
        workers.push(this);
      }
      postMessage() {}
      terminate() {
        this.terminated = true;
      }
    }
    vi.stubGlobal('Worker', MockWorker);
    const service = new RobloxPreviewService(),
      pending = service.execute(createRobloxAdventureGame(), trace);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'ROBLOX_PREVIEW_CANCELLED' });
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    clearRobloxIfLoaded();
    workers[0].onmessage?.({
      data: { result: runRobloxPreview(createRobloxAdventureGame(), trace) },
    } as MessageEvent);
    await rejected;
    expect(workers[0].terminated).toBe(true);
  });
  it('enforces two active workers and checks origin authority before revealing a result', async () => {
    const workers: MockWorker[] = [];
    class MockWorker {
      onmessage?: (event: MessageEvent) => void;
      onerror?: () => void;
      constructor() {
        workers.push(this);
      }
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', MockWorker);
    const service = new RobloxPreviewService(),
      game = createRobloxAdventureGame();
    const a = service.execute(game, trace),
      b = service.execute(game, trace);
    const checks = [
      expect(a).rejects.toMatchObject({ code: 'ROBLOX_PREVIEW_CANCELLED' }),
      expect(b).rejects.toMatchObject({ code: 'ROBLOX_PREVIEW_CANCELLED' }),
    ];
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    await expect(service.execute(game, trace)).rejects.toMatchObject({
      code: 'ROBLOX_PREVIEW_BUSY',
    });
    service.dispose();
    await Promise.all(checks);
    vi.unstubAllGlobals();
    const controller = new AbortController();
    let granted = true;
    const guard = {
      signal: controller.signal,
      check: async () => {
        if (!granted) throw new Error('grant revoked');
      },
      assertCurrent: () => {
        if (!granted) throw new Error('grant revoked');
      },
    };
    const pending = service.execute(game, trace, { guard });
    granted = false;
    await expect(pending).rejects.toThrow('grant revoked');
  });
});
