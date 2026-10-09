package server

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// endpointOpenAPI keeps one documented operation and every component needed to
// interpret it. It reads only the bundled contract, never URLs or workspace data.
func endpointOpenAPI(data []byte, path, method string) ([]byte, error) {
	var document map[string]any
	if err := json.Unmarshal(data, &document); err != nil {
		return nil, fmt.Errorf("bundled OpenAPI must use the generated JSON-compatible YAML format: %w", err)
	}
	paths, _ := document["paths"].(map[string]any)
	item, _ := paths[path].(map[string]any)
	operation, _ := item[strings.ToLower(method)].(map[string]any)
	if operation == nil {
		return nil, fmt.Errorf("no bundled OpenAPI operation for %s %s; use the exact documented path template without /api/v1 or query parameters", method, path)
	}
	if item["$ref"] != nil {
		return nil, fmt.Errorf("bundled OpenAPI path references are not supported for endpoint discovery")
	}
	selected := map[string]any{strings.ToLower(method): operation}
	for _, key := range []string{"summary", "description", "parameters", "servers"} {
		if value, exists := item[key]; exists {
			selected[key] = value
		}
	}
	output := map[string]any{"openapi": document["openapi"], "info": document["info"], "paths": map[string]any{path: selected}}
	for _, key := range []string{"servers", "security"} {
		if value, exists := document[key]; exists {
			output[key] = value
		}
	}
	components, _ := document["components"].(map[string]any)
	closure := map[string]any{}
	visited := map[string]bool{}
	pending := []any{selected}
	addComponent := func(section, name string) error {
		key := section + "/" + name
		if visited[key] {
			return nil
		}
		entries, _ := components[section].(map[string]any)
		value, exists := entries[name]
		if !exists {
			return fmt.Errorf("bundled OpenAPI component is missing: %s", key)
		}
		visited[key] = true
		if closure[section] == nil {
			closure[section] = map[string]any{}
		}
		closure[section].(map[string]any)[name] = value
		pending = append(pending, value)
		return nil
	}
	// Security requirement names refer to components without using $ref.
	for _, security := range []any{document["security"], operation["security"]} {
		for _, requirement := range asAnySlice(security) {
			for name := range asAnyObject(requirement) {
				if err := addComponent("securitySchemes", name); err != nil {
					return nil, err
				}
			}
		}
	}
	for len(pending) > 0 {
		last := len(pending) - 1
		value := pending[last]
		pending = pending[:last]
		switch value := value.(type) {
		case map[string]any:
			if reference, exists := value["$ref"]; exists {
				text, ok := reference.(string)
				if !ok {
					return nil, fmt.Errorf("bundled OpenAPI reference must be a string")
				}
				tokens, err := componentPointer(text)
				if err != nil {
					return nil, err
				}
				if _, err := resolveJSONPointer(document, tokens); err != nil {
					return nil, fmt.Errorf("unresolved bundled OpenAPI reference %q: %w", text, err)
				}
				if err := addComponent(tokens[1], tokens[2]); err != nil {
					return nil, err
				}
			}
			for _, child := range value {
				pending = append(pending, child)
			}
		case []any:
			pending = append(pending, value...)
		}
	}
	if len(closure) > 0 {
		output["components"] = closure
	}
	return json.MarshalIndent(output, "", "  ")
}

func asAnySlice(value any) []any {
	items, _ := value.([]any)
	return items
}

func asAnyObject(value any) map[string]any {
	item, _ := value.(map[string]any)
	return item
}

func componentPointer(reference string) ([]string, error) {
	if !strings.HasPrefix(reference, "#/") {
		return nil, fmt.Errorf("endpoint discovery permits bundled component references only: %q", reference)
	}
	pointer, err := url.PathUnescape(strings.TrimPrefix(reference, "#"))
	if err != nil {
		return nil, fmt.Errorf("invalid bundled OpenAPI reference: %q", reference)
	}
	tokens := strings.Split(strings.TrimPrefix(pointer, "/"), "/")
	for i, token := range tokens {
		for pos := 0; pos < len(token); pos++ {
			if token[pos] == '~' {
				if pos+1 >= len(token) || token[pos+1] != '0' && token[pos+1] != '1' {
					return nil, fmt.Errorf("invalid JSON pointer escape in bundled OpenAPI reference: %q", reference)
				}
				pos++
			}
		}
		tokens[i] = strings.ReplaceAll(strings.ReplaceAll(token, "~1", "/"), "~0", "~")
	}
	if len(tokens) < 3 || tokens[0] != "components" || tokens[1] == "" || tokens[2] == "" {
		return nil, fmt.Errorf("endpoint discovery permits bundled component references only: %q", reference)
	}
	return tokens, nil
}

func resolveJSONPointer(document any, tokens []string) (any, error) {
	value := document
	for _, token := range tokens {
		switch container := value.(type) {
		case map[string]any:
			var exists bool
			value, exists = container[token]
			if !exists {
				return nil, fmt.Errorf("missing pointer segment %q", token)
			}
		case []any:
			index, err := strconv.Atoi(token)
			if err != nil || index < 0 || index >= len(container) || strconv.Itoa(index) != token {
				return nil, fmt.Errorf("invalid array pointer segment %q", token)
			}
			value = container[index]
		default:
			return nil, fmt.Errorf("non-container pointer segment %q", token)
		}
	}
	return value, nil
}
