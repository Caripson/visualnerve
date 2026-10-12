package model

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestNotationFixedCompartmentLayoutsPreserveEverySupportedSection(t *testing.T) {
	for _, test := range []struct {
		collection, symbol, kind, properties string
		maximum                              int
	}{
		{"hipo", "ipo-chart", "", "", 3},
		{"hipo", "ipo-chart", "overview-ipo", `{"detail":"overview"}`, 3},
		{"hipo", "ipo-chart", "detail-ipo", "", 4},
		{"hipo", "ipo-chart", "detail-ipo", `{"detail":"overview"}`, 4},
		{"hipo", "ipo-chart", "overview-ipo", `{"detail":"detail"}`, 4},
		{"hipo", "ipo-chart", "", `{"detail":"detail"}`, 4},
		{"bpmn", "choreography-task", "choreography", "", 3},
		{"bpmn", "sub-choreography", "choreography", "", 3},
		{"bpmn", "call-choreography", "choreography", "", 3},
		{"uml", "class", "class", "", 16},
	} {
		t.Run(fmt.Sprintf("%s/%s/%s/%s", test.collection, test.symbol, test.kind, test.properties), func(t *testing.T) {
			value := NodeNotation{Collection: test.collection, Symbol: test.symbol, DiagramKind: test.kind, Properties: json.RawMessage(test.properties)}
			for index := 0; index < test.maximum; index++ {
				value.Compartments = append(value.Compartments, NotationCompartment{ID: fmt.Sprintf("custom-section-%d", index), Title: fmt.Sprintf("Section %d", index), Lines: []string{fmt.Sprintf("Private line %d", index)}})
			}
			if err := ValidateNodeNotation(&value); err != nil {
				t.Fatal("supported layout rejected", err)
			}
			encoded, _ := json.Marshal(value)
			var decoded NodeNotation
			if err := json.Unmarshal(encoded, &decoded); err != nil || !reflect.DeepEqual(decoded.Compartments, value.Compartments) {
				t.Fatal("valid sections must not be dropped or renamed", string(encoded), err)
			}
			value.Compartments = append(value.Compartments, NotationCompartment{ID: "overflow", Lines: []string{"Content that cannot fit the fixed layout"}})
			if ValidateNodeNotation(&value) == nil {
				t.Fatal("hidden overflow section accepted", value)
			}
			encoded, _ = json.Marshal(value)
			if json.Unmarshal(encoded, &decoded) == nil {
				t.Fatal("complete native input accepted hidden sections", string(encoded))
			}
		})
	}
}

func TestNotationCatalogDTOsRoundTripWithoutChangingNativeTypes(t *testing.T) {
	for _, collection := range StandardNotationCatalog.Collections {
		if !Contains(NotationCollections, collection.ID) {
			t.Fatal("unknown collection", collection.ID)
		}
		for _, kind := range collection.DiagramKinds {
			profile := NotationProfile{SchemaVersion: 1, Collection: collection.ID, DiagramKind: kind.ID}
			encoded, _ := json.Marshal(profile)
			var decoded NotationProfile
			if err := json.Unmarshal(encoded, &decoded); err != nil || !reflect.DeepEqual(profile, decoded) {
				t.Fatal(string(encoded), err)
			}
		}
	}
	for _, symbol := range StandardNotationCatalog.Symbols {
		graph := validGraph()
		graph.Diagram.Notation = &NotationProfile{SchemaVersion: 1, Collection: symbol.Collection, DiagramKind: symbol.DiagramKinds[0]}
		graph.Nodes[0].Notation = &NodeNotation{Collection: symbol.Collection, Symbol: symbol.ID, DiagramKind: symbol.DiagramKinds[0]}
		graph.Nodes[0].BackgroundColor = "#aB12Ef"
		encoded, _ := json.Marshal(graph)
		var decoded Graph
		if err := json.Unmarshal(encoded, &decoded); err != nil || !reflect.DeepEqual(graph, decoded) {
			t.Fatal(symbol.ID, err)
		}
		if err := ValidateGraph(decoded); err != nil || decoded.Diagram.Type != "mindmap" || decoded.Nodes[0].NodeType != "generic" {
			t.Fatal(symbol.ID, err)
		}
	}
	for _, connector := range StandardNotationCatalog.Connectors {
		value := EdgeNotation{Collection: connector.Collection, Symbol: connector.ID, SourcePort: "left", TargetPort: "right", SourceLabel: "sender", TargetLabel: "receiver", Waypoints: [][2]float64{{-1, 2}}}
		encoded, _ := json.Marshal(value)
		var decoded EdgeNotation
		if err := json.Unmarshal(encoded, &decoded); err != nil || !reflect.DeepEqual(value, decoded) {
			t.Fatal(connector.ID, err)
		}
	}
}

