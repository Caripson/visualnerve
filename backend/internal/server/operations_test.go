package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

const operationWorkspace = "00000000-0000-4000-8000-000000000001"
const operationBrowser = "11111111-1111-4111-8111-111111111111"
const operationGrant = "22222222-2222-4222-8222-222222222222"

type browserOperationCommand struct {
	ID, Path, Method  string
	Data              json.RawMessage
	OperationID       string `json:"operationId"`
	BrowserInstanceID string `json:"browserInstanceId"`
	AccessGrantID     string `json:"accessGrantId"`
	OperationAction   string `json:"operationAction"`
	OperationNew      bool   `json:"operationNew"`
}

func operationBrowserConnection(t *testing.T, host *httptest.Server, instance, grant string, origins ...string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var options *websocket.DialOptions
	if len(origins) != 0 {
		options = &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{origins[0]}}}
	}
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(host.URL, "http")+"/bridge", options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.CloseNow() })
	if err := wsjson.Write(ctx, conn, map[string]string{
		"workspaceId": operationWorkspace, "peerMode": "content",
		"browserInstanceId": instance, "accessGrantId": grant,
	}); err != nil {
		t.Fatal(err)
	}
	var info struct {
		Type, Version       string
		Tools, Capabilities []string
	}
	if err := wsjson.Read(ctx, conn, &info); err != nil {
		t.Fatal(err)
	}
	if info.Type != "bridge-info" || info.Version != bridgeVersion || len(info.Tools) != 2 || strings.Join(info.Capabilities, ",") != "operations-v1,endpoint-docs-v1,fork-join-v1,async-svg-export-v1,exchange-export-v1" {
		t.Fatalf("incomplete bridge discovery: %+v", info)
	}
	return conn
}

func readOperationCommand(t *testing.T, conn *websocket.Conn) browserOperationCommand {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var command browserOperationCommand
	if err := wsjson.Read(ctx, conn, &command); err != nil {
		t.Fatal(err)
	}
	return command
}

func respondOperation(t *testing.T, conn *websocket.Conn, command browserOperationCommand, status int, body any) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := wsjson.Write(ctx, conn, map[string]any{"id": command.ID, "status": status, "body": body}); err != nil {
		t.Fatal(err)
	}
}

type operationForwardResult struct {
	reply reply
	err   error
}

func startOperationForward(handler *Server, ctx context.Context, path, method, payload, id string) <-chan operationForwardResult {
	result := make(chan operationForwardResult, 1)
	go func() {
		response, err := handler.forwardOperation(ctx, operationWorkspace, path, method, json.RawMessage(payload), id)
		result <- operationForwardResult{response, err}
	}()
	return result
}

func operationErrorCode(t *testing.T, response reply) string {
	t.Helper()
	var body struct{ Code string }
	if err := json.Unmarshal(response.Body, &body); err != nil {
		t.Fatalf("missing structured error: %s: %v", response.Body, err)
	}
	return body.Code
}

