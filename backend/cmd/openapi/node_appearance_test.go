package main

import "testing"

func TestNodeBackgroundColorContractDistinguishesFullAndPartialRecords(t *testing.T) {
	document := analyticsContract(t)
	schemas := document["components"].(object)["schemas"].(object)
	full := schemas["NodeBackgroundColor"].(object)
	if full["type"] != "string" || full["pattern"] != "^#[0-9a-fA-F]{6}$" || full["nullable"] != nil {
		t.Fatal("complete records must require six-digit hex when present", full)
	}
	if schemas["NodeBackgroundColorPatch"].(object)["nullable"] != true {
		t.Fatal("partial updates must support resetting fill")
	}
	for _, name := range []string{"Node", "NodeInput", "NodePatch", "BulkNode"} {
		want := "#/components/schemas/NodeBackgroundColor"
		if name == "NodePatch" || name == "BulkNode" {
			want += "Patch"
		}
		if schemas[name].(object)["properties"].(object)["backgroundColor"].(object)["$ref"] != want {
			t.Fatal("background field is missing or incorrectly nullable", name)
		}
	}
}
