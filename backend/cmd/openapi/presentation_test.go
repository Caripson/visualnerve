package main

import (
	"reflect"
	"testing"
)

func TestPresentationSchemasAndPaths(t *testing.T) {
	schemas := object{}
	addPresentationSchemas(schemas)
	definition := schemas["PresentationDefinition"].(object)
	if definition["additionalProperties"] != false || !reflect.DeepEqual(definition["required"], []string{"version", "nodeIds", "secondsPerNode", "transitionMs"}) {
		t.Fatal("exact saved contract required", definition)
	}
	ids := definition["properties"].(object)["nodeIds"].(object)
	if ids["maxItems"] != 20000 || ids["uniqueItems"] != true {
		t.Fatal("sequence must be bounded and unique", ids)
	}
	if schemas["PresentationEmptyInput"].(object)["additionalProperties"] != false {
		t.Fatal("actions must use exact empty body")
	}
	paths := map[string]string{}
	addPresentationPaths(func(method, path, summary, input, output, status string) { paths[method+" "+path] = input })
	if paths["PUT /diagrams/{diagramId}/presentation"] != "PresentationUpdate" || paths["PATCH /presentation"] != "PresentationOptions" || paths["POST /presentation/open"] != "PresentationOpenInput" {
		t.Fatal("required presentation routes missing", paths)
	}
	for _, action := range []string{"play", "pause", "rewind", "forward", "close", "preload"} {
		if paths["POST /presentation/"+action] != "PresentationEmptyInput" {
			t.Fatal("incorrect action body", action)
		}
	}
	if _, exists := paths["GET /presentation/voices"]; !exists {
		t.Fatal("voice discovery missing")
	}
}
