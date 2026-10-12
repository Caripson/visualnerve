package model

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

func TestFlowchartCatalogMatchesBrowserIDsAndKeepsNodeKinds(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "frontend", "src", "flowchart", "ibm-symbols.ts"))
	if err != nil {
		t.Fatal(err)
	}
	ids := strings.Split(strings.Split(string(data), "const symbolIds = [")[1], "] as const;")[0]
	actual := []string{}
	for _, match := range regexp.MustCompile(`'(ibm-[^']+)'`).FindAllStringSubmatch(ids, -1) {
		actual = append(actual, match[1])
	}
	if len(FlowchartSymbols) != 43 || !reflect.DeepEqual(FlowchartSymbols, actual) {
		t.Fatal("Go and browser appearance IDs must remain identical", FlowchartSymbols, actual)
	}
	for _, kind := range NodeTypes {
		if strings.HasPrefix(kind, "ibm-") {
			t.Fatal("appearance must not add a semantic node kind", kind)
		}
	}
}

func TestFlowchartAppearanceValidationRoundtripAndClearing(t *testing.T) {
	graph := validGraph()
	for _, id := range FlowchartSymbols {
		graph.Nodes[0].FlowchartSymbol = id
		if err := ValidateGraph(graph); err != nil {
			t.Fatal(id, err)
		}
		data, err := json.Marshal(graph)
		if err != nil {
			t.Fatal(err)
		}
		var roundtrip Graph
		if err = json.Unmarshal(data, &roundtrip); err != nil || roundtrip.Nodes[0].FlowchartSymbol != id {
			t.Fatal("appearance lost by DTO roundtrip", id, err)
		}
	}
	graph.Nodes[0].FlowchartSymbol = "ibm-unknown"
	if ValidateGraph(graph) == nil {
		t.Fatal("unknown symbol accepted")
	}
	node := graph.Nodes[0]
	node.FlowchartSymbol = "ibm-predefined-process"
	var changed Node
	if err := MergePatch(node, map[string]json.RawMessage{"flowchartSymbol": json.RawMessage(`null`)}, &changed); err != nil {
		t.Fatal(err)
	}
	if changed.FlowchartSymbol != "" || changed.NodeType != node.NodeType || changed.ID != node.ID {
		t.Fatal("clearing appearance must preserve native identity and type", changed)
	}
	if err := ValidateNode(changed); err != nil {
		t.Fatal(err)
	}
}
