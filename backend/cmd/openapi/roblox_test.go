package main

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestRobloxContractKeepsGameASTTypedAndVersioned(t *testing.T) {
	doc := analyticsContract(t)
	schemas := doc["components"].(object)["schemas"].(object)
	if doc["info"].(object)["version"] != "0.11.0" {
		t.Fatal("game support needs coordinated discovery")
	}
	for _, name := range []string{"Diagram", "DiagramInput"} {
		if schemas[name].(object)["properties"].(object)["game"].(object)["$ref"] != "#/components/schemas/RobloxGameDefinition" {
			t.Fatal("game metadata must not become an untyped map", name)
		}
	}
	if schemas["DiagramPatch"].(object)["properties"].(object)["game"] != nil {
		t.Fatal("generic PATCH bypasses versioned game commands")
	}
	game := schemas["RobloxGameDefinition"].(object)
	if game["additionalProperties"] != false || len(game["required"].([]any)) != 13 {
		t.Fatal("complete game must be strict", game)
	}
	props := game["properties"].(object)
	for key, max := range map[string]float64{"entities": 1000, "rules": 1000, "variables": 128, "items": 128, "quests": 128, "timers": 128, "prefabs": 128, "instances": 256} {
		if props[key].(object)["maxItems"] != max {
			t.Fatal("wrong collection limit", key)
		}
	}
	for _, name := range []string{"RobloxExpression", "RobloxCondition", "RobloxEvent", "RobloxAction", "RobloxPrefabExpression"} {
		for _, raw := range schemas[name].(object)["oneOf"].([]any) {
			if raw.(object)["additionalProperties"] != false {
				t.Fatal("AST instruction permits executable extension", name)
			}
		}
	}
	ordinary := schemas["RobloxExpression"].(object)["oneOf"].([]any)
	prefab := schemas["RobloxPrefabExpression"].(object)["oneOf"].([]any)
	if len(prefab) != len(ordinary)+1 {
		t.Fatal("parameter expressions must be prefab-only")
	}
	color := schemas["RobloxEntity"].(object)["properties"].(object)["color"].(object)
	if color["minLength"] != float64(7) || color["maxLength"] != float64(7) || !strings.Contains(color["pattern"].(string), "(?!") {
		t.Fatal("exact six-hex color must reject suffix controls")
	}
	if schemas["RobloxPrefab"].(object)["properties"].(object)["parameters"].(object)["maxItems"] != float64(64) || schemas["RobloxPrefab"].(object)["properties"].(object)["bindings"].(object)["maxItems"] != float64(256) {
		t.Fatal("prefab budgets differ from validator")
	}
	limits := schemas["RobloxCapabilities"].(object)["properties"].(object)["limits"].(object)["properties"].(object)
	for key, expected := range map[string]float64{"actionBudget": 8192, "eventBudget": 256, "transportBytes": 524288, "previewSteps": 128, "previewPlayers": 16} {
		if limits[key].(object)["enum"].([]any)[0] != expected {
			t.Fatal("discovery budget missing", key)
		}
	}
}

