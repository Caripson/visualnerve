import { afterEach, beforeEach, expect, it } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { blankGraph, newNode, type Graph } from '../src/model/types';
import { emptyPresentation } from '../src/presentation/types';
import { autoNumber, getPresentation } from '../src/presentation/definition';
import { DEFAULT_VOICE_ID, VOICES } from '../src/presentation/speech/voices';

let db: WorkspaceDatabase, repo: Repository, graph: Graph;
beforeEach(async () => {
  db = new WorkspaceDatabase(`presentation-${crypto.randomUUID()}`);
  repo = new Repository(db);
  await db.initialize();
  const source = blankGraph('Walkthrough');
  source.nodes = ['First', 'Second'].map((title) => newNode(source.diagram.id, { title }));
  graph = await repo.saveGraph(source, 0);
});
afterEach(async () => {
  await db.delete();
});
it('returns empty defaults and commits ordered timings at the current aggregate version', async () => {
  const path = `/diagrams/${graph.diagram.id}/presentation`;
  expect(await repo.request(path)).toEqual(emptyPresentation());
  const presentation = {
    version: 1 as const,
    nodeIds: graph.nodes.map((node) => node.id).reverse(),
    secondsPerNode: 12,
    transitionMs: 700,
  };
  const saved = await repo.request<Graph>(path, 'PUT', {
    baseVersion: graph.diagram.version,
    presentation,
  });
  expect(saved.diagram.version).toBe(graph.diagram.version + 1);
  expect(await repo.request(path)).toEqual(presentation);
  await expect(
    repo.request(path, 'PUT', { baseVersion: graph.diagram.version, presentation }),
  ).rejects.toMatchObject({ status: 409 });
  db.close();
  await db.open();
  expect(getPresentation(await repo.getGraph(graph.diagram.id))).toEqual(presentation);
});
it('rejects unsupported fields and missing node refs without partial writes', async () => {
  const path = `/diagrams/${graph.diagram.id}/presentation`;
  for (const body of [
    { baseVersion: 1, presentation: emptyPresentation(), surprise: true },
    { baseVersion: 1, presentation: { ...emptyPresentation(), nodeIds: [crypto.randomUUID()] } },
    {
      baseVersion: 1,
      presentation: {
        ...emptyPresentation(),
        nodeIds: graph.nodes.map((node) => node.id),
        unknown: true,
      },
    },
  ])
    await expect(repo.request(path, 'PUT', body)).rejects.toMatchObject({ status: 422 });
  expect(await repo.getGraph(graph.diagram.id)).toEqual(graph);
  await expect(repo.request(`${path}/extra`)).rejects.toMatchObject({ status: 404 });
});
it('remaps collision imports and prunes a deleted node while retaining contiguous order', async () => {
  graph = await repo.saveGraph(autoNumber(graph), graph.diagram.version);
  const imported = await repo.importGraph(graph);
  expect(imported.diagram.id).not.toBe(graph.diagram.id);
  expect(getPresentation(imported).nodeIds).toEqual(imported.nodes.map((node) => node.id));
  expect(getPresentation(imported).nodeIds).not.toEqual(getPresentation(graph).nodeIds);
  await repo.request(`/nodes/${graph.nodes[0].id}`, 'DELETE');
  const remaining = await repo.getGraph(graph.diagram.id);
  expect(getPresentation(remaining).nodeIds).toEqual([graph.nodes[1].id]);
  expect(getPresentation(await repo.getGraph(imported.diagram.id)).nodeIds).toHaveLength(2);
});
it('uses a catalogued voice default and rejects invalid preference values', async () => {
  expect(await repo.request('/settings/presentation-voice')).toBe('en_GB-alan-medium');
  await repo.request('/settings/presentation-voice', 'PUT', { value: 'sv_SE-nst-medium' });
  expect(await repo.request('/settings/presentation-voice')).toBe('sv_SE-nst-medium');
  await expect(
    repo.request('/settings/presentation-voice', 'PUT', { value: 'remote', extra: true }),
  ).rejects.toMatchObject({ status: 422 });
  expect(await repo.request('/settings/presentation-voice')).toBe('sv_SE-nst-medium');
});
it('keeps every explicit voice choice across reopen rather than replacing it with the new default', async () => {
  expect(DEFAULT_VOICE_ID).toBe('en_GB-alan-medium');
  for (const voice of VOICES) {
    await repo.request('/settings/presentation-voice', 'PUT', { value: voice.id });
    db.close();
    await db.open();
    expect(await repo.request('/settings/presentation-voice')).toBe(voice.id);
  }
});
