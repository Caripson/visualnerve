package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRobloxReadComputeCommandsNeverAllocateWriteRecovery(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	conn := operationBrowserConnection(t, host, operationBrowser, operationGrant)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	base := "/diagrams/00000000-0000-4000-8000-000000000005/roblox"
	for _, test := range []struct {
		path, method, data string
		status             int
	}{
		{base + "/validate", "POST", "", 200}, {base + "/validate", "POST", `{}`, 200}, {base + "/validate", "POST", `{"game":{"schemaVersion":1}}`, 200},
		{base + "/validate", "POST", `{"game":null}`, 200},
		{base + "/builds", "POST", `{"baseVersion":3}`, 202},
		{base + "/builds/00000000-0000-4000-8000-000000000006", "DELETE", `{}`, 200},
	} {
		result := startNotationForward(handler, ctx, test.path, test.method, test.data)
		command := readOperationCommand(t, conn)
		if command.OperationID != "" || command.OperationAction != "" || command.OperationNew {
			t.Fatal("read compute became a recoverable write", command)
		}
		respondOperation(t, conn, command, test.status, map[string]any{"valid": true})
		response := <-result
		if response.err != nil || response.reply.Status != test.status || response.reply.OperationID != "" || len(handler.operations) != 0 {
			t.Fatal("read compute retained operation state", response)
		}
	}
	for _, test := range []struct{ path, data string }{
		{base + "/validate", `null`}, {base + "/validate", `{"save":true}`},
		{base + "/builds", `{}`}, {base + "/builds", `{"baseVersion":0}`}, {base + "/builds", `{"baseVersion":1.5}`}, {base + "/builds", `{"baseVersion":1,"game":{}}`},
	} {
		response, err := handler.forwardOperation(ctx, operationWorkspace, test.path, "POST", json.RawMessage(test.data), "")
		if err == nil || response.Status != 422 || len(handler.operations) != 0 {
			t.Fatal("malformed compute dispatched", test, response, err)
		}
	}
	response, err := handler.forwardOperation(ctx, operationWorkspace, base+"/builds", "POST", json.RawMessage(`{"baseVersion":1}`), "invented")
	if err != nil || response.Status != 422 {
		t.Fatal("read compute accepted a write operation identity", response, err)
	}
	for _, suffix := range []string{"/", "?save=true", "#save"} {
		if robloxReadCommand(base+"/builds"+suffix, "POST") {
			t.Fatal("prefix routing widened pure authority", suffix)
		}
	}
	if robloxReadCommand("/diagrams/------------------------------------/roblox/builds", "POST") {
		t.Fatal("malformed UUID widened authority")
	}
}

func TestRobloxBridgeForwardsGameEditsAndStructuredValidationLosslessly(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	conn := operationBrowserConnection(t, host, operationBrowser, operationGrant)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	path := "/diagrams/00000000-0000-4000-8000-000000000005/roblox/entities/spawn"
	data := `{"baseVersion":2,"value":{"transform":{"position":{"x":0.25}},"movement":null}}`
	result := startNotationForward(handler, ctx, path, "PATCH", data)
	command := readOperationCommand(t, conn)
	if string(command.Data) != data || command.OperationID == "" {
		t.Fatal("bridge changed semantic partial edit or write identity", command)
	}
	body := json.RawMessage(`{"error":"Game validation failed","code":"ROBLOX_INVALID","diagnostics":[{"severity":"error","code":"reference","path":"game.rules[0]","message":"Missing entity."}]}`)
	respondOperation(t, conn, command, 422, body)
	response := <-result
	if response.err != nil || response.reply.Status != 422 || string(response.reply.Body) != string(body) {
		t.Fatal("structured validation changed in transport", response)
	}
}

func TestRobloxDiscoveryIsCompleteWithoutBrowserAndExcludesPublicationCommands(t *testing.T) {
	handler, openapi := bundledMCPServer(t)
	initialized := resultMCP(t, callMCP(t, handler, "initialize", nil))
	for _, phrase := range []string{"0.11.0", "roblox-game-builder-v1", "/roblox/capabilities", "/roblox/configuration", "baseVersion", "Read only", "game.rbxlx", "REST/MCP", "Creator Dashboard"} {
		if !strings.Contains(initialized["instructions"].(string), phrase) || !strings.Contains(mcpAPIGuide, phrase) {
			t.Fatal("game policy missing", phrase)
		}
	}
	for _, route := range []struct {
		path, method string
		phrases      []string
	}{
		{"/diagrams/{diagramId}/roblox", "PUT", []string{"RobloxGameDefinition", "RobloxPrefabExpression", "cooldown", "parameterId", "RobloxMutationSummary"}},
		{"/diagrams/{diagramId}/roblox/configuration", "GET", []string{"RobloxConfigurationSnapshot", "RobloxConfiguration", "baseVersion", "settings", "maxPlayers", "cannot yet build"}},
		{"/diagrams/{diagramId}/roblox/configuration", "PATCH", []string{"RobloxConfigurationPatch", "RobloxMutationSummary", "baseVersion", "maxPlayers", "unknown fields"}},
		{"/diagrams/{diagramId}/roblox/builds", "POST", []string{"RobloxBuildStatus", "202", "baseVersion", "state", "createdAt"}},
		{"/diagrams/{diagramId}/roblox/builds/{jobId}/artifacts/{artifactName}", "GET", []string{"RobloxArtifactChunk", "base64", "65536", "nextOffset"}},
	} {
		params, _ := json.Marshal(map[string]any{"name": "visual_nerve_api_docs", "arguments": map[string]any{"document": "endpoint", "path": route.path, "method": route.method}})
		result := resultMCP(t, callMCP(t, handler, "tools/call", params))
		content := result["content"].([]any)[0].(map[string]any)["text"].(string)
		for _, phrase := range route.phrases {
			if result["isError"] != false || !strings.Contains(content, phrase) {
				t.Fatal("complete dependency discovery missing", route.path, phrase)
			}
		}
	}
	if strings.Contains(openapi, `"/roblox/publish"`) || len(handler.peers) != 0 {
		t.Fatal("discovery introduced publication authority or required a browser")
	}
}

func TestRobloxPreviewTimeoutOutlivesOnlyTheExactWorkerRoute(t *testing.T) {
	path := "/diagrams/00000000-0000-4000-8000-000000000005/roblox/preview"
	if commandTimeout(path) != 40*time.Second || commandTimeout("/api/v1"+path) != 40*time.Second {
		t.Fatal("preview deadline must outlive its30-second worker")
	}
	for _, suffix := range []string{"/", "?save=true", "#save"} {
		if commandTimeout(path+suffix) != 25*time.Second {
			t.Fatal("prefix matching widened transport deadline")
		}
	}
}
