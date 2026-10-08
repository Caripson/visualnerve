import { beforeEach, expect, it, vi } from 'vitest';
const video = vi.hoisted(() => ({
  start: vi.fn(() => ({ status: 'preparing' })),
  cancel: vi.fn(() => ({ status: 'cancelled' })),
  state: vi.fn(() => ({ status: 'idle' })),
  busy: vi.fn(() => false),
}));
vi.mock('../src/presentation/video-service', () => ({
  startVideo: video.start,
  videoExport: { getState: video.state, cancel: video.cancel },
  isVideoExporting: video.busy,
}));
import { presentationRequest } from '../src/presentation/commands';
beforeEach(() => {
  vi.clearAllMocks();
  video.busy.mockReturnValue(false);
});
it('reauthorizes after loading runtime code before any video side effect', async () => {
  const denied = vi.fn(async () => {
    throw Object.assign(new Error('Access revoked'), { status: 403 });
  });
  await expect(
    presentationRequest('/presentation/video', 'POST', {}, denied),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    presentationRequest('/presentation/video', 'DELETE', {}, denied),
  ).rejects.toMatchObject({ status: 403 });
  expect(video.start).not.toHaveBeenCalled();
  expect(video.cancel).not.toHaveBeenCalled();
  await presentationRequest('/presentation/video', 'POST', { audio: false }, async () => undefined);
  expect(video.start).toHaveBeenCalledWith({ audio: false }, true);
});
it('cancels only with an exact empty object and leaves a job alone on malformed close', async () => {
  for (const value of [undefined, null, [], { all: true }])
    await expect(presentationRequest('/presentation/video', 'DELETE', value)).rejects.toMatchObject(
      { status: 422 },
    );
  video.busy.mockReturnValue(true);
  await expect(
    presentationRequest('/presentation/close', 'POST', { wrong: true }),
  ).rejects.toMatchObject({ status: 422 });
  expect(video.cancel).not.toHaveBeenCalled();
  expect(await presentationRequest('/presentation/video', 'DELETE', {})).toEqual({
    status: 'cancelled',
  });
  expect(video.cancel).toHaveBeenCalledOnce();
});
it('allows status reads while keeping competing playback commands locked', async () => {
  video.busy.mockReturnValue(true);
  expect(await presentationRequest('/presentation/video', 'GET')).toEqual({ status: 'idle' });
  for (const action of ['play', 'pause', 'rewind', 'forward', 'preload'])
    await expect(presentationRequest(`/presentation/${action}`, 'POST', {})).rejects.toMatchObject({
      status: 409,
    });
  await expect(
    presentationRequest('/presentation', 'PATCH', { audio: true }),
  ).rejects.toMatchObject({ status: 409 });
});
