package server

import (
	"encoding/json"
	"visualnerve/internal/model"
)

func validateDiagramFileCommand(path, method string, data json.RawMessage) error {
	if method != "POST" {
		return nil
	}
	if path == "/diagram-files/preview" {
		return model.ValidateDiagramFileInput(data, false)
	}
	if path == "/import" {
		var input struct {
			Format string `json:"format"`
		}
		if json.Unmarshal(data, &input) == nil && (input.Format == "drawio" || input.Format == "vsdx") {
			return model.ValidateDiagramFileInput(data, true)
		}
	}
	return nil
}
