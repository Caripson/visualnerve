import { describe, expect, it } from 'vitest';
import { parseSql, sqlLimits } from '../src/sql/parser';
import { getSqlRelationship, getSqlTable } from '../src/sql/schema';
import { blankGraph, newEdge, newNode } from '../src/model/types';
import { validateGraph } from '../src/model/validation';

const tables = (sql: string) => parseSql(sql).graph.nodes.map((node) => getSqlTable(node)!);

describe('SQL table schema import', () => {
  it('imports PostgreSQL composite keys, forward references and self references as ordinary editable objects', () => {
    const result = parseSql(
      `
      CREATE TABLE sales.orders (
        tenant_id integer NOT NULL,
        order_id bigint,
        previous_id bigint,
        customer_id bigint,
        amount numeric(12, 2) DEFAULT 0,
        PRIMARY KEY (tenant_id, order_id),
        UNIQUE (tenant_id, customer_id),
        CONSTRAINT customer_fk FOREIGN KEY (tenant_id, customer_id)
          REFERENCES sales.customers ON DELETE CASCADE ON UPDATE NO ACTION,
        FOREIGN KEY (tenant_id, previous_id) REFERENCES sales.orders (tenant_id, order_id)
      );
      CREATE TABLE sales.customers (tenant_id integer, id bigint, email text NOT NULL UNIQUE NULLS NOT DISTINCT);
      ALTER TABLE sales.customers ADD CONSTRAINT customer_pk PRIMARY KEY (tenant_id, id);
    `,
      'Sales database',
    );
    expect(result).toMatchObject({
      tableCount: 2,
      columnCount: 8,
      relationshipCount: 2,
      ignoredStatementCount: 0,
      warnings: [],
    });
    const order = getSqlTable(result.graph.nodes[0])!;
    expect(order.qualifiedName).toEqual(['sales', 'orders']);
    expect(order.primaryKey).toEqual(['tenant_id', 'order_id']);
    expect(order.uniqueKeys).toEqual([['tenant_id', 'customer_id']]);
    expect(order.columns[0]).toMatchObject({
      nullable: false,
      primaryKey: true,
      foreignKey: true,
      unique: false,
    });
    expect(order.columns[1]).toMatchObject({
      nullable: false,
      primaryKey: true,
      foreignKey: false,
    });
    expect(order.columns[4].dataType).toBe('numeric(12, 2)');
    const customer = getSqlTable(result.graph.nodes[1])!;
    expect(customer.columns[2]).toMatchObject({ unique: true, nullable: false });
    expect(getSqlRelationship(result.graph.edges[0])).toEqual({
      version: 1,
      columns: ['tenant_id', 'customer_id'],
      referencedColumns: ['tenant_id', 'id'],
      name: 'customer_fk',
      onDelete: 'CASCADE',
      onUpdate: 'NO ACTION',
    });
    expect(result.graph.edges[0]).toMatchObject({
      edgeType: 'foreign-key',
      direction: 'forward',
      sourceNodeId: result.graph.nodes[0].id,
      targetNodeId: result.graph.nodes[1].id,
    });
    expect(result.graph.edges[1].sourceNodeId).toBe(result.graph.edges[1].targetNodeId);
    expect(result.graph.nodes.every((node) => node.nodeType === 'database')).toBe(true);
    expect(result.graph.diagram.name).toBe('Sales database');
    expect(() => validateGraph(result.graph)).not.toThrow();
    expect(JSON.parse(JSON.stringify(result.graph))).toEqual(result.graph);
  });

  it('handles MySQL qualifiers, enum schema values, keys, unsigned types and inline references without saving defaults', () => {
    const result = parseSql(`
      USE shop;
      # CREATE TABLE comment_fake (secret int);
      CREATE TABLE IF NOT EXISTS \`orders\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        customer_id BIGINT REFERENCES \`customers\`(id) ON DELETE SET NULL,
        state ENUM('new, pending', 'done ( verified )', 'it''s ready') DEFAULT 'SECRET-DEFAULT',
        token VARCHAR(255) DEFAULT 'SECRET-TOKEN; CREATE TABLE fake(id int)',
        PRIMARY KEY USING BTREE (id), UNIQUE KEY order_token USING BTREE (token(10)), KEY customer_index (customer_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      CREATE TABLE customers (id BIGINT PRIMARY KEY);
      INSERT INTO orders VALUES (1, 1, 'new', 'SECRET-ROW');
    `);
    expect(result.tableCount).toBe(2);
    const order = getSqlTable(result.graph.nodes[0])!;
    expect(order.qualifiedName).toEqual(['shop', 'orders']);
    expect(order.columns[0].dataType).toBe('BIGINT UNSIGNED');
    expect(order.columns[2].dataType).toBe(
      "ENUM('new, pending', 'done ( verified )', 'it''s ready')",
    );
    expect(order.uniqueKeys).toEqual([['token']]);
    expect(order.columns[3].unique).toBe(true);
    expect(getSqlRelationship(result.graph.edges[0])?.onDelete).toBe('SET NULL');
    const output = JSON.stringify(result.graph);
    expect(output).not.toContain('SECRET-');
    expect(output).not.toContain('AUTO_INCREMENT');
    expect(output).not.toContain('comment_fake');
    expect(result.ignoredStatementCount).toBe(2);
  });

  it('handles SQL Server brackets, GO batches, clustered keys and ALTER WITH CHECK ADD', () => {
    const result = parseSql(`
      CREATE TABLE [dbo].[Users] (
        [Id] int IDENTITY(1,1) NOT NULL,
        [Name] nvarchar(100) NULL,
        CONSTRAINT [PK_Users] PRIMARY KEY CLUSTERED ([Id] ASC)
      )
      GO
      CREATE TABLE [dbo].[Order]]History] (
        [Id] int PRIMARY KEY,
        [UserId] int,
        [Created] datetime2(7) DEFAULT sysdatetime()
      );
      GO -- end table
      ALTER TABLE [dbo].[Order]]History] WITH CHECK ADD CONSTRAINT [FK_User]
        FOREIGN KEY ([UserId]) REFERENCES [dbo].[Users] ([Id]) ON DELETE NO ACTION;
      GO
    `);
    expect(result.tableCount).toBe(2);
    expect(getSqlTable(result.graph.nodes[1])?.name).toBe('Order]History');
    expect(getSqlTable(result.graph.nodes[0])?.columns[0].dataType).toBe('int');
    expect(getSqlRelationship(result.graph.edges[0])).toMatchObject({
      columns: ['UserId'],
      referencedColumns: ['Id'],
      name: 'FK_User',
    });
    expect(result.warnings).toEqual([]);
  });

  it('does not conflate same short names in different schemas, dotted quoted names or quoted case', () => {
    const result = parseSql(`
      CREATE TABLE a.users (id int PRIMARY KEY);
      CREATE TABLE b.users (id int PRIMARY KEY);
      CREATE TABLE b.orders (user_id int REFERENCES users);
      CREATE TABLE "a.users" (id int PRIMARY KEY);
      CREATE TABLE "Case" (id int PRIMARY KEY);
      CREATE TABLE case (id int PRIMARY KEY);
      CREATE TABLE links (x int REFERENCES "a.users", y int REFERENCES "Case");
    `);
    expect(result.tableCount).toBe(7);
    const nodeTables = result.graph.nodes.map((node) => getSqlTable(node)!);
    expect(nodeTables[3].qualifiedName).toEqual(['a.users']);
    expect(result.graph.nodes[3].title).toBe('"a.users"');
    expect(result.graph.edges[0].targetNodeId).toBe(result.graph.nodes[1].id);
    expect(result.graph.edges[1].targetNodeId).toBe(result.graph.nodes[3].id);
    expect(result.graph.edges[2].targetNodeId).toBe(result.graph.nodes[4].id);
    expect(result.warnings).toEqual([]);
  });

  it('creates external context for ambiguous or missing target tables and marks unknown target keys explicitly', () => {
    const result = parseSql(`
      CREATE TABLE a.users (id int PRIMARY KEY);
      CREATE TABLE b.users (id int PRIMARY KEY);
      CREATE TABLE orders (user_id int REFERENCES users, code int REFERENCES remote.catalog(code));
    `);
    expect(result.tableCount).toBe(5);
    const external = result.graph.nodes.filter((node) => getSqlTable(node)?.external);
    expect(external.map((node) => getSqlTable(node)?.qualifiedName)).toEqual([
      ['users'],
      ['remote', 'catalog'],
    ]);
    expect(
      external.every((node) => node.height >= 120 && getSqlTable(node)?.columns.length === 0),
    ).toBe(true);
    expect(getSqlRelationship(result.graph.edges[0])).toMatchObject({
      columns: ['user_id'],
      referencedColumns: ['?'],
      unresolved: true,
    });
    expect(getSqlRelationship(result.graph.edges[1])).toMatchObject({
      columns: ['code'],
      referencedColumns: ['code'],
    });
    expect(result.graph.edges[0].label).toContain('unknown referenced columns');
    expect(result.warnings.join('\n')).toContain('Ambiguous');
    expect(result.warnings.join('\n')).toContain('no primary key was invented');
  });

  it('warns when dialect-sensitive quoted identifiers have identical declared display names', () => {
    const result = parseSql('CREATE TABLE Foo(id int); CREATE TABLE "Foo"(id int);');
    expect(result.tableCount).toBe(2);
    expect(result.graph.nodes.map((node) => node.title)).toEqual(['Foo', '"Foo"']);
    expect(result.warnings.join('\n')).toContain(
      'Distinct quoted/unquoted tables share the displayed name Foo',
    );
    const columns = parseSql('CREATE TABLE t(X int, "X" int);');
    expect(columns.columnCount).toBe(2);
    expect(columns.warnings.join('\n')).toContain('columns share the displayed name X');
    const slashes = parseSql(String.raw`CREATE TABLE "folder\" ("column\" int);`);
    expect(getSqlTable(slashes.graph.nodes[0])?.name).toBe('folder\\');
    expect(getSqlTable(slashes.graph.nodes[0])?.columns[0].name).toBe('column\\');
  });

  it('applies ALTER ADD COLUMN/PK/UNIQUE/FK and warns rather than pretending DROP/RENAME/MODIFY were applied', () => {
    const result = parseSql(`
      CREATE TABLE users (id int);
      CREATE TABLE orders (id int);
      ALTER TABLE users ADD PRIMARY KEY (id), ADD UNIQUE (id);
      ALTER TABLE orders ADD COLUMN user_id int NOT NULL;
      ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users;
      ALTER TABLE orders DROP COLUMN id, RENAME TO renamed_orders;
      DROP TABLE users;
    `);
    expect(result.columnCount).toBe(3);
    expect(result.relationshipCount).toBe(1);
    expect(getSqlTable(result.graph.nodes[1])?.name).toBe('orders');
    expect(getSqlTable(result.graph.nodes[1])?.columns[1]).toMatchObject({
      name: 'user_id',
      nullable: false,
      foreignKey: true,
    });
    expect(result.ignoredStatementCount).toBe(2);
    expect(result.warnings.join('\n')).toContain('unsupported ALTER action');
    expect(result.warnings.join('\n')).toContain('DROP/RENAME schema changes');
  });

  it('does not mistake comment, quoted string, dollar block or routine contents for tables', () => {
    const result = parseSql(`
      /* CREATE TABLE block_fake (x int); /* nested comment */ */
      -- CREATE TABLE line_fake (x int);
      INSERT INTO logs VALUES ('CREATE TABLE string_fake (x int); it''s fake');
      INSERT INTO logs VALUES (q'[CREATE TABLE oracle_fake (x int);]');
      DO $body$ BEGIN CREATE TABLE dollar_fake (x int); END; $body$;
      CREATE PROCEDURE hidden AS BEGIN CREATE TABLE routine_fake (x int); SELECT 'x'; END;
      GO
      DELIMITER $$
      CREATE PROCEDURE mysql_hidden() BEGIN
        CREATE TABLE mysql_fake (x int);
        IF 1 = 1 THEN SELECT 'value;'; END IF;
      END$$
      DELIMITER ;
      CREATE TABLE real_table (id int PRIMARY KEY, values_list integer[], amount numeric(10,2), labels TEXT[], sized INT[3]);
    `);
    expect(result.tableCount).toBe(1);
    expect(getSqlTable(result.graph.nodes[0])?.name).toBe('real_table');
    expect(getSqlTable(result.graph.nodes[0])?.columns[1].dataType).toBe('integer[]');
    expect(getSqlTable(result.graph.nodes[0])?.columns[2].dataType).toBe('numeric(10, 2)');
    expect(getSqlTable(result.graph.nodes[0])?.columns[3].dataType).toBe('TEXT[]');
    expect(getSqlTable(result.graph.nodes[0])?.columns[4].dataType).toBe('INT[3]');
    expect(JSON.stringify(result.graph)).not.toContain('_fake');
    expect(result.ignoredStatementCount).toBe(5);
  });

  it('ignores complete BEGIN/END function bodies while still terminating inline functions', () => {
    const result = parseSql(`
      CREATE FUNCTION hidden RETURNS void AS BEGIN
        SELECT 1;
        CREATE TABLE function_fake(id int);
        IF 1=1 THEN SELECT 2; END IF;
        SELECT CASE WHEN 1=1 THEN 1 ELSE 0 END;
      END;
      CREATE FUNCTION inline_fn RETURNS TABLE AS RETURN SELECT 'CREATE TABLE inline_fake(x int)';
      CREATE TABLE actual_table (id int);
    `);
    expect(result.tableCount).toBe(1);
    expect(getSqlTable(result.graph.nodes[0])?.name).toBe('actual_table');
    expect(result.ignoredStatementCount).toBe(2);
    expect(JSON.stringify(result.graph)).not.toContain('_fake');
  });

  it('skips PostgreSQL COPY rows using their own terminator, including unmatched SQL quotes and fake DDL', () => {
    const result = parseSql(String.raw`CREATE TABLE users (id integer PRIMARY KEY);
      COPY users (id) FROM stdin;
      raw ' unbalanced " quote
      CREATE TABLE data_fake (secret text);
      \.
      CREATE TABLE orders (user_id integer REFERENCES users);
    `);
    expect(result.tableCount).toBe(2);
    expect(result.relationshipCount).toBe(1);
    expect(result.ignoredStatementCount).toBe(1);
    expect(JSON.stringify(result.graph)).not.toContain('data_fake');
    expect(() => parseSql('CREATE TABLE t(id int); COPY t FROM stdin;\nraw')).toThrow(
      'COPY data section',
    );
  });

  it('retains only schema, not CHECK/default/generated literal expressions or procedure text', () => {
    const result = parseSql(`CREATE TABLE credentials (
      id int PRIMARY KEY DEFAULT NULL,
      secret text DEFAULT CASE WHEN 1=1 THEN 'SUPER-SECRET' ELSE NULL END NOT NULL,
      calculated int GENERATED ALWAYS AS (length('GENERATED-SECRET')) STORED,
      checked text CHECK (checked <> 'CHECK-SECRET'),
      escaped text DEFAULT E'\\'ESCAPED-SECRET'
    );`);
    const table = getSqlTable(result.graph.nodes[0])!;
    expect(table.columns[0]).toMatchObject({ primaryKey: true, nullable: false });
    expect(table.columns[1]).toMatchObject({ dataType: 'text', nullable: false });
    expect(table.columns[2].dataType).toBe('int');
    expect(JSON.stringify(result.graph)).not.toContain('SECRET');
  });

  it('deduplicates IF NOT EXISTS safely and warns for unsupported table-copy/query forms', () => {
    const result = parseSql(`
      CREATE TABLE users (id int PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS users (different int);
      CREATE TABLE query_copy AS SELECT * FROM users;
      CREATE TABLE query_columns (id) AS SELECT id FROM users;
      CREATE TABLE like_copy LIKE users;
      CREATE TABLE derived (extra int) INHERITS (users);
    `);
    expect(result.tableCount).toBe(2);
    expect(getSqlTable(result.graph.nodes[0])?.columns[0].name).toBe('id');
    expect(result.warnings.join('\n')).toContain('Repeated IF NOT EXISTS');
    expect(result.warnings.join('\n')).toContain('unsupported');
    expect(result.warnings.join('\n')).toContain('inherited columns');
  });

  it.each([
    ['CREATE TABLE x', 'parenthesized'],
    ['CREATE TABLE x (id int', 'incomplete'],
    ['CREATE TABLE x (id int,)', 'Empty column'],
    ['CREATE TABLE x (id);', 'data type'],
    ['CREATE TABLE x (id int, id text);', 'Duplicate column'],
    ['CREATE TABLE x(id int); CREATE TABLE x(id int);', 'Duplicate table'],
    ['CREATE TABLE x (id int, FOREIGN KEY(id));', 'REFERENCES'],
    ['CREATE TABLE x (id int REFERENCES);', 'identifier'],
    ['CREATE TABLE x (id int REFERENCES y() );', 'column names'],
    ['CREATE TABLE x (id int, FOREIGN KEY(id) REFERENCES y(a,b));', 'column counts'],
    ['CREATE TABLE x (id int, FOREIGN KEY(missing) REFERENCES y(id));', 'source column'],
    ['CREATE TABLE x (id int); CREATE TABLE y(x int REFERENCES x(missing));', 'target column'],
    ['CREATE TABLE x (id int); CREATE TABLE y(x int REFERENCES x);', 'no primary key'],
    ['CREATE TABLE x (id int PRIMARY KEY, other int PRIMARY KEY);', 'multiple primary keys'],
    ['CREATE TABLE x (id int REFERENCES y(id) ON DELETE);', 'foreign-key action'],
    ["CREATE TABLE x (id text DEFAULT 'unterminated);", 'Unterminated string'],
    ['/* unfinished', 'Unterminated block comment'],
    ['DO $$ unfinished', 'Unterminated dollar'],
  ])('rejects malformed schema %s', (sql, message) => {
    expect(() => parseSql(sql)).toThrow(message);
  });

  it('fails clearly when there are no supported tables and enforces bounded tables/columns/bytes/warnings', () => {
    expect(() => parseSql('INSERT INTO x VALUES (1);')).toThrow('No supported CREATE TABLE');
    expect(() => parseSql('CREATE TABLE x AS SELECT 1;')).toThrow('No supported CREATE TABLE');
    expect(() => parseSql(' '.repeat(sqlLimits.bytes + 1))).toThrow('50 MiB');
    const manyTables = Array.from(
      { length: sqlLimits.tables + 1 },
      (_, i) => `CREATE TABLE t${i} (id int);`,
    ).join('\n');
    expect(() => parseSql(manyTables)).toThrow('2,000 tables');
    const wide = Array.from({ length: sqlLimits.columns + 1 }, (_, i) => `c${i} int`).join(',');
    expect(() => parseSql(`CREATE TABLE wide (${wide});`)).toThrow('100,000 columns');
    const foreign = 'FOREIGN KEY(id) REFERENCES target(id)';
    expect(() =>
      parseSql(
        `CREATE TABLE target(id int PRIMARY KEY); CREATE TABLE many(id int, ${Array.from({ length: sqlLimits.relationships + 1 }, () => foreign).join(',')});`,
      ),
    ).toThrow('10,000 foreign-key relationships');
    const warned = parseSql(
      `CREATE TABLE x(id int); ${'ALTER TABLE x DROP COLUMN id;'.repeat(250)}`,
    );
    expect(warned.warnings.length).toBeLessThanOrEqual(sqlLimits.warnings);
    expect(warned.warnings.at(-1)).toContain('additional warning');
    expect(warned.ignoredStatementCount).toBe(250);
  });

  it('bounds card height while preserving all columns and handles large INSERT data as ignored statements', () => {
    const columns = Array.from({ length: 50 }, (_, i) => `c${i} integer`).join(',');
    const rows = `INSERT INTO many VALUES ${Array.from({ length: 20_000 }, () => "('RAW-SECRET; CREATE TABLE fake (x int)')").join(',')};`;
    const result = parseSql(`CREATE TABLE many(${columns}); ${rows}`);
    expect(result.columnCount).toBe(50);
    expect(getSqlTable(result.graph.nodes[0])?.columns).toHaveLength(50);
    expect(result.graph.nodes[0].height).toBe(86 + 12 * 23 + 22);
    expect(result.ignoredStatementCount).toBe(1);
    expect(result.graph.nodes).toHaveLength(1);
    expect(JSON.stringify(result.graph)).not.toContain('RAW-SECRET');
  });
});

