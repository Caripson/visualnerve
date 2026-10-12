package model

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestNodeBackgroundColorDTOAndValidation(t *testing.T) {
	for _, value := range []string{"#000000", "#ffffff", "#aB12Ef"} {
		graph := validGraph()
		graph.Nodes[0].BackgroundColor = value
		graph.Nodes[0].Color = "#123456"
		graph.Nodes[0].FlowchartSymbol = "ibm-process"
		if err := ValidateGraph(graph); err != nil {
			t.Fatal(value, err)
		}
		encoded, _ := json.Marshal(graph)
		var decoded Graph
		if err := json.Unmarshal(encoded, &decoded); err != nil || !reflect.DeepEqual(decoded.Nodes, graph.Nodes) {
			t.Fatal("fill must roundtrip without changing case or accent", value, err)
		}
	}
	for _, raw := range []string{`null`, `""`, `"#abc"`, `"#abcd1234"`, `"#gg0000"`, `"white"`, `{}`, `[]`, `42`, `true`} {
		var node Node
		if err := json.Unmarshal([]byte(`{"backgroundColor":`+raw+`}`), &node); err == nil {
			t.Fatal("explicit invalid complete fill accepted", raw)
		}
	}
	var omitted Node
	if err := json.Unmarshal([]byte(`{"title":"Theme fill"}`), &omitted); err != nil || omitted.BackgroundColor != "" {
		t.Fatal("omitted fill must retain the theme default", err)
	}
	node := validGraph().Nodes[0]
	node.BackgroundColor = "#xyz000"
	if ValidateNode(node) == nil {
		t.Fatal("invalid constructed DTO accepted")
	}
}

func TestNodeBackgroundColorMergePatchPreservesAndClearsOnlyFill(t *testing.T) {
	node := validGraph().Nodes[0]
	node.BackgroundColor = "#Ab1234"
	node.Color = "#765432"
	node.FlowchartSymbol = "ibm-sort"
	var changed Node
	if err := MergePatch(node, map[string]json.RawMessage{"x": json.RawMessage(`300`)}, &changed); err != nil || changed.BackgroundColor != node.BackgroundColor {
		t.Fatal("omission must preserve fill", changed, err)
	}
	if err := MergePatch(node, map[string]json.RawMessage{"backgroundColor": json.RawMessage(`null`)}, &changed); err != nil {
		t.Fatal(err)
	}
	expected := node
	expected.BackgroundColor = ""
	if !reflect.DeepEqual(changed, expected) {
		t.Fatal("reset must remove only fill", changed)
	}
	if err := ValidateNode(changed); err != nil {
		t.Fatal(err)
	}
	if err := MergePatch(node, map[string]json.RawMessage{"backgroundColor": json.RawMessage(`"#bad"`)}, &changed); err == nil {
		t.Fatal("invalid patch accepted")
	}
}
