package server

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket/wsjson"
)

type stdioFixture struct {
	input  *io.PipeWriter
	output *bufio.Reader
	done   chan error
	cancel context.CancelFunc
}

func localStdio(t *testing.T, target, token string) *stdioFixture {
	t.Helper()
	input, clientInput := io.Pipe()
	clientOutput, output := io.Pipe()
	ctx, cancel := context.WithCancel(context.Background())
	f := &stdioFixture{input: clientInput, output: bufio.NewReader(clientOutput), done: make(chan error, 1), cancel: cancel}
	go func() { f.done <- RunMCPStdio(ctx, input, output, target, token) }()
	t.Cleanup(func() { cancel(); _ = clientInput.Close(); _ = clientOutput.Close() })
	return f
}

func (f *stdioFixture) send(t *testing.T, body string) {
	t.Helper()
	if _, err := io.WriteString(f.input, body+"\n"); err != nil {
		t.Fatal(err)
	}
}

func (f *stdioFixture) receive(t *testing.T) map[string]any {
	t.Helper()
	type received struct {
		body map[string]any
		err  error
	}
	done := make(chan received, 1)
	go func() {
		line, err := f.output.ReadBytes('\n')
		var body map[string]any
		if err == nil {
			err = json.Unmarshal(line, &body)
		}
		done <- received{body, err}
	}()
	select {
	case response := <-done:
		if response.err != nil {
			t.Fatal(response.err)
		}
		if response.body["jsonrpc"] != "2.0" {
			t.Fatal("stdout must contain only MCP JSON", response.body)
		}
		return response.body
	case <-time.After(5 * time.Second):
		t.Fatal("stdio did not return a correlated response")
		return nil
	}
}

func (f *stdioFixture) finish(t *testing.T) {
	t.Helper()
	_ = f.input.Close()
	select {
	case err := <-f.done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("stdio did not stop after input EOF")
	}
}

func (f *stdioFixture) initialize(t *testing.T) {
	t.Helper()
	f.send(t, `{"jsonrpc":"2.0","id":"initialize","method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"generic test client","version":"1"}}}`)
	if resultMCP(t, f.receive(t))["protocolVersion"] != "2025-11-25" {
		t.Fatal("could not initialize the shared bridge")
	}
}

func stdioInitialized(w http.ResponseWriter, id json.RawMessage) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": id, "result": map[string]any{"protocolVersion": "2025-11-25", "serverInfo": map[string]string{"name": "visual-nerve", "version": "test"}, "capabilities": map[string]any{}}})
}

func TestMCPStdioURLIsRestrictedToExactLoopbackEndpoint(t *testing.T) {
	for _, value := range []string{DefaultMCPURL, "http://localhost:4317/mcp", "https://127.0.0.1:443/mcp", "https://[::1]:4317/mcp"} {
		if _, err := MCPStdioURL(value); err != nil {
			t.Fatal(value, err)
		}
	}
	for _, value := range []string{"https://example.com:443/mcp", "http://0.0.0.0:4317/mcp", "http://127.0.0.2:4317/mcp", "http://localhost/mcp", "http://localhost:0/mcp", "http://localhost:65536/mcp", "http://localhost:4317/mcp/", "http://localhost:4317/%6dcp", "http://localhost:4317/bridge", "ws://localhost:4317/mcp", "file:///mcp", "http://test-user:test-password@localhost:4317/mcp", "http://localhost:4317/mcp?token=test-token", "http://localhost:4317/mcp#fragment"} {
		_, err := MCPStdioURL(value)
		if err == nil {
			t.Fatal("accepted non-local/arbitrary fetch URL", value)
		}
		if strings.Contains(err.Error(), "test-password") || strings.Contains(err.Error(), "test-token") {
			t.Fatal("validation must not expose URL credentials")
		}
	}
}

