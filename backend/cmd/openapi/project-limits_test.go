package main

import (
	"reflect"
	"strings"
	"testing"
)

func TestProjectSourceFileSettingIsExactAndIndependent(t *testing.T) {
	input := projectFileLimitSettingSchema()
	if input["additionalProperties"] != false || !reflect.DeepEqual(input["required"], []string{"value"}) {
		t.Fatal("setting must accept only value")
	}
	value := projectFileLimitValueSchema()
	if value["type"] != "integer" || value["minimum"] != 500 || value["maximum"] != 10000 || value["default"] != 500 {
		t.Fatal("setting range/default must be independent from byte limits", value)
	}
	for _, phrase := range []string{"browser-local", "captured", "500", "10000", "excluded from backups", "source payloads cannot override", "directory records", "Non-ZIP", "/code/capabilities"} {
		if !strings.Contains(projectFileLimitPolicyDescription, phrase) {
			t.Fatal("missing source-count policy", phrase)
		}
	}
}

func TestCodeSchemasPreserveOrdinaryLimitsAndAllowConfiguredZIPMetadata(t *testing.T) {
	schemas := object{}
	addCodeSchemas(schemas)
	properties := func(name string) object { return schemas[name].(object)["properties"].(object) }
	if properties("CodeInput")["files"].(object)["maxItems"] != 500 {
		t.Fatal("ordinary source imports must remain limited to 500")
	}
	if properties("CodeAnalysis")["fileCount"].(object)["maximum"] != 10000 {
		t.Fatal("saved larger ZIP analysis must remain valid")
	}
	if properties("ProjectDirectory")["fileCount"].(object)["maximum"] != 10000 {
		t.Fatal("directory counts must include complete larger projects")
	}
	if properties("CodeProjectInput")["languages"].(object)["maxProperties"] != 10000 {
		t.Fatal("absolute schema override ceiling must accommodate configured ZIP count")
	}
	if !reflect.DeepEqual(properties("CodeProjectAnalysis")["sourceFileLimit"], projectFileLimitValueSchema()) {
		t.Fatal("ZIP metadata must preserve the captured source-file budget")
	}
}