func TestNotationStrictJSONAndBounds(t *testing.T) {
	for _, raw := range []string{
		`null`, `[]`, `{}`, `{"collection":"uml","symbol":"unknown"}`, `{"collection":"missing","symbol":"class"}`,
		`{"collection":"uml","symbol":"class","diagramKind":"timing"}`, `{"collection":"uml","symbol":"class","unknown":true}`,
		`{"collection":"uml","symbol":"class","properties":null}`, `{"collection":"uml","symbol":"class","properties":{"unknown":true}}`,
		`{"collection":"uml","symbol":"class","properties":{"abstract":"yes"}}`, `{"collection":"uml","symbol":"class","compartments":null}`,
		`{"collection":"uml","symbol":"class","compartments":[{"id":"fields","lines":[null]}]}`,
		`{"collection":"uml","symbol":"class","compartments":[{"id":"fields","lines":[],"extra":true}]}`,
		`{"collection":"uml","symbol":"class","ports":[{"id":"in\n","side":"left"}]}`,
		`{"collection":"uml","symbol":"class","ports":[{"id":"in","side":"left","offset":1.01}]}`,
		`{"collection":"uml","symbol":"class","ports":[{"id":"same","side":"left"},{"id":"same","side":"right"}]}`,
		`{"collection":"uml","symbol":"class","relatedNodeId":"not-a-uuid"}`, `{"collection":"uml","symbol":"class","diagramKind":""}`,
	} {
		var value NodeNotation
		if err := json.Unmarshal([]byte(raw), &value); err == nil {
			t.Fatal("invalid node notation accepted", raw)
		}
	}
	for _, raw := range []string{
		`{"collection":"hipo","symbol":"hierarchy","properties":{}}`,
		`{"collection":"uml","symbol":"association","waypoints":[[1,2,3]]}`,
		`{"collection":"uml","symbol":"association","waypoints":[[null,2]]}`,
		`{"collection":"uml","symbol":"association","waypoints":[[100000001,2]]}`,
		`{"collection":"uml","symbol":"association","sourcePort":""}`,
		`{"collection":"bpmn","symbol":"sequence-flow","sourceMultiplicity":"1"}`,
		`{"collection":"bpmn","symbol":"sequence-flow","properties":{"default":true,"condition":"x > 0"}}`,
		`{"collection":"uml","symbol":"association","sourceMultiplicity":"2..1"}`,
		`{"collection":"uml","symbol":"association","sourceMultiplicity":"01"}`,
		`{"collection":"uml","symbol":"association","sourceMultiplicity":"9007199254740992"}`,
		`{"collection":"uml","symbol":"association","sourceMultiplicity":"1\n"}`,
	} {
		var value EdgeNotation
		if err := json.Unmarshal([]byte(raw), &value); err == nil {
			t.Fatal("invalid connector notation accepted", raw)
		}
	}
	for _, multiplicity := range []string{"*", "0", "1", "0..*", "2..5", "9007199254740991"} {
		if !validateNotationMultiplicity(multiplicity) {
			t.Fatal("valid multiplicity rejected", multiplicity)
		}
	}
	value := NodeNotation{Collection: "uml", Symbol: "class", Compartments: []NotationCompartment{{ID: "fields", Lines: []string{strings.Repeat("x", notationLimit("text")+1)}}}}
	if ValidateNodeNotation(&value) == nil {
		t.Fatal("overlong compartment line accepted")
	}
	value.Compartments = []NotationCompartment{{ID: "fields", Lines: make([]string, notationLimit("linesPerCompartment")+1)}}
	if ValidateNodeNotation(&value) == nil {
		t.Fatal("too many compartment lines accepted")
	}
	value.Compartments = []NotationCompartment{{ID: "fields", Lines: make([]string, 51)}}
	for index := range value.Compartments[0].Lines {
		value.Compartments[0].Lines[index] = strings.Repeat("x", 2000)
	}
	if ValidateNodeNotation(&value) == nil {
		t.Fatal("aggregate compartment text bound ignored")
	}
}

