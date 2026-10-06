package model

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func TestDiagramFileInputContract(t *testing.T) {
	archive := base64.StdEncoding.EncodeToString([]byte{'P', 'K', 3, 4, 1, 2, 3, 4})
	for _, input := range []string{
		`{"format":"drawio","data":"<mxfile/>"}`,
		`{"format":"drawio","data":"<mxGraphModel/>","name":"Nordic plan"}`,
		`{"format":"vsdx","data":"` + archive + `"}`,
	} {
		if err := ValidateDiagramFileInput(json.RawMessage(input), false); err != nil {
			t.Fatal(input, err)
		}
	}
	for _, input := range []string{
		`null`, `[]`, `{}`, `{"format":"drawio"}`,
		`{"format":"drawio","data":null}`,
		`{"format":"drawio","data":1}`,
		`{"format":"drawio","data":" "}`,
		`{"format":"vsd","data":"content"}`,
		`{"format":"vsdm","data":"content"}`,
		`{"format":"drawio","data":"xml","pageId":"page-1"}`,
		`{"format":"drawio","data":"xml","name":null}`,
		`{"format":"drawio","data":"xml","name":" "}`,
		`{"format":"drawio","data":"xml","fetchUrl":"https://example.com"}`,
		`{"format":"vsdx","data":"not-base64"}`,
		`{"format":"vsdx","data":"` + strings.TrimRight(archive, "=") + `"}`,
		`{"format":"vsdx","data":"` + archive[:4] + `\n` + archive[4:] + `"}`,
		`{"format":"vsdx","data":"` + base64.StdEncoding.EncodeToString([]byte("ordinary text")) + `"}`,
	} {
		if err := ValidateDiagramFileInput(json.RawMessage(input), false); err == nil {
			t.Fatal("invalid preview accepted", input)
		}
	}
	if err := ValidateDiagramFileInput(json.RawMessage(`{"format":"drawio","data":"xml","pageId":"source-page-1"}`), true); err != nil {
		t.Fatal(err)
	}
	for _, pageID := range []string{"", " ", strings.Repeat("x", 501)} {
		input, _ := json.Marshal(DiagramFileInput{Format: "drawio", Data: "xml", PageID: pageID})
		// Preserve an explicitly empty optional field for the validation case.
		if pageID == "" {
			input = []byte(`{"format":"drawio","data":"xml","pageId":""}`)
		}
		if err := ValidateDiagramFileInput(input, true); err == nil {
			t.Fatal("invalid page ID accepted")
		}
	}
}

func TestDiagramFileInputUsesUTF8ByteLimit(t *testing.T) {
	if DiagramFileByteLimit != 1<<30 {
		t.Fatal("absolute diagram file ceiling must be 1 GiB")
	}
	for _, size := range []int{8, 9} {
		input, _ := json.Marshal(DiagramFileInput{Format: "drawio", Data: strings.Repeat("å", size)})
		err := validateDiagramFileInput(input, false, 16)
		if (err == nil) != (size == 8) {
			t.Fatalf("UTF-8 limit must allow 16 bytes and reject 18 bytes: %v", err)
		}
	}
}

func TestDiagramFileInputUsesDecodedZIPByteLimit(t *testing.T) {
	for _, size := range []int{16, 17, 20} {
		archive := append([]byte{'P', 'K', 3, 4}, make([]byte, size-4)...)
		input, _ := json.Marshal(DiagramFileInput{Format: "vsdx", Data: base64.StdEncoding.EncodeToString(archive)})
		err := validateDiagramFileInput(input, false, 16)
		if (err == nil) != (size == 16) {
			t.Fatalf("decoded ZIP limit must allow 16 bytes and reject larger archives: %v", err)
		}
	}
}
