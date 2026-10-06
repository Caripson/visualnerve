# Import draw.io and Visio diagrams

Import `.drawio` files (draw.io XML) and `.vsdx` files (Visio's XML ZIP format) as editable Visual Nerve diagrams. Legacy binary `.vsd` and macro-enabled `.vsdm` files are unsupported. Export those files to `.vsdx` or draw.io XML in their source application first.

Choose **Import** or drop a supported file onto the workspace. In **Import diagram file**, select **Diagram page**, review the preview and import warnings, optionally edit **Diagram name**, then choose **Create diagram**. Preview runs locally in a cancellable Web Worker and does not save or open a project. Creation saves only the selected page in one IndexedDB transaction and opens its native graph. Cancel closes the draft and stops pending analysis; replacing the file clears a previous preview.

## Native editing and fidelity

Recognized text, positions, dimensions, groups, connections, basic colors and safe HTTP(S) links become ordinary Visual Nerve nodes and relationships. Group positions use the same absolute geometry as native diagrams. Objects can be moved, renamed, connected, assigned owners/status and edited through Properties; normal undo, 2D/3D, drawing, JSON/backup and PNG/PDF exports apply.

This conversion is an approximation, not a pixel-identical drawing or an editable source-file binding. Advanced/custom shapes, rich formatting, rotations, connector routing/waypoints and source-specific features may be simplified or omitted with warnings. Connectors without identifiable object endpoints are omitted with warnings. Review both file-level and selected-page warnings before creation. Images, external relationships, embedded objects, macros and scripts are never fetched or executed. Unsafe links are discarded; retained links require absolute HTTP(S) URLs. The importer does not create source-format exports or update the original file.

## Limits and data handling

Limits are 32 MiB for the input file, 64 MiB of expanded data, 2,048 ZIP entries, 100 pages, 20,000 objects and 40,000 relationships across all pages, and nesting depth 256. XML parsing also bounds elements at 250,000. Preview warnings are bounded to 200 per page and 200 for the file. ZIP/XML parsing rejects malformed or excessive input before any project is saved. Worker analysis times out after 30 seconds. File shape and size affect processing time and readability. Environments without Web Workers use a synchronous compatibility parser with the same size/structure bounds; parsing there cannot be interrupted until it returns.

XML/ZIP content and unselected-page graphs exist only in the temporary import draft/worker. IndexedDB stores the selected native diagram, its recognized text and safe links, and ordinary graph fields/provenance. Complete XML, archive entries, embedded image bytes, executable content and unselected pages are not retained. Text, object names and links may contain sensitive information; they follow normal diagram JSON, backup and text-export behavior. Review them before sharing. Your original file stays on your device. See [privacy](PRIVACY.md).

## REST and MCP

The exact `POST /diagram-files/preview` endpoint accepts only:

```json
{
  "format": "drawio",
  "data": "<mxfile>...</mxfile>",
  "name": "Optional diagram name"
}
```

`format` is `drawio` or `vsdx`. Draw.io `data` is XML text; Visio `data` is strict padded standard base64 containing the `.vsdx` ZIP bytes, without a data-URL prefix or whitespace. Optional `name` must be a nonempty string of at most 500 characters. Unknown fields are rejected.

The response is `DiagramImportResult`:

```json
{
  "format": "drawio",
  "pages": [
    { "id": "source-page-id", "name": "Page 1", "graph": {}, "warnings": [] }
  ],
  "warnings": []
}
```

Each `graph` is a complete canonical Graph; `{}` above is only a placeholder. Page IDs are source strings, not Visual Nerve UUIDs. Preview permits **Read only**, changes no active diagram and creates no stored project.

Use `POST /import` with the same `format`, `data` and optional `name`, plus `pageId` from preview, to save and open one page. A one-page file can omit `pageId`. A multipage file without `pageId` returns 422 and instructs the caller to preview/select a page; an unknown page ID also returns 422. Neither case saves partial work. This endpoint requires **Read + write**. Existing JSON/Markdown/CSV imports keep their existing contract.

The optional loopback bridge passes source transiently to the browser, stores no application records and uses the same worker and transactions as the UI. Revoking browser access or closing the workspace cancels analysis; storage acceptance and write permission are checked again before saving. Worker analysis has a 30-second deadline; preview/import transports allow 45 seconds for analysis and persistence. The existing JSON request/response envelope is 32 MiB, so integration files must be smaller after JSON escaping/base64: a `.vsdx` file must be below roughly 24 MiB, and large preview responses must also fit. UI file import retains the decoded 32 MiB file limit. See [API.md](../API.md).
