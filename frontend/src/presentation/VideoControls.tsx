import { presentationMessage } from './display-messages';
import { useI18n } from '../i18n';
import { Film, Download, X } from 'lucide-react';
import { startVideo, videoExport, useVideoExport, saveVideo } from './video-service';
import { videoActive } from './video-types';
import { useState } from 'react';

export function VideoControls({ disabled }: { disabled: boolean }) {
  const { t } = useI18n();
  const video = useVideoExport();
  const active = videoActive(video);
  const [error, setError] = useState('');
  return (
    <div className="presentation-video">
      <div className="presentation-controls">
        {active ? (
          <button
            onClick={() => videoExport.cancel()}
            aria-label={t('presentation.videoCancelAria')}
          >
            <X size={16} /> {t('presentation.videoCancel')}
          </button>
        ) : (
          <button
            disabled={disabled || videoExport.isBusy()}
            aria-label={t('presentation.videoExportAria')}
            onClick={() => {
              try {
                setError('');
                startVideo({});
              } catch (value) {
                setError((value as Error).message);
              }
            }}
          >
            <Film size={16} /> {t('presentation.videoExport')}
          </button>
        )}
        {video.status === 'complete' && (
          <button onClick={saveVideo}>
            <Download size={16} /> {t('presentation.videoSaveAgain')}
          </button>
        )}
        <small className="muted">{t('presentation.videoFormatHint')}</small>
      </div>
      {active && (
        <progress aria-label={t('presentation.videoProgressAria')} max={1} value={video.progress} />
      )}
      {(error || video.message) && (
        <p
          className="presentation-message"
          role={error || video.status === 'error' ? 'alert' : 'status'}
        >
          {presentationMessage(error || video.message, t)}
        </p>
      )}
      <small className="muted">{t('presentation.videoLimitsHint')}</small>
    </div>
  );
}
