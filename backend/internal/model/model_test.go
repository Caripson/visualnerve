package model

import "testing"

func validGraph() Graph {
	d := Diagram{Name: "Plan", Type: "mindmap"}
	NormalizeDiagram(&d)
	n := Node{Title: "Root", DiagramID: d.ID}
	NormalizeNode(&n)
	return Graph{Diagram: d, Nodes: []Node{n}, Edges: []Edge{}, Owners: []Owner{}}
}
func TestGraphValidation(t *testing.T) {
	g := validGraph()
	if err := ValidateGraph(g); err != nil {
		t.Fatal(err)
	}
	g.Nodes[0].ParentID = g.Nodes[0].ID
	if ValidateGraph(g) == nil {
		t.Fatal("cycle accepted")
	}
	g.Nodes[0].ParentID = ""
	g.Nodes[0].OwnerIDs = []string{UUID()}
	if ValidateGraph(g) == nil {
		t.Fatal("unknown owner accepted")
	}
}
func TestDatesAndURL(t *testing.T) {
	n := validGraph().Nodes[0]
	n.StartDate = "2026-02-30"
	if ValidateNode(n) == nil {
		t.Fatal("invalid date accepted")
	}
	n.StartDate = "2026-02-01"
	n.EndDate = "2026-01-01"
	if ValidateNode(n) == nil {
		t.Fatal("date inversion accepted")
	}
	n.EndDate = ""
	n.URL = "javascript:alert(1)"
	if ValidateNode(n) == nil {
		t.Fatal("unsafe URL accepted")
	}
}
func TestUUID(t *testing.T) {
	for i := 0; i < 100; i++ {
		if !ValidID(UUID()) {
			t.Fatal("invalid UUID")
		}
	}
}
