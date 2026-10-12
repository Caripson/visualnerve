package model

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"
)

var notationIDPattern = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)
var notationMultiplicityPattern = regexp.MustCompile(`^(\*|(0|[1-9][0-9]*)(\.\.(\*|0|[1-9][0-9]*))?)$`)

func notationLimit(key string) int {
	value, exists := StandardNotationCatalog.Limits[key]
	if !exists || value < 1 {
		panic("missing canonical notation limit: " + key)
	}
	return int(value)
}

func notationText(value string, maximum int) bool {
	return len(utf16.Encode([]rune(value))) <= maximum
}

func notationID(value string) bool {
	return notationText(value, notationLimit("id")) && notationIDPattern.MatchString(value)
}

func notationNumber(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && math.Abs(value) <= float64(notationLimit("coordinate"))
}

func NotationCompartmentLimit(notation *NodeNotation) int {
	maximum := notationLimit("compartments")
	if notation == nil {
		return maximum
	}
	if rule, exists := StandardNotationCatalog.CompartmentLimits[notation.Collection][notation.Symbol]; exists {
		maximum = rule.Default
		if rule.Detail > 0 {
			var properties struct {
				Detail string `json:"detail"`
			}
			_ = json.Unmarshal(notation.Properties, &properties)
			if notation.DiagramKind == "detail-ipo" || properties.Detail == "detail" {
				maximum = rule.Detail
			}
		}
	}
	return maximum
}

func ValidateNotationProfile(profile *NotationProfile) error {
	if profile == nil {
		return nil
	}
	if profile.SchemaVersion != 1 || !Contains(NotationCollections, profile.Collection) || !Contains(NotationDiagramKinds[profile.Collection], profile.DiagramKind) {
		return fmt.Errorf("notation profile requires schemaVersion 1 and a supported collection/diagramKind")
	}
	return nil
}

func notationProperties(raw json.RawMessage, definitions []NotationPropertyDefinition) (map[string]json.RawMessage, error) {
	if len(raw) == 0 {
		return map[string]json.RawMessage{}, nil
	}
	allowed := []string{}
	for _, definition := range definitions {
		allowed = append(allowed, definition.Key)
	}
	fields, err := notationObject(raw, nil, allowed)
	if err != nil {
		return nil, err
	}
	for _, definition := range definitions {
		value, exists := fields[definition.Key]
		if !exists {
			continue
		}
		switch definition.Type {
		case "text", "enum":
			var text string
			if json.Unmarshal(value, &text) != nil || !notationText(text, notationLimit("text")) || (definition.Type == "enum" && !Contains(definition.Values, text)) {
				return nil, fmt.Errorf("unsupported notation property %s", definition.Key)
			}
		case "boolean":
			var boolean bool
			if json.Unmarshal(value, &boolean) != nil {
				return nil, fmt.Errorf("notation property %s must be boolean", definition.Key)
			}
		case "number", "integer":
			var number float64
			if json.Unmarshal(value, &number) != nil || !notationNumber(number) || (definition.Type == "integer" && math.Trunc(number) != number) || (definition.Minimum != nil && number < *definition.Minimum) || (definition.Maximum != nil && number > *definition.Maximum) {
				return nil, fmt.Errorf("notation property %s is outside its supported numeric bounds", definition.Key)
			}
		case "timing-states":
			var points []json.RawMessage
			if json.Unmarshal(value, &points) != nil || points == nil || len(points) > notationLimit("timingStates") {
				return nil, fmt.Errorf("timing states must be a bounded array")
			}
			previous := math.Inf(-1)
			for _, raw := range points {
				point, err := notationObject(raw, []string{"time", "state"}, []string{"time", "state"})
				if err != nil {
					return nil, err
				}
				var time float64
				var state string
				if json.Unmarshal(point["time"], &time) != nil || !notationNumber(time) || time <= previous || json.Unmarshal(point["state"], &state) != nil || state == "" || !notationText(state, notationLimit("label")) {
					return nil, fmt.Errorf("timing state times must increase and states must be bounded nonempty text")
				}
				for _, bound := range []string{"timeStart", "timeEnd"} {
					if raw, exists := fields[bound]; exists {
						var number float64
						if json.Unmarshal(raw, &number) != nil || (bound == "timeStart" && time < number) || (bound == "timeEnd" && time > number) {
							return nil, fmt.Errorf("timing state lies outside the supplied time interval")
						}
					}
				}
				previous = time
			}
		default:
			return nil, fmt.Errorf("unknown notation property definition %s", definition.Type)
		}
	}
	return fields, nil
}

