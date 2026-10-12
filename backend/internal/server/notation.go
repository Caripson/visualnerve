package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
)

var notationValidationPath = regexp.MustCompile(`^/diagrams/[a-fA-F0-9-]{36}/notation/validate$`)

func notationReadCommand(path, method string) bool {
	return method == "POST" && notationValidationPath.MatchString(path)
}

func validateNotationCommand(path, method string, data json.RawMessage) error {
	if !notationReadCommand(path, method) {
		return nil
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return nil
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(data, &fields) != nil || fields == nil || len(fields) != 0 {
		return fmt.Errorf("notation validation accepts only an omitted body or exactly {}")
	}
	return nil
}