func TestOperationReservationRESTHeaderAndSemanticStatus(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	conn := operationBrowserConnection(t, host, operationBrowser, operationGrant)
	type httpResult struct {
		response *http.Response
		err      error
	}
	request := func(method, path, data, id string) <-chan httpResult {
		result := make(chan httpResult, 1)
		go func() {
			req, err := http.NewRequest(method, host.URL+"/api/v1"+path, strings.NewReader(data))
			if err != nil {
				result <- httpResult{nil, err}
				return
			}
			req.Header.Set("Content-Type", "application/json")
			if id != "" {
				req.Header.Set("X-Visual-Nerve-Operation-Id", id)
			}
			response, err := http.DefaultClient.Do(req)
			result <- httpResult{response, err}
		}()
		return result
	}
	reserved := request("POST", "/operations", "{}", "")
	reserve := readOperationCommand(t, conn)
	if reserve.OperationID == "" || reserve.OperationAction != "reserve" || !reserve.OperationNew || reserve.BrowserInstanceID != operationBrowser || reserve.AccessGrantID != operationGrant {
		t.Fatalf("unsafe reservation: %+v", reserve)
	}
	respondOperation(t, conn, reserve, 201, map[string]any{"operationId": reserve.OperationID, "state": "reserved", "resultAvailable": false})
	reservation := <-reserved
	if reservation.err != nil {
		t.Fatal(reservation.err)
	}
	defer reservation.response.Body.Close()
	if reservation.response.StatusCode != 201 || reservation.response.Header.Get("X-Visual-Nerve-Operation-Id") != reserve.OperationID {
		t.Fatal("operation reservation identity was lost")
	}

	written := request("POST", "/diagrams", `{"name":"private local result"}`, reserve.OperationID)
	write := readOperationCommand(t, conn)
	if write.OperationID != reserve.OperationID || write.OperationAction != "execute" || write.OperationNew {
		t.Fatalf("reserved execution recreated its identity: %+v", write)
	}
	respondOperation(t, conn, write, 201, map[string]string{"id": "local-diagram-id", "name": "private local result"})
	response := <-written
	if response.err != nil {
		t.Fatal(response.err)
	}
	defer response.response.Body.Close()
	body, _ := io.ReadAll(response.response.Body)
	if response.response.StatusCode != 201 || response.response.Header.Get("X-Visual-Nerve-Operation-Id") != reserve.OperationID || !strings.Contains(string(body), "local-diagram-id") || strings.Contains(string(body), "operationId") {
		t.Fatalf("backward-compatible result lost: %s", body)
	}

	status := request("GET", "/operations/"+reserve.OperationID, "", "")
	inspect := readOperationCommand(t, conn)
	if inspect.OperationAction != "status" || inspect.OperationNew || inspect.OperationID != reserve.OperationID {
		t.Fatalf("status could execute work: %+v", inspect)
	}
	respondOperation(t, conn, inspect, 200, map[string]any{"operationId": reserve.OperationID, "state": "succeeded", "status": 201, "resultAvailable": true, "result": map[string]string{"id": "local-diagram-id"}})
	inspection := <-status
	if inspection.err != nil {
		t.Fatal(inspection.err)
	}
	inspection.response.Body.Close()
	handler.mu.Lock()
	metadata := fmt.Sprintf("%+v", handler.operations[reserve.OperationID])
	handler.mu.Unlock()
	if strings.Contains(metadata, "private local result") || strings.Contains(metadata, "local-diagram-id") {
		t.Fatal("bridge retained application content", metadata)
	}

	health, err := http.Get(host.URL + "/api/v1/health")
	if err != nil {
		t.Fatal(err)
	}
	defer health.Body.Close()
	publicHealth, _ := io.ReadAll(health.Body)
	if !strings.Contains(string(publicHealth), "operations-v1") || strings.Contains(string(publicHealth), operationWorkspace) || strings.Contains(string(publicHealth), operationBrowser) || strings.Contains(string(publicHealth), operationGrant) {
		t.Fatalf("unsafe or incomplete public discovery: %s", publicHealth)
	}
}

