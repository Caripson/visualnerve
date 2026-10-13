package server

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"visualnerve/internal/model"
	"visualnerve/internal/robloxcloud"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func permitTestRobloxApproval(ctx context.Context, _ robloxcloud.Approval) bool {
	return ctx.Err() == nil
}

type fakeRobloxPublisher struct {
	calls     atomic.Int32
	started   chan struct{}
	cancelled chan struct{}
	block     bool
	release   chan struct{}
}

func (*fakeRobloxPublisher) Target() robloxcloud.Target {
	return robloxcloud.Target{UniverseID: "123", PlaceID: "456"}
}
func (p *fakeRobloxPublisher) Publish(ctx context.Context, data []byte, digest string) robloxcloud.Result {
	p.calls.Add(1)
	if p.started != nil {
		close(p.started)
	}
	if p.block {
		<-ctx.Done()
		close(p.cancelled)
		if p.release != nil {
			<-p.release
		}
	}
	return robloxcloud.Result{State: "succeeded", VersionNumber: 7}
}

func robloxConnection(t *testing.T, host *httptest.Server, access string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(host.URL, "http")+"/bridge", &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {host.URL}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.CloseNow() })
	if err = wsjson.Write(ctx, conn, map[string]string{"workspaceId": operationWorkspace, "peerMode": "content", "browserInstanceId": operationBrowser, "accessGrantId": operationGrant, "mcpAccess": access}); err != nil {
		t.Fatal(err)
	}
	var info map[string]any
	if err = wsjson.Read(ctx, conn, &info); err != nil || info["type"] != "bridge-info" {
		t.Fatal("missing handshake", err)
	}
	return conn
}
func robloxCall(t *testing.T, conn *websocket.Conn, grant, action string, data any) (int, map[string]any) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	id := model.UUID()
	if err := wsjson.Write(ctx, conn, map[string]any{"type": "roblox-publish", "requestId": id, "browserInstanceId": operationBrowser, "accessGrantId": grant, "action": action, "data": data}); err != nil {
		t.Fatal(err)
	}
	var reply struct {
		Type      string         `json:"type"`
		RequestID string         `json:"requestId"`
		Status    int            `json:"status"`
		Body      map[string]any `json:"body"`
	}
	if err := wsjson.Read(ctx, conn, &reply); err != nil {
		t.Fatal(err)
	}
	if reply.Type != "roblox-publish-result" || reply.RequestID != id {
		t.Fatal("publication correlation changed")
	}
	return reply.Status, reply.Body
}
func robloxBegin(data []byte) map[string]any {
	sum := sha256.Sum256(data)
	return map[string]any{"diagramId": "33333333-3333-4333-8333-333333333333", "baseVersion": 1, "artifactName": "game.rbxlx", "sha256": hex.EncodeToString(sum[:]), "totalBytes": len(data), "universeId": "123", "placeId": "456"}
}
func robloxAccess(t *testing.T, conn *websocket.Conn, mode, grant, access string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := wsjson.Write(ctx, conn, map[string]string{"peerMode": mode, "browserInstanceId": operationBrowser, "accessGrantId": grant, "mcpAccess": access}); err != nil {
		t.Fatal(err)
	}
}

func TestRobloxPublicationRequiresExplicitWriteAndConsumesExactlyOnePreparedUpload(t *testing.T) {
	fake := &fakeRobloxPublisher{}
	server := New(Config{Bridge: true, RobloxPublisher: fake, RobloxApproval: permitTestRobloxApproval})
	host := httptest.NewServer(server)
	defer host.Close()
	defer server.Close()
	conn := robloxConnection(t, host, "read")
	data := []byte(`<roblox version="4"><Item class="Folder"/></roblox>`)
	if status, body := robloxCall(t, conn, operationGrant, "capabilities", map[string]any{}); status != 200 || body["configured"] != true || strings.Contains(string(mustJSON(t, body)), "key") {
		t.Fatal("only safe publisher configuration is discoverable", body)
	}
	if status, _ := robloxCall(t, conn, operationGrant, "begin", robloxBegin(data)); status != 403 {
		t.Fatal("read-only cannot authorize publication")
	}
	grant := model.UUID()
	robloxAccess(t, conn, "content", grant, "write")
	status, body := robloxCall(t, conn, grant, "begin", robloxBegin(data))
	if status != 201 {
		t.Fatal(status, body)
	}
	nonce := body["nonce"].(string)
	if status, _ = robloxCall(t, conn, grant, "begin", robloxBegin(data)); status != 409 {
		t.Fatal("second pending upload accepted")
	}
	if status, _ = robloxCall(t, conn, grant, "chunk", map[string]any{"nonce": nonce, "index": 0, "offset": 1, "data": base64.StdEncoding.EncodeToString(data)}); status != 422 {
		t.Fatal("out-of-order byte offset accepted")
	}
	if status, _ = robloxCall(t, conn, grant, "chunk", map[string]any{"nonce": nonce, "index": 0, "offset": 0, "data": base64.StdEncoding.EncodeToString(data)}); status != 200 {
		t.Fatal("valid chunk rejected")
	}
	if status, body = robloxCall(t, conn, grant, "finalize", map[string]any{"nonce": nonce}); status != 200 || body["state"] != "succeeded" || body["versionNumber"] != float64(7) {
		t.Fatal("official result not reduced to safe receipt", status, body)
	}
	if status, _ = robloxCall(t, conn, grant, "finalize", map[string]any{"nonce": nonce}); status != 409 || fake.calls.Load() != 1 {
		t.Fatal("consumed finalization retried")
	}
}

