import { workspace } from './workspace';
import { download } from '../export/semantic';
export async function exportAllData() {
  const backup = await workspace.backup();
  const date = backup.exportedAt!.slice(0, 10);
  download(`visual-nerve-backup-${date}.json`, JSON.stringify(backup, null, 2));
  await workspace.setPreference('last-export', backup.exportedAt);
}
