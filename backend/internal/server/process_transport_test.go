package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket/wsjson"
)

// Simulation runs execute only in the browser. This verifies that REST and MCP
// preserve its same semantic commands, results and structured validation errors.
func TestProcessHierarchyRESTAndMCPForwardTheSameBrowserSemantics(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	workspace := "00000000-0000-4000-8000-000000000001"
	browser := attach(t, handler, host, workspace)
	defer browser.CloseNow()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tests := []struct {
		path, method, data, body string
		status                   int
	}{
		{"/diagrams/model/simulation/hierarchy", "GET", `null`, `{"rootProcessIds":["delivery"],"processes":[{"id":"delivery","name":"Delivery","childProcessIds":["packing"],"nodeIds":["work"],"directNodeIds":[]},{"id":"packing","name":"Packing","parentId":"delivery","childProcessIds":[],"nodeIds":["work"],"directNodeIds":["work"]}]}`, 200},
		{"/diagrams/model/simulation/runs", "POST", `{"seed":12345,"durationSeconds":1200,"animated":false,"speed":"max"}`, `{"id":"run-1","diagramId":"model","status":"running"}`, 201},
		{"/diagrams/model/simulation/runs/run-1/processes/packing", "GET", `null`, `{"id":"packing","parentId":"delivery","entered":10,"completed":10,"exited":10,"terminalCompleted":0,"resourceCost":60,"resourceCostAllocation":"occupied-units","queue":{"current":0,"maximum":9},"cycleTime":{"count":10,"average":330}}`, 200},
		{"/diagrams/model/simulation/processes/delivery?baseVersion=3", "DELETE", `null`, `{"error":"Reassign members atomically","code":"SIMULATION_PROCESS_REFERENCED","issues":[{"path":"processes.delivery","code":"SIMULATION_PROCESS_REFERENCED","message":"Reassign members atomically"}]}`, 422},
	}
	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			var responses []any
			for _, transport := range []string{"REST", "MCP"} {
				done := make(chan error, 1)
				commands := make(chan map[string]any, 1)
				go func() {
					var command map[string]any
					if err := wsjson.Read(ctx, browser, &command); err != nil {
						done <- err
						return
					}
					commands <- command
					done <- wsjson.Write(ctx, browser, map[string]any{"id": command["id"], "status": test.status, "body": json.RawMessage(test.body)})
				}()
				var body any
				if transport == "MCP" {
					params, err := json.Marshal(map[string]any{"name": "visual_nerve_request", "arguments": map[string]any{"path": test.path, "method": test.method, "data": json.RawMessage(test.data), "workspaceId": workspace}})
					if err != nil {
						t.Fatal(err)
					}
					result := resultMCP(t, callMCP(t, handler, "tools/call", params))
					structured := result["structuredContent"].(map[string]any)
					if structured["status"] != float64(test.status) || result["isError"] != (test.status >= 400) {
						t.Fatal("MCP changed the browser response status", result)
					}
					body = structured["body"]
				} else {
					request := httptest.NewRequest(test.method, "http://localhost/api/v1"+test.path, strings.NewReader(test.data))
					request.RemoteAddr = "127.0.0.1:23456"
					request.Header.Set("Content-Type", "application/json")
					response := httptest.NewRecorder()
					handler.ServeHTTP(response, request)
					if response.Code != test.status {
						t.Fatal("REST changed the browser response status", response.Code, response.Body.String())
					}
					if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
						t.Fatal(err)
					}
				}
				if err := <-done; err != nil {
					t.Fatal(err)
				}
				command := <-commands
				var wanted any
				if err := json.Unmarshal([]byte(test.data), &wanted); err != nil {
					t.Fatal(err)
				}
				if command["path"] != test.path || command["method"] != test.method || !reflect.DeepEqual(command["data"], wanted) {
					t.Fatal("transport changed the authoritative semantic command", transport, command)
				}
				responses = append(responses, body)
			}
			if !reflect.DeepEqual(responses[0], responses[1]) {
				t.Fatal("REST and MCP must expose the same semantic response", responses)
			}
		})
	}
}
