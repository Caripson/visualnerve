package model

import (
	"encoding/json"
	"fmt"
)

func notationPropertyBool(properties map[string]json.RawMessage, key string) bool {
	var value bool
	_ = json.Unmarshal(properties[key], &value)
	return value
}

func validateNotationNodeContext(notation *NodeNotation, properties map[string]json.RawMessage) error {
	if notation.Collection == "uml" {
		var start, end float64
		_, hasStart := properties["timeStart"]
		_, hasEnd := properties["timeEnd"]
		_ = json.Unmarshal(properties["timeStart"], &start)
		_ = json.Unmarshal(properties["timeEnd"], &end)
		if hasStart && hasEnd && start > end {
			return fmt.Errorf("notation timeStart must not exceed timeEnd")
		}
	}
	if notation.Collection != "bpmn" {
		return nil
	}
	if notation.Symbol == "event-based-gateway" && notationPropertyBool(properties, "parallel") && !notationPropertyBool(properties, "instantiating") {
		return fmt.Errorf("parallel event-based gateways must be instantiating")
	}
	context := ""
	definition := "none"
	switch notation.Symbol {
	case "start-event":
		context = "topLevelStart"
		if notationPropertyBool(properties, "eventSubProcess") {
			context = "eventSubProcessStart"
		}
		if notationPropertyBool(properties, "nonInterrupting") {
			if !notationPropertyBool(properties, "eventSubProcess") {
				return fmt.Errorf("non-interrupting start events require eventSubProcess:true")
			}
			context = "nonInterruptingStart"
		}
	case "intermediate-catch-event":
		context, definition = "intermediateCatch", "message"
	case "boundary-event":
		context, definition = "boundary", "message"
		if notationPropertyBool(properties, "nonInterrupting") {
			context = "nonInterruptingBoundary"
		}
	case "intermediate-throw-event":
		context = "intermediateThrow"
	case "end-event":
		context = "end"
	}
	if context != "" {
		if raw, exists := properties["eventDefinition"]; exists {
			_ = json.Unmarshal(raw, &definition)
		}
		if !Contains(StandardNotationCatalog.BPMNEventContexts[context], definition) {
			return fmt.Errorf("BPMN event definition is not supported in context %s", context)
		}
	}
	return nil
}

func validateNotationEndpointPort(node Node, id string, source bool) error {
	if id == "" {
		return nil
	}
	if node.Notation != nil {
		for _, port := range node.Notation.Ports {
			if port.ID != id {
				continue
			}
			if (source && port.Direction == "in") || (!source && port.Direction == "out") {
				return fmt.Errorf("notation endpoint port direction does not permit this connection")
			}
			return nil
		}
	}
	if Contains([]string{"left", "right", "top", "bottom"}, id) {
		return nil
	}
	return fmt.Errorf("notation connector refers to a missing endpoint port")
}

// Referential/shape validity is mandatory. Incomplete diagrams and mixed
// profile placements remain editable drafts reported by the browser's pure
// notation validation endpoint, rather than a second execution engine here.
func ValidateNotationGraph(graph Graph) error {
	if err := ValidateNotationProfile(graph.Diagram.Notation); err != nil {
		return err
	}
	nodes := map[string]Node{}
	for _, node := range graph.Nodes {
		if err := ValidateNodeNotation(node.Notation); err != nil {
			return err
		}
		nodes[node.ID] = node
	}
	for _, node := range graph.Nodes {
		if node.Notation == nil {
			continue
		}
		for _, id := range []string{node.Notation.AttachmentID, node.Notation.RelatedNodeID} {
			if id == "" {
				continue
			}
			if _, exists := nodes[id]; !exists || id == node.ID {
				return fmt.Errorf("notation node reference must resolve to another node in this graph")
			}
			if id == node.Notation.AttachmentID {
				target := nodes[id].Notation
				allowed := StandardNotationCatalog.UMLAttachmentTargets[node.Notation.Symbol]
				if node.Notation.Collection == "bpmn" {
					allowed = []string{"task", "subprocess", "event-subprocess", "transaction", "call-activity", "ad-hoc-subprocess"}
				}
				if target == nil || target.Collection != node.Notation.Collection || !Contains(allowed, target.Symbol) {
					return fmt.Errorf("notation attachment must target a supported symbol in its collection")
				}
			}
		}
	}
	for _, edge := range graph.Edges {
		if err := ValidateEdgeNotation(edge.Notation); err != nil {
			return err
		}
		if edge.Notation == nil {
			continue
		}
		source, hasSource := nodes[edge.SourceNodeID]
		target, hasTarget := nodes[edge.TargetNodeID]
		if !hasSource || !hasTarget {
			return fmt.Errorf("notation edge requires existing native endpoint nodes")
		}
		if err := validateNotationEndpointPort(source, edge.Notation.SourcePort, true); err != nil {
			return err
		}
		if err := validateNotationEndpointPort(target, edge.Notation.TargetPort, false); err != nil {
			return err
		}
	}
	return nil
}