func TestNotationBPMNContextMatrixAndDraftAttachment(t *testing.T) {
	for _, test := range []struct {
		context, symbol string
		flags           map[string]any
	}{
		{"topLevelStart", "start-event", nil},
		{"eventSubProcessStart", "start-event", map[string]any{"eventSubProcess": true}},
		{"nonInterruptingStart", "start-event", map[string]any{"eventSubProcess": true, "nonInterrupting": true}},
		{"intermediateCatch", "intermediate-catch-event", nil},
		{"boundary", "boundary-event", nil},
		{"nonInterruptingBoundary", "boundary-event", map[string]any{"nonInterrupting": true}},
		{"intermediateThrow", "intermediate-throw-event", nil},
		{"end", "end-event", nil},
	} {
		for _, trigger := range []string{"none", "message", "timer", "error", "escalation", "cancel", "compensation", "conditional", "link", "signal", "terminate", "multiple", "parallel-multiple"} {
			properties := map[string]any{"eventDefinition": trigger}
			for key, value := range test.flags {
				properties[key] = value
			}
			encoded, _ := json.Marshal(properties)
			value := NodeNotation{Collection: "bpmn", Symbol: test.symbol, Properties: encoded}
			err := ValidateNodeNotation(&value)
			if (err == nil) != Contains(StandardNotationCatalog.BPMNEventContexts[test.context], trigger) {
				t.Fatal("event matrix differs", test.context, trigger, err)
			}
		}
	}
	for _, raw := range []string{
		`{"collection":"bpmn","symbol":"start-event","properties":{"nonInterrupting":true}}`,
		`{"collection":"bpmn","symbol":"start-event","properties":{"eventSubProcess":true}}`,
		`{"collection":"bpmn","symbol":"event-based-gateway","properties":{"parallel":true}}`,
	} {
		var value NodeNotation
		if json.Unmarshal([]byte(raw), &value) == nil {
			t.Fatal("invalid BPMN context accepted", raw)
		}
	}
	graph := validGraph()
	graph.Nodes[0].Notation = &NodeNotation{Collection: "bpmn", Symbol: "boundary-event"}
	if err := ValidateGraph(graph); err != nil {
		t.Fatal("missing boundary attachment remains an editable draft", err)
	}
}

func TestNotationPatchReplacesPreservesAndClearsOnlyOptionalField(t *testing.T) {
	node := validGraph().Nodes[0]
	node.Notation = &NodeNotation{Collection: "uml", Symbol: "class", Properties: json.RawMessage(`{"abstract":true}`)}
	node.BackgroundColor = "#123456"
	var result Node
	if err := MergePatch(node, map[string]json.RawMessage{"title": json.RawMessage(`"Renamed"`)}, &result); err != nil || !reflect.DeepEqual(result.Notation, node.Notation) {
		t.Fatal("omitted notation lost", err)
	}
	if err := MergePatch(node, map[string]json.RawMessage{"notation": json.RawMessage(`{"collection":"uml","symbol":"object"}`)}, &result); err != nil || result.Notation.Symbol != "object" || len(result.Notation.Properties) != 0 {
		t.Fatal("notation must be replaced as a whole", result, err)
	}
	if err := MergePatch(node, map[string]json.RawMessage{"notation": json.RawMessage(`null`)}, &result); err != nil {
		t.Fatal(err)
	}
	expected := node
	expected.Notation = nil
	if !reflect.DeepEqual(expected, result) {
		t.Fatal("null must clear only notation", result)
	}
	for _, record := range []any{Diagram{}, Node{}, Edge{}} {
		encoded, _ := json.Marshal(record)
		var fields map[string]json.RawMessage
		_ = json.Unmarshal(encoded, &fields)
		fields["notation"] = json.RawMessage(`null`)
		encoded, _ = json.Marshal(fields)
		var destination any
		switch record.(type) {
		case Diagram:
			destination = &Diagram{}
		case Node:
			destination = &Node{}
		case Edge:
			destination = &Edge{}
		}
		if json.Unmarshal(encoded, destination) == nil {
			t.Fatal("complete record accepted null notation", string(encoded))
		}
	}
}

