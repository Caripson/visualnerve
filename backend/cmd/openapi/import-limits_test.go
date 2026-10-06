package main

import (
	"reflect"
	"strings"
	"testing"
	"visualnerve/internal/model"
)

func TestImportSchemasUseAbsoluteCeilingsAndLocalPolicy(t *testing.T) {
	if absoluteImportByteLimit != 1<<30 {
		t.Fatal("absolute schema ceiling must be 1 GiB")
	}
	if model.DiagramFileByteLimit != absoluteImportByteLimit {
		t.Fatal("diagram validator must agree with the absolute schema ceiling")
	}
	schemas := object{}
	addCodeSchemas(schemas)
	addSqlSchemas(schemas)
	addDiagramImportSchemas(schemas)
	if schemas["CodeFile"].(object)["properties"].(object)["content"].(object)["maxLength"] != absoluteImportByteLimit {
		t.Fatal("code source schema must permit configured limits up to the absolute ceiling")
	}
	if schemas["SqlInput"].(object)["properties"].(object)["sql"].(object)["maxLength"] != absoluteImportByteLimit {
		t.Fatal("SQL schema must permit configured limits up to the absolute ceiling")
	}
	if schemas["DiagramFileInput"].(object)["properties"].(object)["data"].(object)["maxLength"] != 4*((absoluteImportByteLimit+2)/3) {
		t.Fatal("diagram source schema must accommodate base64 at the absolute decoded ceiling")
	}
	for _, name := range []string{"CodeInput", "SqlInput", "DiagramFileInput"} {
		description := schemas[name].(object)["description"].(string)
		for _, phrase := range []string{"default 50 MiB", "1024 MiB", "supported and guaranteed", "transport envelopes remain 32 MiB"} {
			if !strings.Contains(description, phrase) {
				t.Fatalf("%s missing selected-limit policy %q", name, phrase)
			}
		}
	}
}

func TestImportLimitSettingSchemaIsExactAndNumeric(t *testing.T) {
	input := importLimitSettingSchema()
	if input["additionalProperties"] != false || !reflect.DeepEqual(input["required"], []string{"value"}) {
		t.Fatal("import-limit setting must accept only a value field")
	}
	value := input["properties"].(object)["value"].(object)
	if value["type"] != "integer" || value["minimum"] != 50 || value["maximum"] != 1024 || value["default"] != 50 {
		t.Fatal("setting must use a 50..1024 integer MB value with default 50", value)
	}
}

func TestImportLimitSettingResponseIsAnInteger(t *testing.T) {
	value := importLimitSettingValueSchema()
	if value["type"] != "integer" || value["minimum"] != 50 || value["maximum"] != 1024 || value["default"] != 50 {
		t.Fatal("GET response must be an effective 50..1024 integer with default 50", value)
	}
	if value["properties"] != nil || value["$ref"] != nil {
		t.Fatal("GET response is a number, not a value wrapper", value)
	}
}
