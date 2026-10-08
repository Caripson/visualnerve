---
layout: product
title: "Your workspace, your browser, your choices"
description: "How Visual Nerve stores diagrams locally, handles imports and optional integrations, and separates marketing analytics from the workspace."
eyebrow: "Privacy"
summary: "The website delivers the application. Your browser keeps the workspace. Sharing and optional analytics have separate controls."
---

Visual Nerve is created by **Johan Caripson**. This page explains the product's current data flows and the choices that control them. [Security boundaries](/security/) · [Storage and backup instructions](/help/settings/).

## The workspace is stored locally

Visual Nerve stores diagrams, objects, connections, owners, metadata, preferences, geometry, drawing layers, source analyses and related records in **IndexedDB** in your browser profile. Original CSV cells, simulation models and bounded results, named history snapshots, storyboard scenes and reviewed app specifications are included where used.

```text
Website → application files → your browser → IndexedDB
```

Ordinary editing does not upload that content to the static host, S3, CloudFront or a cloud database. No account is required. Other visitors to the same website do not see your browser's workspace. **Saved** means a local transaction has committed.

The browser may temporarily hold unsaved working state in memory. Keep the tab open when saving reports an error or conflict, and resolve it before closing.

## Required local storage is separate from optional analytics

Before the editor opens, you must explicitly acknowledge and accept local browser storage and offline app caching. These are required for the workspace to work. Without acceptance, the editor remains closed; the public pages and Help remain readable.

Acceptance is kept in this browser profile, excluded from backups and removed when all local workspace data is deleted. Offline app caching starts after acceptance. The browser may independently cache ordinary downloaded HTTP files.

This workspace acceptance does not grant permission for Google Analytics. Analytics has a separate optional choice on public information pages.

## A different browser or domain has different data

The workspace belongs to the **exact origin**—scheme, hostname and port—and browser profile where you created it. Another device, browser, private window or origin has separate storage. There is no automatic synchronization.

A move to a new website domain does not transfer diagrams. Export a complete backup from the old origin, then restore it at the new one. A different path within the same origin, such as moving the editor to `/app/`, does not itself create a new browser-storage origin.

Private browsing, clearing site data, resetting a profile, browser eviction or device loss can remove local work. A browser retention request may reduce automatic eviction, but does not prevent manual deletion or guarantee recovery.

## Keep a recovery copy and control its location

**Settings → Data & Privacy → Export all data** downloads a complete workspace backup. It includes diagrams, connections, owners, portable preferences, templates, datasets, supported simulation content and history. It excludes storage acceptance, integration tokens/grants, local identity and the browser's import-size preference.

You choose where to keep or share that file. Visual Nerve does not upload it or create an automatic cloud backup. Native diagram JSON is a separate restorable copy of one diagram; PNG/PDF/SVG and Markdown serve different sharing purposes.

**Restore backup** previews Merge or Replace. Replace requires confirmation and disables imported integration access; restore does not accept storage or grant tools access on your behalf. Invalid data rolls back instead of leaving a partial workspace.

History snapshots may retain earlier objects and original CSV rows after they disappear from the current view. Removing the current source alone does not erase copies held by history or downloaded backups.

[Backup, restore and retention procedures](/help/settings/)

## What imported material retains

Imports and pasted source are analyzed locally in bounded, cancellable workers. They are not executed or sent to a remote analysis service during ordinary UI import.

| Material            | Saved information                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSV                 | Original cells, column identities, cleanup/filter/grouping settings, measures and source relationships.                                                                                  |
| SQL definitions     | Recognized tables, columns, types, nullability and keys; data rows, defaults, CHECK expressions, comments and procedure bodies are excluded. ENUM labels may remain as schema structure. |
| SELECT/WITH queries | Aliases, scope, joins, output expressions, clauses and column lineage, **including literal values** within expressions and filters.                                                      |
| Source code         | Recognized identifiers, paths, source locations, summaries, structural relationships and confidence; complete source, comments and ordinary nonstructural literals are temporary.        |
| draw.io / Visio     | The selected page's native objects, text, geometry, links and provenance; raw XML/ZIP, embedded image bytes and unselected pages are not retained.                                       |

Imported diagram scripts, macros and external relationships are not fetched or executed. Quoted resource names, paths, SQL filter values and user-written descriptions can still be sensitive. Review recognized content and exports before sharing.

Local file imports default to 50 MiB. Settings can raise the limit to 1 GiB with an experimental-use warning; structural limits still apply. This changes neither source privacy nor the bridge's separate 32 MiB transport envelope.

## Narration and video are generated locally

Node descriptions and scene narration are sent to the local speech worker, not uploaded to a speech service. English and Swedish voices use fixed neural model assets. Alan is the default English voice.

Explicit audio playback, Preload, voice preview or video export with audio can download approximately 60–109 MiB of assets per voice from versioned external model URLs. These requests contain no narration text or diagram payload. The model host can receive ordinary request metadata, including the requested model and client IP.

After loading, synthesis runs locally and can work offline with cached assets. Downloaded models use a separate CacheStorage cache. **Clear downloaded voices** removes that cache; model binaries and generated audio are excluded from diagram JSON and workspace backups.

