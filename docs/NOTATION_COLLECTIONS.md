# Notation collections

Visual Nerve adds portable graphical notation to ordinary editable diagrams. HIPO, the two classic DFD dialects, UML and BPMN have separate catalogs, symbol geometry, property definitions and relationship ends. They share the native graph and the existing editing, storage and collaboration paths.

The five collection IDs are `hipo`, `dfd-yourdon`, `dfd-gane-sarson`, `uml` and `bpmn`. `Diagram.notation` records a version-1 collection/family profile. Optional node and edge `notation` values record actual symbols and their structured properties. The ordinary `nodeType` remains independent. The profile guides creation and draft review; it does not silently rewrite existing objects.

## Examples and native references

`frontend/src/notation/templates.ts` exports discovery metadata in `notationTemplates` and fresh graphs from `createNotationGraph(key, name)`. All notation starting sets have native diagram type `freeform`. Unknown keys return `undefined` so the caller can continue its existing template lookup.

The New diagram gallery keeps all 35 built-in templates, with **Find a template**, **Template collection** and separate UML structure/behavior groups. `notation/TemplatePreview.tsx` constructs disposable canonical examples and renders their shared contours, sections and relationship decorations without reading or saving workspace documents. General, Classic Flowcharting, simulation and analytics previews retain their existing behavior.

Notation Properties stages numeric and strict text fields as local drafts. Enter or blur commits a valid value; Escape restores the previous saved value. Invalid intermediate numbers, multiplicities or other constrained values do not create repository writes. Timing observations have a separate explicit Apply action with ordered-time validation. Section text remains ordinary editable content.

| Stable template key        | Collection / family         | Specialist example                                                                                                 |
| -------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `hipo`                     | HIPO / VTOC                 | Four numbered modules, a linked overview IPO and a detailed IPO with extended description                          |
| `dfd-yourdon-demarco`      | Yourdon–DeMarco / data flow | External Customer/Warehouse, numbered transformations, stores and named data flows                                 |
| `dfd-gane-sarson`          | Gane–Sarson / data flow     | The same information model in the distinct rounded/identifier-compartment dialect                                  |
| `uml-class`                | UML / class                 | Attributes, operations, composition, endpoint multiplicities and interface realization                             |
| `uml-object`               | UML / object                | Particular order/line instances and populated slots                                                                |
| `uml-package`              | UML / package               | Nested members, dependency and package import                                                                      |
| `uml-component`            | UML / component             | Components, interface and attached port                                                                            |
| `uml-composite-structure`  | UML / composite structure   | Contained parts and attached ports with connectors                                                                 |
| `uml-deployment`           | UML / deployment            | Device, nested execution environment and deployed artifacts                                                        |
| `uml-profile`              | UML / profile               | Stereotype, metaclass and extension                                                                                |
| `uml-use-case`             | UML / use case              | Actor, subject boundary, include and extend                                                                        |
| `uml-activity`             | UML / activity              | Initial/final nodes, decision, guard and object flow                                                               |
| `uml-state-machine`        | UML / state machine         | States, entry/do information, transition trigger/guard/effect                                                      |
| `uml-sequence`             | UML / sequence              | Lifelines, attached executions, messages and replies at named ports                                                |
| `uml-communication`        | UML / communication         | Instance links and numbered messages                                                                               |
| `uml-interaction-overview` | UML / interaction overview  | Referenced interactions in guarded control flow                                                                    |
| `uml-timing`               | UML / timing                | Timing lifelines, state sections, time range and cross-lifeline messages                                           |
| `bpmn-process`             | BPMN / process              | Pool/lanes, activities, exclusive/default branch, subprocess, attached non-interrupting timer and data association |
| `bpmn-collaboration`       | BPMN / collaboration        | Two pools with separate sequence flows and inter-participant messages                                              |
| `bpmn-conversation`        | BPMN / conversation         | Three participants linked to a conversation node                                                                   |
| `bpmn-choreography`        | BPMN / choreography         | Choreography activities with initiating/responding participant sections                                            |

Containment uses native `parentId`; saved coordinates remain absolute canvas coordinates. Notation `attachmentId` and `relatedNodeId` store native node references. Named ports have an ID, side and optional fractional offset/direction/label. Relationship endpoints can refer to those ports. These references must be remapped with the graph when copying, importing or instantiating a saved template.

Owner movement carries attached glyphs by the same translation. Copying an owner includes its attachments, while copying an attachment includes its owner and preserves remapped references. Owner deletion cascades to attachments; a related module or classifier remains independently owned. Attachment positions are explicitly arranged and should be checked after resizing their host.