func TestMCPStdioUsesSharedHTTPDiscoveryAndNegotiatedHeaders(t *testing.T) {
	handler, _ := bundledMCPServer(t)
	var mu sync.Mutex
	var versions []string
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		versions = append(versions, r.Header.Get("MCP-Protocol-Version"))
		mu.Unlock()
		handler.ServeHTTP(w, r)
	}))
	defer host.Close()
	f := localStdio(t, host.URL+"/mcp", "")
	f.send(t, `{"jsonrpc":"2.0","id":"init","method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"generic stdio client","version":"1"}}}`)
	if resultMCP(t, f.receive(t))["protocolVersion"] != "2025-11-25" {
		t.Fatal("stdio must preserve HTTP version negotiation")
	}
	f.send(t, `{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	f.send(t, `{"jsonrpc":"2.0","id":0,"method":"tools/list"}`)
	listed := f.receive(t)
	if listed["id"] != float64(0) || len(resultMCP(t, listed)["tools"].([]any)) != 2 {
		t.Fatal("notifications must not create stdout responses", listed)
	}
	f.send(t, `{"jsonrpc":"2.0","id":"resource","method":"resources/read","params":{"uri":"visual-nerve://docs/guide"}}`)
	resource := f.receive(t)
	if resource["id"] != "resource" || len(resultMCP(t, resource)["contents"].([]any)) != 1 {
		t.Fatal(resource)
	}
	f.send(t, `{"jsonrpc":"2.0","id":"docs","method":"tools/call","params":{"name":"visual_nerve_api_docs"}}`)
	if resultMCP(t, f.receive(t))["isError"] != false {
		t.Fatal("default guide discovery must work through stdio")
	}
	f.finish(t)
	mu.Lock()
	observed := append([]string(nil), versions...)
	mu.Unlock()
	if len(observed) != 5 || observed[0] != "" {
		t.Fatal("initial request negotiates in its body", observed)
	}
	for _, version := range observed[1:] {
		if version != "2025-11-25" {
			t.Fatal("all subsequent stdio requests carry the negotiated standard header", observed)
		}
	}
	response, err := http.Get(host.URL + "/api/v1/health")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal("adapter EOF must not stop the shared bridge")
	}
}

func TestMCPStdioPreservesCorrelatedParallelFramesAndTokenHeader(t *testing.T) {
	const token = "test-only-stdio-bearer"
	var active, maximum atomic.Int32
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/mcp" || r.URL.RawQuery != "" || r.Header.Get("Authorization") != "Bearer "+token || r.Header.Get("MCP-Protocol-Version") != "2025-03-26" || r.Header.Get("Accept") != "application/json, text/event-stream" {
			http.Error(w, "bad standard request", 400)
			return
		}
		count := active.Add(1)
		defer active.Add(-1)
		for {
			old := maximum.Load()
			if count <= old || maximum.CompareAndSwap(old, count) {
				break
			}
		}
		var request stdioRequest
		if json.NewDecoder(r.Body).Decode(&request) != nil {
			http.Error(w, "invalid JSON", 400)
			return
		}
		time.Sleep(25 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		encoder := json.NewEncoder(w)
		encoder.SetIndent("", "  ")
		_ = encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": map[string]any{"text": "line one\nline two"}})
	}))
	defer host.Close()
	f := localStdio(t, host.URL+"/mcp", token)
	identifiers := []string{`"alpha"`, `1`, `"bravo"`, `2`, `"charlie"`, `3`, `"delta"`, `4`, `"echo"`, `5`, `"foxtrot"`, `6`}
	sent := make(chan error, 1)
	go func() {
		for _, id := range identifiers {
			if _, err := io.WriteString(f.input, `{"jsonrpc":"2.0","id":`+id+`,"method":"ping"}`+"\n"); err != nil {
				sent <- err
				return
			}
		}
		sent <- nil
	}()
	ids := map[any]bool{}
	for i := 0; i < len(identifiers); i++ {
		response := f.receive(t)
		if ids[response["id"]] || resultMCP(t, response)["text"] != "line one\nline two" {
			t.Fatal("response framing/correlation changed", response)
		}
		ids[response["id"]] = true
	}
	if err := <-sent; err != nil {
		t.Fatal(err)
	}
	if len(ids) != len(identifiers) || maximum.Load() < 2 || maximum.Load() > mcpConcurrency {
		t.Fatal("parallel calls must be bounded and correlated", len(ids), maximum.Load())
	}
	f.finish(t)
}

func TestMCPStdioForwardsOptionalControlDataAndLockedErrors(t *testing.T) {
	handler := New(Config{Bridge: true})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	browser := controlBrowser(t, handler, host, "00000000-0000-4000-8000-000000000001", "control")
	defer browser.CloseNow()
	f := localStdio(t, host.URL+"/mcp", "")
	f.initialize(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, test := range []struct {
		path, method string
		status       int
		body         string
	}{
		{"/workspace/security", "GET", 200, `{"mode":"encrypted","state":"locked","programmaticUnlock":false}`},
		{"/workspace/lock", "POST", 200, `{"mode":"encrypted","state":"locked","programmaticLock":true}`},
		{"/diagrams", "GET", 423, `{"error":"Unlock the workspace in the browser to continue.","code":"WORKSPACE_LOCKED"}`},
	} {
		f.send(t, `{"jsonrpc":"2.0","id":"control","method":"tools/call","params":{"name":"visual_nerve_request","arguments":{"path":"`+test.path+`","method":"`+test.method+`"}}}`)
		var command map[string]json.RawMessage
		if err := wsjson.Read(ctx, browser, &command); err != nil {
			t.Fatal(err)
		}
		if test.path == "/workspace/lock" && len(command["data"]) != 0 {
			t.Fatal("omitted lock body must remain omitted", command)
		}
		if err := wsjson.Write(ctx, browser, map[string]any{"id": command["id"], "status": test.status, "body": json.RawMessage(test.body)}); err != nil {
			t.Fatal(err)
		}
		result := resultMCP(t, f.receive(t))
		if result["structuredContent"].(map[string]any)["status"] != float64(test.status) || result["isError"] != (test.status >= 400) || result["content"].([]any)[0].(map[string]any)["text"] != test.body {
			t.Fatal("stdio must preserve browser control/errors", result)
		}
	}
	f.finish(t)
}

func TestMCPStdioNeverFollowsRedirectsOrRetriesMutations(t *testing.T) {
	var calls, redirected atomic.Int32
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirected.Add(1) }))
	defer other.Close()
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request stdioRequest
		_ = json.NewDecoder(r.Body).Decode(&request)
		if request.Method == "initialize" {
			stdioInitialized(w, request.ID)
			return
		}
		calls.Add(1)
		http.Redirect(w, r, other.URL+"/mcp", http.StatusTemporaryRedirect)
	}))
	defer host.Close()
	f := localStdio(t, host.URL+"/mcp", "test-only-private-token")
	f.initialize(t)
	f.send(t, `{"jsonrpc":"2.0","id":"mutation","method":"tools/call","params":{"name":"visual_nerve_request","arguments":{"path":"/diagrams","method":"POST","data":{"name":"one mutation"}}}}`)
	response := f.receive(t)
	if response["id"] != "mutation" || response["error"].(map[string]any)["message"] != "Local MCP endpoint returned HTTP 307." || calls.Load() != 1 || redirected.Load() != 0 {
		t.Fatal("mutations/authentication must not follow redirects or retry", response, calls.Load(), redirected.Load())
	}
	f.finish(t)
}

func TestMCPStdioRejectsUnrelatedServerBeforePrivateCommands(t *testing.T) {
	var calls atomic.Int32
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var request stdioRequest
		_ = json.NewDecoder(r.Body).Decode(&request)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": map[string]any{"protocolVersion": "2025-11-25", "serverInfo": map[string]string{"name": "unrelated-local-service", "version": "1"}, "capabilities": map[string]any{}}})
	}))
	defer host.Close()
	f := localStdio(t, host.URL+"/mcp", "")
	f.send(t, `{"jsonrpc":"2.0","id":"before-init","method":"tools/call","params":{"name":"visual_nerve_request","arguments":{"path":"/diagrams","method":"POST","data":{"name":"private title"}}}}`)
	if f.receive(t)["error"] == nil || calls.Load() != 0 {
		t.Fatal("content must not be sent before a compatible handshake")
	}
	f.send(t, `{"jsonrpc":"2.0","id":"init","method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"generic client","version":"1"}}}`)
	response := f.receive(t)
	if response["id"] != "init" || response["error"] == nil || response["result"] != nil {
		t.Fatal("another service must not be accepted as the configured bridge", response)
	}
	f.send(t, `{"jsonrpc":"2.0","id":"after-bad-init","method":"tools/call","params":{"name":"visual_nerve_request","arguments":{"path":"/diagrams","method":"POST","data":{"name":"private title"}}}}`)
	if f.receive(t)["error"] == nil || calls.Load() != 1 {
		t.Fatal("failed endpoint verification must not enable private command forwarding", calls.Load())
	}
	f.finish(t)
}

func TestMCPStdioCorrelatesDecodedStringsAndExactNumbers(t *testing.T) {
	for _, test := range []struct {
		name, requestID, responseID string
		matches                     bool
	}{
		{"HTML escapes", `"<agent&1>"`, `"\u003cagent\u00261\u003e"`, true},
		{"Unicode escapes", `"\u0061gent"`, `"agent"`, true},
		{"Unicode surrogate pair", `"😀"`, `"\ud83d\ude00"`, true},
		{"integer decimal", `1`, `1.0`, true},
		{"decimal exponent", `0.1`, `1e-1`, true},
		{"numeric zero", `-0`, `0`, true},
		{"large integer exponent", `100000000000000000001`, `1.00000000000000000001e20`, true},
		{"large negative exponent", `1e-1000000000000000000000`, `10e-1000000000000000000001`, true},
		{"integer rounding collision", `9007199254740993`, `9007199254740992`, false},
		{"decimal rounding collision", `0.10000000000000001`, `0.1`, false},
		{"string number type", `"1"`, `1`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, `{"jsonrpc":"2.0","id":`+test.responseID+`,"result":{"correlated":true}}`)
			}))
			defer host.Close()
			f := localStdio(t, host.URL+"/mcp", "")
			f.send(t, `{"jsonrpc":"2.0","id":`+test.requestID+`,"method":"ping"}`)
			response := f.receive(t)
			if test.matches {
				if response["error"] != nil || resultMCP(t, response)["correlated"] != true {
					t.Fatal("semantically equal request IDs must correlate", response)
				}
			} else if response["error"] == nil || response["result"] != nil {
				t.Fatal("distinct IDs must not correlate through numeric rounding or type conversion", response)
			}
			f.finish(t)
		})
	}
}