func TestNotationAndIBMNodeAppearancesRequireExplicitSwitch(t *testing.T) {
	graph := validGraph()
	node := graph.Nodes[0]
	node.FlowchartSymbol = "ibm-process"
	node.BackgroundColor = "#aB12Ef"
	if err := ValidateNode(node); err != nil {
		t.Fatal("IBM-only appearance must remain valid", err)
	}
	conflicting := node
	conflicting.Notation = &NodeNotation{Collection: "uml", Symbol: "class"}
	graph.Nodes[0] = conflicting
	if ValidateGraph(graph) == nil {
		t.Fatal("canonical graph accepted competing appearances")
	}
	encoded, _ := json.Marshal(conflicting)
	var result Node
	if json.Unmarshal(encoded, &result) == nil {
		t.Fatal("complete DTO accepted competing appearances")
	}
	notation := json.RawMessage(`{"collection":"uml","symbol":"class"}`)
	if MergePatch(node, map[string]json.RawMessage{"notation": notation}, &result) == nil {
		t.Fatal("partial write silently hid the existing IBM appearance")
	}
	if err := MergePatch(node, map[string]json.RawMessage{"notation": notation, "flowchartSymbol": json.RawMessage(`null`)}, &result); err != nil {
		t.Fatal("explicit switch to notation failed", err)
	}
	expected := node
	expected.FlowchartSymbol = ""
	expected.Notation = &NodeNotation{Collection: "uml", Symbol: "class"}
	if !reflect.DeepEqual(result, expected) || ValidateNode(result) != nil {
		t.Fatal("switch must preserve native fields and background", result)
	}
	if err := MergePatch(result, map[string]json.RawMessage{"notation": json.RawMessage(`null`), "flowchartSymbol": json.RawMessage(`"ibm-process"`)}, &result); err != nil || !reflect.DeepEqual(result, node) {
		t.Fatal("explicit switch back to IBM failed", result, err)
	}
}

func TestNotationGraphReferencesAndEndpointPortDirection(t *testing.T) {
	graph := validGraph()
	first := &graph.Nodes[0]
	first.Notation = &NodeNotation{Collection: "bpmn", Symbol: "task", Ports: []NotationPort{{ID: "right", Side: "right", Direction: "out"}}}
	second := Node{Title: "Boundary", DiagramID: graph.Diagram.ID, Notation: &NodeNotation{Collection: "bpmn", Symbol: "boundary-event", AttachmentID: first.ID}}
	NormalizeNode(&second)
	graph.Nodes = append(graph.Nodes, second)
	edge := Edge{DiagramID: graph.Diagram.ID, SourceNodeID: graph.Nodes[0].ID, TargetNodeID: second.ID, Notation: &EdgeNotation{Collection: "bpmn", Symbol: "sequence-flow", SourcePort: "right", TargetPort: "left"}}
	NormalizeEdge(&edge)
	graph.Edges = []Edge{edge}
	if err := ValidateGraph(graph); err != nil {
		t.Fatal(err)
	}
	graph.Nodes[0].Notation.Ports[0].Direction = "in"
	if ValidateGraph(graph) == nil {
		t.Fatal("source inbound-only port accepted")
	}
	graph.Nodes[0].Notation.Ports[0].Direction = "out"
	graph.Edges[0].Notation.TargetPort = "missing"
	if ValidateGraph(graph) == nil {
		t.Fatal("missing custom target port accepted")
	}
	graph.Edges[0].Notation.TargetPort = "left"
	graph.Nodes[1].Notation.AttachmentID = graph.Nodes[1].ID
	if ValidateGraph(graph) == nil {
		t.Fatal("self attachment accepted")
	}
	graph.Nodes[1].Notation.AttachmentID = UUID()
	if ValidateGraph(graph) == nil {
		t.Fatal("dangling attachment accepted")
	}
	graph.Nodes[1].Notation.AttachmentID = graph.Nodes[0].ID
	graph.Nodes[0].Notation.Symbol = "start-event"
	if ValidateGraph(graph) == nil {
		t.Fatal("boundary attached to a non-activity accepted")
	}
}

