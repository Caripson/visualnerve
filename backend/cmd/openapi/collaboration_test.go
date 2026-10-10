package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func generatedCollaborationDocument(t *testing.T) object {
	t.Helper()
	previous := os.Args
	path := filepath.Join(t.TempDir(), "openapi.yaml")
	os.Args = []string{"openapi", path}
	t.Cleanup(func() { os.Args = previous })
	main()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document object
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	return document
}

func TestCollaborationSchemasKeepAdmissionPrivateAndDiscoverActualBudgets(t *testing.T) {
	schemas := object{}
	addCollaborationSchemas(schemas)
	session := schemas["CollaborationSession"].(object)
	props := session["properties"].(object)
	if session["additionalProperties"] != false || props["participants"].(object)["items"].(object)["$ref"] != "#/components/schemas/CollaborationParticipant" {
		t.Fatal("semantic session must be strict and expose participant semantics")
	}
	participant := schemas["CollaborationParticipant"].(object)["properties"].(object)
	for _, secret := range []string{"invitation", "credentialId", "ownerCredentialId", "relayUrl", "privateState", "key", "fingerprint", "error", "pendingJoins"} {
		if props[secret] != nil || participant[secret] != nil {
			t.Fatal("public collaboration schema exposes private field", secret)
		}
	}
	caps := schemas["CollaborationCapabilities"].(object)["properties"].(object)
	for _, field := range []string{"create", "join", "invite", "approve", "unlock"} {
		if !reflect.DeepEqual(caps["controls"].(object)["properties"].(object)[field].(object)["enum"], []bool{false}) {
			t.Fatal("admission action must remain human-only", field)
		}
	}
	if !reflect.DeepEqual(caps["assurance"].(object)["enum"], []string{"not-independently-audited"}) {
		t.Fatal("do not overstate independent assurance")
	}
	limits := schemas["CollaborationLimits"].(object)["properties"].(object)
	for field, limit := range map[string]int{"nodes": 20000, "edges": 100000, "stateBytes": 33554432, "updateBytes": 8388608, "frameBytes": 65536, "chunkBytes": 32768, "activeMessages": 8, "totalBufferedBytes": 33554432, "timeoutMs": 60000, "compressedPayloadBytes": 3145728, "plaintextPayloadBytes": 67108864} {
		if !reflect.DeepEqual(limits[field].(object)["enum"], []int{limit}) {
			t.Fatal("schema diverges from actual independent limit", field)
		}
	}
	if !strings.Contains(limits["updateBytes"].(object)["description"].(string), "Nonempty base vectors") || !strings.Contains(limits["stateBytes"].(object)["description"].(string), "canonical empty baseVector [0]") {
		t.Fatal("schema must distinguish the causal delta and validated full-state refresh budgets")
	}
	for _, phrase := range []string{"owner/editor", "Read + write", "not independently audited", "excluded", "reload", "raw CSV", "cannot recall"} {
		if !strings.Contains(collaborationPolicy, phrase) {
			t.Fatal("missing disclosure/security boundary", phrase)
		}
	}
}

func TestGeneratedCollaborationPathsAreAdditiveAndNeverAddAdmissionCommands(t *testing.T) {
	document := generatedCollaborationDocument(t)
	if document["info"].(object)["version"] != "0.7.0" {
		t.Fatal("collaboration requires current additive version")
	}
	paths := document["paths"].(object)
	for _, endpoint := range []struct{ path, method, schema string }{
		{"/collaboration/capabilities", "get", "CollaborationCapabilities"},
		{"/collaboration/sessions", "get", "CollaborationSession"},
		{"/diagrams/{diagramId}/collaboration", "get", "CollaborationSession"},
		{"/diagrams/{diagramId}/collaboration/disconnect", "post", "CollaborationDisconnected"},
	} {
		op := paths[endpoint.path].(object)[endpoint.method].(object)
		out := op["responses"].(object)["200"].(object)["content"].(object)["application/json"].(object)["schema"].(object)
		if endpoint.path == "/collaboration/sessions" {
			out = out["items"].(object)
		}
		if out["$ref"] != "#/components/schemas/"+endpoint.schema {
			t.Fatal("wrong collaboration response", endpoint.path)
		}
		if op["responses"].(object)["423"] == nil || op["responses"].(object)["403"] == nil {
			t.Fatal("existing vault/grant errors must remain")
		}
	}
	post := paths["/diagrams/{diagramId}/collaboration/disconnect"].(object)["post"].(object)
	if post["requestBody"].(object)["required"] != false {
		t.Fatal("disconnect permits absent data")
	}
	for path := range paths {
		if strings.Contains(path, "collaboration") && (strings.Contains(path, "invite") || strings.Contains(path, "approve") || strings.Contains(path, "join") || strings.Contains(path, "key")) {
			t.Fatal("forbidden programmatic admission", path)
		}
	}
	for _, path := range []string{"/exports/svg", "/exports/diagrams", "/diagram-files/preview", "/diagrams/{diagramId}/bulk"} {
		if paths[path] == nil {
			t.Fatal("existing API capability was lost", path)
		}
	}
}
