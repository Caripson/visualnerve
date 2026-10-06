import type { VoiceId } from './voices';

export type SpeechProgress = {
  stage: 'download' | 'loading' | 'synthesis';
  loaded: number;
  total: number;
  message: string;
};
export type SpeechRequest = {
  id: number;
  action: 'prepare' | 'preload';
  text?: string;
  voiceId: VoiceId;
  assetBase: string;
};
export type SpeechResponse =
  | { id: number; progress: SpeechProgress }
  | { id: number; audio?: Blob; ready: true }
  | { id: number; error: string };

export const MAX_NARRATION_CHARACTERS = 12000;
export const SPEECH_MODEL_CACHE = 'visualnerve-piper-models-v1';
