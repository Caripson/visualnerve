package main

func addBuildSchemas(schemas object) {
	sections := object{}
	for _, key := range []string{"dataModel", "screens", "businessRules", "apiContract", "acceptanceCriteria", "decisions"} {
		sections[key] = object{"type": "string", "maxLength": 30000}
	}
	schemas["BuildSpecificationDraft"] = strictObject([]string{"version", "sections", "answers"}, object{"version": object{"type": "integer", "enum": []int{1}}, "sections": strictObject(nil, sections), "answers": object{"type": "object", "maxProperties": 200, "additionalProperties": object{"type": "string", "maxLength": 30000}}})
	schemas["BuildSpecificationDraft"].(object)["description"] = "User-reviewed additions to six generated app specification sections and explicit answers keyed by decision ID. Draft text is limited to 180,000 characters combined; unknown fields and reserved prototype answer keys are rejected. Canonical source facts remain included."
	schemas["BuildSpecificationUpdate"] = versionedInput("specification", "BuildSpecificationDraft")
	schemas["BuildBriefInput"] = strictObject(nil, object{"scope": object{"type": "string", "enum": []string{"diagram", "selected", "csv-view"}, "default": "diagram"}, "selectedIds": uuidList(20000), "instructions": object{"type": "string", "maxLength": 30000}})
	schemas["BuildBriefInput"].(object)["description"] = "Selected scope requires at least one existing selected object. Entire diagram includes collapsed/offscreen objects; csv-view excludes retained generated groups outside the current data view. Original source rows/code/scripts and arbitrary metadata are excluded. This previews locally and does not send to Lovable."
	schemas["BuildDecision"] = strictObject([]string{"id", "question", "nodeIds"}, object{"id": object{"type": "string"}, "question": object{"type": "string"}, "nodeIds": uuidList(20000), "answer": object{"type": "string"}})
	generated := object{}
	for key := range sections {
		generated[key] = object{"type": "string"}
	}
	schemas["ApplicationSpecification"] = strictObject([]string{"version", "sections", "decisions", "unresolved", "omittedDecisions", "nodeCount"}, object{"version": object{"type": "integer", "enum": []int{1}}, "sections": strictObject([]string{"dataModel", "screens", "businessRules", "apiContract", "acceptanceCriteria", "decisions"}, generated), "decisions": object{"type": "array", "maxItems": 200, "items": ref("BuildDecision")}, "unresolved": object{"type": "integer"}, "omittedDecisions": object{"type": "integer"}, "nodeCount": object{"type": "integer"}})
	schemas["ApplicationSpecification"].(object)["description"] = "Observed schemas/relationships, clearly proposed screens/read API routes, acceptance criteria and missing decisions. No runtime behavior, unknown schema fields or hidden source records are invented. At most 200 decisions are shown; omittedDecisions counts additional open questions and remains unresolved until a narrower scope is reviewed."
	schemas["BuildBrief"] = strictObject([]string{"text", "nodeCount", "edgeCount", "boundaryCount", "specification"}, object{"text": object{"type": "string"}, "nodeCount": object{"type": "integer"}, "edgeCount": object{"type": "integer"}, "boundaryCount": object{"type": "integer"}, "specification": ref("ApplicationSpecification")})
}
