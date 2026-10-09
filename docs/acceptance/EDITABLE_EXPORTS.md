# Editable diagram export acceptance

The new export formats are editable drawings of the saved logical diagram:
`.drawio` XML and preview `.vsdx` OPC packages. Native graph/backup format version
remains 1; local API and bridge version is 0.6.0 with `exchange-export-v1`.

## Implementation boundaries

| Module | Responsibility |
| --- | --- |
| `frontend/src/export/exchange-scene.ts` | Allowlisted snapshot and canonical 2D projection, selected scope, topology/geometry/text budgets |
| `exchange-types.ts`, `exchange-xml.ts` | Neutral drawing contract, explicit limits and safe bounded XML |
| `exchange-drawio.ts` | Editable mxCells, groups, styles and attached connectors |
| `exchange-visio.ts`, `exchange-visio-shapes.ts` | Native shapes, nested groups, ShapeSheet cells, glue and OPC relationships |
| `exchange-worker.ts`, `exchange-jobs.ts` | Local worker, progress, transient binary results, cancellation and original-session authority |
| `exchange-download.ts`, `components/ExportDialog.tsx` | Human download through the same controller, with translated format/scope notices |
| `storage/exchange-export-commands.ts` | Read-only REST/MCP start/status/result/cancellation and separately decoded base64 byte chunks |
| `backend/cmd/openapi/exchange_exports.go`, `backend/internal/server/exchange_description.go` | Generated schemas and semantic MCP endpoint discovery |

The complete contract is in [API.md](../../API.md#editable-diagram-exchange),
[MCP.md](../MCP.md#export-an-editable-drawio-or-visio-diagram) and
[EXPORT_FORMAT.md](../../EXPORT_FORMAT.md#drawio-and-visio-editable-documents).
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
selected internal edges, arrow/dash styles, OPC relationships/glue, output
budgets, original authority revocation, retention and structured API errors.
Independent package inspection and native importer round trips supplement these
checks; self-import alone does not prove destination compatibility.

`exchange-export.spec.ts` uses actual Chrome workers and the real REST/MCP
bridge. It compares UI downloads with every binary API chunk, tests selected
and 3D canonical geometry, rejects writes under Read only, and exports all 7,000
nodes/6,999 edges while checking UI responsiveness. The large fixture keeps a
normal saved viewport, so off-screen canvas mounting is independent of export.
The same UI/API bytes are also asserted after switching to dark Appearance,
including independent dark ink on a deliberately pale connector.

`svg-background.spec.ts` additionally verifies an encrypted workspace: after
lock, unlock and a fresh read grant, both a retained VSDX file and blocked draw.io
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

The synthetic [Visio file](editable-acceptance.vsdx) contains five native shapes,
three connectors and six glue records. Inkscape 1.4.2 with libvisio imported and
rendered it successfully. That independent check exposed group text ordering,
which was corrected and regression tested. Its SVG conversion flattens multiline
labels; an unchanged fixture declaring Microsoft Visio 16.0000 exhibits the same
consumer limitation. This is not evidence of Microsoft Visio text behavior.
Dark-workspace conversion exposed a white group title on the receiving white
page. The shared portable palette and independent edge label ink correct it;
the independent renderer confirms readable group and connector text without
adding background shapes or pages.

**Microsoft Visio compatibility remains unverified.** The UI, API capabilities
and documentation consistently mark VSDX as a preview. Before removing that
label, open the provided file in Microsoft Visio and verify all of the following:

1. It opens without repair/errors, and all titles, Unicode and multiline labels
   are readable, including Operations and the grouped Assembly shape.
2. Move and resize Assembly; both attached connectors follow correctly.
3. Move the Operations group; its member shapes and internal connection follow.
4. Edit a label, save, close and reopen; the edit and connector attachments remain.
5. Record the Visio version and any limitations. A successful re-import into
   Visual Nerve or Inkscape does not replace this native verification.

No production deployment is part of this change. Deployment remains manual.
