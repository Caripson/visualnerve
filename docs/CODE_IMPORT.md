# Visualize source code and dependencies

Use **Visualize code** to paste a script, choose several source files, select a folder, or import a **ZIP project**. Choose the language for pasted text and for ambiguous extensions, then preview and review the objects, connections and analysis notes before **Create diagram**. A single `.sql`/`.ddl` drop still opens the more detailed SQL importer. SQL can also participate in a mixed code project.

The automatic detail level uses **Declarations and dependencies** for a pasted script or a single source file, and **File overview** for multiple files. **File overview** starts with one card per file and connections between files or external dependencies. **Declarations and dependencies** adds recognized functions, classes, types, resources, measures and query parts. **Folder relationships** creates directory cards with descendant file counts and languages. Dependencies between files in different folders are combined into folder connections with `occurrences`; same-folder dependencies stay available in File overview. You can choose any view explicitly. For example, a single COBOL program displays its program, recognized paragraphs and file resources with their calls and reads/writes; choosing File overview intentionally reduces it to a file card. **Focus** matches a case-insensitive substring in paths or object names and includes immediate related objects. For example, import a project and focus on `billing` to examine its neighboring dependencies. The diagram's existing relationship explorer can then inspect neighbors and paths or save a named perspective. Changing the input cancels and invalidates the preview.

These are editable native diagram objects. Move and connect them, annotate, assign status, use the pen, switch between 2D and 3D, and export the canonical 2D layout to PNG/PDF. Select an object for its language, original file and source line. Select a connection for its relationship kind, confidence and file/line evidence. Renaming a card does not rewrite the source. Reconnecting an analyzed edge removes its stale source evidence; undo restores it.

In 2D, scroll inside a code card to read its retained identifiers, full file path, source line range and declaration summary. Long names and paths wrap. The summary shows every saved entry rather than only the first six; file cards retain at most the first 200 recognized declaration names. Choose **Declarations and dependencies** to inspect individual declarations beyond that file-card summary. Focus the scroll area to use the keyboard, and drag the card by its header to move it.

Select a code card to reveal its corner resize handles. Enlarge it to show more details at once; resizing is undoable and saves the same width, height and position used after reload and in 3D. Scroll position is temporary. 3D faces and PNG/PDF/video exports show the top of the card at its saved size, without interactive scrolling. Enlarge the card in 2D before exporting when more details need to fit; JSON preserves all retained metadata regardless of the visible area.

## What support means

The analyzers recognize common source structures using bounded lexical and syntax patterns. They do not compile, execute, install packages, contact databases, run build scripts or resolve complete type systems. Every supported language has a language-specific extraction path; the catalog is also available through the local API. This first version is a structural outline, not a complete parser for every dialect or a verified runtime call graph.

Connections have three confidence levels:

- **Syntax**: a recognized containment/import/reference or other explicit source construct.
- **Heuristic**: a possible connection inferred from names and source structure.
- **Unresolved**: a dependency is outside the imported files, ambiguous or cannot be bound safely.

External objects remain visible. An imported name is not evidence that its source is available. Overloaded names, dynamic dispatch, reflection, generated code, macros, conditional imports, unusual multiline declarations and embedded languages can be incomplete. Comments and ordinary strings are excluded from code recognition. Review the notes; the tool does not silently claim compiler certainty. Unresolved relationships are drawn dashed. File dependencies are derived from the supplied project files, not from a filesystem crawl.

