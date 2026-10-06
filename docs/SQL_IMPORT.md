# Visualize SQL queries and schemas

Drop a `.sql` or `.ddl` file onto the accepted workspace, use **Import**, or choose **Import SQL script** to paste a script. On a phone, the script entry is under **… → Import SQL script**. The dialog also provides **Load SQL file**.

1. Enter a diagram name and the **SQL script**.
2. Choose the preview action. Parsing and initial layout run locally in a Web Worker. Review query/source/output counts or table/column counts, relationships and import notes.
3. Choose **Create diagram** to save the result as editable diagram objects. Opening the dialog or previewing does not create a project.

Changing the script or name clears the preview. Cancel closes the dialog and aborts pending analysis. A malformed or unsupported script shows an error without discarding the input; a script without a supported query or table definition cannot create an empty diagram.

## SELECT and WITH queries

A SELECT query becomes a graph of its logical structure. Each table alias is its own source object, so `business b`, `business invoice_org` and `business parent_org` stay distinct even when they reference the same table. Each query block has a result object containing its ordered output expressions and aliases. JOIN connections retain INNER/LEFT/RIGHT/FULL/CROSS type and the condition; data-flow and lineage connections explain which sources contribute to each result. Select an object or connection to inspect full expressions, referenced columns and query clauses in Properties.

The parser recognizes SELECT DISTINCT, explicit and implicit aliases, schema-qualified/quoted names, CASE expressions, function calls, aggregates, casts such as `::string::date`, WHERE, GROUP BY, HAVING, ORDER BY and LIMIT. Derived tables and CTEs have their own scopes/results. Nested subqueries and correlated references retain scope information. A reference is marked resolved, unresolved or ambiguous; without database schema, an unqualified column shared by several sources cannot be assigned to one table safely. `*` stays an explicit wildcard rather than an invented list of columns. Duplicate output aliases remain in order and produce a warning.

```sql
SELECT DISTINCT
  b.bu_id,
  invoice_org.bu_name AS invoice_name,
  CASE WHEN totals.amount IS NULL THEN 0 ELSE totals.amount END AS amount
FROM business b
LEFT JOIN business invoice_org ON b.bu_send_bills_to = invoice_org.bu_id
LEFT JOIN (
  SELECT customer_id, SUM(amount) AS amount
  FROM invoices
  WHERE state <> 'Cancelled'
  GROUP BY customer_id
) totals ON b.bu_id = totals.customer_id
WHERE b.active = 1;
```

Here the two business aliases remain separate, the aggregate subquery has its own result, and the final result exposes three ordered outputs. This is a logical query diagram. SQL is never executed, no database is contacted, and the tool cannot infer returned rows, indexes, cardinalities, data types or a database optimizer's physical execution plan. Unsupported query constructs such as UNION/INTERSECT/EXCEPT, recursive CTEs, QUALIFY, LATERAL, table functions and wildcard modifiers (EXCLUDE/REPLACE/RENAME/ILIKE) are rejected explicitly; the importer does not silently draw a partial query. Mixed CREATE/SELECT scripts retain schema mode and report the skipped SELECT statements; import a query separately to inspect its structure.

## Supported definitions

The importer extracts common PostgreSQL, MySQL and SQL Server table definitions. It supports `CREATE TABLE` columns and types, nullability, inline and table-level primary/unique/foreign keys, and `ALTER TABLE ... ADD` columns or key constraints. Composite keys retain their column order. Schema-qualified names, double-quoted names, backticks and bracketed identifiers are supported, as are references to tables defined later in the script. Declared `ON DELETE` and `ON UPDATE` actions are retained.

For example:

```sql
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  email VARCHAR(320) NOT NULL UNIQUE
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  total DECIMAL(12, 2),
  CONSTRAINT orders_customer_fk
    FOREIGN KEY (customer_id) REFERENCES customers(id)
    ON DELETE RESTRICT
);

ALTER TABLE orders ADD created_at TIMESTAMP;
```

Each table becomes a database object. A foreign key connects the child table, which stores the referencing columns, to the parent table. This arrow represents a data relationship. It does not declare workflow execution order.

