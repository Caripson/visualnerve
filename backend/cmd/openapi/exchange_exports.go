package main

const diagramExportPolicy = "Read-only editable diagram exchange in the connected browser's local Web Worker. POST /exports/diagrams snapshots saved logical nodes, internal connections and canonical 2D geometry into drawio XML without opening or changing the diagram. A 3D view exports the saved 2D layout. Editable draw.io drawings deliberately use a light drawing surface regardless of app Appearance: white base fills, dark text/connection labels/base borders, and preserved stored node/connection/mind-map color accents. Native JSON preserves full stored styling; workspace backups also retain portable appearance settings. SVG appearance is unchanged and no additional API argument is needed. Complete scope includes stored logical nodes, including nodes hidden in a temporary CSV or overview view; selected scope contains only explicit node UUIDs and internal edges. Visible labels may contain titles, descriptions, owner/status labels and simple process assumptions. Raw datasets, source files, arbitrary metadata, simulation execution/results, live capacity copies, presentation audio and vault data are not included. This is an editable drawing, not a full-fidelity native backup. Review warnings before sharing. Every request needs accepted storage, an unlocked workspace and at least Read only MCP access. Jobs retain their original vault session and MCP grant. Lock, explicit grant changes, cache clearing, stop or reload invalidate them. Jobs/results are transient local RAM, not IndexedDB or bridge files. Invalidated, evicted, expired or cancelled jobs return 404 after current authorization; locked requests return 423 first. Result retrieval before success returns 409."

