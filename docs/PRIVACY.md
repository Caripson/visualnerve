# How Visual Nerve stores your data

The application can be publicly hosted. Your workspace is stored in the browser profile where you created it. No account is required and no cloud database automatically receives diagrams. Other visitors to the same URL cannot see your work. Exports and the optional Lovable handoff let you explicitly share a copy.

The website delivers app files. The browser saves diagrams, nodes, relationships, owners, metadata, preferences, viewport, user templates, original CSV cells, analysis choices and imported SQL schema/query structure in IndexedDB. React holds active working state. **Saved** means a local transaction completed.

```text
Visual Nerve website → your browser → IndexedDB
```

## Encrypted app release under review

The separate `app.visualnerve.com` implementation encrypts all private IndexedDB
records with AES-256-GCM, including sources, settings, history and simulation
archives. It requires browser-only password setup and unlock before private
access. Keys remain in memory; a shared session boundary applies to UI, storage,
workers, API and MCP. Automated calls do not renew human inactivity, and no
programmatic unlock or server password reset exists. The surface has no
Analytics or marketing execution.

This release is under review. The published `www.visualnerve.com/app/` still uses
readable local records. An explicit encrypted export and fully verified transfer
moves existing work without deleting the source or synchronizing origins. Small
vault/session and asset-cache coordination metadata remain readable technical
exceptions without workspace content. [Storage/session schema](ENCRYPTED_WORKSPACE_SCHEMA.md).

Complete UI backups on the isolated surface are encrypted; API/MCP semantic
exports and ordinary diagram exports intentionally provide readable copies.
Older files keep their original credentials. A password change keeps the content
key; a separate human-only incident operation rotates that key for current
records but cannot recall old copies. Keep recovery material separately and
review what you share. [Backup and incident procedures](../hugo/content/help/settings.md).

## Required acceptance

A checkbox and **Accept and continue** require explicit acceptance of local storage and offline app caching before the workspace opens. Escape, backdrop clicks, declining and shortcuts cannot bypass it. Without acceptance, no diagrams load or are created and no offline cache is installed in a new profile. The app opens the empty database schema to check prior acceptance; templates and preferences are seeded afterward. Browsers may independently cache ordinary downloaded HTTP files.

On the isolated app, the password gate precedes this consent screen. Opening
technical vault metadata while locked does not seed private templates, open
legacy records or grant connected tools access.

Acceptance is saved in IndexedDB, never inferred from a visit, old informational acknowledgement or imported backup. Deleting all local data removes acceptance too. The guide and privacy page remain readable without using the workspace. The service requires local storage.

## Separate browsers and devices

Another browser, profile, device or private window has independent storage even at the same URL. Nothing automatically synchronizes. Return with the same browser profile and origin; changing scheme, hostname or port opens separate storage. Public app hosting does not make content public.

## Backups and moving work

**Settings → Data & Privacy → Export all data** downloads a complete workspace backup: diagrams, nodes, connections, all owners, portable settings, templates, CSV datasets, history, simulation archives, schema version and export date. On the legacy workspace, `visual-nerve-backup-YYYY-MM-DD.json` is readable JSON. On the isolated encrypted app, the download is an authenticated encrypted backup requiring its matching password or recovery key. Both exclude integration credentials/grants, storage acceptance, local identity and the browser-local import-byte and ZIP source-file limits. You control where the downloaded file is kept. Visual Nerve never uploads it. Share a backup only when you intend to share its content.

**Restore backup** previews Merge (keep current projects and add imported work) or Replace (remove current data first, with explicit confirmation). Identity collisions are remapped; invalid data rolls back all tables. Replace disables MCP. Both modes ignore imported browser-local import limits and retain the destination's own settings. Import cannot grant tools access or accept storage for you. Export diagram is separate: one diagram as readable PNG/PDF/SVG/Markdown/JSON.

After ten diagrams, a subtle reminder appears if no complete export has been recorded. It can be dismissed permanently in that local workspace; it sends no notifications.

## Import size preference

Local imports default to 50 MiB. **Settings → Import file size → Maximum import file size (MB)** accepts whole numbers from 50 to 1024; **Save import limit** keeps the preference only in this browser. MB in the UI means MiB, and 1024 MB is 1 GB. Imports up to 50 MB are supported and guaranteed; higher limits are experimental and may be slow or fail because of browser memory or format constraints. Changing this limit does not upload source, retain temporary SQL/code/XML drafts or change the bridge's 32 MiB JSON/WebSocket envelope.

## Browser storage lifetime

Clearing site data, resetting a profile or uninstalling the browser may remove work. Private/incognito storage may disappear when its session ends. There are no unreliable private-mode detection tricks.

Storage details shows `navigator.storage.estimate()` when available, including cached app files. After creating a diagram, users can request `navigator.storage.persist()`. Browsers may grant or decline; no first-load request occurs. Persistent storage can reduce automatic eviction under pressure but cannot prevent manual clearing or guarantee retention. See [MDN storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) and [persistent storage](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist). Export for an independent copy.

