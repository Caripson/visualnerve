package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func TestStaticServerHasNoPersistentApplicationStorage(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "index.html"), []byte("Static workspace"), 0644); err != nil {
		t.Fatal(err)
	}
	server := New(Config{StaticDir: directory})
	host := httptest.NewServer(server)
	defer host.Close()
	defer server.Close()
	response, err := http.Get(host.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if !strings.Contains(string(body), "Static workspace") {
		t.Fatal(string(body))
	}
	response, err = http.Get(host.URL + "/api/v1/health")
	if err != nil {
		t.Fatal(err)
	}
	var health map[string]any
	_ = json.NewDecoder(response.Body).Decode(&health)
	response.Body.Close()
	if health["storage"] != "indexeddb" || health["bridge"] != false {
		t.Fatal(health)
	}
	response, err = http.Get(host.URL + "/api/v1/diagrams")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 503 {
		t.Fatal(response.StatusCode)
	}
	files, _ := os.ReadDir(directory)
	if len(files) != 1 {
		t.Fatalf("unexpected server data files: %v", files)
	}
}
func TestSecurityRejectsUntrustedHostOriginAndMissingToken(t *testing.T) {
	handler := New(Config{Bridge: true, Token: "secret"})
	defer handler.Close()
	for _, test := range []struct {
		host, origin, token string
		status              int
	}{{"attacker.example", "", "secret", 403}, {"127.0.0.1", "https://attacker.example", "secret", 403}, {"127.0.0.1", "", "", 401}, {"127.0.0.1", "", "wrong", 401}, {"127.0.0.1", "http://127.0.0.1", "secret", 503}} {
		request := httptest.NewRequest("GET", "http://"+test.host+"/api/v1/diagrams", nil)
		request.RemoteAddr = "127.0.0.1:12345"
		request.Header.Set("Origin", test.origin)
		if test.token != "" {
			request.Header.Set("Authorization", "Bearer "+test.token)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != test.status {
			t.Fatalf("%+v: %d %s", test, response.Code, response.Body.String())
		}
	}
}
func TestHostedOriginMustBeExplicitAndIntegrationPeersRemainLoopback(t *testing.T) {
	handler := New(Config{Bridge: true, AllowedOrigins: []string{"https://visualnerve.example.com"}})
	defer handler.Close()
	for _, test := range []struct {
		origin, peer string
		status       int
	}{
		{"https://visualnerve.example.com", "127.0.0.1:1234", 503},
		{"https://www.visualnerve.example.com", "127.0.0.1:1234", 403},
		{"https://visualnerve.example.com.attacker.test", "127.0.0.1:1234", 403},
		{"http://visualnerve.example.com", "127.0.0.1:1234", 403},
		{"https://visualnerve.example.com", "192.168.1.20:1234", 403},
		{"", "192.168.1.20:1234", 403},
		{"https://visualnerve.example.com", "[::1]:1234", 503},
	} {
		request := httptest.NewRequest("GET", "http://127.0.0.1:4317/api/v1/diagrams", nil)
		request.RemoteAddr = test.peer
		request.Header.Set("Origin", test.origin)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != test.status {
			t.Fatalf("%+v: %d %s", test, response.Code, response.Body.String())
		}
	}
}
func attach(t *testing.T, handler *Server, host *httptest.Server, workspace string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(host.URL, "http")+"/bridge", nil)
	if err != nil {
		t.Fatal(err)
	}
	conn.SetReadLimit(32 << 20)
	if err = wsjson.Write(ctx, conn, map[string]string{"workspaceId": workspace}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		handler.mu.Lock()
		connected := false
		for p := range handler.peers {
			if p.workspace == workspace {
				connected = true
			}
		}
		handler.mu.Unlock()
		if connected {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("browser handshake timed out")
		}
		time.Sleep(time.Millisecond)
	}
	return conn
}
func TestHTTPCommandsAreForwardedToBrowserAndNotRetained(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	conn := attach(t, handler, host, "00000000-0000-4000-8000-000000000001")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	browserDone := make(chan error, 1)
	go func() {
		var command struct {
			ID, Path, Method string
			Data             map[string]any
		}
		if err := wsjson.Read(ctx, conn, &command); err != nil {
			browserDone <- err
			return
		}
		if command.Path != "/diagrams" || command.Method != "POST" || command.Data["name"] != "Browser project" {
			browserDone <- io.ErrUnexpectedEOF
			return
		}
		browserDone <- wsjson.Write(ctx, conn, map[string]any{"id": command.ID, "status": 201, "body": map[string]string{"id": "browser-only-id"}})
	}()
	response, err := http.Post(host.URL+"/api/v1/diagrams", "application/json", strings.NewReader(`{"name":"Browser project"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var result map[string]any
	_ = json.NewDecoder(response.Body).Decode(&result)
	if response.StatusCode != 201 || result["id"] != "browser-only-id" {
		t.Fatalf("%d %v", response.StatusCode, result)
	}
	if err := <-browserDone; err != nil {
		t.Fatal(err)
	}
	_ = conn.Close(websocket.StatusNormalClosure, "finished")
	deadline := time.Now().Add(5 * time.Second)
	for {
		handler.mu.Lock()
		count := len(handler.peers)
		handler.mu.Unlock()
		if count == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("peer not removed")
		}
		time.Sleep(time.Millisecond)
	}
	response, err = http.Get(host.URL + "/api/v1/diagrams")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 503 {
		t.Fatal("server retained browser data")
	}
}
func TestMCPToolUsesTheSameBrowserBridge(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	call := func(body string) map[string]any {
		t.Helper()
		response, err := http.Post(host.URL+"/mcp", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var result map[string]any
		if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	initialized := call(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`)
	if initialized["result"].(map[string]any)["protocolVersion"] != "2025-06-18" {
		t.Fatal(initialized)
	}
	list := call(`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	if len(list["result"].(map[string]any)["tools"].([]any)) != 1 {
		t.Fatal(list)
	}
	tool := list["result"].(map[string]any)["tools"].([]any)[0].(map[string]any)
	if !strings.Contains(tool["description"].(string), "/spatial-diagrams") || !strings.Contains(tool["description"].(string), "independent readable 2D") {
		t.Fatal("MCP tool must expose the 3D creation and 2D export contract", tool)
	}
	absent := call(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"visual_nerve_request","arguments":{"path":"/diagrams"}}}`)
	if absent["result"].(map[string]any)["isError"] != true {
		t.Fatal(absent)
	}
	conn := attach(t, handler, host, "00000000-0000-4000-8000-000000000001")
	defer conn.CloseNow()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		var command map[string]any
		if err := wsjson.Read(ctx, conn, &command); err != nil {
			done <- err
			return
		}
		done <- wsjson.Write(ctx, conn, map[string]any{"id": command["id"], "status": 200, "body": []any{map[string]string{"name": "Stored in browser"}}})
	}()
	result := call(`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"visual_nerve_request","arguments":{"path":"/diagrams"}}}`)
	raw, _ := json.Marshal(result)
	if !bytes.Contains(raw, []byte("Stored in browser")) || result["result"].(map[string]any)["isError"] != false {
		t.Fatal(result)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
func TestMultipleWorkspacesRequireAnExplicitTarget(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	first := attach(t, handler, host, "00000000-0000-4000-8000-000000000001")
	defer first.CloseNow()
	second := attach(t, handler, host, "00000000-0000-4000-8000-000000000002")
	defer second.CloseNow()
	response, err := http.Get(host.URL + "/api/v1/diagrams")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 409 {
		t.Fatal(response.StatusCode)
	}
}
