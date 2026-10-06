import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildLovablePrompt } from '../src/export/lovable';
import { markdown } from '../src/export/semantic';
import { blankGraph, newNode, newEdge, type Graph } from '../src/model/types';
import { validateGraph } from '../src/model/validation';
import {
  getSqlQuerySource,
  getSqlQueryResult,
  getSqlQueryRelationship,
  type SqlQuerySource,
  type SqlQueryResult,
} from '../src/sql/query-schema';
import { copySelection, pasteSelection } from '../src/state/clipboard';
import { useEditor } from '../src/state/editor';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { parseSql } from '../src/sql/parser';
import { arrangeSql } from '../src/sql/layout';

function fixture(): Graph {
  const graph = blankGraph('Customer query');
  const source: SqlQuerySource = {
    version: 1,
    scope: 'q1',
    alias: 'c',
    kind: 'table',
    qualifiedName: ['app', 'customers'],
    columns: ['id', 'region'],
  };
  const result: SqlQueryResult = {
    version: 1,
    scope: 'q1',
    name: 'Query result',
    distinct: true,
    columns: [
      {
        ordinal: 1,
        name: 'id',
        expression: 'c.id',
        references: [{ scope: 'q1', sourceAlias: 'c', column: 'id', resolution: 'resolved' }],
        duplicateAlias: true,
      },
      {
        ordinal: 2,
        name: 'id',
        alias: 'id',
        expression: "CASE WHEN c.region = 'EU' THEN 1 ELSE 0 END",
        references: [{ scope: 'q1', sourceAlias: 'c', column: 'region', resolution: 'resolved' }],
        duplicateAlias: true,
      },
    ],
    clauses: {
      from: 'app.customers c',
      where: "c.region = 'EU' AND c.id > 0",
      orderBy: 'c.id',
      limit: '20',
    },
  };
  graph.nodes = [
    newNode(graph.diagram.id, {
      title: 'c',
      nodeType: 'database',
      metadata: {
        sqlQuerySource: source,
        private: 'EXCLUDED-NODE',
      },
    }),
    newNode(graph.diagram.id, {
      title: 'Result',
      metadata: {
        sqlQueryResult: result,
        rawSql: 'EXCLUDED-RAW-SCRIPT',
      },
    }),
    newNode(graph.diagram.id, { title: 'Manual context' }),
  ];
  graph.edges = [
    newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id, {
      edgeType: 'sql-lineage',
      metadata: {
        sqlQueryRelationship: {
          version: 1,
          scope: 'q1',
          kind: 'lineage',
          outputOrdinals: [1, 2],
          references: result.columns[0].references,
        },
        keep: true,
      },
    }),
  ];
  return graph;
}
let db: WorkspaceDatabase;
let repo: Repository;
beforeEach(async () => {
  db = new WorkspaceDatabase(`sql-query-integration-${crypto.randomUUID()}`);
  repo = new Repository(db);
  await db.initialize();
  useEditor.getState().setGraph(null);
});
afterEach(async () => {
  useEditor.getState().setGraph(null);
  await db.delete();
});