func TestMCPStdioRejectsInitializeWithoutObjectCapabilities(t *testing.T) {
	for _, capabilities := range []string{"", `,"capabilities":null`, `,"capabilities":[]`, `,"capabilities":"tools"`} {
		t.Run(capabilities, func(t *testing.T) {
			var calls atomic.Int32
			host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				var request stdioRequest
				_ = json.NewDecoder(r.Body).Decode(&request)
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, `{"jsonrpc":"2.0","id":`+string(request.ID)+`,"result":{"protocolVersion":"2025-11-25","serverInfo":{"name":"visual-nerve","version":"test"}`+capabilities+`}}`)
			}))
			defer host.Close()
			f := localStdio(t, host.URL+"/mcp", "")
			f.send(t, `{"jsonrpc":"2.0","id":"init","method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"generic client","version":"1"}}}`)
			if response := f.receive(t); response["error"] == nil || response["result"] != nil {
				t.Fatal("invalid capabilities must not complete the handshake", response)
			}
			f.send(t, `{"jsonrpc":"2.0","id":"private","method":"tools/call","params":{"name":"visual_nerve_request","arguments":{"path":"/diagrams","method":"POST","data":{}}}}`)
			if f.receive(t)["error"] == nil || calls.Load() != 1 {
				t.Fatal("invalid initialization must not enable private requests", calls.Load())
			}
			f.finish(t)
		})
	}
}

