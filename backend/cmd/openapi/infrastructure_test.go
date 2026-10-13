package main

import (
	"reflect"
	"strings"
	"testing"
)

func TestInfrastructureSchemasKeepLegacyBoundaryAndStrictDimensions(t *testing.T) {
	schemas := object{}
	addSimulationSchemas(schemas)
	model := schemas["SimulationModel"].(object)
	if !reflect.DeepEqual(model["properties"].(object)["schemaVersion"].(object)["enum"], []int{1, 2}) {
		t.Fatal("model must announce the opt-in execution boundary")
	}
	branches := model["oneOf"].([]any)
	legacy, typed := branches[0].(object), branches[1].(object)
	if legacy["not"] == nil || !reflect.DeepEqual(typed["required"], []string{"infrastructure"}) {
		t.Fatal("legacy must forbid the extension and typed models must require it")
	}
	for _, kind := range []string{"CPU", "Memory", "Bandwidth", "Energy"} {
		descriptor := schemas["SimulationInfrastructure"+kind+"Resource"].(object)
		if descriptor["additionalProperties"] != false {
			t.Fatal("typed descriptors must reject unknown assumptions", kind)
		}
	}
	work := schemas["SimulationInfrastructureWork"].(object)
	if work["not"] == nil || !strings.Contains(work["description"].(string), "(pool,scope)") {
		t.Fatal("activity exclusivity and independent RAM scopes must be discoverable")
	}
	transfer := infrastructureProperties(schemas, "SimulationInfrastructureTransfer")["bytes"].(object)
	if transfer["type"] != "integer" || transfer["maximum"] != float64(1e15) {
		t.Fatal("payload bytes must retain exact integer bounds")
	}
	for _, field := range []string{"chargeEfficiency", "dischargeEfficiency"} {
		value := infrastructureProperties(schemas, "SimulationInfrastructureBattery")[field].(object)
		if value["minimum"] != 0.000001 || value["maximum"] != float64(1) {
			t.Fatal("battery losses must use bounded positive efficiencies", field)
		}
	}
	resourceBranches := schemas["SimulationResource"].(object)["oneOf"].([]any)
	for _, index := range []int{3, 4} {
		if resourceBranches[index].(object)["allOf"] == nil {
			t.Fatal("bandwidth and energy cannot silently advertise scaling")
		}
	}
	increment := infrastructureProperties(schemas, "SimulationInfrastructureScaling")["increment"].(object)
	if increment["minimum"] != 0.000001 || increment["maximum"] != float64(1e12) {
		t.Fatal("typed CPU/RAM scaling bounds must include fractional increments")
	}
}

func TestInfrastructurePatchMetricsAndComparisonRemainScoped(t *testing.T) {
	schemas := object{}
	addSimulationSchemas(schemas)
	complete := infrastructureProperties(schemas, "SimulationWork")["infrastructure"].(object)
	if complete["nullable"] != nil || complete["oneOf"] != nil {
		t.Fatal("complete fields must not accept patch nulls")
	}
	patch := infrastructureProperties(schemas, "SimulationWorkPartial")["infrastructure"].(object)["oneOf"].([]any)
	if patch[0].(object)["$ref"] != "#/components/schemas/SimulationInfrastructureWorkPartial" || patch[1].(object)["nullable"] != true {
		t.Fatal("nested merge patch must expose partial values and optional clearing")
	}
	for _, name := range []string{"SimulationState", "SimulationResult"} {
		if infrastructureProperties(schemas, name)["infrastructure"] == nil || infrastructureProperties(schemas, name)["failureCode"] == nil {
			t.Fatal("domain counters and failure classification must be inspectable", name)
		}
	}
	if infrastructureProperties(schemas, "SimulationMetrics")["infrastructure"] != nil || infrastructureProperties(schemas, "SimulationResourceMetrics")["infrastructure"] != nil {
		t.Fatal("detailed counters belong to state/result, not invented generic metrics")
	}
	for _, family := range []string{"CPU", "Memory", "Bandwidth", "Energy"} {
		for _, value := range infrastructureProperties(schemas, "SimulationInfrastructure"+family+"MetricsDelta") {
			if value.(object)["minimum"] != nil {
				t.Fatal("comparison deltas must allow negative scenario-minus-baseline values")
			}
		}
	}
	if infrastructureProperties(schemas, "SimulationComparison")["infrastructure"] == nil {
		t.Fatal("same-run comparison must expose domain counters without a new route")
	}
	methodology := infrastructureProperties(schemas, "SimulationBottleneck")["methodology"].(object)
	if !reflect.DeepEqual(methodology["enum"], []string{"queue-history", "blocked-admission", "bandwidth-sharing", "energy-shortfall"}) {
		t.Fatal("actual bottleneck ranking must disclose its method without changing legacy payloads")
	}
	for _, name := range []string{"SimulationNodeMetrics", "SimulationResourceMetrics"} {
		if infrastructureProperties(schemas, name)["capacity"].(object)["type"] != "number" {
			t.Fatal("typed resource display metrics must preserve fractional capacity", name)
		}
	}
	if infrastructureProperties(schemas, "SimulationEvent")["capacity"].(object)["type"] != "number" || infrastructureProperties(schemas, "SimulationWork")["capacity"].(object)["type"] != "integer" {
		t.Fatal("fractional resource scale events must not weaken integer Work slot inputs")
	}
	capabilities := infrastructureProperties(schemas, "SimulationCapabilities")
	if capabilities["supportedModelSchemaVersions"] == nil || capabilities["schemaVersion"] == nil || capabilities["infrastructure"] == nil {
		t.Fatal("capability discovery must preserve legacy metadata and add supported versions")
	}
}

func TestInfrastructureTemplateCreationUsesOnlyTheFourCanonicalShortcuts(t *testing.T) {
	document := analyticsContract(t)
	schemas := document["components"].(object)["schemas"].(object)
	input := schemas["DiagramInput"].(object)
	values := input["properties"].(object)["template"].(object)["enum"].([]any)
	for _, key := range infrastructureTemplateKeys {
		found := false
		for _, value := range values {
			found = found || value == key
		}
		if !found {
			t.Fatal("missing actual supported template shortcut", key)
		}
	}
	if len(values) != 27 || input["allOf"] == nil {
		t.Fatal("creation must retain the earlier 23 shortcuts and constrain infrastructure type/mode")
	}
	if document["info"].(object)["version"] != "0.10.0" {
		t.Fatal("new execution contract requires coordinated API version")
	}
}
