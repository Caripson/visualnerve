package model

import "encoding/json"

var NotationCollections = []string{"hipo", "dfd-yourdon", "dfd-gane-sarson", "uml", "bpmn"}

var NotationDiagramKinds = map[string][]string{
	"hipo":            {"vtoc", "overview-ipo", "detail-ipo"},
	"dfd-yourdon":     {"context", "data-flow"},
	"dfd-gane-sarson": {"context", "data-flow"},
	"uml":             {"class", "object", "component", "composite-structure", "package", "deployment", "profile", "use-case", "activity", "state-machine", "sequence", "communication", "interaction-overview", "timing"},
	"bpmn":            {"process", "collaboration", "choreography", "conversation"},
}

type NotationProfile struct {
	SchemaVersion int    `json:"schemaVersion"`
	Collection    string `json:"collection"`
	DiagramKind   string `json:"diagramKind"`
}

type NotationCompartment struct {
	ID    string   `json:"id"`
	Title string   `json:"title,omitempty"`
	Lines []string `json:"lines"`
}

type NotationPort struct {
	ID        string   `json:"id"`
	Side      string   `json:"side"`
	Offset    *float64 `json:"offset,omitempty"`
	Direction string   `json:"direction,omitempty"`
	Label     string   `json:"label,omitempty"`
}

// Properties retain the exact discriminated family payload. Their strict
// collection-specific contract is validated rather than flattened to metadata.
type NodeNotation struct {
	Collection    string                `json:"collection"`
	Symbol        string                `json:"symbol"`
	DiagramKind   string                `json:"diagramKind,omitempty"`
	Compartments  []NotationCompartment `json:"compartments,omitempty"`
	Ports         []NotationPort        `json:"ports,omitempty"`
	AttachmentID  string                `json:"attachmentId,omitempty"`
	RelatedNodeID string                `json:"relatedNodeId,omitempty"`
	Properties    json.RawMessage       `json:"properties,omitempty"`
}

type EdgeNotation struct {
	Collection         string          `json:"collection"`
	Symbol             string          `json:"symbol"`
	SourcePort         string          `json:"sourcePort,omitempty"`
	TargetPort         string          `json:"targetPort,omitempty"`
	SourceLabel        string          `json:"sourceLabel,omitempty"`
	TargetLabel        string          `json:"targetLabel,omitempty"`
	SourceMultiplicity string          `json:"sourceMultiplicity,omitempty"`
	TargetMultiplicity string          `json:"targetMultiplicity,omitempty"`
	Waypoints          [][2]float64    `json:"waypoints,omitempty"`
	Properties         json.RawMessage `json:"properties,omitempty"`
}