func TestOperationLateAcknowledgmentAndRetryPreserveAuthorityAndPayload(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	conn := operationBrowserConnection(t, host, operationBrowser, operationGrant)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	first := startOperationForward(handler, ctx, "/diagrams", "POST", `{"name":"late local commit","tags":["one"]}`, "")
	command := readOperationCommand(t, conn)
	if !command.OperationNew || command.OperationAction != "execute" || command.OperationID == "" {
		t.Fatalf("initial command was not protected: %+v", command)
	}
	timedOut := <-first
	if timedOut.err != nil || timedOut.reply.Status != 504 || timedOut.reply.OperationID != command.OperationID || operationErrorCode(t, timedOut.reply) != "OPERATION_OUTCOME_UNKNOWN" {
		t.Fatalf("timeout falsely implies a failed write: %+v", timedOut)
	}
	handler.mu.Lock()
	pending := 0
	for p := range handler.peers {
		for _, entry := range p.pending {
			if entry.operation != nil && entry.operation.id == command.OperationID {
				pending++
				if entry.response != nil {
					t.Error("timed-out waiter retained a private-response channel")
				}
			}
		}
	}
	handler.mu.Unlock()
	if pending != 1 {
		t.Fatalf("late response correlation was discarded: %d", pending)
	}
	respondOperation(t, conn, command, 201, map[string]string{"id": "one-late-commit"})
	waitPeerState(t, handler, func() bool { return handler.operations[command.OperationID].terminal })

	retry := startOperationForward(handler, context.Background(), "/diagrams", "POST", `{ "tags": ["one"], "name": "late local commit" }`, command.OperationID)
	replayed := readOperationCommand(t, conn)
	if replayed.OperationID != command.OperationID || replayed.OperationNew || replayed.BrowserInstanceID != operationBrowser || replayed.AccessGrantID != operationGrant {
		t.Fatalf("retry could recreate work: %+v", replayed)
	}
	respondOperation(t, conn, replayed, 201, map[string]string{"id": "one-late-commit"})
	if result := <-retry; result.err != nil || result.reply.Status != 201 {
		t.Fatal(result)
	}
	conflict, err := handler.forwardOperation(context.Background(), operationWorkspace, "/diagrams", "POST", json.RawMessage(`{"name":"different intent","tags":["one"]}`), command.OperationID)
	if err != nil || conflict.Status != 409 || operationErrorCode(t, conflict) != "OPERATION_CONFLICT" {
		t.Fatalf("operation ID was reused for another write: %v %v", conflict, err)
	}
	conflict, err = handler.forwardOperation(context.Background(), operationWorkspace, "/owners", "POST", json.RawMessage(`{"name":"late local commit","tags":["one"]}`), command.OperationID)
	if err != nil || conflict.Status != 409 || operationErrorCode(t, conflict) != "OPERATION_CONFLICT" {
		t.Fatal("operation path was not bound")
	}
}

func TestOperationDisconnectNeverRetriesIntoAnotherTabOrGrant(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	conn := operationBrowserConnection(t, host, operationBrowser, operationGrant)
	first := startOperationForward(handler, context.Background(), "/diagrams", "POST", `{"name":"one"}`, "")
	command := readOperationCommand(t, conn)
	_ = conn.CloseNow()
	interrupted := <-first
	if interrupted.reply.Status != 503 || operationErrorCode(t, interrupted.reply) != "OPERATION_OUTCOME_UNKNOWN" {
		t.Fatal("disconnect falsely reports failed write", interrupted)
	}
	_ = operationBrowserConnection(t, host, "33333333-3333-4333-8333-333333333333", operationGrant)
	for _, path := range []string{"/diagrams", "/operations/" + command.OperationID} {
		method, data := "POST", json.RawMessage(`{"name":"one"}`)
		if strings.HasPrefix(path, "/operations/") {
			method, data = "GET", nil
		}
		response, err := handler.forwardOperation(context.Background(), operationWorkspace, path, method, data, command.OperationID)
		if err != nil || response.Status != 409 || operationErrorCode(t, response) != "OPERATION_OUTCOME_UNKNOWN" {
			t.Fatal("ambiguous write rerouted to a different tab", response, err)
		}
	}
	newGrant := operationBrowserConnection(t, host, operationBrowser, "44444444-4444-4444-8444-444444444444")
	response, err := handler.forwardOperation(context.Background(), operationWorkspace, "/diagrams", "POST", json.RawMessage(`{"name":"one"}`), command.OperationID)
	if err != nil || response.Status != 409 || operationErrorCode(t, response) != "OPERATION_OUTCOME_UNKNOWN" {
		t.Fatal("fresh grant revived an old operation", response, err)
	}
	_ = newGrant.CloseNow()

	reconnected := operationBrowserConnection(t, host, operationBrowser, operationGrant)
	retry := startOperationForward(handler, context.Background(), "/diagrams", "POST", `{"name":"one"}`, command.OperationID)
	replayed := readOperationCommand(t, reconnected)
	if replayed.OperationNew || replayed.OperationID != command.OperationID {
		t.Fatal("same-authority reconnect lost idempotency identity")
	}
	respondOperation(t, reconnected, replayed, 201, map[string]string{"id": "original-result"})
	if result := <-retry; result.reply.Status != 201 || result.err != nil {
		t.Fatal(result)
	}
	wrongWorkspace, err := handler.forwardOperation(context.Background(), "55555555-5555-4555-8555-555555555555", "/operations/"+command.OperationID, "GET", nil, "")
	if err != nil || wrongWorkspace.Status != 409 || operationErrorCode(t, wrongWorkspace) != "OPERATION_SCOPE_MISMATCH" {
		t.Fatal("workspace scope was lost", wrongWorkspace, err)
	}
}