func TestMCPStdioRejectsOversizedAndMalformedFramesBeforeHTTP(t *testing.T) {
	var calls atomic.Int32
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }))
	defer host.Close()
	for _, body := range []string{strings.Repeat("x", mcpFrameBytes+1) + "\n", `{"jsonrpc":"2.0","id":null,"method":"ping"}` + "\n", `not JSON` + "\n", "{\"jsonrpc\":\"2.0\",\"id\":\"invalid-\xff\",\"method\":\"ping\"}\n"} {
		var output bytes.Buffer
		if err := RunMCPStdio(context.Background(), strings.NewReader(body), &output, host.URL+"/mcp", ""); err == nil {
			t.Fatal("accepted unsafe input")
		}
		if output.Len() != 0 || calls.Load() != 0 {
			t.Fatal("invalid frames must never reach HTTP/stdout")
		}
	}
}

func TestMCPStdioRejectsUncorrelatedOrOversizedHTTPResponses(t *testing.T) {
	for _, body := range []string{`{"jsonrpc":"2.0","id":"someone-else","result":{}}`, `{"jsonrpc":"2.0","id":"request","result":{},"error":{"code":-32603,"message":"both"}}`, strings.Repeat("x", mcpFrameBytes+1), "{\"jsonrpc\":\"2.0\",\"id\":\"request\",\"result\":{\"text\":\"invalid-\xff\"}}"} {
		host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, body)
		}))
		f := localStdio(t, host.URL+"/mcp", "")
		f.send(t, `{"jsonrpc":"2.0","id":"request","method":"ping"}`)
		response := f.receive(t)
		if response["id"] != "request" || response["result"] != nil || response["error"].(map[string]any)["code"] != float64(-32000) {
			t.Fatal("unsafe response must become a bounded correlated transport error", response)
		}
		f.finish(t)
		host.Close()
	}
}