func TestRobloxRoutesExposeBoundedReadsAndNoPublishConfirmation(t *testing.T) {
	doc := analyticsContract(t)
	paths := doc["paths"].(object)
	schemas := doc["components"].(object)["schemas"].(object)
	base := "/diagrams/{diagramId}/roblox"
	for _, test := range []struct{ path, method, status, output string }{
		{"/roblox/capabilities", "get", "200", "RobloxCapabilities"}, {base, "get", "200", "RobloxModelSnapshot"}, {base, "put", "200", "RobloxMutationSummary"},
		{base + "/configuration", "get", "200", "RobloxConfigurationSnapshot"}, {base + "/configuration", "patch", "200", "RobloxMutationSummary"},
		{base + "/validate", "post", "200", "RobloxValidationReport"}, {base + "/preview", "post", "200", "RobloxPreviewReport"}, {base + "/builds", "post", "202", "RobloxBuildStatus"},
		{base + "/builds/{jobId}/artifacts", "get", "200", "RobloxArtifactList"}, {base + "/builds/{jobId}/artifacts/{artifactName}", "get", "200", "RobloxArtifactChunk"},
	} {
		op := paths[test.path].(object)[test.method].(object)
		schema := op["responses"].(object)[test.status].(object)["content"].(object)["application/json"].(object)["schema"].(object)
		if schema["$ref"] != "#/components/schemas/"+test.output {
			t.Fatal("wrong response", test)
		}
		if robloxReadOperation(test.path, test.method) {
			for _, raw := range op["parameters"].([]any) {
				if raw.(object)["name"] == "X-Visual-Nerve-Operation-Id" {
					t.Fatal("pure computation advertises a write identity", test)
				}
			}
		}
	}
	for _, collection := range robloxCollections {
		path := base + "/" + collection + "/{entityId}"
		op := paths[path].(object)["get"].(object)
		for _, raw := range op["parameters"].([]any) {
			p := raw.(object)
			if p["name"] == "entityId" && p["schema"].(object)["format"] != nil {
				t.Fatal("game IDs must not be UUIDs")
			}
		}
		if paths[path].(object)["delete"].(object)["responses"].(object)["204"] == nil {
			t.Fatal("collection deletion follows no-content semantics")
		}
	}
	for path := range paths {
		if strings.Contains(path, "roblox") && strings.Contains(path, "publish") {
			t.Fatal("publication confirmation became a tool endpoint", path)
		}
	}
	chunk := schemas["RobloxArtifactChunk"].(object)["properties"].(object)
	if !reflect.DeepEqual(chunk["encoding"].(object)["enum"], []any{"base64"}) || chunk["content"].(object)["maxLength"] != float64(87384) {
		t.Fatal("artifact paging must preserve exact bytes")
	}
	job := schemas["RobloxBuildStatus"].(object)["properties"].(object)
	if job["state"] == nil || job["status"] != nil || job["createdAt"] == nil || job["error"].(object)["type"] != "object" {
		t.Fatal("build status drifted from canonical client")
	}
	if !reflect.DeepEqual(schemas["DiagramInput"].(object)["properties"].(object)["template"].(object)["enum"], stringsToAny(supportedCreationTemplateKeys())) {
		t.Fatal("creation omitted stable Roblox key")
	}
}

func TestRobloxConfigurationContractKeepsBoundedCompleteReadsAndStrictPartialWrites(t *testing.T) {
	doc := analyticsContract(t)
	schemas := doc["components"].(object)["schemas"].(object)
	game := schemas["RobloxGameDefinition"].(object)["properties"].(object)
	configuration := schemas["RobloxConfiguration"].(object)
	properties := configuration["properties"].(object)
	fields := []any{"schemaVersion", "id", "name", "description", "settings"}
	if configuration["additionalProperties"] != false || !reflect.DeepEqual(configuration["required"], fields) || len(properties) != len(fields) {
		t.Fatal("configuration must contain every game-level field and no collections", configuration)
	}
	for _, raw := range fields {
		key := raw.(string)
		if !reflect.DeepEqual(properties[key], game[key]) {
			t.Fatal("configuration field drifted from the canonical game schema", key)
		}
	}
	snapshot := schemas["RobloxConfigurationSnapshot"].(object)
	if snapshot["additionalProperties"] != false || !reflect.DeepEqual(snapshot["required"], []any{"diagramId", "baseVersion", "configuration"}) {
		t.Fatal("bounded configuration needs its diagram/version envelope", snapshot)
	}
	if snapshot["properties"].(object)["configuration"].(object)["$ref"] != "#/components/schemas/RobloxConfiguration" {
		t.Fatal("configuration snapshot lost its complete typed schema")
	}
	patch := schemas["RobloxConfigurationPatch"].(object)
	if patch["additionalProperties"] != false || !reflect.DeepEqual(patch["required"], []any{"baseVersion", "value"}) {
		t.Fatal("configuration update requires only the version and partial value", patch)
	}
	value := patch["properties"].(object)["value"].(object)
	mutable := value["properties"].(object)
	if value["type"] != "object" || value["additionalProperties"] != false || value["required"] != nil || len(mutable) != 3 || mutable["id"] != nil || mutable["schemaVersion"] != nil {
		t.Fatal("partial configuration must reject arrays and identity/unknown fields", value)
	}
	for _, key := range []string{"name", "description"} {
		if !reflect.DeepEqual(mutable[key], game[key]) || mutable[key].(object)["nullable"] != nil {
			t.Fatal("partial configuration must preserve canonical non-null fields", key)
		}
	}
	settings := mutable["settings"].(object)
	completeSettings := properties["settings"].(object)
	if settings["type"] != "object" || settings["additionalProperties"] != false || settings["required"] != nil || settings["nullable"] != nil || !reflect.DeepEqual(settings["properties"], completeSettings["properties"]) || len(completeSettings["required"].([]any)) != 6 {
		t.Fatal("settings edit must preserve every numeric/color constraint while allowing omission", settings)
	}
	path := "/diagrams/{diagramId}/roblox/configuration"
	operations := doc["paths"].(object)[path].(object)
	read := operations["get"].(object)
	write := operations["patch"].(object)
	if read["requestBody"] != nil || !strings.Contains(read["summary"].(string), "Read only") || !strings.Contains(write["summary"].(string), "write required") {
		t.Fatal("configuration route must separate read inspection from mutation")
	}
	if write["requestBody"].(object)["content"].(object)["application/json"].(object)["schema"].(object)["$ref"] != "#/components/schemas/RobloxConfigurationPatch" {
		t.Fatal("configuration route lost its strict partial request")
	}
	for method, operation := range map[string]object{"get": read, "patch": write} {
		hasRecovery := false
		for _, raw := range operation["parameters"].([]any) {
			parameter := raw.(object)
			if parameter["name"] == "X-Visual-Nerve-Operation-Id" {
				hasRecovery = true
			}
			if parameter["name"] == "diagramId" && parameter["schema"].(object)["format"] != "uuid" {
				t.Fatal("configuration needs its canonical diagram UUID")
			}
		}
		if hasRecovery != (method == "patch") {
			t.Fatal("only configuration mutation may allocate write recovery", method)
		}
	}
	capabilities := schemas["RobloxCapabilities"].(object)["properties"].(object)
	if !reflect.DeepEqual(capabilities["configurationPath"].(object)["enum"], []any{path}) {
		t.Fatal("bounded configuration route must be discoverable")
	}
	permissions := capabilities["permissions"].(object)["properties"].(object)
	for key, token := range map[string]string{"read": "configuration", "write": "update-configuration"} {
		found := false
		for _, value := range permissions[key].(object)["items"].(object)["enum"].([]any) {
			found = found || value == token
		}
		if !found {
			t.Fatal("configuration permission missing from discovery", key, token)
		}
	}
}

