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

In **Settings → Data & Privacy**, choose **Export all data**. This downloads a dated JSON backup of all your diagrams, nodes, connections, owners, preferences and templates. Keep the file somewhere you choose. Visual Nerve does not upload it or create an automatic backup.

On another browser or computer, use **Restore backup**. **Merge with existing data** keeps current diagrams and adds the imported work. **Replace all local data** removes the current workspace before restoring the file and requires confirmation. Connection permissions are never imported.

**Export diagram** is a separate option for a single diagram as PNG, PDF, Markdown or JSON. Use **Export all data** for a complete restorable workspace.

Clearing this site's browser data, resetting your browser profile or uninstalling the browser may remove your work. Private or incognito browsing may use temporary storage that disappears when the session ends. Export a backup when you want a separate copy.

**Storage details** shows an estimate of site storage, when your browser supports it. Once you have a diagram, you can ask the browser to keep local data. Browser decisions vary; a grant can reduce automatic eviction under storage pressure, but cannot prevent manual clearing or guarantee retention.

## Optional Codex / MCP access

MCP is **Off** by default. In Settings you can explicitly grant **Read only** or **Read + write** access to tools through a local bridge on your computer. Visual Nerve must remain open. The bridge cannot independently read your browser's database and does not keep a second copy.

```text
Codex → local MCP bridge → your open browser → IndexedDB
```

Enabling this access lets the tools you connect read diagram content; read and write access also lets them edit it. Choose tools you want to give this access to. Visual Nerve sends responses only through that local connection, and does not upload a cloud copy. Turn access **Off** to disconnect. [The guide explains setup](/help/#codex-and-mcp).

## Optional Lovable handoff

**Build with Lovable** generates an app brief locally and shows its complete text. Opening the dialog sends nothing. **Open in Lovable** opens a new tab at `lovable.dev` with the reviewed prompt; you press **Send** there to start building. This explicitly shares that text with Lovable.

The brief includes your instructions and chosen objects, written descriptions, notes, responsibilities and relationships. CSV schema, analysis choices and calculated summaries may be included. Source rows, arbitrary metadata, owner email addresses and bridge credentials are excluded. Written text and grouping values are included as shown, so review the preview before sharing. Draft instructions stay in IndexedDB with the diagram. [How to use the handoff](/help/#build-an-app-with-lovable).

## Remove local data

**Delete diagram** removes one project. **Settings → Data & Privacy → Delete all local data** removes all your diagrams, owners, custom templates and settings in this browser after explicit confirmation. It cannot be undone unless you restore an exported backup. Built-in templates and the app itself remain available. This action does not delete backup files you downloaded.

Visual Nerve uses no analytics, advertising scripts or remote error reporting. Normal network requests download app files; they contain no diagram content. A static host may keep ordinary website access logs, such as requested file paths and IP addresses. Your graph is never sent in those requests.

Created by **Johan Caripson**. [MIT license](/license/) · [Source code on GitHub](https://github.com/Caripson/visualnerve).
