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

There is no account-based workspace synchronization or mandatory cloud database. Optional collaboration uses a separately configured relay with approved participants; ordinary saved workspace data stays browser-local. Offline app files are cached after required storage acceptance. Exports are explicit copies that you decide where to keep.

Local storage is not a guarantee of confidentiality or recovery. A person or process with access to the browser profile, a powerful extension, or compromised same-origin application code may be able to access its contents. Protect the device and profile using controls appropriate to your data.

## The dedicated encrypted app surface

**Workspace address:** the password-protected editor is `https://app.visualnerve.com/`. The old public `/app` path redirects there; the isolated app's `/app` path returns 404. The controls below apply to the app origin. A redirect cannot move, encrypt or delete records on an older origin, and earlier readable copies remain readable.

The dedicated app surface at `app.visualnerve.com` requires browser-local password setup on first use and human unlock on later visits. Its IndexedDB workspace records—including diagrams, owners, preferences, CSV sources, history, simulation models and archived results—use **AES-256-GCM**. Lookup metadata is protected within the same encrypted backend. The UI, API and MCP share this storage boundary; there is no persistent readable shadow database or separate MCP simulation model.

A small vault header and session-control record contain cryptographic setup and revocation metadata needed before unlock. They do not contain readable diagrams, source cells, passwords or recovery keys. Full narration preloads can use encrypted temporary local spill with a separate RAM-only AES-256-GCM key; no readable narration is persisted there, and locking revokes that key. Crashes can leave unusable ciphertext until Clear app cache removes it. Static app files and downloaded voice models are ordinary cacheable assets; a separate small cache-control marker coordinates clearing those assets and contains no workspace content. Clearing the app cache preserves the vault and does not claim to clear the browser's entire HTTP cache.

Appearance and an allowlisted app-language identifier are technical display preferences readable before unlock. They contain no credentials, keys or workspace content. Language files are bundled public assets; changing the interface language does not unlock the workspace, renew an idle deadline, grant agent access or translate authored data. These preferences are not imported from a backup. Help and API documentation remain English.

