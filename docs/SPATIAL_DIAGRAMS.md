# Shared 2D and 3D diagrams

The view switch opens two presentations of the same canonical diagram. Node IDs, hierarchy, relationship endpoints/directions, titles, descriptions, notes, URLs, ownership and status remain shared. Changing a camera or a 3D position never rewrites `x`, `y`, `width` or `height`. The existing React Flow overview is the editable 2D layout and export source. Three.js supplies a separate lazy-loaded WebGL view of diagram objects, text and connections.

## Navigation and editing

Mind maps without explicit 3D positions are arranged automatically into compact branch clusters. The hierarchy determines the clusters, subtree size determines space, and placement is deterministic without a force simulation. Ordinary diagrams derive their default placement from the 2D layout and relationship depth. Explicit positions take precedence.

Choose **3D**, then drag to rotate, scroll/pinch to zoom and use the secondary pointer gesture to pan. Front/Back/Left/Right/Top choose named orientations; Fit frames visible objects; Focus selected centers a selected object. Keyboard arrows rotate a focused 3D canvas, +/− zoom and Home fits. Camera changes save after interaction rather than on every animation frame. **2D** and **Return to 2D** remain available during loading, rendering failure and context loss.

Click an object or relationship to select it. The searchable, paged **Objects and relationships** list provides keyboard selection and access when WebGL is unavailable. Properties edits work in both views, and completed objects remain visibly marked. Connect selected objects using Properties or **Connect nodes**, then edit direction, style and label. **3D placement** changes independent world coordinates; Automatic position returns an object to derived placement. The 2D pen layer stays in the overview and exports.

**Data → New 3D truck lifecycle example** (phones: **…**) creates a truck lifecycle diagram with ordinary topics, descriptions and connections. AI/MCP can create diagrams over any subject using the same node and relationship commands. A truck lifecycle can contain thousands of topics about components, operation, repairs and recycling; depth and different viewpoints help explore these connections while retaining the same graph.

## Storage and MCP

Reserved fields are `diagram.settings.spatialView` and `node.metadata.spatial`, each with `version: 1`. They reuse the existing IndexedDB records and exchange format. No extra database or hosting service is required. JSON import, duplicate/paste and full backups preserve the fields; pasted explicit positions receive an offset. Invalid reserved fields reject the whole transaction.

`POST /spatial-diagrams` with `{ "name": "Project overview", "type": "mindmap" }` creates, saves and opens an empty 3D diagram. The existing MCP `visual_nerve_request` tool sends the command through the consent-controlled local bridge. Responses include canonical IDs and versions for subsequent population and edits. Read-only access rejects creation and updates. See [API contract](../API.md) and the generated OpenAPI schemas for exact fields.

## Export and performance

PNG and PDF always use the 2D layout, including labels, relationships, current data-view semantics, status and visible pen strokes. Complete diagram and selected-object scopes behave as in 2D. While 3D is active, **Saved 2D viewport** uses the saved 2D pan/zoom in the current canvas dimensions; without a usable saved viewport it fits the 2D graph. JSON and backups retain both placements and the camera.

CSV parsing and aggregation continue in workers over all matching source rows; the existing 600-object data-view limit remains. The 3D view additionally caps visible objects at 8,000 and relationships at 16,000 and announces truncation. Selected objects and selected relationship endpoints are prioritized. Node markers use shared instance buffers and relationships use shared line buffers. Text labels are bounded, with selection prioritized; rendering is requested on changes, with GPU resources and observers disposed when the view closes. Hidden objects, collapsed branches and filters follow the shared graph projection. Raw CSV rows are never converted to individual 3D objects.
