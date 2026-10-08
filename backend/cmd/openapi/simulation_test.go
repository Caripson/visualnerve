package main

import (
	"strings"
	"testing"
)

func TestSimulationSchemasExposeCompleteSemanticModel(t *testing.T) {
	schemas := object{}
	addSimulationSchemas(schemas)
	model := schemas["SimulationModel"].(object)
	if model["additionalProperties"] != false {
		t.Fatal("model must reject unsupported assumptions")
	}
	properties := model["properties"].(object)
	for _, field := range []string{"type", "schemaVersion", "nodes", "edges", "particleTypes", "resources", "improvements", "scenarios", "defaults", "economics", "retention"} {
		if properties[field] == nil {
			t.Fatal("missing semantic model field", field)
		}
	}
	for _, name := range []string{"SimulationScaling", "SimulationResourceRequirement", "SimulationRoutingCondition", "SimulationNodeMetrics", "SimulationResourceMetrics", "SimulationParticleTypeMetrics", "SimulationResult", "SimulationComparisonResult"} {
		if schemas[name] == nil {
			t.Fatal("missing semantic contract", name)
		}
	}
	work := schemas["SimulationWork"].(object)["properties"].(object)
	if work["resourceRequirements"] == nil || work["scaling"] == nil || work["overflowNodeId"] == nil {
		t.Fatal("Work must expose shared resources, scaling and queue overflow")
	}
	if !strings.Contains(schemas["SimulationRunInput"].(object)["description"].(string), "connected browser") {
		t.Fatal("headless browser requirement must be explicit")
	}
	if schemas["SimulationCashPoint"].(object)["properties"].(object)["operatingCostFixed"] == nil {
		t.Fatal("cash snapshots must distinguish discrete per-item charges for payback")
	}
	if schemas["SimulationParticleSnapshot"].(object)["properties"].(object)["pendingAdmission"] == nil {
		t.Fatal("particle snapshots must expose staged same-time arrivals accurately")
	}
	limits := schemas["SimulationExecutionLimits"].(object)["properties"].(object)
	for _, field := range []string{"activeParticles", "semanticEvents", "routeVisits", "activeRuns", "cachedRuns"} {
		if limits[field] == nil {
			t.Fatal("missing discoverable execution safety limit", field)
		}
	}
	if description := limits["activeRuns"].(object)["description"].(string); !strings.Contains(description, "paused") || !strings.Contains(description, "replay") || !strings.Contains(description, "reservations") {
		t.Fatal("worker safety limit must include paused execution, replay and startup reservations")
	}
	visual := schemas["SimulationVisualCapacity"].(object)
	if schemas["SimulationCapabilities"].(object)["properties"].(object)["visualCapacity"].(object)["$ref"] != "#/components/schemas/SimulationVisualCapacity" {
		t.Fatal("capacity projection must be discoverable without changing simulation model semantics")
	}
	if description := visual["description"].(string); !strings.Contains(description, "anonymous") || !strings.Contains(description, "logical Work/Resource") || !strings.Contains(description, "3D") {
		t.Fatal("capacity projection must disclose shared logical identity and 2D presentation limits")
	}
	for _, field := range []string{"readOnly", "sharedLogicalModel", "persistentUnitIdentity", "occupancy", "limits", "overflow"} {
		if visual["properties"].(object)[field] == nil {
			t.Fatal("missing visual projection semantics", field)
		}
	}
	for _, field := range []string{"primaryEditable", "additionalCardsReadOnly", "compactHierarchyReadOnly"} {
		property, ok := visual["properties"].(object)[field].(object)
		if !ok || property["type"] != "boolean" || len(property["enum"].([]bool)) != 1 || !property["enum"].([]bool)[0] {
			t.Fatal("capacity card editability must be explicitly discoverable", field)
		}
	}
	legacy := visual["properties"].(object)["readOnly"].(object)
	if legacy["deprecated"] != true || !strings.Contains(legacy["description"].(string), "additional capacity cards") || !strings.Contains(legacy["description"].(string), "compact hierarchy") || !strings.Contains(legacy["description"].(string), "primary") {
		t.Fatal("legacy readOnly flag must disclose its limited scope without overriding primary editability")
	}
}

