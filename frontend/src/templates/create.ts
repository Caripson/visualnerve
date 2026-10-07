import { database } from '../storage/database';
import { workspace } from '../storage/workspace';
import { instantiate } from './templates';

/** Template creation is shared by the normal dialog and public example links. */
export async function createTemplateDiagram(template: string, name: string) {
  const stored = await database.templates.get(template);
  await workspace.create(instantiate(template, name.trim(), stored?.graph));
}
