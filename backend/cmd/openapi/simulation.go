package main

func simNumber(min float64) object { return object{"type": "number", "minimum": min} }
func simInteger(min int) object    { return object{"type": "integer", "minimum": min} }
func simID() object {
	return object{"type": "string", "minLength": 1, "maxLength": 300, "description": "Stable semantic ID. Node/edge IDs returned by a saved document are canonical graph UUIDs; resource, particle type and scenario IDs may be readable strings."}
}
func simArray(name string) object     { return object{"type": "array", "items": ref(name)} }
func simMap(name string) object       { return object{"type": "object", "additionalProperties": ref(name)} }
func simEnum(values ...string) object { return object{"type": "string", "enum": values} }

// OpenAPI 3.0 references ignore sibling nullable flags. A null-only alternative
// keeps the referenced complete/partial value intact while describing JSON Merge Patch.
func simNullable(value any) object {
	return object{"oneOf": []any{value, object{"type": "object", "nullable": true, "enum": []any{nil}}}}
}
func simPartial(definition object) object {
	result := clone(definition)
	delete(result, "required")
	if properties, ok := result["properties"].(object); ok {
		for key, raw := range properties {
			if key == "id" || key == "type" {
				continue
			}
			property := raw.(object)
			if property["type"] == "object" {
				property = simPartial(property)
			}
			properties[key] = simNullable(property)
		}
	}
	if additional, ok := result["additionalProperties"].(object); ok {
		result["additionalProperties"] = simNullable(additional)
	}
	return result
}
func simProperties(base object, extra object) object {
	result := object{}
	for k, v := range base {
		result[k] = v
	}
	for k, v := range extra {
		result[k] = v
	}
	return result
}
func addSimulationSchemas(schemas object) {
	schemas["SimulationSchedule"] = strictObject([]string{"startSeconds", "endSeconds"}, object{
		"startSeconds": simNumber(0), "endSeconds": simNumber(0), "repeatSeconds": simNumber(0),
	})
	schemas["SimulationSchedule"].(object)["description"] = "Availability window in simulated seconds. endSeconds must follow startSeconds. Optional repeatSeconds is at least endSeconds and repeats the window; 0–43200 with repeatSeconds:86400 models daily twelve-hour opening. Omitting repeatSeconds makes a single window."
	schemas["SimulationScaling"] = strictObject([]string{"maxCapacity"}, object{
		"minCapacity": simInteger(0), "maxCapacity": simInteger(0), "increment": simInteger(1),
		"queueAbove": simNumber(0), "utilizationAbove": object{"type": "number", "minimum": 0, "maximum": 1},
		"utilizationBelow":      object{"type": "number", "minimum": 0, "maximum": 1},
		"scaleDownAfterSeconds": simNumber(0), "cooldownSeconds": simNumber(0),
		"startupSeconds": simNumber(0), "shutdownSeconds": simNumber(0),
		"scaleUpCost": simNumber(0), "additionalCostPerHour": simNumber(0),
	})
	schemas["SimulationScaling"].(object)["properties"].(object)["additionalCostPerHour"].(object)["description"] = "Hourly surcharge per automatically added capacity unit, in addition to that unit's regular Work/resource costPerHour. This surcharge accrues continuously while capacity remains above its initial level, including closed/idle periods, until scaling removes those extra units."
	schemas["SimulationParticleType"] = strictObject([]string{"id", "name", "color", "revenue", "complexity", "priority"}, object{
		"id": simID(), "name": object{"type": "string", "minLength": 1}, "color": object{"type": "string"},
		"shape": simEnum("circle", "square", "triangle"), "revenue": simNumber(0),
		"complexity": strictObject([]string{"min", "max"}, object{"min": simNumber(0.000001), "max": simNumber(0.000001)}),
		"priority":   simNumber(0), "patienceSeconds": simNumber(0),
		"metadata":   object{"type": "object", "additionalProperties": true},
		"attributes": object{"type": "object", "additionalProperties": object{"oneOf": []any{object{"type": "string"}, object{"type": "number"}, object{"type": "boolean"}}}},
	})
	schemas["SimulationSource"] = strictObject([]string{"particleTypeId"}, object{
		"particleTypeId": simID(), "ratePerHour": simNumber(0), "burst": simInteger(0), "maxCount": simInteger(0),
		"distribution": simEnum("regular", "poisson"), "schedule": simArray("SimulationSchedule"), "startSeconds": simNumber(0),
	})
	schemas["SimulationResourceRequirement"] = strictObject([]string{"resourceId", "units"}, object{"resourceId": simID(), "units": simNumber(0.000001)})
	schemas["SimulationWork"] = strictObject([]string{"processingSeconds", "capacity"}, object{
		"processingSeconds": simNumber(0.001), "capacity": simInteger(0), "costPerHour": simNumber(0), "costPerParticle": simNumber(0),
		"queueLimit": simInteger(0), "queueDiscipline": simEnum("fifo", "priority"), "resourceRequirements": simArray("SimulationResourceRequirement"),
		"complexityMultiplier": simNumber(0), "acceptedParticleTypeIds": stringList(), "overflowNodeId": simID(),
		"scaling": ref("SimulationScaling"), "schedule": simArray("SimulationSchedule"),
	})
	schemas["SimulationWork"].(object)["properties"].(object)["costPerHour"].(object)["description"] = "Operating cost per available processing-capacity unit per simulated hour, including scheduled idle time and active processing overtime outside availability. Total hourly cost scales with available capacity; automatically added units also incur any additionalCostPerHour surcharge."
	schemas["SimulationRoutingCondition"] = strictObject([]string{"field", "operator", "value"}, object{
		"field":    simEnum("particleTypeId", "complexity", "priority", "revenue", "attribute", "queue", "availableCapacity", "utilization"),
		"operator": simEnum("eq", "neq", "gt", "gte", "lt", "lte"),
		"value":    object{"oneOf": []any{object{"type": "string"}, object{"type": "number"}, object{"type": "boolean"}}},
		"key":      object{"type": "string"}, "nodeId": simID(), "resourceId": simID(),
	})
	schemas["SimulationRoutingRule"] = strictObject([]string{"edgeId"}, object{"edgeId": simID(), "condition": ref("SimulationRoutingCondition"), "weight": simNumber(0)})
	schemas["SimulationRouter"] = strictObject([]string{"mode"}, object{
		"mode": simEnum("first-match", "weighted", "least-queue", "available-capacity"), "rules": simArray("SimulationRoutingRule"), "fallbackEdgeId": simID(),
	})
	schemas["SimulationOutcome"] = strictObject([]string{"status", "revenue"}, object{"status": simEnum("completed", "failed", "rejected"), "revenue": object{"type": "boolean"}, "revenueOverride": simNumber(0)})
	nodeBase := object{"id": simID(), "name": object{"type": "string", "minLength": 1}, "description": object{"type": "string"}, "metadata": object{"type": "object", "additionalProperties": true}}
	variants := []any{}
	for _, v := range []struct{ kind, field, schema string }{
		{"source", "source", "SimulationSource"}, {"work", "work", "SimulationWork"},
		{"router", "router", "SimulationRouter"}, {"resource", "resourceId", ""}, {"outcome", "outcome", "SimulationOutcome"},
	} {
		properties := simProperties(nodeBase, object{"type": simEnum(v.kind)})
		if v.schema == "" {
			properties[v.field] = simID()
		} else {
			properties[v.field] = ref(v.schema)
		}
		name := "Simulation" + map[string]string{"source": "SourceNode", "work": "WorkNode", "router": "RouterNode", "resource": "ResourceNode", "outcome": "OutcomeNode"}[v.kind]
		schemas[name] = strictObject([]string{"id", "name", "type", v.field}, properties)
		variants = append(variants, ref(name))
	}
	schemas["SimulationNode"] = object{"oneOf": variants, "discriminator": object{"propertyName": "type"}}
	schemas["SimulationEdge"] = strictObject([]string{"id", "sourceNodeId", "targetNodeId"}, object{
		"id": simID(), "sourceNodeId": simID(), "targetNodeId": simID(), "travelSeconds": simNumber(0), "particleTypeIds": stringList(), "weight": simNumber(0),
	})
	schemas["SimulationResource"] = strictObject([]string{"id", "name", "capacity", "unit"}, object{
		"id": simID(), "name": object{"type": "string", "minLength": 1}, "capacity": simInteger(0), "unit": object{"type": "string"},
		"minCapacity": simInteger(0), "maxCapacity": simInteger(0), "costPerHour": simNumber(0),
		"schedule": simArray("SimulationSchedule"), "scaling": ref("SimulationScaling"), "metadata": object{"type": "object", "additionalProperties": true},
	})
	schemas["SimulationResource"].(object)["properties"].(object)["costPerHour"].(object)["description"] = "Operating cost per available shared-resource capacity unit per simulated hour, including scheduled idle time and units actively allocated overtime outside availability. Total cost scales with available capacity; automatically added units also incur any additionalCostPerHour surcharge."
	schemas["SimulationResource"].(object)["properties"].(object)["minCapacity"].(object)["description"] = "Resource capacity floor, also used by automatic scaling when scaling.minCapacity is omitted. An explicit scaling minimum cannot be below this floor."
	schemas["SimulationImprovement"] = strictObject([]string{"id", "name", "enabled", "investmentCost"}, object{
		"id": simID(), "name": object{"type": "string", "minLength": 1}, "enabled": object{"type": "boolean"},
		"nodeId": simID(), "resourceId": simID(), "investmentCost": simNumber(0), "operatingCostPerHour": simNumber(0),
		"processingTimeMultiplier": simNumber(0.000001), "resourceUnitsMultiplier": simNumber(0.000001), "capacityIncrease": simInteger(0),
		"costMultiplier": simNumber(0.000001), "revenueMultiplier": simNumber(0.000001), "failureProbability": object{"type": "number", "minimum": 0, "maximum": 1}, "failureNodeId": simID(),
	})
	schemas["SimulationImprovement"].(object)["description"] = "Requires a valid Work/Outcome nodeId or resourceId. Enabled capacity increments must remain within configured maximums. Outcome targets accept revenue/economic effects only, rejecting non-neutral processing/resource/cost multipliers, capacity increments and failure effects. Failure routing requires a valid outgoing particle-flow edge from every affected Work node. Resource-target capacity and cost modifiers affect only that resource; its resourceUnitsMultiplier applies only to that resource requirement on consuming Work nodes, preserving other resources such as counters."
	improvementProperties := schemas["SimulationImprovement"].(object)["properties"].(object)
	improvementProperties["nodeId"].(object)["description"] = "Existing Work or Outcome node ID. A Work-target resourceUnitsMultiplier applies to that Work node's resource requirements."
	improvementProperties["resourceId"].(object)["description"] = "Existing shared resource ID. Capacity/cost modifiers and resource-unit reduction apply only to this target; processing/revenue/failure effects apply to Work nodes that consume it."
	improvementProperties["processingTimeMultiplier"].(object)["description"] = "Positive processing duration factor: 0.65 takes 65% of the original time. A resource-target factor affects Work nodes using that resource."
	improvementProperties["resourceUnitsMultiplier"].(object)["description"] = "Positive allocation factor. A resource-target improvement changes only units required from that resource, while a Work-target improvement changes the Work node's requirements."
	improvementProperties["costMultiplier"].(object)["description"] = "Positive cost factor scoped to the target. Resource-target changes its hourly cost; Work-target changes its hourly and per-item operating costs."
	improvementProperties["capacityIncrease"].(object)["description"] = "Nonnegative integer increase for the target Work or resource, counted once and bounded by its maximum capacity."
	improvementProperties["revenueMultiplier"].(object)["description"] = "Positive revenue factor. Work/resource effects change carried expected revenue at processing completion, including future lost revenue; Outcome effects apply at completion and align expected and realized revenue."
	// Typed scenario changes retain complete semantic accessibility without arbitrary JSON paths.
	partialNode := simProperties(nodeBase, object{"type": simEnum("source", "work", "router", "resource", "outcome"), "source": ref("SimulationSourcePartial"), "work": ref("SimulationWorkPartial"), "router": ref("SimulationRouterPartial"), "resourceId": simID(), "outcome": ref("SimulationOutcomePartial")})
	schemas["SimulationNodeOverride"] = simPartial(strictObject(nil, partialNode))
	for _, name := range []string{"Source", "Work", "Router", "Outcome"} {
		schemas["Simulation"+name+"Partial"] = simPartial(schemas["Simulation"+name].(object))
	}
	schemas["SimulationScalingPartial"] = simPartial(schemas["SimulationScaling"].(object))
	schemas["SimulationWorkPartial"].(object)["properties"].(object)["scaling"] = simNullable(ref("SimulationScalingPartial"))
	for _, name := range []string{"Edge", "ParticleType", "Resource", "Improvement"} {
		schemas["Simulation"+name+"Override"] = simPartial(schemas["Simulation"+name].(object))
	}
	schemas["SimulationResourceOverride"].(object)["properties"].(object)["scaling"] = simNullable(ref("SimulationScalingPartial"))
	schemas["SimulationEconomicsOverride"] = simPartial(strictObject(nil, object{"maximumBudget": simNumber(0)}))
	schemas["SimulationScenarioOverrides"] = strictObject(nil, object{
		"nodes": simMap("SimulationNodeOverride"), "edges": simMap("SimulationEdgeOverride"),
		"particleTypes": simMap("SimulationParticleTypeOverride"), "resources": simMap("SimulationResourceOverride"), "improvements": simMap("SimulationImprovementOverride"), "economics": simNullable(ref("SimulationEconomicsOverride")),
	})
	schemas["SimulationScenarioOverrides"].(object)["description"] = "Typed JSON Merge Patch overrides keyed by stable semantic IDs. In entity/economics patches, null removes the inherited property and arrays replace complete values. Required properties, entity IDs and node types cannot be removed; each resolved scenario is validated. Null markers persist in native JSON, IndexedDB and API reads without mutating Baseline."
	schemas["SimulationScenario"] = strictObject([]string{"id", "name", "overrides"}, object{
		"id": simID(), "name": object{"type": "string", "minLength": 1}, "description": object{"type": "string"}, "demandMultiplier": simNumber(0), "overrides": ref("SimulationScenarioOverrides"),
	})
	schemas["SimulationDefaults"] = strictObject([]string{"durationSeconds", "seed"}, object{"durationSeconds": object{"type": "number", "minimum": 0.001, "maximum": 315360000}, "seed": simInteger(0)})
	schemas["SimulationEconomics"] = strictObject(nil, object{"maximumBudget": simNumber(0)})
	schemas["SimulationRetention"] = strictObject(nil, object{"particles": simInteger(0), "events": simInteger(0), "checkpoints": simInteger(0)})
	schemas["SimulationRetention"].(object)["properties"].(object)["checkpoints"].(object)["description"] = "Retained local checkpoints per run, capped at 240; omitted defaults to 240. Zero stores none, one keeps the latest checkpoint, and two or more retain a thinned set including endpoints. Replay can reconstruct from immutable inputs independently of checkpoint retention."
	schemas["SimulationModel"] = strictObject([]string{"type", "schemaVersion", "currency", "particleTypes", "nodes", "edges", "resources", "improvements", "scenarios", "defaults"}, object{
		"type": simEnum("process-simulator"), "schemaVersion": object{"type": "integer", "enum": []int{1}}, "currency": object{"type": "string", "pattern": "^[A-Z]{3}$"},
		"particleTypes": simArray("SimulationParticleType"), "nodes": simArray("SimulationNode"), "edges": simArray("SimulationEdge"),
		"resources": simArray("SimulationResource"), "improvements": simArray("SimulationImprovement"), "scenarios": simArray("SimulationScenario"),
		"defaults": ref("SimulationDefaults"), "economics": ref("SimulationEconomics"), "retention": ref("SimulationRetention"), "description": object{"type": "string"},
	})
	schemas["SimulationModel"].(object)["description"] = "Authoritative local-first process model. Time/duration/delays use simulated seconds; rates and operating costs use per-hour units in one configurable model currency. Processing/resource dependencies are semantic, independent of canvas layout. A process-simulator Graph requires this payload; other document types must not acquire it implicitly. Node and edge semantic IDs are canonicalized to graph UUIDs on save; aliases are retained as native externalId."
	schemas["SimulationModel"].(object)["properties"].(object)["nodes"].(object)["maxItems"] = 50000
	schemas["SimulationModel"].(object)["properties"].(object)["edges"].(object)["maxItems"] = 200000
	schemas["SimulationModelUpdate"] = versionedInput("model", "SimulationModel")
	for _, name := range []string{"Node", "Edge", "ParticleType", "Resource", "Improvement", "Scenario", "Economics", "Defaults", "Retention"} {
		schemas["Simulation"+name+"Update"] = versionedInput("value", "Simulation"+name)
		if name == "Node" {
			schemas["SimulationNodePatchValue"] = clone(schemas["SimulationNodeOverride"].(object))
			schemas["SimulationNodePatch"] = versionedInput("value", "SimulationNodePatchValue")
		} else if name != "Economics" && name != "Defaults" && name != "Retention" {
			definition := simPartial(schemas["Simulation"+name].(object))
			if override, ok := schemas["Simulation"+name+"Override"].(object); ok {
				definition = clone(override)
			}
			schemas["Simulation"+name+"PatchValue"] = definition
			schemas["Simulation"+name+"Patch"] = versionedInput("value", "Simulation"+name+"PatchValue")
		}
	}
	schemas["SimulationRunInput"] = strictObject(nil, object{
		"durationSeconds": object{"type": "number", "minimum": 0, "exclusiveMinimum": true, "maximum": 315360000}, "seed": simInteger(0),
		"scenarioId": simID(), "demandMultiplier": simNumber(0), "untilComplete": object{"type": "boolean"},
		"speed": object{"oneOf": []any{object{"type": "integer", "enum": []int{1, 10, 100}}, simEnum("max")}}, "animated": object{"type": "boolean"},
	})
	schemas["SimulationRunInput"].(object)["description"] = "Asynchronous immutable seeded run. Omitted seed/duration use model.defaults. animated:false forces MAX without animation; the connected browser remains required for IndexedDB and local worker execution. untilComplete stops arrivals at durationSeconds and drains remaining finite work, so the actual completion timestamp may exceed that arrival horizon. Speed never changes the deterministic business result."
	schemas["SimulationEmptyCommand"] = strictObject(nil, object{})
	schemas["SimulationSeek"] = strictObject([]string{"timeSeconds"}, object{"timeSeconds": simNumber(0)})
	schemas["SimulationSpeedInput"] = strictObject([]string{"speed"}, object{"speed": object{"oneOf": []any{object{"type": "integer", "enum": []int{1, 10, 100}}, simEnum("max")}}})
	schemas["SimulationCompareInput"] = strictObject([]string{"runIds"}, object{"runIds": object{"type": "array", "minItems": 2, "maxItems": 20, "uniqueItems": true, "items": object{"type": "string", "format": "uuid"}}})
	addSimulationRuntimeSchemas(schemas)
}

