import { workspaceStorage } from '../storage/runtime';
import { workspace } from '../storage/workspace';
import { prepareTemplateFactory } from './factory';

/** Template creation is shared by the normal dialog and public example links. */
export async function createTemplateDiagram(
  template: string,
  name: string,
  mode: 'example' | 'import' | 'empty' | 'adventure' = 'example',
) {
  const operation = await workspaceStorage.captureOperation();
  try {
    const stored = await operation.storage.templates.get(template);
    await operation.check();
    const instantiate = await prepareTemplateFactory();
    await operation.check();
    const graph = instantiate(template, name.trim(), stored?.graph);
    if (
      template === 'roblox-game-builder' &&
      stored?.builtin !== false &&
      (mode === 'empty' || mode === 'adventure')
    ) {
      const { createRobloxEmptyGame, createRobloxAdventureGame } =
        await import('../roblox/starter');
      const { setGameDefinition } = await import('../roblox/document');
      const { GameIdentityCopy } = await import('../roblox/copy');
      const game = mode === 'empty' ? createRobloxEmptyGame() : createRobloxAdventureGame();
      Object.assign(
        graph,
        setGameDefinition(
          { ...graph, nodes: [], edges: [] },
          new GameIdentityCopy({ ...game, name: name.trim() }).model(),
        ),
      );
    }
    if (
      template === 'roblox-game-builder' &&
      stored?.builtin !== false &&
      graph.diagram.game &&
      graph.diagram.game.name !== name.trim()
    ) {
      const { setGameDefinition } = await import('../roblox/document');
      Object.assign(graph, setGameDefinition(graph, { ...graph.diagram.game, name: name.trim() }));
    }
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
