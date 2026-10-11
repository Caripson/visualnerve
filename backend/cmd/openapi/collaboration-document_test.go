package main

import (
	"reflect"
	"strings"
	"testing"
)

func TestPortableCollaborationActionsAreStrictAndActorBound(t *testing.T) {
	schemas := object{}
	addCollaborationSchemas(schemas)
	input := schemas["CollaborationActionInput"].(object)
	if input["additionalProperties"] != false || !reflect.DeepEqual(input["required"], []string{"baseVersion", "action"}) {
		t.Fatal("action wrapper must accept exactly baseVersion and action")
	}
	variants := schemas["CollaborationAction"].(object)["oneOf"].([]any)
	if len(variants) != 11 {
		t.Fatal("missing document actions", len(variants))
	}
	for _, raw := range variants {
		variant := raw.(object)
		if variant["additionalProperties"] != false {
			t.Fatal("action must reject additional fields")
		}
		properties := variant["properties"].(object)
		for _, private := range []string{"authorId", "profileId", "role", "source", "timestamp", "createdAt", "deviceId", "credentialId"} {
			if properties[private] != nil {
				t.Fatal("client must not supply actor context", private)
			}
		}
	}
	for _, name := range []string{"ParticipantProfile", "CommentThread", "CommentMessage", "CollaborationTask", "CollaborationActivity", "CollaborationDocument"} {
		schema := schemas[name].(object)
		if schema["additionalProperties"] != false {
			t.Fatal("portable schema must be strict", name)
		}
		for _, private := range []string{"deviceId", "credentialId", "privateKey", "roomId", "role"} {
			if schema["properties"].(object)[private] != nil {
				t.Fatal("portable schema leaked session identity", name, private)
			}
		}
	}
	for _, name := range []string{"CommentMessage", "CollaborationActivity"} {
		schema := schemas[name].(object)
		required := schema["required"].([]string)
		found := false
		for _, key := range required {
			found = found || key == "sequence"
		}
		sequence := schema["properties"].(object)["sequence"].(object)
		if !found || sequence["type"] != "integer" || sequence["minimum"] != 0 || sequence["maximum"] != 9007199254740991 {
			t.Fatal("logical sequence must be required and within JavaScript safe integer bounds", name)
		}
	}
	if !strings.Contains(schemas["ProfileCreateInput"].(object)["properties"].(object)["color"].(object)["description"].(string), "first unused palette color") {
		t.Fatal("profile creation must document deterministic automatic colors")
	}
	properties := schemas["CollaborationDocument"].(object)["properties"].(object)
	for key, limit := range map[string]int{"profiles": 128, "comments": 2000, "tasks": 1000, "activity": 500} {
		if properties[key].(object)["maxItems"] != limit {
			t.Fatal("document limit differs from browser", key)
		}
	}
	for _, phrase := range []string{"unverified", "informational", "writer clock", "not a signed or immutable", "approved editors", "deleted-node", "Read + write"} {
		if !strings.Contains(collaborationDocumentPolicy, phrase) {
			t.Fatal("missing document trust/behavior boundary", phrase)
		}
	}
}

func TestGeneratedPortableCollaborationReferencesAndVersionedEndpoints(t *testing.T) {
	document := generatedCollaborationDocument(t)
	schemas := document["components"].(object)["schemas"].(object)
	if schemas["Diagram"].(object)["properties"].(object)["collaboration"].(object)["$ref"] != "#/components/schemas/CollaborationDocument" {
		t.Fatal("Diagram must expose portable collaboration as its own typed schema")
	}
	paths := document["paths"].(object)
	get := paths["/diagrams/{diagramId}/collaboration/document"].(object)["get"].(object)
	post := paths["/diagrams/{diagramId}/collaboration/actions"].(object)["post"].(object)
	if post["requestBody"].(object)["content"].(object)["application/json"].(object)["schema"].(object)["$ref"] != "#/components/schemas/CollaborationActionInput" {
		t.Fatal("POST must use the strict action envelope")
	}
	for _, operation := range []object{get, post} {
		for _, status := range []string{"403", "404", "409", "422", "423", "503"} {
			if operation["responses"].(object)[status] == nil {
				t.Fatal("missing validation/version/access response", status)
			}
		}
	}
	for _, status := range []string{"413", "429", "504"} {
		if post["responses"].(object)[status] == nil {
			t.Fatal("missing live action size, pending limit or unknown-outcome response", status)
		}
	}
	for _, phrase := range []string{"128 KiB", "eight pending", "25 seconds", "unknown outcome", "before retrying"} {
		if !strings.Contains(post["description"].(string), phrase) {
			t.Fatal("missing live action resource/recovery contract", phrase)
		}
	}
	if document["info"].(object)["version"] != "0.8.2" {
		t.Fatal("document collaboration requires current additive API version")
	}
}
