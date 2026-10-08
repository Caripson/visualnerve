package main

import (
	"reflect"
	"strings"
	"testing"
)

func TestSVGExportHasStrictReadOnlyAreaContract(t *testing.T) {
	schema := exportSchema()
	variants := schema["oneOf"].([]any)
	if len(variants) != 3 {
		t.Fatal("JSON/Markdown, whole/viewport SVG and selected SVG must have distinct contracts")
	}
	for _, value := range variants {
		if value.(object)["additionalProperties"] != false {
			t.Fatal("export options must be strict")
		}
	}
	selected := variants[2].(object)
	if !reflect.DeepEqual(selected["required"], []string{"diagramId", "format", "scope", "nodeIds"}) {
		t.Fatal("selected SVG requires explicit IDs")
	}
	ids := selected["properties"].(object)["nodeIds"].(object)
	if ids["uniqueItems"] != true || ids["maxItems"] != 20000 {
		t.Fatal("selected SVG IDs must have bounded unique references")
	}
	for _, phrase := range []string{"Read-only", "JSON string", "canonical 2D", "foreignObject"} {
		if !strings.Contains(schema["description"].(string), phrase) {
			t.Fatal("missing SVG export discovery detail", phrase)
		}
	}
}
