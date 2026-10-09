# Editable diagram export acceptance

The new `.drawio` export is an editable XML drawing of the saved logical diagram.
Native graph/backup format version
remains 1; local API and bridge version is 0.6.0 with `exchange-export-v1`.

## Implementation boundaries

| Module | Responsibility |
| --- | --- |
| `frontend/src/export/exchange-scene.ts` | Allowlisted snapshot and canonical 2D projection, selected scope, topology/geometry/text budgets |
| `exchange-types.ts`, `exchange-xml.ts` | Neutral drawing contract, explicit limits and safe bounded XML |
| `exchange-drawio.ts` | Editable mxCells, groups, styles and attached connectors |
| `exchange-worker.ts`, `exchange-jobs.ts` | Local worker, progress, transient binary results, cancellation and original-session authority |
| `exchange-download.ts`, `components/ExportDialog.tsx` | Human download through the same controller, with translated format/scope notices |
| `storage/exchange-export-commands.ts` | Read-only REST/MCP start/status/result/cancellation and separately decoded base64 byte chunks |
| `backend/cmd/openapi/exchange_exports.go`, `backend/internal/server/exchange_description.go` | Generated schemas and semantic MCP endpoint discovery |

The complete contract is in [API.md](../../API.md#editable-diagram-exchange),
[MCP.md](../MCP.md#export-an-editable-drawio-diagram) and
[EXPORT_FORMAT.md](../../EXPORT_FORMAT.md#drawio-editable-documents).
UI and API export the same immutable model snapshot. Rendering does not become
a second data source. Completed bytes stay in bounded memory and are erased on
lock/cancellation; API/MCP jobs also retain their original integration grant.

Editable drawings deliberately use a white surface and dark node/group/edge
labels, independent of app Appearance. Stored node/edge color accents and
derived mind map branch colors remain; pale line accents do not become pale
label text. draw.io disables adaptive recoloring so its dark editor still shows
the light drawing. SVG/PNG/PDF appearance behavior is unchanged. Native JSON
retains stored styling; workspace backups additionally include appearance settings.

## Automated checks

Focused unit checks cover XML escaping, forbidden controls, Unicode, geometric
groups, derived mind map connectors, suppressed CSV parent relationships,
selected internal edges, arrow/dash styles, output
budgets, original authority revocation, retention and structured API errors.
Independent XML inspection and importer round trips supplement these
checks; self-import alone does not prove destination compatibility.

`exchange-export.spec.ts` uses actual Chrome workers and the real REST/MCP
bridge. It compares UI downloads with every binary API chunk, tests selected
and 3D canonical geometry, rejects writes under Read only, and exports all 7,000
nodes/6,999 edges while checking UI responsiveness. The large fixture keeps a
normal saved viewport, so off-screen canvas mounting is independent of export.
The same UI/API bytes are also asserted after switching to dark Appearance,
including independent dark ink on a deliberately pale connector.

`svg-background.spec.ts` additionally verifies an encrypted workspace: after
lock, unlock and a fresh read grant, both a retained draw.io file and blocked draw.io
worker are inaccessible. The saved model remains unchanged.

Four opt-in captures exercise the actual dialog at 1440×1000 and 390×844 in
light/dark appearance, checking bounds and reachable actions:

```sh
cd frontend
VISUAL_NERVE_CAPTURE_EXCHANGE=1 npm run test:e2e -- tests/e2e/exchange-export.spec.ts
```

## Destination evidence and remaining verification

The synthetic [draw.io file](editable-acceptance.drawio) was loaded in the
actual draw.io browser editor. Assembly was moved, resized and its text edited;
both connected edges followed and retained their source/target attachments.
The [screenshot](drawio-edited.webp) records the edited diagram. Saving and
reopening that drawing in the destination was not separately verified.
Its edited native XML was loaded in a fresh draw.io editor; geometry and text
survived, and both connectors followed a further move. A separate dark draw.io
Appearance check verifies white background and dark labels with preserved accents
([native editor screenshot](drawio-dark-editor.webp)).

No production deployment is part of this change. Deployment remains manual.
