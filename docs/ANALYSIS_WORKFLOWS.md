# Connected data and repeatable diagram analysis

Visual Nerve keeps CSV sources, diagram objects, annotations, and saved analysis
views in this browser's IndexedDB. These tools do not upload source rows or run
SQL against a database. Export a complete workspace backup before moving between
browsers or computers.

## Explore relationships

Select an object and open **Explore relationships and views** in Properties.
Choose incoming, outgoing, or all connections and one or two steps. Alternatively,
choose another object and find the shortest path, following arrow directions or
allowing either direction. Reset exploration to return to the ordinary diagram.

Exploration changes the visible diagram without deleting its objects or links.
Large results are bounded and the interface reports truncation. Groups retained
from a previous CSV view are excluded by default: explicitly including them
marks their aggregates as outside the current data view.

## Connect CSV files

Open **Explore data → Data sources**, add files, and choose the source and target columns
for each relationship. Preview the match counts, missing keys, and duplicate-key
cardinality before applying. Multiple CSV files can also be dropped on an open
diagram. When starting a new diagram, configure the first file before reviewing
the remaining sources.

Each file has its own grouping, filters, cleanup rules, and measures. Select one
of its generated objects to change those settings. **Explore this group** limits
connected sources to matching entities; **All data** resets connected focus.

Matching selects original rows rather than expanding a joined table. An order
amount contributes once even when multiple related objects share its customer
key. Display limits affect rendered groups, not totals. Source relationships are
real, editable diagram connections; manually deleted or reconnected generated
connections are not silently recreated by a later analysis.

## Save analysis views

In **Explore relationships and views**, give the current view a name and save it.
A view stores filters, source analysis configurations, relationships, entity
focus, exploration, object geometry, collapse state, and viewport. Switch views,
update an existing view, or delete a view from the same dialog.

Source rows are shared between views. Object notes, status, pen marks, and manual
connections remain current when changing perspectives. Saving and loading views
participate in undo and redo. Invalid source bindings must be resolved rather
than silently producing a different calculation.

## Refresh sources

Open **Explore data → Refresh source** and choose a source. For CSV, load the replacement
file, explicitly map its columns, and select one or more row identity columns.
Empty or duplicate identities prevent applying an ambiguous replacement. For SQL,
load a file or paste a schema script; qualified table names and foreign-key
column bindings identify the existing objects and relationships.

**Preview changes** reports added, changed, and removed data and the consequences
for diagram objects. Unambiguous surviving objects keep their identifiers,
placements, annotations, status, and manual connections. Group splits and merges
are reported instead of guessing which annotations belong to a new group.
Removed objects can remain as detached annotations or be removed with their
affected connections. Apply the reviewed update, or close to discard it.

Source refresh is undoable. A concurrent edit or another tab's change invalidates
the preview, so it cannot overwrite newer work. SQL source text and SQL data rows
are never saved as part of the imported schema.

## Explain values and inspect quality

Select a CSV object and use **Why this value?** beside a measure. The explanation
recomputes the measure with the current group, filters, cleanup, numeric formats,
and related-source scope. It shows contributing, excluded, or repeated rows in
pages, with source data-row numbers and original or cleaned cells. Paging does
not limit the calculation.

**Explore data → Data quality** checks empty cells, excluded numeric values, ambiguous
number formats, cleanup collisions, explicitly selected duplicate identity keys,
and missing referenced keys. Click a check to inspect the affected rows. Numeric
checks apply to numeric measures or explicitly formatted columns, rather than
treating every text column as invalid numbers. Duplicate identities and cleanup
collisions are diagnostic: they may be expected in transaction data and never
automatically remove rows. A row can contribute to several checks.

For SQL, the quality view reports referenced tables without definitions and
unknown referenced columns. It cannot check table data because SQL imports
contain only schema information.

Expensive parsing, matching, calculation, source refresh, and inspection run in
workers with bounded previews and timeouts. Sources are limited individually and
the connected model has an overall cell limit. Deployment remains manual.
