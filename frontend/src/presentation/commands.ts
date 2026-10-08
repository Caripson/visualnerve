import { StorageError } from '../model/errors';
import { presentation, voiceCatalog } from './service';
import * as video from './video-service';
export { isVideoExporting } from './video-service';
import type { PresentationSource } from './storyboard';

export async function presentationRequest(
  path: string,
  method: string,
  value?: unknown,
  authorize?: () => Promise<void>,
) {
  await authorize?.();
  if (path === '/presentation/video') {
    if (method === 'GET') return video.videoExport.getState();
    if (method === 'POST') return video.startVideo(value, true);
    if (method === 'DELETE') {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length)
        throw new StorageError(422, 'Cancel video export requires an empty object.');
      return video.videoExport.cancel();
    }
    throw new StorageError(404, 'Unknown video endpoint.');
  }
  if (path === '/presentation/voices' && method === 'GET') return voiceCatalog();
  if (path === '/presentation' && method === 'GET') return presentation.getState();
  if (path === '/presentation' && method === 'PATCH') {
    if (video.isVideoExporting())
      throw new StorageError(409, 'Cancel or finish video export before controlling the player.');
    return presentation.options(value);
  }
  if (path === '/presentation/seek' && method === 'POST') {
    if (video.isVideoExporting())
      throw new StorageError(409, 'Cancel or finish video export before controlling the player.');
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => key !== 'index')
    )
      throw new StorageError(422, 'Seek requires an exact index.');
    return presentation.seek((value as { index: number }).index);
  }
  if (
    path === '/presentation/open' &&
    method === 'POST' &&
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    const fields = value as { source?: PresentationSource };
    if (
      Object.keys(fields).some((key) => key !== 'source') ||
      (fields.source !== undefined && !['nodes', 'storyboard'].includes(fields.source))
    )
      throw new StorageError(422, 'Open accepts an optional nodes or storyboard source.');
    if (video.isVideoExporting())
      throw new StorageError(409, 'Cancel or finish video export before controlling the player.');
    return presentation.open(fields.source);
  }
  const action = path.slice('/presentation/'.length);
  if (
    method !== 'POST' ||
    !['open', 'play', 'pause', 'rewind', 'forward', 'close', 'preload'].includes(action)
  )
    throw new StorageError(404, 'Unknown presentation endpoint.');
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length)
    throw new StorageError(422, 'This player command requires an empty object.');
  if (video.isVideoExporting()) {
    if (action === 'close') video.videoExport.cancel();
    else
      throw new StorageError(409, 'Cancel or finish video export before controlling the player.');
  }
  switch (action) {
    case 'open':
      return presentation.open();
    case 'play':
      return presentation.play();
    case 'pause':
      return presentation.pause();
    case 'rewind':
      return presentation.skip(-1);
    case 'forward':
      return presentation.skip(1);
    case 'close':
      return presentation.close();
    default:
      return presentation.preload();
  }
}
