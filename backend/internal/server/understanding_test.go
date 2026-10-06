package server

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestMCPUnderstandingDiscoveryWorksWithoutBrowser(t *testing.T) {
	handler, openapi := bundledMCPServer(t)
	initialized := resultMCP(t, callMCP(t, handler, "initialize", nil))
	guide := resultMCP(t, callMCP(t, handler, "tools/call", json.RawMessage(`{"name":"visual_nerve_api_docs"}`)))["content"].([]any)[0].(map[string]any)["text"].(string)
	for _, route := range []string{"/overview", "/questions", "/evidence", "/history", "/storyboard", "/build-specification", "/build-brief", "/presentation/seek"} {
		if !strings.Contains(guide, route) || !strings.Contains(initialized["instructions"].(string), route) || !strings.Contains(openapi, route) {
			t.Fatal("feature cannot be discovered without a browser", route)
		}
	}
	for _, detail := range []string{"Read only", "not proof of runtime impact", "do not save or send to an external service", "source:\"storyboard\""} {
		if !strings.Contains(guide, detail) {
			t.Fatal("missing behavior/permission context", detail)
		}
	}
}

func TestHistoryAndEvidenceGetTimeForLocalHashingAndSourceAnalysis(t *testing.T) {
	for _, path := range []string{"/diagrams/id/history", "/api/v1/diagrams/id/history/snapshot/restore", "/diagrams/id/evidence?nodeId=id&metricId=sum"} {
		if commandTimeout(path) != 45*time.Second {
			t.Fatal("local analysis/checkpoint timeout", path)
		}
	}
	if commandTimeout("/diagrams/id/questions") != 25*time.Second {
		t.Fatal("bounded question worker fits ordinary command timeout")
	}
}
