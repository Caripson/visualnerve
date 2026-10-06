package main

import (
	"reflect"
	"strings"
	"testing"
)

func TestUnderstandingContractsKeepLegacyPresentationAndExposeBoundedSources(t *testing.T) {
	schemas := object{}
	addSpatialSchemas(schemas)
	addPresentationSchemas(schemas)
	addUnderstandingSchemas(schemas)
	if !reflect.DeepEqual(schemas["PresentationDefinition"].(object)["required"], []string{"version", "nodeIds", "secondsPerNode", "transitionMs"}) {
		t.Fatal("legacy numbered content changed")
	}
	for _, name := range []string{"OverviewUpdate", "StoryboardUpdate", "BuildSpecificationUpdate", "HistoryRestore", "HistoryCreate"} {
		definition := schemas[name].(object)
		if definition["additionalProperties"] != false || definition["properties"].(object)["baseVersion"].(object)["minimum"] != 1 {
			t.Fatalf("%s must reject extra fields and require current graph version", name)
		}
	}
	for _, name := range []string{"PresentationOpenInput", "PresentationVideoInput"} {
		if !reflect.DeepEqual(schemas[name].(object)["properties"].(object)["source"].(object)["enum"], []string{"nodes", "storyboard"}) {
			t.Fatalf("%s cannot select both presentation sources", name)
		}
	}
	if _, inventedDefault := schemas["PresentationVideoInput"].(object)["properties"].(object)["source"].(object)["default"]; inventedDefault {
		t.Fatal("video source defaults to current player source, not always nodes")
	}
	view := schemas["StoryboardView"].(object)["oneOf"].([]any)[0].(object)
	viewport := view["properties"].(object)["viewport"].(object)["properties"].(object)
	if viewport["zoom"].(object)["minimum"] != 0.01 || viewport["zoom"].(object)["maximum"] != 100 || viewport["x"].(object)["maximum"] != float64(1e7) {
		t.Fatal("saved viewport bounds differ from the browser contract")
	}
	question := schemas["DiagramQuestion"].(object)["properties"].(object)
	if question["maxDepth"].(object)["maximum"] != 64 || question["limit"].(object)["maximum"] != 100 || question["includeUncertain"].(object)["default"] != true {
		t.Fatal("question bounds or uncertainty default differ")
	}
	if len(schemas["HistoryRowBackup"].(object)["oneOf"].([]any)) != 2 {
		t.Fatal("history must provide exactly one embedded or current-dataset row representation")
	}
	sections := schemas["BuildSpecificationDraft"].(object)["properties"].(object)["sections"].(object)
	if len(sections["properties"].(object)) != 6 || sections["additionalProperties"] != false {
		t.Fatal("reviewed sections must have the same six known keys as the browser")
	}
}

func TestUnderstandingRoutesIncludeExactPreviewAndRestorationContracts(t *testing.T) {
	paths := object{}
	addUnderstandingPaths(func(method, path, summary, input, output, status string) {
		if paths[path] == nil {
			paths[path] = object{}
		}
		paths[path].(object)[strings.ToLower(method)] = object{"input": input, "output": output, "status": status}
	}, paths)
	for key, input := range map[string]string{
		"/diagrams/{diagramId}/questions":                    "DiagramQuestion",
		"/diagrams/{diagramId}/build-brief":                  "BuildBriefInput",
		"/diagrams/{diagramId}/history/{snapshotId}/restore": "HistoryRestore",
		"/presentation/seek":                                 "PresentationSeek",
	} {
		if paths[key].(object)["post"].(object)["input"] != input {
			t.Fatal("missing or incorrect command contract", key)
		}
	}
	params := paths["/diagrams/{diagramId}/evidence"].(object)["get"].(object)["parameters"].([]any)
	if len(params) != 4 || params[0].(object)["name"] != "nodeId" || params[0].(object)["required"] != true {
		t.Fatal("source evidence needs an explicit object and optional measure-page parameters")
	}
}