describe('SQL query canonical graph integration', () => {
  it('arranges over 300 query objects without overlap while retaining every logical connection', async () => {
    const result = parseSql(
      `SELECT a0.id FROM demo.source_0 a0 ${Array.from({ length: 300 }, (_, index) => `CROSS JOIN demo.source_${index + 1} a${index + 1}`).join(' ')}`,
    );
    const arranged = await arrangeSql(result);
    expect(arranged.graph.nodes).toHaveLength(302);
    expect(arranged.graph.edges).toEqual(result.graph.edges);
    expect(arranged.graph.nodes.map((node) => node.metadata)).toEqual(
      result.graph.nodes.map((node) => node.metadata),
    );
    for (let i = 0; i < arranged.graph.nodes.length; i++) {
      const a = arranged.graph.nodes[i];
      for (const b of arranged.graph.nodes.slice(i + 1))
        expect(
          a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y,
        ).toBe(true);
    }
    expect(() => validateGraph(arranged.graph)).not.toThrow();
  });
  it('exports ordered query expressions, literals and logical references through typed Lovable and Markdown fields', () => {
    const graph = fixture();
    const before = structuredClone(graph);
    const prompt = buildLovablePrompt(graph, 'Create customer analysis', { scope: 'diagram' });
    const objects = prompt.text
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line));
    const result = objects.find((object) => object.sqlQueryResult)?.sqlQueryResult;
    expect(result).toMatchObject({
      scope: 'q1',
      distinct: true,
      clauses: { where: "c.region = 'EU' AND c.id > 0" },
    });
    expect(
      result.columns.map((column: { ordinal: number; name: string }) => [
        column.ordinal,
        column.name,
      ]),
    ).toEqual([
      [1, 'id'],
      [2, 'id'],
    ]);
    expect(result.columns[1]).toMatchObject({
      expression: "CASE WHEN c.region = 'EU' THEN 1 ELSE 0 END",
      duplicateAlias: true,
    });
    expect(objects.find((object) => object.sqlQuerySource)?.sqlQuerySource.observedColumns).toEqual(
      ['id', 'region'],
    );
    expect(
      objects.find((object) => object.sqlQueryRelationship)?.sqlQueryRelationship,
    ).toMatchObject({ kind: 'lineage', outputOrdinals: [1, 2] });
    expect(prompt.text).toContain('not database results or an EXPLAIN execution plan');
    const text = markdown(graph);
    expect(text).toContain('SQL query source');
    expect(text).toContain('SQL query result');
    expect(text).toContain('SQL query connection');
    expect(text).toContain("c.region = 'EU' AND c.id > 0");
    expect(prompt.text + text).not.toContain('EXCLUDED-');
    expect(graph).toEqual(before);
  });

  it('keeps selected query boundary context and safely fences Markdown containing backticks', () => {
    const graph = fixture();
    getSqlQueryResult(graph.nodes[1])!.columns[1].expression = "'```\\n# text'";
    const prompt = buildLovablePrompt(graph, '', {
      scope: 'selected',
      selectedIds: [graph.nodes[1].id],
    });
    expect(prompt).toMatchObject({ nodeCount: 1, edgeCount: 0, boundaryCount: 1 });
    expect(prompt.text).toContain('"ref":"x1"');
    expect(prompt.text).toContain('"alias":"c"');
    expect(markdown(graph)).toContain('````json');
  });

  it('exports large valid query expressions with many separate backticks without a function-argument overflow', () => {
    const graph = fixture();
    const result = getSqlQueryResult(graph.nodes[1])!;
    result.columns = [1, 2, 3].map((ordinal) => ({
      ordinal,
      name: `text_${ordinal}`,
      expression: `'${'`x'.repeat(45000)}'`,
      references: [],
    }));
    expect(() => validateGraph(graph)).not.toThrow();
    const text = markdown(graph);
    expect(text).toContain('"name": "text_3"');
    expect(text).toContain('```json');
  });

  it('imports a duplicate graph with new editor IDs while retaining scope/alias meaning and real links', async () => {
    const original = fixture();
    const first = await repo.importGraph(original);
    const second = await repo.importGraph(JSON.parse(JSON.stringify(original)));
    expect(second.diagram.id).not.toBe(first.diagram.id);
    expect(second.nodes[0].id).not.toBe(first.nodes[0].id);
    expect(second.edges[0].sourceNodeId).toBe(second.nodes[0].id);
    expect(second.edges[0].targetNodeId).toBe(second.nodes[1].id);
    expect(getSqlQueryResult(second.nodes[1])).toEqual(getSqlQueryResult(first.nodes[1]));
    expect(await repo.getGraph(second.diagram.id)).toEqual(second);
  });

  it('gives each pasted query its own scope without breaking column references, boundary references or endpoints', () => {
    const graph = fixture();
    const clip = copySelection(
      graph,
      graph.nodes.slice(0, 2).map((node) => node.id),
    );
    const first = pasteSelection(clip, graph);
    const second = pasteSelection(clip, graph);
    const scope = getSqlQuerySource(first.nodes[0])!.scope;
    expect(scope).not.toBe('q1');
    expect(scope).not.toBe(getSqlQuerySource(second.nodes[0])!.scope);
    expect(getSqlQueryResult(first.nodes[1])!.scope).toBe(scope);
    expect(getSqlQueryResult(first.nodes[1])!.columns[0].references[0]).toMatchObject({
      scope,
      sourceAlias: 'c',
    });
    expect(getSqlQueryRelationship(first.edges[0])!.scope).toBe(scope);
    expect(first.edges[0]).toMatchObject({
      sourceNodeId: first.nodes[0].id,
      targetNodeId: first.nodes[1].id,
    });
    expect(() =>
      validateGraph({
        ...graph,
        nodes: [...graph.nodes, ...first.nodes, ...second.nodes],
        edges: [...graph.edges, ...first.edges, ...second.edges],
      }),
    ).not.toThrow();
    const resultOnly = pasteSelection(
      copySelection(graph, [graph.nodes[1].id]),
      blankGraph('Presentation'),
    );
    expect(resultOnly.edges).toEqual([]);
    expect(getSqlQueryResult(resultOnly.nodes[0])!.columns[0].references[0].sourceAlias).toBe('c');
    expect(getSqlQueryResult(resultOnly.nodes[0])!.columns[0].references[0].scope).toBe(
      getSqlQueryResult(resultOnly.nodes[0])!.scope,
    );
    expect(getSqlQuerySource(clip.nodes[0])!.scope).toBe('q1');
  });

  it('clears parsed query semantics on reconnect and restores them on undo, while a label edit keeps them', () => {
    const graph = fixture();
    const edge = graph.edges[0];
    useEditor.getState().setGraph(graph);
    useEditor.getState().updateEdge(edge.id, { label: 'Customer columns' });
    expect(getSqlQueryRelationship(useEditor.getState().graph!.edges[0])).toBeDefined();
    useEditor.getState().updateEdge(edge.id, { targetNodeId: graph.nodes[2].id });
    expect(useEditor.getState().graph!.edges[0]).toMatchObject({
      edgeType: 'relationship',
      metadata: { keep: true },
    });
    expect(getSqlQueryRelationship(useEditor.getState().graph!.edges[0])).toBeUndefined();
    useEditor.getState().undo();
    expect(getSqlQueryRelationship(useEditor.getState().graph!.edges[0])).toBeDefined();
    useEditor
      .getState()
      .updateEdge(edge.id, { targetNodeId: graph.nodes[2].id, edgeType: 'integration' });
    expect(useEditor.getState().graph!.edges[0].edgeType).toBe('integration');
  });

  it.each(['source', 'result', 'relationship'])(
    'rejects malformed reserved %s metadata transactionally',
    async (kind) => {
      const graph = fixture();
      if (kind === 'source') graph.nodes[0].metadata.sqlQuerySource = { version: 1, columns: 123 };
      if (kind === 'result')
        graph.nodes[1].metadata.sqlQueryResult = {
          ...getSqlQueryResult(graph.nodes[1]),
          columns: [],
        };
      if (kind === 'relationship')
        graph.edges[0].metadata.sqlQueryRelationship = {
          version: 1,
          kind: 'lineage',
          references: [{ resolution: 'resolved', column: 'id' }],
        };
      await expect(repo.importGraph(graph)).rejects.toMatchObject({ status: 422 });
      expect(await db.diagrams.count()).toBe(0);
      expect(await db.nodes.count()).toBe(0);
    },
  );
});
