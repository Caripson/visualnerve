package model

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestDiagramPreservesOptionalPortableCollaborationWithoutMigration(t *testing.T) {
	var diagram Diagram
	input := []byte(`{"id":"00000000-0000-4000-8000-000000000001","name":"Work","type":"blank","collaboration":{"schemaVersion":1,"profiles":[{"id":"00000000-0000-4000-8000-000000000002","name":"Public label","color":"#31766c","createdAt":"2026-10-11T12:00:00.000Z","updatedAt":"2026-10-11T12:00:00.000Z"}],"comments":[],"tasks":[],"activity":[]}}`)
	if err := json.Unmarshal(input, &diagram); err != nil {
		t.Fatal(err)
	}
	before := diagram.Collaboration
	NormalizeDiagram(&diagram)
	if err := ValidateDiagram(diagram); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(diagram)
	if err != nil {
		t.Fatal(err)
	}
	var restored Diagram
	if err := json.Unmarshal(encoded, &restored); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, restored.Collaboration) {
		t.Fatal("normalization/transport lost portable collaboration", string(encoded))
	}
	var old Diagram
	if err := json.Unmarshal([]byte(`{"name":"Old document","type":"blank"}`), &old); err != nil {
		t.Fatal(err)
	}
	NormalizeDiagram(&old)
	encoded, err = json.Marshal(old)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatal(err)
	}
	if old.Collaboration != nil || fields["collaboration"] != nil {
		t.Fatal("legacy diagram must not auto-enable document collaboration")
	}
}