| Language | Recognized structures and relationships |
| --- | --- |
| Python | Classes/functions, imports, possible calls |
| JavaScript | Classes/functions, module imports, possible calls |
| TypeScript | Types/classes/functions, module imports, possible calls |
| Java | Classes/methods, imports, possible calls |
| C# | Classes/methods, using directives, possible calls |
| C++ | Types/functions, includes, possible calls |
| C | Functions/types, includes, possible calls |
| SQL | Queries, table references and data dependencies |
| Go | Types/functions, imports, possible calls |
| Rust | Types/functions, use/mod dependencies, possible calls |
| PHP | Classes/functions, includes/imports, possible calls |
| Kotlin | Classes/functions, imports, possible calls |
| Swift | Types/functions, imports, possible calls |
| Bash / Shell | Functions, sourced scripts and possible commands/calls |
| R | Function assignments, library/source dependencies, possible calls |
| Dart | Classes/functions, imports, possible calls |
| Ruby | Classes/methods, require dependencies, possible calls |
| PowerShell | Functions, module/script dependencies, possible commands/calls |
| DAX | Measures, table and measure references |
| Power Query M | Let steps and dependencies between steps |
| VBA | Procedures/classes and possible calls |
| Scala | Types/methods, imports, possible calls |
| Lua | Functions, require dependencies, possible calls |
| MATLAB | Functions/classes and possible calls |
| Objective-C | Classes/methods, imports/includes, possible calls |
| Perl | Subroutines/packages, use/require dependencies, possible calls |
| Groovy | Classes/methods, imports, possible calls |
| Visual Basic / VB.NET | Classes/procedures, imports, possible calls |
| Julia | Types/functions, using/import/include dependencies, possible calls |
| Elixir | Modules/functions, use/import/alias dependencies, possible calls |
| Solidity | Contracts/functions, imports, possible calls |
| Haskell | Types/bindings, imports, possible references/calls |
| F# | Types/bindings, open dependencies, possible references/calls |
| Clojure | Namespaces/definitions, require dependencies, possible calls |
| T-SQL | Queries, procedure outline and table dependencies |
| PL/SQL | Queries, package/procedure outline and table dependencies |
| SAS | Data/procedure steps and input/output datasets |
| Apex | Classes/methods, possible calls |
| ABAP | Classes/methods/forms, calls and table dependencies |
| COBOL | Programs, numbered paragraphs, calls and file reads/writes (FD record mappings) |
| Fortran | Modules/procedures, use dependencies and possible calls |
| Assembly | Labels, include dependencies and calls/jumps |
| Delphi / Object Pascal | Units/types/procedures, uses dependencies, possible calls |
| GDScript | Classes/functions, preload/load dependencies, possible calls |
| GraphQL | Operations/fragments/types, schema fields and named references |
| MDX | Measures, cubes and bracketed references |
| Cypher | Query patterns, labels and named relationships |
| Vega / Vega-Lite | Named datasets, transforms and data references |
| HCL | Resources/modules/variables/outputs and references |
| Nix | Bindings, imports and references |
| Markdown | Local inline/reference/wiki links between supplied documents; code examples, images and external URLs are excluded |

Filename, extension, shebang and conservative content patterns identify project languages. Extensions such as `.m` (MATLAB, Objective-C or Power Query M), `.h` and `.cls` need an explicit language when the content is inconclusive. This browser implementation does not run GitHub Linguist or claim compiler-level classification. Use `tsql`/`plsql` for SQL dialect scripts; `.sql` alone selects SQL. Vega files can use `.vg.json`, `.vl.json`, `.vega.json` or `.vegalite.json`; ordinary diagram JSON remains diagram import. There is no automatic execution or package discovery.

## Import a complete project archive

Choose **Load ZIP project** in Visualize code, or drop one `.zip` on the application. The browser scans and reads the archive in a cancellable worker. Progress reports the scan/read stage and percentage; its summary explains excluded entries. If there is one common wrapping folder, it is removed from every relative path. Review detected languages, choose the diagram detail and preview before creating.

Dependencies (`node_modules`, `vendor`, virtual environments), build output, version-control directories, common private files (`.env`, keys, credentials), binary files, generated output and unsupported files are excluded from analysis. This is a bounded filter, not a guarantee that arbitrary source contains no secrets. Only supplied files are analyzed. No code is executed, packages installed, files written to disk, or linked documents fetched.