func TestNotationTimingStatesRejectInventedOrMalformedIntervals(t *testing.T) {
	for _, properties := range []string{
		`{"timeStart":0,"timeEnd":3,"timingStates":[{"time":0,"state":"Idle"},{"time":2,"state":"Busy"}]}`,
		`{"timingStates":[]}`, `{}`,
	} {
		value := NodeNotation{Collection: "uml", Symbol: "timing-lifeline", Properties: json.RawMessage(properties)}
		if err := ValidateNodeNotation(&value); err != nil {
			t.Fatal("valid timing state data rejected", properties, err)
		}
	}
	for _, properties := range []string{
		`{"timeStart":3,"timeEnd":0}`, `{"timingStates":null}`, `{"timingStates":{}}`,
		`{"timingStates":[{"time":1,"state":"Idle"},{"time":1,"state":"Busy"}]}`,
		`{"timingStates":[{"time":2,"state":"Idle"},{"time":1,"state":"Busy"}]}`,
		`{"timingStates":[{"time":1,"state":""}]}`, `{"timingStates":[{"time":null,"state":"Idle"}]}`,
		`{"timingStates":[{"time":1,"state":"Idle","extra":true}]}`, `{"timingStates":[{"time":1}]}`,
		`{"timeStart":2,"timingStates":[{"time":1,"state":"Idle"}]}`, `{"timeEnd":0,"timingStates":[{"time":1,"state":"Idle"}]}`,
		`{"timingStates":[{"time":100000001,"state":"Idle"}]}`,
	} {
		value := NodeNotation{Collection: "uml", Symbol: "timing-lifeline", Properties: json.RawMessage(properties)}
		if ValidateNodeNotation(&value) == nil {
			t.Fatal("invalid timing state data accepted", properties)
		}
	}
	states := []map[string]any{}
	for index := 0; index <= notationLimit("timingStates"); index++ {
		states = append(states, map[string]any{"time": index, "state": "Idle"})
	}
	properties, _ := json.Marshal(map[string]any{"timingStates": states})
	if ValidateNodeNotation(&NodeNotation{Collection: "uml", Symbol: "timing-lifeline", Properties: properties}) == nil {
		t.Fatal("too many timing states accepted")
	}
}

func TestNotationUMLAttachmentWhitelistMatchesCatalog(t *testing.T) {
	for symbol, allowed := range StandardNotationCatalog.UMLAttachmentTargets {
		for _, targetSymbol := range allowed {
			graph := validGraph()
			graph.Nodes[0].Notation = &NodeNotation{Collection: "uml", Symbol: targetSymbol}
			attachment := Node{DiagramID: graph.Diagram.ID, Title: "Attachment", Notation: &NodeNotation{Collection: "uml", Symbol: symbol, AttachmentID: graph.Nodes[0].ID}}
			NormalizeNode(&attachment)
			graph.Nodes = append(graph.Nodes, attachment)
			if err := ValidateGraph(graph); err != nil {
				t.Fatal("source-backed UML attachment rejected", symbol, targetSymbol, err)
			}
			graph.Nodes[0].Notation.Symbol = "note"
			if ValidateGraph(graph) == nil {
				t.Fatal("invalid UML attachment target accepted", symbol)
			}
		}
	}
}