func TestRobloxRevocationDestroysReceivingXMLAndBlocksContinuationByNewGrant(t *testing.T) {
	fake := &fakeRobloxPublisher{}
	server := New(Config{Bridge: true, RobloxPublisher: fake, RobloxApproval: permitTestRobloxApproval})
	host := httptest.NewServer(server)
	defer host.Close()
	defer server.Close()
	conn := robloxConnection(t, host, "write")
	data := []byte(`<roblox version="4"><Item class="Folder"/></roblox>`)
	_, body := robloxCall(t, conn, operationGrant, "begin", robloxBegin(data))
	nonce := body["nonce"].(string)
	robloxCall(t, conn, operationGrant, "chunk", map[string]any{"nonce": nonce, "index": 0, "offset": 0, "data": base64.StdEncoding.EncodeToString(data)})
	grant := model.UUID()
	robloxAccess(t, conn, "content", grant, "write")
	status, receipt := robloxCall(t, conn, grant, "status", map[string]any{"nonce": nonce})
	if status != 200 || receipt["state"] != "cancelled" {
		t.Fatal("new grant cannot retain upload authority", status, receipt)
	}
	server.mu.Lock()
	for _, publication := range server.robloxPublications {
		if len(publication.buffer) != 0 {
			t.Fatal("revocation retained private XML")
		}
	}
	server.mu.Unlock()
	if status, _ = robloxCall(t, conn, grant, "finalize", map[string]any{"nonce": nonce}); status != 403 || fake.calls.Load() != 0 {
		t.Fatal("fresh grant continued an older upload")
	}
}

func TestRobloxInFlightRevocationCancelsIOAndRequiresExplicitUnknownAcknowledgment(t *testing.T) {
	fake := &fakeRobloxPublisher{block: true, started: make(chan struct{}), cancelled: make(chan struct{})}
	server := New(Config{Bridge: true, RobloxPublisher: fake, RobloxApproval: permitTestRobloxApproval})
	host := httptest.NewServer(server)
	defer host.Close()
	defer server.Close()
	conn := robloxConnection(t, host, "write")
	data := []byte(`<roblox version="4"><Item class="Folder"/></roblox>`)
	_, body := robloxCall(t, conn, operationGrant, "begin", robloxBegin(data))
	nonce := body["nonce"].(string)
	robloxCall(t, conn, operationGrant, "chunk", map[string]any{"nonce": nonce, "index": 0, "offset": 0, "data": base64.StdEncoding.EncodeToString(data)})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := wsjson.Write(ctx, conn, map[string]any{"type": "roblox-publish", "requestId": model.UUID(), "browserInstanceId": operationBrowser, "accessGrantId": operationGrant, "action": "finalize", "data": map[string]any{"nonce": nonce}}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-fake.started:
	case <-ctx.Done():
		t.Fatal("publication did not start")
	}
	controlGrant := model.UUID()
	robloxAccess(t, conn, "control", controlGrant, "off")
	select {
	case <-fake.cancelled:
	case <-ctx.Done():
		t.Fatal("revocation did not abort HTTP")
	}
	grant := model.UUID()
	robloxAccess(t, conn, "content", grant, "write")
	status, receipt := robloxCall(t, conn, grant, "status", map[string]any{"nonce": nonce})
	if status != 200 || receipt["state"] != "unknown" || receipt["requiresDashboardReconciliation"] != true || receipt["versionNumber"] != nil {
		t.Fatal("late result crossed a revoked grant", status, receipt)
	}
	if status, _ = robloxCall(t, conn, grant, "begin", robloxBegin(data)); status != 409 {
		t.Fatal("unknown outcome allowed blind new upload")
	}
	if status, _ = robloxCall(t, conn, grant, "acknowledge-unknown", map[string]any{"nonce": nonce}); status != 200 {
		t.Fatal("explicit UI-only reconciliation rejected")
	}
	if status, _ = robloxCall(t, conn, grant, "begin", robloxBegin(data)); status != 201 {
		t.Fatal("acknowledged outcome did not release registry")
	}
	if fake.calls.Load() != 1 {
		t.Fatal("ambiguous request retried")
	}
}

