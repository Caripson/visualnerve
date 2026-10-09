package main

const svgExportJobPolicy = "Read-only background SVG export in the connected browser's local Web Worker. It snapshots the canonical 2D diagram without opening or mutating the project; a 3D view exports its corresponding 2D layout. The same renderer powers UI and API exports. Jobs and results are transient RAM, not IndexedDB or server files. Every request requires accepted storage, an unlocked workspace and at least Read only MCP access. A job retains its original vault session and MCP grant; lock, grant change, cache clear or bridge stop invalidates it rather than rerouting it to another authority. Expired, evicted or cancelled jobs return 404; after reauthorization, an invalidated original job is unavailable. Authorization errors, including 423 while locked, take precedence. Status may report failed with error details; result retrieval requires succeeded and otherwise returns 409 SVG_JOB_NOT_READY."

const svgExportLegacyPolicy = "Synchronous SVG is limited to 100 graph nodes and 20,000 cumulative title, description and serialized metadata characters. Larger diagrams immediately return 409 SVG_BACKGROUND_REQUIRED; use POST /exports/svg, poll the job and concatenate GET /exports/svg/{jobId}/result chunks. Synchronous SVG also has a 16 MiB UTF-8 result ceiling and returns the same guidance if exceeded. JSON and Markdown export behavior is unchanged."

func svgExportIdentity() object { return object{"type": "string", "format": "uuid"} }

func svgExportConstant(value int, description string) object {
	return object{"type": "integer", "enum": []int{value}, "description": description}
}

