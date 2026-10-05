# How Visual Nerve stores your data

The application can be publicly hosted. Everything you create stays in the browser profile where you created it. No account is required and no cloud database receives diagrams. Other visitors to the same URL cannot see your work.

The website delivers app files. The browser saves diagrams, nodes, relationships, owners, metadata, preferences, viewport and user templates in IndexedDB. React holds active working state. **Saved** means a local transaction completed.

```text
Visual Nerve website → your browser → IndexedDB
```

## Required acceptance

A checkbox and **Accept and continue** require explicit acceptance of local storage and offline app caching before the workspace opens. Escape, backdrop clicks, declining and shortcuts cannot bypass it. Without acceptance, no diagrams load or are created and no offline cache is installed in a new profile. The app opens the empty database schema to check prior acceptance; templates and preferences are seeded afterward. Browsers may independently cache ordinary downloaded HTTP files.

Acceptance is saved in IndexedDB, never inferred from a visit, old informational acknowledgement or imported backup. Deleting all local data removes acceptance too. The guide and privacy page remain readable without using the workspace. The service requires local storage.

## Separate browsers and devices

Another browser, profile, device or private window has independent storage even at the same URL. Nothing automatically synchronizes. Return with the same browser profile and origin; changing scheme, hostname or port opens separate storage. Public app hosting does not make content public.

## Backups and moving work

**Settings → Data & Privacy → Export all data** downloads `visual-nerve-backup-YYYY-MM-DD.json`: diagrams, nodes, connections, all owners, portable settings, templates, schema version and export date. It excludes credentials, grants, storage acceptance and local identity. You control where the downloaded file is kept. Visual Nerve never uploads it. Share a backup only when you intend to share its content.

**Restore backup** previews Merge (keep current projects and add imported work) or Replace (remove current data first, with explicit confirmation). Identity collisions are remapped; invalid data rolls back all tables. Replace disables MCP. Import cannot grant tools access or accept storage for you. Export diagram is separate: one diagram as PNG/PDF/Markdown/JSON.

After ten diagrams, a subtle reminder appears if no complete export has been recorded. It can be dismissed permanently in that local workspace; it sends no notifications.

## Browser storage lifetime

Clearing site data, resetting a profile or uninstalling the browser may remove work. Private/incognito storage may disappear when its session ends. There are no unreliable private-mode detection tricks.

Storage details shows `navigator.storage.estimate()` when available, including cached app files. After creating a diagram, users can request `navigator.storage.persist()`. Browsers may grant or decline; no first-load request occurs. Persistent storage can reduce automatic eviction under pressure but cannot prevent manual clearing or guarantee retention. See [MDN storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) and [persistent storage](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist). Export for an independent copy.

## Optional MCP

```text
Codex → local MCP bridge → active browser → IndexedDB
```

MCP is Off by default; users explicitly choose Read only or Read + write. This grants connected tools access to diagram content, and optionally edits. Choose the tools you grant access to. Tools may handle received content under their own settings; Visual Nerve sends responses only through the local connection.

The bridge binds to localhost, checks exact trusted app origins and forwards commands in memory. The browser uses the same validation and transactions as the UI. Read-only access rejects mutations and grant escalation. The bridge cannot read IndexedDB independently, read graphs from S3, store a second copy or fall back to another database. Off, disconnection and browser closure produce clear errors. See [setup](DEPLOYMENT.md#optional-local-mcp).

## Network requests and deletion

Normal traffic downloads same-origin static app/documentation files. There is no analytics, telemetry, remote font/CDN script or error reporting. No graph title, owners, metadata or export content is uploaded. The optional bridge is restricted to literal loopback hosts and explicit grants. Hosts may log ordinary file requests and client IPs; diagram data is not included.

**Delete diagram** removes one project. **Settings → Delete all local data** requires confirmation and removes all projects, owners, custom templates, settings and acceptance. It cannot be undone without an exported backup. Built-in templates are reseeded. App code caches and downloaded files are separate; deletion does not erase backups outside the browser.

Audit evidence: [REQUIREMENTS.md](REQUIREMENTS.md), [ACCEPTANCE.md](ACCEPTANCE.md).