Compressed ZIP bytes and the complete verified expanded archive must each fit the selected import limit, including entries excluded from analysis. ZIP archives are limited to 10,000 total entries, including ignored files and explicit directory records. The analyzed source-file limit defaults to 500 and can be raised to an integer from 500 to 10,000 in **Settings → ZIP project source-file limit**, saved with **Save ZIP file limit**. Only projects up to 500 analyzed source files are supported and guaranteed; larger projects are experimental and may be slow or fail. Settings and import drafts/previews show the warning. The job captures this browser-local preference once before scanning; change Settings and reload the ZIP to change that budget. Raising it does not increase any other safety limit, and explicit directory/ignored entries can leave fewer than 10,000 usable source files. Too many source files fail clearly rather than silently producing a truncated project. Every file's size and checksum are verified. Unsafe/duplicate paths, symlinks, encryption, ZIP64, unsupported compression, overlapping entries and corrupt data are rejected. ZIP scanning has a two-minute deadline; the subsequent analysis retains its 30-second deadline. The exact ZIP API routes allow 165 seconds across both stages and saving. The server response write budget is 210 seconds, including bounded request-body reading; clients must also allow enough request time.

A ZIP can contain code, Markdown, or both. Markdown links resolve relative to the containing document, or from the supplied project root when prefixed with `/`. Percent-encoded paths and fragments are decoded; supported heading, HTML and line anchors are checked against the target document. Missing targets/anchors, ambiguous wiki targets and paths outside the supplied project remain unresolved; external web URLs and image links do not create project dependencies. Inline, reference and `[[wiki links]]` are supported. A single Markdown drop continues to use the existing diagram importer; use ZIP, a folder, several Markdown files, or Visualize code for a linked-document analysis. `.mdx` remains the existing MDX/OLAP analyzer.

Folder nodes use `metadata.projectDirectory` (`version`, `path`, descendant `fileCount`, `languages`), distinct from `metadata.codeObject`. Root is `.`. Aggregated relationships retain confidence, a representative source location and `occurrences`. `diagram.metadata.codeAnalysis` also records optional `directoryCount` and `project` scan provenance (`name`, `expandedBytes`, `ignoredEntries`, categorized counts, optional captured `sourceFileLimit`). These records survive native JSON, backups and the bounded Markdown/Lovable handoff. Source text and archive bytes are temporary and are not saved.

## Size and responsiveness

Analysis and layout run in a cancellable Web Worker. The default decoded UTF-8 limit is 50 MiB per file and 50 MiB for the whole source project. Both use the selected limit from **Settings → Import file size → Maximum import file size (MB)**: a whole number from 50 to 1024, saved with **Save import limit**. The UI uses MB for MiB; 1024 MB is 1 GB. Imports up to 50 MB are supported and guaranteed; higher limits are experimental and may be slow or fail because of browser memory or format constraints. The preference stays in this browser and is excluded from backups.

Non-ZIP source-file/folder imports remain limited to 500 files. ZIP projects use their independently captured source-file preference. Other limits remain 10,000 extracted symbols, 5,000 diagram objects and 10,000 connections. Source is limited to 100,000 lines per file, 500,000 lines per project and 20,000 characters per line; excess structure fails clearly. A preview has a 30-second deadline. Large diagrams use a predictable layout rather than an unbounded layout calculation. Start with files and use focus or the relationship explorer to avoid showing every symbol at once. Limits apply to the source project too; focus does not authorize an unlimited import.

## Local data and exports

The original source is an ephemeral import draft. Creating a diagram saves extracted names, paths, source lines, structural identifiers, summaries, confidence, relationship evidence and import notes in IndexedDB. It does not save complete source, comments or ordinary string/number values. Quoted names that identify tables, resources, imports or fields are structural identifiers and may remain. Paths and identifiers can still be sensitive. Source files are not attached to backups and are not kept for automatic re-analysis; edit and import again after source changes.

Native diagram JSON and full workspace backups preserve the recognized metadata. Clipboard copies remap actual object/edge IDs while retaining the original source provenance. Markdown and the Lovable prompt include only the recognized code contract through explicit allowlists, including uncertain relationships. Lovable sharing remains an explicit reviewed handoff. User-added descriptions and notes follow normal export behavior. No IndexedDB schema upgrade is needed.

## API and MCP

Start the optional local bridge and grant access in the open browser. The public S3 site does not expose a code-analysis API. `GET /code/languages` lists the 50 code language IDs plus `markdown`, extensions and capabilities. Read-only access permits the exact `POST /code/preview` endpoint; `POST /code/diagrams` requires write access and saves/opens the result transactionally.

