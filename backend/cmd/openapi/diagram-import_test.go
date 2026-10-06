package main

import (
	"reflect"
	"testing"
)

func TestDiagramImportSchemasSeparatePreviewFromSelectedPageCreation(t *testing.T) {
	schemas := object{}
	addDiagramImportSchemas(schemas)
	preview := schemas["DiagramFileInput"].(object)
	if preview["additionalProperties"] != false || !reflect.DeepEqual(preview["required"], []string{"format", "data"}) {
		t.Fatal("preview must have an exact input contract", preview)
	}
	if preview["properties"].(object)["pageId"] != nil {
		t.Fatal("preview must not select or save a page")
	}
	importing := schemas["DiagramFileImportInput"].(object)
	if importing["properties"].(map[string]any)["pageId"] == nil {
		t.Fatal("creation must accept source page ID")
	}
	page := schemas["DiagramImportPage"].(object)["properties"].(object)
	if page["id"].(object)["format"] != nil || page["graph"].(object)["$ref"] != "#/components/schemas/Graph" {
		t.Fatal("pages need source string IDs and canonical Graphs", page)
	}
	if schemas["DiagramImportResult"].(object)["properties"].(object)["pages"].(object)["maxItems"] != 100 {
		t.Fatal("page bound must match browser parser")
	}
}
