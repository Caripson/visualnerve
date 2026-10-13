import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildEditor } from '../src/roblox/ui/BuildEditor';
import { createGameGraph } from '../src/roblox/document';
import { createRobloxStarterGame } from '../src/roblox/starter';
import { compileRobloxGame } from '../src/roblox/compiler';
import { robloxBuildService } from '../src/roblox/build-service';
import type { RobloxBuild } from '../src/roblox/types';
import { useEditor } from '../src/state/editor';
import { workspace } from '../src/storage/workspace';
import { download } from '../src/export/semantic';

vi.mock('../src/roblox/build-service', () => ({ robloxBuildService: { build: vi.fn() } }));
vi.mock('../src/export/semantic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/export/semantic')>()),
  download: vi.fn(),
}));
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
let controller: AbortController;
let dispose: () => void;
beforeEach(() => {
  vi.clearAllMocks();
  controller = new AbortController();
  dispose = vi.fn<() => void>();
  vi.spyOn(workspace.repo.db, 'captureOperation').mockResolvedValue({
    signal: controller.signal,
    storage: workspace.repo.db,
    check: async () => controller.signal.throwIfAborted(),
    dispose,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  useEditor.getState().setGraph(null);
});
function mount() {
  const graph = createGameGraph('A guarded game', createRobloxStarterGame());
  useEditor.getState().setGraph(graph);
  const rendered = render(<BuildEditor game={graph.diagram.game!} navigate={vi.fn()} />);
  return { ...rendered, graph, build: compileRobloxGame(graph.diagram.game!) };
}

describe('Roblox build UI originating-session boundary', () => {
  it('rejects a late worker result after workspace revocation and disposes its operation', async () => {
    const pending = deferred<RobloxBuild>();
    vi.mocked(robloxBuildService.build).mockReturnValue(pending.promise);
    const { build } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Build Roblox files' }));
    await waitFor(() => expect(robloxBuildService.build).toHaveBeenCalledOnce());
    expect(vi.mocked(robloxBuildService.build).mock.calls[0][1]?.guard).toBeDefined();
    await act(async () => {
      controller.abort();
      pending.resolve(build);
      await pending.promise;
    });
    expect(
      screen.queryByRole('button', { name: 'Download Studio place (.rbxlx)' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('cancelled');
    expect(dispose).toHaveBeenCalledOnce();
    expect(download).not.toHaveBeenCalled();
  });
  it('aborts the in-flight worker when the builder unmounts and never delivers its result', async () => {
    const pending = deferred<RobloxBuild>();
    vi.mocked(robloxBuildService.build).mockReturnValue(pending.promise);
    const { build, unmount } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Build Roblox files' }));
    await waitFor(() => expect(robloxBuildService.build).toHaveBeenCalledOnce());
    const signal = vi.mocked(robloxBuildService.build).mock.calls[0][1]!.signal!;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      pending.resolve(build);
      await pending.promise;
    });
    expect(download).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });
  it('captures and rechecks a new operation at download time so a revoked lease cannot release plaintext', async () => {
    const { build } = mount();
    vi.mocked(robloxBuildService.build).mockResolvedValue(build);
    fireEvent.click(screen.getByRole('button', { name: 'Build Roblox files' }));
    await screen.findByRole('button', { name: 'Download Studio place (.rbxlx)' });
    const downloadController = new AbortController();
    const captured = deferred<Awaited<ReturnType<typeof workspace.repo.db.captureOperation>>>();
    vi.mocked(workspace.repo.db.captureOperation).mockReturnValueOnce(captured.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Download Studio place (.rbxlx)' }));
    const downloadDispose = vi.fn();
    await act(async () => {
      downloadController.abort();
      captured.resolve({
        signal: downloadController.signal,
        storage: workspace.repo.db,
        check: async () => downloadController.signal.throwIfAborted(),
        dispose: downloadDispose,
      });
      await captured.promise;
    });
    expect(download).not.toHaveBeenCalled();
    expect(downloadDispose).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert')).toHaveTextContent('cancelled');
  });
});