func ValidateNodeNotation(notation *NodeNotation) error {
	if notation == nil {
		return nil
	}
	symbol := NotationNodeSymbol(notation.Collection, notation.Symbol)
	if symbol == nil || !notationID(notation.Symbol) {
		return fmt.Errorf("unsupported notation collection/symbol")
	}
	if notation.DiagramKind != "" && !Contains(symbol.DiagramKinds, notation.DiagramKind) {
		return fmt.Errorf("notation diagramKind is not supported by this symbol")
	}
	if notation.Compartments != nil && symbol.Compartments == nil {
		return fmt.Errorf("this notation symbol does not support compartments")
	}
	if notation.AttachmentID != "" && !((notation.Collection == "bpmn" && notation.Symbol == "boundary-event") || (notation.Collection == "uml" && len(StandardNotationCatalog.UMLAttachmentTargets[notation.Symbol]) > 0)) {
		return fmt.Errorf("this notation symbol does not support attachmentId")
	}
	for _, id := range []string{notation.AttachmentID, notation.RelatedNodeID} {
		if id != "" && !ValidID(id) {
			return fmt.Errorf("notation node references must be UUIDs")
		}
	}
	if len(notation.Compartments) > notationLimit("compartments") || len(notation.Ports) > notationLimit("ports") {
		return fmt.Errorf("notation compartments or ports exceed their limits")
	}
	seen := map[string]bool{}
	total := 0
	for _, compartment := range notation.Compartments {
		if !notationID(compartment.ID) || seen[compartment.ID] || !notationText(compartment.Title, notationLimit("label")) || compartment.Lines == nil || len(compartment.Lines) > notationLimit("linesPerCompartment") {
			return fmt.Errorf("notation compartments require unique IDs and bounded titles/lines")
		}
		seen[compartment.ID] = true
		for _, line := range compartment.Lines {
			if !notationText(line, notationLimit("text")) {
				return fmt.Errorf("notation compartment line is too long")
			}
			total += len(utf16.Encode([]rune(line)))
		}
	}
	if total > notationLimit("compartmentText") {
		return fmt.Errorf("notation compartment text exceeds its aggregate limit")
	}
	seen = map[string]bool{}
	for _, port := range notation.Ports {
		if !notationID(port.ID) || seen[port.ID] || !Contains([]string{"left", "right", "top", "bottom"}, port.Side) || !notationText(port.Label, notationLimit("label")) || (port.Direction != "" && !Contains([]string{"in", "out", "both"}, port.Direction)) || (port.Offset != nil && (math.IsNaN(*port.Offset) || math.IsInf(*port.Offset, 0) || *port.Offset < 0 || *port.Offset > 1)) {
			return fmt.Errorf("notation ports require unique IDs, valid sides/directions and offsets in 0..1")
		}
		seen[port.ID] = true
	}
	properties, err := notationProperties(notation.Properties, symbol.Properties)
	if err != nil {
		return err
	}
	if len(notation.Compartments) > NotationCompartmentLimit(notation) {
		return fmt.Errorf("notation compartments exceed the supported layout limit of %d", NotationCompartmentLimit(notation))
	}
	return validateNotationNodeContext(notation, properties)
}

func validateNodeNotationAppearance(node Node) error {
	if node.Notation != nil && node.FlowchartSymbol != "" {
		return fmt.Errorf("notation and an IBM flowchart symbol cannot be set on the same node")
	}
	return nil
}

func validateNotationMultiplicity(value string) bool {
	if !notationText(value, notationLimit("multiplicity")) || !notationMultiplicityPattern.MatchString(value) {
		return false
	}
	parts := strings.Split(value, "..")
	for _, part := range parts {
		if part == "*" {
			continue
		}
		integer, err := strconv.ParseUint(part, 10, 64)
		if err != nil || integer > 9007199254740991 {
			return false
		}
	}
	if len(parts) == 2 && parts[1] != "*" {
		lower, lowerError := strconv.ParseFloat(parts[0], 64)
		upper, upperError := strconv.ParseFloat(parts[1], 64)
		return lowerError == nil && upperError == nil && lower <= upper
	}
	return true
}

func ValidateEdgeNotation(notation *EdgeNotation) error {
	if notation == nil {
		return nil
	}
	symbol := NotationConnector(notation.Collection, notation.Symbol)
	if symbol == nil || !notationID(notation.Symbol) {
		return fmt.Errorf("unsupported notation collection/connector")
	}
	for _, port := range []string{notation.SourcePort, notation.TargetPort} {
		if port != "" && !notationID(port) {
			return fmt.Errorf("notation port reference must be a supported ID")
		}
	}
	for _, label := range []string{notation.SourceLabel, notation.TargetLabel} {
		if !notationText(label, notationLimit("label")) {
			return fmt.Errorf("notation end label is too long")
		}
	}
	for _, multiplicity := range []string{notation.SourceMultiplicity, notation.TargetMultiplicity} {
		if multiplicity != "" && (notation.Collection != "uml" || !validateNotationMultiplicity(multiplicity)) {
			return fmt.Errorf("notation multiplicities require UML and a valid integer/range/*")
		}
	}
	if len(notation.Waypoints) > notationLimit("waypoints") {
		return fmt.Errorf("notation waypoints exceed their limit")
	}
	for _, point := range notation.Waypoints {
		if !notationNumber(point[0]) || !notationNumber(point[1]) {
			return fmt.Errorf("notation waypoint coordinates must be finite and bounded")
		}
	}
	if len(notation.Properties) > 0 && len(symbol.Properties) == 0 {
		return fmt.Errorf("this notation connector does not support properties")
	}
	properties, err := notationProperties(notation.Properties, symbol.Properties)
	if err != nil {
		return err
	}
	if notation.Collection == "bpmn" && notation.Symbol == "sequence-flow" && notationPropertyBool(properties, "default") {
		var condition string
		_ = json.Unmarshal(properties["condition"], &condition)
		if condition != "" {
			return fmt.Errorf("a default sequence flow cannot have a condition")
		}
	}
	return nil
}
