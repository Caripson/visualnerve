---
title: "Collaborate on a diagram"
summary: "Share one diagram with approved people, see their presence and understand encryption, disclosure and recovery limits."
weight: 13
---

Realtime collaboration is optional. Ordinary diagrams still work locally without a relay or account. When a collaboration relay is configured, the **Collaboration** panel lets an owner share one diagram with approved devices. Participants work on the same graph while keeping their own camera and workspace preferences.

**This integration has not been independently audited.** Evaluate it against your organization's data and device policies before sharing sensitive material. It is not an enterprise identity service or a promise of regulatory compliance.

## Start with a small example

1. Unlock your local workspace and open a diagram containing invented data.
2. Open the Collaboration panel. If collaboration is unavailable, the deployment needs a configured relay; enabling MCP does not configure that relay.
3. Create a room and choose a name that other participants may see. Review the disclosure choices before continuing.
4. Create an invitation and send it through a private channel to the intended participant. Treat it as an admission capability, not a public diagram link.
5. The recipient unlocks their own browser workspace, opens the invitation and requests access. The owner reviews the pending device and approves it as an **Editor** or **Viewer**.
6. Wait for synchronization to finish before editing. Confirm both devices show the expected participants and roles, then try changing one title and moving another node.

An invitation is not automatic approval. The owner's approval binds access to the participant's current device. A display name is a label chosen by a participant, not a verified legal identity. While waiting, the recipient sees **Your device fingerprint**. Compare that complete fingerprint with the owner's pending request through a separate trusted channel before approval; comparing a name alone does not verify the device.