func TestMCPStdioEOFInterruptsEightActiveRequestsAndNinthPendingFrame(t *testing.T) {
	entered, aborted := make(chan struct{}, mcpConcurrency), make(chan struct{}, mcpConcurrency)
	cleanup := make(chan struct{})
	var calls atomic.Int32
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(200)
			return
		}
		var request stdioRequest
		_ = json.NewDecoder(r.Body).Decode(&request)
		if request.Method == "initialize" {
			stdioInitialized(w, request.ID)
			return
		}
		calls.Add(1)
		entered <- struct{}{}
		select {
		case <-r.Context().Done():
			aborted <- struct{}{}
		case <-cleanup:
		}
	}))
	defer host.Close()
	defer close(cleanup)
	f := localStdio(t, host.URL+"/mcp", "")
	f.initialize(t)
	for i := 0; i < mcpConcurrency; i++ {
		f.send(t, `{"jsonrpc":"2.0","id":`+jsonNumber(i)+`,"method":"tools/call","params":{"name":"visual_nerve_request","arguments":{"path":"/diagrams","method":"POST","data":{}}}}`)
	}
	for i := 0; i < mcpConcurrency; i++ {
		select {
		case <-entered:
		case <-time.After(5 * time.Second):
			t.Fatal("eight concurrent requests did not reach the bridge")
		}
	}
	f.send(t, `{"jsonrpc":"2.0","id":"pending-ninth","method":"tools/call","params":{"name":"visual_nerve_request","arguments":{"path":"/diagrams","method":"POST","data":{}}}}`)
	_ = f.input.Close()
	select {
	case err := <-f.done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("EOF must interrupt saturated work without waiting for an HTTP timeout")
	}
	for i := 0; i < mcpConcurrency; i++ {
		select {
		case <-aborted:
		case <-time.After(time.Second):
			t.Fatal("EOF did not cancel an originating HTTP request")
		}
	}
	if calls.Load() != mcpConcurrency {
		t.Fatal("queued request must not begin after EOF and interrupted writes must not retry", calls.Load())
	}
	response, err := http.Get(host.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal("adapter EOF must leave the shared bridge running")
	}
}

func TestMCPStdioEOFCancelsBlockedStdout(t *testing.T) {
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request stdioRequest
		_ = json.NewDecoder(r.Body).Decode(&request)
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": map[string]any{}})
	}))
	defer host.Close()
	input, clientInput := io.Pipe()
	output := &stdioBlockedWriter{entered: make(chan struct{}), closed: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	defer clientInput.Close()
	done := make(chan error, 1)
	go func() { done <- RunMCPStdio(ctx, input, output, host.URL+"/mcp", "") }()
	if _, err := io.WriteString(clientInput, `{"jsonrpc":"2.0","id":"blocked-stdout","method":"ping"}`+"\n"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-output.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("the response did not reach the blocked stdout writer")
	}
	_ = clientInput.Close()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("EOF must close the owned output stream and release its blocked writer")
	}
}

type stdioBlockedWriter struct {
	entered, closed chan struct{}
	start, stop     sync.Once
}

func (writer *stdioBlockedWriter) Write(data []byte) (int, error) {
	writer.start.Do(func() { close(writer.entered) })
	<-writer.closed
	return 0, io.ErrClosedPipe
}

func (writer *stdioBlockedWriter) Close() error {
	writer.stop.Do(func() { close(writer.closed) })
	return nil
}

