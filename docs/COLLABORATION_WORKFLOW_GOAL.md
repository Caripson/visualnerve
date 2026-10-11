# Collaboration workflow goal

Status: implemented and locally verified. Work directly on `main`; production
rollout remains manual. CI verifies the pushed revision before this goal is closed.

## Intended result

Users collaborate around diagram content with document participant profiles,
distinct participant colors, node/diagram comments, a bounded shared activity
feed, node-linked action items, and optional small profile pictures. Profiles
are labels belonging to a document, not accounts or verified company identities.
Approval of a fresh live device remains a separate human decision.

Persist the versioned collaboration document inside `diagram.collaboration`,
using existing encrypted IndexedDB diagram storage. UI and API/MCP use the same
domain actions and validation. Existing documents without the field remain valid.
Native JSON/backups include the document; live credentials and key state remain
excluded. Imported/copied diagrams remap node and document references coherently.

## Implementation sequence

1. Repair presence/control overlap and responsive control placement; add
   accessible participant colors/initials and bounded pointer/selection overlays.
2. Add the independently versioned, bounded document domain and regression tests.
3. Bind live approved devices to document profiles through owner-authenticated,
   encrypted room messages; do not trust a participant's self-claimed profile ID.
4. Add profile, comment, activity and action-item UI, including local-only use,
   role checks, orphaned-node explanations, image limits and mobile layout.
5. Add semantic document/action API endpoints and MCP discovery, schemas and
   examples. Human room admission and unlock remain UI-only.
6. Verify encrypted persistence, two actual browser workspaces, grants, viewers,
   malformed input, import/export, retention limits, offline/reload and mobile.
7. Update Help/GitHub documentation and screenshots, run required checks, commit,
   push and verify CI before declaring the goal complete.

## Acceptance criteria

- Live indicator and remote markers never cover zoom/Fit or intercept gestures.
- Participants have readable, consistent labels and colors in light/dark modes.
- A stable profile survives document save/reload/export; it grants no room access.
- Viewers remain read-only. Comments do not bypass access through presence.
- Domain actions derive authors/permissions from application context, never from
  caller-supplied author fields. New device/profile association requires the owner.
- Comments support replies, own-text editing and explicit resolution/moderation.
- Tasks reference a node and profile, with status/date; process ownership is separate.
- Deleted nodes leave understandable orphaned comments/tasks rather than erasing work.
- Activity is bounded and summarizes semantic edits, not every drag/keystroke.
- Activity is informational editable document content, not an immutable audit log;
  client timestamps and person labels are not independently verified evidence.
- Avatars are optional bounded raster uploads, stripped/re-encoded locally; external
  image URLs and SVG are rejected. Shared content can be retained by recipients.
- All critical document fields are available through the existing API/MCP model.
- No mandatory accounts/cloud database/SQLite, AI dependency or production deploy.

## Architecture and modules

`frontend/src/collaboration/model/` owns types, strict validation, actor-bound
mutations, activity retention, raster bounds and import remapping. The optional
`Graph.diagram.collaboration` field uses the existing encrypted diagram record;
there is no new database or table. `storage/repository.ts`, `storage/operations.ts`,
`history/backup.ts`, `history/store.ts` and `templates/templates.ts` preserve this field and remap
references on import/duplication, while excluding private acting-profile settings.

`collaboration/document-api.ts` adapts versioned actions to the same repository
transaction used by the UI. Live role/profile context comes from
`collaboration/access.ts`, the controller and document gateway. The owner assigns
approved device profiles through encrypted presence/snapshots; association state
is ephemeral and is never a portable account or admission credential.

`collaboration/document/path-state.ts` merges collection items and message fields
by stable UUID, orders activity/replies by logical sequence, and projects bounded
history. `document/scope.ts` validates every retained document path, including
fields hidden by deleted ancestors or retention. This is structural allowlisting,
not exhaustive semantic validation of hidden values or secret detection in text. Rejected updates leave the
accepted CRDT state unchanged.

