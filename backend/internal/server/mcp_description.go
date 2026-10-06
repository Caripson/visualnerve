package server

import "strings"

const mcpImportPolicy = "Local imports use the connected browser's saved import-file-limit-mb setting: default 50 MiB, integer 50..1024 MiB (1 GiB). UI MB means MiB and UI 1 GB means 1024 MiB. GET /settings/import-file-limit-mb returns the effective integer limit, defaulting to 50 for an absent or invalid saved value; Read only is allowed. Settings or PUT /settings/import-file-limit-mb with {value:number} changes this browser-local limit; writes require Read + write and invalid values return 422. The setting is excluded from backups and ignored during restore. Only imports up to 50 MB are supported and guaranteed; larger imports are experimental and may be slow or fail because of browser memory or format limits. Code applies the selected limit both per file and to the total project (50 MiB each by default). Other count, structure and analysis deadline limits still apply. JSON and WebSocket transport envelopes remain 32 MiB and are not increased by Settings."

var mcpInstructions = strings.Join([]string{
	"Visual Nerve supports native 2D diagrams and 3D views of the same graph objects and relationships.",
	"Use visual_nerve_api_docs first for the compact bundled API guide; request document=openapi or document=all when the full OpenAPI contract is needed. Discovery runs directly through MCP with no browser session or external documentation link.",
	"The same documents are resources visual-nerve://docs/guide and visual-nerve://docs/openapi.",
	"Use 2D unless the user requests 3D. For a requested 3D diagram, use visual_nerve_request with POST /spatial-diagrams and {name,type?}, then add or edit graph nodes and edges using the documented commands.",
	"Keep each node's x/y/width/height as an independent readable 2D layout for PNG/PDF; spatial coordinates live in metadata.spatial.",
	"Workspace commands require an open Visual Nerve browser, explicit storage acceptance, and MCP access enabled in Settings. IndexedDB in that browser is authoritative and is the only database.",
	"Read only permits GET, POST /export, and exact POST /sql/preview, /code/preview or /diagram-files/preview; mutations require Read + write. No application records are stored on this server.",
	"Import draw.io XML or base64 Visio .vsdx ZIP through POST /diagram-files/preview, review pages/warnings, then POST /import with the selected pageId to save a native editable diagram. Multipage imports require a page selection; .vsd and .vsdm are unsupported.",
	mcpImportPolicy,
	"visual_nerve_request paths are browser commands without /api/v1; do not use it to fetch /api/docs or /api/openapi.yaml.",
}, " ")

var mcpToolDescription = strings.Join([]string{
	"Read or edit native 2D diagrams and 3D views of the same graph in the open browser workspace using the Visual Nerve command contract.",
	"First call visual_nerve_api_docs for the compact guide, including 2D/3D workflows; use document=openapi or document=all when the full OpenAPI is needed. Paths omit /api/v1. Documentation paths /api/docs and /api/openapi.yaml are not browser commands.",
	"Use 2D unless the user requests 3D. IndexedDB in the connected browser is the only database; this server stores no workspace records. Workspace commands require storage acceptance and MCP access enabled in Settings.",
	"POST /sql/preview with {sql,name?} analyzes a SELECT/WITH query or DDL locally, returning graph/counts/warnings without saving; read-only access permits this exact endpoint.",
	"POST /sql/diagrams with the same payload saves and opens the resulting graph and requires write access.",
	"Query objects show scoped aliases, JOIN conditions, output expressions/lineage and clauses; they are logical structure, not an executed database query or physical query plan.",
	"No SQL connection or execution occurs.",
	"Query expressions can retain literal values.",
	"When the user requests 3D, POST /spatial-diagrams with {name,type?} creates and opens a 3D graph, returning the canonical graph; then populate nodes and edges with the standard graph commands.",
	"Nodes use metadata.spatial={version:1,position?:{x,y,z}}; diagram.settings.spatialView={version:1,mode:2d|3d,camera?}.",
	"Keep node x/y/width/height as an independent readable 2D layout for PNG/PDF.",
	"Create any subject as diagram nodes and relationships, such as a truck lifecycle mind map.",
	"Use versioned PATCH or bulk upsert for edits.",
	"Writes are committed in IndexedDB before responding.",
	"GET /code/languages lists 50 languages and their structural capabilities. POST /code/preview accepts {name?,files:[{path,content,language?}],mode?:files|symbols,focus?} and returns a local static dependency outline without saving; read-only access permits this exact endpoint.",
	"POST /code/diagrams accepts the same input, saves and opens its graph and requires write access. Relations carry syntax, heuristic or unresolved confidence plus source file/line evidence. Code is never executed. Original code, comments and string literal values are discarded after analysis; names and import/file paths are retained.",
	"Use file overview for larger projects and symbols for declarations and calls. Focus is a case-insensitive path/name substring and includes immediate related objects. These are structural heuristics, not complete compiler semantic analysis; dynamic dispatch, overloads, macros and unavailable dependencies may be unresolved.",
	"POST /diagram-files/preview accepts {format:drawio|vsdx,data:string,name?} and returns {format,pages:[{id,name,graph,warnings}],warnings} without saving or opening a project; this exact endpoint permits Read only. Draw.io data is XML text and Visio .vsdx data is strict padded standard base64 ZIP bytes. POST /import with the same payload plus pageId? saves and opens only the selected native page and requires write access. Multipage input requires pageId from preview; missing/unknown selection returns 422 without partial writes.",
	"Diagram file import approximates native shapes, text, geometry, groups, connections and safe HTTP(S) links; advanced shapes, rotations and connector waypoints may be simplified with warnings. Original XML/ZIP and unselected pages are temporary. Images, macros, scripts and external content are never fetched or executed. Legacy .vsd and macro-enabled .vsdm are unsupported. Input uses the selected local import limit; expanded data is capped at min(1 GiB,max(100 MiB,2*selected file limit)), default 100 MiB. Other limits: 2,048 ZIP entries, 100 pages, 20,000 total objects, 40,000 total relationships, hierarchy depth 256 and 30-second worker deadline. JSON transport remains 32 MiB, so base64 integration files must be below roughly 24 MiB. Access revocation cancels analysis; consent/grants are rechecked before saving.",
	mcpImportPolicy,
}, " ")
