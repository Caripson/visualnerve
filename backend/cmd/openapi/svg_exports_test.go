package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestSVGJobSchemasDescribeStrictSelectionsAndBoundedBrowserResults(t *testing.T) {
	schemas := object{}
	addSVGExportSchemas(schemas)
	input := schemas["SvgExportJobInput"].(object)
	variants := input["oneOf"].([]any)
	if len(variants) != 2 {
		t.Fatal("whole/viewport and selected jobs require distinct strict contracts")
	}
	whole, selected := variants[0].(object), variants[1].(object)
	if whole["additionalProperties"] != false || selected["additionalProperties"] != false ||
		!reflect.DeepEqual(whole["required"], []string{"diagramId"}) ||
		!reflect.DeepEqual(selected["required"], []string{"diagramId", "scope", "nodeIds"}) {
		t.Fatal("job creation must reject unknown fields and require an explicit selection")
	}
	if whole["properties"].(object)["nodeIds"] != nil {
		t.Fatal("nodeIds, including [], must be rejected outside selected scope")
	}
	ids := selected["properties"].(object)["nodeIds"].(object)
	if ids["minItems"] != 1 || ids["maxItems"] != 20000 || ids["uniqueItems"] != true || ids["items"].(object)["format"] != "uuid" {
		t.Fatal("selected IDs must be bounded, nonempty, unique canonical references", ids)
	}
	status := schemas["SvgJobStatus"].(object)
	properties := status["properties"].(object)
	if !reflect.DeepEqual(status["required"], []string{"jobId", "diagramId", "format", "state", "progress", "phase", "createdAt", "updatedAt", "nodeCount", "edgeCount"}) ||
		!reflect.DeepEqual(properties["state"].(object)["enum"], []string{"queued", "running", "succeeded", "failed", "cancelled"}) ||
		!reflect.DeepEqual(properties["phase"].(object)["enum"], []string{"queued", "projection", "layout", "edges", "nodes", "drawing", "complete"}) {
		t.Fatal("status must expose the real controller's states and progress phases")
	}
	if properties["jobId"].(object)["format"] != "uuid" || properties["diagramId"].(object)["format"] != "uuid" ||
		properties["progress"].(object)["type"] != "number" || properties["progress"].(object)["maximum"] != 100 {
		t.Fatal("job identity and progress constraints disagree with worker status")
	}
	if properties["nodeCount"].(object)["maximum"] != 100000 || properties["edgeCount"].(object)["maximum"] != 500000 ||
		!strings.Contains(properties["nodeCount"].(object)["description"].(string), "projected/scoped") {
		t.Fatal("queued source counts must not be constrained by the smaller rendered selection ceilings")
	}
	for _, field := range []string{"svg", "text", "grantId", "accessGrantId", "sessionId", "vaultKey"} {
		if properties[field] != nil {
			t.Fatal("status must not expose result content or authority secrets", field)
		}
	}
	failure := schemas["SvgJobFailure"].(object)
	if !reflect.DeepEqual(failure["required"], []string{"code", "message"}) {
		t.Fatal("failed jobs must expose structured renderer errors")
	}
	chunk := schemas["SvgJobResultChunk"].(object)
	if !reflect.DeepEqual(chunk["required"], []string{"jobId", "offset", "nextOffset", "totalCharacters", "text", "complete"}) ||
		chunk["properties"].(object)["text"].(object)["maxLength"] != 1048576 {
		t.Fatal("result chunks must describe complete bounded transport fields")
	}
	for _, phrase := range []string{"UTF-16", "surrogate pair", "422", "nextOffset", "complete=true"} {
		if !strings.Contains(chunk["description"].(string), phrase) {
			t.Fatal("chunk offsets must be discoverable without assuming UTF-8 bytes", phrase)
		}
	}
}

func TestSVGCapabilityLimitsExposeEveryControllerCeiling(t *testing.T) {
	schemas := object{}
	addSVGExportSchemas(schemas)
	expected := map[string]int{
		"sourceNodes": 100000, "sourceEdges": 500000, "nodes": 20000, "edges": 100000, "textCharacters": 5000000, "bytes": 67108864,
		"dimension": 16777216, "active": 2, "retained": 4, "retainedBytes": 134217728,
		"retentionMs": 900000, "deadlineMs": 120000, "synchronousNodes": 100,
		"synchronousTextCharacters": 20000, "resultChunkCharacters": 1048576,
	}
	limits := schemas["SvgExportLimits"].(object)
	properties := limits["properties"].(object)
	if len(properties) != len(expected) || len(limits["required"].([]string)) != len(expected) {
		t.Fatal("capabilities must not omit any advertised limit")
	}
	for name, maximum := range expected {
		if !reflect.DeepEqual(properties[name].(object)["enum"], []int{maximum}) {
			t.Fatal("capability ceiling differs from the local controller", name, properties[name])
		}
	}
	capabilities := schemas["SvgExportCapabilities"].(object)["properties"].(object)
	if !reflect.DeepEqual(capabilities["resultOffsetUnit"].(object)["enum"], []string{"utf-16-code-units"}) ||
		!reflect.DeepEqual(capabilities["requiresOriginalSessionAndGrant"].(object)["enum"], []bool{true}) ||
		!reflect.DeepEqual(capabilities["persistence"].(object)["enum"], []string{"transient-memory"}) {
		t.Fatal("authority, retention and offset units must be discoverable")
	}
}

