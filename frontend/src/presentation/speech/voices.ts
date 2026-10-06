import { StorageError } from '../../model/errors';

export const VOICE_SETTING = 'presentation-voice';
export const DEFAULT_VOICE_ID = 'en_US-ljspeech-high';
export const MODEL_REVISION = 'c10ece1aade47bb51c153c893d14e5bf8e5b7117';
const source = `https://huggingface.co/rhasspy/piper-voices/resolve/${MODEL_REVISION}`;

export const VOICES = [
  {
    id: DEFAULT_VOICE_ID,
    label: 'English (US) · LJ Speech · high quality',
    language: 'en-US',
    sampleRate: 22050,
    modelBytes: 114199011,
    modelSha256: '5d4f08ba6a2a48c44592eed3ce56bf85e9de3dd4e20df90541ae68a8310c029a',
    configBytes: 4970,
    configSha256: '7e1f4634af596d83cca997fb7a931ba80b70f8a316a2655ee69c55365e0ace14',
    path: 'en/en_US/ljspeech/high/en_US-ljspeech-high.onnx',
    license: 'MIT model · public-domain training data',
    source: `${source}/en/en_US/ljspeech/high/MODEL_CARD`,
  },
  {
    id: 'en_GB-cori-high',
    label: 'English (UK) · Cori · high quality',
    language: 'en-GB',
    sampleRate: 22050,
    modelBytes: 114219352,
    modelSha256: '470b4dd634c98f8a4850d7626ffc3dfc90774628eeef6605a6dd8f88f30a5903',
    configBytes: 4963,
    configSha256: '9e7fb5b5671612c22f3c81cbe46c1ae87b031a4632bcb509e499dad6f1e2adec',
    path: 'en/en_GB/cori/high/en_GB-cori-high.onnx',
    license: 'MIT model · public-domain training data',
    source: `${source}/en/en_GB/cori/high/MODEL_CARD`,
  },
  {
    id: 'sv_SE-nst-medium',
    label: 'Svenska · NST · medium quality',
    language: 'sv-SE',
    sampleRate: 22050,
    modelBytes: 63104526,
    modelSha256: 'df011f56825a59dd1efc080c38a65a1ef70407e60f63050e9246f43a3d7e471e',
    configBytes: 4157,
    configSha256: 'd45dd74cbb4eca58694bf04a97e243044092476f28a55ae26424f0653086980a',
    path: 'sv/sv_SE/nst/medium/sv_SE-nst-medium.onnx',
    license: 'MIT model · CC0 training data',
    source: `${source}/sv/sv_SE/nst/medium/MODEL_CARD`,
  },
] as const;

export type VoiceId = (typeof VOICES)[number]['id'];
export type PresentationVoice = (typeof VOICES)[number];
export function normalizeVoiceId(value: unknown): VoiceId {
  return VOICES.some((voice) => voice.id === value) ? (value as VoiceId) : DEFAULT_VOICE_ID;
}
export function assertVoiceId(value: unknown): asserts value is VoiceId {
  if (!VOICES.some((voice) => voice.id === value))
    throw new StorageError(422, 'Select a supported English or Swedish presentation voice.');
}
export function voiceInfo(id: VoiceId): PresentationVoice {
  assertVoiceId(id);
  return VOICES.find((voice) => voice.id === id)!;
}
export function modelUrl(voice: PresentationVoice, config = false) {
  return `${source}/${voice.path}${config ? '.json' : ''}`;
}
export function voiceSample(id: VoiceId) {
  return voiceInfo(id).language === 'sv-SE'
    ? 'Välkommen. Vi går igenom diagrammet, ett steg i taget.'
    : 'Welcome. Let us walk through the diagram, one step at a time.';
}
