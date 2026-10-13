package main

import (
	"reflect"
	"strings"
	"testing"
	"visualnerve/internal/model"
)

func notationVariant(t *testing.T, schema object, collection, symbol string) object {
	t.Helper()
	for _, raw := range schema["oneOf"].([]any) {
		variant := raw.(object)
		p := variant["properties"].(object)
		if p["collection"].(object)["enum"].([]any)[0] == collection && p["symbol"].(object)["enum"].([]any)[0] == symbol {
			return variant
		}
	}
	t.Fatal("missing notation variant", collection, symbol)
	return nil
}

func TestNotationOpenAPIUsesCanonicalCatalogAndNativeOptionalFields(t *testing.T) {
	doc := analyticsContract(t)
	schemas := doc["components"].(object)["schemas"].(object)
	if doc["info"].(object)["version"] != "0.10.0" || !strings.Contains(doc["info"].(object)["description"].(string), "standard-notations-v1") {
		t.Fatal("notation version/capability missing")
	}
	if len(schemas["NotationProfile"].(object)["oneOf"].([]any)) != len(model.NotationCollections) || len(schemas["NodeNotation"].(object)["oneOf"].([]any)) != len(model.StandardNotationCatalog.Symbols) || len(schemas["EdgeNotation"].(object)["oneOf"].([]any)) != len(model.StandardNotationCatalog.Connectors) {
		t.Fatal("generated discriminants must follow the canonical catalog")
	}
	for _, test := range []struct{ entity, notation string }{{"Diagram", "NotationProfile"}, {"Node", "NodeNotation"}, {"Edge", "EdgeNotation"}} {
		for _, suffix := range []string{"", "Input", "Patch"} {
			expected := test.notation
			if suffix == "Patch" {
				expected += "Patch"
			}
			field := schemas[test.entity+suffix].(object)["properties"].(object)["notation"].(object)
			if field["$ref"] != "#/components/schemas/"+expected {
				t.Fatal("wrong optional contract", test, suffix, field)
			}
		}
		patch := schemas[test.notation+"Patch"].(object)
		if patch["nullable"] != true || patch["anyOf"].([]any)[1].(object)["enum"].([]any)[0] != nil {
			t.Fatal("partial clear must be explicit", patch)
		}
	}
	for _, entity := range []string{"Node", "Edge"} {
		if schemas["Bulk"+entity].(object)["properties"].(object)["notation"].(object)["$ref"] != "#/components/schemas/"+entity+"NotationPatch" {
			t.Fatal("existing bulk upsert must support notation clearing")
		}
	}
	for _, name := range []string{"Node", "NodeInput", "NodePatch", "BulkNode"} {
		exclusive, exists := schemas[name].(object)["not"].(object)
		if !exists || !reflect.DeepEqual(exclusive["required"], []any{"notation", "flowchartSymbol"}) {
			t.Fatal("node appearance exclusivity missing", name, exclusive)
		}
		p := exclusive["properties"].(object)
		if p["notation"].(object)["type"] != "object" || p["flowchartSymbol"].(object)["type"] != "string" {
			t.Fatal("partial null clearing must remain valid", name, exclusive)
		}
	}
	input := schemas["DiagramInput"].(object)["properties"].(object)
	if !reflect.DeepEqual(input["template"].(object)["enum"], stringsToAny(append(append([]string{"time-series-analysis", "ibm-flowcharting"}, model.NotationTemplateKeys...), infrastructureTemplateKeys...))) {
		t.Fatal("POST must list only implemented examples")
	}
	if !strings.Contains(input["template"].(object)["description"].(string), "notation profile must exactly match") {
		t.Fatal("template profile consistency must be documented")
	}
	for _, raw := range schemas["Node"].(object)["properties"].(object)["nodeType"].(object)["enum"].([]any) {
		if raw == "uml" || raw == "bpmn" {
			t.Fatal("notation must not add native node kinds")
		}
	}
	for _, symbol := range model.StandardNotationCatalog.Symbols {
		variant := notationVariant(t, schemas["NodeNotation"].(object), symbol.Collection, symbol.ID)
		if variant["additionalProperties"] != false {
			t.Fatal("node variant must be strict", symbol.ID)
		}
		p := variant["properties"].(object)
		if (p["compartments"] != nil) != (symbol.Compartments != nil) {
			t.Fatal("compartment applicability differs", symbol.ID)
		}
		if p["ports"].(object)["maxItems"] != float64(model.StandardNotationCatalog.Limits["ports"]) {
			t.Fatal("port bound differs")
		}
	}
}

