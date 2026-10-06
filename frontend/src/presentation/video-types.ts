import { StorageError } from '../model/errors';

export const VIDEO_WIDTH = 1280;
export const VIDEO_HEIGHT = 720;
export const VIDEO_FPS = 30;
export const VIDEO_MAX_SECONDS = 30 * 60;
export interface VideoOptions {
  audio: boolean;
  subtitles: boolean;
}
export interface VideoState {
  status: 'idle' | 'preparing' | 'exporting' | 'complete' | 'cancelled' | 'error';
  progress: number;
  nodeIndex: number;
  total: number;
  format: 'mp4' | 'webm' | null;
  message: string;
  fileName: string | null;
}
export function videoOptions(value: unknown, defaults: VideoOptions): VideoOptions {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.entries(value).some(
      ([key, item]) => !['audio', 'subtitles'].includes(key) || typeof item !== 'boolean',
    )
  )
    throw new StorageError(422, 'Video export accepts only optional audio and subtitles booleans.');
  return { ...defaults, ...value };
}
export const videoActive = (state: VideoState) =>
  state.status === 'preparing' || state.status === 'exporting';
