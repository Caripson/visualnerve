package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPresentationValidationSharedByHTTPAndMCPTransport(t *testing.T) {
	server := New(Config{Bridge: true})
	defer server.Close()
	for _, test := range []struct {
		path, method, body string
		status             int
	}{
		{"/presentation", "GET", "", 503},
		{"/presentation/voices", "GET", "", 503},
		{"/presentation/play", "POST", `{}`, 503},
		{"/presentation/open", "POST", `{"source":"storyboard"}`, 503},
		{"/presentation/open", "POST", `{"source":"invalid"}`, 422},
		{"/presentation/seek", "POST", `{"index":0}`, 503},
		{"/presentation/seek", "POST", `{"index":-1}`, 422},
		{"/presentation/seek", "POST", `{}`, 422},
		{"/presentation/open", "POST", `{"diagramId":"bad"}`, 422},
		{"/presentation/pause", "POST", `{"unknown":true}`, 422},
		{"/presentation", "PATCH", `{"audio":true}`, 503},
		{"/presentation", "PATCH", `{"audio":"true"}`, 422},
		{"/presentation/video", "GET", "", 503},
		{"/presentation/video", "POST", `{}`, 503},
		{"/presentation/video", "POST", `{"audio":true,"subtitles":false}`, 503},
		{"/presentation/video", "POST", `{"audio":"true"}`, 422},
		{"/presentation/video", "POST", `{"preload":true}`, 422},
		{"/presentation/video", "DELETE", `{}`, 503},
		{"/presentation/video", "DELETE", `{"subtitles":false}`, 422},
		{"/settings/presentation-voice", "PUT", `{"value":"sv_SE-nst-medium"}`, 503},
	} {
		response, _ := server.forward(context.Background(), "", test.path, test.method, json.RawMessage(test.body))
		if response.Status != test.status {
			t.Fatalf("%s: got %d, want %d", test.path, response.Status, test.status)
		}
	}
}

func TestPresentationVideoExactBodiesThroughHTTPAndMCP(t *testing.T) {
	handler := New(Config{Bridge: true})
	defer handler.Close()
	for _, test := range []struct {
		method, body string
		status       int
	}{
		{"GET", "", 503},
		{"POST", `{}`, 503},
		{"POST", `{"audio":true,"subtitles":false}`, 503},
		{"POST", `{"source":"storyboard","audio":true,"subtitles":false}`, 503},
		{"POST", `{"source":"nodes"}`, 503},
		{"POST", `{"source":"slides"}`, 422},
		{"POST", `{"source":null}`, 422},
		{"POST", `{"audio":null}`, 422},
		{"POST", `{"subtitles":"true"}`, 422},
		{"POST", `{"format":"mp4"}`, 422},
		{"DELETE", `{}`, 503},
		{"DELETE", `{"audio":false}`, 422},
		{"DELETE", `{"source":"storyboard"}`, 422},
		{"DELETE", `null`, 422},
	} {
		request := httptest.NewRequest(test.method, "http://localhost/api/v1/presentation/video", strings.NewReader(test.body))
		request.RemoteAddr = "127.0.0.1:12345"
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != test.status {
			t.Fatalf("HTTP %s %s: got %d, want %d: %s", test.method, test.body, response.Code, test.status, response.Body.String())
		}
		arguments := map[string]any{"path": "/presentation/video", "method": test.method}
		if test.body != "" {
			arguments["data"] = json.RawMessage(test.body)
		}
		params, err := json.Marshal(map[string]any{"name": "visual_nerve_request", "arguments": arguments})
		if err != nil {
			t.Fatal(err)
		}
		result := resultMCP(t, callMCP(t, handler, "tools/call", params))
		status := result["structuredContent"].(map[string]any)["status"]
		if status != float64(test.status) {
			t.Fatalf("MCP %s %s: got %v, want %d", test.method, test.body, status, test.status)
		}
	}
	// Cancel requires JSON, while existing graph DELETE routes remain bodyless.
	for _, test := range []struct {
		path   string
		status int
	}{{"/presentation/video", 400}, {"/nodes/00000000-0000-4000-8000-000000000001", 503}} {
		request := httptest.NewRequest("DELETE", "http://localhost/api/v1"+test.path, nil)
		request.RemoteAddr = "127.0.0.1:12345"
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != test.status {
			t.Fatalf("bodyless HTTP DELETE %s: got %d, want %d", test.path, response.Code, test.status)
		}
	}
}

func TestStoryboardOpenAndSeekThroughHTTPAndMCP(t *testing.T) {
	handler := New(Config{Bridge: true})
	defer handler.Close()
	for _, test := range []struct {
		path, body string
		status     int
	}{
		{"/presentation/open", `{}`, 503},
		{"/presentation/open", `{"source":"nodes"}`, 503},
		{"/presentation/open", `{"source":"storyboard","diagramId":"00000000-0000-4000-8000-000000000001"}`, 503},
		{"/presentation/open", `{"source":"slides"}`, 422},
		{"/presentation/open", `{"source":true}`, 422},
		{"/presentation/open", `{"source":null}`, 422},
		{"/presentation/open", `{"source":"storyboard","unknown":true}`, 422},
		{"/presentation/seek", `{"index":0}`, 503},
		{"/presentation/seek", `{"index":5}`, 503},
		{"/presentation/seek", `{"index":1.0}`, 503},
		{"/presentation/seek", `{"index":1e2}`, 503},
		{"/presentation/seek", `{}`, 422},
		{"/presentation/seek", `{"index":-1}`, 422},
		{"/presentation/seek", `{"index":0.5}`, 422},
		{"/presentation/seek", `{"index":9007199254740992}`, 422},
		{"/presentation/seek", `{"index":"0"}`, 422},
		{"/presentation/seek", `{"index":null}`, 422},
		{"/presentation/seek", `{"index":0,"source":"storyboard"}`, 422},
		{"/presentation/seek", `[]`, 422},
	} {
		request := httptest.NewRequest("POST", "http://localhost/api/v1"+test.path, strings.NewReader(test.body))
		request.RemoteAddr = "127.0.0.1:12345"
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != test.status {
			t.Fatalf("HTTP %s %s: got %d, want %d: %s", test.path, test.body, response.Code, test.status, response.Body.String())
		}
		params, err := json.Marshal(map[string]any{"name": "visual_nerve_request", "arguments": map[string]any{"path": test.path, "method": "POST", "data": json.RawMessage(test.body)}})
		if err != nil {
			t.Fatal(err)
		}
		result := resultMCP(t, callMCP(t, handler, "tools/call", params))
		status := result["structuredContent"].(map[string]any)["status"]
		if status != float64(test.status) {
			t.Fatalf("MCP %s %s: got %v, want %d", test.path, test.body, status, test.status)
		}
	}
}
