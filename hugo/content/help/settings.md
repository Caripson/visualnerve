---
title: "Settings, local data and backups"
summary: "Control appearance, imports, voices, storage and integration permissions in this browser."
weight: 14
---

Open **Settings** on desktop or **Diagram actions → Settings** on a phone. Settings applies to this browser's workspace. Some preferences update immediately; import size, ZIP source-file count, voice selection and connection details have their own save buttons.

![Settings showing Appearance and the local Data & Privacy controls.](/help/images/settings.webp "Appearance follows the system by default; local-data controls explain where the workspace is saved.")

## Appearance

Under **Appearance**, choose **System**, **Light** or **Dark**.

| Choice     | Result                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------- |
| **System** | Default; follows the operating system's current light/dark preference, including later changes |
| **Light**  | Keeps a light appearance regardless of the system preference                                   |
| **Dark**   | Keeps a dark appearance regardless of the system preference                                    |

The choice saves immediately. Workspace, Help, Privacy, License, the error page and API reference follow the same accepted local preference. On a fresh browser without a saved preference, pages use System. Theme updates also refresh other open pages in the same workspace.

Appearance changes the interface, not your saved node colors, diagram geometry or simulation assumptions. Select **Done** to close Settings after making changes.

## What Saved means

Diagrams, objects, connections, owners, notes, templates, preferences and applicable imported data live in **IndexedDB in this browser profile**. **Saved** means the local transaction finished. It does not mean an upload or cloud backup completed.

The public website supplies app files. Other visitors cannot see your browser's work, and no account is required. The same address in another browser, profile, device or private window opens an independent workspace. Scheme, hostname and port are also part of the storage identity: changing the address can make a different workspace appear.

Use the same browser profile and address to return to your work. To move it, export and restore rather than expecting account sync. [Getting started](/help/getting-started/) explains the required acceptance of local storage and offline app caching before using the workspace.

## Work offline and keep a recovery copy

After storage acceptance and a completed first visit, app files are cached for offline use. Diagrams remain in IndexedDB. App updates replace application files without intentionally resetting your diagrams.

Browser clearing, profile reset or browser removal can erase local work. Private/incognito data may disappear when its session ends. Export a backup to keep a copy independent of those browser records. Offline app caches and downloaded voices are separate from the diagram database and are not replacements for a backup.

A reminder appears after ten local diagrams when a complete export has not been recorded. **Dismiss backup reminder** hides it in that workspace; it does not export anything.

## Export all local data

1. Open **Settings → Data & Privacy**.
2. Choose **Export all data**.
3. Save the dated `visual-nerve-backup-YYYY-MM-DD.json` file somewhere you control.
4. Keep a separate copy if the browser or device is important to your work.

The backup includes all projects, objects, connections, owners, custom templates, portable preferences, CSV sources and analysis settings. Named local history and applicable simulator models and retained run/replay archives are included.

It excludes integration credentials/tokens and grants, storage acceptance, local identity, last selection and the browser-local import-size and ZIP source-file limits. Cached app files, downloaded voice binaries, generated narration and temporary video buffers are also excluded. A restored voice preference may therefore require its model to download on first use.

Single-diagram JSON and PNG/PDF/SVG exports are separate choices. [Sharing and exports](/help/sharing/) explains which file to choose.

## Restore a backup

1. Choose **Restore backup** and select a complete Visual Nerve backup JSON file.
2. Review the number of diagrams and export date shown in **Import Visual Nerve backup**.
3. Choose Merge or Replace.
4. For Replace, review the warning and check its confirmation box.
5. Choose **Restore backup** and wait for completion.

![Backup restore preview with Merge and Replace choices and explicit replacement confirmation.](/help/images/backup.webp "Merge adds work; Replace removes the destination workspace's current content before restoring.")

| Mode                         | What happens                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Merge with existing data** | Keeps current diagrams and adds imported work; conflicting identities receive new IDs with internal references remapped |
| **Replace all local data**   | Replaces current diagrams, owners, templates and portable preferences; requires confirmation and leaves MCP access Off  |

Both modes preserve the destination browser's own storage acceptance and import limits. Backups cannot accept storage or grant external tools permission for you. Merge keeps destination connection choices; Replace starts a new local workspace identity and disables integration access.

Malformed or unsupported backup data rolls back the operation instead of partially replacing tables. A single-diagram JSON file is imported as a diagram, not as a full workspace backup. To move between devices, export on the original browser, transfer the file yourself, accept local storage on the destination and restore there.

## Inspect storage and request retention

Expand **Storage details** in Data & Privacy to see:

- Database and schema information.
- The current site address and **Workspace ID**.
- Estimated site storage usage, when the browser exposes it.
- Whether browser persistence has been granted.

The usage estimate includes app files kept for offline use; it is not only the diagram size. API/MCP clients can use the Workspace ID to target the right workspace when several are connected.

After creating a diagram, choose **Ask browser to keep local data** if the browser offers it. The browser can grant or decline persistence. A grant can reduce automatic eviction under storage pressure but cannot prevent manual clearing or guarantee retention. Export remains the independent recovery method.

## Import file size

Under **Import file size**, set **Maximum import file size (MB)** to a whole number from **50 to 1024**, then choose **Save import limit**.

- Default: **50 MB**.
- Maximum: **1024 MB**, shown as 1 GB. UI MB means MiB.
- **Only imports up to 50 MB are supported and guaranteed.**
- Larger imports are experimental and show a warning; browser memory, format complexity and timeouts can still cause failure.