describe('defensive SQL metadata helpers', () => {
  it('recognizes imported tables/relationships and ignores malformed or legacy custom metadata', () => {
    const result = parseSql(
      'CREATE TABLE p(id int PRIMARY KEY); CREATE TABLE c(p_id int REFERENCES p);',
    );
    expect(getSqlTable(result.graph.nodes[0])?.version).toBe(1);
    expect(getSqlRelationship(result.graph.edges[0])?.version).toBe(1);
    const graph = blankGraph('Legacy');
    const node = newNode(graph.diagram.id, { metadata: { sqlTable: { userValue: true } } });
    const edge = newEdge(graph.diagram.id, node.id, node.id, {
      metadata: { sqlRelationship: { userValue: true } },
    });
    expect(getSqlTable(node)).toBeUndefined();
    expect(getSqlRelationship(edge)).toBeUndefined();
    const table = getSqlTable(result.graph.nodes[0])!;
    node.metadata.sqlTable = { ...table, columns: [{ ...table.columns[0], foreignKey: 'wrong' }] };
    expect(getSqlTable(node)).toBeUndefined();
    edge.metadata.sqlRelationship = {
      ...getSqlRelationship(result.graph.edges[0]),
      referencedColumns: [],
    };
    expect(getSqlRelationship(edge)).toBeUndefined();
  });
});
