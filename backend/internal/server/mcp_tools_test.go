package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket/wsjson"
)

func TestMCPWorkspaceCommandsRemainBrowserControlled(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	workspace := "00000000-0000-4000-8000-000000000001"
	selected := attach(t, handler, host, workspace)
	defer selected.CloseNow()
	other := attach(t, handler, host, "00000000-0000-4000-8000-000000000002")
	defer other.CloseNow()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tests := []struct {
		path, method, data, body string
		status                   int
	}{
		{"/spatial-diagrams", "POST", `{"name":"Requested 3D diagram","type":"mindmap"}`, `{"diagram":{"id":"diagram-from-browser","version":1,"settings":{"spatialView":{"version":1,"mode":"3d"}}},"nodes":[],"edges":[]}`, 201},
		{"/diagrams/diagram-from-browser/bulk", "POST", `{"baseVersion":1,"upsert":true,"nodes":[{"externalId":"node-1","title":"Object","x":20,"y":40,"width":180,"height":80,"metadata":{"spatial":{"version":1,"position":{"x":1,"y":2,"z":3}}}}],"edges":[]}`, `{"error":"MCP access is Read only"}`, 403},
		{"/diagrams/diagram-from-browser/simulation/runs", "POST", `{"seed":12345,"durationSeconds":86400,"demandMultiplier":1.5,"animated":false}`, `{"id":"run-from-browser","status":"running","diagramId":"diagram-from-browser"}`, 201},
		{"/diagrams/diagram-from-browser/simulation/resources", "POST", `{"baseVersion":1,"value":{"id":"staff","name":"Staff","capacity":-1,"unit":"employee"}}`, `{"error":"Bad capacity","code":"SIMULATION_INVALID_MODEL","issues":[{"path":"resources.staff.capacity","code":"capacity","message":"Bad capacity"}]}`, 422},
		{"/presentation", "PATCH", `{"minimized":true}`, `{"open":true,"minimized":true,"status":"playing","subtitles":true}`, 200},
		{"/presentation", "PATCH", `{"minimized":false}`, `{"open":true,"minimized":false,"status":"playing","subtitles":true}`, 200},
	}
	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			commands := make(chan map[string]any, 1)
			done := make(chan error, 1)
			go func() {
				var command map[string]any
				if err := wsjson.Read(ctx, selected, &command); err != nil {
					done <- err
					return
				}
				commands <- command
				done <- wsjson.Write(ctx, selected, map[string]any{"id": command["id"], "status": test.status, "body": json.RawMessage(test.body)})
			}()
			params, err := json.Marshal(map[string]any{"name": "visual_nerve_request", "arguments": map[string]any{"path": test.path, "method": test.method, "data": json.RawMessage(test.data), "workspaceId": workspace}})
			if err != nil {
				t.Fatal(err)
			}
			result := resultMCP(t, callMCP(t, handler, "tools/call", params))
			if err := <-done; err != nil {
				t.Fatal(err)
			}
			command := <-commands
			if command["path"] != test.path || command["method"] != test.method {
				t.Fatal("workspace command was changed", command)
			}
			var wanted map[string]any
			if err := json.Unmarshal([]byte(test.data), &wanted); err != nil {
				t.Fatal(err)
			}
			gotData, _ := json.Marshal(command["data"])
			wantData, _ := json.Marshal(wanted)
			if string(gotData) != string(wantData) {
				t.Fatal("command data, including 2D/3D layout, must be forwarded unchanged", command)
			}
			structured := result["structuredContent"].(map[string]any)
			if structured["status"] != float64(test.status) || result["isError"] != (test.status >= 400) || result["content"].([]any)[0].(map[string]any)["text"] != test.body {
				t.Fatal("browser response and access rejection must be preserved", result)
			}
		})
	}
}