func TestOperationExpiryAndBridgeRestartNeverExecuteUnknownIDs(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	conn := operationBrowserConnection(t, host, operationBrowser, operationGrant)
	reservation := startOperationForward(handler, context.Background(), "/operations", "POST", `{}`, "")
	command := readOperationCommand(t, conn)
	respondOperation(t, conn, command, 201, map[string]string{"operationId": command.OperationID, "state": "reserved"})
	<-reservation
	handler.mu.Lock()
	handler.operations[command.OperationID].created = time.Now().Add(-operationRetention - time.Second)
	handler.mu.Unlock()
	expired, err := handler.forwardOperation(context.Background(), operationWorkspace, "/diagrams", "POST", json.RawMessage(`{"name":"must not execute"}`), command.OperationID)
	if err != nil || expired.Status != 410 || operationErrorCode(t, expired) != "OPERATION_EXPIRED" {
		t.Fatal("expired ID was interpreted as a new write", expired, err)
	}
	restarted := New(Config{Bridge: true})
	defer restarted.Close()
	unknown, err := restarted.forwardOperation(context.Background(), operationWorkspace, "/diagrams", "POST", json.RawMessage(`{"name":"must not execute"}`), command.OperationID)
	if err != nil || unknown.Status != 409 || operationErrorCode(t, unknown) != "OPERATION_OUTCOME_UNKNOWN" {
		t.Fatal("bridge restart lost unknown-outcome semantics", unknown, err)
	}
	invented := "vnop1." + handler.operationEpoch + "." + randomIdentifier()
	unknown, err = handler.forwardOperation(context.Background(), operationWorkspace, "/diagrams", "POST", json.RawMessage(`{"name":"must not execute"}`), invented)
	if err != nil || unknown.Status != 410 || operationErrorCode(t, unknown) != "OPERATION_EXPIRED" {
		t.Fatal("invented ID could execute a write", unknown, err)
	}
	invalid, err := handler.forwardOperation(context.Background(), operationWorkspace, "/diagrams", "POST", json.RawMessage(`{}`), "client-invented-id")
	if err != nil || invalid.Status != 422 || operationErrorCode(t, invalid) != "INVALID_OPERATION_ID" {
		t.Fatal("arbitrary IDs were accepted", invalid, err)
	}
}

