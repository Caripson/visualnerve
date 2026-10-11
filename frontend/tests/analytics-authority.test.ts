import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blankGraph } from '../src/model/types';
import { StorageError } from '../src/model/errors';
import { useEditor } from '../src/state/editor';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { growthChurnInput } from '../src/analytics/example';

const workerRun = vi.hoisted(() => vi.fn());
vi.mock('../src/analytics/service', () => ({ analyticsService: { run: workerRun } }));
let db: WorkspaceDatabase, repo: Repository, workspace: Workspace;
beforeEach(async () => {
  db = new WorkspaceDatabase(`analytics-authority-${crypto.randomUUID()}`);
  await db.settings.bulkPut([
    { key: 'storage-consent', value: true },
    { key: 'mcp-access', value: 'write' },
  ]);
  repo = new Repository(db);
  workspace = new Workspace(repo);
  await workspace.start();
  const graph = blankGraph('Illustrative authority fixture', 'freeform');
  graph.diagram.analytics = growthChurnInput();
  await workspace.create(graph);
  vi.spyOn(workspace, 'refresh').mockResolvedValue(undefined);
});
afterEach(async () => {
  workspace.stop();
  useEditor.getState().setGraph(null);
  vi.restoreAllMocks();
  workerRun.mockReset();
  await db.delete();
});

describe('direct analytics worker originating grant cancellation', () => {
  it.each([
    ['read', 'write'],
    ['write', 'read'],
    ['read', 'read'],
  ] as const)(
    'stops a running preview immediately on explicit %s → %s grant choice',
    async (initial, next) => {
      await workspace.setPreference('mcp-access', initial);
      const graph = await repo.getGraph(useEditor.getState().graph!.diagram.id);
      let enter!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      let signal: AbortSignal | undefined;
      workerRun.mockImplementationOnce(async (_input, options: { signal?: AbortSignal }) => {
        signal = options.signal;
        enter();
        await new Promise<void>((_resolve, reject) => {
          const abort = () =>
            reject(new StorageError(403, 'Originating worker authority revoked.'));
          if (signal!.aborted) abort();
          else signal!.addEventListener('abort', abort, { once: true });
        });
        throw new Error('A revoked worker must never produce a result.');
      });
      const pending = workspace.external(
        `/diagrams/${graph.diagram.id}/analytics/measure`,
        'POST',
        {
          id: graph.diagram.analytics!.measurements[0].id,
        },
      );
      const rejected = expect(pending).rejects.toBeInstanceOf(Error);
      await entered;
      await workspace.setPreference('mcp-access', next);
      expect(signal?.aborted).toBe(true);
      await rejected;
      expect(await repo.getGraph(graph.diagram.id)).toEqual(graph);
    },
  );
});
