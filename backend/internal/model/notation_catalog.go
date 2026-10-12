package model

import (
	_ "embed"
	"encoding/json"
)

//go:embed notation_catalog.json
var notationCatalogJSON []byte

type NotationSource struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Locator string `json:"locator"`
}

type NotationPropertyDefinition struct {
	Key     string   `json:"key"`
	Label   string   `json:"label"`
	Type    string   `json:"type"`
	Values  []string `json:"values,omitempty"`
	Minimum *float64 `json:"minimum,omitempty"`
	Maximum *float64 `json:"maximum,omitempty"`
}

type NotationCollection struct {
	ID           string `json:"id"`
	Label        string `json:"label"`
	DiagramKinds []struct {
		ID    string `json:"id"`
		Label string `json:"label"`
	} `json:"diagramKinds"`
	Sources     []NotationSource `json:"sources"`
	Limitations []string         `json:"limitations"`
}

type NotationSymbol struct {
	Collection   string   `json:"collection"`
	ID           string   `json:"id"`
	Label        string   `json:"label"`
	Category     string   `json:"category"`
	DiagramKinds []string `json:"diagramKinds"`
	DefaultSize  struct {
		Width  float64 `json:"width"`
		Height float64 `json:"height"`
	} `json:"defaultSize"`
	Geometry     string                       `json:"geometry"`
	Properties   []NotationPropertyDefinition `json:"properties"`
	Compartments []string                     `json:"compartments,omitempty"`
	Container    bool                         `json:"container,omitempty"`
	Source       NotationSource               `json:"source"`
}

type NotationEdgeSymbol struct {
	Collection       string                       `json:"collection"`
	ID               string                       `json:"id"`
	Label            string                       `json:"label"`
	DiagramKinds     []string                     `json:"diagramKinds"`
	Line             string                       `json:"line"`
	SourceDecoration string                       `json:"sourceDecoration"`
	TargetDecoration string                       `json:"targetDecoration"`
	Properties       []NotationPropertyDefinition `json:"properties"`
	Source           NotationSource               `json:"source"`
}

type NotationCatalog struct {
	SchemaVersion        int                                             `json:"schemaVersion"`
	Collections          []NotationCollection                            `json:"collections"`
	Symbols              []NotationSymbol                                `json:"symbols"`
	Connectors           []NotationEdgeSymbol                            `json:"connectors"`
	Limits               map[string]float64                              `json:"limits"`
	BPMNEventContexts    map[string][]string                             `json:"bpmnEventContexts"`
	UMLAttachmentTargets map[string][]string                             `json:"umlAttachmentTargets"`
	CompartmentLimits    map[string]map[string]NotationCompartmentBounds `json:"compartmentLimits"`
}

// The trusted registry uses a number for a fixed bound and a default/detail
// object for the IPO layout. Both forms preserve the same canonical rule.
type NotationCompartmentBounds struct {
	Default int `json:"default"`
	Detail  int `json:"detail,omitempty"`
}

func (bounds *NotationCompartmentBounds) UnmarshalJSON(data []byte) error {
	var maximum int
	if err := json.Unmarshal(data, &maximum); err == nil {
		*bounds = NotationCompartmentBounds{Default: maximum}
		return nil
	}
	type native NotationCompartmentBounds
	return json.Unmarshal(data, (*native)(bounds))
}

var StandardNotationCatalog = func() NotationCatalog {
	var catalog NotationCatalog
	if err := json.Unmarshal(notationCatalogJSON, &catalog); err != nil {
		panic(err)
	}
	if catalog.SchemaVersion != 1 || len(catalog.Collections) != 5 || len(catalog.Symbols) == 0 || len(catalog.Connectors) == 0 || len(catalog.CompartmentLimits) == 0 {
		panic("invalid embedded notation contract; regenerate from the trusted browser registry")
	}
	return catalog
}()

func NotationNodeSymbol(collection, id string) *NotationSymbol {
	for index := range StandardNotationCatalog.Symbols {
		entry := &StandardNotationCatalog.Symbols[index]
		if entry.Collection == collection && entry.ID == id {
			return entry
		}
	}
	return nil
}

func NotationConnector(collection, id string) *NotationEdgeSymbol {
	for index := range StandardNotationCatalog.Connectors {
		entry := &StandardNotationCatalog.Connectors[index]
		if entry.Collection == collection && entry.ID == id {
			return entry
		}
	}
	return nil
}
