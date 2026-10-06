package model

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type Meta = map[string]any
type Base struct {
	ID        string `json:"id"`
	Version   int64  `json:"version"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}
type Diagram struct {
	Base
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	Type        string   `json:"type"`
	Folder      string   `json:"folder,omitempty"`
	Favorite    bool     `json:"favorite"`
	Tags        []string `json:"tags"`
	Metadata    Meta     `json:"metadata"`
	Settings    Meta     `json:"settings"`
}
type Node struct {
	Base
	DiagramID   string   `json:"diagramId"`
	ExternalID  string   `json:"externalId,omitempty"`
	NodeType    string   `json:"nodeType"`
	Title       string   `json:"title"`
	Description string   `json:"description,omitempty"`
	Notes       string   `json:"notes,omitempty"`
	URL         string   `json:"url,omitempty"`
	X           float64  `json:"x"`
	Y           float64  `json:"y"`
	Width       float64  `json:"width"`
	Height      float64  `json:"height"`
	OwnerID     string   `json:"ownerId,omitempty"`
	OwnerIDs    []string `json:"ownerIds"`
	Status      string   `json:"status,omitempty"`
	Color       string   `json:"color,omitempty"`
	StartDate   string   `json:"startDate,omitempty"`
	EndDate     string   `json:"endDate,omitempty"`
	DueDate     string   `json:"dueDate,omitempty"`
	Tags        []string `json:"tags"`
	ParentID    string   `json:"parentId,omitempty"`
	Collapsed   bool     `json:"collapsed"`
	Metadata    Meta     `json:"metadata"`
}
type Edge struct {
	Base
	DiagramID    string `json:"diagramId"`
	ExternalID   string `json:"externalId,omitempty"`
	SourceNodeID string `json:"sourceNodeId"`
	TargetNodeID string `json:"targetNodeId"`
	Label        string `json:"label,omitempty"`
	EdgeType     string `json:"edgeType"`
	Direction    string `json:"direction"`
	Style        string `json:"style"`
	Description  string `json:"description,omitempty"`
	Metadata     Meta   `json:"metadata"`
}
type Owner struct {
	Base
	ExternalID string `json:"externalId,omitempty"`
	Name       string `json:"name"`
	Email      string `json:"email,omitempty"`
	Team       string `json:"team,omitempty"`
	Role       string `json:"role,omitempty"`
	Kind       string `json:"kind"`
	Color      string `json:"color"`
	Metadata   Meta   `json:"metadata"`
}
type Graph struct {
	Format        string  `json:"format"`
	FormatVersion int     `json:"formatVersion"`
	Diagram       Diagram `json:"diagram"`
	Nodes         []Node  `json:"nodes"`
	Edges         []Edge  `json:"edges"`
	Owners        []Owner `json:"owners"`
}

var DiagramTypes = []string{"blank", "mindmap", "flowchart", "timeline", "process", "dependency", "responsibility", "freeform"}
var NodeTypes = []string{"generic", "process", "decision", "start", "end", "milestone", "timeline", "person", "team", "system", "external", "input", "output", "document", "database", "note", "group"}
var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)

func UUID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	h := hex.EncodeToString(b)
	return h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}
func ValidID(id string) bool { return uuidPattern.MatchString(id) }
func Now() string            { return time.Now().UTC().Format(time.RFC3339Nano) }
func InitBase(b *Base) {
	if b.ID == "" {
		b.ID = UUID()
	}
	if b.CreatedAt == "" {
		b.CreatedAt = Now()
	}
	if b.UpdatedAt == "" {
		b.UpdatedAt = b.CreatedAt
	}
	if b.Version < 1 {
		b.Version = 1
	}
}
func Contains(items []string, v string) bool {
	for _, x := range items {
		if x == v {
			return true
		}
	}
	return false
}
func DescendantIDs(nodes []Node, id string) map[string]bool {
	children := map[string][]string{}
	for _, n := range nodes {
		if n.ParentID != "" {
			children[n.ParentID] = append(children[n.ParentID], n.ID)
		}
	}
	result := map[string]bool{}
	queue := append([]string{}, children[id]...)
	for i := 0; i < len(queue); i++ {
		child := queue[i]
		if !result[child] {
			result[child] = true
			queue = append(queue, children[child]...)
		}
	}
	return result
}
func emptyMeta(m *Meta) {
	if *m == nil {
		*m = Meta{}
	}
}
func NormalizeDiagram(d *Diagram) {
	InitBase(&d.Base)
	if d.Type == "" {
		d.Type = "blank"
	}
	if d.Tags == nil {
		d.Tags = []string{}
	}
	emptyMeta(&d.Metadata)
	emptyMeta(&d.Settings)
}
func NormalizeNode(n *Node) {
	InitBase(&n.Base)
	if n.NodeType == "" {
		n.NodeType = "generic"
	}
	if n.Width == 0 {
		n.Width = 200
	}
	if n.Height == 0 {
		n.Height = 86
	}
	if n.Tags == nil {
		n.Tags = []string{}
	}
	emptyMeta(&n.Metadata)
	if n.OwnerIDs == nil {
		n.OwnerIDs = []string{}
		if n.OwnerID != "" {
			n.OwnerIDs = append(n.OwnerIDs, n.OwnerID)
		}
	}
	unique := []string{}
	for _, id := range n.OwnerIDs {
		if !Contains(unique, id) {
			unique = append(unique, id)
		}
	}
	n.OwnerIDs = unique
	n.OwnerID = ""
	if len(unique) > 0 {
		n.OwnerID = unique[0]
	}
}
func NormalizeEdge(e *Edge) {
	InitBase(&e.Base)
	if e.EdgeType == "" {
		e.EdgeType = "relationship"
	}
	if e.Direction == "" {
		e.Direction = "forward"
	}
	if e.Style == "" {
		e.Style = "solid"
	}
	emptyMeta(&e.Metadata)
}
func NormalizeOwner(o *Owner) {
	InitBase(&o.Base)
	if o.Kind == "" {
		o.Kind = "person"
	}
	if o.Color == "" {
		o.Color = "#31766c"
	}
	emptyMeta(&o.Metadata)
}
func ValidateDiagram(d Diagram) error {
	if !ValidID(d.ID) {
		return fmt.Errorf("diagram id must be a UUID")
	}
	if strings.TrimSpace(d.Name) == "" || len(d.Name) > 500 {
		return fmt.Errorf("diagram name is required and limited to 500 characters")
	}
	if !Contains(DiagramTypes, d.Type) {
		return fmt.Errorf("unsupported diagram type %q", d.Type)
	}
	return nil
}
func ValidateOwner(o Owner) error {
	if !ValidID(o.ID) {
		return fmt.Errorf("owner id must be a UUID")
	}
	if strings.TrimSpace(o.Name) == "" || len(o.Name) > 300 {
		return fmt.Errorf("owner name is required and limited to 300 characters")
	}
	if !Contains([]string{"person", "team", "department", "system", "organization", "external"}, o.Kind) {
		return fmt.Errorf("unsupported owner kind")
	}
	return nil
}
func ValidateNode(n Node) error {
	if !ValidID(n.ID) || !ValidID(n.DiagramID) {
		return fmt.Errorf("node and diagram ids must be UUIDs")
	}
	if strings.TrimSpace(n.Title) == "" || len(n.Title) > 1000 {
		return fmt.Errorf("node title is required and limited to 1000 characters")
	}
	if !Contains(NodeTypes, n.NodeType) {
		return fmt.Errorf("unsupported node type %q", n.NodeType)
	}
	for _, v := range []float64{n.X, n.Y, n.Width, n.Height} {
		if math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > 1e8 {
			return fmt.Errorf("invalid coordinates or dimensions")
		}
	}
	if n.Width < 40 || n.Height < 30 {
		return fmt.Errorf("node dimensions are too small")
	}
	for _, d := range []string{n.StartDate, n.EndDate, n.DueDate} {
		if d != "" {
			if _, err := time.Parse("2006-01-02", d); err != nil {
				return fmt.Errorf("dates must use YYYY-MM-DD")
			}
		}
	}
	if n.StartDate != "" && n.EndDate != "" && n.StartDate > n.EndDate {
		return fmt.Errorf("endDate cannot precede startDate")
	}
	if n.URL != "" {
		u, err := url.Parse(n.URL)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return fmt.Errorf("URL must be an absolute http or https URL")
		}
	}
	return nil
}
func ValidateEdge(e Edge) error {
	if !ValidID(e.ID) || !ValidID(e.DiagramID) || !ValidID(e.SourceNodeID) || !ValidID(e.TargetNodeID) {
		return fmt.Errorf("edge ids and endpoints must be UUIDs")
	}
	if !Contains([]string{"forward", "backward", "both", "none"}, e.Direction) {
		return fmt.Errorf("invalid edge direction")
	}
	if !Contains([]string{"solid", "dashed", "dotted"}, e.Style) {
		return fmt.Errorf("invalid edge style")
	}
	return nil
}
func ValidateGraph(g Graph) error {
	if err := ValidateDiagram(g.Diagram); err != nil {
		return err
	}
	if err := ValidatePresentationGraph(g); err != nil {
		return err
	}
	nodes := map[string]Node{}
	owners := map[string]bool{}
	external := map[string]bool{}
	for _, o := range g.Owners {
		if err := ValidateOwner(o); err != nil {
			return err
		}
		if owners[o.ID] {
			return fmt.Errorf("duplicate owner id")
		}
		owners[o.ID] = true
	}
	for _, n := range g.Nodes {
		if err := ValidateNode(n); err != nil {
			return err
		}
		if n.DiagramID != g.Diagram.ID {
			return fmt.Errorf("node belongs to another diagram")
		}
		if _, ok := nodes[n.ID]; ok {
			return fmt.Errorf("duplicate node id")
		}
		if n.ExternalID != "" {
			if external[n.ExternalID] {
				return fmt.Errorf("duplicate external node id")
			}
			external[n.ExternalID] = true
		}
		nodes[n.ID] = n
		for _, id := range n.OwnerIDs {
			if !owners[id] {
				return fmt.Errorf("unknown owner %s", id)
			}
		}
	}
	for _, n := range g.Nodes {
		seen := map[string]bool{n.ID: true}
		p := n.ParentID
		for p != "" {
			parent, ok := nodes[p]
			if !ok {
				return fmt.Errorf("unknown parent")
			}
			if seen[p] {
				return fmt.Errorf("parent cycle")
			}
			seen[p] = true
			p = parent.ParentID
		}
	}
	edgeIDs := map[string]bool{}
	external = map[string]bool{}
	for _, e := range g.Edges {
		if err := ValidateEdge(e); err != nil {
			return err
		}
		if e.DiagramID != g.Diagram.ID {
			return fmt.Errorf("edge belongs to another diagram")
		}
		if _, ok := nodes[e.SourceNodeID]; !ok {
			return fmt.Errorf("unknown source node")
		}
		if _, ok := nodes[e.TargetNodeID]; !ok {
			return fmt.Errorf("unknown target node")
		}
		if edgeIDs[e.ID] {
			return fmt.Errorf("duplicate edge id")
		}
		edgeIDs[e.ID] = true
		if e.ExternalID != "" {
			if external[e.ExternalID] {
				return fmt.Errorf("duplicate external edge id")
			}
			external[e.ExternalID] = true
		}
	}
	return nil
}

// MergePatch implements partial updates; metadata keys are appended rather than replaced.
func MergePatch(current any, patch map[string]json.RawMessage, target any) error {
	raw, err := json.Marshal(current)
	if err != nil {
		return err
	}
	base := map[string]json.RawMessage{}
	if err = json.Unmarshal(raw, &base); err != nil {
		return err
	}
	for key, value := range patch {
		if key == "metadata" {
			a := Meta{}
			b := Meta{}
			_ = json.Unmarshal(base[key], &a)
			if err = json.Unmarshal(value, &b); err != nil {
				return fmt.Errorf("metadata must be an object")
			}
			if b == nil {
				return fmt.Errorf("metadata must be an object")
			}
			for k, v := range b {
				a[k] = v
			}
			value, _ = json.Marshal(a)
		}
		base[key] = value
	}
	raw, _ = json.Marshal(base)
	return json.Unmarshal(raw, target)
}
