import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { voiceCatalog } from '../src/presentation/service';
import { speechService } from '../src/presentation/speech/service';
import { VOICES, DEFAULT_VOICE_ID } from '../src/presentation/speech/voices';
import { presentationVoiceIds, isPresentationVoiceId } from '../src/presentation/types';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { useEditor } from '../src/state/editor';

afterEach(() => vi.restoreAllMocks());

it('exposes every selectable voice with accurate semantic locale, tier and fixed speaker', () => {
  const catalog = voiceCatalog();
  expect(catalog.defaultVoiceId).toBe(DEFAULT_VOICE_ID);
  expect(catalog.voices.map((voice) => voice.id)).toEqual(presentationVoiceIds);
  for (const model of VOICES) {
    expect(isPresentationVoiceId(model.id)).toBe(true);
    expect(catalog.voices.find((voice) => voice.id === model.id)).toMatchObject({
      language: model.language.split('-')[0],
      locale: model.language,
      quality: model.quality,
      speakerId: model.speakerId,
      speakerCount: model.speakerCount,
      modelBytes: model.modelBytes,
    });
  }
  expect(isPresentationVoiceId('unknown-voice-high+')).toBe(false);
});

it('keeps the committed OpenAPI voice enum and metadata aligned with UI/API discovery', () => {
  const schema = JSON.parse(readFileSync('../docs/openapi.yaml', 'utf8')).components.schemas;
  expect(schema.PresentationVoiceId.enum).toEqual(presentationVoiceIds);
  expect(schema.PresentationVoiceId.default).toBe(DEFAULT_VOICE_ID);
  const catalog = voiceCatalog();
  expect(new Set(schema.PresentationVoice.properties.locale.enum)).toEqual(
    new Set(catalog.voices.map((voice) => voice.locale)),
  );
  expect(new Set(schema.PresentationVoice.properties.language.enum)).toEqual(
    new Set(catalog.voices.map((voice) => voice.language)),
  );
  expect(schema.PresentationVoice.properties.quality.enum).toEqual(['medium', 'high']);
});

it('selects and reads all catalog voices through the authoritative API without downloading', async () => {
  const db = new WorkspaceDatabase(`voice-api-${crypto.randomUUID()}`);
  const workspace = new Workspace(new Repository(db));
  const prepare = vi.spyOn(speechService, 'prepare');
  try {
    await db.initialize();
    await db.settings.bulkPut([
      { key: 'storage-consent', value: true },
      { key: 'mcp-access', value: 'write' },
    ]);
    useEditor.setState({ privacyAcknowledged: true, mcpAccess: 'write' });
    for (const voice of VOICES) {
      await workspace.external('/settings/presentation-voice', 'PUT', { value: voice.id });
      expect(await workspace.external('/settings/presentation-voice', 'GET')).toBe(voice.id);
      expect((await db.settings.get('presentation-voice'))?.value).toBe(voice.id);
    }
    await expect(
      workspace.external('/settings/presentation-voice', 'PUT', { value: 'unknown-voice' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(prepare).not.toHaveBeenCalled();
  } finally {
    workspace.stop();
    await db.delete();
    useEditor.setState({ privacyAcknowledged: false, mcpAccess: 'off' });
  }
});
