package main

import (
	"strings"
	"testing"
)

func TestParallelSchemasRetainVersionOneAndExposeCompleteSemanticContract(t *testing.T) {
	schemas := object{}
	addSimulationSchemas(schemas)
	addParallelSimulationSchemas(schemas)
	if schemas["SimulationModel"].(object)["properties"].(object)["schemaVersion"].(object)["enum"].([]int)[0] != 1 {
		t.Fatal("parallel flow must be additive schemaVersion 1")
	}
	variants := schemas["SimulationNode"].(object)["oneOf"].([]any)
	if len(variants) != 7 {
		t.Fatal("existing nodes and both parallel variants must be discoverable")
	}
	for _, name := range []string{"SimulationForkNode", "SimulationJoinNode"} {
		properties := schemas[name].(object)["properties"].(object)
		if properties["processId"] == nil || properties["metadata"] == nil || schemas[name].(object)["additionalProperties"] != false {
			t.Fatal("parallel nodes require common strict semantic identity", name)
		}
	}
	fork := schemas["SimulationFork"].(object)["properties"].(object)
	branches := fork["branchEdgeIds"].(object)
	if branches["minItems"] != 2 || branches["maxItems"] != 64 || branches["uniqueItems"] != true {
		t.Fatal("mandatory branch limits must match engine validation")
	}
	for _, name := range []string{"SimulationNodeOverride", "SimulationNodePatchValue"} {
		properties := schemas[name].(object)["properties"].(object)
		if properties["fork"].(object)["oneOf"] == nil || properties["join"].(object)["oneOf"] == nil {
			t.Fatal("parallel assumptions must remain available to scenarios and PATCH", name)
		}
	}
	for _, name := range []string{"SimulationState", "SimulationResult"} {
		if schemas[name].(object)["properties"].(object)["parallel"].(object)["$ref"] != "#/components/schemas/SimulationParallelState" {
			t.Fatal("runtime groups must be inspectable without graphics", name)
		}
	}
	for _, field := range []string{"waitingGroups", "arrivedBranches", "expectedBranches", "completedGroups", "cancelledGroups", "wait"} {
		if schemas["SimulationJoinMetrics"].(object)["properties"].(object)[field] == nil {
			t.Fatal("missing correlated join metric", field)
		}
	}
	for _, field := range []string{"rootParticleId", "parentParticleId", "forkGroupId", "forkNodeId", "joinNodeId", "branchEdgeId"} {
		for _, name := range []string{"SimulationParticleSnapshot", "SimulationEvent"} {
			if schemas[name].(object)["properties"].(object)[field] == nil {
				t.Fatal("missing semantic token/event correlation", name, field)
			}
		}
	}
	events := strings.Join(schemas["SimulationEvent"].(object)["properties"].(object)["type"].(object)["enum"].([]string), ",")
	for _, event := range []string{"PARTICLE_CREATED", "PARTICLE_FORKED", "BRANCH_JOINED", "JOIN_COMPLETED", "BRANCH_CANCELLED", "PROCESS_CANCELLED"} {
		if !strings.Contains(events, event) {
			t.Fatal("missing semantic event", event)
		}
	}
	capability := schemas["SimulationCapabilities"].(object)["properties"].(object)["parallel"].(object)
	if capability["$ref"] != "#/components/schemas/SimulationParallelCapabilities" {
		t.Fatal("parallel execution must be programmatically discoverable")
	}
	for _, phrase := range []string{"business case", "same", "once", "costs", "structured 422", "16", "64"} {
		if !strings.Contains(parallelSemanticsDescription, phrase) {
			t.Fatal("missing public execution invariant", phrase)
		}
	}
}

func TestParallelDescriptionsDistinguishBusinessPopulationFromBoundedWorkTokens(t *testing.T) {
	schemas := object{}
	addSimulationSchemas(schemas)
	addParallelSimulationSchemas(schemas)
	for _, phrase := range []string{"bounded", "droppedGroups", "nested", "not be treated"} {
		if !strings.Contains(schemas["SimulationParallelState"].(object)["description"].(string), phrase) {
			t.Fatal("group sampling/population ambiguity", phrase)
		}
	}
	if !strings.Contains(schemas["SimulationMetrics"].(object)["description"].(string), "created = completed + abandoned + failed + inSystem") {
		t.Fatal("business population invariant must be explicit")
	}
	if !strings.Contains(schemas["SimulationProcessMetrics"].(object)["description"].(string), "deduplicated") {
		t.Fatal("scope rollups must deduplicate parallel siblings")
	}
	limits := schemas["SimulationExecutionLimits"].(object)["properties"].(object)["activeParticles"].(object)
	if !strings.Contains(limits["description"].(string), "suspended parents") || !strings.Contains(limits["description"].(string), "silently dropped") {
		t.Fatal("no hidden work loss on fan-out limit")
	}
	routes := schemas["SimulationResult"].(object)["properties"].(object)["routeMetrics"].(object)["description"].(string)
	if !strings.Contains(routes, "2,000") || !strings.Contains(routes, "dual 32-bit") || !strings.Contains(routes, "Work revenue") {
		t.Fatal("long route summaries must expose bounds without lost Work attribution")
	}
	aggregation := schemas["SimulationCapabilities"].(object)["properties"].(object)["execution"].(object)["properties"].(object)["routeAggregation"].(object)["properties"].(object)
	if aggregation["exactLabelCharacters"].(object)["enum"].([]int)[0] != 2000 || aggregation["summaryPrefixCharacters"].(object)["enum"].([]int)[0] != 200 {
		t.Fatal("route aggregation discovery must match the bounded engine summary")
	}
}
