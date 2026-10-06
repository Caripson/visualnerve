import { Film, Download, X } from 'lucide-react';
import { startVideo, videoExport, useVideoExport, saveVideo } from './video-service';
import { videoActive } from './video-types';
import { useState } from 'react';

export function VideoControls({ disabled }: { disabled: boolean }) {
  const video = useVideoExport();
  const active = videoActive(video);
  const [error, setError] = useState('');
  return (
    <div className="presentation-video">
      <div className="presentation-controls">
        {active ? (
          <button onClick={() => videoExport.cancel()} aria-label="Cancel video export">
            <X size={16} /> Cancel video
          </button>
        ) : (
          <button
            disabled={disabled || videoExport.isBusy()}
            aria-label="Export walkthrough video"
            onClick={() => {
              try {
                setError('');
                startVideo({});
              } catch (value) {
                setError((value as Error).message);
              }
            }}
          >
            <Film size={16} /> Export video
          </button>
        )}
        {video.status === 'complete' && (
          <button onClick={saveVideo}>
            <Download size={16} /> Save video again
          </button>
        )}
        <small className="muted">
          720p · 30 fps · MP4 when supported · current audio/text settings
        </small>
      </div>
      {active && <progress aria-label="Video export progress" max={1} value={video.progress} />}
      {(error || video.message) && (
        <p
          className="presentation-message"
          role={error || video.status === 'error' ? 'alert' : 'status'}
        >
          {error || video.message}
        </p>
      )}
      <small className="muted">
        Keep this tab visible. Up to 30 minutes / 256 MiB. WebM is used if MP4 encoding is
        unavailable.
      </small>
    </div>
  );
}
