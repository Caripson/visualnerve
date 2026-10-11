import { workspaceStorage } from '../storage/runtime';
import { workspace } from '../storage/workspace';
import { instantiate } from './templates';

/** Template creation is shared by the normal dialog and public example links. */
export async function createTemplateDiagram(
  template: string,
  name: string,
  mode: 'example' | 'import' = 'example',
) {
  const operation = await workspaceStorage.captureOperation();
  try {
    const stored = await operation.storage.templates.get(template);
    await operation.check();
    const graph = instantiate(template, name.trim(), stored?.graph);
    if (template === 'time-series-analysis' && mode === 'example' && stored?.builtin !== false) {
      const { createAnalyticsExample } = await import('../analytics/example');
      const { remapAnalytics } = await import('../analytics/remap');
      graph.diagram.analytics = remapAnalytics(await createAnalyticsExample(operation.signal));
    }
    await operation.check();
    await workspace.create(graph, operation);
  } finally {
    operation.dispose();
  }
}