If a referenced table is absent or an unqualified name is ambiguous, the diagram retains an **External table · definition missing** object. Its missing columns and keys remain unknown. An omitted referenced-column list can use a primary key declared in the script; otherwise an external reference is marked unresolved, without inventing a primary key. Review these objects and warnings before relying on the diagram.

## Review and edit

Table cards show up to 12 columns with type and rule badges: **PK** primary key, **FK** foreign key, **UQ** unique, **?** nullable and **NN** not null. Select a table to inspect its schema and complete primary/unique keys in Properties. Large column lists use **Previous columns** and **Next columns**, with 100 columns per page. Select a foreign-key connection to inspect column pairs, constraint name and delete/update actions.

The imported objects remain freely movable and can be renamed, connected to other objects, given colors, owners and status, or annotated with the pen layer. Reconnecting a parsed foreign key to another table turns it into a manual relationship and removes the old constraint's column pairs; undo restores the original reference. Normal edits support undo and local saving. Schema metadata and relationships survive IndexedDB reload, diagram JSON and workspace backups. PNG/PDF include the visible table summaries and drawing layer. Importing another script creates another diagram; the script is not retained as an editable source binding.

## Scope and limits

SQL is never executed or sent to a database. SELECT/WITH visualizes logical query structure; DDL extracts schema. INSERT/COPY rows, procedures and other statements outside the supported table schema are ignored. `DROP`, `RENAME`, `MODIFY` and unsupported ALTER actions are not applied and produce import notes, so a schema diagram represents imported CREATE/ADD definitions rather than the final state of a migration. Inherited definitions and `CREATE TABLE AS/LIKE/OF/PARTITION` variants are not imported as complete tables.

Scripts are limited to 50 MiB. Schema limits are 2,000 table objects including external references, 100,000 columns and 10,000 foreign keys. Query limits are 100 blocks, nesting depth 16, 2,000 sources, 10,000 outputs, 100,000 column references, 10,000 relationships and 100,000 characters per expression/clause. Warnings are bounded to 100; preview lists and card summaries show counts for further entries. Analysis times out after 30 seconds. Graphs above 300 objects start in a grid; **Auto layout** remains available. File size and graph shape affect processing time and readability.

The raw script exists only in the temporary import draft. Query diagrams save normalized output expressions, JOIN conditions and clauses, including their literal values; sensitive filters therefore survive JSON, backups and typed text exports. DDL diagrams save recognized schema fields, excluding INSERT/COPY values, defaults, CHECK expressions and procedure bodies. Comments and the complete original script are not stored. ENUM labels inside a column's data type may remain because they describe the schema. Review names, expressions and literal values before sharing. The original file on your device is unaffected.

## Local API and MCP

`POST /sql/preview` accepts `{ "sql": "SELECT ...", "name": "Optional name" }` and returns `SqlImportResult` with a graph, counts and warnings without saving or navigating. Read only permits this exact preview endpoint. `POST /sql/diagrams` accepts the same payload, requires Read + write, imports transactionally and opens the saved graph. They use the same browser worker as the dialog, never a SQL server. Raw source passes transiently through the optional local bridge and is not retained there. The bridge has a 32 MiB JSON transport envelope; keep integration scripts below that limit. See [API.md](../API.md).

## Build an app from the schema

**Build with Lovable** includes recognized table names, ordered columns/types, nullability, primary and unique keys, and foreign-key column pairs/actions through a typed schema allowlist. Missing table definitions and unresolved referenced columns remain explicit. These are data-model requirements, not invented workflow transitions. Source scripts and data rows are not included. Review the complete prompt and add your own application instructions before opening Lovable. See [Lovable handoff](LOVABLE.md) and [privacy](PRIVACY.md).

Query diagrams contribute scoped source aliases, result expressions/aliases, joins, filters, grouping and resolved/unresolved lineage through their typed metadata. Literal filter values can appear in the prompt even though the complete raw script is excluded. Review the text and explain what app behavior you want; a SELECT diagram alone does not define editing screens or business workflows.
