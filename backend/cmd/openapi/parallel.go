package main

const parallelSemanticsDescription = "Additive schemaVersion 1 mandatory fork/join execution. A business case suspends at a fork; every declared outgoing branch creates a child work token that independently uses the same queues, capacities and shared resources. Only children of the same business case and fork group can satisfy its paired join. The original parent continues once all branches arrive, with one downstream outcome/revenue and original-creation time-to-revenue. Branch processing/waiting effort and incurred costs sum into the parent; branch revenue multipliers compose once. Any branch failure or abandonment cancels the entire original case and its nested siblings, releases resources, retains incurred costs and records lost revenue once. Regions must be closed, acyclic and correctly nested (maximum 16 levels); all 2–64 fork branches are mandatory and unfiltered. Cycles, crossing pairs, unrelated incoming work and successful outcomes before the join are rejected with structured 422. Pair/topology creation or replacement uses a single versioned full model PUT so no partially configured pair is saved."

// Extend the existing authoritative model and runtime schemas, retaining old schemaVersion 1 inputs.
func addParallelSimulationSchemas(schemas object) {

	schemas["SimulationFork"] = strictObject([]string{"joinNodeId", "branchEdgeIds"}, object{
		"joinNodeId":    simID(),
		"branchEdgeIds": object{"type": "array", "minItems": 2, "maxItems": 64, "uniqueItems": true, "items": simID(), "description": "All outgoing edge IDs from this fork, in deterministic branch creation order. No conditional subset, duplicate or particle-type-filtered fork edge is allowed."},
	})
	schemas["SimulationFork"].(object)["description"] = parallelSemanticsDescription
	schemas["SimulationJoin"] = strictObject([]string{"forkNodeId"}, object{"forkNodeId": simID()})
	schemas["SimulationJoin"].(object)["description"] = "The matching fork must refer back to this join. Each active fork group has independent arrival correlation; tokens from another case/group never satisfy this join. " + parallelSemanticsDescription
	base := clone(schemas["SimulationSourceNode"].(object)["properties"].(object))
	delete(base, "source")
	variants := schemas["SimulationNode"].(object)["oneOf"].([]any)
	for _, variant := range []struct{ kind, schema, name string }{{"fork", "SimulationFork", "SimulationForkNode"}, {"join", "SimulationJoin", "SimulationJoinNode"}} {
		properties := simProperties(base, object{"type": simEnum(variant.kind), variant.kind: ref(variant.schema)})
		schemas[variant.name] = strictObject([]string{"id", "name", "type", variant.kind}, properties)
		variants = append(variants, ref(variant.name))
		schemas[variant.schema+"Partial"] = simPartial(schemas[variant.schema].(object))
	}
	schemas["SimulationNode"].(object)["oneOf"] = variants
	for _, name := range []string{"SimulationNodeOverride", "SimulationNodePatchValue"} {
		properties := schemas[name].(object)["properties"].(object)
		properties["type"] = simEnum("source", "work", "router", "fork", "join", "resource", "outcome")
		properties["fork"] = simNullable(ref("SimulationForkPartial"))
		properties["join"] = simNullable(ref("SimulationJoinPartial"))
	}
	joinFields := object{"waitingGroups": simInteger(0), "arrivedBranches": simInteger(0), "expectedBranches": simInteger(0), "completedGroups": simInteger(0), "cancelledGroups": simInteger(0), "wait": ref("SimulationDistributionMetrics")}
	schemas["SimulationJoinMetrics"] = strictObject([]string{"waitingGroups", "arrivedBranches", "expectedBranches", "completedGroups", "cancelledGroups", "wait"}, joinFields)
	schemas["SimulationJoinMetrics"].(object)["description"] = "Live correlation and actual branch waiting. expectedBranches counts all branches in groups with at least one arrival; arrivedBranches counts currently waiting tokens. Residual branches are expectedBranches-arrivedBranches. The node queue counts these actual arrived tokens, not suspended parents or additional business cases. completedGroups/cancelledGroups are cumulative; wait is measured from actual branch arrival until group release/cancellation."
	nodeMetrics := schemas["SimulationNodeMetrics"].(object)["properties"].(object)
	nodeMetrics["type"] = simEnum("source", "work", "router", "fork", "join", "resource", "outcome")
	nodeMetrics["join"] = ref("SimulationJoinMetrics")
	identities := object{"rootParticleId": simInteger(1), "parentParticleId": simInteger(1), "forkGroupId": simInteger(1), "forkNodeId": simID(), "joinNodeId": simID(), "branchEdgeId": simID()}
	particle := schemas["SimulationParticleSnapshot"].(object)
	particleProperties := particle["properties"].(object)
	particleProperties["status"] = simEnum("queued", "processing", "transit", "waiting", "joined", "cancelled", "completed", "abandoned", "failed")
	for name, property := range identities {
		particleProperties[name] = property
	}
	particle["description"] = "Original business items have their own ID. Child work tokens additionally expose root/parent/group/fork/join/branch identities. waiting means a suspended parent or an arrived child waiting at join; joined and cancelled children are retired work tokens, never extra completed/failed business cases. Accumulated processing/waiting are effort summed across branches, while TTR/cycle time use original creation and completion timestamps."
	eventProperties := schemas["SimulationEvent"].(object)["properties"].(object)
	eventTypes := eventProperties["type"].(object)["enum"].([]string)
	eventProperties["type"] = object{"type": "string", "enum": append(eventTypes, "PARTICLE_FORKED", "BRANCH_JOINED", "JOIN_COMPLETED", "BRANCH_CANCELLED", "PROCESS_CANCELLED")}
	for name, property := range identities {
		eventProperties[name] = property
	}
	eventProperties["branchCount"] = simInteger(0)
	eventProperties["arrivedBranches"] = simInteger(0)
	schemas["SimulationParallelGroup"] = strictObject([]string{"groupId", "rootParticleId", "parentParticleId", "forkNodeId", "joinNodeId", "branchParticleIds", "arrivedBranchEdgeIds", "pendingBranchEdgeIds", "createdAtSeconds"}, object{
		"groupId": simInteger(1), "rootParticleId": simInteger(1), "parentParticleId": simInteger(1), "forkNodeId": simID(), "joinNodeId": simID(), "branchParticleIds": object{"type": "array", "maxItems": 64, "items": simInteger(1)}, "arrivedBranchEdgeIds": stringList(), "pendingBranchEdgeIds": stringList(), "createdAtSeconds": simNumber(0),
	})
	schemas["SimulationParallelState"] = strictObject([]string{"activeGroups", "activeBranches", "waitingParents", "createdBranches", "joinedBranches", "cancelledBranches", "groups", "droppedGroups"}, object{
		"activeGroups": simInteger(0), "activeBranches": simInteger(0), "waitingParents": simInteger(0), "createdBranches": simInteger(0), "joinedBranches": simInteger(0), "cancelledBranches": simInteger(0), "groups": simArray("SimulationParallelGroup"), "droppedGroups": simInteger(0),
	})
	schemas["SimulationParallelState"].(object)["description"] = "Aggregates cover every active fork group/token. groups is a bounded inspection sample, capped by particle retention (at most 10,000); droppedGroups states how many active groups are omitted from that sample. These counts never replace original business-case metrics. A nested suspended parent is also an outer branch token, so activeBranches+waitingParents must not be treated as distinct population."
	for _, name := range []string{"SimulationState", "SimulationResult"} {
		schemas[name].(object)["properties"].(object)["parallel"] = ref("SimulationParallelState")
	}
	metrics := schemas["SimulationMetrics"].(object)
	metrics["description"] = "created/completed/abandoned/failed/inSystem count original business cases, including fork/join runs. created = completed + abandoned + failed + inSystem. Throughput, expected/realized/lost revenue and TTR are business metrics; queue/processing distributions observe actual work-token effort. " + parallelSemanticsDescription
	schemas["SimulationState"].(object)["properties"].(object)["retained"].(object)["properties"].(object)["activeParticles"].(object)["description"] = "All live engine tokens, including original items, child work tokens and suspended parents. This is a storage/performance count, not business population."
	schemas["SimulationExecutionLimits"].(object)["properties"].(object)["activeParticles"].(object)["description"] = "The 200,000 live-token limit includes suspended parents and every parallel child. Exceeding it fails explicitly with partial results; children are never silently dropped."
	schemas["SimulationExecutionLimits"].(object)["properties"].(object)["routeVisits"].(object)["description"] = "Maximum visits per work token, including visits inherited from its parent at fork. Joined branch routes are summarized without retaining every repeated edge; this visit ceiling is not a limit on summed branch effort."
	schemas["SimulationResult"].(object)["properties"].(object)["routeMetrics"].(object)["description"] = "Completed original-case route metrics. Exact ordered labels are retained up to 2,000 characters. Longer paths use the first 200 characters followed by an ordered composable dual 32-bit digest and edge count: … [route:<8hex>-<8hex>; edges=N]. These deterministic grouping summaries are not cryptographic integrity guarantees and cannot reconstruct the complete itinerary. This bounded summary never drops Work revenue attribution. At most 256 distinct route buckets plus [other routes] are retained; all completed cases still contribute to metrics."
	schemas["SimulationCapabilities"].(object)["properties"].(object)["execution"].(object)["properties"].(object)["routeAggregation"] = strictObject(nil, object{
		"exactLabelCharacters": object{"type": "integer", "enum": []int{2000}}, "summaryPrefixCharacters": object{"type": "integer", "enum": []int{200}}, "digest": simEnum("ordered-composable-dual-32-bit-with-edge-count"), "completedRouteBuckets": object{"type": "integer", "enum": []int{256}}, "overflow": simEnum("[other routes]"), "workRevenueAttribution": simEnum("deduplicated-visited-work-nodes"),
	})
	schemas["SimulationProcessMetrics"].(object)["description"] = schemas["SimulationProcessMetrics"].(object)["description"].(string) + " Parallel siblings are deduplicated by root business case per active scope visit; shared scopes count population, revenue and terminal loss once, while queues/resources/processing observe actual child work."
	schemas["SimulationModel"].(object)["description"] = schemas["SimulationModel"].(object)["description"].(string) + " " + parallelSemanticsDescription
	capabilities := strictObject(nil, object{
		"mode":         simEnum("all-mandatory"),
		"fork":         strictObject(nil, object{"joinNodeId": simEnum("fork.joinNodeId"), "branchEdgeIds": simEnum("fork.branchEdgeIds"), "outgoing": simEnum("all-declared"), "particleTypeFilters": object{"type": "boolean", "enum": []bool{false}}}),
		"join":         strictObject(nil, object{"forkNodeId": simEnum("join.forkNodeId"), "correlation": simEnum("business-case-and-fork-group"), "wait": simEnum("all-declared-branches")}),
		"cancellation": simEnum("any-branch-failure-or-abandonment-cancels-entire-case"), "incurredCosts": simEnum("retained-on-cancellation"), "population": simEnum("original-business-cases"), "workTokens": simEnum("independent-queue-resource-consuming-children"), "processingAndWaiting": simEnum("summed-branch-effort"), "timeToRevenue": simEnum("original-creation-to-single-outcome"), "revenue": simEnum("once-after-join-with-composed-branch-multipliers"), "nesting": simEnum("properly-nested-closed-acyclic-regions"),
		"limits":     strictObject([]string{"branches", "nesting", "liveTokens"}, object{"branches": object{"type": "integer", "enum": []int{64}}, "nesting": object{"type": "integer", "enum": []int{16}}, "liveTokens": object{"type": "integer", "enum": []int{200000}}}),
		"stateField": simEnum("parallel"), "joinMetricsField": simEnum("nodes[].join"), "groupSampling": simEnum("bounded-by-particle-retention"), "mutations": simEnum("atomic-full-model-put-for-pair-and-topology-changes"),
	})
	capabilities["description"] = parallelSemanticsDescription
	schemas["SimulationParallelCapabilities"] = capabilities
	schemas["SimulationCapabilities"].(object)["properties"].(object)["parallel"] = ref("SimulationParallelCapabilities")
}
