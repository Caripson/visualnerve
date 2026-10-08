import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import { Workspace } from '../src/storage/workspace';
import { Repository } from '../src/storage/repository';
import { VOICE_CHANGED } from '../src/presentation/speech/voice-events';
import { useEditor } from '../src/state/editor';

let db: WorkspaceDatabase, workspace: Workspace;
let changed: ReturnType<typeof vi.fn<(event: Event) => void>>;
beforeEach(async () => {
  db = new WorkspaceDatabase(`voice-invalidation-${crypto.randomUUID()}`);
  workspace = new Workspace(new Repository(db));
  await db.initialize();
  await db.settings.bulkPut([
    { key: 'storage-consent', value: true },
    { key: 'mcp-access', value: 'write' },
  ]);
  useEditor.setState({ privacyAcknowledged: true, mcpAccess: 'write' });
  await workspace.refresh();
  changed = vi.fn<(event: Event) => void>();
  window.addEventListener(VOICE_CHANGED, changed);
});
afterEach(async () => {
  window.removeEventListener(VOICE_CHANGED, changed);
  workspace.stop();
  await db.delete();
  useEditor.setState({ privacyAcknowledged: false, mcpAccess: 'off' });
});

it('invalidates prepared narration after a committed Settings choice, not unrelated or rejected choices', async () => {
  await workspace.setPreference('presentation-voice', 'fr_FR-siwis-medium');
  expect(changed).toHaveBeenCalledOnce();
  expect((await db.settings.get('presentation-voice'))?.value).toBe('fr_FR-siwis-medium');
  await workspace.setPreference('presentation-voice', 'fr_FR-siwis-medium');
  await workspace.setPreference('theme', 'dark');
  await expect(workspace.setPreference('presentation-voice', 'unknown')).rejects.toMatchObject({
    status: 422,
  });
  expect(changed).toHaveBeenCalledOnce();
});

it('invalidates the same player after programmatic or other-tab changes', async () => {
  await workspace.external('/settings/presentation-voice', 'PUT', { value: 'de_DE-thorsten-high' });
  expect(changed).toHaveBeenCalledOnce();
  await db.settings.put({ key: 'presentation-voice', value: 'fi_FI-harri-medium' });
  await workspace.refresh();
  expect(changed).toHaveBeenCalledTimes(2);
  expect(await workspace.external('/settings/presentation-voice', 'GET')).toBe(
    'fi_FI-harri-medium',
  );
});

it('does not invalidate a prepared tour when persistence consent rejects the change', async () => {
  await db.settings.put({ key: 'storage-consent', value: false });
  await expect(
    workspace.setPreference('presentation-voice', 'fr_FR-siwis-medium'),
  ).rejects.toMatchObject({ status: 403 });
  expect(changed).not.toHaveBeenCalled();
  expect(await db.settings.get('presentation-voice')).toBeUndefined();
});