func TestOperationOriginIsolationAndConcurrentRetryNeverCreateNewIdentity(t *testing.T) {
	handler := New(Config{Bridge: true, AllowedOrigins: []string{"https://one.example", "https://two.example"}})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	conn := operationBrowserConnection(t, host, operationBrowser, operationGrant, "https://one.example")
	first := startOperationForward(handler, context.Background(), "/diagrams", "POST", `{"name":"one"}`, "")
	initial := readOperationCommand(t, conn)
	retry := startOperationForward(handler, context.Background(), "/diagrams", "POST", `{"name":"one"}`, initial.OperationID)
	duplicate := readOperationCommand(t, conn)
	if !initial.OperationNew || duplicate.OperationNew || duplicate.OperationID != initial.OperationID || duplicate.BrowserInstanceID != initial.BrowserInstanceID || duplicate.AccessGrantID != initial.AccessGrantID {
		t.Fatal("concurrent retry was presented as another new operation", initial, duplicate)
	}
	respondOperation(t, conn, initial, 201, map[string]string{"id": "one-local-result"})
	respondOperation(t, conn, duplicate, 201, map[string]string{"id": "one-local-result"})
	if result := <-first; result.err != nil || result.reply.Status != 201 {
		t.Fatal(result)
	}
	if result := <-retry; result.err != nil || result.reply.Status != 201 {
		t.Fatal(result)
	}
	_ = conn.CloseNow()
	waitPeerState(t, handler, func() bool { return len(handler.peers) == 0 })
	_ = operationBrowserConnection(t, host, operationBrowser, operationGrant, "https://two.example")
	response, err := handler.forwardOperation(context.Background(), operationWorkspace, "/diagrams", "POST", json.RawMessage(`{"name":"one"}`), initial.OperationID)
	if err != nil || response.Status != 409 || operationErrorCode(t, response) != "OPERATION_OUTCOME_UNKNOWN" {
		t.Fatal("same identifiers from another allowed origin revived an operation", response, err)
	}
}

func TestOperationIntentionalLockCanReplyAfterGrantRotation(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	conn := operationBrowserConnection(t, host, operationBrowser, operationGrant)
	lock := startOperationForward(handler, context.Background(), "/workspace/lock", "POST", `{}`, "")
	command := readOperationCommand(t, conn)
	newGrant := "44444444-4444-4444-8444-444444444444"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := wsjson.Write(ctx, conn, map[string]string{"peerMode": "control", "browserInstanceId": operationBrowser, "accessGrantId": newGrant}); err != nil {
		t.Fatal(err)
	}
	waitPeerState(t, handler, func() bool {
		for p := range handler.peers {
			if p.grantID == newGrant && p.mode == "control" {
				return true
			}
		}
		return false
	})
	respondOperation(t, conn, command, 200, map[string]string{"state": "locked", "type": "workspace-security"})
	if result := <-lock; result.err != nil || result.reply.Status != 200 || !strings.Contains(string(result.reply.Body), "locked") {
		t.Fatal("intentional lock lost its safe public acknowledgment", result)
	}
	status, err := handler.forwardOperation(context.Background(), operationWorkspace, "/operations/"+command.OperationID, "GET", nil, "")
	if err != nil || status.Status != 409 || operationErrorCode(t, status) != "OPERATION_OUTCOME_UNKNOWN" {
		t.Fatal("revoked grant could inspect a previous result", status, err)
	}
}

