package main

import (
	"reflect"
	"testing"
	"visualnerve/internal/model"
)

func TestFlowchartContractPreservesAppearanceAcrossCRUDAndDiscovery(t *testing.T) {
	document := analyticsContract(t)
	schemas := document["components"].(object)["schemas"].(object)
	enum := schemas["FlowchartSymbol"].(object)["enum"].([]any)
	if !reflect.DeepEqual(enum, stringsToAny(model.FlowchartSymbols)) {
		t.Fatal("catalog must expose the canonical enum", enum)
	}
	for _, name := range []string{"Node", "NodeInput"} {
		props := schemas[name].(object)["properties"].(object)
		if props["flowchartSymbol"].(object)["$ref"] != "#/components/schemas/FlowchartSymbol" || props["nodeType"].(object)["enum"].([]any)[0] != "generic" {
			t.Fatal("complete nodes require the optional typed appearance and existing kinds", name)
		}
	}
	for _, name := range []string{"NodePatch", "BulkNode"} {
		field := schemas[name].(object)["properties"].(object)["flowchartSymbol"].(object)
		values := field["enum"].([]any)
		if field["nullable"] != true || len(values) != len(model.FlowchartSymbols)+1 || values[len(model.FlowchartSymbols)] != nil {
			t.Fatal("partial updates must describe explicit field removal", name, field)
		}
	}
	input := schemas["DiagramInput"].(object)["properties"].(object)
	if !reflect.DeepEqual(input["template"].(object)["enum"], stringsToAny(append(append([]string{"time-series-analysis", "ibm-flowcharting"}, model.NotationTemplateKeys...), infrastructureTemplateKeys...))) {
		t.Fatal("template must be discoverable while preserving analytics")
	}
	record := schemas["FlowchartSymbolRecord"].(object)
	if record["additionalProperties"] != false || len(record["required"].([]any)) != 12 {
		t.Fatal("discovery must expose complete catalog metadata", record)
	}
	op := document["paths"].(object)["/flowchart/symbols"].(object)["get"].(object)
	response := op["responses"].(object)["200"].(object)["content"].(object)["application/json"].(object)["schema"].(object)
	if response["type"] != "array" || response["items"].(object)["$ref"] != "#/components/schemas/FlowchartSymbolRecord" {
		t.Fatal("catalog must be an array of full records", response)
	}
	stencil := schemas["FlowchartStencilRecord"].(object)["properties"].(object)["physicalCutoutSymbolIds"].(object)
	if stencil["minItems"] != float64(25) || stencil["maxItems"] != float64(26) || stencil["items"].(object)["$ref"] != "#/components/schemas/FlowchartSymbol" {
		t.Fatal("exact stencil membership must reuse the same catalog identities", stencil)
	}
	stencilOp := document["paths"].(object)["/flowchart/stencils"].(object)["get"].(object)
	stencilResponse := stencilOp["responses"].(object)["200"].(object)["content"].(object)["application/json"].(object)["schema"].(object)
	if stencilResponse["items"].(object)["$ref"] != "#/components/schemas/FlowchartStencilRecord" {
		t.Fatal("stencil discovery must be documented", stencilResponse)
	}
	labels := schemas["FlowchartStencilSymbolLabels"].(object)
	if labels["additionalProperties"] != false || len(labels["properties"].(object)) != len(model.FlowchartSymbols) || labels["properties"].(object)["ibm-merge"].(object)["type"] != "string" {
		t.Fatal("historical aliases must be keyed by actual catalog identities", labels)
	}
	if schemas["FlowchartStencilRecord"].(object)["properties"].(object)["symbolLabels"].(object)["$ref"] != "#/components/schemas/FlowchartStencilSymbolLabels" {
		t.Fatal("source-backed historical aliases must be discoverable")
	}
	if document["info"].(object)["version"] != "0.11.0" {
		t.Fatal("new capability needs a discoverable software version")
	}
}
