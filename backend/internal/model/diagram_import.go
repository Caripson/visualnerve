package model

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"
)

// Absolute validation ceiling; the browser applies its selected local import limit.
const DiagramFileByteLimit = 1 << 30

// Diagram files are transient input; only a selected native graph is persisted.
type DiagramFileInput struct {
	Format string `json:"format"`
	Data   string `json:"data"`
	Name   string `json:"name,omitempty"`
	PageID string `json:"pageId,omitempty"`
}

type DiagramImportPage struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Graph    Graph    `json:"graph"`
	Warnings []string `json:"warnings"`
}

type DiagramImportResult struct {
	Format   string              `json:"format"`
	Pages    []DiagramImportPage `json:"pages"`
	Warnings []string            `json:"warnings"`
}

// ValidateDiagramFileInput validates the transport contract before forwarding.
// Browser workers perform bounded ZIP/XML parsing and choose the requested page.
func ValidateDiagramFileInput(data json.RawMessage, importing bool) error {
	return validateDiagramFileInput(data, importing, DiagramFileByteLimit)
}

func validateDiagramFileInput(data json.RawMessage, importing bool, byteLimit int) error {
	data = bytes.TrimSpace(data)
	if len(data) == 0 || data[0] != '{' {
		return errors.New("diagram file input must be an object")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return errors.New("invalid diagram file input")
	}
	for key := range fields {
		if key != "format" && key != "data" && key != "name" && !(importing && key == "pageId") {
			return fmt.Errorf("unknown diagram file input field: %s", key)
		}
	}
	var input DiagramFileInput
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		return errors.New("diagram file fields must be strings")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return errors.New("invalid diagram file input")
	}
	for key, raw := range fields {
		if len(raw) == 0 || raw[0] != '"' {
			return fmt.Errorf("%s must be a string", key)
		}
	}
	if input.Format != "drawio" && input.Format != "vsdx" {
		return errors.New("format must be drawio or vsdx; legacy .vsd and macro-enabled .vsdm are unsupported")
	}
	if strings.TrimSpace(input.Data) == "" {
		return errors.New("data must contain a diagram file")
	}
	for key, value := range map[string]string{"name": input.Name, "pageId": input.PageID} {
		if _, exists := fields[key]; exists && (strings.TrimSpace(value) == "" || utf8.RuneCountInString(value) > 500) {
			return fmt.Errorf("%s must be a nonempty string of at most 500 characters", key)
		}
	}
	if input.Format == "drawio" {
		if len(input.Data) > byteLimit {
			return fmt.Errorf("diagram file exceeds the %d-byte validation ceiling", byteLimit)
		}
		return nil
	}
	if len(input.Data) > base64.StdEncoding.EncodedLen(byteLimit) || strings.ContainsAny(input.Data, "\r\n") {
		return fmt.Errorf("vsdx data must be strict base64 within the %d-byte decoded validation ceiling", byteLimit)
	}
	decoded, err := base64.StdEncoding.Strict().DecodeString(input.Data)
	if err != nil || len(decoded) > byteLimit {
		return fmt.Errorf("vsdx data must be strict base64 within the %d-byte decoded validation ceiling", byteLimit)
	}
	if !bytes.HasPrefix(decoded, []byte{'P', 'K', 3, 4}) {
		return errors.New("vsdx data must contain a ZIP archive")
	}
	return nil
}