## SQL schema import

SQL/DDL files and pasted scripts are read locally and analyzed in a Web Worker. No statement is executed or sent to a database. The script remains a temporary dialog draft. DDL diagrams save recognized table/column types, nullability, keys and foreign-key relationships; INSERT/COPY values, defaults, CHECK expressions and procedure bodies are excluded. ENUM labels within a data type can remain as schema structure.

SELECT/WITH diagrams save source aliases/scopes, output expressions, JOIN conditions, clauses and column lineage. **Expression and filter literal values are retained**, including strings or identifiers that may be sensitive. Comments and the complete original source script are not saved. JSON/backups retain extracted schema/query structure, and Markdown or the Lovable prompt includes recognized query expressions through a typed allowlist. Review exports and sharing previews. The original file stays on your device. Optional API/MCP SQL preview and creation pass the source transiently through your loopback bridge to the browser; the server does not store it. See [SQL import](SQL_IMPORT.md).

## Presentation narration and model downloads

Numbered walkthroughs save their sequence and timings in the diagram. Node descriptions remain local and are sent only to the local speech worker for neural synthesis; no narration text, title or diagram data is uploaded to a speech service. Playback progress, subtitle visibility and generated narration WAVs are transient, with no WAV persistence in IndexedDB, JSON exports or workspace backups. Descriptions exceeding 12,000 characters fail explicitly without truncation.

Audio and preloading start disabled. Explicit audio playback, video export with audio, **Preload**, or **Settings → Presentation voice → Preview voice** may download fixed voice models and configuration assets, approximately 60–131 MiB per voice, from versioned external model URLs. The requests contain no diagram content, but the model host can see ordinary request metadata such as model choice and IP address. Inference runs locally after loading the model and can work offline with cached assets.

Voice models use a separate versioned CacheStorage cache; **Settings → Presentation voice → Clear downloaded voices** removes it. These binaries are separate from diagram storage and excluded from backups. Runtime controls and subtitle descriptions use the same current native nodes in 2D and 3D. REST/MCP GETs permit read access; all playback, navigation, audio/subtitle/preload changes require accepted storage and write access.

Walkthrough video export renders the numbered sequence locally and inserts narration offline, without screen capture or audible playback. Temporary frame, audio and encoded-video buffers are excluded from IndexedDB, JSON and workspace backups. The completed MP4 or WebM downloads in the browser; REST/MCP receives transient export state and no video bytes. Starting and cancelling video export require accepted storage and write access; GET status permits read access. Saved diagram content is unchanged. Keep the tab visible; manual camera interaction or diagram edits cancel. Files are capped at 256 MiB and final timelines at 30 minutes, with explicit errors rather than truncation.

Full walkthrough preloading can retain narration beyond its 32 MiB prepared-clip RAM cache in an encrypted temporary CacheStorage cache, up to a 1 GiB aggregate ciphertext ceiling, including IV/tag overhead, subject to browser quota. Its AES-256-GCM key is held only in RAM, separate from the workspace key; persisted entries use random identifiers and contain no readable narration or key. Closing the presentation, content or voice changes and workspace lock revoke the key and clean up the cache. Reload cannot recover it. A crash may leave unusable ciphertext; Clear app cache removes those owned temporary caches. These clips are not part of IndexedDB, diagram exports or workspace backups.

## Optional MCP

```text
Codex → local MCP bridge → active browser → IndexedDB
```

MCP is Off by default; users explicitly choose Read only or Read + write. This grants connected tools access to diagram content, and optionally edits. Choose the tools you grant access to. Tools may handle received content under their own settings; Visual Nerve sends responses only through the local connection.

