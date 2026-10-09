import { voiceDisplayLabel } from '../presentation/voice-labels';
import { presentationMessage } from '../presentation/display-messages';
import { useI18n } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { workspaceStorage } from '../storage/runtime';
import { workspace } from '../storage/workspace';
import { speechService } from '../presentation/speech/service';
import { Narrator } from '../presentation/narrator';
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
  const { t } = useI18n();
  const [active, setActive] = useState<VoiceId>(DEFAULT_VOICE_ID);
  const [draft, setDraft] = useState<VoiceId>(DEFAULT_VOICE_ID);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [progress, setProgress] = useState<SpeechProgress>();
  const [cached, setCached] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const preview = useRef<{ controller: AbortController; player: Narrator }>(undefined);
  const mounted = useRef(true);
  const dirty = useRef(false);
  const voice = voiceInfo(draft);

  function stopPreview() {
    const current = preview.current;
    preview.current = undefined;
    current?.controller.abort();
    current?.player.dispose();
    if (mounted.current) {
      setPreviewing(false);
      setProgress(undefined);
    }
  }
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let revision = 0;
    const refresh = async () => {
      const requested = ++revision;
      try {
        const record = await workspaceStorage.settings.get(VOICE_SETTING);
        if (disposed || requested !== revision) return;
        const value = normalizeVoiceId(record?.value);
        setActive(value);
        if (!dirty.current) setDraft(value);
      } catch (error) {
        if (!disposed && requested === revision) setError((error as Error).message);
      }
    };
    const unsubscribe = workspaceStorage.subscribe((change) => {
      if (change.stores.includes('settings')) void refresh();
    });
    void refresh();
    void speechService
      .cachedVoices()
      .then((value) => {
        if (!disposed) setCached(value);
      })
      .catch((error: Error) => {
        if (!disposed) setError(error.message);
      });
    return () => {
      disposed = true;
      mounted.current = false;
      unsubscribe();
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
    const current = { controller: new AbortController(), player: new Narrator() };
    preview.current = current;
    // Start resume synchronously in the click gesture, before a cold model download can await.
    const unlocked = current.player.unlock();
    try {
      await unlocked;
      if (preview.current !== current) return;
      const blob = await speechService.prepare(
        voiceSample(draft),
        draft,
        current.controller.signal,
        (value) => {
          if (preview.current === current) setProgress(value);
        },
      );
      if (preview.current !== current) return;
      await current.player.play(blob, current.controller.signal, () => {
        if (preview.current === current) stopPreview();
      });
      if (mounted.current && preview.current === current) {
        setProgress(undefined);
        const voices = await speechService.cachedVoices();
        if (mounted.current && preview.current === current) setCached(voices);
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
    <section className="voice-settings" aria-label={t('voice.settingsRegion')}>
      <div className="property-section">{t('voice.settingsTitle')}</div>
      <label className="field">
        <span>{t('voice.narrationVoiceField')}</span>
        <select
          aria-label={t('voice.narrationVoiceField')}
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
              {voiceDisplayLabel(item.id, t)}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">{t('voice.defaultLocalHint')}</p>
      <p className="muted">
        {t('voice.qualityHint', {
          quality: t(voice.quality === 'high' ? 'voice.qualityHigh' : 'voice.qualityMedium'),
        })}
      </p>
      <p className="muted">
        {cached.includes(draft)
          ? t('voice.availableOffline')
          : t('voice.firstDownloadHint', {
              megabytes: Math.ceil(voice.modelBytes / 1024 / 1024),
            })}{' '}
        {t('voice.runtimeDownloadHint')}
      </p>
      <p className="muted">
        {voice.license}.{' '}
        <a href={voice.source} target="_blank" rel="noreferrer">
          {t('voice.sourceLicenseLink')}
        </a>
      </p>
      <div className="storage-actions">
        <button type="button" disabled={saving || draft === active} onClick={() => void save()}>
          {saving ? t('presentation.voiceSaving') : t('voice.saveAction')}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => (previewing ? stopPreview() : void playPreview())}
        >
          {previewing ? t('voice.cancelPreview') : t('voice.preview')}
        </button>
        <button type="button" disabled={saving || previewing} onClick={() => void clearModels()}>
          {t('voice.clearModelsAction')}
        </button>
      </div>
      {progress && (
        <>
          <progress
            aria-label={t('presentation.voicePreparation')}
            max={progress.total || undefined}
            value={progress.total ? progress.loaded : undefined}
          />
          <p role="status">
            {presentationMessage(progress.message, t)}
            {progress.total > 0
              ? t('voice.progressPercentSuffix', {
                  percent: Math.round((progress.loaded / progress.total) * 100),
                })
              : ''}
            {progress.elapsedMs && progress.elapsedMs >= 1000
              ? t('voice.progressSecondsSuffix', { seconds: Math.floor(progress.elapsedMs / 1000) })
              : ''}
          </p>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {presentationMessage(error, t)}
        </p>
      )}
      {message && (
        <p className="settings-message" role="status">
          {presentationMessage(message, t)}
        </p>
      )}
    </section>
  );
}
