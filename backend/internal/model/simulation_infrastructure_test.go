package model

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestSimulationInfrastructureSurvivesGraphDTO(t *testing.T) {
	// The Go bridge must retain the browser's versioned semantics without
	// interpreting their units or adding an independent execution model.
	for _, payload := range []string{
		`{"type":"process-simulator","schemaVersion":1,"resources":[],"nodes":[],"edges":[]}`,
		`{"type":"process-simulator","schemaVersion":2,"infrastructure":{"schemaVersion":1},"resources":[{"id":"cpu","capacity":0.5,"unit":"cores","infrastructure":{"kind":"cpu","unit":"cores"}},{"id":"ram","capacity":256,"unit":"MiB","infrastructure":{"kind":"memory","unit":"MiB"}},{"id":"wan","capacity":10.5,"unit":"Mbps","infrastructure":{"kind":"bandwidth","unit":"Mbps"}},{"id":"power","capacity":5,"unit":"kW","infrastructure":{"kind":"energy","unit":"kW","generation":[{"startSeconds":0,"endSeconds":3600,"powerKW":2}],"battery":{"capacityKWh":10,"initialKWh":5,"maxChargeKW":1,"maxDischargeKW":2,"chargeEfficiency":0.9,"dischargeEfficiency":0.8}}}],"nodes":[{"id":"api","type":"work","work":{"processingSeconds":0.2,"capacity":4,"infrastructure":{"cpu":{"resourceId":"cpu","coreSeconds":0.1,"cores":0.25},"memory":[{"resourceId":"ram","amountMiB":32,"scope":"case"}]}}}],"edges":[{"id":"wire","infrastructure":{"transfer":{"resourceId":"wan","bytes":1024}}}],"scenarios":[{"id":"stress","overrides":{"nodes":{"api":{"work":{"infrastructure":{"cpu":{"cores":0.5},"memory":null}}}}}}]}`,
	} {
		var original Meta
		if err := json.Unmarshal([]byte(payload), &original); err != nil {
			t.Fatal(err)
		}
		encoded, err := json.Marshal(Graph{Simulation: original})
		if err != nil {
			t.Fatal(err)
		}
		var restored Graph
		if err := json.Unmarshal(encoded, &restored); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(original, restored.Simulation) {
			t.Fatal("graph DTO changed infrastructure fields, fractional dimensions or scenario null markers")
		}
	}
}
