package main

import "visualnerve/internal/model"

const notationPolicy = "Bridge/browser 0.10.0 advertises standard-notations-v1. GET /notation/collections discovers hipo, dfd-yourdon, dfd-gane-sarson, uml and bpmn. Exact collection, symbols and connectors paths return public source-backed catalog metadata; collection IDs are stable strings, not UUIDs. Optional diagram.notation selects schemaVersion:1, collection and diagramKind; node.notation and edge.notation retain semantic symbols, applicable properties, compartments, ports, native references, end labels/multiplicities and waypoints. Ordinary graph CRUD retains existing native types. A node can have either notation or flowchartSymbol; clear the alternate field with null in the same versioned PATCH or existing bulk upsert when switching, or the complete edit returns 422 INVALID_NOTATION. Omission preserves an optional field; a supplied notation object replaces it as a whole. Versioned PATCH and existing bulk upserts accept notation:null to clear it; complete/new/import/replacement records reject null. Unsupported fields/combinations, malformed or dangling references and bounds return structured 422 INVALID_NOTATION without partial saves. Profile placement and incomplete semantics remain editable drafts reported by pure POST /diagrams/{diagramId}/notation/validate, permitted with Read only and accepting only an omitted body or exactly {}. Host moves through PATCH or bulk translate native group contents and attached ports, boundary events and executions once. Explicit child or attachment coordinates in the same bulk request take precedence independently of entry order; related-node links do not imply movement. Read the resulting graph and entity versions before subsequent edits. Native JSON, templates, copy/remapping, encryption, history, backup and collaboration preserve notation. Fixed HIPO ipo-chart layouts permit at most three compartments, or four when properties.detail is detail or node diagramKind is detail-ipo; BPMN choreography-task, sub-choreography and call-choreography permit three. Extra sections reject with 422 INVALID_NOTATION; valid custom section IDs and content are preserved. These graphical models do not implement a complete metamodel, XMI/BPMN XML interchange, simulation execution or conformance certification. New notation rooms pin CRDT document contract version 3, retained after clearing notation; older clients reject it before projection. Existing version-1/2 rooms reject adding notation with 409 COLLABORATION_NOTATION_REQUIRED; refresh all participants and create a new room. Owner authority and role checks remain unchanged. Process Simulator and Time Series & Signal Analysis retain specialized tools."

