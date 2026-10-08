import { workspace } from '../storage/workspace';
import { useEffect, useState } from 'react';
import { useEditor } from '../state/editor';
import { PRESENTATION_FOCUS, presentationFocus, presentationArrived } from '../presentation/camera';

/** Browsers retain a failed module import until reload. Settle local edits first. */
export function SpatialLoadFailure({
  onReturnTo2D,
  onReload = () => window.location.reload(),
}: {
  onReturnTo2D(): void;
  onReload?: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const focus = (event: Event) => {
      const request = presentationFocus(event);
      if (request)
        presentationArrived(request, 'The 3D view could not be loaded. Return to 2D to play.');
    };
    window.addEventListener(PRESENTATION_FOCUS, focus);
    return () => window.removeEventListener(PRESENTATION_FOCUS, focus);
  }, []);
  const retry = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      useEditor.getState().finishEditing();
      await workspace.settled();
      onReload();
    } catch (error) {
      setError(
        `Could not save your changes before reloading. ${error instanceof Error ? error.message : String(error)}`,
      );
      setSaving(false);
    }
  };
  return (
    <div className="canvas-shell spatial-canvas">
      <div className="spatial-load-failure">
        <p role="status">The 3D view could not be loaded. Continue editing in 2D.</p>
        <p>After your connection recovers, reload this tab to retry 3D.</p>
        <button onClick={onReturnTo2D}>Return to 2D</button>
        <button disabled={saving} onClick={() => void retry()}>
          {saving ? 'Saving before reload…' : 'Reload to retry 3D'}
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  );
}
