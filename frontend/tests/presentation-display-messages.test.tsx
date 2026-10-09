import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import english from '../src/i18n/catalogs/en';
import german from '../src/i18n/catalogs/de';
import swedish from '../src/i18n/catalogs/sv';
import { MessageFormatter } from '../src/i18n/message-formatter';
import { presentationMessage } from '../src/presentation/display-messages';
import { voiceDisplayLabel, voiceLabelKeys } from '../src/presentation/voice-labels';
import { VOICES, voiceSample } from '../src/presentation/speech/voices';

const en = new MessageFormatter('en', english);
const de = new MessageFormatter('de', german);
const sv = new MessageFormatter('sv', swedish);

describe('presentation diagnostics are localized only at the display boundary', () => {
  it('preserves canonical preload classification and nested speech progress while translating display', () => {
    const canonical = 'Preload 87% · 4/5 steps ready · Preparing narration chunk 2 of 3… 50% (12s)';
    expect(presentationMessage(canonical, en.t)).toBe(canonical);
    const translated = presentationMessage(canonical, de.t);
    expect(translated).toContain(
      de.t('presentation.preloadStatus', {
        percent: 87,
        completed: 4,
        total: 5,
        detail: de.t('voice.composedProgress', {
          detail: de.t('voice.preparingChunk', { current: 2, total: 3 }),
          percentSuffix: de.t('voice.progressPercentSuffix', { percent: 50 }),
          elapsedSuffix: de.t('voice.progressSecondsSuffix', { seconds: 12 }),
        }),
      }),
    );
    expect(translated).not.toBe(canonical);
    expect(canonical.startsWith('Preload ')).toBe(true);
  });

  it('recognizes completed preload only when repeated totals actually agree', () => {
    expect(presentationMessage('Preload 100% · 35/35 steps ready.', sv.t)).toBe(
      sv.t('presentation.fullPreloadReady', { total: 35 }),
    );
    const inconsistent = 'Preload 100% · 35/36 steps ready.';
    expect(presentationMessage(inconsistent, sv.t)).toBe(inconsistent);
  });

  it('translates known failure causes while keeping unknown browser/private details escaped and verbatim', () => {
    expect(
      presentationMessage('Preload failed: The voice download was incomplete. Try again.', sv.t),
    ).toBe(sv.t('presentation.preloadFailed', { error: sv.t('voice.downloadIncomplete') }));
    const detail = '<img src=x onerror=alert(1)> {percent} private-file.sql';
    const output = presentationMessage(`Preload failed: ${detail}`, de.t);
    render(<p role="alert">{output}</p>);
    expect(screen.getByRole('alert')).toHaveTextContent(detail);
    expect(screen.getByRole('alert').querySelector('img')).toBeNull();
    expect(output).toContain('{percent}');
  });

  it('does not infer translations from partial matches, malformed counters or arbitrary application text', () => {
    for (const message of [
      'My note says Audio changed. Press Play to continue.',
      'Preload 50% · ten/20 steps ready · Narration ready.',
      'The voice download failed (1e309). Try again when online.',
      'Narration ready. extra text',
      'x'.repeat(20_000),
    ])
      expect(presentationMessage(message, de.t)).toBe(message);
  });

  it('renders genuine zero-percent progress and known image-export errors without altering producers', () => {
    expect(presentationMessage('Initializing the local voice session… 0% (2s)', sv.t)).toBe(
      sv.t('voice.composedProgress', {
        detail: sv.t('voice.initializingSession'),
        percentSuffix: sv.t('voice.progressPercentSuffix', { percent: 0 }),
        elapsedSuffix: sv.t('voice.progressSecondsSuffix', { seconds: 2 }),
      }),
    );
    const error = 'Graph rendering took too long. Try a smaller selection.';
    expect(presentationMessage(error, en.t)).toBe(error);
    expect(presentationMessage(error, de.t)).toBe(de.t('dialogs.renderTimeout'));
  });

  it('keeps names in video progress as literal parameters, including braces and newlines', () => {
    const name = 'A {total}\nprivate node';
    expect(presentationMessage(`Exporting 2 / 3: ${name}`, de.t)).toBe(
      de.t('presentation.videoExportingStep', { current: 2, total: 3, name }),
    );
  });
});

it('localizes all twenty voice descriptions without changing voice IDs, samples, quality or default metadata', () => {
  const before = structuredClone(VOICES);
  const samples = VOICES.map((voice) => voiceSample(voice.id));
  expect(Object.keys(voiceLabelKeys)).toEqual(VOICES.map((voice) => voice.id));
  for (const voice of VOICES) {
    expect(voiceDisplayLabel(voice.id, en.t)).toBe(voice.label);
    expect(voiceDisplayLabel(voice.id, de.t)).not.toBe('');
  }
  expect(VOICES).toEqual(before);
  expect(VOICES.map((voice) => voiceSample(voice.id))).toEqual(samples);
  expect(presentationMessage(`Cached ${VOICES[0].label}`, de.t)).toBe(
    de.t('voice.cachedModel', { voice: voiceDisplayLabel(VOICES[0].id, de.t) }),
  );
});
