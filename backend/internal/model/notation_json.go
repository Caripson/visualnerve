package model

import (
	"bytes"
	"encoding/json"
	"fmt"
)

func notationObject(data []byte, required, allowed []string) (map[string]json.RawMessage, error) {
	var fields map[string]json.RawMessage
	if json.Unmarshal(data, &fields) != nil || fields == nil {
		return nil, fmt.Errorf("notation must be an object")
	}
	for _, key := range required {
		if _, exists := fields[key]; !exists {
			return nil, fmt.Errorf("notation requires %s", key)
		}
	}
	for key, value := range fields {
		if !Contains(allowed, key) || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return nil, fmt.Errorf("unsupported or null notation field %s", key)
		}
	}
	return fields, nil
}

func notationFieldNotNull(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if value, exists := fields["notation"]; exists && bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
		return fmt.Errorf("complete notation must be omitted or an object; null only clears partial updates")
	}
	return nil
}

func notationPresentStrings(fields map[string]json.RawMessage, keys ...string) error {
	for _, key := range keys {
		if raw, exists := fields[key]; exists {
			var value string
			if json.Unmarshal(raw, &value) != nil || value == "" {
				return fmt.Errorf("notation field %s must be a nonempty string", key)
			}
		}
	}
	return nil
}

func (profile *NotationProfile) UnmarshalJSON(data []byte) error {
	type native NotationProfile
	if _, err := notationObject(data, []string{"schemaVersion", "collection", "diagramKind"}, []string{"schemaVersion", "collection", "diagramKind"}); err != nil {
		return err
	}
	var decoded native
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	if err := ValidateNotationProfile((*NotationProfile)(&decoded)); err != nil {
		return err
	}
	*profile = NotationProfile(decoded)
	return nil
}

func (notation *NodeNotation) UnmarshalJSON(data []byte) error {
	type native NodeNotation
	fields, err := notationObject(data, []string{"collection", "symbol"}, []string{"collection", "symbol", "diagramKind", "compartments", "ports", "attachmentId", "relatedNodeId", "properties"})
	if err != nil {
		return err
	}
	if err := notationPresentStrings(fields, "diagramKind", "attachmentId", "relatedNodeId"); err != nil {
		return err
	}
	var decoded native
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	if err := ValidateNodeNotation((*NodeNotation)(&decoded)); err != nil {
		return err
	}
	*notation = NodeNotation(decoded)
	return nil
}

func (notation *EdgeNotation) UnmarshalJSON(data []byte) error {
	type native EdgeNotation
	fields, err := notationObject(data, []string{"collection", "symbol"}, []string{"collection", "symbol", "sourcePort", "targetPort", "sourceLabel", "targetLabel", "sourceMultiplicity", "targetMultiplicity", "waypoints", "properties"})
	if err != nil {
		return err
	}
	if err := notationPresentStrings(fields, "sourcePort", "targetPort", "sourceMultiplicity", "targetMultiplicity"); err != nil {
		return err
	}
	if raw, exists := fields["waypoints"]; exists {
		var points [][]json.RawMessage
		if err := json.Unmarshal(raw, &points); err != nil {
			return err
		}
		for _, point := range points {
			if len(point) != 2 {
				return fmt.Errorf("notation waypoints must contain exactly two coordinates")
			}
			for _, coordinate := range point {
				if bytes.Equal(bytes.TrimSpace(coordinate), []byte("null")) {
					return fmt.Errorf("notation waypoint coordinates must be numbers")
				}
			}
		}
	}
	var decoded native
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	if err := ValidateEdgeNotation((*EdgeNotation)(&decoded)); err != nil {
		return err
	}
	*notation = EdgeNotation(decoded)
	return nil
}

func (compartment *NotationCompartment) UnmarshalJSON(data []byte) error {
	type native NotationCompartment
	fields, err := notationObject(data, []string{"id", "lines"}, []string{"id", "title", "lines"})
	if err != nil {
		return err
	}
	var lines []json.RawMessage
	if err := json.Unmarshal(fields["lines"], &lines); err != nil {
		return err
	}
	for _, line := range lines {
		if len(bytes.TrimSpace(line)) == 0 || bytes.TrimSpace(line)[0] != '"' {
			return fmt.Errorf("notation compartment lines must be strings")
		}
	}
	var decoded native
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*compartment = NotationCompartment(decoded)
	return nil
}

func (port *NotationPort) UnmarshalJSON(data []byte) error {
	type native NotationPort
	fields, err := notationObject(data, []string{"id", "side"}, []string{"id", "side", "offset", "direction", "label"})
	if err != nil {
		return err
	}
	if err := notationPresentStrings(fields, "direction"); err != nil {
		return err
	}
	var decoded native
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*port = NotationPort(decoded)
	return nil
}

func (diagram *Diagram) UnmarshalJSON(data []byte) error {
	type native Diagram
	if err := notationFieldNotNull(data); err != nil {
		return err
	}
	var decoded native
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*diagram = Diagram(decoded)
	return nil
}

func (edge *Edge) UnmarshalJSON(data []byte) error {
	type native Edge
	if err := notationFieldNotNull(data); err != nil {
		return err
	}
	var decoded native
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*edge = Edge(decoded)
	return nil
}
