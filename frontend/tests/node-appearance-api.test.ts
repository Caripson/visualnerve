import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { blankGraph, type Graph, type GraphNode } from '../src/model/types';
import { Repository } from '../src/storage/repository';
import { WorkspaceDatabase } from '../src/storage/database';

let database: WorkspaceDatabase;
let repo: Repository;
beforeEach(async () => {
  database = new WorkspaceDatabase(`node-appearance-api-${crypto.randomUUID()}`);
  await database.initialize();
  repo = new Repository(database);
});
afterEach(async () => database.delete());

async function fixture() {
  const graph = await repo.saveGraph(blankGraph('Independent node fills', 'flowchart'), 0);
  const node = await repo.request<GraphNode>(`/diagrams/${graph.diagram.id}/nodes`, 'POST', {
    title: 'Reusable process',
    nodeType: 'process',
    externalId: 'order-check',
    color: '#567890',
    backgroundColor: '#aB12Ef',
    flowchartSymbol: 'ibm-predefined-process',
    metadata: { icon: 'check' },
  });
  return { diagramId: graph.diagram.id, node };
}

describe('node background color command contract', () => {
  it('preserves independent fields across partial edits, children, upserts and reset', async () => {
    const { diagramId, node } = await fixture();
    expect(node.backgroundColor).toBe('#aB12Ef');
    const child = await repo.request<GraphNode>(`/nodes/${node.id}/children`, 'POST', {
      title: 'Child',
      backgroundColor: '#000000',
    });
    expect(child).toMatchObject({ parentId: node.id, backgroundColor: '#000000' });
    const moved = await repo.request<GraphNode>(`/nodes/${node.id}`, 'PATCH', {
      version: node.version,
      x: 450,
      title: 'Renamed directly',
    });
    expect(moved).toMatchObject({
      id: node.id,
      backgroundColor: '#aB12Ef',
      color: '#567890',
      nodeType: 'process',
      flowchartSymbol: 'ibm-predefined-process',
      title: 'Renamed directly',
      metadata: node.metadata,
    });
    const cleared = await repo.request<GraphNode>(`/nodes/${node.id}`, 'PATCH', {
      version: moved.version,
      backgroundColor: null,
    });
    expect(Object.hasOwn(cleared, 'backgroundColor')).toBe(false);
    expect(cleared).toMatchObject({
      color: node.color,
      nodeType: node.nodeType,
      flowchartSymbol: node.flowchartSymbol,
      title: moved.title,
      metadata: node.metadata,
    });
    let graph = await repo.getGraph(diagramId);
    graph = await repo.request<Graph>(`/diagrams/${diagramId}/bulk`, 'POST', {
      upsert: true,
      baseVersion: graph.diagram.version,
      nodes: [
        { id: node.id, externalId: node.externalId, backgroundColor: '#000001' },
        { externalId: 'fresh', title: 'New bulk node', backgroundColor: '#FFFFFF' },
      ],
    });
    expect(graph.nodes.find((item) => item.id === node.id)?.backgroundColor).toBe('#000001');
    graph = await repo.request<Graph>(`/diagrams/${diagramId}/bulk`, 'POST', {
      upsert: true,
      baseVersion: graph.diagram.version,
      nodes: [{ externalId: node.externalId, description: 'Unrelated partial edit' }],
    });
    expect(graph.nodes.find((item) => item.id === node.id)?.backgroundColor).toBe('#000001');
    graph = await repo.request<Graph>(`/diagrams/${diagramId}/bulk`, 'POST', {
      upsert: true,
      baseVersion: graph.diagram.version,
      nodes: [{ externalId: node.externalId, backgroundColor: null }],
    });
    expect(Object.hasOwn(graph.nodes.find((item) => item.id === node.id)!, 'backgroundColor')).toBe(
      false,
    );
  });

  it('rejects invalid fills and identity collisions atomically with structured validation', async () => {
    const { diagramId, node } = await fixture();
    const original = await repo.getGraph(diagramId);
    for (const invalid of ['', '#abc', '#abcdef00', 'red', '#gg0000', {}, [], 42, true]) {
      await expect(
        repo.request(`/nodes/${node.id}`, 'PATCH', {
          version: node.version,
          title: 'Must not save',
          backgroundColor: invalid,
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: 'INVALID_NODE_BACKGROUND_COLOR',
        issues: [{ path: 'nodes.0.backgroundColor', code: 'INVALID_NODE_BACKGROUND_COLOR' }],
      });
      expect(await repo.getGraph(diagramId)).toEqual(original);
    }
    for (const invalid of [null, '', '#abc', {}]) {
      await expect(
        repo.request(`/diagrams/${diagramId}/nodes`, 'POST', {
          title: 'Invalid full node',
          backgroundColor: invalid,
        }),
      ).rejects.toMatchObject({ status: 422, code: 'INVALID_NODE_BACKGROUND_COLOR' });
      await expect(
        repo.request(`/diagrams/${diagramId}/bulk`, 'POST', {
          upsert: true,
          baseVersion: original.diagram.version,
          nodes: [
            { externalId: 'valid-first', title: 'Would save', backgroundColor: '#123456' },
            { externalId: 'invalid-second', title: 'Must reject', backgroundColor: invalid },
          ],
        }),
      ).rejects.toMatchObject({ status: 422, code: 'INVALID_NODE_BACKGROUND_COLOR' });
      expect(await repo.getGraph(diagramId)).toEqual(original);
    }
    await expect(
      repo.request(`/diagrams/${diagramId}/bulk`, 'POST', {
        upsert: true,
        baseVersion: original.diagram.version,
        nodes: [{ id: node.id, externalId: 'wrong-identity', backgroundColor: '#FFFFFF' }],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await repo.getGraph(diagramId)).toEqual(original);
  });

  it('roundtrips full replacement and native JSON and rejects invalid imports before saving', async () => {
    const { diagramId } = await fixture();
    const original = await repo.getGraph(diagramId);
    const next = structuredClone(original);
    next.nodes[0].backgroundColor = '#ff2200';
    const replaced = await repo.request<Graph>(`/diagrams/${diagramId}/graph`, 'PUT', {
      baseVersion: original.diagram.version,
      graph: next,
    });
    const exported = await repo.request<Graph>('/export', 'POST', { diagramId, format: 'json' });
    const imported = await repo.request<Graph>('/import', 'POST', {
      format: 'json',
      data: JSON.stringify(exported),
    });
    expect(imported.nodes[0]).toMatchObject({
      backgroundColor: '#ff2200',
      color: '#567890',
      flowchartSymbol: 'ibm-predefined-process',
    });
    for (const invalid of [null, '', '#abc', {}]) {
      const broken = structuredClone(exported);
      (broken.nodes[0] as unknown as { backgroundColor: unknown }).backgroundColor = invalid;
      const count = await database.diagrams.count();
      await expect(
        repo.request('/import', 'POST', { format: 'json', data: broken }),
      ).rejects.toMatchObject({ status: 422, code: 'INVALID_NODE_BACKGROUND_COLOR' });
      await expect(
        repo.request(`/diagrams/${diagramId}/graph`, 'PUT', {
          baseVersion: replaced.diagram.version,
          graph: broken,
        }),
      ).rejects.toMatchObject({ status: 422, code: 'INVALID_NODE_BACKGROUND_COLOR' });
      expect(await database.diagrams.count()).toBe(count);
      expect(await repo.getGraph(diagramId)).toEqual(replaced);
    }
  });
});
