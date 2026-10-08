package server

import (
	"strings"
	"testing"
)

func TestMCPDiscoversIndependentZIPSourceFileLimit(t *testing.T) {
	for surface, text := range map[string]string{"initialize": mcpInstructions, "request": mcpToolDescription, "guide": mcpAPIGuide} {
		for _, phrase := range []string{"/code/capabilities", "/settings/project-source-file-limit", "500..10000", "captured", "source payloads cannot override", "directory records", "sourceFileLimit", "supported and guaranteed"} {
			if !strings.Contains(text, phrase) {
				t.Fatalf("%s omits ZIP source-file policy %q", surface, phrase)
			}
		}
	}
}
