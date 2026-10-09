package model

import "testing"

func TestIntegrationStringsDoNotRelaxCanonicalUUIDValidation(t *testing.T) {
	graph := validGraph()
	graph.Nodes[0].ExternalID = "truck"
	owner := Owner{Name: "Engineering", ExternalID: "engineering"}
	NormalizeOwner(&owner)
	graph.Owners = []Owner{owner}
	edge := Edge{DiagramID: graph.Diagram.ID, SourceNodeID: graph.Nodes[0].ID, TargetNodeID: graph.Nodes[0].ID, ExternalID: "truck-engineering"}
	NormalizeEdge(&edge)
	graph.Edges = []Edge{edge}
	if err := ValidateGraph(graph); err != nil {
		t.Fatal("integration strings must be accepted as external identities", err)
	}
	for name, mutate := range map[string]func(*Graph){
		"diagram id":      func(g *Graph) { g.Diagram.ID = "truck" },
		"node id":         func(g *Graph) { g.Nodes[0].ID = "truck" },
		"node diagram id": func(g *Graph) { g.Nodes[0].DiagramID = "truck" },
		"owner id":        func(g *Graph) { g.Owners[0].ID = "engineering" },
		"edge id":         func(g *Graph) { g.Edges[0].ID = "truck-engineering" },
		"edge source id":  func(g *Graph) { g.Edges[0].SourceNodeID = "truck" },
		"edge target id":  func(g *Graph) { g.Edges[0].TargetNodeID = "truck" },
	} {
		t.Run(name, func(t *testing.T) {
			candidate := graph
			candidate.Nodes = append([]Node(nil), graph.Nodes...)
			candidate.Edges = append([]Edge(nil), graph.Edges...)
			candidate.Owners = append([]Owner(nil), graph.Owners...)
			mutate(&candidate)
			if ValidateGraph(candidate) == nil {
				t.Fatal("integration strings must not be accepted in canonical UUID fields")
			}
		})
	}
}