func TestOperationLegacyTimeoutAndReservationAreExplicitlyUnprotected(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	conn := attach(t, handler, host, operationWorkspace)
	reservation, err := handler.forwardOperation(context.Background(), operationWorkspace, "/operations", "POST", json.RawMessage(`{}`), "")
	if err != nil || reservation.Status != 426 || operationErrorCode(t, reservation) != "OPERATION_PROTOCOL_REQUIRED" {
		t.Fatal("legacy client could claim safe retries", reservation, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	write := startOperationForward(handler, ctx, "/diagrams", "POST", `{"name":"legacy"}`, "")
	command := readOperationCommand(t, conn)
	if command.OperationID != "" {
		t.Fatal("legacy client falsely advertises a receipt")
	}
	result := <-write
	if result.err != nil || result.reply.Status != 504 || result.reply.OperationID != "" || operationErrorCode(t, result.reply) != "OPERATION_OUTCOME_UNKNOWN" {
		t.Fatal("legacy timeout falsely implies write failure", result)
	}
}

func TestOperationFingerprintAndRetentionLimitsAreBounded(t *testing.T) {
	if operationFingerprint("/one", "POST", nil) == operationFingerprint("/one", "POST", json.RawMessage(`null`)) {
		t.Fatal("absent and null data are distinct browser commands")
	}
	bound := &bridgeOperation{id: "fingerprint-test"}
	if failure := bound.bind("/one", "POST", nil); failure != nil {
		t.Fatal("initial bodyless binding failed", failure)
	}
	if failure := bound.bind("/one", "POST", json.RawMessage(`null`)); failure == nil || failure.Status != 409 || operationErrorCode(t, *failure) != "OPERATION_CONFLICT" {
		t.Fatal("a null retry changed a bodyless operation", failure)
	}
	if operationFingerprint("/one", "POST", json.RawMessage(`{"a":9007199254740993,"b":1}`)) != operationFingerprint("/one", "POST", json.RawMessage(`{ "b": 1, "a": 9007199254740993 }`)) {
		t.Fatal("fingerprint lost canonical JSON or integer precision")
	}
	handler := New(Config{Bridge: true})
	defer handler.Close()
	selected := &peer{workspace: operationWorkspace, instanceID: operationBrowser, grantID: operationGrant}
	handler.mu.Lock()
	for i := 0; i < maxBridgeOperations; i++ {
		if _, failure := handler.newOperationLocked(selected); failure != nil {
			t.Fatal(failure)
		}
	}
	before := len(handler.operations)
	_, failure := handler.newOperationLocked(selected)
	if failure == nil || failure.Status != 429 || operationErrorCode(t, *failure) != "OPERATION_LIMIT" || len(handler.operations) != before {
		t.Fatal("retention pressure evicted an ambiguous operation")
	}
	handler.mu.Unlock()
}

func TestMCPWriteOperationIdentityIsNotTheJSONRPCRequestID(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	conn := operationBrowserConnection(t, host, operationBrowser, operationGrant)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	done := make(chan any, 1)
	go func() {
		result, err := handler.mcpRequestTool(ctx, json.RawMessage(`{"path":"/diagrams","method":"POST","data":{"name":"one"}}`))
		if err != nil {
			done <- err
			return
		}
		done <- result
	}()
	command := readOperationCommand(t, conn)
	result, ok := (<-done).(map[string]any)
	if !ok {
		t.Fatal("MCP tool failed unexpectedly")
	}
	structured := result["structuredContent"].(map[string]any)
	if result["isError"] != true || structured["status"] != 504 || structured["operationId"] != command.OperationID {
		t.Fatalf("MCP discarded recovery identity: %+v", result)
	}
	var body struct{ Code, OperationID string }
	if err := json.Unmarshal(structured["body"].(json.RawMessage), &body); err != nil || body.Code != "OPERATION_OUTCOME_UNKNOWN" || body.OperationID != command.OperationID {
		t.Fatal("MCP replaced the semantic error with a transport string", structured)
	}
}

func TestEmptyOrRepeatedOperationIdentityIsNeverTreatedAsNewWork(t *testing.T) {
	handler := New(Config{Bridge: true})
	defer handler.Close()
	if _, failure := handler.mcpRequestTool(context.Background(), json.RawMessage(`{"path":"/diagrams","method":"POST","data":{},"operationId":""}`)); failure == nil || failure.Code != -32602 {
		t.Fatal("empty MCP operation identity became a new write", failure)
	}
	for _, values := range [][]string{{""}, {"first", "second"}} {
		request := httptest.NewRequest("POST", "http://127.0.0.1/api/v1/diagrams", strings.NewReader(`{}`))
		request.RemoteAddr = "127.0.0.1:12345"
		request.Header.Set("Content-Type", "application/json")
		request.Header["X-Visual-Nerve-Operation-Id"] = values
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != 422 || !strings.Contains(response.Body.String(), "INVALID_OPERATION_ID") {
			t.Fatal("ambiguous REST operation identity became new work", response.Code, response.Body.String())
		}
	}
}
