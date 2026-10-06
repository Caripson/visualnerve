# How Visual Nerve stores your data

The application can be publicly hosted. Your workspace is stored in the browser profile where you created it. No account is required and no cloud database automatically receives diagrams. Other visitors to the same URL cannot see your work. Exports and the optional Lovable handoff let you explicitly share a copy.

The website delivers app files. The browser saves diagrams, nodes, relationships, owners, metadata, preferences, viewport, user templates, original CSV cells, analysis choices and imported SQL schema/query structure in IndexedDB. React holds active working state. **Saved** means a local transaction completed.

```text
Visual Nerve website → your browser → IndexedDB
```

## Required acceptance

A checkbox and **Accept and continue** require explicit acceptance of local storage and offline app caching before the workspace opens. Escape, backdrop clicks, declining and shortcuts cannot bypass it. Without acceptance, no diagrams load or are created and no offline cache is installed in a new profile. The app opens the empty database schema to check prior acceptance; templates and preferences are seeded afterward. Browsers may independently cache ordinary downloaded HTTP files.

Acceptance is saved in IndexedDB, never inferred from a visit, old informational acknowledgement or imported backup. Deleting all local data removes acceptance too. The guide and privacy page remain readable without using the workspace. The service requires local storage.

## Separate browsers and devices

Another browser, profile, device or private window has independent storage even at the same URL. Nothing automatically synchronizes. Return with the same browser profile and origin; changing scheme, hostname or port opens separate storage. Public app hosting does not make content public.

## Backups and moving work

**Settings → Data & Privacy → Export all data** downloads `visual-nerve-backup-YYYY-MM-DD.json`: diagrams, nodes, connections, all owners, portable settings, templates, CSV datasets, schema version and export date. It excludes credentials, grants, storage acceptance and local identity. You control where the downloaded file is kept. Visual Nerve never uploads it. Share a backup only when you intend to share its content.

**Restore backup** previews Merge (keep current projects and add imported work) or Replace (remove current data first, with explicit confirmation). Identity collisions are remapped; invalid data rolls back all tables. Replace disables MCP. Import cannot grant tools access or accept storage for you. Export diagram is separate: one diagram as PNG/PDF/Markdown/JSON.

After ten diagrams, a subtle reminder appears if no complete export has been recorded. It can be dismissed permanently in that local workspace; it sends no notifications.

## Browser storage lifetime

Clearing site data, resetting a profile or uninstalling the browser may remove work. Private/incognito storage may disappear when its session ends. There are no unreliable private-mode detection tricks.

Storage details shows `navigator.storage.estimate()` when available, including cached app files. After creating a diagram, users can request `navigator.storage.persist()`. Browsers may grant or decline; no first-load request occurs. Persistent storage can reduce automatic eviction under pressure but cannot prevent manual clearing or guarantee retention. See [MDN storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) and [persistent storage](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist). Export for an independent copy.

## SQL schema import

SQL/DDL files and pasted scripts are read locally and analyzed in a Web Worker. No statement is executed or sent to a database. The script remains a temporary dialog draft. DDL diagrams save recognized table/column types, nullability, keys and foreign-key relationships; INSERT/COPY values, defaults, CHECK expressions and procedure bodies are excluded. ENUM labels within a data type can remain as schema structure.

SELECT/WITH diagrams save source aliases/scopes, output expressions, JOIN conditions, clauses and column lineage. **Expression and filter literal values are retained**, including strings or identifiers that may be sensitive. Comments and the complete original source script are not saved. JSON/backups retain extracted schema/query structure, and Markdown or the Lovable prompt includes recognized query expressions through a typed allowlist. Review exports and sharing previews. The original file stays on your device. Optional API/MCP SQL preview and creation pass the source transiently through your loopback bridge to the browser; the server does not store it. See [SQL import](SQL_IMPORT.md).

## Optional MCP

```text
Codex → local MCP bridge → active browser → IndexedDB
```

MCP is Off by default; users explicitly choose Read only or Read + write. This grants connected tools access to diagram content, and optionally edits. Choose the tools you grant access to. Tools may handle received content under their own settings; Visual Nerve sends responses only through the local connection.

The bridge binds to localhost, checks exact trusted app origins and forwards commands in memory. The browser uses the same validation and transactions as the UI. Read-only access permits reads, export and exact SQL/code preview, and rejects mutations and grant escalation. SQL preview analyzes supplied SQL without saving a graph; creating a SQL diagram requires write access. The bridge cannot read IndexedDB independently, read graphs from S3, store a second copy or fall back to another database. Off, disconnection and browser closure produce clear errors. See [setup](DEPLOYMENT.md#optional-local-mcp).

Settings distinguishes the current website and its documentation from the local MCP HTTP address and browser WebSocket address. Copied connection instructions omit the session token and contain no diagram records. MCP documentation discovery reads only the bundled public guide/OpenAPI and works without browser content access; Off still blocks workspace commands. The documentation tool/resources make 2D and optional 3D discoverable without sending content to an external documentation service.

## Network requests and deletion

Normal traffic downloads same-origin static app/documentation files. There is no analytics, telemetry, remote font/CDN script or error reporting. Normal editing uploads no graph title, owners, metadata or export content. The optional bridge is restricted to literal loopback hosts and explicit grants. Hosts may log ordinary file requests and client IPs; diagram data is not included.

**Build with Lovable** creates an app brief locally and shows its complete text before you share it. Opening the dialog sends nothing. **Open in Lovable** opens `lovable.dev` with that text in a URL fragment; Lovable reads the prompt and you press **Send** there to start building. The brief includes your instructions and chosen objects, written descriptions, notes, responsibilities and relationships. CSV column schema, analysis choices and calculated summaries may be included, as may recognized SQL tables/columns/keys, foreign-key pairs/actions and query aliases/expressions/joins/clauses through typed allowlists. Missing SQL definitions and unresolved references remain explicit. Source rows and complete raw SQL scripts, arbitrary metadata, owner emails, bridge tokens and workspace credentials are excluded. Query expressions and filters retain literal values. User-written text and schema names/type labels are included as shown; review them before sharing. Your draft instructions stay in IndexedDB with the diagram. [Handoff details](LOVABLE.md).

**Delete diagram** removes one project. **Settings → Delete all local data** requires confirmation and removes all projects, owners, custom templates, settings and acceptance. It cannot be undone without an exported backup. Built-in templates are reseeded. App code caches and downloaded files are separate; deletion does not erase backups outside the browser.

Audit evidence: [REQUIREMENTS.md](REQUIREMENTS.md), [ACCEPTANCE.md](ACCEPTANCE.md).

## Source code import

Source files, folders and pasted scripts are analyzed locally in a cancellable worker. Nothing is executed, installed or sent to a remote analysis service. Source is a temporary draft: diagrams save recognized names, paths, line numbers, structural identifiers, bounded summaries, dependency evidence and confidence. Complete source, comments and nonstructural literal values are not saved. Quoted resource/table/import/field names can remain as structural identifiers. Identifiers and paths may still be sensitive. User-added notes/descriptions follow normal storage/export behavior.

JSON and backups preserve this recognized structure, and Markdown/Lovable share allowlisted summaries with confidence. Review the preview before sharing. The optional local API/MCP passes supplied code transiently over the loopback bridge to the browser, without server storage. Read-only access permits exact code preview and language discovery; saving a code diagram requires write access. No source refresh runs in the background.
