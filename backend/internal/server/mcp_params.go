package server

import (
	"bytes"
	"encoding/json"
)

type mcpError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func invalidMCPParams(message string) *mcpError {
	return &mcpError{Code: -32602, Message: message}
}

// Only JSON objects are accepted. In particular, null must not silently become
// an empty arguments object, and unknown keys must match additionalProperties.
func mcpObject(data json.RawMessage, optional bool, keys ...string) (map[string]json.RawMessage, *mcpError) {
	if len(data) == 0 && optional {
		return map[string]json.RawMessage{}, nil
	}
	data = bytes.TrimSpace(data)
	var object map[string]json.RawMessage
	if len(data) == 0 || data[0] != '{' || json.Unmarshal(data, &object) != nil {
		return nil, invalidMCPParams("parameters and arguments must be JSON objects")
	}
	for key := range object {
		allowed := false
		for _, supported := range keys {
			if key == supported {
				allowed = true
				break
			}
		}
		if !allowed {
			return nil, invalidMCPParams("unknown parameter or argument: " + key)
		}
	}
	return object, nil
}

func mcpString(object map[string]json.RawMessage, key string, required bool) (string, *mcpError) {
	data, exists := object[key]
	if !exists && !required {
		return "", nil
	}
	var value string
	if len(data) == 0 || data[0] != '"' || json.Unmarshal(data, &value) != nil || required && value == "" {
		return "", invalidMCPParams(key + " must be a nonempty string when required")
	}
	return value, nil
}

func mcpListParams(data json.RawMessage) *mcpError {
	object, err := mcpObject(data, true, "cursor", "_meta")
	if err != nil {
		return err
	}
	cursor, err := mcpString(object, "cursor", false)
	if err != nil {
		return err
	}
	if cursor != "" {
		return invalidMCPParams("this server has no pagination cursor")
	}
	return nil
}
