package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func controlBrowser(t *testing.T, handler *Server, host *httptest.Server, workspace, mode string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	handler.mu.Lock()
	count := len(handler.peers)
	handler.mu.Unlock()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(host.URL, "http")+"/bridge", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = wsjson.Write(ctx, conn, map[string]string{"workspaceId": workspace, "peerMode": mode}); err != nil {
		t.Fatal(err)
	}
	waitPeerState(t, handler, func() bool { return len(handler.peers) == count+1 })
	return conn
}
func waitPeerState(t *testing.T, handler *Server, ready func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		handler.mu.Lock()
		done := ready()
		handler.mu.Unlock()
		if done {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("peer state not updated")
		}
		time.Sleep(time.Millisecond)
	}
}
func TestSameWorkspacePrefersContentPeerOverRetainedControl(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	workspace := "00000000-0000-4000-8000-000000000001"
	control := controlBrowser(t, handler, host, workspace, "control")
	defer control.CloseNow()
	content := controlBrowser(t, handler, host, workspace, "content")
	defer content.CloseNow()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for i := 0; i < 20; i++ {
		result := make(chan reply, 1)
		fail := make(chan error, 1)
		go func() {
			response, err := handler.forward(ctx, workspace, "/diagrams", "POST", json.RawMessage(`{"title":"one write"}`))
			result <- response
			fail <- err
		}()
		var command map[string]any
		if err := wsjson.Read(ctx, content, &command); err != nil {
			t.Fatal("content peer not selected", err)
		}
		if err := wsjson.Write(ctx, content, map[string]any{"id": command["id"], "status": 201, "body": map[string]string{"id": "written"}}); err != nil {
			t.Fatal(err)
		}
		if response := <-result; response.Status != 201 {
			t.Fatal(response)
		}
		if err := <-fail; err != nil {
			t.Fatal(err)
		}
	}
}
func TestPeerAvailabilityUpdatesWithoutReconnectAndNeverRetriesDispatchedWrites(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	workspace := "00000000-0000-4000-8000-000000000001"
	first := controlBrowser(t, handler, host, workspace, "content")
	defer first.CloseNow()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := wsjson.Write(ctx, first, map[string]string{"peerMode": "control"}); err != nil {
		t.Fatal(err)
	}
	waitPeerState(t, handler, func() bool {
		for p := range handler.peers {
			if p.mode != "control" {
				return false
			}
		}
		return true
	})
	// Omitted mode is a backwards-compatible content peer.
	second := controlBrowser(t, handler, host, workspace, "")
	defer second.CloseNow()
	result := make(chan reply, 1)
	go func() {
		response, _ := handler.forward(ctx, workspace, "/diagrams", "POST", json.RawMessage(`{}`))
		result <- response
	}()
	var command map[string]any
	if err := wsjson.Read(ctx, second, &command); err != nil {
		t.Fatal(err)
	}
	if err := wsjson.Write(ctx, second, map[string]any{"id": command["id"], "status": 403, "body": map[string]string{"error": "fresh grant required"}}); err != nil {
		t.Fatal(err)
	}
	if response := <-result; response.Status != 403 {
		t.Fatal("dispatch must not retry against another peer", response)
	}
}
func TestOnlyControlPeerStillForwardsSafeStatusAndStructuredLockedContent(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	workspace := "00000000-0000-4000-8000-000000000001"
	browser := controlBrowser(t, handler, host, workspace, "control")
	defer browser.CloseNow()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, test := range []struct {
		path, method, body string
		status             int
	}{
		{"/workspace/security", "GET", `{"state":"locked"}`, 200},
		{"/workspace/lock", "POST", `{"state":"locked"}`, 200},
		{"/diagrams", "GET", `{"error":"Locked","code":"WORKSPACE_LOCKED"}`, 423},
	} {
		result := make(chan reply, 1)
		go func() {
			response, _ := handler.forward(ctx, workspace, test.path, test.method, json.RawMessage(`{}`))
			result <- response
		}()
		var command map[string]any
		if err := wsjson.Read(ctx, browser, &command); err != nil {
			t.Fatal(err)
		}
		if err := wsjson.Write(ctx, browser, map[string]any{"id": command["id"], "status": test.status, "body": json.RawMessage(test.body)}); err != nil {
			t.Fatal(err)
		}
		if response := <-result; response.Status != test.status || string(response.Body) != test.body {
			t.Fatal(response)
		}
	}
}

func TestBodylessLockRESTAndMCPPreserveOmittedArguments(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	browser := controlBrowser(t, handler, host, "00000000-0000-4000-8000-000000000001", "control")
	defer browser.CloseNow()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, transport := range []string{"REST", "MCP"} {
		done := make(chan error, 1)
		go func() {
			var command map[string]any
			if err := wsjson.Read(ctx, browser, &command); err != nil {
				done <- err
				return
			}
			if _, provided := command["data"]; provided {
				done <- fmt.Errorf("omitted lock arguments became explicit data: %v", command)
				return
			}
			done <- wsjson.Write(ctx, browser, map[string]any{"id": command["id"], "status": 200, "body": map[string]string{"state": "locked"}})
		}()
		if transport == "REST" {
			request, err := http.NewRequest("POST", host.URL+"/api/v1/workspace/lock", nil)
			if err != nil {
				t.Fatal(err)
			}
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			if response.StatusCode != 200 {
				t.Fatal("bodyless lock failed", response.StatusCode)
			}
		} else {
			result := resultMCP(t, callMCP(t, handler, "tools/call", json.RawMessage(`{"name":"visual_nerve_request","arguments":{"path":"/workspace/lock","method":"POST"}}`)))
			if result["isError"] != false || result["structuredContent"].(map[string]any)["status"] != float64(200) {
				t.Fatal(result)
			}
		}
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
}
