import { StorageError } from '../../model/errors';
import { DEFAULT_VOICE_ID, MODEL_REVISION, VOICES } from './voice-models';

export { DEFAULT_VOICE_ID, MODEL_REVISION, VOICES } from './voice-models';

export const VOICE_SETTING = 'presentation-voice';
const source = `https://huggingface.co/rhasspy/piper-voices/resolve/${MODEL_REVISION}`;

export type VoiceId = (typeof VOICES)[number]['id'];
export type PresentationVoice = (typeof VOICES)[number];
export function normalizeVoiceId(value: unknown): VoiceId {
  return VOICES.some((voice) => voice.id === value) ? (value as VoiceId) : DEFAULT_VOICE_ID;
}
export function assertVoiceId(value: unknown): asserts value is VoiceId {
  if (!VOICES.some((voice) => voice.id === value))
    throw new StorageError(422, 'Select a supported presentation voice from the catalog.');
}
export function voiceInfo(id: VoiceId): PresentationVoice {
  assertVoiceId(id);
  return VOICES.find((voice) => voice.id === id)!;
}
export function modelUrl(voice: PresentationVoice, config = false) {
  return new URL(`${voice.path}${config ? '.json' : ''}`, source + '/').href;
}
const samples: Record<PresentationVoice['language'], string> = {
  'en-GB': 'Welcome. Let us walk through the diagram, one step at a time.',
  'en-US': 'Welcome. Let us walk through the diagram, one step at a time.',
  'sv-SE': 'Välkommen. Vi går igenom diagrammet, ett steg i taget.',
  'fr-FR': 'Bienvenue. Parcourons le diagramme, étape par étape.',
  'es-ES': 'Bienvenido. Vamos a recorrer el diagrama, paso a paso.',
  'pt-PT': 'Bem-vindo. Vamos percorrer o diagrama, passo a passo.',
  'pt-BR': 'Bem-vindo. Vamos percorrer o diagrama, passo a passo.',
  'no-NO': 'Velkommen. Vi går gjennom diagrammet, ett trinn om gangen.',
  'da-DK': 'Velkommen. Vi gennemgår diagrammet, ét trin ad gangen.',
  'fi-FI': 'Tervetuloa. Käydään kaavio läpi vaihe vaiheelta.',
  'de-DE': 'Willkommen. Gehen wir das Diagramm Schritt für Schritt durch.',
};
export function voiceSample(id: VoiceId) {
  return samples[voiceInfo(id).language];
}
