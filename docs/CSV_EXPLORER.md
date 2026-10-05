# CSV exploration

Drop a CSV on the workspace or choose Import. Quoted fields, multiline cells, BOMs, comma/semicolon/tab separators and duplicate column names are supported. Stable column IDs distinguish duplicate labels. Cells remain strings so identifiers with leading zeros survive.

Configure the preview before creating a diagram:

1. Clean columns with whitespace trimming, a regex replacement or explicit decimal formatting. For `310293 - Företag`, use `^\d+\s*-\s*` with an empty replacement. Original values are preserved.
2. Filter rows, for example Company starts with AAA. Multiple filters use AND. Text filters ignore case by default; numeric filters use the selected number format.
3. Choose ordered grouping columns, such as Region → Customer → Product.
4. Choose count, sum, average, median, minimum, maximum and distinct count. Empty or invalid numbers are excluded from numeric calculations and reported separately. Count includes every matching source row.
5. Choose a group limit and sort by name, count or a measure. The preview and diagram measures use all matching rows, including those in groups outside the visible page.

Automatic number recognition accepts `1.234,56`, `1,234.56`, `12,50`, `12.50`, spaces and signs. A single separator with three trailing digits is ambiguous (`1,234`); select decimal dot or decimal comma for that column instead of silently guessing. The selected format also applies to numeric filters.

## Diagram interaction

The result is a mind map with real canonical nodes and edges. Move and rename nodes, add normal diagram objects and relationships, change labels, direction and styles, and use undo/redo. Existing objects and connection identities survive regrouping. Groups outside the current CSV view are retained but hidden, along with connections to hidden endpoints. Bringing a group back restores its connections and edits. Copies of CSV cards are ordinary manual objects. Within the same data diagram they retain access to source rows; in another diagram they preserve the measures as a snapshot without copying raw rows. Deleted or reconnected group connections remain changed when the analysis is regenerated, including changes made through the local API.

Click a group to choose visible measures and source columns. Show source rows previews up to 100 matching rows, with an Original values toggle. Explore this group focuses its source path; All data removes that focus. Previous/Next groups pages the current level. Change grouping and measures reopens the configuration preview.

PNG/PDF export renders the current data view and its connections. Diagram JSON and full workspace backups include original source cells, settings and retained hidden objects. Reopening, Merge and Replace preserve dataset references; deleting a diagram also deletes its source.

## Scale and storage

Import supports at most 50 MiB, 200,000 data rows, 200 columns and 10 million cells. One view shows at most 600 generated objects, with up to 200 groups per level and a bounded history of 12,000 retained data objects. Reduce depth or explore a group when a view is dense. Files beyond these limits produce an actionable error rather than partial aggregates.

Parsing, cleanup, filtering, profiling and aggregation run in a reusable Web Worker. Its source cache avoids resending all rows for every control change; stale results are discarded. A ten-second watchdog terminates expensive work, including pathological regex patterns, and the next request starts a fresh worker. Rendering and interaction remain on the main thread. Worker use requires a browser with Web Worker support.

Raw strings are stored once in the IndexedDB datasets store (schema 5), separate from diagram objects. Ordinary edits do not copy the entire source to storage. Analysis choices persist in diagram settings. Browser quota still depends on the device; export backups to keep a portable copy. No CSV content is uploaded to S3 or another data service.

The automated tests cover 100,000 rows / 2,000 customers, cleanup before grouping/filtering, numeric formats and invalid values, parent-level median/average, paged measures, hidden and restored relationships, source previews, schema upgrades and lossless backup/import. Performance figures in test output describe that test machine, not a guarantee for every browser or a comparison benchmark against Excel.
