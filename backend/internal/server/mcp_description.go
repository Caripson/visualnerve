package server

import "strings"

var mcpToolDescription = strings.Join([]string{
	"Read or edit the open browser workspace using the Visual Nerve command contract.",
	"Paths omit /api/v1; see /api/docs.",
	"POST /sql/preview with {sql,name?} analyzes a SELECT/WITH query or DDL locally, returning graph/counts/warnings without saving; read-only access permits this exact endpoint.",
	"POST /sql/diagrams with the same payload saves and opens the resulting graph and requires write access.",
	"Query objects show scoped aliases, JOIN conditions, output expressions/lineage and clauses; they are logical structure, not an executed database query or physical query plan.",
	"No SQL connection or execution occurs.",
	"Query expressions can retain literal values.",
	"POST /spatial-diagrams with {name,type?} creates and opens a 3D graph, returning canonical objects and relationships.",
	"Nodes use metadata.spatial={version:1,position?:{x,y,z}}; diagram.settings.spatialView={version:1,mode:2d|3d,camera?}.",
	"Keep node x/y/width/height as an independent readable 2D layout for PNG/PDF.",
	"Create any subject as diagram nodes and relationships, such as a truck lifecycle mind map.",
	"Use versioned PATCH or bulk upsert for edits.",
	"Writes are committed in IndexedDB before responding.",
	"GET /code/languages lists 50 languages and their structural capabilities. POST /code/preview accepts {name?,files:[{path,content,language?}],mode?:files|symbols,focus?} and returns a local static dependency outline without saving; read-only access permits this exact endpoint.",
	"POST /code/diagrams accepts the same input, saves and opens its graph and requires write access. Relations carry syntax, heuristic or unresolved confidence plus source file/line evidence. Code is never executed. Original code, comments and string literal values are discarded after analysis; names and import/file paths are retained.",
	"Use file overview for larger projects and symbols for declarations and calls. Focus is a case-insensitive path/name substring and includes immediate related objects. These are structural heuristics, not complete compiler semantic analysis; dynamic dispatch, overloads, macros and unavailable dependencies may be unresolved.",
}, " ")
