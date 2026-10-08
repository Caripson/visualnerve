import { useState } from 'react';
import { useEditor } from '../state/editor';
import { workspace, type Workspace } from '../storage/workspace';

/** Setting writes and diagram autosaves have independent acknowledgements. */
export function PreferenceSaveNotice({
  settings,
  controller = workspace,
}: {
  settings: () => void;
  controller?: Pick<Workspace, 'retryPreference'>;
}) {
  const error = useEditor((state) => state.preferenceError);
  const [saving, setSaving] = useState(false);
  if (!error) return null;
  return (
    <div className="notice error-notice" role="alert">
      <span>Settings could not be saved: {error.message}</span>
      <button
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try {
            await controller.retryPreference(error.key);
          } catch {
            // The workspace retains this failure, or a newer one, for retry.
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? 'Saving…' : 'Retry save'}
      </button>
      <button onClick={settings}>Settings</button>
    </div>
  );
}