func notationBound(key string) int { return int(model.StandardNotationCatalog.Limits[key]) }
func notationIDSchema() object {
	return object{"type": "string", "minLength": 1, "maxLength": notationBound("id"), "pattern": `^[a-z][a-z0-9-]*(?![\s\S])`}
}
func notationTextSchema(key string) object {
	return object{"type": "string", "maxLength": notationBound(key), "description": "The browser and Go validators measure text in UTF-16 code units."}
}
func notationCoordinateSchema() object {
	return object{"type": "number", "minimum": -notationBound("coordinate"), "maximum": notationBound("coordinate")}
}
func notationPropertySchema(definition model.NotationPropertyDefinition) object {
	var result object
	switch definition.Type {
	case "text":
		result = notationTextSchema("text")
	case "enum":
		result = object{"type": "string", "enum": definition.Values}
	case "boolean":
		result = object{"type": "boolean"}
	case "number", "integer":
		result = notationCoordinateSchema()
		result["type"] = definition.Type
	case "timing-states":
		state := notationTextSchema("label")
		state["minLength"] = 1
		result = object{"type": "array", "maxItems": notationBound("timingStates"), "items": strictObject([]string{"time", "state"}, object{"time": notationCoordinateSchema(), "state": state}), "description": "Times must be strictly increasing and within any supplied timeStart/timeEnd. Omission renders no invented waveform."}
	default:
		panic("unknown notation descriptor: " + definition.Type)
	}
	if definition.Minimum != nil {
		result["minimum"] = *definition.Minimum
	}
	if definition.Maximum != nil {
		result["maximum"] = *definition.Maximum
	}
	return result
}
func notationPropertiesSchema(definitions []model.NotationPropertyDefinition) object {
	properties := object{}
	for _, definition := range definitions {
		properties[definition.Key] = notationPropertySchema(definition)
	}
	return strictObject(nil, properties)
}
func notationEventProperties(symbol model.NotationSymbol) object {
	base := notationPropertiesSchema(symbol.Properties)
	variant := func(context string, flags object, required []string) object {
		result := clone(base)
		properties := result["properties"].(object)
		properties["eventDefinition"] = object{"type": "string", "enum": model.StandardNotationCatalog.BPMNEventContexts[context]}
		for key, value := range flags {
			properties[key] = object{"type": "boolean", "enum": []any{value}}
		}
		if len(required) > 0 {
			result["required"] = required
		}
		return result
	}
	switch symbol.ID {
	case "start-event":
		return object{"oneOf": []any{
			variant("topLevelStart", object{"eventSubProcess": false, "nonInterrupting": false}, nil),
			variant("eventSubProcessStart", object{"eventSubProcess": true, "nonInterrupting": false}, []string{"eventSubProcess", "eventDefinition"}),
			variant("nonInterruptingStart", object{"eventSubProcess": true, "nonInterrupting": true}, []string{"eventSubProcess", "nonInterrupting", "eventDefinition"}),
		}}
	case "boundary-event":
		return object{"oneOf": []any{
			variant("boundary", object{"nonInterrupting": false}, nil),
			variant("nonInterruptingBoundary", object{"nonInterrupting": true}, []string{"nonInterrupting"}),
		}}
	case "intermediate-catch-event":
		return variant("intermediateCatch", nil, nil)
	case "intermediate-throw-event":
		return variant("intermediateThrow", nil, nil)
	case "end-event":
		return variant("end", nil, nil)
	case "event-based-gateway":
		ordinary, instantiating := clone(base), clone(base)
		ordinary["properties"].(object)["instantiating"] = object{"type": "boolean", "enum": []bool{false}}
		ordinary["properties"].(object)["parallel"] = object{"type": "boolean", "enum": []bool{false}}
		instantiating["properties"].(object)["instantiating"] = object{"type": "boolean", "enum": []bool{true}}
		instantiating["required"] = []string{"instantiating"}
		return object{"oneOf": []any{ordinary, instantiating}}
	}
	return base
}
func notationPatchSchema(name string) object {
	return object{"nullable": true, "anyOf": []any{ref(name), object{"type": "object", "nullable": true, "enum": []any{nil}}}, "description": "Omission preserves notation; a supplied object replaces the entire field. Null clears only a versioned PATCH or existing bulk upsert. Complete/new records reject null."}
}

