package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"visualnerve/internal/model"
)

func TestReflectedIdentitiesDistinguishExternalStringsFromCanonicalUUIDs(t *testing.T) {
	for _, entry := range []struct {
		name  string
		value any
		ids   []string
	}{
		{"Node", model.Node{}, []string{"id", "diagramId", "ownerId", "parentId"}},
		{"Edge", model.Edge{}, []string{"id", "diagramId", "sourceNodeId", "targetNodeId"}},
		{"Owner", model.Owner{}, []string{"id"}},
	} {
		t.Run(entry.name, func(t *testing.T) {
			properties := schema(reflect.TypeOf(entry.value))["properties"].(object)
			external := properties["externalId"].(object)
			if external["type"] != "string" || external["format"] != nil || external["description"] == nil {
				t.Fatal("externalId must be a documented integration string without UUID format", external)
			}
			for _, name := range entry.ids {
				if properties[name].(object)["format"] != "uuid" {
					t.Fatal("canonical identity must remain UUID", name, properties[name])
				}
			}
		})
	}
}

func TestGeneratedIdentityContractsKeepExternalIDsAsStringsInEveryOperation(t *testing.T) {
	// Exercise the actual generator, including cloned input, PATCH and bulk
	// schemas. Reflection alone would miss an operation-specific override.
	previousArgs := os.Args
	os.Args = []string{"openapi", filepath.Join(t.TempDir(), "openapi.yaml")}
	t.Cleanup(func() { os.Args = previousArgs })
	main()
	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	schemas := document["components"].(map[string]any)["schemas"].(map[string]any)
	for _, entity := range []string{"Node", "Edge", "Owner"} {
		for _, name := range []string{entity, entity + "Input", entity + "Patch", "Bulk" + entity} {
			properties := schemas[name].(map[string]any)["properties"].(map[string]any)
			external := properties["externalId"].(map[string]any)
			if external["type"] != "string" || external["format"] != nil {
				t.Fatal("generated contract constrains integration strings to UUIDs", name, external)
			}
			if id, exists := properties["id"]; exists && id.(map[string]any)["format"] != "uuid" {
				t.Fatal("generated canonical id lost UUID format", name, id)
			}
		}
	}
	for name, fields := range map[string][]string{"BulkNode": {"ownerExternalId", "parentExternalId"}, "BulkEdge": {"sourceExternalId", "targetExternalId"}} {
		properties := schemas[name].(map[string]any)["properties"].(map[string]any)
		for _, field := range fields {
			if properties[field].(map[string]any)["type"] != "string" || properties[field].(map[string]any)["format"] != nil {
				t.Fatal("external identity references must remain integration strings", name, field)
			}
		}
	}
}
