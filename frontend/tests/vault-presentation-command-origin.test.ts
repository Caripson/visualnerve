import { beforeEach, describe, expect, it, vi } from 'vitest';
import { presentationRequest } from '../src/presentation/commands';

const fixture = vi.hoisted(() => ({ video: vi.fn(), play: vi.fn(), state: vi.fn() }));
vi.mock('../src/presentation/service', () => ({
  presentation: { play: fixture.play, getState: fixture.state },
  voiceCatalog: vi.fn(),
}));
vi.mock('../src/presentation/video-service', () => ({
  startVideo: fixture.video,
  isVideoExporting: () => false,
  videoExport: { getState: fixture.state },
}));
beforeEach(() => {
  fixture.video.mockReset().mockReturnValue({ phase: 'started' });
  fixture.play.mockReset().mockReturnValue({ phase: 'playing' });
  fixture.state.mockReset().mockReturnValue({ private: 'Fresh workspace state' });
});
describe('presentation command originating-session publication', () => {
  it.each([
    ['/presentation/video', 'POST'],
    ['/presentation/play', 'POST'],
    ['/presentation', 'GET'],
  ])(
    'rejects revocation in the authorization microtask before %s dispatch',
    async (path, method) => {
      const original = new AbortController();
      const authorize = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolve();
            queueMicrotask(() => original.abort());
          }),
      );
      await expect(
        presentationRequest(path, method, {}, authorize, original.signal),
      ).rejects.toMatchObject({
        status: 423,
        code: 'WORKSPACE_LOCKED',
      });
      expect(authorize).toHaveBeenCalledOnce();
      expect(fixture.video).not.toHaveBeenCalled();
      expect(fixture.play).not.toHaveBeenCalled();
      expect(fixture.state).not.toHaveBeenCalled();
    },
  );
  it('still dispatches an authorized current video command', async () => {
    const original = new AbortController();
    const options = { audio: false };
    await expect(
      presentationRequest(
        '/presentation/video',
        'POST',
        options,
        async () => undefined,
        original.signal,
      ),
    ).resolves.toEqual({ phase: 'started' });
    expect(fixture.video).toHaveBeenCalledWith(options, true);
  });
});