This preference stays in the destination browser and is excluded from backup/restore. It applies to local file imports and relevant pasted inputs; raising it does not remove CSV row/cell limits, code object/line limits, SQL topology limits or archive expansion limits.

API/MCP JSON and WebSocket envelopes remain **32 MiB**, independently of the local file-size preference. Base64 or escaped text makes a transferred payload larger than its raw file. For detailed format bounds, see [CSV](/help/csv/), [SQL](/help/sql/), [code](/help/code/) and [diagram-file import](/help/diagram-import/).

## ZIP project source-file limit

A ZIP project can contain many small files even when its total size is small. **Settings → ZIP project source-file limit → Maximum analyzed source files in a ZIP project** controls this separate count. Enter a whole number from **500 to 10,000**, then choose **Save ZIP file limit**. The supported default is **500**.

![The ZIP project source-file limit set to 1,000 in Settings, with its experimental-project warning.](/help/images/project-file-limit.webp "The source-file count is independent of the import size and archive-entry limits.")

Only ZIP projects with up to 500 analyzed source files are supported and guaranteed. Raising the limit is experimental: larger projects may be slow or fail. Settings and the import dialog show this warning whenever a higher limit is active. Ordinary source-file and source-folder imports still allow 500 files.

The archive still allows at most **10,000 entries**, including ignored files and explicit directory records. Consequently, fewer than 10,000 usable source files may fit. Byte limits are independent, and limits on lines, objects, symbols, connections and analysis time still apply. Prefer **Folder relationships** for large projects: a File overview still cannot exceed 5,000 diagram objects.

Each ZIP import captures the limit when scanning starts. Change Settings before loading the archive again to use a different limit. The import summary shows the captured count. Resetting Settings to 500 does not invalidate a saved larger diagram. This preference belongs to the current browser, is excluded from workspace backups, and is preserved when restoring into this browser.

API and MCP clients discover the independent limits through `GET /code/capabilities`, read this browser's effective value through `GET /settings/project-source-file-limit`, and change it with Read + write access through `PUT /settings/project-source-file-limit` with `{ "value": 1000 }`. Archive request payloads cannot override the setting.

## Presentation voice

Choose **Narration voice** under **Presentation voice**, then **Save voice**. Alan, a British male Piper voice, is the default. US English LJ Speech, UK English Cori and Swedish NST are also available.

**Preview voice** prepares and plays a sample; **Cancel voice preview** stops it. First explicit use may download approximately 60–109 MiB of model assets from the fixed model host. Speech runs locally, with descriptions kept in the browser's speech worker. A cached model can be used offline; browser storage reclamation can require another download.

**Clear downloaded voices** removes those model assets. It does not delete diagram descriptions or reset the selected voice. Narration clips are temporary. See [presentations](/help/presentations/#choose-a-local-english-or-swedish-voice) for preload progress and film export.

## MCP access and connection details

MCP is optional and **Off** by default. In **Codex / MCP integration**, choose:

| Access           | Permitted behavior                                                            |
| ---------------- | ----------------------------------------------------------------------------- |
| **Off**          | No workspace command access through the bridge                                |
| **Read only**    | Inspect content and run supported unsaved previews/export/comparison requests |
| **Read + write** | Read plus create/edit content and control playback or simulations             |

The page shows the website, API documentation and **MCP server URL for Codex** separately. **Instructions for Codex** gives a copyable setup note without the integration token or diagram records.

Expand **Local connection details** only when configuring the bridge address or optional session token, then choose **Save connection**. The browser's WebSocket URL uses `/bridge`; a client such as Codex uses the local HTTP(S) `/mcp` address. The public website address identifies the app origin, not the process running on your computer.

Turning access Off closes the browser connection. The browser must remain open for commands, including headless simulations. This grant lets your chosen tool read content and optionally edit it; the tool handles received content under its own settings. See [API and MCP setup](/help/api-mcp/).

Reducing access takes effect immediately. If that setting cannot be saved, the open workspace keeps the lower access level through refreshes. Select the desired access level again; access can increase once that change saves successfully. A failed save does not store the choice for a later reload.

## Resolve a save conflict

Multiple tabs of the same browser/origin share the workspace. If another tab changes a diagram while you hold older edits, the conflict notice offers:

| Action                    | Result                                                               |
| ------------------------- | -------------------------------------------------------------------- |
| **Save local copy**       | Saves your current edits as a separate diagram marked `(local copy)` |
| **Use saved version**     | Discards the pending local version and loads the saved content       |
| **Replace saved version** | Saves your local graph over the latest saved graph                   |

Choose according to which content you want to retain. A local copy is useful when both versions contain work you need to inspect. API/MCP version conflicts likewise require a fresh read before another write; the bridge does not silently merge stale content.

## Delete all local data

Expand **Delete all local data**, review its scope, check **I understand this permanently removes my local data**, and choose **Delete all local Visual Nerve data**.

This removes user projects, owners, custom templates, preferences and stored acceptance in this browser. It cannot be undone without an exported backup. Built-in templates are reseeded when the workspace initializes again, and local storage acceptance is required again. Deletion does not erase already downloaded exports or backups outside the browser; application/voice caches are separate.

To remove only one project, use **Delete diagram**. Local snapshots can retain removed source content until those snapshots or their project are deleted; deleting a current source alone is not the same as deleting its history.

The [Privacy page](/privacy/) explains retention and explicit sharing in detail. Use [troubleshooting](/help/troubleshooting/) for failed saves, missing work, imports, narration and connection errors.
