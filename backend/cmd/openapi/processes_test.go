package main

import (
	"strings"
	"testing"
)

func TestProcessHierarchyContractIsAdditiveAndSemanticallyComplete(t *testing.T) {
	schemas := object{}
	addSimulationSchemas(schemas)
	model := schemas["SimulationModel"].(object)
	if model["properties"].(object)["processes"].(object)["items"].(object)["$ref"] != "#/components/schemas/SimulationProcess" {
		t.Fatal("model must expose typed process scopes")
	}
	for _, field := range model["required"].([]string) {
		if field == "processes" {
			t.Fatal("schemaVersion 1 documents without processes must remain valid")
		}
	}
	for _, name := range []string{"SourceNode", "WorkNode", "RouterNode", "ResourceNode", "OutcomeNode"} {
		if schemas["Simulation"+name].(object)["properties"].(object)["processId"] == nil {
			t.Fatal("all semantic node types must expose direct process membership", name)
		}
	}
	process := schemas["SimulationProcess"].(object)
	if process["additionalProperties"] != false || process["properties"].(object)["parentId"].(object)["format"] != nil {
		t.Fatal("process scopes must be strict and permit readable semantic IDs")
	}
	for _, field := range []string{"id", "name", "description", "parentId", "childProcessIds", "nodeIds", "directNodeIds"} {
		if schemas["SimulationHierarchyEntry"].(object)["properties"].(object)[field] == nil {
			t.Fatal("missing hierarchy discovery field", field)
		}
	}
	metrics := schemas["SimulationProcessMetrics"].(object)
	for _, field := range []string{"entered", "completed", "exited", "terminalCompleted", "failed", "abandoned", "inSystem", "throughputPerHour", "queue", "cycleTime", "ttr", "processing", "utilization", "currentBottleneck", "bottlenecks", "resourceUsage", "resourceCostAllocation", "realizedRevenue", "resourceCost", "cost", "contribution"} {
		if metrics["properties"].(object)[field] == nil {
			t.Fatal("missing real scoped execution/economic metric", field)
		}
	}
	for _, phrase := range []string{"overlap", "quantiles", "occupied", "idle", "whole-system"} {
		if !strings.Contains(metrics["description"].(string), phrase) {
			t.Fatal("rollup accounting must be explicit", phrase)
		}
	}
	for _, name := range []string{"SimulationState", "SimulationResult", "SimulationQueues", "SimulationScenarioOverrides"} {
		if schemas[name].(object)["properties"].(object)["processes"] == nil {
			t.Fatal("processes must be programmatically inspectable everywhere", name)
		}
	}
	if schemas["SimulationProcessPatchValue"].(object)["properties"].(object)["parentId"].(object)["oneOf"] == nil {
		t.Fatal("PATCH must allow removing optional parent membership with null")
	}
	if schemas["SimulationNodeOverride"].(object)["properties"].(object)["processId"].(object)["oneOf"] == nil {
		t.Fatal("node scenario overrides must expose nullable process membership")
	}
}

func TestProcessHierarchyPathsShareExistingModelAndRunRoutes(t *testing.T) {
	paths := object{}
	addSimulationPaths(func(method, path, summary, input, output, status string) {
		if paths[path] == nil {
			paths[path] = object{}
		}
		paths[path].(object)[strings.ToLower(method)] = object{"input": input, "output": output, "status": status, "summary": summary}
	}, paths)
	base := "/diagrams/{diagramId}/simulation"
	for _, test := range []struct{ path, method, output string }{
		{base + "/hierarchy", "get", "SimulationHierarchy"},
		{base + "/processes", "get", "SimulationProcess[]"},
		{base + "/processes", "post", "Graph"},
		{base + "/processes/{entityId}", "get", "SimulationProcess"},
		{base + "/processes/{entityId}", "patch", "Graph"},
		{base + "/runs/{runId}/processes", "get", "SimulationProcessMetricsMap"},
		{base + "/runs/{runId}/processes/{entityId}", "get", "SimulationProcessMetrics"},
	} {
		if paths[test.path].(object)[test.method].(object)["output"] != test.output {
			t.Fatal("missing canonical hierarchy operation", test.path, test.method)
		}
	}
	deletion := paths[base+"/processes/{entityId}"].(object)["delete"].(object)
	if deletion["status"] != "204" || !strings.Contains(deletion["summary"].(string), "structured 422") {
		t.Fatal("referenced deletion behavior must be documented")
	}
}