func addSimulationRuntimeSchemas(schemas object) {
	schemas["SimulationDistributionMetrics"] = strictObject([]string{"count", "average", "median", "p50", "p95", "p99", "maximum", "approximate", "resolutionSeconds"}, object{
		"count": simInteger(0), "average": simNumber(0), "median": simNumber(0), "p50": simNumber(0),
		"p95": object{"type": "number", "nullable": true}, "p99": object{"type": "number", "nullable": true},
		"maximum": simNumber(0), "approximate": object{"type": "boolean"}, "resolutionSeconds": simNumber(0),
	})
	schemas["SimulationDistributionMetrics"].(object)["description"] = "Simulation-timestamp distribution in seconds. P95/P99 may be null when sample counts are insufficient. Bounded histogram approximation explicitly reports its resolution and approximate flag."
	schemas["SimulationQueueMetrics"] = strictObject([]string{"current", "average", "maximum", "wait"}, object{"current": simInteger(0), "average": simNumber(0), "maximum": simInteger(0), "wait": ref("SimulationDistributionMetrics")})
	economics := object{}
	for _, name := range []string{"expectedRevenue", "realizedRevenue", "operatingCost", "resourceCost", "scalingCost", "investmentCost", "cost", "contribution", "cumulativeCashImpact", "lostRevenue"} {
		economics[name] = object{"type": "number"}
	}
	schemas["SimulationMetrics"] = strictObject(nil, simProperties(economics, object{
		"created": simInteger(0), "completed": simInteger(0), "abandoned": simInteger(0), "failed": simInteger(0), "inSystem": simInteger(0),
		"throughputPerHour": simNumber(0), "queue": ref("SimulationQueueMetrics"), "ttr": ref("SimulationDistributionMetrics"),
		"cycleTime": ref("SimulationDistributionMetrics"), "processing": ref("SimulationDistributionMetrics"), "currentBottleneck": object{"type": "string", "nullable": true},
	}))
	schemas["SimulationNodeMetrics"] = strictObject(nil, simProperties(economics, object{
		"id": simID(), "type": simEnum("source", "work", "router", "resource", "outcome"), "name": object{"type": "string"},
		"capacity": simInteger(0), "maximumCapacity": simInteger(0), "busy": simNumber(0), "utilization": simNumber(0), "currentUtilization": simNumber(0),
		"queue": ref("SimulationQueueMetrics"), "started": simInteger(0), "completed": simInteger(0), "abandoned": simInteger(0), "throughputPerHour": simNumber(0),
		"status": simEnum("idle", "normal", "busy", "saturated", "blocked", "scaling", "failed"), "resourceUsage": object{"type": "object", "additionalProperties": simNumber(0)},
	}))
	schemas["SimulationResourceMetrics"] = strictObject(nil, object{
		"id": simID(), "name": object{"type": "string"}, "capacity": simInteger(0), "maximumCapacity": simInteger(0), "busy": simNumber(0),
		"utilization": simNumber(0), "currentUtilization": simNumber(0), "queue": ref("SimulationQueueMetrics"), "cost": simNumber(0),
		"scalingCost": simNumber(0), "waitingNodeIds": stringList(),
	})
	schemas["SimulationNodeMetricsMap"] = simMap("SimulationNodeMetrics")
	schemas["SimulationResourceMetricsMap"] = simMap("SimulationResourceMetrics")
	schemas["SimulationParticleTypeMetrics"] = strictObject(nil, simProperties(economics, object{
		"id": simID(), "name": object{"type": "string"}, "created": simInteger(0), "completed": simInteger(0), "abandoned": simInteger(0), "failed": simInteger(0), "inSystem": simInteger(0),
		"wait": ref("SimulationDistributionMetrics"), "ttr": ref("SimulationDistributionMetrics"), "cycleTime": ref("SimulationDistributionMetrics"),
	}))
	schemas["SimulationParticleTypeMetricsMap"] = simMap("SimulationParticleTypeMetrics")
	schemas["SimulationParticleSnapshot"] = strictObject(nil, object{
		"id": simInteger(0), "typeId": simID(), "createdAtSeconds": simNumber(0), "nodeId": simID(), "status": simEnum("queued", "processing", "transit", "completed", "abandoned", "failed"),
		"complexity": simNumber(0), "priority": object{"type": "number"}, "expectedRevenue": object{"type": "number"}, "realizedRevenue": object{"type": "number"},
		"accumulatedCost": simNumber(0), "waitingSeconds": simNumber(0), "processingSeconds": simNumber(0),
		"queueEnteredAtSeconds": simNumber(0), "processingStartedAtSeconds": simNumber(0), "processingEndsAtSeconds": simNumber(0), "completedAtSeconds": simNumber(0), "timeToRevenueSeconds": simNumber(0),
		"pendingAdmission": object{"type": "boolean", "description": "The particle has reached a Work node at the current timestamp and awaits the shared same-time admission batch; this is real engine state, before resource acquisition/processing."},
		"edgeId":           simID(), "departedAtSeconds": simNumber(0), "arrivesAtSeconds": simNumber(0),
		"history": object{"type": "array", "items": strictObject([]string{"nodeId", "enteredAtSeconds"}, object{"nodeId": simID(), "enteredAtSeconds": simNumber(0), "leftAtSeconds": simNumber(0)})},
	})
	schemas["SimulationEvent"] = strictObject([]string{"sequence", "timeSeconds", "type"}, object{
		"sequence": simInteger(0), "timeSeconds": simNumber(0), "type": simEnum("PARTICLE_CREATED", "QUEUE_ENTERED", "QUEUE_LEFT", "PROCESS_STARTED", "PROCESS_COMPLETED", "RESOURCE_ACQUIRED", "RESOURCE_RELEASED", "PARTICLE_ROUTED", "PARTICLE_ABANDONED", "PARTICLE_FAILED", "CAPACITY_SCALE_UP", "CAPACITY_SCALE_DOWN", "REVENUE_REALIZED", "COST_INCURRED", "SIMULATION_COMPLETED"),
		"particleId": simInteger(0), "particleTypeId": simID(), "nodeId": simID(), "resourceId": simID(), "edgeId": simID(),
		"amount": object{"type": "number"}, "capacity": simInteger(0), "previousCapacity": simInteger(0), "reason": object{"type": "string"},
	})
	schemas["SimulationBottleneck"] = strictObject(nil, object{
		"id": simID(), "kind": simEnum("node", "resource"), "name": object{"type": "string"}, "score": simNumber(0), "utilization": simNumber(0),
		"averageQueue": simNumber(0), "averageWaitSeconds": simNumber(0), "reason": object{"type": "string"},
	})
	stateProps := object{
		"timeSeconds": simNumber(0), "status": simEnum("ready", "running", "paused", "stopped", "completed", "failed"), "metrics": ref("SimulationMetrics"),
		"nodes": simMap("SimulationNodeMetrics"), "resources": simMap("SimulationResourceMetrics"), "particleTypes": simMap("SimulationParticleTypeMetrics"),
		"particles": simArray("SimulationParticleSnapshot"), "events": simArray("SimulationEvent"), "bottlenecks": simArray("SimulationBottleneck"),
		"retained": strictObject([]string{"activeParticles", "completedParticles", "events", "droppedEvents"}, object{"activeParticles": simInteger(0), "completedParticles": simInteger(0), "events": simInteger(0), "droppedEvents": simInteger(0)}), "message": object{"type": "string"},
	}
	schemas["SimulationState"] = strictObject(nil, stateProps)
	schemas["SimulationCashPoint"] = strictObject(nil, object{
		"timeSeconds": simNumber(0), "revenue": object{"type": "number"}, "operatingCost": simNumber(0),
		"operatingCostFixed": object{"type": "number", "minimum": 0, "description": "Cumulative per-item operating charges, which jump at their event timestamps. Other operating costs accrue continuously; payback comparison preserves this distinction."},
		"resourceCost":       simNumber(0), "scalingCost": simNumber(0), "investmentCost": simNumber(0),
	})
	schemas["SimulationResult"] = strictObject(nil, simProperties(stateProps, object{
		"runId": object{"type": "string", "format": "uuid"}, "durationSeconds": simNumber(0), "seed": simInteger(0), "scenarioId": object{"type": "string", "nullable": true},
		"demandMultiplier": simNumber(0), "modelHash": object{"type": "string"}, "completedAtSeconds": object{"type": "number", "nullable": true},
		"finalCapacities": object{"type": "object", "additionalProperties": simInteger(0)},
		"routeMetrics":    object{"type": "object", "additionalProperties": strictObject(nil, object{"count": simInteger(0), "ttr": ref("SimulationDistributionMetrics"), "cycleTime": ref("SimulationDistributionMetrics")})},
		"cashTimeline":    simArray("SimulationCashPoint"), "retention": strictObject(nil, object{"particleLimit": simInteger(0), "eventLimit": simInteger(0), "cashPointResolutionSeconds": simNumber(0)}),
	}))
	schemas["SimulationRunInfo"] = strictObject(nil, object{
		"id": object{"type": "string", "format": "uuid"}, "diagramId": object{"type": "string", "format": "uuid"},
		"status": stateProps["status"], "options": object{"type": "object", "additionalProperties": true, "description": "Frozen normalized run options, including runId, seed, durationSeconds and playback speed."},
		"model": ref("SimulationModel"), "createdAt": object{"type": "string", "format": "date-time"}, "updatedAt": object{"type": "string", "format": "date-time"}, "result": ref("SimulationResult"), "error": object{"type": "string"},
	})
	schemas["SimulationRunSummary"] = strictObject(nil, object{
		"id": object{"type": "string", "format": "uuid"}, "diagramId": object{"type": "string", "format": "uuid"}, "status": stateProps["status"], "options": object{"type": "object", "additionalProperties": true},
		"createdAt": object{"type": "string", "format": "date-time"}, "updatedAt": object{"type": "string", "format": "date-time"}, "metrics": ref("SimulationMetrics"), "error": object{"type": "string"},
	})
	schemas["SimulationEventPage"] = strictObject(nil, object{"events": simArray("SimulationEvent"), "offset": simInteger(0), "limit": simInteger(1), "retained": simInteger(0), "dropped": simInteger(0)})
	schemas["SimulationComparison"] = strictObject(nil, object{
		"baselineRunId": object{"type": "string", "format": "uuid"}, "scenarioRunId": object{"type": "string", "format": "uuid"}, "baseline": ref("SimulationMetrics"), "scenario": ref("SimulationMetrics"),
		"delta": object{"type": "object", "additionalProperties": object{"type": "number"}}, "incrementalCashImpact": object{"type": "number"}, "paybackTimeSeconds": object{"type": "number", "nullable": true},
		"paybackReached": object{"type": "boolean"}, "comparable": object{"type": "boolean"}, "warnings": stringList(),
	})
	schemas["SimulationComparisonResult"] = strictObject([]string{"baselineRunId", "comparisons"}, object{"baselineRunId": object{"type": "string", "format": "uuid"}, "comparisons": simArray("SimulationComparison")})
	schemas["SimulationExecutionLimits"] = strictObject([]string{"activeParticles", "semanticEvents", "routeVisits", "activeRuns", "cachedRuns"}, object{
		"activeParticles": object{"type": "integer", "enum": []int{200000}}, "semanticEvents": object{"type": "integer", "enum": []int{50000000}, "description": "Execution ceiling counting scheduled internal events as well as emitted semantic events; exceeding it fails explicitly with partial results."},
		"routeVisits": object{"type": "integer", "enum": []int{10000}}, "activeRuns": object{"type": "integer", "enum": []int{4}, "description": "Shared ceiling for resident execution and transient replay workers, including paused workers and synchronous startup reservations. Concurrent external starts/seeks beyond this ceiling return 409 before another worker starts."}, "cachedRuns": object{"type": "integer", "enum": []int{60}},
	})
	schemas["SimulationVisualCapacity"] = strictObject([]string{"view", "representation", "readOnly", "sharedLogicalModel", "persistentUnitIdentity", "occupancy", "queueDisplay", "limits", "overflow", "spatialView"}, object{
		"view": simEnum("2d"), "representation": simEnum("full-native-cards"),
		"readOnly": object{"type": "boolean", "enum": []bool{true}}, "sharedLogicalModel": object{"type": "boolean", "enum": []bool{true}},
		"persistentUnitIdentity": object{"type": "boolean", "enum": []bool{false}},
		"occupancy":              simEnum("actual-aggregate-busy"), "queueDisplay": simEnum("shared-at-first-card"),
		"limits":   strictObject([]string{"cardsPerBank", "additionalCards"}, object{"cardsPerBank": object{"type": "integer", "enum": []int{8}}, "additionalCards": object{"type": "integer", "enum": []int{256}}}),
		"overflow": simEnum("explicit-aggregate-label"), "spatialView": simEnum("logical-model"),
	})
	schemas["SimulationVisualCapacity"].(object)["description"] = "Live 2D capacity is a read-only runtime projection using full native cards, such as Counter 1/2/3. Ordinals identify anonymous capacity units sharing one logical Work/Resource ID, model and queue; they are not persistent named-worker identities or independent process nodes. Actual aggregate busy capacity drives occupancy. Limits bound visual cards only; omitted units remain simulated and have explicit aggregate labels. 3D keeps the logical model."
	schemas["SimulationCapabilities"] = object{
		"type": "object", "additionalProperties": true,
		"description": "Machine-readable type/schema/API version, seconds and currency conventions, supported node/routing/queue/scaling operations, execution requirements, permissions and bounded retention/transport limits.",
		"properties": object{"visualCapacity": ref("SimulationVisualCapacity"), "execution": strictObject([]string{"browserRequired", "activeCanvasRequired", "animationRequired", "limits", "limitBehavior"}, object{
			"browserRequired": object{"type": "boolean"}, "activeCanvasRequired": object{"type": "boolean"}, "animationRequired": object{"type": "boolean"}, "limits": ref("SimulationExecutionLimits"),
			"limitBehavior": strictObject([]string{"activeParticlesAndEvents", "routeVisits", "activeRuns"}, object{"activeParticlesAndEvents": object{"type": "string"}, "routeVisits": object{"type": "string"}, "activeRuns": object{"type": "string"}}),
		})},
	}
	schemas["SimulationQueues"] = strictObject(nil, object{"nodes": simMap("SimulationQueueMetrics"), "resources": simMap("SimulationQueueMetrics")})
	schemas["SimulationModelRecord"] = strictObject([]string{"diagramId", "diagramVersion", "model"}, object{"diagramId": object{"type": "string", "format": "uuid"}, "diagramVersion": simInteger(1), "model": ref("SimulationModel")})
	schemas["SimulationCheckpointRecord"] = strictObject([]string{"id", "runId", "diagramId", "timeSeconds", "state"}, object{"id": object{"type": "string"}, "runId": object{"type": "string", "format": "uuid"}, "diagramId": object{"type": "string", "format": "uuid"}, "timeSeconds": simNumber(0), "state": ref("SimulationState")})
}