func TestSimulationPathsSupportDiscoveryCRUDRunsReplayAndComparison(t *testing.T) {
	paths := object{}
	addSimulationPaths(func(method, path, summary, input, output, status string) {
		if paths[path] == nil {
			paths[path] = object{}
		}
		paths[path].(object)[strings.ToLower(method)] = object{"input": input, "output": output, "status": status}
	}, paths)
	base := "/diagrams/{diagramId}/simulation"
	for _, collection := range []string{"nodes", "edges", "particle-types", "resources", "improvements", "scenarios"} {
		if paths[base+"/"+collection].(object)["post"] == nil || paths[base+"/"+collection+"/{entityId}"].(object)["patch"] == nil || paths[base+"/"+collection+"/{entityId}"].(object)["delete"] == nil {
			t.Fatal("incomplete semantic CRUD", collection)
		}
	}
	for _, suffix := range []string{"state", "metrics", "result", "nodes/{entityId}", "resources/{entityId}", "particle-types/{entityId}", "events", "queues", "bottlenecks"} {
		if paths[base+"/runs/{runId}/"+suffix].(object)["get"] == nil {
			t.Fatal("missing inspection", suffix)
		}
	}
	if paths[base+"/runs"].(object)["post"].(object)["status"] != "201" {
		t.Fatal("run must be an asynchronous identifiable creation")
	}
	if paths[base+"/compare"].(object)["post"].(object)["input"] != "SimulationCompareInput" {
		t.Fatal("comparison contract missing")
	}
	if paths[base+"/runs/{runId}/seek"].(object)["post"].(object)["input"] != "SimulationSeek" {
		t.Fatal("replay contract missing")
	}
}

func TestSimulationPatchSchemasRepresentNullClearingWithoutWeakeningCompleteModels(t *testing.T) {
	schemas := object{}
	addSimulationSchemas(schemas)
	complete := schemas["SimulationWork"].(object)["properties"].(object)
	if complete["scaling"].(object)["$ref"] != "#/components/schemas/SimulationScaling" {
		t.Fatal("complete configurations must retain strict non-nullable scaling")
	}
	partial := schemas["SimulationWorkPartial"].(object)["properties"].(object)
	choices := partial["scaling"].(object)["oneOf"].([]any)
	if choices[0].(object)["$ref"] != "#/components/schemas/SimulationScalingPartial" || choices[1].(object)["nullable"] != true {
		t.Fatal("nested patches must expose typed changes and explicit null removal")
	}
	for _, name := range []string{"SimulationNodeOverride", "SimulationNodePatchValue", "SimulationResourceOverride", "SimulationResourcePatchValue"} {
		identity := schemas[name].(object)["properties"].(object)["id"].(object)
		if identity["oneOf"] != nil || identity["nullable"] != nil {
			t.Fatal("entity identity cannot be cleared", name)
		}
	}
	complexity := schemas["SimulationParticleTypeOverride"].(object)["properties"].(object)["complexity"].(object)["oneOf"].([]any)[0].(object)
	if complexity["required"] != nil || complexity["properties"].(object)["min"].(object)["oneOf"] == nil {
		t.Fatal("nested object patches must allow partial updates and null removal")
	}
	resourceRequirements := partial["resourceRequirements"].(object)["oneOf"].([]any)[0].(object)
	if resourceRequirements["items"].(object)["$ref"] != "#/components/schemas/SimulationResourceRequirement" {
		t.Fatal("array replacement members must remain complete and strict")
	}
	economics := schemas["SimulationEconomicsOverride"].(object)["properties"].(object)
	if economics["maximumBudget"].(object)["oneOf"] == nil {
		t.Fatal("scenario economics must allow removing an inherited budget")
	}
}