func TestMCPStdioRejectsSaturationWithoutUnboundedIntakeOrRetries(t *testing.T) {
	entered, aborted := make(chan struct{}, mcpConcurrency), make(chan struct{}, mcpConcurrency)
	cleanup := make(chan struct{})
	var calls atomic.Int32
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request stdioRequest
		_ = json.NewDecoder(r.Body).Decode(&request)
		calls.Add(1)
		entered <- struct{}{}
		select {
		case <-r.Context().Done():
			aborted <- struct{}{}
		case <-cleanup:
		}
	}))
	defer host.Close()
	defer close(cleanup)
	f := localStdio(t, host.URL+"/mcp", "")
	for i := 0; i < mcpConcurrency; i++ {
		f.send(t, `{"jsonrpc":"2.0","id":`+jsonNumber(i)+`,"method":"ping"}`)
	}
	for i := 0; i < mcpConcurrency; i++ {
		select {
		case <-entered:
		case <-time.After(5 * time.Second):
			t.Fatal("eight requests did not enter the local endpoint")
		}
	}
	for i := mcpConcurrency; i <= 2*mcpConcurrency; i++ {
		f.send(t, `{"jsonrpc":"2.0","id":`+jsonNumber(i)+`,"method":"ping"}`)
	}
	select {
	case err := <-f.done:
		if err == nil || !strings.Contains(err.Error(), "saturated") || !strings.Contains(err.Error(), "mutation outcomes are unknown") {
			t.Fatal("saturation must explicitly fail without a retry or ambiguous stdout", err)
		}
	case <-time.After(time.Second):
		t.Fatal("saturation must not wait for an HTTP timeout")
	}
	for i := 0; i < mcpConcurrency; i++ {
		select {
		case <-aborted:
		case <-time.After(time.Second):
			t.Fatal("saturation must cancel active requests")
		}
	}
	if calls.Load() != mcpConcurrency {
		t.Fatal("overflow must not start queued requests or retry active requests", calls.Load())
	}
}

func jsonNumber(value int) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func TestMCPStdioEOFAndCancellationAbortRequestsWithoutStoppingBridge(t *testing.T) {
	for _, eof := range []bool{false, true} {
		t.Run(map[bool]string{false: "parent cancellation", true: "stdin EOF"}[eof], func(t *testing.T) {
			entered, aborted := make(chan struct{}), make(chan struct{})
			cleanup := make(chan struct{})
			var calls atomic.Int32
			host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/health" {
					w.WriteHeader(200)
					return
				}
				var request stdioRequest
				_ = json.NewDecoder(r.Body).Decode(&request)
				if request.Method == "initialize" {
					stdioInitialized(w, request.ID)
					return
				}
				calls.Add(1)
				close(entered)
				select {
				case <-r.Context().Done():
					close(aborted)
				case <-cleanup:
				}
			}))
			defer host.Close()
			defer close(cleanup)
			f := localStdio(t, host.URL+"/mcp", "")
			f.initialize(t)
			f.send(t, `{"jsonrpc":"2.0","id":"pending-write","method":"tools/call","params":{"name":"visual_nerve_request","arguments":{"path":"/diagrams","method":"POST","data":{}}}}`)
			select {
			case <-entered:
			case <-time.After(5 * time.Second):
				t.Fatal("request did not reach shared bridge")
			}
			if eof {
				f.finish(t)
			} else {
				f.cancel()
				select {
				case err := <-f.done:
					if err != context.Canceled {
						t.Fatal(err)
					}
				case <-time.After(5 * time.Second):
					t.Fatal("context cancellation did not stop adapter")
				}
			}
			select {
			case <-aborted:
			case <-time.After(5 * time.Second):
				t.Fatal("HTTP request was not cancelled")
			}
			if calls.Load() != 1 {
				t.Fatal("interrupted writes must never be retried", calls.Load())
			}
			response, err := http.Get(host.URL + "/health")
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			if response.StatusCode != 200 {
				t.Fatal("shared bridge was stopped")
			}
		})
	}
}

func TestMCPStdioTLSKeepsNormalCertificateVerification(t *testing.T) {
	host := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": "tls", "result": map[string]any{}})
	}))
	host.Config.ErrorLog = log.New(io.Discard, "", 0)
	host.StartTLS()
	defer host.Close()
	f := localStdio(t, host.URL+"/mcp", "")
	f.send(t, `{"jsonrpc":"2.0","id":"tls","method":"ping"}`)
	if f.receive(t)["error"] == nil {
		t.Fatal("untrusted TLS must not be accepted")
	}
	f.finish(t)
	// The fixture provides a trust root, not InsecureSkipVerify. The production
	// adapter uses the ordinary system root store and offers no bypass flag.
	previous := http.DefaultTransport
	transport := previous.(*http.Transport).Clone()
	roots := x509.NewCertPool()
	roots.AddCert(host.Certificate())
	transport.TLSClientConfig = &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}
	http.DefaultTransport = transport
	defer func() { http.DefaultTransport = previous; transport.CloseIdleConnections() }()
	trusted := localStdio(t, host.URL+"/mcp", "")
	trusted.send(t, `{"jsonrpc":"2.0","id":"tls","method":"ping"}`)
	if trusted.receive(t)["error"] != nil {
		t.Fatal("a normally trusted local certificate should work")
	}
	trusted.finish(t)
}
