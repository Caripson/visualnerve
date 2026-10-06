package model

import (
	"encoding/json"
	"fmt"
	"testing"
)

func TestPresentationDefinitionAndGraphReferences(t *testing.T) {
	graph := validGraph()
	definition := PresentationDefinition{Version: 1, NodeIDs: []string{graph.Nodes[0].ID}, SecondsPerNode: 8, TransitionMS: 1200}
	graph.Diagram.Settings["presentation"] = definition
	if err := ValidateGraph(graph); err != nil {
		t.Fatal(err)
	}
	for _, ids := range [][]string{{UUID()}, {graph.Nodes[0].ID, graph.Nodes[0].ID}} {
		definition.NodeIDs = ids
		graph.Diagram.Settings["presentation"] = definition
		if ValidateGraph(graph) == nil {
			t.Fatal("invalid presentation refs accepted", ids)
		}
	}
	for _, raw := range []string{
		`{"version":1,"nodeIds":[],"secondsPerNode":8,"transitionMs":0,"unknown":true}`,
		`{"version":1,"nodeIds":[],"secondsPerNode":1,"transitionMs":0}`,
		`{"version":1,"nodeIds":[],"secondsPerNode":601,"transitionMs":0}`,
		`{"version":1,"nodeIds":[],"secondsPerNode":8,"transitionMs":10001}`,
		`{"version":1,"nodeIds":[],"secondsPerNode":8,"transitionMs":null}`,
		`{"version":1,"nodeIds":null,"secondsPerNode":8,"transitionMs":0}`,
		`{"version":1,"nodeIds":[]}`, `null`,
	} {
		if _, err := ValidatePresentationDefinition(json.RawMessage(raw)); err == nil {
			t.Fatal("invalid definition accepted", raw)
		}
	}
	definition.NodeIDs = make([]string, 20001)
	for i := range definition.NodeIDs {
		definition.NodeIDs[i] = UUID()
	}
	raw, _ := json.Marshal(definition)
	if _, err := ValidatePresentationDefinition(raw); err == nil {
		t.Fatal("node cap bypassed")
	}
}

func TestPresentationCommandsRequireExactBodies(t *testing.T) {
	id := UUID()
	definition := fmt.Sprintf(`{"version":1,"nodeIds":[%q],"secondsPerNode":2,"transitionMs":0}`, id)
	for _, test := range []struct {
		path, method, body string
		valid              bool
	}{
		{"/presentation/open", "POST", `{}`, true},
		{"/presentation/open", "POST", fmt.Sprintf(`{"diagramId":%q}`, id), true},
		{"/presentation/open", "POST", `{"diagramId":"bad"}`, false},
		{"/presentation/play", "POST", `{}`, true},
		{"/presentation/play", "POST", `{"audio":true}`, false},
		{"/presentation/preload", "POST", `null`, false},
		{"/presentation", "PATCH", `{"audio":true,"subtitles":false,"preload":true}`, true},
		{"/presentation", "PATCH", `{"audio":1}`, false},
		{"/presentation", "PATCH", `{}`, false},
		{"/presentation", "PATCH", `{"audio":null}`, false},
		{"/presentation", "PATCH", `{"voice":"remote"}`, false},
		{"/diagrams/" + id + "/presentation", "PUT", `{"baseVersion":1,"presentation":` + definition + `}`, true},
		{"/diagrams/" + id + "/presentation", "PUT", `{"baseVersion":1,"presentation":` + definition + `,"extra":1}`, false},
		{"/settings/presentation-voice", "PUT", `{"value":"en_GB-cori-high"}`, true},
		{"/settings/presentation-voice", "PUT", `{"value":"remote"}`, false},
	} {
		err := ValidatePresentationCommand(test.path, test.method, json.RawMessage(test.body))
		if (err == nil) != test.valid {
			t.Fatalf("%s %s: got %v", test.path, test.body, err)
		}
	}
}
