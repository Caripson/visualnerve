package main

import (
	"reflect"
	"strings"
	"testing"
)

func TestCodeDetailModeHasInputDependentDefaultAndResolvedOutput(t *testing.T) {
	schemas := object{}
	addCodeSchemas(schemas)
	input := schemas["CodeInput"].(object)
	mode := input["properties"].(object)["mode"].(object)
	if !reflect.DeepEqual(input["required"], []string{"files"}) {
		t.Fatal("detail mode must remain optional")
	}
	if !reflect.DeepEqual(mode["enum"], []string{"files", "symbols", "folders"}) {
		t.Fatal("automatic selection must not add a persisted detail-mode value")
	}
	if _, fixed := mode["default"]; fixed {
		t.Fatal("a fixed OpenAPI default would hide the single-file declaration view")
	}
	description := mode["description"].(string)
	for _, phrase := range []string{"one file uses symbols", "multiple files use files", "explicit files or symbols", "resolved mode"} {
		if !strings.Contains(description, phrase) {
			t.Fatal("input must describe automatic and explicit detail levels", phrase)
		}
	}
	analysis := schemas["CodeAnalysis"].(object)
	if !reflect.DeepEqual(analysis["properties"].(object)["mode"].(object)["enum"], []string{"files", "symbols", "folders"}) {
		t.Fatal("saved analysis exposes the resolved files/symbols/folders mode")
	}
}