func TestRobloxPublicationRejectsMalformedFramesAndDestinationsWithoutHTTP(t *testing.T) {
	for _, raw := range []string{`{"nonce":"a","nonce":"b"}`, `{"nonce":"a","password":"private"}`, `null`, `[]`} {
		var value struct {
			Nonce string `json:"nonce"`
		}
		if strictRobloxJSON(json.RawMessage(raw), &value) == nil {
			t.Fatal("malformed or credential-bearing command accepted")
		}
	}
	fake := &fakeRobloxPublisher{}
	server := New(Config{Bridge: true, RobloxPublisher: fake, RobloxApproval: permitTestRobloxApproval})
	host := httptest.NewServer(server)
	defer host.Close()
	defer server.Close()
	conn := robloxConnection(t, host, "write")
	data := []byte(`<roblox version="4"/>`)
	for _, field := range []string{"universeId", "placeId", "artifactName", "sha256"} {
		value := robloxBegin(data)
		value[field] = "https://localhost/private"
		if status, _ := robloxCall(t, conn, operationGrant, "begin", value); status != 422 {
			t.Fatal("unbound destination/digest accepted")
		}
	}
	if fake.calls.Load() != 0 {
		t.Fatal("invalid preparation reached HTTP")
	}
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestRobloxReceiptPruningRetainsUnreconciledUnknownOutcomes(t *testing.T) {
	server := New(Config{Bridge: true})
	defer server.Close()
	now := time.Now()
	old := now.Add(-robloxReceiptRetention)
	for _, state := range []string{"succeeded", "failed", "cancelled", "unknown"} {
		server.robloxPublications[robloxOwner{instance: state}] = &robloxPublication{receipt: robloxPublishReceipt{State: state}, finished: old}
	}
	server.robloxPublications[robloxOwner{instance: "active"}] = &robloxPublication{receipt: robloxPublishReceipt{State: "receiving"}}
	server.pruneRobloxLocked(now)
	if len(server.robloxPublications) != 2 || server.robloxPublications[robloxOwner{instance: "unknown"}] == nil || server.robloxPublications[robloxOwner{instance: "active"}] == nil {
		t.Fatal("pruning lost a live upload or an unknown outcome, or retained definitive expired metadata")
	}
}

func TestRobloxPendingBytesAreReservedAcrossPeersAndReleasedOnCleanup(t *testing.T) {
	server := New(Config{Bridge: true, RobloxPublisher: &fakeRobloxPublisher{}, RobloxApproval: permitTestRobloxApproval})
	defer server.Close()
	server.mu.Lock()
	defer server.mu.Unlock()
	peers := []*peer{}
	for index := 0; index < 4; index++ {
		p := &peer{workspace: operationWorkspace, origin: "http://localhost", instanceID: model.UUID(), grantID: operationGrant}
		peers = append(peers, p)
		data := robloxBegin([]byte(`<roblox/>`))
		data["totalBytes"] = robloxcloud.MaxPlaceBytes
		request := robloxPublishRequest{Action: "begin", Data: mustJSON(t, data)}
		status, _ := server.robloxPublishActionLocked(p, request)
		if index < 3 && status != 201 || index == 3 && status != 429 {
			t.Fatal("aggregate buffer admission unbounded", index, status)
		}
	}
	if server.robloxPendingBytes != 3*robloxcloud.MaxPlaceBytes {
		t.Fatal("declared bytes were not reserved at begin")
	}
	server.revokeRobloxLocked(peers[0])
	if server.robloxPendingBytes != 2*robloxcloud.MaxPlaceBytes {
		t.Fatal("receiving revocation retained private buffer budget")
	}
}

func TestRobloxRevokedNetworkPayloadRetainsBudgetUntilPublisherReturns(t *testing.T) {
	fake := &fakeRobloxPublisher{block: true, started: make(chan struct{}), cancelled: make(chan struct{}), release: make(chan struct{})}
	server := New(Config{Bridge: true, RobloxPublisher: fake, RobloxApproval: permitTestRobloxApproval})
	host := httptest.NewServer(server)
	defer host.Close()
	defer server.Close()
	conn := robloxConnection(t, host, "write")
	data := []byte(`<roblox version="4"/>`)
	_, receipt := robloxCall(t, conn, operationGrant, "begin", robloxBegin(data))
	nonce := receipt["nonce"].(string)
	robloxCall(t, conn, operationGrant, "chunk", map[string]any{"nonce": nonce, "index": 0, "offset": 0, "data": base64.StdEncoding.EncodeToString(data)})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := wsjson.Write(ctx, conn, map[string]any{"type": "roblox-publish", "requestId": model.UUID(), "browserInstanceId": operationBrowser, "accessGrantId": operationGrant, "action": "finalize", "data": map[string]string{"nonce": nonce}}); err != nil {
		t.Fatal(err)
	}
	<-fake.started
	robloxAccess(t, conn, "control", operationGrant, "off")
	<-fake.cancelled
	server.mu.Lock()
	reserved := server.robloxPendingBytes
	server.mu.Unlock()
	if reserved != len(data) {
		t.Fatal("revocation freed admission budget while HTTP payload was still allocated", reserved)
	}
	close(fake.release)
	deadline := time.Now().Add(time.Second)
	for {
		server.mu.Lock()
		remaining := server.robloxPendingBytes
		server.mu.Unlock()
		if remaining == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("HTTP cleanup did not release pending bytes")
		}
		time.Sleep(time.Millisecond)
	}
}