func addDiagramExportSchemas(schemas object) {
	schemas["DiagramExportWarning"] = strictObject([]string{"code", "message"}, object{
		"code": object{"type": "string"}, "message": object{"type": "string"},
	})
	schemas["DiagramExportLimits"] = strictObject([]string{
		"sourceNodes", "sourceEdges", "nodes", "edges", "textCharacters", "bytes", "dimension",
		"active", "retained", "retainedBytes", "retentionMs", "deadlineMs", "resultChunkBytes",
	}, object{
		"sourceNodes":      svgExportConstant(100000, "Maximum source graph nodes before snapshotting, independent of scope."),
		"sourceEdges":      svgExportConstant(500000, "Maximum source graph connections before snapshotting, independent of scope."),
		"nodes":            svgExportConstant(20000, "Maximum scoped logical nodes serialized; selected scope can reduce this scene."),
		"edges":            svgExportConstant(100000, "Maximum internal scoped connections serialized."),
		"textCharacters":   svgExportConstant(5000000, "Maximum deliberately exported text budget in UTF-16 code units."),
		"bytes":            svgExportConstant(64*1024*1024, "Maximum complete output file size in bytes."),
		"dimension":        svgExportConstant(16777216, "Maximum absolute coordinate or document dimension."),
		"active":           svgExportConstant(2, "Maximum concurrent queued/running diagram exchange jobs in this browser."),
		"retained":         svgExportConstant(4, "Maximum retained terminal diagram exchange jobs."),
		"retainedBytes":    svgExportConstant(128*1024*1024, "Maximum retained editable diagram result bytes in this browser."),
		"retentionMs":      svgExportConstant(900000, "Retention from creation in milliseconds; expiry removes status and result."),
		"deadlineMs":       svgExportConstant(120000, "Maximum worker execution deadline in milliseconds."),
		"resultChunkBytes": svgExportConstant(786432, "Maximum raw binary bytes per result chunk, encoded into at most 1,048,576 standard base64 characters."),
	})
	schemas["DiagramExportCapabilities"] = strictObject([]string{
		"version", "execution", "scopes", "formats", "limits", "resultOffsetUnit", "resultEncoding",
		"requiresOriginalSessionAndGrant", "persistence",
	}, object{
		"version":   object{"type": "integer", "enum": []int{1}},
		"execution": object{"type": "string", "enum": []string{"local-web-worker"}},
		"scopes":    object{"type": "array", "minItems": 2, "maxItems": 2, "uniqueItems": true, "items": object{"type": "string", "enum": []string{"complete", "selected"}}},
		"formats": strictObject([]string{"drawio"}, object{
			"drawio": strictObject([]string{"editable", "validation"}, object{
				"editable":   object{"type": "boolean", "enum": []bool{true}},
				"validation": object{"type": "string", "enum": []string{"format-and-drawio"}},
			}),
		}),
		"limits":                          ref("DiagramExportLimits"),
		"resultOffsetUnit":                object{"type": "string", "enum": []string{"bytes"}},
		"resultEncoding":                  object{"type": "string", "enum": []string{"base64"}},
		"requiresOriginalSessionAndGrant": object{"type": "boolean", "enum": []bool{true}},
		"persistence":                     object{"type": "string", "enum": []string{"transient-memory"}},
	})
	schemas["DiagramExportCapabilities"].(object)["description"] = diagramExportPolicy
	// Retain the existing top-level SVG capability fields and schema reference.
	capabilities := schemas["SvgExportCapabilities"].(object)
	capabilities["properties"].(object)["diagrams"] = ref("DiagramExportCapabilities")
	capabilities["required"] = append(capabilities["required"].([]string), "diagrams")
	capabilities["description"] = svgExportJobPolicy + " The additive diagrams field discovers separate editable diagram exchange capabilities. " + diagramExportPolicy
	schemas["DiagramExportJobInput"] = object{"description": diagramExportPolicy + " Format is required. Scope defaults to complete. Selected requires 1..20,000 unique existing canonical node UUIDs; nodeIds is forbidden outside selected, including []. Unknown fields and query parameters are rejected.", "oneOf": []any{
		strictObject([]string{"diagramId", "format"}, object{
			"diagramId": svgExportIdentity(), "format": object{"type": "string", "enum": []string{"drawio"}},
			"scope": object{"type": "string", "enum": []string{"complete"}, "default": "complete"},
		}),
		strictObject([]string{"diagramId", "format", "scope", "nodeIds"}, object{
			"diagramId": svgExportIdentity(), "format": object{"type": "string", "enum": []string{"drawio"}},
			"scope":   object{"type": "string", "enum": []string{"selected"}},
			"nodeIds": object{"type": "array", "minItems": 1, "maxItems": 20000, "uniqueItems": true, "items": svgExportIdentity()},
		}),
	}}
	schemas["DiagramExportFailure"] = strictObject([]string{"code", "message"}, object{
		"code": object{"type": "string"}, "message": object{"type": "string"},
	})
	schemas["DiagramExportJobStatus"] = strictObject([]string{
		"jobId", "diagramId", "format", "state", "progress", "phase", "createdAt", "updatedAt", "nodeCount", "edgeCount", "warnings",
	}, object{
		"jobId": svgExportIdentity(), "diagramId": svgExportIdentity(),
		"format":    object{"type": "string", "enum": []string{"drawio"}},
		"state":     object{"type": "string", "enum": []string{"queued", "running", "succeeded", "failed", "cancelled"}},
		"progress":  object{"type": "number", "minimum": 0, "maximum": 100},
		"phase":     object{"type": "string", "enum": []string{"queued", "projection", "nodes", "edges", "packaging", "complete"}},
		"createdAt": object{"type": "string", "format": "date-time"}, "updatedAt": object{"type": "string", "format": "date-time"},
		"nodeCount": object{"type": "integer", "minimum": 0, "maximum": 100000, "description": "Source count while queued, scoped exported count after success (at most 20,000)."},
		"edgeCount": object{"type": "integer", "minimum": 0, "maximum": 500000, "description": "Source count while queued, internal exported count after success (at most 100,000)."},
		"bytes":     object{"type": "integer", "minimum": 0, "maximum": 64 * 1024 * 1024},
		"warnings":  object{"type": "array", "items": ref("DiagramExportWarning")},
		"error":     ref("DiagramExportFailure"),
	})
	schemas["DiagramExportJobStatus"].(object)["description"] = diagramExportPolicy + " Status includes real progress and warnings but never complete file content or authority secrets. Failed jobs return status 200 with structured error. Cancellation returns a final cancelled status once and removes the result; later requests return 404."
	schemas["DiagramExportResultChunk"] = strictObject([]string{
		"jobId", "format", "mimeType", "encoding", "offset", "nextOffset", "totalBytes", "data", "complete", "warnings",
	}, object{
		"jobId": svgExportIdentity(), "format": object{"type": "string", "enum": []string{"drawio"}},
		"mimeType":   object{"type": "string", "description": "MIME type of the complete editable document."},
		"encoding":   object{"type": "string", "enum": []string{"base64"}},
		"offset":     object{"type": "integer", "minimum": 0, "maximum": 64 * 1024 * 1024},
		"nextOffset": object{"type": "integer", "minimum": 0, "maximum": 64 * 1024 * 1024},
		"totalBytes": object{"type": "integer", "minimum": 0, "maximum": 64 * 1024 * 1024},
		"data":       object{"type": "string", "format": "byte", "maxLength": 1048576, "description": "Standard padded base64 for this binary chunk only. Decode every chunk separately, then concatenate decoded bytes. Do not concatenate base64 strings."},
		"complete":   object{"type": "boolean", "description": "True when nextOffset equals totalBytes."},
		"warnings":   object{"type": "array", "items": ref("DiagramExportWarning")},
	})
	schemas["DiagramExportResultChunk"].(object)["description"] = diagramExportPolicy + " Offsets/limit use raw bytes, not UTF-16 or base64 characters. Retrieve only after success. Follow nextOffset and decode each data chunk separately before concatenating binary bytes; padding can occur in any chunk. Offsets beyond totalBytes return 422. Exported text remains readable information even when source IndexedDB is encrypted."
}