func addSVGExportSchemas(schemas object) {
	schemas["SvgExportLimits"] = strictObject([]string{
		"sourceNodes", "sourceEdges", "nodes", "edges", "textCharacters", "bytes", "dimension", "active", "retained", "retainedBytes",
		"retentionMs", "deadlineMs", "synchronousNodes", "synchronousTextCharacters", "resultChunkCharacters",
	}, object{
		"sourceNodes":               svgExportConstant(100000, "Maximum source graph nodes before snapshotting, independent of export scope."),
		"sourceEdges":               svgExportConstant(500000, "Maximum source graph edges before snapshotting, independent of export scope."),
		"nodes":                     svgExportConstant(20000, "Maximum projected or scoped nodes rendered by one background job; a smaller selection from a larger source graph is allowed."),
		"edges":                     svgExportConstant(100000, "Maximum projected or scoped connections rendered by one background job."),
		"textCharacters":            svgExportConstant(5000000, "Maximum rendered text budget, in JavaScript UTF-16 code units."),
		"bytes":                     svgExportConstant(64*1024*1024, "Maximum complete SVG result size, in UTF-8 bytes."),
		"dimension":                 svgExportConstant(16777216, "Maximum absolute coordinate or canvas dimension supported by the vector renderer."),
		"active":                    svgExportConstant(2, "Maximum simultaneous queued or running jobs in this browser."),
		"retained":                  svgExportConstant(4, "Maximum retained terminal jobs; older jobs can be evicted."),
		"retainedBytes":             svgExportConstant(128*1024*1024, "Maximum retained SVG result bytes in this browser."),
		"retentionMs":               svgExportConstant(15*60*1000, "Job retention from creation, in milliseconds; expiry removes the job and result."),
		"deadlineMs":                svgExportConstant(120000, "Maximum worker execution deadline, in milliseconds."),
		"synchronousNodes":          svgExportConstant(100, "Maximum graph nodes before legacy POST /export SVG requires a background job."),
		"synchronousTextCharacters": svgExportConstant(20000, "Maximum title, description and serialized metadata characters before synchronous SVG requires a background job."),
		"resultChunkCharacters":     svgExportConstant(1024*1024, "Maximum result chunk length, in UTF-16 code units; Unicode surrogate pairs are never split."),
	})
	schemas["SvgExportCapabilities"] = strictObject([]string{
		"version", "format", "execution", "scopes", "limits", "resultOffsetUnit", "requiresOriginalSessionAndGrant", "persistence",
	}, object{
		"version":                         object{"type": "integer", "enum": []int{1}},
		"format":                          object{"type": "string", "enum": []string{"svg"}},
		"execution":                       object{"type": "string", "enum": []string{"local-web-worker"}},
		"scopes":                          object{"type": "array", "minItems": 3, "maxItems": 3, "uniqueItems": true, "items": object{"type": "string", "enum": []string{"complete", "viewport", "selected"}}},
		"limits":                          ref("SvgExportLimits"),
		"resultOffsetUnit":                object{"type": "string", "enum": []string{"utf-16-code-units"}},
		"requiresOriginalSessionAndGrant": object{"type": "boolean", "enum": []bool{true}},
		"persistence":                     object{"type": "string", "enum": []string{"transient-memory"}},
	})
	schemas["SvgExportCapabilities"].(object)["description"] = svgExportJobPolicy
	schemas["SvgExportJobInput"] = object{"description": svgExportJobPolicy + " Scope defaults to complete. Viewport uses the saved 2D viewport at the browser canvas size, or fits the diagram if no usable viewport is saved. Selected scope requires unique existing node UUIDs; nodeIds is rejected for every other scope, including an empty array. Unknown fields and query parameters are rejected. The renderer references fonts without embedding them and emits no external links, scripts, images or foreignObject.", "oneOf": []any{
		strictObject([]string{"diagramId"}, object{
			"diagramId": svgExportIdentity(), "scope": object{"type": "string", "enum": []string{"complete", "viewport"}, "default": "complete"},
		}),
		strictObject([]string{"diagramId", "scope", "nodeIds"}, object{
			"diagramId": svgExportIdentity(), "scope": object{"type": "string", "enum": []string{"selected"}},
			"nodeIds": object{"type": "array", "minItems": 1, "maxItems": 20000, "uniqueItems": true, "items": svgExportIdentity()},
		}),
	}}
	schemas["SvgJobFailure"] = strictObject([]string{"code", "message"}, object{
		"code": object{"type": "string", "description": "Semantic SVG error code, such as SVG_RENDER_FAILED, SVG_JOB_TIMEOUT or a renderer limit code."}, "message": object{"type": "string"},
	})
	schemas["SvgJobStatus"] = strictObject([]string{
		"jobId", "diagramId", "format", "state", "progress", "phase", "createdAt", "updatedAt", "nodeCount", "edgeCount",
	}, object{
		"jobId": svgExportIdentity(), "diagramId": svgExportIdentity(), "format": object{"type": "string", "enum": []string{"svg"}},
		"state":     object{"type": "string", "enum": []string{"queued", "running", "succeeded", "failed", "cancelled"}},
		"progress":  object{"type": "number", "minimum": 0, "maximum": 100, "description": "Actual worker progress; success assigns 100. Always inspect state: cancellation can discard a previously successful result and preserve its last progress value."},
		"phase":     object{"type": "string", "enum": []string{"queued", "projection", "layout", "edges", "nodes", "drawing", "complete"}},
		"createdAt": object{"type": "string", "format": "date-time"}, "updatedAt": object{"type": "string", "format": "date-time"},
		"nodeCount": object{"type": "integer", "minimum": 0, "maximum": 100000, "description": "Source graph node count while queued; successful result counts the rendered projected/scoped nodes, at most 20,000."},
		"edgeCount": object{"type": "integer", "minimum": 0, "maximum": 500000, "description": "Source graph connection count while queued; successful result counts the rendered projected/scoped connections, at most 100,000."},
		"bytes":     object{"type": "integer", "minimum": 0, "maximum": 64 * 1024 * 1024, "description": "Complete successful result size in UTF-8 bytes."},
		"error":     ref("SvgJobFailure"),
	})
	schemas["SvgJobStatus"].(object)["description"] = svgExportJobPolicy + " Poll by jobId. GET status returns 200 for retained failed jobs, with error.code and error.message. Cancellation returns one cancelled status and removes the job and any readable result; subsequent status/result requests return 404. Job IDs are canonical UUIDs, separate from opaque recoverable transport operation IDs."
	schemas["SvgJobResultChunk"] = strictObject([]string{"jobId", "offset", "nextOffset", "totalCharacters", "text", "complete"}, object{
		"jobId":           svgExportIdentity(),
		"offset":          object{"type": "integer", "minimum": 0, "maximum": 64 * 1024 * 1024, "description": "Requested starting UTF-16 code-unit offset."},
		"nextOffset":      object{"type": "integer", "minimum": 0, "maximum": 64 * 1024 * 1024, "description": "Use this exact offset for the next request; it may be less than offset + limit to preserve a Unicode character boundary."},
		"totalCharacters": object{"type": "integer", "minimum": 0, "maximum": 64 * 1024 * 1024, "description": "Complete result length in UTF-16 code units, not UTF-8 bytes or Unicode code points."},
		"text":            object{"type": "string", "maxLength": 1024 * 1024, "description": "Raw SVG text for this chunk. Concatenate text in offset order without JSON quoting or separators."},
		"complete":        object{"type": "boolean", "description": "True when nextOffset equals totalCharacters; no further chunk is needed."},
	})
	schemas["SvgJobResultChunk"].(object)["description"] = svgExportJobPolicy + " Retrieve only after state=succeeded. Offsets and limit use UTF-16 code units. Offsets inside a surrogate pair or beyond the result return 422; a limit too small to include the next Unicode character also returns 422. Follow nextOffset and concatenate text until complete=true. The result stays local and is not embedded in status responses."
	schemas["SvgExportEmptyInput"] = strictObject(nil, object{})
	schemas["SvgExportEmptyInput"].(object)["description"] = "No body or exactly {}. No model mutation or credential input."
}

