# Visualize source code and dependencies

Use **Visualize code** to paste a script, choose several source files, or select a folder. Choose the language for pasted text and for ambiguous extensions, then preview and review the objects, connections and analysis notes before **Create diagram**. A single `.sql`/`.ddl` drop still opens the more detailed SQL importer. SQL can also participate in a mixed code project.

**File overview** starts with one card per file and connections between files or external dependencies. **Declarations and dependencies** adds recognized functions, classes, types, resources, measures and query parts. **Focus** matches a case-insensitive substring in paths or object names and includes immediate related objects. For example, import a project and focus on `billing` to examine its neighboring dependencies. The diagram's existing relationship explorer can then inspect neighbors and paths or save a named perspective. Changing the input cancels and invalidates the preview.

These are editable native diagram objects. Move and connect them, annotate, assign status, use the pen, switch between 2D and 3D, and export the canonical 2D layout to PNG/PDF. Select an object for its language, original file and source line. Select a connection for its relationship kind, confidence and file/line evidence. Renaming a card does not rewrite the source. Reconnecting an analyzed edge removes its stale source evidence; undo restores it.

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
| COBOL | Programs/paragraphs, files and calls |
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

Extensions such as `.m` (MATLAB, Objective-C or Power Query M), `.h` and `.cls` are ambiguous and require an explicit language. Use `tsql`/`plsql` for SQL dialect scripts; `.sql` alone selects SQL. Vega files can use `.vg.json`, `.vl.json`, `.vega.json` or `.vegalite.json`; ordinary diagram JSON remains diagram import. There is no automatic execution or package discovery.

## Size and responsiveness

Analysis and layout run in a cancellable Web Worker. The default decoded UTF-8 limit is 50 MiB per file and 50 MiB for the whole source project. Both use the selected limit from **Settings → Import file size → Maximum import file size (MB)**: a whole number from 50 to 1024, saved with **Save import limit**. The UI uses MB for MiB; 1024 MB is 1 GB. Imports up to 50 MB are supported and guaranteed; higher limits are experimental and may be slow or fail because of browser memory or format constraints. The preference stays in this browser and is excluded from backups.

Other limits remain 500 files, 10,000 extracted symbols, 5,000 diagram objects and 10,000 connections. Source is limited to 100,000 lines per file, 500,000 lines per project and 20,000 characters per line; excess structure fails clearly. A preview has a 30-second deadline. Large diagrams use a predictable layout rather than an unbounded layout calculation. Start with files and use focus or the relationship explorer to avoid showing every symbol at once. Limits apply to the source project too; focus does not authorize an unlimited import.

## Local data and exports

The original source is an ephemeral import draft. Creating a diagram saves extracted names, paths, source lines, structural identifiers, summaries, confidence, relationship evidence and import notes in IndexedDB. It does not save complete source, comments or ordinary string/number values. Quoted names that identify tables, resources, imports or fields are structural identifiers and may remain. Paths and identifiers can still be sensitive. Source files are not attached to backups and are not kept for automatic re-analysis; edit and import again after source changes.

Native diagram JSON and full workspace backups preserve the recognized metadata. Clipboard copies remap actual object/edge IDs while retaining the original source provenance. Markdown and the Lovable prompt include only the recognized code contract through explicit allowlists, including uncertain relationships. Lovable sharing remains an explicit reviewed handoff. User-added descriptions and notes follow normal export behavior. No IndexedDB schema upgrade is needed.

## API and MCP

Start the optional local bridge and grant access in the open browser. The public S3 site does not expose a code-analysis API. `GET /code/languages` lists the 50 language IDs, extensions and capabilities. Read-only access permits the exact `POST /code/preview` endpoint; `POST /code/diagrams` requires write access and saves/opens the result transactionally.

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

## Implementation boundaries

`frontend/src/code` separates the public contract/catalog, lexical helpers, program-language families, specialized query/BI/infrastructure/legacy families, graph assembly, layout and worker lifecycle. `frontend/src/imports` owns file classification and application import routing. Code import dialog, file list, language selector, preview, card summary and Properties sections are separate components. `storage/analysis-commands.ts` owns SQL/code import endpoints and their shared guarded save boundary. General CRUD stays in Repository; backend OpenAPI code/SQL/spatial schemas and MCP descriptions have their own files.