`collaboration/ui/document/` separates Profiles, Comments, Tasks and Activity UI.
`DocumentWorkspace.tsx` coordinates those views; `ParticipantAvatar.tsx` and
`PresenceCanvasLayer.tsx` provide readable identity markers. `presence-layout.ts`
and `usePresenceDock.ts` reserve clear canvas space around actual controls,
player, drawers and update notices. Avatar upload decoding is bounded separately
from the persisted raster validation.

The existing API/MCP surface is version **0.8.0**, with capability
`collaboration-document-v1`. `backend/cmd/openapi/collaboration-document.go`
generates the action/document schemas and the server's MCP description exposes
both new paths. `API.md`, `docs/MCP.md`, `EXPORT_FORMAT.md`, README and the Help,
privacy and security pages describe the same behavior. All eight app languages
include the new controls and disclosure notices.

## Document schema

The diagram type remains unchanged; document work is optional on every diagram:

```json
{
  "diagram": {
    "collaboration": {
      "schemaVersion": 1,
      "profiles": [],
      "comments": [],
      "tasks": [],
      "activity": []
    }
  }
}
```

| Collection | Semantic fields |
| --- | --- |
| profiles | id, name, color?, avatarDataUrl?, createdAt, updatedAt |
| comments | id, nodeId?, retained nodeTitle?, authorId, resolved/resolution actor/time, createdAt, updatedAt, messages |
| messages | id, authorId, text, sequence, createdAt, updatedAt |
| tasks | id, nodeId, retained nodeTitle?, title, description?, authorId, assigneeId?, status, dueDate?, createdAt, updatedAt |
| activity | id, kind, source, authorId?, sequence, timestamp, summary, nodeIds?, entityId? |

Actions accept `{baseVersion,action}`; authors, roles, new IDs and clocks derive
from application context. Client attempts to submit them are rejected. Existing
document work cannot be replaced through Diagram PATCH or full Graph PUT; an
omitted field is inherited for older clients. Native import/backup remain explicit
portable content operations, not verified audit evidence.

## Current verification

Implemented and verified in two actual encrypted browser workspaces through a
local-only relay: approval, title edit, comment/reply, thread resolution, assigned
task and status update, room close and empty participant state. Twenty-nine real
app screenshots cover desktop/mobile and light/dark; the Help includes fourteen
optimized screenshot assets. Presence/control bounding-box assertions pass in
the actual app on desktop and mobile.

Separate component browser suites cover 80 document layouts/accessibility/image
cases and 70 presence/overlap/gesture cases. Domain tests cover concurrent
threads/replies/tasks, clock skew, history retention, malformed retained paths,
actor forgery, stale versions, viewer restrictions, encrypted-storage integration,
private preference exclusion and native remapping.

Final internal review found and fixed concurrent last-message deletion,
raw activity retention after concurrent appends, and missing settings scope on
native bulk/history restore. New regressions cover each case, including stale
baseline pruning that keeps newer peer activity. 3D movement is excluded from
semantic activity just like 2D dragging. Contradictory deletion/reference changes
still require explicit conflict recovery; they are not silently discarded.

The complete frontend unit suite passed: 325 files and 3,423 tests. Forty focused
API/storage tests passed after the final bridge fix accepting JSON `null` for an
argument-free document GET. Go race tests and vet, TypeScript, formatting and the
production build passed. The production chunks remain below 500 kB.

The whole-product browser run passed 293 tests with 15 explicitly skipped optional
capture cases; one existing particle-transit timing assertion failed. The original
assertion subsequently passed unchanged in three isolated runs and the complete
ten-test collaboration/process-building sequence. It also passed in three isolated
and one complete sequence with GPU disabled; that comparison does not establish a
GPU cause. Browser assertions have not been weakened. A new native encrypted-storage
test verifies UI/API parity, reload/unlock, the first cold API mutation and the first
cold history restore, including preservation of the private acting-profile setting.

CI repeats the whole-product suite and cross-browser crypto checks on the pushed
revision. Release assurance remains subject to
[collaboration deployment gates](COLLABORATION_DEPLOYMENT.md) and the limitations
in [the internal review](COLLABORATION_SECURITY_REVIEW.md). Internal verification
does not replace the independent review required by those production gates.
