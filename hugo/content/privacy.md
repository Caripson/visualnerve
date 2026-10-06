---
title: "How Visual Nerve stores your data"
---

Visual Nerve can be a public website. Your diagrams stay in your browser.

The **application** is downloaded from the website. Your **content** is saved locally in this browser profile, using IndexedDB. No account is required. Visual Nerve does not upload your diagrams, node titles, owners, preferences or metadata to its host, S3, CloudFront or a cloud database. Other visitors to the same website cannot see your work.

Before the workspace opens, you must explicitly accept local browser storage and offline caching. The service cannot work without this storage. If you decline, the workspace remains closed; the guide and this page are still available. Acceptance is remembered only in this browser profile and is never imported from a backup. Diagram storage and offline app caching start after acceptance. Clearing all local data removes acceptance too, so it is requested again next time.

```text
Visual Nerve website → app files → your browser → IndexedDB
```

## Returning to your work

Use the same browser profile and website address. Another browser, profile, device or private window has its own separate workspace. The site address includes its scheme, hostname and port: changing the address can open a different local workspace. Nothing automatically synchronizes between them.

After the first visit, the app keeps its files for offline use. You can edit and save without an internet connection. **Saved** means a local save completed.

## Keep a portable copy

In **Settings → Data & Privacy**, choose **Export all data**. This downloads a dated JSON backup of all your diagrams, nodes, connections, owners, portable preferences and templates. The local import-size preference is excluded. Keep the file somewhere you choose. Visual Nerve does not upload it or create an automatic backup.

On another browser or computer, use **Restore backup**. **Merge with existing data** keeps current diagrams and adds the imported work. **Replace all local data** removes the current workspace before restoring the file and requires confirmation. Connection permissions are never imported. Both modes ignore any imported file-size preference and keep the destination browser's own limit.

**Export diagram** is a separate option for a single diagram as PNG, PDF, Markdown or JSON. Use **Export all data** for a complete restorable workspace.

Clearing this site's browser data, resetting your browser profile or uninstalling the browser may remove your work. Private or incognito browsing may use temporary storage that disappears when the session ends. Export a backup when you want a separate copy.

**Storage details** shows an estimate of site storage, when your browser supports it. Once you have a diagram, you can ask the browser to keep local data. Browser decisions vary; a grant can reduce automatic eviction under storage pressure, but cannot prevent manual clearing or guarantee retention.

## Import size preference

