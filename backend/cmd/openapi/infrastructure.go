package main

const infrastructurePolicy = "Bridge/browser 0.11.0 advertises infrastructure-resources-v1. Infrastructure is opt-in: SimulationModel.schemaVersion:2 requires infrastructure:{schemaVersion:1}; legacy model version 1 retains its existing interpretation and cannot contain typed infrastructure assumptions. CPU core reservations, stage/case RAM leases, bandwidth serialization and generation/grid/battery energy flows run in the same authoritative browser engine. Existing semantic CRUD, immutable seeded runs, metrics, scenarios and comparisons retain their endpoints, versions, grants and operation recovery. Old clients must reject model version 2 rather than execute it as legacy work. Units are canonical cores/core-seconds, MiB, bytes/Mbps and kW/kWh; no arbitrary unit conversion, TCP/OS scheduling or AC electrical solver is implied. Complete records reject null; existing entity JSON Merge Patch and nested scenario override null remove optional properties, then validate the complete resolved model atomically."

var infrastructureTemplateKeys = []string{"api-compute-capacity", "network-multi-site-capacity", "energy-power-capacity", "datacenter-capacity"}

func infrastructureQuantity(min, max float64) object {
	return object{"type": "number", "minimum": min, "maximum": max}
}

func infrastructureProperties(schemas object, name string) object {
	return schemas[name].(object)["properties"].(object)
}

func infrastructureNoField(field string) object {
	return object{"not": object{"required": []string{field}}}
}