func addSimulationPaths(add func(string, string, string, string, string, string), paths object) {
	base := "/diagrams/{diagramId}/simulation"
	add("GET", "/simulation/capabilities", "Discover Process Simulator semantic schema, units, capabilities and execution requirements", "", "SimulationCapabilities", "200")
	add("GET", base, "Read complete authoritative semantic simulation model", "", "SimulationModel", "200")
	add("PUT", base, "Replace and validate semantic model atomically at baseVersion; synchronize native canvas", "SimulationModelUpdate", "Graph", "200")
	for collection, name := range map[string]string{"nodes": "Node", "edges": "Edge", "particle-types": "ParticleType", "resources": "Resource", "improvements": "Improvement", "scenarios": "Scenario"} {
		path := base + "/" + collection
		add("GET", path, "Read semantic "+collection, "", "Simulation"+name+"[]", "200")
		add("POST", path, "Create semantic "+collection+" at baseVersion", "Simulation"+name+"Update", "Graph", "201")
		entity := path + "/{entityId}"
		add("GET", entity, "Read semantic simulation entity", "", "Simulation"+name, "200")
		add("PATCH", entity, "JSON Merge Patch entity at baseVersion; null removes optional properties, arrays replace, scenario override null markers persist, identity stays stable", "Simulation"+name+"Patch", "Graph", "200")
		add("DELETE", entity, "Delete semantic entity at baseVersion query; referenced-resource deletions fail validation", "", "", "204")
		op := paths[entity].(object)["delete"].(object)
		parameters, _ := op["parameters"].([]any)
		op["parameters"] = append(parameters, object{"name": "baseVersion", "in": "query", "required": true, "schema": simInteger(1)})
	}
	for field, name := range map[string]string{"economics": "Economics", "defaults": "Defaults", "retention": "Retention"} {
		add("GET", base+"/"+field, "Read semantic simulation "+field, "", "Simulation"+name, "200")
		add("PUT", base+"/"+field, "Replace simulation "+field+" at baseVersion", "Simulation"+name+"Update", "Graph", "200")
	}
	runs := base + "/runs"
	add("GET", runs, "List separately identifiable local runs and summary metrics", "", "SimulationRunSummary[]", "200")
	add("POST", runs, "Start asynchronous seeded worker run; animation-independent correctness, write access required", "SimulationRunInput", "SimulationRunInfo", "201")
	run := runs + "/{runId}"
	add("GET", run, "Read frozen input, options and run progress/result", "", "SimulationRunInfo", "200")
	for path, name := range map[string]string{"state": "State", "result": "Result", "metrics": "Metrics", "queues": "Queues"} {
		add("GET", run+"/"+path, "Inspect actual simulation "+path, "", "Simulation"+name, "200")
	}
	add("GET", run+"/bottlenecks", "Read emergent ranked node/resource constraints", "", "SimulationBottleneck[]", "200")
	for path, name := range map[string]string{"nodes": "NodeMetrics", "resources": "ResourceMetrics", "particle-types": "ParticleTypeMetrics"} {
		mapName := "Simulation" + name + "Map"
		add("GET", run+"/"+path, "Read complete semantic "+path+" metrics map", "", mapName, "200")
		add("GET", run+"/"+path+"/{entityId}", "Read live semantic entity metrics", "", "Simulation"+name, "200")
	}
	add("GET", run+"/events", "Read bounded semantic events with explicit dropped count", "", "SimulationEventPage", "200")
	addQuery(paths, run+"/events", "offset", simInteger(0), false)
	addQuery(paths, run+"/events", "limit", object{"type": "integer", "minimum": 1, "maximum": 1000, "default": 100}, false)
	for _, action := range []string{"pause", "resume", "stop", "reset"} {
		add("POST", run+"/"+action, "Control same authoritative run: "+action+"; reset starts a new run and preserves results", "SimulationEmptyCommand", "SimulationRunInfo", "200")
	}
	add("POST", run+"/seek", "Replay paused/completed run deterministically; shared resident worker ceiling and current external write grant apply", "SimulationSeek", "SimulationState", "200")
	add("POST", run+"/speed", "Set live pacing without changing deterministic business inputs", "SimulationSpeedInput", "SimulationRunInfo", "200")
	add("POST", base+"/compare", "Read-only compare 2..20 document runs, whole-system deltas and observed incremental payback", "SimulationCompareInput", "SimulationComparisonResult", "200")
	// Common routes normally use UUIDs; semantic entity IDs may be readable names.
	for path, raw := range paths {
		if path != "/simulation/capabilities" && (len(path) < len(base) || path[:len(base)] != base) {
			continue
		}
		for _, rawOp := range raw.(object) {
			op := rawOp.(object)
			if responses, ok := op["responses"].(object); ok {
				for code := range simulationResponses() {
					status := code[len("SimulationError"):]
					if responses[status] != nil {
						responses[status] = object{"$ref": "#/components/responses/" + code}
					}
				}
			}
			parameters, _ := op["parameters"].([]any)
			for _, rawParameter := range parameters {
				parameter := rawParameter.(object)
				if parameter["name"] == "entityId" {
					parameter["schema"] = simID()
				}
			}
		}
	}
}

func simulationResponses() object {
	responses := object{}
	for code, description := range map[string]string{"400": "Malformed JSON or transport envelope exceeded", "401": "Bearer token required if configured", "403": "Storage not accepted, access revoked or read-only mutation denied", "404": "Unknown simulation document, entity or run", "409": "Version conflict, run not ready or incompatible execution state", "422": "Invalid simulation semantics; no partial writes", "428": "Current baseVersion required", "500": "Browser storage failure", "503": "No connected browser or integration disabled", "504": "Browser did not respond"} {
		responses["SimulationError"+code] = object{"description": description, "content": object{"application/json": object{"schema": ref("Error")}}}
	}
	return responses
}