The bridge binds to localhost, checks exact trusted app origins and forwards commands in memory. The browser uses the same validation and transactions as the UI. Read-only access permits reads, export and exact SQL/code/diagram-file preview, and rejects mutations and grant escalation. Preview analyzes supplied input without saving a graph; creating a diagram requires write access. The bridge cannot read IndexedDB independently, read graphs from S3, store a second copy or fall back to another database. Off, disconnection and browser closure produce clear errors. See [setup](DEPLOYMENT.md#optional-local-mcp).

Settings distinguishes the current website and its documentation from the local MCP HTTP address and browser WebSocket address. Copied connection instructions omit the session token and contain no diagram records. MCP documentation discovery reads only the bundled public guide/OpenAPI and works without browser content access; Off still blocks workspace commands. The documentation tool/resources make 2D and optional 3D discoverable without sending content to an external documentation service.

## Network requests and deletion

Normal editing at `/app/` and reading Help/API documentation download same-origin static files, with no analytics, content telemetry, remote fonts or automatic error reporting. Normal editing uploads no graph title, owners, metadata or export content. The optional bridge is restricted to literal loopback hosts and explicit grants. Hosts may log ordinary file requests and client IPs; diagram data is not included.

Public product pages can optionally use Google Analytics when a real Measurement ID is configured and the visitor explicitly accepts through the locally bundled Klaro consent manager. Rejection is the default; neither the Google tag nor denied-mode pings load before consent. Only the public page origin/path and a fixed title are supplied. Query strings, fragments, referrers, diagram contents and source files are excluded. Analytics is never loaded in `/app/`, `/help/` or `/api/docs/`, including when consent was previously accepted. Advertising signals are disabled; the Analytics property must also have Enhanced Measurement disabled and no Connected Site Tags or custom automatic events reading page URLs or content. These account settings cannot be verified from a Measurement ID alone. Google still receives ordinary request metadata, including the visitor's IP and browser details. See [website privacy](../hugo/content/privacy.md) and [website configuration](WEBSITE.md).

**Cookie settings** lets visitors change the optional 30-day website choice. Withdrawal blocks the tag, expires accessible `_ga` cookies and reloads the public page to remove already-loaded listeners. Website consent is separate from required workspace-storage acceptance and is excluded from workspace backups. If no Analytics ID is configured, no optional tag runs and Cookie settings explains this. Neither rejection nor withdrawal deletes diagrams or retracts requests already sent to Google.

**Build with Lovable** creates an app brief locally and shows its complete text before you share it. Opening the dialog sends nothing. **Open in Lovable** opens `lovable.dev` with that text in a URL fragment; Lovable reads the prompt and you press **Send** there to start building. The brief includes your instructions and chosen objects, written descriptions, notes, responsibilities and relationships. CSV column schema, analysis choices and calculated summaries may be included, as may recognized SQL tables/columns/keys, foreign-key pairs/actions and query aliases/expressions/joins/clauses through typed allowlists. Missing SQL definitions and unresolved references remain explicit. Source rows and complete raw SQL scripts, arbitrary metadata, owner emails, bridge tokens and workspace credentials are excluded. Query expressions and filters retain literal values. User-written text and schema names/type labels are included as shown; review them before sharing. Your draft instructions stay in IndexedDB with the diagram. [Handoff details](LOVABLE.md).

**Delete diagram** removes one project. **Settings → Delete all local data** requires confirmation and removes all projects, owners, custom templates, settings and acceptance. It cannot be undone without an exported backup. Built-in templates are reseeded. App code caches and downloaded files are separate; deletion does not erase backups outside the browser.

Audit evidence: [REQUIREMENTS.md](REQUIREMENTS.md), [ACCEPTANCE.md](ACCEPTANCE.md).

## Source code import

Source files, folders and pasted scripts are analyzed locally in a cancellable worker. Nothing is executed, installed or sent to a remote analysis service. Source is a temporary draft: diagrams save recognized names, paths, line numbers, structural identifiers, bounded summaries, dependency evidence and confidence. Complete source, comments and nonstructural literal values are not saved. Quoted resource/table/import/field names can remain as structural identifiers. Identifiers and paths may still be sensitive. User-added notes/descriptions follow normal storage/export behavior.

JSON and backups preserve this recognized structure, and Markdown/Lovable share allowlisted summaries with confidence. Review the preview before sharing. The optional local API/MCP passes supplied code transiently over the loopback bridge to the browser, without server storage. Read-only access permits exact code preview and language discovery; saving a code diagram requires write access. No source refresh runs in the background.

## Draw.io and Visio import

`.drawio` XML and `.vsdx` ZIP files are analyzed locally in a cancellable worker. Preview retains a temporary draft with page graphs and warnings, without storing or opening a diagram. Creation saves only the selected page as ordinary editable nodes, relationships, text, geometry and safe absolute HTTP(S) links. Complete XML/ZIP source, archive entries, embedded image bytes and unselected pages are not retained. Images, macros, scripts and external relationships are never fetched or executed; legacy `.vsd` and macro-enabled `.vsdm` are unsupported.

Recognized names, text, links and graph provenance can remain in IndexedDB, JSON/backups and normal typed text exports. Review them before sharing. Native shapes and connector routing may be simplified; import warnings describe limitations. The optional REST/MCP preview/import passes source transiently through the loopback bridge and stores nothing on the server. Exact preview permits read-only access; saving requires write access and consent/grants are checked again after analysis. Revocation cancels pending work. See [diagram file import](DIAGRAM_IMPORT.md).

## Versions, scenes and understanding

Named local versions and checkpoints retain removed objects and CSV source rows until those snapshots or their diagram/workspace are deleted. Full workspace backups include this history; removing a current source alone does not delete rows referenced by history. Scene definitions and reviewed app requirements are saved with the diagram. Playback selection, overview navigation and generated audio remain transient.

Relationship questions inspect retained structural evidence without executing code/SQL or including raw CSV rows. An explicit CSV measure-evidence request through MCP can return original cells; app briefs exclude original rows. Exact question and app-brief previews permit Read only and do not save or send to an external service. Reviewed descriptions and requirements are included when you explicitly share the Lovable brief.