// A raw local API client can claim the allowed Origin and browser grant fields.
// These claims alone must never authorize the independent terminal boundary.
func forgedRobloxConnection(t *testing.T, host *httptest.Server) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(host.URL, "http")+"/bridge?token=synthetic-client-token", &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {"https://app.visualnerve.com"}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.CloseNow() })
	if err := wsjson.Write(ctx, conn, map[string]string{"workspaceId": operationWorkspace, "peerMode": "content", "browserInstanceId": operationBrowser, "accessGrantId": operationGrant, "mcpAccess": "write"}); err != nil {
		t.Fatal(err)
	}
	var info map[string]any
	if err := wsjson.Read(ctx, conn, &info); err != nil || info["type"] != "bridge-info" {
		t.Fatal("forged handshake fixture failed", err)
	}
	return conn
}

func TestRobloxForgedBrowserGrantCannotPublishWithoutIndependentApprover(t *testing.T) {
	fake := &fakeRobloxPublisher{}
	handler := New(Config{Bridge: true, Token: "synthetic-client-token", AllowedOrigins: []string{"https://app.visualnerve.com"}, RobloxPublisher: fake})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	conn := forgedRobloxConnection(t, host)
	if status, body := robloxCall(t, conn, operationGrant, "capabilities", map[string]any{}); status != 200 || body["configured"] != false || body["terminalApprovalRequired"] != true {
		t.Fatal("missing terminal approver did not fail closed")
	}
	if status, _ := robloxCall(t, conn, operationGrant, "begin", robloxBegin([]byte(`<roblox/>`))); status != 503 || fake.calls.Load() != 0 {
		t.Fatal("selfdeclared browser write bypassed missing terminal authority")
	}
}

