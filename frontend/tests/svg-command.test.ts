import { afterEach, describe, expect, it, vi } from 'vitest';
import { blankGraph, newNode } from '../src/model/types';
import { exportCommand } from '../src/export/command';
import { Repository } from '../src/storage/repository';
import { WorkspaceDatabase } from '../src/storage/database';
import { assertMcpAccess } from '../src/integration/access';
const render = vi.hoisted(() =>
  vi.fn().mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"><text>native</text></svg>'),
);
vi.mock('../src/export/svg', () => ({ graphSVG: render }));
afterEach(() => vi.clearAllMocks());
function graph() {
  const graph = blankGraph('Vector export');
  graph.nodes = [newNode(graph.diagram.id, { title: 'Native text' })];
  return graph;
}
describe('read-only SVG export command', () => {
  it('retains JSON and Markdown responses and sends exact SVG scope/IDs to the lazy renderer', async () => {
    const source = graph(),
      before = structuredClone(source);
    expect(await exportCommand(source, { diagramId: source.diagram.id, format: 'json' })).toBe(
      source,
    );
    expect(
      await exportCommand(source, { diagramId: source.diagram.id, format: 'markdown' }),
    ).toContain('Native text');
    expect(await exportCommand(source, { diagramId: source.diagram.id, format: 'svg' })).toContain(
      '<svg',
    );
    expect(render).toHaveBeenLastCalledWith(source, 'complete', []);
    await exportCommand(source, {
      diagramId: source.diagram.id,
      format: 'svg',
      scope: 'selected',
      nodeIds: [source.nodes[0].id],
    });
    expect(render).toHaveBeenLastCalledWith(source, 'selected', [source.nodes[0].id]);
    expect(source).toEqual(before);
  });
  it.each([
    { format: 'png' },
    { format: ['svg'] },
    { format: 'svg', scope: null },
    { format: 'svg', scope: 'other' },
    { format: 'svg', scope: 'selected' },
    { format: 'svg', scope: 'selected', nodeIds: [] },
    { format: 'svg', scope: 'selected', nodeIds: ['unknown'] },
    { format: 'svg', nodeIds: [] },
    { format: 'json', scope: 'complete' },
    { format: 'svg', script: true },
  ])('rejects unsupported options without invoking the renderer: %j', async (input) => {
    await expect(exportCommand(graph(), input)).rejects.toMatchObject({ status: 422 });
    expect(render).not.toHaveBeenCalled();
  });
  it('rejects duplicate selected IDs and allows SVG through the exact read-only export route without database writes', async () => {
    const db = new WorkspaceDatabase(`svg-command-${crypto.randomUUID()}`),
      repo = new Repository(db);
    try {
      const source = await repo.saveGraph(graph());
      const before = await repo.getGraph(source.diagram.id);
      assertMcpAccess('read', '/export', 'POST');
      const svg = await repo.request('/export', 'POST', {
        diagramId: source.diagram.id,
        format: 'svg',
      });
      expect(svg).toContain('<svg');
      expect(await repo.getGraph(source.diagram.id)).toEqual(before);
      await expect(
        exportCommand(source, {
          format: 'svg',
          scope: 'selected',
          nodeIds: [source.nodes[0].id, source.nodes[0].id],
        }),
      ).rejects.toMatchObject({ status: 422 });
    } finally {
      db.close();
      await db.delete();
    }
  });
});
