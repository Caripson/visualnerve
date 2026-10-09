import type { Translate } from '../i18n';
import type { VoiceId } from './speech/voices';

export const voiceLabelKeys = {
  'en_GB-alan-medium': 'voice.optionAlan',
  'en_US-ljspeech-high': 'voice.optionLjSpeech',
  'en_GB-cori-high': 'voice.optionCoriHigh',
  'sv_SE-nst-medium': 'voice.optionNst',
  'en_US-libritts-high': 'voice.optionLibriTts',
  'en_US-joe-medium': 'voice.optionJoe',
  'en_US-kristin-medium': 'voice.optionKristin',
  'en_US-norman-medium': 'voice.optionNorman',
  'en_GB-alba-medium': 'voice.optionAlba',
  'en_GB-northern_english_male-medium': 'voice.optionNorthern',
  'en_GB-jenny_dioco-medium': 'voice.optionJenny',
  'en_GB-cori-medium': 'voice.optionCoriMedium',
  'fr_FR-siwis-medium': 'voice.optionSiwis',
  'es_ES-davefx-medium': 'voice.optionDaveFx',
  'pt_PT-tugão-medium': 'voice.optionTugao',
  'pt_BR-faber-medium': 'voice.optionFaber',
  'no_NO-talesyntese-medium': 'voice.optionNorwegian',
  'da_DK-talesyntese-medium': 'voice.optionDanish',
  'fi_FI-harri-medium': 'voice.optionHarri',
  'de_DE-thorsten-high': 'voice.optionThorsten',
} as const satisfies Record<VoiceId, string>;

/** Descriptive display only; voice IDs, model metadata, samples and narration never change. */
export function voiceDisplayLabel(id: VoiceId, t: Translate) {
  return t(voiceLabelKeys[id]);
}
