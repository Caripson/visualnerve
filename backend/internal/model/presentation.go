package model

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

type PresentationDefinition struct {
	Version        int      `json:"version"`
	NodeIDs        []string `json:"nodeIds"`
	SecondsPerNode float64  `json:"secondsPerNode"`
	TransitionMS   float64  `json:"transitionMs"`
}

func presentationObject(data json.RawMessage, allowed ...string) (map[string]json.RawMessage, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil || fields == nil {
		return nil, fmt.Errorf("presentation input must be an object")
	}
	for key := range fields {
		if !Contains(allowed, key) {
			return nil, fmt.Errorf("unknown presentation field: %s", key)
		}
		if bytes.Equal(bytes.TrimSpace(fields[key]), []byte("null")) {
			return nil, fmt.Errorf("presentation field %s must not be null", key)
		}
	}
	return fields, nil
}

func presentationSource(fields map[string]json.RawMessage) error {
	if raw, exists := fields["source"]; exists {
		var source string
		if json.Unmarshal(raw, &source) != nil || !Contains([]string{"nodes", "storyboard"}, source) {
			return fmt.Errorf("presentation source must be nodes or storyboard")
		}
	}
	return nil
}

func ValidatePresentationDefinition(data json.RawMessage) (PresentationDefinition, error) {
	var definition PresentationDefinition
	fields, err := presentationObject(data, "version", "nodeIds", "secondsPerNode", "transitionMs")
	if err != nil {
		return definition, err
	}
	if len(fields) != 4 || json.Unmarshal(data, &definition) != nil || definition.Version != 1 {
		return definition, fmt.Errorf("presentation requires version 1, nodeIds, secondsPerNode and transitionMs")
	}
	if len(definition.NodeIDs) > 20000 || definition.NodeIDs == nil {
		return definition, fmt.Errorf("presentation supports at most 20,000 node IDs")
	}
	seen := map[string]bool{}
	for _, id := range definition.NodeIDs {
		if !ValidID(id) || seen[id] {
			return definition, fmt.Errorf("presentation IDs must be unique UUIDs")
		}
		seen[id] = true
	}
	if math.IsNaN(definition.SecondsPerNode) || math.IsInf(definition.SecondsPerNode, 0) || definition.SecondsPerNode < 2 || definition.SecondsPerNode > 600 {
		return definition, fmt.Errorf("presentation secondsPerNode must be from 2 to 600")
	}
	if math.IsNaN(definition.TransitionMS) || math.IsInf(definition.TransitionMS, 0) || definition.TransitionMS < 0 || definition.TransitionMS > 10000 {
		return definition, fmt.Errorf("presentation transitionMs must be from 0 to 10000")
	}
	return definition, nil
}

func ValidatePresentationGraph(graph Graph) error {
	value, exists := graph.Diagram.Settings["presentation"]
	if !exists {
		return nil
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("invalid presentation")
	}
	definition, err := ValidatePresentationDefinition(raw)
	if err != nil {
		return err
	}
	nodes := map[string]bool{}
	for _, node := range graph.Nodes {
		nodes[node.ID] = true
	}
	for _, id := range definition.NodeIDs {
		if !nodes[id] {
			return fmt.Errorf("presentation refers to a missing node")
		}
	}
	return nil
}

// The same strict contract is checked before HTTP and MCP forward to the browser.
func ValidatePresentationCommand(path, method string, data json.RawMessage) error {
	if path == "/presentation/video" && (method == "POST" || method == "DELETE") {
		allowed := []string{}
		if method == "POST" {
			allowed = append(allowed, "audio", "subtitles", "source")
		}
		fields, err := presentationObject(data, allowed...)
		if err != nil {
			return err
		}
		for key, raw := range fields {
			if key == "source" {
				continue
			}
			var enabled bool
			if json.Unmarshal(raw, &enabled) != nil {
				return fmt.Errorf("%s must be a boolean", key)
			}
		}
		return presentationSource(fields)
	}
	if path == "/presentation/seek" && method == "POST" {
		fields, err := presentationObject(data, "index")
		if err != nil {
			return err
		}
		var index float64
		if len(fields) != 1 || json.Unmarshal(fields["index"], &index) != nil || math.IsNaN(index) || math.IsInf(index, 0) || index < 0 || index > 9007199254740991 || math.Trunc(index) != index {
			return fmt.Errorf("seek requires a non-negative safe integer index")
		}
		return nil
	}
	if path == "/settings/presentation-voice" && method == "PUT" {
		fields, err := presentationObject(data, "value")
		if err != nil {
			return err
		}
		var voice string
		if len(fields) != 1 || json.Unmarshal(fields["value"], &voice) != nil || !Contains([]string{"en_US-ljspeech-high", "en_GB-cori-high", "sv_SE-nst-medium"}, voice) {
			return fmt.Errorf("choose a supported presentation voice")
		}
		return nil
	}
	if path == "/presentation" && method == "PATCH" {
		fields, err := presentationObject(data, "audio", "subtitles", "preload")
		if err != nil {
			return err
		}
		if len(fields) == 0 {
			return fmt.Errorf("provide at least one presentation option")
		}
		for key, raw := range fields {
			var enabled bool
			if json.Unmarshal(raw, &enabled) != nil {
				return fmt.Errorf("%s must be a boolean", key)
			}
		}
		return nil
	}
	if strings.HasPrefix(path, "/presentation/") && method == "POST" {
		action := strings.TrimPrefix(path, "/presentation/")
		if !Contains([]string{"open", "play", "pause", "rewind", "forward", "close", "preload"}, action) {
			return nil
		}
		allowed := []string{}
		if action == "open" {
			allowed = append(allowed, "diagramId", "source")
		}
		fields, err := presentationObject(data, allowed...)
		if err != nil {
			return err
		}
		if raw, exists := fields["diagramId"]; exists {
			var id string
			if json.Unmarshal(raw, &id) != nil || !ValidID(id) {
				return fmt.Errorf("diagramId must be a UUID")
			}
		}
		return presentationSource(fields)
	}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 3 && parts[0] == "diagrams" && parts[2] == "presentation" && method == "PUT" {
		fields, err := presentationObject(data, "baseVersion", "presentation")
		if err != nil {
			return err
		}
		var version int64
		if len(fields) != 2 || json.Unmarshal(fields["baseVersion"], &version) != nil || version < 1 {
			return fmt.Errorf("presentation update requires positive baseVersion and presentation")
		}
		_, err = ValidatePresentationDefinition(fields["presentation"])
		return err
	}
	return nil
}
