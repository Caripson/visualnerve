# Import a SQL schema

Drop a `.sql` or `.ddl` file onto the accepted workspace, use **Import**, or choose **Import SQL script** to paste a script. On a phone, the script entry is under **… → Import SQL script**. The dialog also provides **Load SQL file**.

1. Enter a diagram name and the **SQL script**.
2. Choose **Preview schema**. Parsing and initial layout run locally in a Web Worker. Review the table, column, relationship and unresolved-table counts, table list and import notes.
3. Choose **Create diagram** to save the schema as editable diagram objects. Opening the dialog or previewing does not create a project.

Changing the script or name clears the preview. Cancel closes the dialog and aborts pending analysis. A malformed or unsupported script shows an error without discarding the input; a script without supported table definitions cannot create an empty diagram.

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

This is schema extraction. SQL is never executed or sent to a database. `SELECT` and `JOIN` queries do not create a query plan or a diagram of their results. INSERT/COPY rows, procedures and other statements outside the supported table schema are ignored. `DROP`, `RENAME`, `MODIFY` and unsupported ALTER actions are not applied and produce import notes, so the diagram represents imported CREATE/ADD definitions rather than the final state of a migration. Inherited definitions and `CREATE TABLE AS/LIKE/OF/PARTITION` variants are not imported as complete tables.

Scripts are limited to 50 MiB, 2,000 table objects including external references, 100,000 columns and 10,000 foreign-key relationships. Preview lists are bounded; the first 30 table objects and first 20 notes are shown with counts for further entries. Analysis times out after 30 seconds. Schemas above 300 objects start in a grid; **Auto layout** remains available. File size and schema shape affect processing time and readability.

The raw script exists only in the temporary import draft. Saved diagrams contain recognized schema fields, not source SQL, INSERT/COPY values, defaults, CHECK expressions, comments or procedure bodies. ENUM labels inside a column's data type may remain because they describe the schema. Table names, column names, types and key definitions can themselves contain sensitive information; review the diagram before sharing it. The original file on your device is unaffected.

## Build an app from the schema

**Build with Lovable** includes recognized table names, ordered columns/types, nullability, primary and unique keys, and foreign-key column pairs/actions through a typed schema allowlist. Missing table definitions and unresolved referenced columns remain explicit. These are data-model requirements, not invented workflow transitions. Source scripts and data rows are not included. Review the complete prompt and add your own application instructions before opening Lovable. See [Lovable handoff](LOVABLE.md) and [privacy](PRIVACY.md).
