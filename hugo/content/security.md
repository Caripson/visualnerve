---
layout: product
title: "Understand the boundaries before using real data"
description: "Visual Nerve's local-data security model, bridge permissions, sharing boundaries, recovery responsibilities and reporting guidance."
eyebrow: "Security"
summary: "Local storage reduces automatic data transfers, while the browser, device and connected tools remain part of the trust boundary."
---

[Read the privacy policy](/privacy/) · [Local integration setup](/mcp/) · [Backup procedures](/help/settings/)

## Where the workspace lives

Diagrams and related records are stored in IndexedDB under one browser profile and exact website origin. The static website host delivers application files; ordinary editing does not upload graphs or source files to it. Other visitors to the website do not share your browser's workspace.

There is no account-based synchronization, mandatory cloud database or server-side diagram store. Offline app files are cached after required storage acceptance. Exports are explicit copies that you decide where to keep.

Local storage is not a guarantee of confidentiality or recovery. A person or process with access to the browser profile, a powerful extension, or compromised same-origin application code may be able to access its contents. Protect the device and profile using controls appropriate to your data.

## What is implemented

| Boundary             | Current behavior                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Workspace access     | Required local-storage acceptance before the editor opens; local profile/origin owns its data.                   |
| External integration | Off by default; explicit Read only or Read + write browser grant.                                                |
| Local bridge         | Loopback connections only, with trusted Host/Origin checks and optional token authentication.                    |
| Writes               | Browser validation, reference checks and versioned transactions; invalid mutations do not become partial writes. |
| User links           | Validated absolute HTTP(S) links; external links use isolated new tabs.                                          |
| Imported source      | Bounded local analysis without code, SQL, macro or imported-script execution.                                    |
| Recovery             | Explicit complete backups, reviewed Merge/Replace restore and confirmed deletion.                                |

The optional Go bridge accepts local integration peers only. Publicly hosting the app does not expose a public MCP endpoint. An allowed app origin is exact; wildcard CORS is not used. Trusted local TLS can be configured for browser requirements.

If configured, `VISUAL_NERVE_BRIDGE_TOKEN` protects integration reads, writes and registration. The browser keeps its token for the session and excludes it from backups and copied setup instructions. Request bodies and responses are bounded to 32 MiB.

Read only allows specific unsaved previews, exports, questions and comparisons as well as inspection. It rejects editing and cannot elevate its own grant. Write access also allows destructive edits and runtime control, so grant it only to tools you intend to trust.

## Review the content you release

An authorized API or MCP client receives the requested content. If that client uses a hosted AI service, its own configuration and terms govern subsequent handling. The local bridge does not provide a confidentiality guarantee for another product.

Exports and backups can contain descriptions, notes, owners, original CSV cells and parsed SQL literal values. History can retain rows or objects removed from the current diagram. Deleting a current source does not necessarily erase copies in history or downloaded backups.

Build with Lovable shows the exact prompt before an explicit handoff. Its typed brief excludes raw CSV rows, complete source scripts, arbitrary metadata and bridge credentials, but includes relevant written text, group summaries and recognized structure. Inspect that included text before opening Lovable.

Fixed voice assets can download from an external model host after explicit audio, preload, preview or audio-video actions. The requests contain no narration text. Synthesis runs locally, but the model host receives ordinary download request metadata.

Optional marketing analytics is separately opt-in and excluded from the workspace, Help and API reference. It measures public page visits, not diagram activity. [Data-flow details](/privacy/).

## Plan for deletion and recovery

Export a complete backup before clearing site data, replacing a workspace or changing devices. Use the same browser profile and origin to return to existing work. A new domain opens a separate workspace; move work by export and restore.

Browser quota, private browsing, eviction, profile reset or device loss can remove local records. A browser retention grant may reduce automatic eviction, but it is not a backup. Delete all local data requires confirmation and removes workspace records and storage acceptance; files already downloaded elsewhere remain your responsibility.

## What the product does not currently provide

Visual Nerve has no built-in enterprise identity provider, SSO, role-based team tenancy, shared live workspace, central audit log, managed retention policy or application-level end-to-end encryption of local records and exports. It does not provide an unattended cloud simulation service.

This page does not claim independent security certification, regulatory certification or a completed external penetration test. Evaluate the implemented boundary against your organization’s data classification and device policies rather than assuming that “local” meets every requirement.

## Report a suspected vulnerability privately

Check the [repository Security page](https://github.com/Caripson/visualnerve/security). If **Report a vulnerability** is available, use that private reporting route. Repository access and private reporting availability may vary.

If a private route is not offered, request a private contact route without posting exploit details, real customer data, tokens, source secrets or sensitive exports in public Issues. Include only a minimal non-sensitive description until a private channel is established. For an ordinary product bug, use a sanitized sample and the reproduction steps from [Troubleshooting](/help/troubleshooting/#reporting-a-reproducible-problem).

[Open Visual Nerve](/app/) · [Understand privacy choices](/privacy/) · [Prepare a recovery copy](/help/settings/#export-all-local-data)
