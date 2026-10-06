package main

func strictObject(required []string, properties object) object {
	result := object{"type": "object", "additionalProperties": false, "properties": properties}
	if len(required) > 0 {
		result["required"] = required
	}
	return result
}
func versionedInput(field, definition string) object {
	return strictObject([]string{"baseVersion", field}, object{"baseVersion": object{"type": "integer", "minimum": 1}, field: ref(definition)})
}
func uuidList(max int) object {
	return object{"type": "array", "maxItems": max, "uniqueItems": true, "items": object{"type": "string", "format": "uuid"}}
}
func stringList() object { return object{"type": "array", "items": object{"type": "string"}} }
func addUnderstandingSchemas(schemas object) {
	schemas["OverviewConfig"] = strictObject([]string{"version", "enabled", "grouping", "expanded"}, object{
		"version": object{"type": "integer", "enum": []int{1}}, "enabled": object{"type": "boolean"},
		"grouping": object{"type": "string", "enum": []string{"auto", "groups", "tags", "source"}},
		"expanded": object{"type": "array", "maxItems": 2000, "uniqueItems": true, "items": object{"type": "string", "pattern": "^overview-group:[a-f0-9]{16}$"}},
	})
	schemas["OverviewUpdate"] = versionedInput("overview", "OverviewConfig")
	schemas["OverviewGroup"] = strictObject([]string{"id", "label", "reason", "depth", "nodeIds", "childGroupIds", "statusCounts", "nodeTypeCounts", "matchingNodeCount", "internalEdgeCount", "expanded"}, object{
		"id": object{"type": "string"}, "label": object{"type": "string"}, "reason": object{"type": "string", "enum": []string{"hierarchy", "tag", "source", "kind", "area", "partition"}},
		"parentId": object{"type": "string"}, "depth": object{"type": "integer"}, "nodeIds": uuidList(50000), "childGroupIds": stringList(),
		"statusCounts": object{"type": "object", "additionalProperties": object{"type": "integer"}}, "nodeTypeCounts": object{"type": "object", "additionalProperties": object{"type": "integer"}},
		"matchingNodeCount": object{"type": "integer"}, "internalEdgeCount": object{"type": "integer"}, "expanded": object{"type": "boolean"},
	})
	schemas["OverviewRelationship"] = strictObject([]string{"id", "source", "target", "edgeType", "direction", "style", "edgeIds", "labels", "internal"}, object{
		"id": object{"type": "string"}, "source": object{"type": "string"}, "target": object{"type": "string"}, "edgeType": object{"type": "string"},
		"direction": object{"type": "string", "enum": []string{"forward", "backward", "both", "none"}}, "style": object{"type": "string", "enum": []string{"solid", "dashed", "dotted"}},
		"edgeIds": stringList(), "labels": stringList(), "internal": object{"type": "boolean"},
	})
	schemas["OverviewProjection"] = strictObject([]string{"active", "nodes", "edges", "groups", "relationships", "nodeMap", "edgeMap", "counts", "bounded", "zoomLevel"}, object{
		"active": object{"type": "boolean"}, "nodes": object{"type": "array", "items": object{"type": "object", "additionalProperties": true}}, "edges": object{"type": "array", "items": object{"type": "object", "additionalProperties": true}},
		"groups": object{"type": "array", "items": ref("OverviewGroup")}, "relationships": object{"type": "array", "items": ref("OverviewRelationship")},
		"nodeMap": object{"type": "object", "additionalProperties": object{"type": "string"}}, "edgeMap": object{"type": "object", "additionalProperties": object{"type": "string"}},
		"counts": object{"type": "object", "additionalProperties": object{"type": "integer"}}, "bounded": object{"type": "boolean"}, "zoomLevel": object{"type": "integer", "minimum": 0, "maximum": 3},
	})
	schemas["OverviewProjection"].(object)["description"] = "View-only stable summary cards, original-ID mappings and typed directed relationship rollups. Proxy IDs are not canonical graph UUIDs and cannot be edited as ordinary nodes/edges. Current render budget is 2,000 cards; every input object remains mapped. Legal zoom is (0,10], default 0.1; detail levels change at 0.2, 0.55 and 1.2."
	addQuestionSchemas(schemas)
	addHistorySchemas(schemas)
	addBuildSchemas(schemas)
	addStoryboardSchemas(schemas)
}
func addUnderstandingPaths(add func(string, string, string, string, string, string), paths object) {
	add("GET", "/diagrams/{diagramId}/overview", "Read semantic overview configuration; read-only allowed", "", "OverviewConfig", "200")
	add("PUT", "/diagrams/{diagramId}/overview", "Update view-only semantic grouping at baseVersion; canonical objects stay intact", "OverviewUpdate", "Graph", "200")
	add("GET", "/diagrams/{diagramId}/overview/projection", "Read stable groups and aggregated relations at a chosen zoom", "", "OverviewProjection", "200")
	addQuery(paths, "/diagrams/{diagramId}/overview/projection", "zoom", object{"type": "number", "minimum": 0, "exclusiveMinimum": true, "maximum": 10, "default": 0.1}, false)
	add("POST", "/diagrams/{diagramId}/questions", "Read-only multi-level modeled relationship question with paged source evidence; never executes code or SQL", "DiagramQuestion", "DiagramQuestionResult", "200")
	add("GET", "/diagrams/{diagramId}/evidence", "Read object source metadata or an explicitly requested CSV measure page including original cells", "", "SourceEvidence", "200")
	addQuery(paths, "/diagrams/{diagramId}/evidence", "nodeId", object{"type": "string", "format": "uuid"}, true)
	addQuery(paths, "/diagrams/{diagramId}/evidence", "metricId", object{"type": "string"}, false)
	addQuery(paths, "/diagrams/{diagramId}/evidence", "offset", object{"type": "integer", "minimum": 0, "default": 0}, false)
	addQuery(paths, "/diagrams/{diagramId}/evidence", "disposition", object{"type": "string", "enum": []string{"all", "included", "excluded"}, "default": "all"}, false)
	add("GET", "/diagrams/{diagramId}/history", "List named local versions and pre-refresh/pre-restore checkpoints", "", "HistorySnapshot[]", "200")
	add("POST", "/diagrams/{diagramId}/history", "Save a named local snapshot at current baseVersion; bounded storage and write access required", "HistoryCreate", "HistorySnapshot", "200")
	add("GET", "/diagrams/{diagramId}/history/{snapshotId}", "Read archived graph and shared source version", "", "HistoryRead", "200")
	add("DELETE", "/diagrams/{diagramId}/history/{snapshotId}", "Remove a snapshot and unreferenced archives; current diagram unchanged", "", "", "204")
	add("GET", "/diagrams/{diagramId}/history/{snapshotId}/compare", "Compare semantic changes and modeled affected dependencies with current or another snapshot", "", "HistoryComparison", "200")
	addQuery(paths, "/diagrams/{diagramId}/history/{snapshotId}/compare", "to", object{"type": "string", "default": "current", "description": "current or a snapshot UUID in this diagram"}, false)
	add("POST", "/diagrams/{diagramId}/history/{snapshotId}/restore", "Restore at baseVersion with an atomic safety snapshot; preserve IDs and current shared owner profiles", "HistoryRestore", "HistoryRestoreResult", "200")
	add("GET", "/diagrams/{diagramId}/build-specification", "Read reviewed app requirements and decision answers", "", "BuildSpecificationDraft", "200")
	add("PUT", "/diagrams/{diagramId}/build-specification", "Save reviewed app requirements at baseVersion", "BuildSpecificationUpdate", "Graph", "200")
	add("POST", "/diagrams/{diagramId}/build-brief", "Read-only complete Lovable brief and generated app specification; does not send or publish", "BuildBriefInput", "BuildBrief", "200")
	add("GET", "/diagrams/{diagramId}/storyboard", "Read saved multi-object scenes or an empty storyboard", "", "StoryboardDefinition", "200")
	add("PUT", "/diagrams/{diagramId}/storyboard", "Save scene content, authored narration and camera views at baseVersion", "StoryboardUpdate", "Graph", "200")
	add("POST", "/presentation/seek", "Preview a scene or numbered step paused; write access required", "PresentationSeek", "PresentationRuntime", "200")
}
func addQuery(paths object, path, name string, definition object, required bool) {
	op := paths[path].(object)["get"].(object)
	parameters, _ := op["parameters"].([]any)
	op["parameters"] = append(parameters, object{"name": name, "in": "query", "required": required, "schema": definition})
}
