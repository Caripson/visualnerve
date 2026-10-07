package main

const processHierarchyMetricsDescription = "A process includes its direct members and every descendant. Parent/child rollups overlap and must not be summed. Distributions come from actual scope observations, never sums of node quantiles. The same global engine and shared resource pools constrain every scope. Only occupied shared-resource cost is allocated to a scope; idle resource capacity, pool scaling and pool investments remain whole-system overhead. Projected process cards and boundary connectors are read-only views, not additional processing nodes, costs or capacity."

func simulationProcessSchema() object {
	definition := strictObject([]string{"id", "name"}, object{
		"id": simID(), "name": object{"type": "string", "minLength": 1},
		"description": object{"type": "string"}, "parentId": simID(),
	})
	definition["description"] = "A semantic subprocess scope. parentId references an existing process; absent means a root. Node membership uses nodes[].processId. Cycles, dangling references, unsupported fields, more than 50,000 scopes or nesting deeper than 128 are rejected with structured 422. " + processHierarchyMetricsDescription
	return definition
}

func addProcessRuntimeSchemas(schemas object, economics object) {
	hierarchyEntry := simProperties(simulationProcessSchema()["properties"].(object), object{
		"childProcessIds": stringList(), "nodeIds": stringList(), "directNodeIds": stringList(),
	})
	schemas["SimulationHierarchyEntry"] = strictObject([]string{"id", "name", "childProcessIds", "nodeIds", "directNodeIds"}, hierarchyEntry)
	schemas["SimulationHierarchyEntry"].(object)["properties"].(object)["nodeIds"].(object)["description"] = "Canonical semantic node IDs belonging directly to this scope or any descendant. directNodeIds includes only immediate members; childProcessIds includes only immediate children."
	schemas["SimulationHierarchy"] = strictObject([]string{"rootProcessIds", "processes"}, object{
		"rootProcessIds": stringList(), "processes": simArray("SimulationHierarchyEntry"),
	})
	schemas["SimulationHierarchy"].(object)["description"] = "Semantic model hierarchy in persisted model order, independent of canvas positions. An older model without processes returns empty roots and records. Inspect model processes CRUD separately from run-specific process metrics."
	schemas["SimulationProcessMetrics"] = strictObject(nil, simProperties(economics, object{
		"id": simID(), "name": object{"type": "string"}, "parentId": simID(),
		"nodeIds": stringList(), "childProcessIds": stringList(), "resourceIds": stringList(),
		"resourceUsage": object{"type": "object", "additionalProperties": simNumber(0)},
		"entered":       simInteger(0), "completed": simInteger(0), "exited": simInteger(0),
		"terminalCompleted": simInteger(0), "abandoned": simInteger(0), "failed": simInteger(0), "inSystem": simInteger(0),
		"throughputPerHour": simNumber(0), "queue": ref("SimulationQueueMetrics"),
		"cycleTime": ref("SimulationDistributionMetrics"), "ttr": ref("SimulationDistributionMetrics"), "processing": ref("SimulationDistributionMetrics"),
		"utilization": simNumber(0), "currentUtilization": simNumber(0),
		"status":            simEnum("idle", "normal", "busy", "saturated", "blocked", "scaling", "failed"),
		"currentBottleneck": object{"type": "string", "nullable": true}, "bottlenecks": simArray("SimulationBottleneck"),
		"resourceCostAllocation": simEnum("occupied-units"),
	}))
	metrics := schemas["SimulationProcessMetrics"].(object)
	metrics["description"] = processHierarchyMetricsDescription
	properties := metrics["properties"].(object)
	properties["completed"].(object)["description"] = "Successful scope visits, including exits into another scope and successful terminal outcomes. Re-entry creates another visit. This is not the whole-system completed-particle count."
	properties["exited"].(object)["description"] = "Successful visits that crossed this scope's boundary and continued elsewhere; a subset of completed."
	properties["terminalCompleted"].(object)["description"] = "Successful final outcomes occurring inside this scope, including descendants."
	properties["cycleTime"] = object{"allOf": []any{ref("SimulationDistributionMetrics")}, "description": "Simulated seconds from each scope entry to successful exit or terminal outcome."}
	properties["ttr"] = object{"allOf": []any{ref("SimulationDistributionMetrics")}, "description": "Simulated seconds from scope entry to a revenue-producing terminal outcome inside the scope."}
	schemas["SimulationProcessMetricsMap"] = simMap("SimulationProcessMetrics")
	schemas["SimulationHierarchyCapabilities"] = strictObject(nil, object{
		"processCollection": simEnum("processes"), "parentField": simEnum("processes[].parentId"), "nodeMembershipField": simEnum("nodes[].processId"),
		"missingProcesses": simEnum("empty-hierarchy"), "maximumProcesses": simInteger(0), "maximumDepth": simInteger(0),
		"execution": simEnum("same-global-engine-and-shared-resource-pools"), "projection": simEnum("read-only-process-cards-and-boundary-edges"),
		"metrics": object{"type": "object", "additionalProperties": object{"type": "string"}, "description": processHierarchyMetricsDescription},
	})
}
