package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"visualnerve/internal/model"
)

// These are exact read-compute routes, not permission inferred from a prefix.
// The browser owns leases, grants, current-version checks and strict game ASTs.
func robloxReadCommand(path, method string) bool {
	parts := strings.Split(path, "/")
	if len(parts) < 5 || parts[0] != "" || parts[1] != "diagrams" || !model.ValidID(parts[2]) || parts[3] != "roblox" {
		return false
	}
	if method == "POST" && len(parts) == 5 {
		return parts[4] == "validate" || parts[4] == "preview" || parts[4] == "builds"
	}
	return method == "DELETE" && len(parts) == 6 && parts[4] == "builds" && model.ValidID(parts[5])
}

func pureReadCommand(path, method string) bool {
	return method == "GET" || notationReadCommand(path, method) || robloxReadCommand(path, method)
}

func validateRobloxCommand(path, method string, data json.RawMessage) error {
	if !robloxReadCommand(path, method) {
		return nil
	}
	parts := strings.Split(path, "/")
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 && (method == "DELETE" || parts[4] == "validate") {
		return nil
	}
	var fields map[string]json.RawMessage
	if len(trimmed) == 0 || trimmed[0] != '{' || json.Unmarshal(trimmed, &fields) != nil || fields == nil {
		return fmt.Errorf("use an exact Roblox read-compute command object")
	}
	if method == "DELETE" {
		if len(fields) != 0 {
			return fmt.Errorf("build cancellation accepts only {} or an omitted body")
		}
		return nil
	}
	if parts[4] == "validate" {
		if len(fields) > 1 || len(fields) == 1 && fields["game"] == nil {
			return fmt.Errorf("validation accepts only {} or {game:GameDefinition}")
		}
		// An explicit invalid draft, including null, is inspected by the same
		// authoritative validator and returned as valid:false diagnostics.
		return nil
	}
	if parts[4] == "preview" {
		if len(fields) < 1 || len(fields) > 2 || fields["steps"] == nil || len(fields) == 2 && fields["history"] == nil {
			return fmt.Errorf("preview accepts only {steps,history?}")
		}
		var steps []json.RawMessage
		if json.Unmarshal(fields["steps"], &steps) != nil || steps == nil || len(steps) > 128 {
			return fmt.Errorf("preview requires at most 128 explicit steps")
		}
		if value, present := fields["history"]; present {
			var history bool
			if bytes.Equal(bytes.TrimSpace(value), []byte("null")) || json.Unmarshal(value, &history) != nil {
				return fmt.Errorf("history must be a boolean")
			}
		}
		return nil
	}
	var version int64
	if len(fields) != 1 || json.Unmarshal(fields["baseVersion"], &version) != nil || version < 1 {
		return fmt.Errorf("builds accept only {baseVersion:positiveInteger} for the saved current game")
	}
	return nil
}
