import { liveQuery } from 'dexie';
import { useEffect, useRef, useState } from 'react';
import { database } from '../storage/database';
import { workspace } from '../storage/workspace';
import { speechService } from '../presentation/speech/service';
import type { SpeechProgress } from '../presentation/speech/protocol';
import {
  DEFAULT_VOICE_ID,
  normalizeVoiceId,
  VOICES,
  VOICE_SETTING,
  voiceInfo,
  voiceSample,
  type VoiceId,
} from '../presentation/speech/voices';

export function VoiceSettings() {
  const [active, setActive] = useState<VoiceId>(DEFAULT_VOICE_ID);
  const [draft, setDraft] = useState<VoiceId>(DEFAULT_VOICE_ID);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [progress, setProgress] = useState<SpeechProgress>();
  const [cached, setCached] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const preview = useRef<{ controller: AbortController; audio?: HTMLAudioElement; url?: string }>(
    undefined,
  );
  const mounted = useRef(true);
  const dirty = useRef(false);
  const voice = voiceInfo(draft);

  function stopPreview() {
    const current = preview.current;
    preview.current = undefined;
    current?.controller.abort();
    current?.audio?.pause();
    if (current?.url) URL.revokeObjectURL(current.url);
    if (mounted.current) {
      setPreviewing(false);
      setProgress(undefined);
    }
  }
  useEffect(() => {
    mounted.current = true;
    const subscription = liveQuery(() => database.settings.get(VOICE_SETTING)).subscribe({
      next: (record) => {
        const value = normalizeVoiceId(record?.value);
        setActive(value);
        if (!dirty.current) setDraft(value);
      },
      error: () => undefined,
    });
    void speechService.cachedVoices().then((value) => {
      if (mounted.current) setCached(value);
    });
    return () => {
      mounted.current = false;
      subscription.unsubscribe();
      stopPreview();
    };
  }, []);

  async function save() {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await workspace.setPreference(VOICE_SETTING, draft);
      if (mounted.current) {
        dirty.current = false;
        setActive(draft);
        setMessage('Presentation voice saved for this browser.');
      }
    } catch (error) {
      if (mounted.current) setError((error as Error).message);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  async function playPreview() {
    stopPreview();
    setError('');
    setMessage('');
    setPreviewing(true);
    const current = { controller: new AbortController() } as NonNullable<typeof preview.current>;
    preview.current = current;
    try {
      const blob = await speechService.prepare(
        voiceSample(draft),
        draft,
        current.controller.signal,
        (value) => {
          if (preview.current === current) setProgress(value);
        },
      );
      if (preview.current !== current) return;
      current.url = URL.createObjectURL(blob);
      current.audio = new Audio(current.url);
      current.audio.onended = () => {
        if (preview.current === current) stopPreview();
      };
      await current.audio.play();
      if (mounted.current && preview.current === current) {
        setProgress(undefined);
        setCached(await speechService.cachedVoices());
      }
    } catch (error) {
      if (preview.current !== current) return;
      stopPreview();
      if ((error as Error).name !== 'AbortError' && mounted.current)
        setError((error as Error).message);
    }
  }
  async function clearModels() {
    stopPreview();
    setError('');
    setMessage('');
    try {
      await speechService.clearCache();
      if (mounted.current) {
        setCached([]);
        setMessage('Downloaded voice models cleared from this browser.');
      }
    } catch (error) {
      if (mounted.current) setError((error as Error).message);
    }
  }

  return (
    <section className="voice-settings" aria-label="Presentation voice settings">
      <div className="property-section">Presentation voice</div>
      <label className="field">
        <span>Narration voice</span>
        <select
          aria-label="Narration voice"
          value={draft}
          disabled={saving || previewing}
          onChange={(event) => {
            dirty.current = event.target.value !== active;
            setDraft(event.target.value as VoiceId);
            setError('');
            setMessage('');
          }}
        >
          {VOICES.map((item) => (
            <option value={item.id} key={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        English is the default. Neural speech runs locally in your browser; descriptions are never
        sent to a speech service.
      </p>
      <p className="muted">
        {cached.includes(draft)
          ? 'Voice downloaded and available offline.'
          : `First audio playback or preload downloads this voice model (${Math.ceil(voice.modelBytes / 1024 / 1024)} MB) from Hugging Face.`}{' '}
        Runtime files load from this website. Downloads can be cancelled; browser storage may be
        reclaimed.
      </p>
      <p className="muted">
        {voice.license}.{' '}
        <a href={voice.source} target="_blank" rel="noreferrer">
          Voice source and license
        </a>
      </p>
      <div className="storage-actions">
        <button type="button" disabled={saving || draft === active} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save voice'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => (previewing ? stopPreview() : void playPreview())}
        >
          {previewing ? 'Cancel voice preview' : 'Preview voice'}
        </button>
        <button type="button" disabled={saving || previewing} onClick={() => void clearModels()}>
          Clear downloaded voices
        </button>
      </div>
      {progress && (
        <p role="status">
          {progress.message}
          {progress.total > 0 ? ` ${Math.round((progress.loaded / progress.total) * 100)}%` : ''}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="settings-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