func TestGeneratedSVGJobPathsRetainChunkContractsAndLegacyExport(t *testing.T) {
	previousArgs := os.Args
	path := filepath.Join(t.TempDir(), "openapi.yaml")
	os.Args = []string{"openapi", path}
	t.Cleanup(func() { os.Args = previousArgs })
	main()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document object
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	paths := document["paths"].(object)
	for _, endpoint := range []struct{ path, method, response, schema string }{
		{"/exports/capabilities", "get", "200", "SvgExportCapabilities"},
		{"/exports/svg", "post", "201", "SvgJobStatus"},
		{"/exports/svg/{jobId}", "get", "200", "SvgJobStatus"},
		{"/exports/svg/{jobId}", "delete", "200", "SvgJobStatus"},
		{"/exports/svg/{jobId}/result", "get", "200", "SvgJobResultChunk"},
	} {
		operation := paths[endpoint.path].(object)[endpoint.method].(object)
		success := operation["responses"].(object)[endpoint.response].(object)
		if success["content"].(object)["application/json"].(object)["schema"].(object)["$ref"] != "#/components/schemas/"+endpoint.schema ||
			operation["security"] == nil || !strings.Contains(operation["description"].(string), "Read-only") {
			t.Fatal("endpoint must expose its authorized read-only semantic contract", endpoint, operation)
		}
		for _, code := range []string{"403", "404", "409", "422", "423", "503"} {
			if operation["responses"].(object)[code] == nil {
				t.Fatal("missing SVG authorization/job validation response", endpoint, code)
			}
		}
		if strings.Contains(endpoint.path, "{jobId}") {
			param := operation["parameters"].([]any)[0].(object)
			if param["name"] != "jobId" || param["schema"].(object)["format"] != "uuid" {
				t.Fatal("SVG job IDs must remain canonical UUIDs, independent of operation tokens")
			}
		}
	}
	create := paths["/exports/svg"].(object)["post"].(object)
	if create["requestBody"].(object)["content"].(object)["application/json"].(object)["schema"].(object)["$ref"] != "#/components/schemas/SvgExportJobInput" ||
		create["responses"].(object)["429"] == nil || !strings.Contains(create["description"].(string), "SVG_JOB_BUSY") {
		t.Fatal("job creation must describe strict input and bounded concurrent work")
	}
	cancel := paths["/exports/svg/{jobId}"].(object)["delete"].(object)
	if cancel["requestBody"].(object)["required"] != false || !strings.Contains(cancel["description"].(string), "Subsequent requests return 404") {
		t.Fatal("cancellation must accept an omitted body and disclose result removal")
	}
	result := paths["/exports/svg/{jobId}/result"].(object)["get"].(object)
	parameters := result["parameters"].([]any)
	if len(parameters) != 3 {
		t.Fatal("result route must have one canonical path ID and only offset/limit query parameters")
	}
	for index, expected := range []struct {
		name              string
		min, max, initial float64
	}{
		{"offset", 0, 67108864, 0}, {"limit", 1, 1048576, 1048576},
	} {
		param := parameters[index+1].(object)
		schema := param["schema"].(object)
		if param["name"] != expected.name || param["in"] != "query" || param["required"] != false ||
			schema["minimum"] != expected.min || schema["maximum"] != expected.max || schema["default"] != expected.initial {
			t.Fatal("chunk query defaults or ceilings differ from the browser", param)
		}
	}
	legacy := paths["/export"].(object)["post"].(object)
	variants := legacy["responses"].(object)["200"].(object)["content"].(object)["application/json"].(object)["schema"].(object)["oneOf"].([]any)
	if len(variants) != 2 || variants[0].(object)["$ref"] != "#/components/schemas/Graph" || variants[1].(object)["type"] != "string" {
		t.Fatal("existing Graph or JSON string exports must remain backwards compatible")
	}
	for _, phrase := range []string{"100 graph nodes", "20,000", "16 MiB", "409 SVG_BACKGROUND_REQUIRED", "POST /exports/svg", "JSON and Markdown export behavior is unchanged"} {
		if !strings.Contains(legacy["description"].(string), phrase) {
			t.Fatal("legacy SVG must direct large clients to background export", phrase)
		}
	}
	components := document["components"].(object)["schemas"].(object)
	for _, name := range []string{"SvgExportCapabilities", "SvgExportLimits", "SvgExportJobInput", "SvgJobStatus", "SvgJobFailure", "SvgJobResultChunk", "SvgExportEmptyInput"} {
		if components[name] == nil {
			t.Fatal("endpoint discovery cannot resolve a required SVG component", name)
		}
	}
}
