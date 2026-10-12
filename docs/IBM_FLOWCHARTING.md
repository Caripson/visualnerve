# IBM flowcharting

Visual Nerve provides the IBM Flowcharting Template symbol family as editable native objects in 2D and 3D. The sources are the original X20-8020 stencil and the revised GX20-8020-1 / GX20-8020-2 stencil and explanatory sleeve. The [browser guide](https://www.visualnerve.com/help/ibm-flowcharting/) covers ordinary editing; API and MCP use the same saved graph.

## What the catalog counts

The revised physical stencil has **26 apertures**, including four directional arrowheads; the original has 25. The holes are distinct from completed flowchart meanings. The revised sleeve supplies additional symbols by adding lines or combining cutouts.

The digital catalog contains **43 entries**:

- 32 completed symbols described on the revised sleeve;
- two raw apertures, the sort outline and magnetic-tape circle;
- four arrowheads, one for each direction;
- five original-revision forms.

Exactly 26 entries have `physicalCutout: true`, scoped to the revised stencil. The other entries are 12 completed composite/drawn forms and five original forms. `category` separates `symbol`, `outline`, `arrowhead` and `legacy`; `construction` distinguishes `cutout`, `composite` and `drawn`. `revisions` lists the source forms that share each outline. Prefer completed symbols for a revised workflow. The two raw outlines reproduce the bare revised holes; `/flowchart/stencils` supplies each revision's actual membership.

The [original December 1970 scan](https://www.lola.org.uk/docs/IBM%20Flowchart%20Template,%20GX20-8020-1%20UM-010,%20IBM,%201970-12%20Scan.pdf) shows the sleeve on PDF page 1 and both stencil faces on page 2. The [Smithsonian GX20-8020-1 record](https://www.si.edu/object/ibm-gx20-8020-1-um010-flowcharting-template:nmah_694227) independently confirms the 26 holes and December 1970 sleeve.

### Physical apertures

| Catalog ID                 | Label                  |
| -------------------------- | ---------------------- |
| `ibm-process`              | Process                |
| `ibm-input-output`         | Input / Output         |
| `ibm-document`             | Document               |
| `ibm-manual-operation`     | Manual Operation       |
| `ibm-preparation`          | Preparation            |
| `ibm-merge`                | Merge                  |
| `ibm-sort-outline`         | Sort aperture          |
| `ibm-decision`             | Decision               |
| `ibm-magnetic-tape-circle` | Magnetic Tape aperture |
| `ibm-display`              | Display                |
| `ibm-auxiliary-operation`  | Auxiliary Operation    |
| `ibm-arrow-up`             | Arrowhead Up           |
| `ibm-arrow-down`           | Arrowhead Down         |
| `ibm-arrow-left`           | Arrowhead Left         |
| `ibm-arrow-right`          | Arrowhead Right        |
| `ibm-communication-link`   | Communication Link     |
| `ibm-manual-input`         | Manual Input           |
| `ibm-extract`              | Extract                |
| `ibm-terminal`             | Terminal / Interrupt   |
| `ibm-connector`            | Connector              |
| `ibm-punched-card`         | Punched Card           |
| `ibm-punched-tape`         | Punched Tape           |
| `ibm-online-storage`       | Online Storage         |
| `ibm-keying`               | Keying                 |
| `ibm-transmittal-tape`     | Transmittal Tape       |
| `ibm-offpage-connector`    | Offpage Connector      |

### Completed forms requiring additions

The [IBM Flowcharting Techniques manual](https://fulmanski.pl/zajecia/wdi/zajecia_20142015/materialy/IBM-FlowchartingTechniques-GC20-8152-1.pdf), printed pages 2-7, documents the revision changes, symbol definitions and construction convention.

| Catalog ID               | Completed geometry                                                            |
| ------------------------ | ----------------------------------------------------------------------------- |
| `ibm-annotation`         | Three-sided open bracket; connect the explanation with an appropriate leader. |
| `ibm-predefined-process` | Rectangle with two internal vertical lines.                                   |
| `ibm-parallel-mode`      | Two parallel lines marking simultaneous operations.                           |
| `ibm-card-deck`          | Card outline extended into a perspective stack.                               |
| `ibm-card-file`          | Card outline with offset corner marks.                                        |
| `ibm-magnetic-tape`      | Circle with a horizontal tangent at the bottom right.                         |
| `ibm-magnetic-disk`      | Vertical storage outline with elliptical disk lines.                          |
| `ibm-core`               | Rectangle with internal top and left lines.                                   |
| `ibm-magnetic-drum`      | Horizontal storage outline with an elliptical right end.                      |
| `ibm-collate`            | Opposing triangles meeting at their tips.                                     |
| `ibm-sort`               | Tall diamond divided horizontally at its midpoint.                            |
| `ibm-offline-storage`    | Downward triangle with a horizontal stripe near its tip.                      |

## Revisions and fidelity

### Original forms

| Catalog ID                      | Original geometry                                                           |
| ------------------------------- | --------------------------------------------------------------------------- |
| `ibm-legacy-input-output`       | Wide-top, downward-tapering trapezoid.                                      |
| `ibm-legacy-predefined-process` | Hexagon with flat top and bottom.                                           |
| `ibm-program-modification`      | Rectangle ending in a right-pointing tip.                                   |
| `ibm-clerical-operation`        | Slanted parallelogram.                                                      |
| `ibm-perforated-tape`           | Original wave orientation, inverted by the revised punched-tape convention. |

The earlier [X20-8020 artifact](https://www.si.edu/object/ibm-x-20-8020-flowcharting-template:nmah_690078) has 25 holes. Its I/O trapezoid, clerical-operation parallelogram, predefined-process hexagon and separate program-modification pentagon belong to the older convention.

Shared outlines retain their catalog IDs even where older labels differ: Processing/Annotation uses `ibm-process`, Disk/Drum/Random Access File uses `ibm-online-storage`, Online Keyboard uses `ibm-manual-input`, and the large Magnetic Tape/Sorting/Collating circle uses `ibm-magnetic-tape-circle`. The old Offline Storage File uses the unstriped downward triangle (`ibm-merge`) with a taller manual resize. The source membership is an outline inventory, not a claim that modern labels and default proportions apply unchanged to the original convention.

The revised convention changes I/O to a parallelogram, manual operation to a trapezoid, preparation to a hexagon and predefined process to a striped rectangle. Program modification uses preparation. Perforated tape becomes inverted punched tape. These changes are documented in the IBM manual's printed pages 2 and 4-6; the catalog follows the revised meanings.

The [GX20-8020-2 record](https://www.si.edu/object/ibm-gx20-8020-2-flowcharting-template:nmah_694225) documents 26 cutouts and revised ruler divisions. Its [original photograph](https://ids.si.edu/ids/deliveryService?id=NMAH-AHB2012q05391&max=600) shows the same symbol family and arrangement. Individual aperture dimensions across revisions have not been measured. The digital geometry preserves recognizable outlines and construction details; it is resizable and is not a metrological copy of the plastic stencil. The ruler and grid are not graph objects.

IBM identifies offpage connector, transmittal tape and keying as its additional conventions beyond the referenced international symbol set. Names identify this historical source; Visual Nerve does not claim IBM endorsement or standards certification.

## Browser use and rendering

Choose **IBM Flowcharting Template** when creating a diagram. Select an object and use **IBM flowchart symbol** in Properties to change its glyph. Edit its ordinary title, description, status, color and relationships as for other objects. The selected glyph is stored in `GraphNode.flowchartSymbol`; the existing `nodeType` remains the object's semantic kind.

Titles and icons are centred within each symbol's content box. Double-click or double-tap the title in 2D, the object's face in 3D, or select one object and press F2 to rename it in place. Enter or blur commits, Escape cancels, and a committed rename supports Undo. **Node background color** changes `GraphNode.backgroundColor` independently of the `color` accent; **Use theme background** clears the saved fill. This editing behavior also applies to ordinary node cards.

The template creates 43 catalog specimens followed by an eight-object connected batch-processing example, for 51 objects and eight connections in total. The example validates input records, stores accepted records on magnetic disk and prints a report; rejected records return through manual correction. Every specimen and example object remains editable. **IBM symbols** adds a selected glyph as a new object; **Use stencil proportions** applies its recommended width and height. **Default node appearance** removes the selected glyph.

2D, 3D and SVG rendering consume the same catalog geometry, including internal lines. Native JSON and workspace backups retain the symbol ID. Changing view does not create another graph. PNG, PDF and SVG use the existing 2D export path; 3D retains the shared objects and its saved spatial placement.

Editable Draw.io export preserves titles, relationships and explicit background colors, using the ordinary semantic node type's shape for IBM objects. The export reports this shape-fidelity limitation. Use native JSON or SVG to retain the exact stencil geometry.

An IBM glyph communicates a flowchart convention. It does not execute a process, create a storage device or configure Process Simulator behavior. Use labelled native connections for workflow direction; a catalog arrowhead is an editable specimen, distinct from a graph connection's direction.

## API and MCP

`GET /flowchart/symbols` returns a direct array of all 43 catalog records, including `id`, `label`, `nodeType`, `physicalCutout`, `category`, `construction`, `revisions`, outline/detail paths and the text content box. `GET /flowchart/stencils` returns revision records with `revision`, `label` and `physicalCutoutSymbolIds`: 25 IDs for `GX20-8020` and 26 each for `GX20-8020-1` / `GX20-8020-2`. The original record's `symbolLabels` map supplies the historical labels for shared IDs, including Processing/Annotation and Online Keyboard. Direct REST prefixes these paths with `/api/v1`. Discovery requires the accepted, connected browser and an existing Read only or Read + write grant. Static API documentation remains available without a browser.

Discover through MCP:

```json
{ "path": "/flowchart/symbols", "method": "GET" }
```

Create the editable example with the existing diagram endpoint:

```json
{
  "path": "/diagrams",
  "method": "POST",
  "data": { "name": "IBM workflow", "template": "ibm-flowcharting" }
}
```

Creation requires Read + write and returns the saved Diagram with HTTP 201. The template uses the ordinary `flowchart` diagram type. Read its graph through `GET /diagrams/{diagramId}` before choosing objects to edit.

Apply a glyph to an existing node with its current version:

```json
{
  "path": "/nodes/<nodeId>",
  "method": "PATCH",
  "data": { "version": 7, "flowchartSymbol": "ibm-magnetic-disk" }
}
```

Omitting `flowchartSymbol` from a partial update preserves it. Explicit JSON `null` removes it in a node PATCH or existing-node bulk upsert, returning the ordinary node appearance. New or complete records accept a valid catalog ID or omission; null, empty and unknown IDs are rejected. `flowchartSymbol` does not extend the `nodeType` enum. Graph format version 1 and workspace schema version 8 remain unchanged.

Use the actual version just read. The existing permissions, optimistic concurrency, atomic bulk validation and [operation recovery](../API.md) rules still apply. The bridge advertises `ibm-flowcharting-v1`; use current API documentation and a refreshed browser tab when discovering this capability.