func addSVGExportPaths(add func(string, string, string, string, string, string), paths object, schemas object) {
	add("GET", "/exports/capabilities", "Discover read-only background SVG export scopes and browser-local limits", "", "SvgExportCapabilities", "200")
	add("POST", "/exports/svg", "Start a read-only native SVG export in a local Web Worker", "SvgExportJobInput", "SvgJobStatus", "201")
	add("GET", "/exports/svg/{jobId}", "Inspect retained SVG job progress and terminal status", "", "SvgJobStatus", "200")
	add("DELETE", "/exports/svg/{jobId}", "Cancel and discard this SVG job without changing the diagram", "SvgExportEmptyInput", "SvgJobStatus", "200")
	add("GET", "/exports/svg/{jobId}/result", "Retrieve a bounded SVG text chunk from a successful job", "", "SvgJobResultChunk", "200")
	for _, path := range []string{"/exports/capabilities", "/exports/svg", "/exports/svg/{jobId}", "/exports/svg/{jobId}/result"} {
		for _, raw := range paths[path].(object) {
			raw.(object)["description"] = svgExportJobPolicy
		}
	}
	start := paths["/exports/svg"].(object)["post"].(object)
	start["description"] = svgExportJobPolicy + " Returns 201 promptly with a queued/running job status, not the complete SVG. At most two jobs can run concurrently; an exhausted job slot returns 429 SVG_JOB_BUSY. Graph/text/result ceilings are discoverable through GET /exports/capabilities. Invalid scopes, IDs, selections and unknown fields return 422."
	start["responses"].(object)["429"] = object{"description": "Browser SVG worker job limit reached (SVG_JOB_BUSY)", "content": object{"application/json": object{"schema": ref("Error")}}}
	cancel := paths["/exports/svg/{jobId}"].(object)["delete"].(object)
	cancel["requestBody"].(object)["required"] = false
	cancel["description"] = svgExportJobPolicy + " This exact DELETE endpoint is permitted in Read only access. Returns a final cancelled status once, then releases the worker, result and original authority. Subsequent requests return 404. No body or exactly {} is accepted."
	result := paths["/exports/svg/{jobId}/result"].(object)["get"].(object)
	result["description"] = schemas["SvgJobResultChunk"].(object)["description"]
	parameters := result["parameters"].([]any)
	result["parameters"] = append(parameters,
		object{"name": "offset", "in": "query", "required": false, "schema": object{"type": "integer", "minimum": 0, "maximum": 64 * 1024 * 1024, "default": 0}, "description": "UTF-16 code-unit offset at a Unicode character boundary; repeat parameters and unknown query keys are rejected."},
		object{"name": "limit", "in": "query", "required": false, "schema": object{"type": "integer", "minimum": 1, "maximum": 1024 * 1024, "default": 1024 * 1024}, "description": "Maximum UTF-16 code units to return; chunks never split a surrogate pair."},
	)
	legacy := schemas["Export"].(object)
	legacy["description"] = legacy["description"].(string) + " " + svgExportLegacyPolicy
	paths["/export"].(object)["post"].(object)["description"] = svgExportLegacyPolicy
}
