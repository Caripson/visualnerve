package model

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
)

var nodeBackgroundColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func validNodeBackgroundColor(value string) bool {
	return nodeBackgroundColorPattern.MatchString(value)
}

// Complete DTOs reject explicit empty/null fills; MergePatch removes a null key
// before decoding, so ordinary versioned partial updates can restore theme fill.
func (node *Node) UnmarshalJSON(data []byte) error {
	if err := notationFieldNotNull(data); err != nil {
		return err
	}
	type nativeNode Node
	var decoded nativeNode
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if raw, exists := fields["backgroundColor"]; exists {
		if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) || !validNodeBackgroundColor(decoded.BackgroundColor) {
			return fmt.Errorf("node backgroundColor must be a six-digit hex color (#RRGGBB)")
		}
	}
	if err := validateNodeNotationAppearance(Node(decoded)); err != nil {
		return err
	}
	*node = Node(decoded)
	return nil
}