Sections are saved `compartments` with stable IDs, optional names and line entries. IPO examples use `input`, `process`, `output` and `extended-description` sections. UML examples use attributes, operations, slots, behavior, operands or states as appropriate. Choreography examples record participant sections. Fields belong to the catalog's family contract; an arbitrary metadata string does not become a supported notation property.

Fixed layouts bound their sections: an IPO chart permits at most three sections for the overview and four when its explicit diagram kind or Detail property selects a detailed IPO. Choreography task, sub-choreography and call-choreography permit at most three. These regions carry the symbol's defined information; additional unrelated sections are rejected rather than saved outside the drawing.

## Source mapping and advertised coverage

| Collection          | Primary reference                                                                                                 | Coverage and boundary                                                                                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HIPO                | IBM GC20-1850-0 Chapter 5, printed 13–17, Figures 11–14; IBM TR00.2209 printed 11–17                              | VTOC, overview/detail IPO, data areas and differentiated data/action/alteration/reference relationships. Historical GC20-1851 identifies the method; a complete GX20-1971 aperture inventory has not been verified. Supplemental classic media are identified separately. |
| Yourdon–DeMarco DFD | Edward Yourdon, _Structured Analysis_, Chapter 9; MIT CCS Working Paper 187, section 5, follows the Yourdon model | Processes, external entities, data stores, repeated occurrences, annotations and data flows. Draft review is not execution or a complete cross-document data dictionary/balancing system.                                                                                 |
| Gane–Sarson DFD     | Gane and Sarson, _Structured Systems Analysis: Tools and Techniques_, 1977/1979 editions                          | The distinct rounded process/number and open-store/identifier drawing vocabulary with the same core data-flow meanings.                                                                                                                                                   |
| UML                 | OMG UML 2.5.1, clauses 7–20 and Annex A                                                                           | Graphical modeling for all 14 diagram families, including structured symbols, endpoints, ports, contained elements and interaction/timing properties. This is not a complete UML abstract metamodel, OCL engine, code generator or XMI interchange implementation.        |
| BPMN                | OMG BPMN 2.0.2, clauses 7–12, especially Table 10.93 printed 259–260                                              | Process, collaboration, conversation and choreography graphical families; applicable event contexts, activity markers, participant relationships and supporting data. This is not BPMN execution, BPMN XML interchange or a conformance certification.                    |

UML family coverage means every advertised diagram family has its own editable example and appropriate catalog constructs. It does not imply every UML metaclass or every textual grammar is implemented. BPMN uses explicit applicable event contexts, rather than presenting every event marker on every boundary. The catalog remains the authoritative list of implemented symbols, connectors and editable fields.

## Browser behavior

New starting sets omit native `backgroundColor` and follow the current theme fill. An explicit saved `backgroundColor` remains an authored color; it is not migrated or recolored when Appearance changes. **Use theme background** clears it through the existing versioned node update. The 2D wrapper stays transparent for both themed and custom fills: only the canonical glyph paints the background. Captured 3D faces therefore retain transparent corners and open regions. Heading regions outside an opaque background, including event labels and open frames, inherit canvas text and editing-surface contrast; 2D, native SVG and the 3D fallback share that decision. The overlapping UML formal-parameter box uses the same opaque surface as its classifier. Semantic notation containers retain visible contour relief instead of inheriting the ordinary group's low-opacity body; the center stays open. 3D relationship captions and endpoint labels follow the theme's surface and text palette. The native node fields, schema and API/MCP editing contract are unchanged.

**Notation collections** is available in blank and ordinary diagrams. It is excluded from Process Simulator and documents with the analytics extension, which retain their specialized tools. A previously saved notation value remains visible in Properties for compatibility.

The palette selects collection, diagram family and symbol search. Node Properties selects a collection/symbol, recommended size, catalog fields, sections, attachments, related nodes and named ports. Relationship Properties selects connector notation, endpoint roles/multiplicities and source/target ports. Document Properties sets the profile and shows a draft notation review.

Titles, declarations in section entries and relationship labels remain explicitly authored text. Structured UML fields retain classifier, visibility, static and transition/message details without generating complete declarations or replacing the saved label. Required classifier/package keywords, interaction-frame operators and combined-fragment guards have separate visible annotations. Named-port edits validate the whole graph: dependent relationships must be moved to compatible ports before a referenced port can be removed or given an incompatible direction.

Changing a symbol or collection is an explicit edit. Clearing the object/edge collection restores default appearance. Clearing the document profile leaves its existing objects' notation intact. A node may use either IBM `flowchartSymbol` or general `notation`, but cannot save both. The UI clears the other presentation when assigning one. API clients switching between them clear the previous field with `null` in the same versioned PATCH or existing-node bulk update; a conflicting value is rejected atomically with `INVALID_NOTATION`.

