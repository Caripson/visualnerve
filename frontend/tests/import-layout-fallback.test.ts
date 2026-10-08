import { afterEach, expect, it, vi } from 'vitest';
import { parseCode } from '../src/code/analyzer';
import { parseCodeAsync } from '../src/code/client';
import { arrangeCode } from '../src/code/layout';
import { parseSql } from '../src/sql/parser';
import { parseSqlAsync } from '../src/sql/client';
import { arrangeSql } from '../src/sql/layout';
import type { Graph } from '../src/model/types';

function relationships(graph: Graph) {
  const titles = new Map(graph.nodes.map((node) => [node.id, node.title]));
  return graph.edges.map((edge) => ({
    source: titles.get(edge.sourceNodeId),
    target: titles.get(edge.targetNodeId),
    type: edge.edgeType,
    metadata: edge.metadata,
  }));
}

afterEach(() => vi.unstubAllGlobals());
const code = {
  files: [
    {
      path: 'app/main.ts',
      content: "import { value } from '../shared/value';\nconsole.log(value);",
    },
    { path: 'shared/value.ts', content: 'export const value = 42;' },
  ],
};
const sql = 'SELECT a.id, b.name FROM orders a JOIN customers b ON a.customer_id = b.id';

it('code and SQL imports remain valid and source-faithful without Web Workers', async () => {
  vi.stubGlobal('Worker', undefined);
  const codeResult = await parseCodeAsync(code);
  const originalCode = parseCode(code);
  expect(codeResult.graph.nodes.map(({ metadata, x, y }) => ({ metadata, x, y }))).toEqual(
    originalCode.graph.nodes.map(({ metadata, x, y }) => ({ metadata, x, y })),
  );
  expect(relationships(codeResult.graph)).toEqual(relationships(originalCode.graph));
  expect(codeResult.warnings).toContain(
    'Automatic layout was unavailable. Objects use a grid and can be arranged manually.',
  );
  const sqlResult = await parseSqlAsync(sql, 'Orders');
  const originalSql = parseSql(sql, 'Orders');
  expect(sqlResult.graph.nodes.map((node) => node.metadata)).toEqual(
    originalSql.graph.nodes.map((node) => node.metadata),
  );
  expect(relationships(sqlResult.graph)).toEqual(relationships(originalSql.graph));
  expect(sqlResult.warnings).toContain(
    'Automatic layout was unavailable. Objects use a grid; you can arrange them manually.',
  );
  const positions = new Set(sqlResult.graph.nodes.map((node) => `${node.x}:${node.y}`));
  expect(positions.size).toBe(sqlResult.graph.nodes.length);
});
it('a blocked nested layout worker falls back without rejecting valid imported models', async () => {
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        throw new Error('Worker construction blocked');
      }
    },
  );
  const originalCode = parseCode(code),
    originalSql = parseSql(sql, 'Orders');
  const codeResult = await arrangeCode(originalCode);
  const sqlResult = await arrangeSql(originalSql);
  expect(codeResult.graph.nodes).toEqual(originalCode.graph.nodes);
  expect(codeResult.graph.edges).toEqual(originalCode.graph.edges);
  expect(codeResult.warnings.some((warning) => warning.includes('layout was unavailable'))).toBe(
    true,
  );
  expect(sqlResult.graph.nodes).toHaveLength(originalSql.graph.nodes.length);
  expect(sqlResult.graph.edges).toEqual(originalSql.graph.edges);
  expect(sqlResult.warnings.some((warning) => warning.includes('layout was unavailable'))).toBe(
    true,
  );
});