This surface is isolated from legacy workspaces on other origins. It does not automatically read, migrate or encrypt a workspace stored under `www.visualnerve.com`, staging, another browser or another device. Use the source's **Export encrypted transfer**, then the destination's **Transfer existing workspace**. The full transfer preserves identifiers and archives, stops integrations and runtime work, and re-reads all saved encrypted content before the editor reopens. The source stays intact; keep it until you have checked the new workspace and its backup. Encrypting a transfer file does not encrypt the legacy working database or revoke earlier files. [Complete transfer procedure](/help/settings/#transfer-an-existing-workspace).

The password and recovery key are used locally. There is no server password reset, mandatory account, backend or SSO. Keep the recovery key separately from the device and backup. If both usable credentials and recovery material are lost, the service cannot restore access to the encrypted data.

### Session expiration and connected tools

**Automatic session lock** is enabled by default. You can uncheck it on the startup password screen or in **Settings → Workspace security** to disable both automatic inactivity and maximum-session expiration. Keys still stay in the open tab's memory: reload, close, manual lock and cross-tab revocation require a new unlock. This is a human-only workspace policy, never an API/MCP setting. Re-enabling the timers uses the original session clocks and can lock immediately if a limit has passed.

**Workspace security** in Settings controls inactivity and maximum-session limits. Only human interaction with the app renews inactivity. API/MCP requests and background work do not renew it. Locking clears working plaintext, cancels jobs and invalidates their originating session; a later unlock does not make an old request valid again. Tabs sharing the vault observe revocation, while each tab obtains its own unlock session.

There is no API/MCP operation to unlock, submit passwords or recovery keys, change credentials or change timeout policy. `GET /workspace/security` exposes only safe versioned state/capabilities while a browser connection exists. Only a previously authorized, already-open connection is retained as restricted control; cold locked startup never connects, and a closed control connection is not reconnected. Explicit Off closes it. `POST /workspace/lock` accepts only an empty body or no arguments and requires a fresh Read + write grant while unlocked. It waits for pending saves and refuses to silently discard failed edits, then revokes the shared vault session and returns safe status. A concurrent permission or saved-data change returns **409** instead of applying a stale lock. Already-locked control only reports local status without another revocation. Content requests from a connected locked workspace return **423 `WORKSPACE_LOCKED`**; a disconnected or unavailable workspace remains **503**. Public documentation discovery needs no browser unlock.

Unlocking an encrypted session does not reactivate a previous integration grant. Choose Read only or Read + write again in Settings before reconnecting tools.

Encryption protects saved data while locked. It cannot protect content from malicious code, a compromised browser extension or a device attacker while the human has unlocked the app. Authorized API/AI requests and explicit diagram exports expose readable data; review those releases and the receiving service's policies. Do not send the vault password or recovery key to an agent.

### Backups have their own lifetime

The encrypted app's downloaded workspace backup is encrypted and can be restored through the browser's reviewed flow. API/MCP `GET /workspace/export` is a readable semantic export to a granted client, not that encrypted file download. Ordinary diagram JSON, Markdown, SVG, PDF, images and video are also readable copies.

Changing the live workspace password or recovery material does not rewrite files you already downloaded. Old encrypted backups retain their original password/recovery credentials. Retain the matching credentials for each copy and decide when to replace or destroy old copies; deleting local records cannot delete files held elsewhere.

A normal password change keeps the content key. An older backup plus its credential can expose a key still used by the current workspace. If that key may have been exposed, **Workspace security → Suspected content-key exposure** prepares a new content key and recovery material, authenticates and reencrypts every current record, then atomically activates the verified replacement and locks the workspace tabs. This human-only incident operation needs temporary memory and storage headroom. It protects the current saved workspace; old backups and already shared content remain outside its protection. [Incident procedure](/help/settings/#rotate-an-exposed-content-key).

## Optional realtime collaboration

Ordinary editing remains local. A separately configured Cloudflare relay enables a deliberately shared diagram session, using **MLS (RFC 9420)** application encryption, device approval and owner-signed membership policy. This integration has **not been independently audited**; use it only after assessing the disclosed content and organizational requirements. OpenMLS is the cryptographic implementation; that does not make the complete browser, policy or relay integration independently audited.

The owner reviews each live device and grants Editor or Viewer access. Display names are participant labels, not a verified enterprise identity. Invitations are admission capabilities and should be sent privately. API/MCP can inspect semantic presence and use the existing graph endpoints, but cannot create invitations, approve devices, change roles, obtain room keys or unlock a vault. Shared writes require both owner/editor membership and the current local write grant.

The default scope shares graph text, structure, geometry, styling, annotations and process assumptions. Metadata/code/SQL evidence, referenced owner profiles and original CSV datasets require distinct human disclosure choices. Sensitive text can already appear in titles, descriptions and aggregated labels with those options off. Cameras, view filters and private local preferences stay local. Private CRDT state and room associations use the dedicated encrypted vault namespace, are excluded from native exports and every workspace backup, and participate in content-key rotation.

The relay handles ciphertext plus IP/request, room, public device/membership, connection and message timing/size metadata. Authorized participants receive readable content. The vault password and recovery key are never room credentials and never go to the relay. Protect unlocked browsers and participant devices; encryption cannot prevent an authorized participant or compromised device from copying content.

MLS ratchets and private device signing keys are **live-memory only** in this release. Network reconnect retains the same unlocked live device; exact ciphertext may be retransmitted. Reload or lock/unlock requires a fresh device and owner approval, and owner reload requires a new room. Restoring an older backup cannot resume private room keys. Member removal changes future authorized access after the membership transition but cannot revoke previously copied, exported or photographed information.

[Collaboration disclosure, roles and recovery guide](/help/collaboration/) · [What the relay receives](/privacy/#optional-realtime-collaboration)

## What is implemented

| Boundary             | Current behavior                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Workspace access     | Required local-storage acceptance before the editor opens; local profile/origin owns its data.                   |
| External integration | Off by default; explicit Read only or Read + write browser grant.                                                |
| Local bridge         | Loopback connections only, with trusted Host/Origin checks and optional token authentication.                    |
| Writes               | Browser validation, reference checks and versioned transactions; invalid mutations do not become partial writes. |
| User links           | Validated absolute HTTP(S) links; external links use isolated new tabs.                                          |
| Imported source      | Bounded local analysis without code, SQL, macro or imported-script execution.                                    |
| Recovery             | Explicit complete backups, verified complete transfer, reviewed Merge/Replace restore and confirmed deletion.    |

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

Export a complete backup before clearing site data, replacing a workspace or changing devices. Use the same browser profile and origin to return to existing work. A new domain opens a separate workspace. Use the verified complete transfer for the encrypted app; normal Restore backup remains available for merging or replacing diagrams in other workflows.

Browser quota, private browsing, eviction, profile reset or device loss can remove local records. A browser retention grant may reduce automatic eviction, but it is not a backup. Delete all local data requires confirmation and removes workspace records and storage acceptance; files already downloaded elsewhere remain your responsibility.

## What the product does not currently provide

Visual Nerve has no built-in enterprise identity provider, SSO, managed team tenancy, central audit log or managed retention policy. Optional owner-approved live diagram collaboration is a separate MLS-encrypted feature when a relay is configured; it does not add those enterprise controls. Ordinary exports are not automatically encrypted. The product does not provide an unattended cloud simulation service.

This page does not claim independent security certification, regulatory certification or a completed external penetration test. Evaluate the implemented boundary against your organization’s data classification and device policies rather than assuming that “local” meets every requirement.

## Report a suspected vulnerability privately

GitHub private vulnerability reporting is enabled. Use **Report a vulnerability** on the [repository Security page](https://github.com/Caripson/visualnerve/security) as the primary route for a security finding. A GitHub account is required. The [repository security policy](https://github.com/Caripson/visualnerve/blob/main/SECURITY.md) describes reporting information and supported revisions.

If GitHub private reporting is unavailable, email [hello@visualnerve.com](mailto:hello@visualnerve.com) to coordinate a report. Ordinary questions, private inquiries and sensitive conduct concerns can use the same address. Do not post exploit details, real customer data, tokens, source secrets or sensitive exports in a public issue, and keep credentials and customer data out of email.

For an ordinary product bug, use the [GitHub issue chooser](https://github.com/Caripson/visualnerve/issues/new/choose) and the reproduction steps from [Troubleshooting](/help/troubleshooting/#reporting-a-reproducible-problem). Issues, comments and attachments are public. Opening a reporting or email link does not attach your diagram or send an automatic error report.

Reproduce the problem with a minimal sample containing invented data. Review screenshots and error messages before submitting them. Do not attach a complete workspace backup, original project archive, raw HAR/network capture or unredacted console log. These can contain customer data, source secrets or integration credentials; the local bridge's WebSocket address can include a session token. Security findings belong in a private report, not a public bug issue.

[Open Visual Nerve](/app/) · [Understand privacy choices](/privacy/) · [Prepare a recovery copy](/help/settings/#export-all-local-data)
