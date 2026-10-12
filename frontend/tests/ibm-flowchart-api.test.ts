import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  blankGraph,
  diagramTypes,
  type Diagram,
  type Graph,
  type GraphNode,
} from '../src/model/types';
import { ibmSymbols, ibmStencilForms, type IBMSymbol } from '../src/flowchart/ibm-symbols';
import { Repository } from '../src/storage/repository';
import { WorkspaceDatabase } from '../src/storage/database';

let database: WorkspaceDatabase;
let repo: Repository;
beforeEach(async () => {
  database = new WorkspaceDatabase(`ibm-flowchart-api-${crypto.randomUUID()}`);
  await database.initialize();
  repo = new Repository(database);
});
afterEach(async () => {
  await database.delete();
});

describe('IBM Flowcharting browser command contract', () => {
  it.each(diagramTypes.filter((type) => type !== 'process-simulator'))(
    'creates, changes and clears symbol appearance in an ordinary %s diagram without changing semantics',
    async (type) => {
      const graph = await repo.saveGraph(blankGraph(`Reusable symbols: ${type}`, type), 0);
      const created = await repo.request<GraphNode>(`/diagrams/${graph.diagram.id}/nodes`, 'POST', {
        title: 'Existing team semantics',
        nodeType: 'team',
        flowchartSymbol: 'ibm-predefined-process',
        backgroundColor: '#c0ffee',
        metadata: { purpose: 'unchanged' },
      });
      const changed = await repo.request<GraphNode>(`/nodes/${created.id}`, 'PATCH', {
        version: created.version,
        flowchartSymbol: 'ibm-decision',
      });
      expect(changed).toMatchObject({
        ...created,
        version: created.version + 1,
        updatedAt: expect.any(String),
        flowchartSymbol: 'ibm-decision',
      });
      const cleared = await repo.request<GraphNode>(`/nodes/${created.id}`, 'PATCH', {
        version: changed.version,
        flowchartSymbol: null,
      });
      const { flowchartSymbol: _symbol, ...ordinary } = changed;
      expect(cleared).toMatchObject({
        ...ordinary,
        version: changed.version + 1,
        updatedAt: expect.any(String),
      });
      expect(cleared).not.toHaveProperty('flowchartSymbol');
      const saved = await repo.getGraph(graph.diagram.id);
      expect(saved.diagram.type).toBe(type);
      expect(saved.diagram).not.toHaveProperty('analytics');
      expect(saved).not.toHaveProperty('simulation');
      expect(saved.nodes).toEqual([cleared]);
    },
  );

  it('discovers detached complete catalog metadata through an exact GET route', async () => {
    const first = await repo.request<IBMSymbol[]>('/flowchart/symbols');
    expect(first).toEqual(ibmSymbols);
    expect(first).toHaveLength(43);
    expect(first.filter((symbol) => symbol.physicalCutout)).toHaveLength(26);
    expect(first.find((symbol) => symbol.id === 'ibm-sort')).toMatchObject({
      category: 'symbol',
      construction: 'composite',
      physicalCutout: false,
    });
    expect(first.filter((symbol) => symbol.category === 'legacy')).toHaveLength(5);
    expect(first.find((symbol) => symbol.id === 'ibm-program-modification')).toMatchObject({
      construction: 'cutout',
      physicalCutout: false,
      revisions: ['GX20-8020'],
    });
    const stencils = await repo.request<typeof ibmStencilForms>('/flowchart/stencils');
    expect(stencils).toEqual(ibmStencilForms);
    expect(stencils.map((stencil) => stencil.physicalCutoutSymbolIds.length)).toEqual([25, 26, 26]);
    expect(stencils[0].symbolLabels).toMatchObject({
      'ibm-process': 'Processing/Annotation',
      'ibm-manual-input': 'Online Keyboard',
      'ibm-merge': 'Offline Storage File',
      'ibm-magnetic-tape-circle': 'Magnetic Tape/Sorting/Collating',
    });
    expect(Object.keys(stencils[0].symbolLabels!)).toHaveLength(25);
    stencils[0].label = 'Changed stencil caller copy';
    expect((await repo.request<typeof ibmStencilForms>('/flowchart/stencils'))[0].label).toBe(
      'Original IBM Flowcharting Template (25 apertures)',
    );
    first[0].label = 'Changed caller copy';
    expect((await repo.request<IBMSymbol[]>('/api/v1/flowchart/symbols'))[0].label).toBe('Process');
    for (const path of ['/flowchart/symbols/extra', '/flowchart/symbols?raw=true'])
      await expect(repo.request(path)).rejects.toMatchObject({ status: 404 });
    await expect(repo.request('/flowchart/symbols', 'POST', {})).rejects.toMatchObject({
      status: 405,
    });
  });

  it('creates the native template and leaves ordinary flowchart creation available', async () => {
    const created = await repo.request<Diagram>('/diagrams', 'POST', {
      name: 'IBM order processing',
      template: 'ibm-flowcharting',
    });
    const graph = await repo.getGraph(created.id);
    expect(created.type).toBe('flowchart');
    expect(graph.diagram.name).toBe('IBM order processing');
    expect(graph.nodes.some((node) => node.flowchartSymbol === 'ibm-predefined-process')).toBe(
      true,
    );
    const ordinary = await repo.request<Diagram>('/diagrams', 'POST', {
      name: 'Ordinary flowchart',
      type: 'flowchart',
    });
    expect((await repo.getGraph(ordinary.id)).nodes).toEqual([]);
    for (const fields of [{ mode: 'example' }, { type: 'mindmap' }])
      await expect(
        repo.request('/diagrams', 'POST', {
          name: 'Invalid IBM request',
          template: 'ibm-flowcharting',
          ...fields,
        }),
      ).rejects.toMatchObject({ status: 422 });
  });

  it('preserves and clears appearances in native node CRUD, children and external-ID upserts', async () => {
    const graph = await repo.saveGraph(blankGraph('IBM CRUD', 'flowchart'), 0);
    const root = await repo.request<GraphNode>(`/diagrams/${graph.diagram.id}/nodes`, 'POST', {
      title: 'Reusable process',
      nodeType: 'process',
      externalId: 'root',
      flowchartSymbol: 'ibm-predefined-process',
    });
    const child = await repo.request<GraphNode>(`/nodes/${root.id}/children`, 'POST', {
      title: 'Sorted output',
      nodeType: 'process',
      flowchartSymbol: 'ibm-sort',
    });
    expect(child.parentId).toBe(root.id);
    expect(child.flowchartSymbol).toBe('ibm-sort');
    const moved = await repo.request<GraphNode>(`/nodes/${root.id}`, 'PATCH', {
      version: root.version,
      x: 400,
    });
    expect(moved.flowchartSymbol).toBe('ibm-predefined-process');
    const changed = await repo.request<GraphNode>(`/nodes/${root.id}`, 'PATCH', {
      version: moved.version,
      flowchartSymbol: 'ibm-magnetic-disk',
    });
    expect(changed.id).toBe(root.id);
    expect(changed.nodeType).toBe('process');
    const cleared = await repo.request<GraphNode>(`/nodes/${root.id}`, 'PATCH', {
      version: changed.version,
      flowchartSymbol: null,
    });
    expect(Object.hasOwn(cleared, 'flowchartSymbol')).toBe(false);
    let saved = await repo.getGraph(graph.diagram.id);
    saved = await repo.request<Graph>(`/diagrams/${graph.diagram.id}/bulk`, 'POST', {
      baseVersion: saved.diagram.version,
      upsert: true,
      nodes: [{ externalId: 'root', flowchartSymbol: 'ibm-core' }],
    });
    expect(saved.nodes.find((node) => node.id === root.id)?.flowchartSymbol).toBe('ibm-core');
    saved = await repo.request<Graph>(`/diagrams/${graph.diagram.id}/bulk`, 'POST', {
      baseVersion: saved.diagram.version,
      upsert: true,
      nodes: [{ externalId: 'root', flowchartSymbol: null }],
    });
    expect(Object.hasOwn(saved.nodes.find((node) => node.id === root.id)!, 'flowchartSymbol')).toBe(
      false,
    );
  });

  it('rejects invalid appearance writes atomically and roundtrips native replacement and JSON import', async () => {
    const diagram = await repo.request<Diagram>('/diagrams', 'POST', {
      name: 'Preserved IBM graph',
      template: 'ibm-flowcharting',
    });
    const original = await repo.getGraph(diagram.id);
    const node = original.nodes[0];
    for (const invalid of ['ibm-unknown', '', 42, {}]) {
      await expect(
        repo.request(`/nodes/${node.id}`, 'PATCH', {
          version: node.version,
          flowchartSymbol: invalid,
        }),
      ).rejects.toMatchObject({ status: 422 });
      expect(await repo.getGraph(diagram.id)).toEqual(original);
    }
    await expect(
      repo.request(`/diagrams/${diagram.id}/bulk`, 'POST', {
        upsert: true,
        baseVersion: original.diagram.version,
        nodes: [
          { externalId: 'would-save', title: 'Valid first entry', flowchartSymbol: 'ibm-process' },
          { externalId: 'invalid', title: 'Invalid second entry', flowchartSymbol: null },
        ],
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await repo.getGraph(diagram.id)).toEqual(original);
    const replacement = structuredClone(original);
    replacement.nodes[0].flowchartSymbol = 'ibm-display';
    const saved = await repo.request<Graph>(`/diagrams/${diagram.id}/graph`, 'PUT', {
      baseVersion: original.diagram.version,
      graph: replacement,
    });
    expect(saved.nodes[0].flowchartSymbol).toBe('ibm-display');
    const exported = await repo.request<Graph>('/export', 'POST', {
      diagramId: diagram.id,
      format: 'json',
    });
    const imported = await repo.request<Graph>('/import', 'POST', {
      format: 'json',
      data: JSON.stringify(exported),
    });
    expect(imported.diagram.id).not.toBe(diagram.id);
    expect(imported.nodes.map((item) => item.flowchartSymbol)).toEqual(
      saved.nodes.map((item) => item.flowchartSymbol),
    );
    const invalidImport = structuredClone(exported);
    (invalidImport.nodes[0] as unknown as { flowchartSymbol: null }).flowchartSymbol = null;
    const before = await database.diagrams.count();
    await expect(
      repo.request('/import', 'POST', { format: 'json', data: invalidImport }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await database.diagrams.count()).toBe(before);
  });
});