func TestNotationOpenAPIContextConstraintsAndPureDiscovery(t *testing.T) {
	doc := analyticsContract(t)
	schemas := doc["components"].(object)["schemas"].(object)
	nodes := schemas["NodeNotation"].(object)
	start := notationVariant(t, nodes, "bpmn", "start-event")["properties"].(object)["properties"].(object)["oneOf"].([]any)
	if len(start) != 3 || !reflect.DeepEqual(start[0].(object)["properties"].(object)["eventDefinition"].(object)["enum"], stringsToAny(model.StandardNotationCatalog.BPMNEventContexts["topLevelStart"])) {
		t.Fatal("BPMN source context matrix missing", start)
	}
	if len(start[2].(object)["required"].([]any)) != 3 {
		t.Fatal("noninterrupting event-subprocess flags must be required")
	}
	boundary := notationVariant(t, nodes, "bpmn", "boundary-event")["properties"].(object)
	if boundary["attachmentId"].(object)["format"] != "uuid" || len(boundary["properties"].(object)["oneOf"].([]any)) != 2 {
		t.Fatal("boundary contexts/attachment missing")
	}
	for id, targets := range model.StandardNotationCatalog.UMLAttachmentTargets {
		attachment := notationVariant(t, nodes, "uml", id)["properties"].(object)["attachmentId"].(object)
		if !reflect.DeepEqual(attachment["x-visual-nerve-target-symbols"], stringsToAny(targets)) {
			t.Fatal("UML attachment target contract missing", id)
		}
	}
	timing := notationVariant(t, nodes, "uml", "timing-lifeline")["properties"].(object)["properties"].(object)["properties"].(object)["timingStates"].(object)
	if timing["maxItems"] != float64(128) || timing["items"].(object)["additionalProperties"] != false {
		t.Fatal("editable timing state bounds missing")
	}
	paths := doc["paths"].(object)
	for _, path := range []string{"/notation/collections", "/notation/collections/{collectionId}", "/notation/collections/{collectionId}/symbols", "/notation/collections/{collectionId}/connectors"} {
		op := paths[path].(object)["get"].(object)
		if op["requestBody"] != nil {
			t.Fatal("discovery must be a bodyless read")
		}
		if path != "/notation/collections" {
			parameter := op["parameters"].([]any)[0].(object)
			if parameter["schema"].(object)["$ref"] != "#/components/schemas/NotationCollectionId" {
				t.Fatal("collection IDs must not be UUIDs", parameter)
			}
		}
	}
	op := paths["/diagrams/{diagramId}/notation/validate"].(object)["post"].(object)
	if op["requestBody"].(object)["required"] != false || !strings.Contains(op["description"].(string), "Read only") || schemas["NotationValidationInput"].(object)["additionalProperties"] != false {
		t.Fatal("pure inspection input/permission missing")
	}
	for _, raw := range op["parameters"].([]any) {
		if raw.(object)["in"] == "header" {
			t.Fatal("pure inspection must not advertise operation tokens")
		}
	}
	if op["responses"].(object)["200"].(object)["headers"] != nil {
		t.Fatal("pure inspection must not allocate operation receipts")
	}
}

func TestNotationOpenAPIFixedCompartmentLimitsMatchCanonicalContexts(t *testing.T) {
	schemas := analyticsContract(t)["components"].(object)["schemas"].(object)
	nodes := schemas["NodeNotation"].(object)
	for _, id := range []string{"choreography-task", "sub-choreography", "call-choreography"} {
		variant := notationVariant(t, nodes, "bpmn", id)
		if variant["properties"].(object)["compartments"].(object)["maxItems"] != float64(3) {
			t.Fatal("choreography overflow must be rejected", id, variant)
		}
	}
	ipo := notationVariant(t, nodes, "hipo", "ipo-chart")
	if ipo["properties"].(object)["compartments"].(object)["maxItems"] != float64(4) {
		t.Fatal("IPO detail maximum missing")
	}
	branches := ipo["oneOf"].([]any)
	detail := branches[0].(object)["allOf"].([]any)
	condition := detail[0].(object)
	selectors := condition["anyOf"].([]any)
	kind := selectors[0].(object)
	properties := selectors[1].(object)
	if !reflect.DeepEqual(kind["required"], []any{"diagramKind"}) || !reflect.DeepEqual(kind["properties"].(object)["diagramKind"].(object)["enum"], []any{"detail-ipo"}) || !reflect.DeepEqual(properties["required"], []any{"properties"}) {
		t.Fatal("detail mode must require an explicit diagramKind or property selector", condition)
	}
	property := properties["properties"].(object)["properties"].(object)
	if !reflect.DeepEqual(property["required"], []any{"detail"}) || !reflect.DeepEqual(property["properties"].(object)["detail"].(object)["enum"], []any{"detail"}) {
		t.Fatal("detail property selector must not match omitted properties", property)
	}
	overview := branches[1].(object)
	if !reflect.DeepEqual(overview["not"], condition) || overview["properties"].(object)["compartments"].(object)["maxItems"] != float64(3) || detail[1].(object)["properties"].(object)["compartments"].(object)["maxItems"] != float64(4) {
		t.Fatal("overview and detail limits must be disjoint", branches)
	}
	ordinary := notationVariant(t, nodes, "uml", "class")
	if ordinary["properties"].(object)["compartments"].(object)["maxItems"] != float64(model.StandardNotationCatalog.Limits["compartments"]) {
		t.Fatal("ordinary flexible sections must retain their supported limit")
	}
}