Contextual quick-add uses typed `notation:<collection>:<symbol>` choices filtered by the object's explicit family, then its matching document profile. New elements use recommended dimensions, fresh titles and empty catalog sections without copying property values, named ports or references. The starting relation reflects the roles, such as DFD data flow, UML object/control flow or BPMN sequence/data/conversation relationships. Owner-bound symbols remain palette choices with explicit attachments. Ordinary and simulation quick-add retain their own behavior.

The common geometry supports the 2D drawing, 3D face representation and native visual export paths. Standard-notation detail strokes and compartments remain face information; the relief is not a three-dimensional semantics model. Native JSON is the portable representation for the complete notation data. Other exchange formats must disclose their actual conversion fidelity; a visual export is not UML XMI or BPMN XML.

## Validation and integration

Saved-value validation checks supported collections/symbols, field types and bounds, compartments, ports and references. The separate notation review reports selected modeling issues without mutating a graph. A clean draft report is a bounded structural result, not standards certification or proof of behavior.

When creating a built-in notation example through `POST /diagrams`, omit `notation` to use its canonical profile or supply that exact matching valid profile. A null, invalid or conflicting profile is rejected before a diagram is saved; a template does not silently overwrite a supplied incompatible profile.

The bridge and browser expose the same collections and portable values. See [API.md](../API.md) and [MCP.md](MCP.md) for the current discovery, editing and validation routes, capability and version contract. User procedures and notation comparisons are in the [Help collection guide](https://www.visualnerve.com/help/notation-collections/) and its family guides.

Version 0.9.0 advertises `standard-notations-v1`. `GET /notation/collections` returns collection metadata; the collection detail includes schema version, symbols and connectors. `POST /diagrams/{diagramId}/notation/validate` is a read-only structural review of the saved graph and returns its base version and issues without a write or operation receipt. Notation fields are whole-value replacements: omission preserves a saved value, and versioned partial edits may use `null` to clear it. Complete new/import/replacement records reject `null`.

## Primary sources

- [IBM _Improved Programming Technologies — An Overview_, GC20-1850-0 (1974)](https://bitsavers.trailing-edge.com/pdf/ibm/generalInfo/GC20-1850-0_Improved_Programming_Technologies_-_An_Overview_1st_ed_197410.pdf), Chapter 5, printed 13–17. This accessible primary account verifies the IPO/VTOC arrangement.
- [IBM _Preparing Method of Operation Diagrams — The HIPO Method_, TR00.2209 (1971)](https://bitsavers.trailing-edge.com/pdf/ibm/generalInfo/TR00.2209_Preparing_Method_of_Operation_Diagrams_-_The_HIPO_Method_Jul71.pdf), printed 11–17. The historical report distinguishes relationship purposes and data areas.
- [IBM _Flowcharting Techniques_, GC20-8152-1](https://fulmanski.pl/zajecia/wdi/zajecia_20142015/materialy/IBM-FlowchartingTechniques-GC20-8152-1.pdf), printed 3–4. The separate supplemental media source verifies document, manual input, display, online storage, magnetic tape, punched card and magnetic disk. It does not establish a complete HIPO stencil aperture inventory.
- [Edward Yourdon, _Structured Analysis_, Chapter 9: Dataflow Diagrams](https://www.yourdon.com/strucanalysis/wiki/index.php?title=Chapter_9). The original author site is an archival reference and may be unavailable. An indexed author PDF is [_Just Enough Structured Analysis_, Chapter 9](https://citeseerx.ist.psu.edu/document?doi=fb9a2c0e0446666d31538209412a8e61c835182e&repid=rep1&type=pdf); access may be restricted. The accessible [MIT CCS Working Paper 187, section 5](https://ccs.mit.edu/papers/CCSWP187.html) defines the modeled process/store/terminator/flow framework and attributes its example to Yourdon.
- [Gane and Sarson, _Structured Systems Analysis: Tools and Techniques_](https://archive.org/details/structuredsystem0000gane). The linked archival record is the 1977 Improved System Technologies edition. The [1979 Prentice-Hall edition record](https://books.google.com/books/about/Structured_Systems_Analysis.html?id=c8xWAAAAMAAJ) confirms the later publication. Full archival page access may require borrowing.
- [OMG UML 2.5.1 normative specification](https://www.omg.org/spec/UML/2.5.1/PDF) and [specification record](https://www.omg.org/spec/UML/2.5.1/).
- [OMG BPMN 2.0.2 normative specification](https://www.omg.org/spec/BPMN/2.0.2/PDF) and [specification record](https://www.omg.org/spec/BPMN/2.0.2/).

IBM is a trademark of International Business Machines Corporation. OMG, UML and BPMN names identify the published notation and belong to their respective owners. Visual Nerve is not affiliated with or endorsed by IBM or OMG and does not claim a standards conformance certification.