func addFixedCompartmentLimit(node object, symbol model.NotationSymbol) {
	rule, exists := model.StandardNotationCatalog.CompartmentLimits[symbol.Collection][symbol.ID]
	if !exists {
		return
	}
	compartments := node["properties"].(object)["compartments"].(object)
	compartments["maxItems"] = rule.Default
	if rule.Detail == 0 {
		return
	}
	compartments["maxItems"] = rule.Detail
	compartments["description"] = compartments["description"].(string) + " IPO permits three sections, or four when properties.detail is detail or node diagramKind is detail-ipo."
	detail := object{"anyOf": []any{
		object{"required": []string{"diagramKind"}, "properties": object{"diagramKind": object{"enum": []string{"detail-ipo"}}}},
		object{"required": []string{"properties"}, "properties": object{"properties": object{"required": []string{"detail"}, "properties": object{"detail": object{"enum": []string{"detail"}}}}}},
	}}
	// Disjoint branches make omission/default mode enforce the smaller limit;
	// explicit detail mode permits its fourth section without discarding data.
	node["oneOf"] = []any{
		object{"allOf": []any{detail, object{"properties": object{"compartments": object{"maxItems": rule.Detail}}}}},
		object{"not": detail, "properties": object{"compartments": object{"maxItems": rule.Default}}},
	}
}
func addNotationSchemas(schemas object) {
	schemas["NotationCollectionId"] = object{"type": "string", "enum": model.NotationCollections}
	schemas["NotationSource"] = strictObject([]string{"title", "url", "locator"}, object{"title": object{"type": "string"}, "url": object{"type": "string", "format": "uri"}, "locator": object{"type": "string"}})
	schemas["NotationPropertyDefinition"] = strictObject([]string{"key", "label", "type"}, object{"key": object{"type": "string"}, "label": object{"type": "string"}, "type": object{"type": "string", "enum": []string{"text", "boolean", "number", "integer", "enum", "timing-states"}}, "values": object{"type": "array", "items": object{"type": "string"}}, "minimum": object{"type": "number"}, "maximum": object{"type": "number"}})
	array := func(name string) object { return object{"type": "array", "items": ref(name)} }
	strings := object{"type": "array", "items": object{"type": "string"}}
	collection := object{"id": ref("NotationCollectionId"), "label": object{"type": "string"}, "diagramKinds": object{"type": "array", "items": strictObject([]string{"id", "label"}, object{"id": notationIDSchema(), "label": object{"type": "string"}})}, "sources": array("NotationSource"), "limitations": strings}
	schemas["NotationCollectionRecord"] = strictObject([]string{"id", "label", "diagramKinds", "sources", "limitations"}, collection)
	symbol := object{"collection": ref("NotationCollectionId"), "id": notationIDSchema(), "label": object{"type": "string"}, "category": object{"type": "string"}, "diagramKinds": strings, "defaultSize": strictObject([]string{"width", "height"}, object{"width": object{"type": "number", "exclusiveMinimum": true, "minimum": 0}, "height": object{"type": "number", "exclusiveMinimum": true, "minimum": 0}}), "geometry": object{"type": "string", "description": "Trusted built-in renderer geometry ID, never arbitrary executable markup."}, "properties": array("NotationPropertyDefinition"), "compartments": strings, "container": object{"type": "boolean"}, "source": ref("NotationSource")}
	schemas["NotationSymbolRecord"] = strictObject([]string{"collection", "id", "label", "category", "diagramKinds", "defaultSize", "geometry", "properties", "source"}, symbol)
	decoration := object{"type": "string", "enum": []string{"none", "open-arrow", "filled-arrow", "hollow-triangle", "filled-triangle", "hollow-diamond", "filled-diamond", "circle", "cross"}}
	schemas["NotationConnectorRecord"] = strictObject([]string{"collection", "id", "label", "diagramKinds", "line", "sourceDecoration", "targetDecoration", "properties", "source"}, object{"collection": ref("NotationCollectionId"), "id": notationIDSchema(), "label": object{"type": "string"}, "diagramKinds": strings, "line": object{"type": "string", "enum": []string{"solid", "dashed", "dotted"}}, "sourceDecoration": decoration, "targetDecoration": decoration, "properties": array("NotationPropertyDefinition"), "source": ref("NotationSource")})
	discovery := clone(collection)
	discovery["schemaVersion"], discovery["capability"] = object{"type": "integer", "enum": []int{1}}, object{"type": "string", "enum": []string{"standard-notations-v1"}}
	discovery["symbols"], discovery["connectors"] = array("NotationSymbolRecord"), array("NotationConnectorRecord")
	schemas["NotationCollectionDiscovery"] = strictObject([]string{"id", "label", "diagramKinds", "sources", "limitations", "schemaVersion", "capability", "symbols", "connectors"}, discovery)
	profiles := []any{}
	for _, collection := range model.NotationCollections {
		profiles = append(profiles, strictObject([]string{"schemaVersion", "collection", "diagramKind"}, object{"schemaVersion": object{"type": "integer", "enum": []int{1}}, "collection": object{"type": "string", "enum": []string{collection}}, "diagramKind": object{"type": "string", "enum": model.NotationDiagramKinds[collection]}}))
	}
	schemas["NotationProfile"] = object{"oneOf": profiles, "description": "Optional diagram profile; mixed profile placements remain draft issues rather than changing native diagram.type."}
	schemas["NotationCompartment"] = strictObject([]string{"id", "lines"}, object{"id": notationIDSchema(), "title": notationTextSchema("label"), "lines": object{"type": "array", "maxItems": notationBound("linesPerCompartment"), "items": notationTextSchema("text")}})
	schemas["NotationPort"] = strictObject([]string{"id", "side"}, object{"id": notationIDSchema(), "side": object{"type": "string", "enum": []string{"left", "right", "top", "bottom"}}, "offset": object{"type": "number", "minimum": 0, "maximum": 1}, "direction": object{"type": "string", "enum": []string{"in", "out", "both"}}, "label": notationTextSchema("label")})
	nodes := []any{}
	for _, entry := range model.StandardNotationCatalog.Symbols {
		properties := object{"collection": object{"type": "string", "enum": []string{entry.Collection}}, "symbol": object{"type": "string", "enum": []string{entry.ID}}, "diagramKind": object{"type": "string", "enum": entry.DiagramKinds}, "properties": notationPropertiesSchema(entry.Properties), "ports": object{"type": "array", "maxItems": notationBound("ports"), "items": ref("NotationPort"), "description": "IDs must be unique. Cardinal IDs may override their built-in anchor offsets; connection direction is checked against endpoint ports."}, "relatedNodeId": object{"type": "string", "format": "uuid", "description": "Existing other native node UUID in this graph; remapped with graph copies."}}
		if entry.Collection == "bpmn" {
			properties["properties"] = notationEventProperties(entry)
		}
		if entry.Compartments != nil {
			properties["compartments"] = object{"type": "array", "maxItems": notationBound("compartments"), "items": ref("NotationCompartment"), "description": "Unique custom compartment IDs; cumulative line text is bounded to 100000 UTF-16 code units. Titles do not count toward the aggregate."}
		}
		if entry.Collection == "bpmn" && entry.ID == "boundary-event" {
			properties["attachmentId"] = object{"type": "string", "format": "uuid", "description": "Existing other BPMN activity node; omission is a draft issue."}
		}
		node := strictObject([]string{"collection", "symbol"}, properties)
		addFixedCompartmentLimit(node, entry)
		if entry.Collection == "uml" && len(model.StandardNotationCatalog.UMLAttachmentTargets[entry.ID]) > 0 {
			properties["attachmentId"] = object{"type": "string", "format": "uuid", "description": "Existing other UML node with a supported attachment target symbol.", "x-visual-nerve-target-symbols": model.StandardNotationCatalog.UMLAttachmentTargets[entry.ID]}
		}
		if entry.Collection == "uml" {
			node["description"] = "Optional timeStart must not exceed timeEnd; timing-state times strictly increase within supplied bounds. Graph attachments follow source-backed target kinds."
		}
		nodes = append(nodes, node)
	}
	schemas["NodeNotation"] = object{"oneOf": nodes, "description": "Supported node collection/symbol/property combinations, with strict object fields. " + notationPolicy}
	edges := []any{}
	for _, entry := range model.StandardNotationCatalog.Connectors {
		properties := object{"collection": object{"type": "string", "enum": []string{entry.Collection}}, "symbol": object{"type": "string", "enum": []string{entry.ID}}, "sourcePort": notationIDSchema(), "targetPort": notationIDSchema(), "sourceLabel": notationTextSchema("label"), "targetLabel": notationTextSchema("label"), "waypoints": object{"type": "array", "maxItems": notationBound("waypoints"), "items": object{"type": "array", "minItems": 2, "maxItems": 2, "items": notationCoordinateSchema()}}}
		if len(entry.Properties) > 0 {
			properties["properties"] = notationPropertiesSchema(entry.Properties)
		}
		if entry.Collection == "uml" {
			multiplicity := object{"type": "string", "minLength": 1, "maxLength": notationBound("multiplicity"), "pattern": `^(?:\*|(?:0|[1-9]\d*)(?:\.\.(?:\*|0|[1-9]\d*))?)(?![\s\S])`, "description": "Safe integers at most 9007199254740991, * or an ascending lower..upper/* range; no leading zeroes."}
			properties["sourceMultiplicity"], properties["targetMultiplicity"] = multiplicity, multiplicity
		}
		if entry.Collection == "bpmn" && entry.ID == "sequence-flow" {
			ordinary, defaultFlow := notationPropertiesSchema(entry.Properties), notationPropertiesSchema(entry.Properties)
			ordinary["properties"].(object)["default"] = object{"type": "boolean", "enum": []bool{false}}
			defaultFlow["properties"].(object)["default"] = object{"type": "boolean", "enum": []bool{true}}
			defaultFlow["properties"].(object)["condition"] = object{"type": "string", "enum": []string{""}}
			defaultFlow["required"] = []string{"default"}
			properties["properties"] = object{"oneOf": []any{ordinary, defaultFlow}}
		}
		edges = append(edges, strictObject([]string{"collection", "symbol"}, properties))
	}
	schemas["EdgeNotation"] = object{"oneOf": edges, "description": "Applicable connector semantics; endpoint ports must resolve and permit the connection direction."}
	for _, name := range []string{"NotationProfile", "NodeNotation", "EdgeNotation"} {
		schemas[name+"Patch"] = notationPatchSchema(name)
	}
	schemas["NotationValidationInput"] = strictObject(nil, object{})
	schemas["NotationIssue"] = strictObject([]string{"code", "path", "message", "severity"}, object{"code": object{"type": "string"}, "path": object{"type": "string"}, "message": object{"type": "string"}, "severity": object{"type": "string", "enum": []string{"error", "warning"}}})
	schemas["NotationValidationReport"] = strictObject([]string{"diagramId", "baseVersion", "issues"}, object{"diagramId": object{"type": "string", "format": "uuid"}, "baseVersion": object{"type": "integer", "minimum": 1}, "issues": array("NotationIssue")})
}
func addNotationPaths(add func(string, string, string, string, string, string), paths object) {
	for _, route := range []struct{ path, summary, output string }{
		{"/notation/collections", "Discover the five standard notation collections", "NotationCollectionRecord[]"},
		{"/notation/collections/{collectionId}", "Inspect a collection and its supported symbols and connectors", "NotationCollectionDiscovery"},
		{"/notation/collections/{collectionId}/symbols", "Discover source-backed node symbols", "NotationSymbolRecord[]"},
		{"/notation/collections/{collectionId}/connectors", "Discover source-backed relationship notation", "NotationConnectorRecord[]"},
	} {
		add("GET", route.path, route.summary, "", route.output, "200")
		op := paths[route.path].(object)["get"].(object)
		op["description"] = notationPolicy
		if route.path != "/notation/collections" {
			op["parameters"] = []any{object{"name": "collectionId", "in": "path", "required": true, "schema": ref("NotationCollectionId")}}
		}
	}
	add("POST", "/diagrams/{diagramId}/notation/validate", "Inspect draft notation issues without changing the diagram", "NotationValidationInput", "NotationValidationReport", "200")
	op := paths["/diagrams/{diagramId}/notation/validate"].(object)["post"].(object)
	op["requestBody"].(object)["required"] = false
	op["description"] = "Pure read command; Read only access is sufficient. Omit the body or supply exactly {}. No operation identity or receipt is allocated. " + notationPolicy
}