Omitting `mode` uses `"symbols"` for one supplied file and `"files"` for multiple supplied files, matching the UI's automatic detail level. Explicit `mode:"files"`, `mode:"symbols"` or `mode:"folders"` overrides that choice. Preview and `diagram.metadata.codeAnalysis.mode` report the resolved mode; no `"auto"` value is stored or accepted by the API. Existing diagrams retain their saved detail level and are not automatically re-analyzed.

```json
{
  "name": "Billing dependencies",
  "mode": "symbols",
  "focus": "billing",
  "files": [
    {"path": "billing.py", "language": "python", "content": "from utils import clean\ndef invoice():\n    clean()\n"},
    {"path": "utils.py", "language": "python", "content": "def clean():\n    return 1\n"}
  ]
}
```

Preview returns `graph`, `version`, `languages`, `mode`, `fileCount`, `symbolCount`, `dependencyCount`, `unresolvedCount`, `warnings` and optional `focus`. Create returns the canonical `Graph`. Files have unique relative paths; unknown fields and unsupported IDs are rejected. The browser rechecks consent and grants before the first write and cancels pending analysis when access is revoked. Source crosses the loopback bridge transiently; it is not stored by the Go server. JSON and WebSocket envelopes remain limited to 32 MiB regardless of the import preference; source and responses must fit after JSON escaping. See [API](../API.md) and [data model](../DATA_MODEL.md).

Code cards use the existing node geometry contract. Read `GET /nodes/{nodeId}`, then send `PATCH /nodes/{nodeId}` with its current `version` and the desired `width`/`height`; include `x`/`y` when repositioning. Geometry-only changes preserve `metadata.codeObject` and connection evidence. For nodes with an assigned `externalId`, `POST /diagrams/{diagramId}/bulk` with `upsert:true`, the current diagram `baseVersion` and matching node external IDs can update several sizes atomically. Imported code nodes initially have UUIDs without external IDs, so use node PATCH for them. Resizing needs write access; it introduces no new endpoint or metadata schema.

### ZIP through REST or MCP

`GET /code/capabilities` discovers independent source-file, ZIP-entry, byte, line, graph and time limits. `GET /settings/project-source-file-limit` returns this browser's effective integer (default 500 when missing/invalid) and permits Read only. `PUT /settings/project-source-file-limit` accepts exact `{ "value": 1000 }`, requires Read + write, and rejects invalid values with 422. Source payloads cannot specify a file-limit override. This preference is excluded from backups and ignored during Merge/Replace so the destination's setting is retained. Existing larger diagrams remain valid when the setting returns to 500.

`POST /code/project/preview` accepts `{data,name?,mode?,focus?,languages?}`. `data` is strict base64 ZIP bytes without a data-URL prefix. ZIP imports default to `files`, including one-file archives. After reviewing the returned `CodeImportResult`, send the same payload to `/code/project/diagrams` with write access to save/open its `Graph`. Both use the same scan and analysis as the UI. Read-only mode permits only the exact preview route; consent/access are rechecked before saving, and revocation cancels pending work.

```json
{
  "path": "/code/project/preview",
  "method": "POST",
  "data": {"name": "Service architecture", "data": "<BASE64_ZIP_BYTES>", "mode": "folders"}
}
```

The 32 MiB JSON/WebSocket envelope includes base64 and request metadata. Therefore an integration ZIP must be below approximately 24 MiB compressed (and often smaller); raising Settings does not raise this transport limit. Use the UI for larger bounded archives. The source-files endpoints remain available, including `language:"markdown"` and `mode:"folders"`.

## Implementation boundaries

`frontend/src/code` separates the public contract/catalog, lexical helpers, program-language families, specialized query/BI/infrastructure/legacy families, graph assembly, layout and worker lifecycle. `frontend/src/imports` owns file classification and application import routing. Code import dialog, file list, language selector, preview, card summary and Properties sections are separate components. `storage/analysis-commands.ts` owns SQL/code import endpoints and their shared guarded save boundary. General CRUD stays in Repository; backend OpenAPI code/SQL/spatial schemas and MCP descriptions have their own files.

ZIP API language overrides use `languages:{"src/header.h":"c"}` with exact retained paths after wrapping-folder removal. Unknown/excluded paths and unsupported IDs are rejected. Preview again with these overrides if detection is inconclusive, matching the UI language selectors.