func addDiagramExportPaths(add func(string, string, string, string, string, string), paths object) {
	add("POST", "/exports/diagrams", "Start an editable drawio export in a local worker", "DiagramExportJobInput", "DiagramExportJobStatus", "201")
	add("GET", "/exports/diagrams/{jobId}", "Inspect editable diagram export progress and warnings", "", "DiagramExportJobStatus", "200")
	add("DELETE", "/exports/diagrams/{jobId}", "Cancel and discard an editable diagram export job", "SvgExportEmptyInput", "DiagramExportJobStatus", "200")
	add("GET", "/exports/diagrams/{jobId}/result", "Retrieve one bounded base64 binary chunk from an editable diagram export", "", "DiagramExportResultChunk", "200")
	for _, path := range []string{"/exports/diagrams", "/exports/diagrams/{jobId}", "/exports/diagrams/{jobId}/result"} {
		for _, raw := range paths[path].(object) {
			raw.(object)["description"] = diagramExportPolicy
		}
	}
	start := paths["/exports/diagrams"].(object)["post"].(object)
	start["description"] = diagramExportPolicy + " Returns 201 promptly with a job status, never file bytes. Two exchange jobs may run concurrently; exhaustion returns 429. Unknown fields, invalid IDs, unsupported formats/scopes and invalid selected IDs return 422."
	start["responses"].(object)["429"] = object{"description": "Browser editable diagram worker job limit reached", "content": object{"application/json": object{"schema": ref("Error")}}}
	cancel := paths["/exports/diagrams/{jobId}"].(object)["delete"].(object)
	cancel["requestBody"].(object)["required"] = false
	cancel["description"] = diagramExportPolicy + " This exact DELETE permits Read only access, without general permission to delete diagrams. No arguments or exactly {}. Returns cancelled status once, then removes status and file; subsequent requests return 404."
	result := paths["/exports/diagrams/{jobId}/result"].(object)["get"].(object)
	result["description"] = diagramExportPolicy + " Only offset and limit query parameters are supported; repeated/noninteger/unsafe values return 422. Limit defaults to 786,432 raw bytes and may be 1..786,432. Decode each base64 data chunk separately and concatenate binary bytes in offset order until complete=true. Retain returned format, mimeType and warnings."
	result["parameters"] = append(result["parameters"].([]any),
		object{"name": "offset", "in": "query", "required": false, "schema": object{"type": "integer", "minimum": 0, "maximum": 64 * 1024 * 1024, "default": 0}},
		object{"name": "limit", "in": "query", "required": false, "schema": object{"type": "integer", "minimum": 1, "maximum": 786432, "default": 786432}},
	)
	capabilities := paths["/exports/capabilities"].(object)["get"].(object)
	capabilities["summary"] = "Discover existing SVG and additive editable diagram export capabilities"
	capabilities["description"] = svgExportJobPolicy + " Existing SVG fields are preserved; diagrams adds the editable drawio format, scope, binary chunk units, independent limits and validation metadata. " + diagramExportPolicy
}
