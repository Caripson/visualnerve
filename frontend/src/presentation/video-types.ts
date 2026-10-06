import { StorageError } from '../model/errors';
import type { PresentationSource } from './storyboard';

export const VIDEO_WIDTH = 1280;
export const VIDEO_HEIGHT = 720;
export const VIDEO_FPS = 30;
export const VIDEO_MAX_SECONDS = 30 * 60;
export interface VideoOptions {
  source?: PresentationSource;
  audio: boolean;
  subtitles: boolean;
}
export interface VideoState {
  source: PresentationSource;
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
    Object.entries(value).some(([key, item]) =>
      key === 'source'
        ? !['nodes', 'storyboard'].includes(item as string)
        : !['audio', 'subtitles'].includes(key) || typeof item !== 'boolean',
    )
  )
    throw new StorageError(
      422,
      'Video export accepts optional audio/subtitles booleans and nodes/storyboard source.',
    );
  return {
    audio: defaults.audio,
    subtitles: defaults.subtitles,
    ...(defaults.source ? { source: defaults.source } : {}),
    ...value,
  };
}
export const videoActive = (state: VideoState) =>
  state.status === 'preparing' || state.status === 'exporting';
