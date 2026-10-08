import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  assertVoiceId,
  DEFAULT_VOICE_ID,
  MODEL_REVISION,
  modelUrl,
  normalizeVoiceId,
  VOICES,
  voiceInfo,
  voiceSample,
} from '../src/presentation/speech/voices';
import upstream from './fixtures/piper-voices/upstream.json';

const fixtures = resolve(process.cwd(), 'tests/fixtures/piper-voices');
const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

it('preserves Alan and every existing persisted voice without invented quality tiers', () => {
  expect(DEFAULT_VOICE_ID).toBe('en_GB-alan-medium');
  expect(VOICES[0].id).toBe(DEFAULT_VOICE_ID);
  for (const id of [
    DEFAULT_VOICE_ID,
    'en_US-ljspeech-high',
    'en_GB-cori-high',
    'sv_SE-nst-medium',
  ]) {
    expect(normalizeVoiceId(id)).toBe(id);
    expect(() => assertVoiceId(id)).not.toThrow();
  }
  expect(normalizeVoiceId(undefined)).toBe(DEFAULT_VOICE_ID);
  expect(normalizeVoiceId('en_US-invented-high+')).toBe(DEFAULT_VOICE_ID);
  expect(() => assertVoiceId('en_US-invented-high+')).toThrow(/supported presentation voice/);
  expect(new Set(VOICES.map((voice) => voice.id)).size).toBe(VOICES.length);
  expect(VOICES.every((voice) => ['medium', 'high'].includes(voice.quality))).toBe(true);
  expect(VOICES.every((voice) => !voice.label.includes('high+'))).toBe(true);
});

it.each(VOICES)('matches the pinned upstream config and LFS metadata for $id', (voice) => {
  // These small raw configs and API projections come from the exact upstream
  // commit, not generated or downloaded during tests. No voice weights enter CI.
  const record = upstream.voices[voice.id];
  const raw = readFileSync(resolve(fixtures, `${voice.id}.config`));
  const config = JSON.parse(raw.toString('utf8'));
  expect(MODEL_REVISION).toBe(upstream.revision);
  expect(voice.path).toBe(record.model.path);
  expect(voice.modelBytes).toBe(record.model.bytes);
  expect(voice.modelSha256).toBe(record.model.lfsSha256);
  expect(voice.configBytes).toBe(raw.byteLength);
  expect(voice.configBytes).toBe(record.config.bytes);
  expect(voice.configSha256).toBe(sha256(raw));
  expect(voice.language).toBe(record.language);
  expect(voice.quality).toBe(record.quality);
  expect(voice.quality).toBe(config.audio.quality);
  expect(voice.sampleRate).toBe(config.audio.sample_rate);
  expect(voice.speakerCount).toBe(config.num_speakers);
  expect(voice.speakerId).toBe(0);
  expect(config.phoneme_type ?? 'espeak').toBe('espeak');
  expect(typeof config.espeak.voice).toBe('string');
  expect(config.espeak.voice.length).toBeGreaterThan(0);
  if (config.num_speakers > 1) {
    expect(Object.values(config.speaker_id_map)).toContain(voice.speakerId);
    expect(voice.label).toContain('speaker 0');
  }
  const card = new URL(voice.source);
  expect(card.origin).toBe('https://huggingface.co');
  expect(decodeURI(card.pathname)).toBe(
    `/rhasspy/piper-voices/resolve/${MODEL_REVISION}/${record.modelCard.path}`,
  );
  for (const withConfig of [false, true]) {
    const url = new URL(modelUrl(voice, withConfig));
    expect(url.origin).toBe('https://huggingface.co');
    expect(url.pathname).toContain(`/resolve/${MODEL_REVISION}/`);
    expect(decodeURI(url.pathname)).toBe(
      `/rhasspy/piper-voices/resolve/${MODEL_REVISION}/${voice.path}${withConfig ? '.json' : ''}`,
    );
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    expect(url.username).toBe('');
    expect(url.password).toBe('');
  }
});

it('offers verified regional choices and speaks preview text in their own language', () => {
  expect(new Set(VOICES.map((voice) => voice.language))).toEqual(
    new Set([
      'en-GB',
      'en-US',
      'sv-SE',
      'fr-FR',
      'es-ES',
      'pt-PT',
      'pt-BR',
      'no-NO',
      'da-DK',
      'fi-FI',
      'de-DE',
    ]),
  );
  expect(voiceSample('fr_FR-siwis-medium')).toContain('Bienvenue');
  expect(voiceSample('es_ES-davefx-medium')).toContain('Bienvenido');
  expect(voiceSample('pt_PT-tugão-medium')).toContain('Bem-vindo');
  expect(modelUrl(voiceInfo('pt_PT-tugão-medium'))).toContain('tug%C3%A3o');
  expect(voiceSample('no_NO-talesyntese-medium')).toContain('Velkommen');
  expect(voiceSample('da_DK-talesyntese-medium')).toContain('gennemgår');
  expect(voiceSample('fi_FI-harri-medium')).toContain('Tervetuloa');
  expect(voiceSample('de_DE-thorsten-high')).toContain('Willkommen');
  for (const voice of VOICES) expect(voiceSample(voice.id).length).toBeGreaterThan(20);
});

it('keeps source attribution and excludes unsupported preprocessing or restrictive candidates', () => {
  expect(voiceInfo('en_GB-jenny_dioco-medium').label).toContain('Jenny (Dioco)');
  expect(voiceInfo('en_GB-jenny_dioco-medium').label).toContain('Irish');
  expect(voiceInfo('en_GB-northern_english_male-medium').license).toContain('CC BY-SA 4.0');
  expect(voiceInfo('fr_FR-siwis-medium').license).toContain('CC BY 4.0');
  expect(voiceInfo('en_US-libritts-high').speakerCount).toBe(904);
  expect(voiceInfo('en_US-libritts-high').modelBytes).toBe(136673811);
  for (const id of [
    'ja_JP-hi_fi_captain-medium',
    'zh_CN-xiao_ya-medium',
    'zh_CN-chaowen-medium',
    'zh_CN-huayan-medium',
    'en_US-ryan-high',
    'en_US-lessac-high',
    'en_US-hfc_male-medium',
    'en_US-hfc_female-medium',
  ])
    expect(() => assertVoiceId(id)).toThrow();
});