func TestRobloxForgedGrantSendsNoHTTPUntilIndependentTerminalDecision(t *testing.T) {
	for _, approved := range []bool{false, true} {
		t.Run(map[bool]string{false: "denied", true: "approved"}[approved], func(t *testing.T) {
			decision := make(chan bool, 1)
			waiting := make(chan robloxcloud.Approval, 1)
			fake := &fakeRobloxPublisher{}
			approver := func(ctx context.Context, value robloxcloud.Approval) bool {
				waiting <- value
				select {
				case result := <-decision:
					return result
				case <-ctx.Done():
					return false
				}
			}
			handler := New(Config{Bridge: true, Token: "synthetic-client-token", AllowedOrigins: []string{"https://app.visualnerve.com"}, RobloxPublisher: fake, RobloxApproval: approver})
			host := httptest.NewServer(handler)
			defer host.Close()
			defer handler.Close()
			conn := forgedRobloxConnection(t, host)
			data := []byte(`<roblox version="4"/>`)
			_, receipt := robloxCall(t, conn, operationGrant, "begin", robloxBegin(data))
			nonce := receipt["nonce"].(string)
			robloxCall(t, conn, operationGrant, "chunk", map[string]any{"nonce": nonce, "index": 0, "offset": 0, "data": base64.StdEncoding.EncodeToString(data)})
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			id := model.UUID()
			if err := wsjson.Write(ctx, conn, map[string]any{"type": "roblox-publish", "requestId": id, "browserInstanceId": operationBrowser, "accessGrantId": operationGrant, "action": "finalize", "data": map[string]string{"nonce": nonce}}); err != nil {
				t.Fatal(err)
			}
			value := <-waiting
			if value.Nonce != nonce || value.SHA256 != receipt["sha256"] || value.TotalBytes != len(data) || value.BaseVersion != 1 || value.Target.PlaceID != "456" {
				t.Fatal("terminal decision was not bound to the captured receipt")
			}
			if status, body := robloxCall(t, conn, operationGrant, "status", map[string]string{"nonce": nonce}); status != 200 || body["state"] != "awaiting-approval" || fake.calls.Load() != 0 {
				t.Fatal("forged session dispatched before independent approval")
			}
			if status, _ := robloxCall(t, conn, operationGrant, "finalize", map[string]any{"nonce": nonce, "approved": true}); status != 422 || fake.calls.Load() != 0 {
				t.Fatal("request-body approval bypassed the terminal")
			}
			if status, _ := robloxCall(t, conn, operationGrant, "approve", map[string]string{"nonce": nonce}); status < 400 || fake.calls.Load() != 0 {
				t.Fatal("socket action bypassed the terminal")
			}
			decision <- approved
			var result struct {
				RequestID string               `json:"requestId"`
				Body      robloxPublishReceipt `json:"body"`
			}
			if err := wsjson.Read(ctx, conn, &result); err != nil || result.RequestID != id {
				t.Fatal("final decision correlation changed", err)
			}
			if approved {
				if result.Body.State != "succeeded" || fake.calls.Load() != 1 {
					t.Fatal("explicit independent approval did not permit exactly one dispatch")
				}
			} else {
				if result.Body.State != "cancelled" || fake.calls.Load() != 0 || result.Body.RequiresDashboardReconciliation {
					t.Fatal("terminal denial sent HTTP or claimed an unknown outcome")
				}
			}
		})
	}
}

func TestRobloxApprovalRevocationDiscardsXMLAndRejectsLateApproval(t *testing.T) {
	waiting := make(chan struct{})
	cancelled := make(chan struct{})
	fake := &fakeRobloxPublisher{}
	approver := func(ctx context.Context, _ robloxcloud.Approval) bool {
		close(waiting)
		<-ctx.Done()
		close(cancelled)
		return true
	} // A late true must still fail lifecycle checks.
	handler := New(Config{Bridge: true, RobloxPublisher: fake, RobloxApproval: approver})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	conn := robloxConnection(t, host, "write")
	data := []byte(`<roblox/>`)
	_, receipt := robloxCall(t, conn, operationGrant, "begin", robloxBegin(data))
	nonce := receipt["nonce"].(string)
	robloxCall(t, conn, operationGrant, "chunk", map[string]any{"nonce": nonce, "index": 0, "offset": 0, "data": base64.StdEncoding.EncodeToString(data)})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := wsjson.Write(ctx, conn, map[string]any{"type": "roblox-publish", "requestId": model.UUID(), "browserInstanceId": operationBrowser, "accessGrantId": operationGrant, "action": "finalize", "data": map[string]string{"nonce": nonce}}); err != nil {
		t.Fatal(err)
	}
	<-waiting
	robloxAccess(t, conn, "control", operationGrant, "off")
	<-cancelled
	handler.mu.Lock()
	bytes := handler.robloxPendingBytes
	publication := handler.robloxPublications[robloxOwner{operationWorkspace, host.URL, operationBrowser}]
	cleared := publication != nil && len(publication.buffer) == 0 && publication.receipt.State == "cancelled"
	handler.mu.Unlock()
	if !cleared || bytes != 0 || fake.calls.Load() != 0 {
		t.Fatal("approval revocation retained XML, byte reservation or HTTP authority")
	}
	grant := "22222222-2222-4222-8222-222222222223"
	robloxAccess(t, conn, "content", grant, "write")
	if status, body := robloxCall(t, conn, grant, "status", map[string]string{"nonce": nonce}); status != 200 || body["state"] != "cancelled" || body["requiresDashboardReconciliation"] != false {
		t.Fatal("pre-dispatch revocation became an ambiguous publication")
	}
}
