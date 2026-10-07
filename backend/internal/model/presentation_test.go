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
		{"/presentation/open", "POST", `{"source":"nodes"}`, true},
		{"/presentation/open", "POST", fmt.Sprintf(`{"diagramId":%q,"source":"storyboard"}`, id), true},
		{"/presentation/open", "POST", `{"source":"slides"}`, false},
		{"/presentation/open", "POST", `{"source":false}`, false},
		{"/presentation/open", "POST", `{"source":null}`, false},
		{"/presentation/open", "POST", `{"source":"storyboard","index":0}`, false},
		{"/presentation/open", "POST", `{"diagramId":"bad"}`, false},
		{"/presentation/seek", "POST", `{"index":0}`, true},
		{"/presentation/seek", "POST", `{"index":12}`, true},
		{"/presentation/seek", "POST", `{"index":1.0}`, true},
		{"/presentation/seek", "POST", `{"index":1e2}`, true},
		{"/presentation/seek", "POST", `{}`, false},
		{"/presentation/seek", "POST", `{"index":-1}`, false},
		{"/presentation/seek", "POST", `{"index":0.5}`, false},
		{"/presentation/seek", "POST", `{"index":9007199254740992}`, false},
		{"/presentation/seek", "POST", `{"index":1e309}`, false},
		{"/presentation/seek", "POST", `{"index":"0"}`, false},
		{"/presentation/seek", "POST", `{"index":false}`, false},
		{"/presentation/seek", "POST", `{"index":null}`, false},
		{"/presentation/seek", "POST", `{"index":0,"source":"storyboard"}`, false},
		{"/presentation/seek", "POST", `null`, false},
		{"/presentation/seek", "POST", `[]`, false},
		{"/presentation/play", "POST", `{}`, true},
		{"/presentation/play", "POST", `{"audio":true}`, false},
		{"/presentation/play", "POST", `{"source":"storyboard"}`, false},
		{"/presentation/preload", "POST", `null`, false},
		{"/presentation", "PATCH", `{"audio":true,"subtitles":false,"preload":true}`, true},
		{"/presentation", "PATCH", `{"minimized":true}`, true},
		{"/presentation", "PATCH", `{"minimized":false}`, true},
		{"/presentation", "PATCH", `{"audio":false,"subtitles":true,"preload":false,"minimized":true}`, true},
		{"/presentation", "PATCH", `{"minimized":"true"}`, false},
		{"/presentation", "PATCH", `{"minimized":1}`, false},
		{"/presentation", "PATCH", `{"minimized":null}`, false},
		{"/presentation", "PATCH", `{"minimized":[]}`, false},
		{"/presentation", "PATCH", `{"minimized":true,"caption":true}`, false},
		{"/presentation", "PATCH", `{"audio":1}`, false},
		{"/presentation", "PATCH", `{}`, false},
		{"/presentation", "PATCH", `{"audio":null}`, false},
		{"/presentation", "PATCH", `{"voice":"remote"}`, false},
		{"/presentation/video", "POST", `{}`, true},
		{"/presentation/video", "POST", `{"audio":true,"subtitles":false}`, true},
		{"/presentation/video", "POST", `{"audio":false}`, true},
		{"/presentation/video", "POST", `{"source":"nodes"}`, true},
		{"/presentation/video", "POST", `{"source":"storyboard","audio":true,"subtitles":false}`, true},
		{"/presentation/video", "POST", `{"source":"slides"}`, false},
		{"/presentation/video", "POST", `{"source":true}`, false},
		{"/presentation/video", "POST", `{"source":null}`, false},
		{"/presentation/video", "POST", `{"audio":"true"}`, false},
		{"/presentation/video", "POST", `{"audio":null}`, false},
		{"/presentation/video", "POST", `{"subtitles":1}`, false},
		{"/presentation/video", "POST", `{"preload":true}`, false},
		{"/presentation/video", "POST", `{"minimized":true}`, false},
		{"/presentation/video", "POST", `{"format":"mp4"}`, false},
		{"/presentation/video", "POST", `null`, false},
		{"/presentation/video", "POST", `[]`, false},
		{"/presentation/video", "DELETE", `{}`, true},
		{"/presentation/video", "DELETE", `{"audio":false}`, false},
		{"/presentation/video", "DELETE", `{"source":"storyboard"}`, false},
		{"/presentation/video", "DELETE", `null`, false},
		{"/presentation/video", "DELETE", ``, false},
		{"/diagrams/" + id + "/presentation", "PUT", `{"baseVersion":1,"presentation":` + definition + `}`, true},
		{"/diagrams/" + id + "/presentation", "PUT", `{"baseVersion":1,"presentation":` + definition + `,"extra":1}`, false},
		{"/settings/presentation-voice", "PUT", `{"value":"en_GB-cori-high"}`, true},
		{"/settings/presentation-voice", "PUT", `{"value":"en_GB-alan-medium"}`, true},
		{"/settings/presentation-voice", "PUT", `{"value":"remote"}`, false},
	} {
		err := ValidatePresentationCommand(test.path, test.method, json.RawMessage(test.body))
		if (err == nil) != test.valid {
			t.Fatalf("%s %s: got %v", test.path, test.body, err)
		}
	}
}
