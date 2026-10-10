package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestDiagramExchangeSchemasPreserveSVGAndDescribeStrictBinaryJobs(t *testing.T) {
	schemas := object{}
	addSVGExportSchemas(schemas)
	previous := clone(schemas["SvgExportCapabilities"].(object)["properties"].(object))
	addDiagramExportSchemas(schemas)
	capabilities := schemas["SvgExportCapabilities"].(object)["properties"].(object)
	for key, value := range previous {
		if !reflect.DeepEqual(clone(object{"value": capabilities[key]}), clone(object{"value": value})) {
			t.Fatal("existing SVG capability changed", key)
		}
	}
	if capabilities["diagrams"].(object)["$ref"] != "#/components/schemas/DiagramExportCapabilities" {
		t.Fatal("editable diagram capabilities must be additive")
	}
	variants := schemas["DiagramExportJobInput"].(object)["oneOf"].([]any)
	whole, selected := variants[0].(object), variants[1].(object)
	if whole["additionalProperties"] != false || selected["additionalProperties"] != false ||
		!reflect.DeepEqual(whole["required"], []string{"diagramId", "format"}) ||
		!reflect.DeepEqual(selected["required"], []string{"diagramId", "format", "scope", "nodeIds"}) || whole["properties"].(object)["nodeIds"] != nil {
		t.Fatal("complete and selected jobs need strict distinct schemas")
	}
	ids := selected["properties"].(object)["nodeIds"].(object)
	if ids["minItems"] != 1 || ids["maxItems"] != 20000 || ids["uniqueItems"] != true || ids["items"].(object)["format"] != "uuid" {
		t.Fatal("selection must be unique bounded canonical IDs")
	}
	status := schemas["DiagramExportJobStatus"].(object)["properties"].(object)
	if !reflect.DeepEqual(status["format"].(object)["enum"], []string{"drawio"}) ||
		!reflect.DeepEqual(status["phase"].(object)["enum"], []string{"queued", "projection", "nodes", "edges", "packaging", "complete"}) ||
		status["warnings"].(object)["items"].(object)["$ref"] != "#/components/schemas/DiagramExportWarning" {
		t.Fatal("status must describe actual worker format/phases/warnings")
	}
	for _, field := range []string{"data", "bytesContent", "accessGrantId", "vaultKey", "sessionId"} {
		if status[field] != nil {
			t.Fatal("status must not expose readable file or authority secrets", field)
		}
	}
	chunk := schemas["DiagramExportResultChunk"].(object)
	properties := chunk["properties"].(object)
	if !reflect.DeepEqual(chunk["required"], []string{"jobId", "format", "mimeType", "encoding", "offset", "nextOffset", "totalBytes", "data", "complete", "warnings"}) ||
		properties["data"].(object)["maxLength"] != 1048576 || properties["data"].(object)["format"] != "byte" ||
		!reflect.DeepEqual(properties["encoding"].(object)["enum"], []string{"base64"}) {
		t.Fatal("binary chunk identity, encoding and complete payload must be discoverable")
	}
	for _, phrase := range []string{"raw bytes", "separately", "padding", "422", "readable information"} {
		if !strings.Contains(chunk["description"].(string), phrase) {
			t.Fatal("unsafe or incomplete binary transfer instructions", phrase)
		}
	}
	formats := schemas["DiagramExportCapabilities"].(object)["properties"].(object)["formats"].(object)["properties"].(object)
	if len(formats) != 1 || formats["drawio"] == nil || formats["vsdx"] != nil {
		t.Fatal("editable export capabilities must advertise only draw.io")
	}
	for _, schema := range []object{
		whole["properties"].(object)["format"].(object),
		selected["properties"].(object)["format"].(object),
		properties["format"].(object),
	} {
		if !reflect.DeepEqual(schema["enum"], []string{"drawio"}) {
			t.Fatal("request and result schemas must reject unsupported editable formats", schema)
		}
	}
}

func TestGeneratedDiagramExchangePathsDiscoverCompleteScopedContracts(t *testing.T) {
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
	if document["info"].(object)["version"] != "0.7.0" {
		t.Fatal("additive export release must identify current API version")
	}
	paths := document["paths"].(object)
	schemas := document["components"].(object)["schemas"].(object)
	if !reflect.DeepEqual(schemas["DiagramFileFormat"].(object)["enum"], []any{"drawio", "vsdx"}) ||
		paths["/diagram-files/preview"].(object)["post"] == nil {
		t.Fatal("removing Visio export must retain existing VSDX import support")
	}
	for _, endpoint := range []struct{ path, method, code, schema string }{
		{"/exports/diagrams", "post", "201", "DiagramExportJobStatus"},
		{"/exports/diagrams/{jobId}", "get", "200", "DiagramExportJobStatus"},
		{"/exports/diagrams/{jobId}", "delete", "200", "DiagramExportJobStatus"},
		{"/exports/diagrams/{jobId}/result", "get", "200", "DiagramExportResultChunk"},
	} {
		operation := paths[endpoint.path].(object)[endpoint.method].(object)
		response := operation["responses"].(object)[endpoint.code].(object)
		if response["content"].(object)["application/json"].(object)["schema"].(object)["$ref"] != "#/components/schemas/"+endpoint.schema ||
			operation["security"] == nil || !strings.Contains(operation["description"].(string), "Read-only") {
			t.Fatal("exchange routes must share local authorized model and documented response", endpoint)
		}
		for _, code := range []string{"403", "404", "409", "422", "423", "503"} {
			if operation["responses"].(object)[code] == nil {
				t.Fatal("missing authorization/job failure response", endpoint, code)
			}
		}
	}
	cancel := paths["/exports/diagrams/{jobId}"].(object)["delete"].(object)
	if cancel["requestBody"].(object)["required"] != false {
		t.Fatal("cancel must accept omitted body")
	}
	result := paths["/exports/diagrams/{jobId}/result"].(object)["get"].(object)
	parameters := result["parameters"].([]any)
	if len(parameters) != 3 {
		t.Fatal("result must have only job ID, offset and limit")
	}
	limit := parameters[2].(object)["schema"].(object)
	if limit["minimum"] != float64(1) || limit["maximum"] != float64(786432) || limit["default"] != float64(786432) {
		t.Fatal("base64 envelope must bound raw bytes independently from SVG UTF-16 chunks")
	}
	if paths["/exports/svg"].(object)["post"] == nil || paths["/export"].(object)["post"] == nil {
		t.Fatal("existing SVG/legacy paths disappeared")
	}
}
