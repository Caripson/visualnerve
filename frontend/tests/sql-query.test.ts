import fixture from './fixtures/sql-query.sql?raw';
import { describe, expect, it } from 'vitest';
import { parseSql } from '../src/sql/parser';
import { validateGraph } from '../src/model/validation';
import {
  getSqlQueryRelationship,
  getSqlQueryResult,
  getSqlQuerySource,
  isSqlQueryResult,
  isSqlQuerySource,
  isSqlQueryRelationship,
  sqlQueryLimits,
  validateSqlQueryGraph,
} from '../src/sql/query-schema';
import { blankGraph, newNode } from '../src/model/types';

const resultNodes = (sql: string) =>
  parseSql(sql)
    .graph.nodes.map(getSqlQueryResult)
    .filter((entry) => entry !== undefined);

describe('Local SELECT query structure', () => {
  it('visualizes a complete complex fictional report with distinct aliases, both derived SELECTs and unmodified predicates', () => {
    const result = parseSql(fixture, 'Contract report');
    expect(result).toMatchObject({
      kind: 'query',
      queryCount: 3,
      sourceCount: 29,
      outputColumnCount: 39,
      ignoredStatementCount: 0,
    });
    const blocks = result.graph.nodes.map(getSqlQueryResult).filter((value) => !!value);
    const root = blocks.find((block) => !block!.parentScope)!;
    expect(root).toMatchObject({ distinct: true, scope: 'q1' });
    expect(root.columns).toHaveLength(34);
    expect(root.columns[10].expression).toBe('l.line_contract_expiry_date::string::date');
    expect(root.columns[15].expression).toContain("LIKE 'quarter'");
    expect(root.columns[15].references.map((ref) => ref.sourceAlias)).toEqual(['pc', 'l']);
    expect(root.columns[19]).toMatchObject({
      ordinal: 20,
      alias: 'line_real_rfs_date',
      duplicateAlias: true,
    });
    expect(root.columns[20]).toMatchObject({
      ordinal: 21,
      alias: 'line_real_rfs_date',
      duplicateAlias: true,
    });
    expect(root.clauses.where).toContain("LIKE 'Enterprise'");
    expect(root.clauses.where).toContain("cht.CHT_ROLE = 'Once'");
    const sources = result.graph.nodes.map(getSqlQuerySource).filter((value) => !!value);
    expect(
      sources
        .filter((source) => source?.qualifiedName.at(-1) === 'COMPANIES')
        .map((source) => source?.alias),
    ).toEqual(['b', 'invoice_org', 'invoice_parent', 'parent_org']);
    expect(sources.find((source) => source?.alias === 'sales_rep')?.columns).toContain(
      'emp_segment',
    );
    expect(sources.find((source) => source?.alias === 'inv_tmp')).toMatchObject({
      kind: 'derived',
      queryScope: 'q2',
    });
    expect(blocks.find((block) => block?.scope === 'q2')?.clauses.groupBy).toBe('invli_line_id');
    expect(blocks.find((block) => block?.scope === 'q3')?.columns[0].expression).toContain(
      'SUM(CASE',
    );
    const joins = result.graph.edges
      .map(getSqlQueryRelationship)
      .filter((value) => value?.kind === 'join');
    expect(joins).toHaveLength(27);
    expect(
      joins.filter((join) => join?.condition?.includes('cm2.ctymem_ctyt_id = 3031')),
    ).toHaveLength(2);
    expect(
      joins.find((join) => join?.condition?.includes('regexp_replace(b.'))?.condition,
    ).toContain("'[^0-9]', ''");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('output name line_real_rfs_date'),
        expect.stringContaining('multiple earlier aliases (l, cm2)'),
        expect.stringContaining('unqualified column status_id'),
      ]),
    );
    expect(JSON.stringify(result.graph)).not.toContain('Fictional service-contract report');
    expect(JSON.stringify(result.graph)).not.toContain('Comments must not enter');
    expect(() => validateGraph(result.graph)).not.toThrow();
  });

  it('keeps expressions, literal values, whitespace and quoted aliases, while removing comments', () => {
    const result = parseSql(`-- customer-private comment
      SELECT a."Odd Column" /* private-comment */ AS "Odd Alias",
        CASE WHEN a.amount > 0 THEN 'a;--/*quoted*/' ELSE 'none' END state
      FROM "Sales"."Orders" AS a
      WHERE a.name = 'Secret filter' AND a.value > 10`);
    const block = result.graph.nodes.map(getSqlQueryResult).find((value) => value)!;
    expect(block.columns[0]).toMatchObject({ alias: 'Odd Alias', expression: 'a."Odd Column"' });
    expect(block.columns[1].expression).toContain("'a;--/*quoted*/'");
    expect(block.columns[1].alias).toBe('state');
    expect(block.clauses.where).toBe("a.name = 'Secret filter' AND a.value > 10");
    expect(JSON.stringify(result.graph)).not.toContain('private-comment');
    expect(JSON.stringify(result.graph)).not.toContain('customer-private');
  });

  it('preserves join types, complete ON predicates, USING columns and ambiguity without inventing database types', () => {
    const result = parseSql(`SELECT DISTINCT a.id, b.label, amount
      FROM accounts a LEFT OUTER JOIN labels b USING (id)
      RIGHT JOIN balances c ON c.account_id = a.id AND (c.valid_until IS NULL OR c.valid_until >= current_date())
      WHERE a.state = 'active' GROUP BY a.id, b.label, amount HAVING COUNT(*) > 1 ORDER BY amount DESC LIMIT 25 OFFSET 5`);
    const block = result.graph.nodes.map(getSqlQueryResult).find((value) => value)!;
    expect(block.columns[2].references).toEqual([{ column: 'amount', resolution: 'ambiguous' }]);
    expect(block.clauses).toMatchObject({
      limit: '25 OFFSET 5',
      orderBy: 'amount DESC',
      having: 'COUNT(*) > 1',
    });
    const joins = result.graph.edges
      .map(getSqlQueryRelationship)
      .filter((value) => value?.kind === 'join');
    expect(joins[0]).toMatchObject({ joinType: 'LEFT OUTER JOIN', condition: 'USING (id)' });
    expect(joins[0]?.references?.map((ref) => ref.sourceAlias)).toEqual(['a', 'b']);
    expect(joins[1]?.joinType).toBe('RIGHT JOIN');
    expect(joins[1]?.condition).toContain('current_date()');
    expect(
      result.graph.nodes
        .map(getSqlQuerySource)
        .filter(Boolean)
        .every((source) => !('dataType' in source!)),
    ).toBe(true);
  });

  it('creates scoped CTE results, honors output column lists and keeps each repeated CTE alias separate', () => {
    const result = parseSql(`WITH totals(customer, total) AS (
      SELECT o.customer_id, SUM(o.amount) FROM orders o GROUP BY o.customer_id
    ), ranked AS (SELECT t.customer, t.total FROM totals t WHERE t.total > 50)
    SELECT r.customer, r.total, second.total AS comparison
    FROM ranked r LEFT JOIN totals second ON r.customer = second.customer ORDER BY r.total DESC`);
    expect(result).toMatchObject({ queryCount: 3, sourceCount: 4, outputColumnCount: 7 });
    const blocks = result.graph.nodes.map(getSqlQueryResult).filter(Boolean);
    expect(
      blocks.find((block) => block?.name === 'CTE totals')?.columns.map((column) => column.name),
    ).toEqual(['customer', 'total']);
    const ctes = result.graph.nodes
      .map(getSqlQuerySource)
      .filter((source) => source?.kind === 'cte');
    expect(ctes.map((source) => [source?.alias, source?.queryScope])).toEqual([
      ['t', 'q2'],
      ['r', 'q3'],
      ['second', 'q2'],
    ]);
    expect(() => validateGraph(result.graph)).not.toThrow();
  });

  it('models correlated EXISTS and scalar SELECT scopes without merging outer and inner aliases', () => {
    const result = parseSql(`SELECT a.id,
      (SELECT MAX(i.amount) FROM invoices i WHERE i.account_id = a.id) AS latest
      FROM accounts a WHERE EXISTS (SELECT 1 FROM notes n WHERE n.account_id = a.id AND n.state = 'ready')`);
    expect(result).toMatchObject({ queryCount: 3, sourceCount: 3, outputColumnCount: 4 });
    const blocks = result.graph.nodes.map(getSqlQueryResult).filter(Boolean);
    expect(blocks.filter((block) => block?.parentScope === 'q1')).toHaveLength(2);
    expect(
      result.graph.edges.map(getSqlQueryRelationship).filter((edge) => edge?.kind === 'subquery'),
    ).toHaveLength(2);
    expect(
      result.graph.nodes.map(getSqlQuerySource).find((source) => source?.alias === 'a')?.columns,
    ).toEqual(['id']);
    expect(blocks.find((block) => block?.scope === 'q2')?.clauses.where).toBe(
      'i.account_id = a.id',
    );
  });

  it('supports literal-only SELECTs, wildcard references, aggregates and arithmetic without fictitious columns', () => {
    expect(parseSql('SELECT 1 AS answer, current_date() today')).toMatchObject({
      sourceCount: 0,
      outputColumnCount: 2,
      queryCount: 1,
    });
    expect(resultNodes('SELECT 1 AS answer')[0].columns[0]).toMatchObject({
      expression: '1',
      references: [],
    });
    const result = parseSql('SELECT t.*, t.amount * 3 AS total, COUNT(*) AS count FROM things t');
    const block = result.graph.nodes.map(getSqlQueryResult).find((value) => value)!;
    expect(block.columns[0].references).toEqual([
      { scope: 'q1', sourceAlias: 't', column: '*', resolution: 'resolved' },
    ]);
    expect(block.columns[1].references).toHaveLength(1);
    expect(block.columns[2].references).toHaveLength(0);
  });

  it('never guesses missing or ambiguous source aliases', () => {
    const block = resultNodes(
      'SELECT missing.amount, amount FROM first a JOIN second b ON a.id = b.id',
    )[0];
    expect(block.columns[0].references).toEqual([
      { sourceAlias: 'missing', column: 'amount', resolution: 'unresolved' },
    ]);
    expect(block.columns[1].references).toEqual([{ column: 'amount', resolution: 'ambiguous' }]);
  });

  it('retains decimal and scientific numeric literals without inventing aliases or source references', () => {
    const block = resultNodes(
      'SELECT 1e3, 1.25E-2 AS ratio, t.amount * 2.5e+4 AS scaled FROM things t',
    )[0];
    expect(block.columns[0]).toMatchObject({
      name: 'Expression 1',
      expression: '1e3',
      references: [],
    });
    expect(block.columns[0].alias).toBeUndefined();
    expect(block.columns[1]).toMatchObject({
      alias: 'ratio',
      expression: '1.25E-2',
      references: [],
    });
    expect(block.columns[2].references).toEqual([
      { scope: 'q1', sourceAlias: 't', column: 'amount', resolution: 'resolved' },
    ]);
  });

  it('uses aliases instead of guessing among repeated physical table names and preserves quoted keyword identifiers', () => {
    const blocks = resultNodes(
      'SELECT accounts.id, a.id FROM accounts a JOIN accounts b ON a.id = b.id',
    );
    expect(blocks[0].columns[0].references[0]).toMatchObject({
      sourceAlias: 'accounts',
      resolution: 'unresolved',
    });
    expect(blocks[0].columns[1].references[0]).toMatchObject({
      sourceAlias: 'a',
      resolution: 'resolved',
    });
    const quoted = resultNodes(
      'SELECT "left"."JOIN" "WHERE" FROM "ORDER" "left" JOIN other b ON "left"."JOIN" = b.id',
    )[0];
    expect(quoted.columns[0]).toMatchObject({
      alias: 'WHERE',
      references: [{ scope: 'q1', sourceAlias: 'left', column: 'JOIN', resolution: 'resolved' }],
    });
  });

  it('keeps composite USING ownership ambiguous and shows all left inputs', () => {
    const result = parseSql(
      'SELECT a.id FROM first a JOIN second b USING (id) LEFT JOIN third c USING (id)',
    );
    const joins = result.graph.edges
      .map(getSqlQueryRelationship)
      .filter((value) => value?.kind === 'join');
    expect(joins).toHaveLength(3);
    expect(joins[1]?.references).toEqual([
      { column: 'id', resolution: 'ambiguous' },
      { scope: 'q1', sourceAlias: 'c', column: 'id', resolution: 'resolved' },
    ]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('composite left input')]),
    );
  });

  it('ignores non-query statements and streams their row data without retaining it', () => {
    const result = parseSql(
      "INSERT INTO secrets VALUES ('ROW-SECRET'); SELECT a.id FROM accounts a;",
    );
    expect(result).toMatchObject({ kind: 'query', ignoredStatementCount: 1, queryCount: 1 });
    expect(JSON.stringify(result.graph)).not.toContain('ROW-SECRET');
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('non-query statement(s)')]),
    );
  });

  it('keeps mixed CREATE/SELECT imports explicitly in schema mode', () => {
    const result = parseSql('CREATE TABLE accounts(id int); SELECT a.id FROM accounts a;');
    expect(result).toMatchObject({ kind: 'schema', tableCount: 1, ignoredStatementCount: 1 });
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('mixed script')]),
    );
    expect(result.graph.nodes.some((node) => getSqlQueryResult(node))).toBe(false);
  });

  it.each([
    ['SELECT * EXCLUDE private_column FROM a', 'Wildcard EXCLUDE'],
    ["SELECT a.* REPLACE ('changed' AS title) FROM a", 'Wildcard REPLACE'],
    ['SELECT a.* RENAME title AS label FROM a', 'Wildcard RENAME'],
    ["SELECT * ILIKE '%id%' FROM a", 'Wildcard ILIKE'],
    ['SELECT * FROM a UNION SELECT * FROM b', 'UNION'],
    ['SELECT id FROM a QUALIFY ROW_NUMBER() OVER () = 1', 'QUALIFY'],
    ['SELECT x FROM a PIVOT (SUM(x) FOR y IN (1))', 'PIVOT'],
    ['SELECT a.id FROM a LEFT JOIN LATERAL (SELECT 1) b ON TRUE', 'FROM/JOIN'],
    ['WITH RECURSIVE x AS (SELECT 1) SELECT * FROM x', 'RECURSIVE'],
    ['WITH x AS (SELECT 1) DELETE FROM things', 'WITH must end'],
    ['SELECT * FROM TABLE(generator(rowcount => 10))', 'Table functions'],
  ])('rejects unsupported structure %s with an explicit boundary', (sql, message) => {
    expect(() => parseSql(sql)).toThrow(message);
  });

  it.each([
    ['SELECT', 'empty SELECT'],
    ['SELECT a.id FROM', 'from clause is empty'],
    ['SELECT a.id FROM accounts a JOIN labels b ON', 'predicate is empty'],
    ['SELECT a.id FROM accounts a, labels a', 'Duplicate source alias'],
    ['SELECT d.x FROM (SELECT 1 AS x)', 'needs an alias'],
    ['SELECT a.id AS FROM accounts a', 'SELECT AS'],
    ['SELECT * FROM a WHERE id > 1 WHERE id > 2', 'repeated or out of order'],
  ])('rejects incomplete/ambiguous syntax %s', (sql, message) => {
    expect(() => parseSql(sql)).toThrow(new RegExp(message, 'i'));
  });

  it('bounds nesting, blocks, output expressions and SELECT lists before storing a diagram', () => {
    let sql = 'SELECT 1 AS x';
    for (let i = 0; i < sqlQueryLimits.depth; i++) sql = `SELECT x FROM (${sql}) d${i}`;
    expect(() => parseSql(sql)).toThrow('16 levels');
    expect(() =>
      parseSql(Array.from({ length: sqlQueryLimits.blocks + 1 }, () => 'SELECT 1;').join('')),
    ).toThrow('100 query blocks');
    expect(() =>
      parseSql(
        `SELECT ${Array.from({ length: sqlQueryLimits.outputs + 1 }, (_, i) => `${i} AS x${i}`).join(',')}`,
      ),
    ).toThrow('10,000 SELECT output');
    expect(() =>
      parseSql(`SELECT '${'x'.repeat(sqlQueryLimits.expressionLength)}' AS too_long`),
    ).toThrow('100,000 characters');
  });

  it('requires strict bounded reserved metadata, while leaving custom metadata ordinary', () => {
    const result = parseSql('SELECT a.id FROM accounts a');
    const block = result.graph.nodes.map(getSqlQueryResult).find(Boolean)!;
    const source = result.graph.nodes.map(getSqlQuerySource).find(Boolean)!;
    const relationship = result.graph.edges.map(getSqlQueryRelationship).find(Boolean)!;
    expect(isSqlQueryResult({ ...block, fullSql: 'unexpected' })).toBe(false);
    expect(isSqlQuerySource({ ...source, columns: [123] })).toBe(false);
    expect(isSqlQueryRelationship({ ...relationship, outputOrdinals: [0] })).toBe(false);
    expect(
      isSqlQueryResult({
        ...block,
        columns: [{ ...block.columns[0], references: [{ resolution: 'resolved', column: 'id' }] }],
      }),
    ).toBe(false);
    const graph = blankGraph('Custom');
    graph.nodes.push(
      newNode(graph.diagram.id, { metadata: { applicationSql: { arbitrary: true } } }),
    );
    expect(() => validateSqlQueryGraph(graph)).not.toThrow();
    graph.nodes[0].metadata.sqlQueryResult = { ...block, clauses: { execute: true } };
    expect(() => validateSqlQueryGraph(graph)).toThrow('Invalid SQL query result');
  });
});