Local imports default to 50 MB. **Settings → Import file size → Maximum import file size (MB)** accepts whole numbers from 50 to 1024; **Save import limit** keeps the preference only in this browser. MB here means MiB, and 1024 MB is 1 GB. Only imports up to 50 MB are supported and guaranteed. Higher limits are experimental and may be slow or fail because of browser memory or format constraints. The preference changes neither source privacy nor the 32 MiB API/MCP JSON/WebSocket envelope. [Import size and limits](/help/#import-file-size).

## SQL schema import

When you load or paste SQL/DDL, the script is analyzed locally in a Web Worker. SQL is never executed or sent to a database. The script is a temporary draft. DDL diagrams save recognized tables, columns, types, nullability, keys and foreign keys. SELECT/WITH diagrams save source aliases/scopes, output expressions, JOIN conditions, clauses and column lineage.

**Query expressions and filter clauses retain their literal values**, including potentially sensitive strings, through local storage, JSON, backups and recognized text exports. The complete raw source script and comments are not saved. DDL INSERT/COPY rows, defaults, CHECK expressions and procedure bodies are excluded; ENUM labels in column types may remain as schema structure. The original file stays on your device. Review names, expressions, filters, types and keys before sharing. Optional API/MCP SQL analysis sends supplied SQL transiently through your loopback bridge to the browser; the bridge does not retain it. [Importing SQL queries and schemas](/help/#import-a-sql-schema).

## Presentation voices

Walkthrough descriptions stay on this computer and are passed only to the local speech worker. Narration does not upload node descriptions, titles or diagram content to a speech service. The ordered presentation is saved with the diagram; playback progress, subtitle visibility and generated narration WAVs are transient and are not included in backups.

Audio and preload start disabled. Only explicit audio playback, video export with audio, **Preload**, or **Settings → Presentation voice → Preview voice** can download fixed voice models and configuration files, about 60–109 MiB per voice. These external downloads use fixed, versioned model addresses; their requests contain no narration text or diagram data. The model host can see ordinary download metadata such as the requested model and client IP. Model inference then runs locally, including offline when the required assets are cached.

Downloaded voices use a separate browser CacheStorage cache rather than the IndexedDB diagram database. **Settings → Presentation voice → Clear downloaded voices** removes that model cache. Model binaries and generated audio are not exported with diagram JSON or workspace backups. Descriptions above 12,000 characters are rejected explicitly rather than truncated. Subtitle text shows the node description locally. Browser policies can require pressing Play directly in the app before audio begins.

Walkthrough video export renders the diagram locally, and optional narration is inserted offline without screen capture or audible playback. Export buffers are temporary; the finished MP4 or WebM downloads only to the location chosen by your browser and is not stored in IndexedDB or workspace backups. API/MCP can start or cancel export with write access and read its transient state, but receives no video bytes. Video export leaves saved diagram content unchanged. The file is capped at 256 MiB and the final timeline at 30 minutes, with explicit errors and no truncation. Keep the tab visible; manual camera interaction and diagram edits cancel export.

## Optional Codex / MCP access

MCP is **Off** by default. In Settings you can explicitly grant **Read only** or **Read + write** access to tools through a local bridge on your computer. Visual Nerve must remain open. The bridge cannot independently read your browser's database and does not keep a second copy.

```text
Codex → local MCP bridge → your open browser → IndexedDB
```

Enabling this access lets the tools you connect read diagram content; read and write access also lets them edit it. Read only also allows supplied SQL, code and diagram files to be previewed through their exact endpoints without saving; creating a diagram requires write access. Choose tools you want to give this access to. Visual Nerve sends responses only through that local connection, and does not upload a cloud copy. Turn access **Off** to disconnect. [The guide explains setup](/help/#codex-and-mcp).

## Optional Lovable handoff

**Build with Lovable** generates an app brief locally and shows its complete text. Opening the dialog sends nothing. **Open in Lovable** opens a new tab at `lovable.dev` with the reviewed prompt; you press **Send** there to start building. This explicitly shares that text with Lovable.

The brief includes your instructions and chosen objects, written descriptions, notes, responsibilities and relationships. CSV schema, analysis choices and calculated summaries may be included. SQL tables contribute recognized columns/types, nullability, primary/unique keys and foreign-key pairs/actions through a typed allowlist; query diagrams contribute aliases, outputs, expressions, joins and clauses, including literal values. Missing definitions and unresolved references stay explicit. Source rows, complete raw SQL scripts, arbitrary metadata, owner email addresses and bridge credentials are excluded. Written text, grouping values and schema names/type labels are included as shown, so review the preview before sharing. Draft instructions stay in IndexedDB with the diagram. [How to use the handoff](/help/#build-an-app-with-lovable).

## Remove local data

**Delete diagram** removes one project. **Settings → Data & Privacy → Delete all local data** removes all your diagrams, owners, custom templates and settings in this browser after explicit confirmation. It cannot be undone unless you restore an exported backup. Built-in templates and the app itself remain available. This action does not delete backup files you downloaded.

Visual Nerve uses no analytics, advertising scripts or remote error reporting. Normal network requests download app files; they contain no diagram content. A static host may keep ordinary website access logs, such as requested file paths and IP addresses. Your graph is never sent in those requests.

Created by **Johan Caripson**. [MIT license](/license/) · [Source code on GitHub](https://github.com/Caripson/visualnerve).

## Source code import

Source files, folders and pasted scripts are analyzed locally in a cancellable worker. Nothing is executed, installed or sent to a remote analysis service. Source is a temporary draft: diagrams save recognized names, paths, line numbers, structural identifiers, bounded summaries, dependency evidence and confidence. Complete source, comments and nonstructural literal values are not saved. Quoted resource/table/import/field names can remain as structural identifiers. Identifiers and paths may still be sensitive. User-added notes/descriptions follow normal storage/export behavior.

JSON and backups preserve this recognized structure, and Markdown/Lovable share allowlisted summaries with confidence. Review the preview before sharing. The optional local API/MCP passes supplied code transiently over the loopback bridge to the browser, without server storage. Read-only access permits exact code preview and language discovery; saving a code diagram requires write access. No source refresh runs in the background.

## Draw.io and Visio import

`.drawio` XML and `.vsdx` ZIP files are analyzed locally in a cancellable worker. Preview retains a temporary draft with page graphs and warnings, without storing or opening a diagram. Creation saves only the selected page as ordinary editable nodes, relationships, text, geometry and safe absolute HTTP(S) links. Complete XML/ZIP source, archive entries, embedded image bytes and unselected pages are not retained. Images, macros, scripts and external relationships are never fetched or executed; legacy `.vsd` and macro-enabled `.vsdm` are unsupported.

Recognized names, text, links and graph provenance can remain in IndexedDB, JSON/backups and normal typed text exports. Review them before sharing. Native shapes and connector routing may be simplified; import warnings describe limitations. Optional REST/MCP preview/import passes source transiently through the loopback bridge and stores nothing on the server. Exact preview permits read-only access; saving requires write access and consent/grants are checked again after analysis. Revocation cancels pending work. [Importing diagram files](/help/#import-drawio-or-visio).