func TestRobloxContractGenerationIsStable(t *testing.T) {
	first, _ := json.Marshal(analyticsContract(t))
	second, _ := json.Marshal(analyticsContract(t))
	if string(first) != string(second) {
		t.Fatal("generated contract order drifted across identical inputs")
	}
}

func TestRobloxHTTPResponsesExposeTransportAndConcurrencyLimits(t *testing.T) {
	paths := analyticsContract(t)["paths"].(object)
	base := "/diagrams/{diagramId}/roblox"
	tests := []struct{ path, method, status, limit string }{
		{base, "get", "413", "512 KiB"},
		{base + "/validate", "post", "413", "512 KiB"},
		{base + "/preview", "post", "413", "8 MiB"},
		{base + "/preview", "post", "429", "already active"},
		{base + "/builds", "post", "429", "already active"},
	}
	for _, collection := range robloxCollections {
		for _, suffix := range []string{"", "/{entityId}"} {
			tests = append(tests, struct{ path, method, status, limit string }{base + "/" + collection + suffix, "get", "413", "512 KiB"})
		}
	}
	for _, test := range tests {
		op := paths[test.path].(object)[test.method].(object)
		response, ok := op["responses"].(object)[test.status].(object)
		if !ok {
			t.Fatal("bounded operation omits its actual HTTP response", test)
		}
		if !strings.Contains(response["description"].(string), test.limit) || response["content"].(object)["application/json"].(object)["schema"].(object)["$ref"] != "#/components/schemas/Error" {
			t.Fatal("limit response must describe its bound and existing structured error", test)
		}
	}
}

func TestRobloxPublicationDiscoveryRequiresIndependentTerminalApproval(t *testing.T) {
	doc := analyticsContract(t)
	schemas := doc["components"].(object)["schemas"].(object)
	capabilities := schemas["RobloxPublicationCapabilities"].(object)["properties"].(object)
	if !reflect.DeepEqual(capabilities["terminalApprovalRequired"].(object)["enum"], []any{true}) {
		t.Fatal("discovery must not advertise browser claims as sufficient publication approval")
	}
	limits := capabilities["limits"].(object)["properties"].(object)
	if !reflect.DeepEqual(limits["approvalMs"].(object)["enum"], []any{float64(60000)}) {
		t.Fatal("terminal approval must have a separate bounded deadline")
	}
}