Video export renders locally and inserts optional audio without screen capture. Temporary frames, audio and video buffers are not saved in IndexedDB. The finished file downloads through your browser. API/MCP can read export state, but receives no video bytes.

[Presentation, voice and video details](/help/presentations/)

## Optional API and MCP access

Integration is **Off** by default. Choose **Read only** or **Read + write** in Settings to grant connected tools access through a separate local bridge process. The browser must remain open.

```text
Your client → local bridge → open browser → local workspace
```

The bridge forwards commands in memory and has no second diagram database. It binds to loopback and checks trusted origins. Browser commands use the same validation and transactions as UI operations. Read only includes supported exact unsaved previews, exports, questions and comparisons; mutations and run/playback controls need write access.

The tools you connect receive requested content and may handle it under their own hosting, logging or AI settings. An explicit CSV measure-evidence request can return original cells. A local bridge does not guarantee the privacy of a remote client receiving those cells.

The browser keeps an optional integration token for its session, excluding it from backups and copied setup instructions. Turn access Off to disconnect. Public API documentation discovery reads bundled documentation without a browser content grant.

[Local MCP architecture and setup](/mcp/) · [Exact API contract](/api/docs/)

## Optional Lovable handoff

Build with Lovable creates a specification and complete prompt locally. Opening the dialog sends nothing. **Open in Lovable** opens a separate tab at `lovable.dev` with the reviewed text in a URL fragment; you then press Send there to start building.

The brief includes your instructions, selected objects, written descriptions, notes, responsibilities, relationships and reviewed requirements. Recognized CSV schema/group summaries, SQL schema/query structure and code contracts may be included. SQL expressions and clauses retain literal values.

Original CSV rows, complete source scripts, arbitrary metadata, owner email addresses and bridge credentials are excluded. Written text and group/schema identifiers can still be sensitive. Review the exact prompt before sharing; Lovable's own policies govern the copy it receives.

[Review the app brief and handoff](/help/sharing/#prepare-an-app-brief-for-lovable)

## Optional analytics on public information pages

When an analytics measurement ID is configured, public marketing and information pages offer a separate **Google Analytics** choice through a locally bundled **Klaro** consent manager. Analytics is optional, starts disabled and loads only after a valid, saved opt-in. Rejecting it does not prevent access to the product or documentation. Without a configured ID, no Google Analytics tag loads.

Analytics does **not run on `/app/`, `/help/` or `/api/docs/`**, regardless of a prior marketing-page choice. No graph, title, node description, source file, SQL/CSV payload, workspace identifier or diagram action is included in analytics events.

The implementation sends a page-view event for the public page route, using a fixed generic title, without query strings, URL fragments or referrer content. Google may receive ordinary network/device metadata and analytics-cookie identifiers when you opt in. Advertising personalization and Google signals are disabled. The site operator must also keep Enhanced Measurement disabled for this property's web stream so it does not add automatic interaction events.

The Analytics administrator must disable Enhanced Measurement and avoid Connected Site Tags or custom tags that collect page contents, automatic events or URL parameters. Visual Nerve's page integration does not provide those data sources.

### How the choice and cookies are kept

The explicit analytics choice is stored in localStorage under `visualnerve-site-consent-v1`, with `visualnerve-site-consent-saved-at` recording when it was saved. It is treated as valid for **30 days**, separately from workspace-storage acceptance, and is excluded from workspace backups.

After opt-in, Google Analytics may set `_ga` and `_ga_<stream>` cookies. The configuration requests host-scoped cookies with Path `/`, a **30-day expiry** and no rolling expiry refresh. Actual browser/provider behavior can vary; the requested lifetime is not a universal browser guarantee. These cookie identifiers support analytics, not access to the diagram database.

### Change or withdraw consent

Use **Cookie settings** on a public information page to review or change the choice. Withdrawal saves the new choice first, disables analytics, removes accessible Google Analytics cookies and reloads an active information page to unload the tag. Other open tabs observe the changed preference. A page with no configured analytics explains that no optional analytics is configured.

Withdrawal stops future collection by this site; it cannot retract data already sent to Google. Browser site-data controls can also clear the locally stored choice. This choice does not control the required IndexedDB records used by the workspace.

## Ordinary website requests and access logs

Opening pages downloads static application, documentation and image files. The host/CDN can keep ordinary access logs, such as requested file paths and IP addresses. Those file requests do not contain your graph. Optional voice downloads, analytics and explicit external links/handoffs are the separate network flows described above.

Visual Nerve does not use advertising scripts or remote error-reporting payloads containing workspace data.

## Delete local workspace data

**Delete diagram** removes one project and its associated local content. **Settings → Data & Privacy → Delete all local data** requires confirmation and removes workspace records, preferences and storage acceptance. Built-in templates can be reseeded; the application remains available.

Deletion cannot erase backup/export files kept outside the browser, copies already shared with another service, ordinary host logs or analytics already collected. App caches, downloaded voice caches and marketing-consent preferences are separate storage mechanisms; use their respective controls or the browser's site-data controls when clearing them.

[Open the workspace](/app/) · [Manage storage and backups](/help/settings/) · [Security and reporting](/security/)