![A participant waiting for approval on a phone, with the owner and participant device fingerprints and the room's disclosure choices.](/help/images/collaboration-approval-mobile.webp)

The pending participant can review exactly what the room includes before the owner approves access. The device fingerprints are public identity information; the invitation itself must remain private.

### Copy a link or device identity

Click or tap a displayed **Room ID**, **Device ID**, or **device fingerprint** to copy its complete value. Open a participant's **Device fingerprint** disclosure to reach that field. A copy icon shows the action, and **Copied to clipboard** confirms that it succeeded.

For a newly created invitation, click or tap the **Private invitation link** field or its adjacent copy button. With a keyboard, tab to a copy button and press **Enter** or **Space**. Focusing a field alone does not copy anything. If the browser blocks clipboard access, the field selects its full value and asks you to copy it manually.

Send invitations only through a private channel. Send fingerprints through a separate trusted channel to verify devices. Editable fields, such as your display name and a pasted invitation, keep their normal typing behavior.

## Choose what you disclose

The default shared drawing includes titles, descriptions, relationships, geometry, styling, saved annotations, presentation/storyboard configuration and semantic process assumptions. Text already shown in a diagram can contain customer names, code identifiers, paths, SQL-derived labels or summarized CSV values. Review it even when the optional disclosures are off.

| Choice | What it adds | Default |
| --- | --- | --- |
| Metadata and source evidence | Custom metadata and retained code/SQL evidence attached to the graph | Off |
| Referenced owner profiles | Assigned owner profiles and ownership references; unreferenced workspace profiles stay private | Off |
| CSV datasets | Original CSV datasets and their analysis configuration, allowing participants to explore those sources | Off |

Turning a choice off does not anonymize titles or descriptions. A grouped node named after a customer still shares that customer's name. Metadata can contain literals or secrets; raw datasets can disclose complete rows beyond the values visible on the canvas. Choose the room's disclosure scope before sharing it. To change the scope, start a new room with the reviewed scope rather than assuming already received copies can be recalled.

Sharing has limits separate from ordinary local editing: up to 20,000 nodes and 100,000 relationships, 16 MiB of shared JSON, 32 MiB of CRDT state/full-state refresh and 8 MiB per incremental update. Reconnect and membership refreshes can resend the complete validated shared state without reducing that limit to the smaller incremental budget. Compressed application payloads must fit 3 MiB and decompress to at most 64 MiB. Large text or source evidence can exceed a payload limit even when the drawing has few nodes. If a limit is exceeded, reduce the shared scope or divide the diagram; content is rejected rather than silently omitted.

Camera position, zoom/view filters, workspace folder, favorites and local save/version timestamps are not shared. Existing private source evidence and owner assignments remain local when their disclosure choices are off. Private room records, invitation data and cryptographic credentials are absent from native diagram exports and workspace backups.

## Read presence and roles

The panel shows approved participants, their roles and connection state. Shared selection identifies which objects a participant is examining. Activity currently identifies the approved human device; an API/MCP edit uses that same device and permissions, rather than appearing automatically as a separately approved AI participant.

![The owner reviews connected participants, their full device fingerprints, roles and removal controls in the Collaboration panel.](/help/images/collaboration-members-desktop.webp)

| Role | Shared drawing access |
| --- | --- |
| Owner | Edit the shared model and review admission, participant roles and removal |
| Editor | Edit the shared model |
| Viewer | Inspect the model without changing it |

Each participant's local vault must remain unlocked. MCP also needs its own explicit local grant. A **Viewer** with a local **Read + write** MCP grant still cannot edit the shared graph. An **Editor** with a **Read only** MCP grant cannot let that tool write. The two permissions are checked together.

## Understand saving and simultaneous edits

Edits are merged per field using Yjs. Two people can change different properties without replacing each other's whole node. The accepted graph still undergoes Visual Nerve's reference and model validation, and local saves use the existing encrypted transaction boundary.

Some simultaneous changes cannot form a valid model—for example, deleting an object while another participant creates a relationship to it. A conflict stops normal synchronization rather than silently deleting evidence or accepting a broken graph. Inspect the visible conflict, keep your local diagram, and coordinate a reviewed recovery or a new room. Do not treat an offline or conflict indicator as confirmation that all edits reached everyone.

While a room is active, leave it before deleting its shared diagram, clearing/replacing the workspace, or editing/deleting a global owner profile referenced by that diagram. Those operations return a conflict rather than diverging from other participants. Create/edit the owner profiles before joining; assigning an existing owner through the shared node still follows the chosen scope.

Undo tracks your own local operations rather than undoing another participant's edit. An undo that would invalidate newer shared relationships is rejected. **Saved** confirms a local commit; the collaboration status separately shows synchronization progress. Keep backups of the graph you need to retain.

## Encryption and the relay

Local saved records use the workspace's **AES-256-GCM encryption in IndexedDB**. Collaboration messages use **MLS (Messaging Layer Security, RFC 9420)** between approved devices, with 256-bit ChaCha20-Poly1305 message encryption, X25519 key agreement, Ed25519 message authentication and owner-signed membership policy. These are separate boundaries: the vault password and recovery key are never the room-sharing key and must never be placed in an invitation or sent to a participant.

The configured Cloudflare relay delivers encrypted messages. It receives normal request metadata, room and device identifiers, public admission/membership data, connection state, message sizes and timing. It is not anonymous communication. Approved participants decrypt the deliberately shared model and can retain a readable copy.

Removing a device or changing its role affects future authorized access after the membership change. It cannot erase content that participant already received, downloaded, copied or photographed. Closing a room and changing a password also cannot recall those copies.

## Reconnect, reload and lock

This release keeps MLS ratchets and private signing keys only in the live unlocked tab's memory. It does not restore them from a backup or saved room record. That avoids reusing cryptographic sender state from an older restored copy.

| Event | What to do |
| --- | --- |
| Temporary network loss while the same tab stays unlocked | Reconnect the existing live device and let it synchronize; exact encrypted retransmissions do not create a new edit |
| A participant reloads, closes the tab or locks/unlocks | Request access as a fresh device and obtain owner approval again |
| The owner's live tab is lost, reloaded or locked | Start a new room from the retained local diagram and invite participants again |
| Invalid authenticated update or incompatible shared graph | Stop normal sync, inspect the conflict and coordinate a reviewed recovery |

The local graph and encrypted CRDT association can survive a reload; they are not permission or private key material to resume the old room. A restored workspace backup contains the graph, not room access, MLS keys or private collaboration records. Keep the owner tab open and unlocked for the duration of an active session, and choose your session timer deliberately.

When a returning participant is approved as an **Editor** into the same room and disclosure scope, the app reconciles locally saved, previously unsent changes with the current shared drawing. Review the result before continuing. A returning **Viewer** receives the owner's current drawing and cannot publish former editor changes. If its local drawing differs, those changes are retained as a separate recovery diagram in **Projects**; the panel shows its name. This copy is local and does not alter the room. The owner should remove the previous device after approving the replacement so the participant list reflects the devices still in use.

**Update now** is blocked while the room lifecycle is connecting, awaiting approval, live or reconnecting. Leave/end the local room explicitly before applying an app update; update preparation never discards live room keys silently.

**Disconnect** leaves this browser's room session while preserving its local diagram. It does not remove another participant's copy. Owners can separately remove a device or close a room through the panel. Locking or clearing the app runtime ends the local live session; a later unlock does not revive old grants, jobs or room keys.

## Use an AI agent with an approved session

Create and approve the room through the human UI first. An agent can then inspect semantic collaboration status and edit through the existing graph endpoints when both its MCP grant and your room role allow it. There are no MCP endpoints to issue invitations, approve participants, retrieve private room keys or unlock a vault.

See [collaboration through API and MCP](/help/api-mcp/#inspect-an-approved-collaboration-session), [privacy](/privacy/#optional-realtime-collaboration), and [security](/security/#optional-realtime-collaboration).
