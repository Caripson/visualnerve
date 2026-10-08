package main

func addQuestionSchemas(schemas object) {
	confidence := object{"type": "string", "enum": []string{"explicit", "syntax", "heuristic", "unresolved"}}
	schemas["DiagramQuestion"] = strictObject([]string{"startId", "kind"}, object{
		"startId": object{"type": "string", "format": "uuid"}, "kind": object{"type": "string", "enum": []string{"downstream", "upstream", "path"}}, "targetId": object{"type": "string", "format": "uuid", "description": "Required only for path; prohibited for other kinds."},
		"maxDepth": object{"type": "integer", "minimum": 1, "maximum": 64, "default": 16}, "edgeTypes": object{"type": "array", "maxItems": 100, "uniqueItems": true, "items": object{"type": "string", "minLength": 1, "maxLength": 200}},
		"includeHidden": object{"type": "boolean", "default": false}, "includeUncertain": object{"type": "boolean", "default": true}, "offset": object{"type": "integer", "minimum": 0, "maximum": 50000, "default": 0}, "limit": object{"type": "integer", "minimum": 1, "maximum": 100, "default": 25},
	})
	schemas["DiagramQuestion"].(object)["description"] = "Breadth-first directed modeled paths, maximum 50,000 nodes and 200,000 edges. Handles cycles, reverse arrows, types, depth and uncertain links. None-direction associations are excluded. Paged answers do not limit traversal. A path is one shortest observed path, not all possible paths or proof of runtime impact."
	schemas["RelationshipEvidence"] = strictObject([]string{"edgeId", "kind", "confidence", "source", "description", "sourceNodeId", "targetNodeId", "direction"}, object{
		"edgeId": object{"type": "string", "description": "Canonical UUID or synthetic hierarchy:<nodeUUID>."}, "kind": object{"type": "string"}, "confidence": confidence,
		"source": object{"type": "string", "enum": []string{"diagram", "code", "sql", "csv", "hierarchy"}}, "description": object{"type": "string", "maxLength": 2000}, "shortened": object{"type": "boolean"},
		"path": object{"type": "string"}, "line": object{"type": "integer", "minimum": 1}, "sourceNodeId": object{"type": "string", "format": "uuid"}, "targetNodeId": object{"type": "string", "format": "uuid"}, "direction": object{"type": "string", "enum": []string{"forward", "backward", "both", "none"}},
	})
	schemas["QuestionAnswer"] = strictObject([]string{"nodeId", "title", "distance", "confidence", "nodeIds", "edgeIds"}, object{
		"nodeId": object{"type": "string", "format": "uuid"}, "title": object{"type": "string"}, "distance": object{"type": "integer", "minimum": 0, "maximum": 64}, "confidence": confidence, "nodeIds": uuidList(65), "edgeIds": stringList(),
	})
	schemas["DiagramQuestionResult"] = strictObject([]string{"diagramId", "graphVersion", "question", "summary", "answers", "evidence", "total", "offset", "limit", "hasMore", "found", "depthLimited", "warnings"}, object{
		"diagramId": object{"type": "string", "format": "uuid"}, "graphVersion": object{"type": "integer"}, "question": ref("DiagramQuestion"), "summary": object{"type": "string"},
		"answers": object{"type": "array", "maxItems": 100, "items": ref("QuestionAnswer")}, "evidence": object{"type": "array", "items": ref("RelationshipEvidence")}, "total": object{"type": "integer", "minimum": 0},
		"offset": object{"type": "integer", "minimum": 0}, "limit": object{"type": "integer"}, "hasMore": object{"type": "boolean"}, "found": object{"type": "boolean"}, "depthLimited": object{"type": "boolean"}, "warnings": stringList(),
	})
	schemas["SourceEvidence"] = object{"type": "object", "additionalProperties": true, "required": []string{"diagramId", "graphVersion", "nodeId", "warnings"}, "description": "Code declarations carry retained source path/line; project directories expose their recognized path/count/languages and code analysis scan provenance; SQL carries retained schema or logical expressions. CSV metadata identifies source/path/measures. Supplying metricId returns explanation with up to 100 original/cleaned rows, original data-row numbers and contributing/excluded/duplicate dispositions. No code or SQL is executed; original code/SQL scripts are not retained. Evidence explicitly requested over MCP can include sensitive original cells.", "properties": object{
		"diagramId": object{"type": "string", "format": "uuid"}, "graphVersion": object{"type": "integer"}, "nodeId": object{"type": "string", "format": "uuid"}, "warnings": stringList(), "code": ref("CodeObject"), "projectDirectory": ref("ProjectDirectory"), "codeAnalysis": ref("CodeAnalysis"), "sqlSource": ref("SqlQuerySource"), "sqlResult": ref("SqlQueryResult"), "datasetId": object{"type": "string", "format": "uuid"}, "columns": object{"type": "array", "items": object{"type": "object"}}, "explanation": object{"type": "object", "additionalProperties": true},
	}}
}