func addInfrastructureSchemas(schemas object) {
	const positive = 0.000001
	const capacity = 1e12
	const amount = 1e15
	const duration = 315360000
	schemas["SimulationInfrastructureProfile"] = strictObject([]string{"schemaVersion"}, object{
		"schemaVersion": object{"type": "integer", "enum": []int{1}},
	})
	schemas["SimulationInfrastructureGeneration"] = strictObject([]string{"startSeconds", "endSeconds", "powerKW"}, object{
		"startSeconds": infrastructureQuantity(0, duration), "endSeconds": infrastructureQuantity(0, duration), "powerKW": infrastructureQuantity(0, capacity),
	})
	schemas["SimulationInfrastructureGeneration"].(object)["description"] = "Sorted, non-overlapping simulated-second supply windows with strictly positive duration. Gaps supply zero generation. Power is kW, not energy; generation itself is not capped by Resource.capacity."
	schemas["SimulationInfrastructureBattery"] = strictObject([]string{"capacityKWh", "initialKWh", "maxChargeKW", "maxDischargeKW", "chargeEfficiency", "dischargeEfficiency"}, object{
		"capacityKWh": infrastructureQuantity(positive, amount), "initialKWh": infrastructureQuantity(0, amount),
		"maxChargeKW": infrastructureQuantity(0, capacity), "maxDischargeKW": infrastructureQuantity(0, capacity),
		"chargeEfficiency": infrastructureQuantity(positive, 1), "dischargeEfficiency": infrastructureQuantity(positive, 1),
	})
	schemas["SimulationInfrastructureBattery"].(object)["description"] = "initialKWh cannot exceed capacityKWh. Charge/discharge rates are bounded in kW; efficiencies are positive fractions at most 1. Battery charging uses generation surplus, not grid imports."
	variants := []any{}
	for _, kind := range []string{"cpu", "memory", "bandwidth", "energy"} {
		unit := map[string]string{"cpu": "cores", "memory": "MiB", "bandwidth": "Mbps", "energy": "kW"}[kind]
		name := "SimulationInfrastructure" + map[string]string{"cpu": "CPU", "memory": "Memory", "bandwidth": "Bandwidth", "energy": "Energy"}[kind] + "Resource"
		properties := object{"kind": simEnum(kind), "unit": simEnum(unit)}
		required := []string{"kind", "unit"}
		if kind == "energy" {
			properties["generation"] = object{"type": "array", "items": ref("SimulationInfrastructureGeneration"), "maxItems": 4096}
			properties["gridImportLimitKW"] = infrastructureQuantity(0, capacity)
			properties["pricePerKWh"] = infrastructureQuantity(0, amount)
			properties["battery"] = ref("SimulationInfrastructureBattery")
			required = append(required, "generation")
		}
		schemas[name] = strictObject(required, properties)
		variants = append(variants, ref(name))
	}
	schemas["SimulationInfrastructureResource"] = object{"oneOf": variants, "discriminator": object{"propertyName": "kind"}}
	schemas["SimulationInfrastructureCPUActivity"] = strictObject([]string{"resourceId", "coreSeconds", "cores"}, object{
		"resourceId": simID(), "coreSeconds": infrastructureQuantity(positive, amount), "cores": infrastructureQuantity(positive, capacity),
	})
	schemas["SimulationInfrastructureCPUActivity"].(object)["description"] = "References a typed CPU resource. Dedicated cores are reserved atomically with memory and legacy requirements at Work start, without timeslicing. Duration is (processingSeconds + coreSeconds/allocatedCores) times particle complexity, Work complexityMultiplier and enabled processingTimeMultipliers; allocatedCores is cores times applicable resourceUnitsMultipliers. The existing event clock rounds CPU Work duration to milliseconds with a one-millisecond minimum. Case RAM already held by this business case remains occupied while waiting."
	schemas["SimulationInfrastructureMemoryLease"] = strictObject([]string{"resourceId", "amountMiB", "scope"}, object{
		"resourceId": simID(), "amountMiB": infrastructureQuantity(positive, capacity), "scope": simEnum("stage", "case"),
	})
	schemas["SimulationInfrastructureEnergyActivity"] = strictObject([]string{"resourceId", "energyKWh", "powerKW"}, object{
		"resourceId": simID(), "energyKWh": infrastructureQuantity(positive, amount), "powerKW": infrastructureQuantity(positive, capacity),
	})
	schemas["SimulationInfrastructureEnergyActivity"].(object)["description"] = "References a typed energy resource. Required kWh is energyKWh times particle complexity and Work complexityMultiplier; powerKW remains the requested rate cap. Completion depends on actual delivered energy with max-min fair sharing of available power. Energy Work requires processingSeconds:0, cannot also configure CPU, and rejects nonneutral time/resource-unit improvements."
	schemas["SimulationInfrastructureWork"] = strictObject(nil, object{
		"cpu": ref("SimulationInfrastructureCPUActivity"), "energy": ref("SimulationInfrastructureEnergyActivity"),
		"memory":                   object{"type": "array", "items": ref("SimulationInfrastructureMemoryLease"), "maxItems": 32},
		"releaseMemoryResourceIds": object{"type": "array", "items": simID(), "maxItems": 32, "uniqueItems": true},
	})
	schemas["SimulationInfrastructureWork"].(object)["not"] = object{"required": []string{"cpu", "energy"}}
	schemas["SimulationInfrastructureWork"].(object)["description"] = "Dedicated typed-pool demands. References must resolve to their exact resource kind. Memory permits one demand per (pool,scope); case and stage demands on the same pool are combined for admission. Case leases top up to the maximum requested amount per root business case/pool and are shared by its forked tokens; stage leases belong to one particle. Acquiring/releasing the same pool in one stage is rejected. Explicit case-memory release is forbidden inside a parallel region. Typed pools cannot appear in legacy resourceRequirements."
	schemas["SimulationInfrastructureTransfer"] = strictObject([]string{"resourceId", "bytes"}, object{
		"resourceId": simID(), "bytes": object{"type": "integer", "minimum": 0, "maximum": amount},
	})
	schemas["SimulationInfrastructureEdge"] = strictObject([]string{"transfer"}, object{"transfer": ref("SimulationInfrastructureTransfer")})
	schemas["SimulationInfrastructureEdge"].(object)["description"] = "References a typed bandwidth resource. bytes is an integer; Mbps is decimal megabits/second. Concurrent positive-remaining transfers share capacityMbps*125000 bytes/second equally, rebalanced on arrivals, completions and link availability. Serialization is followed once by this edge's separate travelSeconds propagation delay."

	// Normal entity patches and scenarios recursively merge nested objects.
	for _, name := range []string{"Battery", "CPUActivity", "EnergyActivity", "Transfer"} {
		schemas["SimulationInfrastructure"+name+"Partial"] = simPartial(schemas["SimulationInfrastructure"+name].(object))
	}
	schemas["SimulationInfrastructureWorkPartial"] = simPartial(schemas["SimulationInfrastructureWork"].(object))
	delete(schemas["SimulationInfrastructureWorkPartial"].(object), "not")
	for field, name := range map[string]string{"cpu": "CPUActivity", "energy": "EnergyActivity"} {
		infrastructureProperties(schemas, "SimulationInfrastructureWorkPartial")[field] = simNullable(ref("SimulationInfrastructure" + name + "Partial"))
	}
	schemas["SimulationInfrastructureEdgePartial"] = strictObject(nil, object{"transfer": simNullable(ref("SimulationInfrastructureTransferPartial"))})
	resourcePartial := object{"kind": simEnum("cpu", "memory", "bandwidth", "energy"), "unit": simEnum("cores", "MiB", "Mbps", "kW"),
		"generation": object{"type": "array", "items": ref("SimulationInfrastructureGeneration"), "maxItems": 4096}, "gridImportLimitKW": infrastructureQuantity(0, capacity), "pricePerKWh": infrastructureQuantity(0, amount), "battery": ref("SimulationInfrastructureBatteryPartial")}
	schemas["SimulationInfrastructureResourcePartial"] = simPartial(strictObject(nil, resourcePartial))
	infrastructureProperties(schemas, "SimulationWork")["infrastructure"] = ref("SimulationInfrastructureWork")
	infrastructureProperties(schemas, "SimulationWorkPartial")["infrastructure"] = simNullable(ref("SimulationInfrastructureWorkPartial"))
	infrastructureProperties(schemas, "SimulationEdge")["infrastructure"] = ref("SimulationInfrastructureEdge")
	for _, name := range []string{"SimulationEdgeOverride", "SimulationEdgePatchValue"} {
		infrastructureProperties(schemas, name)["infrastructure"] = simNullable(ref("SimulationInfrastructureEdgePartial"))
	}

	schemas["SimulationInfrastructureScaling"] = clone(schemas["SimulationScaling"].(object))
	for _, field := range []string{"minCapacity", "maxCapacity"} {
		infrastructureProperties(schemas, "SimulationInfrastructureScaling")[field] = infrastructureQuantity(0, capacity)
	}
	infrastructureProperties(schemas, "SimulationInfrastructureScaling")["increment"] = infrastructureQuantity(positive, capacity)
	schemas["SimulationInfrastructureScalingPartial"] = simPartial(schemas["SimulationInfrastructureScaling"].(object))
	resource := infrastructureProperties(schemas, "SimulationResource")
	resource["infrastructure"] = ref("SimulationInfrastructureResource")
	for _, field := range []string{"capacity", "minCapacity", "maxCapacity"} {
		resource[field] = simNumber(0)
	}
	resource["scaling"] = object{"anyOf": []any{ref("SimulationScaling"), ref("SimulationInfrastructureScaling")}}
	resourceBranches := []any{object{"allOf": []any{infrastructureNoField("infrastructure"), object{"properties": object{"capacity": simInteger(0), "minCapacity": simInteger(0), "maxCapacity": simInteger(0), "scaling": ref("SimulationScaling")}}}}}
	for _, kind := range []string{"cpu", "memory", "bandwidth", "energy"} {
		unit := map[string]string{"cpu": "cores", "memory": "MiB", "bandwidth": "Mbps", "energy": "kW"}[kind]
		properties := object{"unit": simEnum(unit), "capacity": infrastructureQuantity(0, capacity), "minCapacity": infrastructureQuantity(0, capacity), "maxCapacity": infrastructureQuantity(0, capacity), "infrastructure": object{"properties": object{"kind": simEnum(kind)}}}
		branch := object{"required": []string{"infrastructure"}, "properties": properties}
		if kind == "cpu" || kind == "memory" {
			properties["scaling"] = ref("SimulationInfrastructureScaling")
		} else {
			branch["allOf"] = []any{infrastructureNoField("scaling")}
			if kind == "energy" {
				branch["allOf"] = append(branch["allOf"].([]any), infrastructureNoField("schedule"))
			}
		}
		resourceBranches = append(resourceBranches, branch)
	}
	schemas["SimulationResource"].(object)["oneOf"] = resourceBranches
	for _, name := range []string{"SimulationResourceOverride", "SimulationResourcePatchValue"} {
		properties := infrastructureProperties(schemas, name)
		properties["infrastructure"] = simNullable(ref("SimulationInfrastructureResourcePartial"))
		for _, field := range []string{"capacity", "minCapacity", "maxCapacity"} {
			properties[field] = simNullable(simNumber(0))
		}
		properties["scaling"] = simNullable(object{"anyOf": []any{ref("SimulationScalingPartial"), ref("SimulationInfrastructureScalingPartial")}})
	}
	// Keep properties visible to existing contract readers, with explicit v1/v2 alternatives.
	model := schemas["SimulationModel"].(object)
	infrastructureProperties(schemas, "SimulationModel")["schemaVersion"] = object{"type": "integer", "enum": []int{1, 2}}
	infrastructureProperties(schemas, "SimulationModel")["infrastructure"] = ref("SimulationInfrastructureProfile")
	legacy := object{"properties": object{"schemaVersion": object{"enum": []int{1}},
		"resources": object{"items": infrastructureNoField("infrastructure")}, "edges": object{"items": infrastructureNoField("infrastructure")},
		"nodes": object{"items": object{"properties": object{"work": infrastructureNoField("infrastructure")}}}}, "not": object{"required": []string{"infrastructure"}}}
	model["oneOf"] = []any{legacy, object{"required": []string{"infrastructure"}, "properties": object{"schemaVersion": object{"enum": []int{2}}}}}
	model["description"] = model["description"].(string) + " " + infrastructurePolicy
	for _, name := range []string{"SimulationResourceMetrics"} {
		for _, field := range []string{"capacity", "maximumCapacity"} {
			infrastructureProperties(schemas, name)[field] = simNumber(0)
		}
	}
	for _, field := range []string{"capacity", "maximumCapacity"} {
		infrastructureProperties(schemas, "SimulationNodeMetrics")[field] = simNumber(0)
	}
	for _, field := range []string{"capacity", "previousCapacity"} {
		infrastructureProperties(schemas, "SimulationEvent")[field] = simNumber(0)
	}
	infrastructureProperties(schemas, "SimulationBottleneck")["methodology"] = simEnum("queue-history", "blocked-admission", "bandwidth-sharing", "bandwidth-unavailable", "energy-shortfall")
	schemas["SimulationBottleneck"].(object)["description"] = "Observed heuristic pressure ranking. Infrastructure model 2 identifies the score methodology; legacy model 1 omits it. Current blocked admission, active bandwidth sharing, unavailable bandwidth and unmet power are distinct from historical Work queues; averageQueue/averageWaitSeconds remain actual recorded values, not fabricated resource-pressure counts. bandwidth-unavailable applies when activeTransfers>0 and usedMbps===0, including configured zero capacity or a scheduled-off link; its dimensionless score is activeTransfers and its reason is Active transfers have no currently available bandwidth. No-demand and propagation-only states do not create this candidate. Scores do not predict throughput or quantify the benefit of adding capacity."
	for name, fields := range map[string][]string{
		"CPU":       {"reservedCores", "peakReservedCores", "coreSeconds", "completedWorkCoreSeconds"},
		"Memory":    {"usedMiB", "peakUsedMiB", "caseLeases", "stageLeases", "allocatedMiBSeconds"},
		"Bandwidth": {"activeTransfers", "peakActiveTransfers", "transferredBytes", "usedMbps", "busySeconds"},
		"Energy":    {"generatedKWh", "gridImportedKWh", "deliveredKWh", "storedKWh", "stateOfCharge", "chargeInputKWh", "dischargeOutputKWh", "conversionLossKWh", "curtailedKWh", "unservedKWh", "activeLoads", "suppliedKW", "unmetKW", "gridCost"},
	} {
		properties := object{}
		for _, field := range fields {
			properties[field] = simNumber(0)
		}
		if name == "Energy" {
			properties["stateOfCharge"] = infrastructureQuantity(0, 1)
		}
		schemas["SimulationInfrastructure"+name+"Metrics"] = strictObject(fields, properties)
	}
	schemas["SimulationInfrastructureMetrics"] = strictObject([]string{"schemaVersion", "cpu", "memory", "bandwidth", "energy"}, object{
		"schemaVersion": object{"type": "integer", "enum": []int{1}}, "cpu": simMap("SimulationInfrastructureCPUMetrics"), "memory": simMap("SimulationInfrastructureMemoryMetrics"), "bandwidth": simMap("SimulationInfrastructureBandwidthMetrics"), "energy": simMap("SimulationInfrastructureEnergyMetrics"),
	})
	for _, name := range []string{"SimulationState", "SimulationResult"} {
		properties := infrastructureProperties(schemas, name)
		properties["infrastructure"] = ref("SimulationInfrastructureMetrics")
		properties["failureCode"] = simEnum("SIMULATION_INFRASTRUCTURE_STALLED")
	}
	infrastructureProperties(schemas, "SimulationParticleSnapshot")["transferProgress"] = object{"type": "number", "minimum": 0, "maximum": 1, "description": "Optional observed visual route fraction: with positive propagation, actual byte serialization occupies 0..0.9 and simulated propagation elapsed occupies 0.9..1; with zero propagation, serialization uses 0..1. It is not a byte counter, predicted completion timestamp or model assumption."}
	infrastructureProperties(schemas, "SimulationResourceMetrics")["cost"].(object)["description"] = "Actual resource cost; an energy pool includes its grid import tariff as well as capacity-hour charges. Grid tariff is included once in whole-system resource cost and is not fabricated as a per-job charge in Work/process or particle-type ledgers. Detailed gridCost is in state/result.infrastructure.energy."
	infrastructureProperties(schemas, "SimulationNodeMetrics")["blockedResourceIds"] = object{"type": "array", "items": simID(), "description": "Optional exact resource IDs preventing an observed atomic Work admission; no inferred waiting cause."}
	infrastructureProperties(schemas, "SimulationResourceMetrics")["blockedNodeIds"] = object{"type": "array", "items": simID(), "description": "Optional exact Work IDs blocked by this pool during atomic admission; complements generic waiting-node inspection."}
	infrastructureProperties(schemas, "SimulationResult")["finalCapacities"] = object{"type": "object", "additionalProperties": simNumber(0)}
	deltaProperties := object{}
	for _, family := range []string{"CPU", "Memory", "Bandwidth", "Energy"} {
		name := "SimulationInfrastructure" + family + "MetricsDelta"
		metrics := clone(schemas["SimulationInfrastructure"+family+"Metrics"].(object))
		for field := range metrics["properties"].(object) {
			metrics["properties"].(object)[field] = object{"type": "number"}
		}
		schemas[name] = metrics
		key := map[string]string{"CPU": "cpu", "Memory": "memory", "Bandwidth": "bandwidth", "Energy": "energy"}[family]
		deltaProperties[key] = simMap(name)
	}
	schemas["SimulationInfrastructureMetricsDelta"] = strictObject([]string{"cpu", "memory", "bandwidth", "energy"}, deltaProperties)
	schemas["SimulationInfrastructureComparison"] = strictObject([]string{"baseline", "scenario", "delta"}, object{"baseline": ref("SimulationInfrastructureMetrics"), "scenario": ref("SimulationInfrastructureMetrics"), "delta": ref("SimulationInfrastructureMetricsDelta")})
	schemas["SimulationInfrastructureComparison"].(object)["description"] = "Captured baseline and scenario counters plus signed scenario-minus-baseline deltas for the same family/resource IDs present in both. Missing pools remain visible in their result side; no zero-valued pool is manufactured. Legacy comparisons omit this field."
	infrastructureProperties(schemas, "SimulationComparison")["infrastructure"] = ref("SimulationInfrastructureComparison")
	capabilities := infrastructureProperties(schemas, "SimulationCapabilities")
	capabilities["schemaVersion"] = object{"type": "integer", "enum": []int{1}, "description": "Retained capability-document compatibility metadata; inspect supportedModelSchemaVersions for executable model versions."}
	capabilities["apiVersion"] = object{"type": "string", "example": "0.11.0"}
	capabilities["supportedModelSchemaVersions"] = object{"type": "array", "items": object{"type": "integer", "enum": []int{1, 2}}, "example": []int{1, 2}}
	capabilities["infrastructure"] = ref("SimulationInfrastructureCapabilities")
	schemas["SimulationInfrastructureCapabilities"] = object{"type": "object", "additionalProperties": true,
		"description": infrastructurePolicy,
		"properties": object{"schemaVersion": object{"type": "integer", "enum": []int{1}}, "requiredModelSchemaVersion": object{"type": "integer", "enum": []int{2}}, "capability": simEnum("infrastructure-resources-v1"),
			"resourceKinds":           object{"type": "array", "items": simEnum("cpu", "memory", "bandwidth", "energy")},
			"units":                   strictObject([]string{"cpu", "memory", "bandwidth", "energy"}, object{"cpu": simEnum("cores"), "memory": simEnum("MiB"), "bandwidth": simEnum("Mbps"), "energy": simEnum("kW")}),
			"displayConversions":      object{"type": "array", "items": strictObject([]string{"unit", "canonicalUnit", "factor"}, object{"unit": object{"type": "string"}, "canonicalUnit": simEnum("bytes", "Mbps", "kW", "kWh", "cores", "core-seconds"), "factor": simNumber(0)}), "description": "Explicit dimension conversions; decimal kB/MB/GB differ from binary KiB/MiB/GiB. Model memory fields remain amountMiB and capacity in MiB."},
			"bottleneckMethodologies": object{"type": "array", "items": simEnum("queue-history", "blocked-admission", "bandwidth-sharing", "bandwidth-unavailable", "energy-shortfall")},
			"continuousTotals":        strictObject([]string{"absoluteTolerance", "relativeTolerance", "rawUnrounded", "discreteCountsOrderEventMillisecondsAndCapacities"}, object{"absoluteTolerance": object{"type": "number", "enum": []float64{1e-9}}, "relativeTolerance": object{"type": "number", "enum": []float64{1e-9}}, "rawUnrounded": object{"type": "boolean", "enum": []bool{true}}, "discreteCountsOrderEventMillisecondsAndCapacities": simEnum("exact")}),
			"modelField":              simEnum("infrastructure"), "resourceField": simEnum("resources[].infrastructure"), "workField": simEnum("nodes[].work.infrastructure"), "edgeField": simEnum("edges[].infrastructure.transfer"), "metricsField": simEnum("state/result.infrastructure"),
			"cpu": object{"type": "object", "additionalProperties": true}, "memory": object{"type": "object", "additionalProperties": true}, "bandwidth": object{"type": "object", "additionalProperties": true}, "energy": object{"type": "object", "additionalProperties": true},
			"compatibility": strictObject([]string{"legacyModelSchemaVersion", "liveCollaboration"}, object{"legacyModelSchemaVersion": object{"type": "integer", "enum": []int{1}}, "liveCollaboration": object{"type": "boolean", "enum": []bool{false}}}),
			"limits":        strictObject([]string{"schemaVersion", "capacity", "durationSeconds", "amount", "positiveMinimum", "memoryRequirements", "generationWindows"}, object{"schemaVersion": object{"type": "integer", "enum": []int{1}}, "capacity": object{"type": "number", "enum": []float64{capacity}}, "durationSeconds": object{"type": "number", "enum": []int{duration}}, "amount": object{"type": "number", "enum": []float64{amount}}, "positiveMinimum": object{"type": "number", "enum": []float64{positive}}, "memoryRequirements": object{"type": "integer", "enum": []int{32}}, "generationWindows": object{"type": "integer", "enum": []int{4096}}}),
		},
	}
	visual := infrastructureProperties(schemas, "SimulationVisualCapacity")
	visual["typedPools"] = simEnum("aggregate-domain-summaries")
	visual["typedPoolsIndividualUnits"] = object{"type": "boolean", "enum": []bool{false}, "description": "Typed fractional pools show aggregate cores, MiB, Mbps or kW; no individual unit identities are fabricated."}
	visual["infrastructureWork"] = object{"type": "string", "enum": []string{"aggregate-in-flight-concurrency"}, "description": "Model 2 Work uses one editable logical card with exact in-flight capacity, active and queue values. Work slots are concurrency limits, not physical server replicas."}
	visual["infrastructureResources"] = object{"type": "string", "enum": []string{"aggregate-pools"}, "description": "All model 2 resources, including generic database/connection pools, use one logical aggregate card. Legacy model 1 capacity banks retain their interpretation."}
	schemas["SimulationVisualCapacity"].(object)["description"] = "Legacy model 1: " + schemas["SimulationVisualCapacity"].(object)["description"].(string) + " Infrastructure model 2 Work and every resource pool use one aggregate logical card; Work slots are in-flight concurrency, not physical replicas. Legacy model 1 card banks are unchanged."
}
