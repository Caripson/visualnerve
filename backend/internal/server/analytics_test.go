package server

import (
	"context"
	"encoding/json"
	"github.com/coder/websocket/wsjson"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAnalyticsDiscoveryUsesExistingMCPToolsAndExplicitBrowserAuthority(t *testing.T) {
	handler := New(Config{Bridge: true})
	defer handler.Close()
	initialized := resultMCP(t, callMCP(t, handler, "initialize", nil))
	for _, phrase := range []string{"Time Series & Signal Analysis", "diagram.analytics", "analytics-v1", "baseVersion", "Read only", "visual_nerve_api_docs", "/analytics/capabilities"} {
		if !strings.Contains(initialized["instructions"].(string), phrase) || !strings.Contains(mcpAPIGuide, phrase) {
			t.Fatal("discovery missing", phrase)
		}
	}
	if len(bridgeToolNames) != 2 || bridgeToolNames[0] != "visual_nerve_request" || bridgeToolNames[1] != "visual_nerve_api_docs" {
		t.Fatal("analysis must reuse existing tools")
	}
	found := false
	for _, capability := range bridgeCapabilities {
		found = found || capability == "analytics-v1"
	}
	if !found {
		t.Fatal("explicit bridge capability missing")
	}
	if !strings.Contains(mcpAnalyticsGuide, `"scenario"|"measurement"`) || !strings.Contains(mcpAnalyticsGuide, "Measurement SVG supports saved regression definitions only") {
		t.Fatal("bundled MCP guide must expose the implemented regression-only measurement SVG scope")
	}
}
func TestAnalyticsMCPForwardsCanonicalContentAndStructuredErrorsWithoutShadowModel(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	workspace := "00000000-0000-4000-8000-000000000001"
	browser := attach(t, handler, host, workspace)
	defer browser.CloseNow()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, test := range []struct {
		path, method, data, body string
		status                   int
	}{
		{"/diagrams/example/analytics/measure", "POST", `{"id":"customer-growth"}`, `{"kind":"measurement","measurementId":"customer-growth","metrics":{"absoluteChange":{"value":20},"relativeChange":{"value":0.2}},"notes":[]}`, 200},
		{"/diagrams/example/analytics/rules/retention", "PATCH", `{"baseVersion":2,"value":{"parameters":{"threshold":0.02}}}`, `{"diagramId":"example","baseVersion":3,"analytics":{"schemaVersion":1}}`, 200},
		{"/diagrams/example/analytics/jobs", "POST", `{"kind":"signals","input":{}}`, `{"jobId":"job-1","state":"running","progress":0}`, 201},
		{"/diagrams/example/analytics/project", "POST", `{"id":"stress"}`, `{"error":"Invalid rate","code":"INVALID_RATE_DENOMINATOR","issues":[{"path":"scenario.churnRate","severity":"error","code":"INVALID_RATE_DENOMINATOR","message":"Invalid rate"}]}`, 422},
	} {
		done := make(chan error, 1)
		go func() {
			var command map[string]any
			if err := wsjson.Read(ctx, browser, &command); err != nil {
				done <- err
				return
			}
			if command["path"] != test.path || command["method"] != test.method {
				done <- context.Canceled
				return
			}
			done <- wsjson.Write(ctx, browser, map[string]any{"id": command["id"], "status": test.status, "body": json.RawMessage(test.body)})
		}()
		params, _ := json.Marshal(map[string]any{"name": "visual_nerve_request", "arguments": map[string]any{"path": test.path, "method": test.method, "data": json.RawMessage(test.data), "workspaceId": workspace}})
		result := resultMCP(t, callMCP(t, handler, "tools/call", params))
		if err := <-done; err != nil {
			t.Fatal(err)
		}
		if result["content"].([]any)[0].(map[string]any)["text"] != test.body || result["structuredContent"].(map[string]any)["status"] != float64(test.status) || result["isError"] != (test.status >= 400) {
			t.Fatal("browser data/error changed", result)
		}
	}
}
