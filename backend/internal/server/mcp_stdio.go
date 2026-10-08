package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	DefaultMCPURL   = "http://127.0.0.1:4317/mcp"
	mcpFrameBytes   = 32 << 20
	mcpConcurrency  = 8
	mcpProxyTimeout = MaxCommandTimeout + 45*time.Second
)

// MCPStdioURL accepts only an exact local integration endpoint. Neither an
// arbitrary web fetch nor credentials in a URL are part of the adapter contract.
func MCPStdioURL(value string) (*url.URL, error) {
	u, err := url.Parse(value)
	if err != nil || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" ||
		(u.Scheme != "http" && u.Scheme != "https") || !loopback(u.Hostname()) ||
		u.Path != "/mcp" || u.RawPath != "" || u.Opaque != "" {
		return nil, errors.New("--mcp-url requires an HTTP(S) loopback URL with an explicit port and exact /mcp path; URL credentials, queries and fragments are forbidden")
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil || port < 1 || port > 65535 {
		return nil, errors.New("--mcp-url requires an explicit port between 1 and 65535")
	}
	return u, nil
}

type stdioRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
}

func stdioEnvelope(frame []byte) (stdioRequest, error) {
	var request stdioRequest
	if !utf8.Valid(frame) || !json.Valid(frame) || json.Unmarshal(frame, &request) != nil || request.JSONRPC != "2.0" || request.Method == "" ||
		(len(request.ID) != 0 && !validMCPRequestID(request.ID)) {
		return request, errors.New("stdin must contain one valid JSON-RPC MCP message per line")
	}
	if len(request.ID) == 0 && !strings.HasPrefix(request.Method, "notifications/") {
		return request, errors.New("MCP requests need a string or numeric id; notifications use notifications/ methods")
	}
	return request, nil
}

// RunMCPStdio adapts a client's private stdio to the same already-running local
// HTTP bridge. It creates no registry, database or browser access grant. There
// are no retries: an interrupted mutation has an unknown outcome.
func RunMCPStdio(parent context.Context, input io.Reader, output io.Writer, target, token string) error {
	u, err := MCPStdioURL(target)
	if err != nil {
		return err
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.ResponseHeaderTimeout = mcpProxyTimeout
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		conn, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, network, address)
		if err != nil {
			return nil, err
		}
		host, _, err := net.SplitHostPort(conn.RemoteAddr().String())
		if err != nil || !net.ParseIP(host).IsLoopback() {
			_ = conn.Close()
			return nil, errors.New("the MCP endpoint must resolve to this computer's loopback interface")
		}
		return conn, nil
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Transport: transport,
		Timeout:   mcpProxyTimeout,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	done := make(chan struct{})
	defer close(done)
	// OS pipes can block independently of the HTTP request. Cancellation closes
	// only this adapter's streams, never the shared bridge process.
	go func() {
		select {
		case <-ctx.Done():
			if stream, ok := input.(io.Closer); ok {
				_ = stream.Close()
			}
			if stream, ok := output.(io.Closer); ok {
				_ = stream.Close()
			}
		case <-done:
		}
	}()
	var workers sync.WaitGroup
	var writeMu, versionMu, errorMu sync.Mutex
	version := "2025-03-26"
	initialized := false
	var firstError error
	failed := func(err error) {
		errorMu.Lock()
		if firstError == nil {
			firstError = err
		}
		errorMu.Unlock()
		cancel()
	}
	write := func(message any) {
		writeMu.Lock()
		defer writeMu.Unlock()
		if ctx.Err() != nil {
			return
		}
		var encoded bytes.Buffer
		encoder := json.NewEncoder(&encoded)
		encoder.SetEscapeHTML(false)
		if err := encoder.Encode(message); err != nil {
			failed(errors.New("could not encode an MCP response"))
			return
		}
		if encoded.Len() > mcpFrameBytes+1 {
			failed(errors.New("MCP stdout frame exceeds the 32 MiB limit"))
			return
		}
		if _, err := io.Copy(output, &encoded); err != nil && ctx.Err() == nil {
			failed(errors.New("could not write an MCP response to stdout"))
		}
	}
	failure := func(request stdioRequest, message string) {
		if len(request.ID) == 0 {
			return
		}
		write(map[string]any{"jsonrpc": "2.0", "id": request.ID, "error": map[string]any{"code": -32000, "message": message}})
	}
	forward := func(frame []byte, request stdioRequest) {
		if ctx.Err() != nil {
			return
		}
		versionMu.Lock()
		ready := initialized
		versionMu.Unlock()
		if request.Method != "initialize" && request.Method != "ping" && !ready {
			failure(request, "Initialize a compatible Visual Nerve bridge before using its MCP tools or resources.")
			return
		}
		r, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(frame))
		if err != nil {
			failure(request, "Could not prepare the local MCP request.")
			return
		}
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Accept", "application/json, text/event-stream")
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		if request.Method != "initialize" {
			versionMu.Lock()
			r.Header.Set("MCP-Protocol-Version", version)
			versionMu.Unlock()
		}
		response, err := client.Do(r)
		if err != nil {
			failure(request, "Local MCP request failed. Check that the shared bridge is running and its TLS certificate is trusted.")
			return
		}
		defer response.Body.Close()
		if response.StatusCode == http.StatusAccepted && len(request.ID) == 0 {
			return
		}
		if response.StatusCode != http.StatusOK {
			failure(request, fmt.Sprintf("Local MCP endpoint returned HTTP %d.", response.StatusCode))
			return
		}
		data, err := io.ReadAll(io.LimitReader(response.Body, mcpFrameBytes+1))
		if err != nil || len(data) > mcpFrameBytes {
			failure(request, "Local MCP response exceeds the 32 MiB limit or could not be read.")
			return
		}
		var envelope struct {
			JSONRPC string          `json:"jsonrpc"`
			ID      json.RawMessage `json:"id"`
			Result  json.RawMessage `json:"result"`
			Error   json.RawMessage `json:"error"`
		}
		if !utf8.Valid(data) || json.Unmarshal(data, &envelope) != nil || envelope.JSONRPC != "2.0" ||
			!sameMCPRequestID(request.ID, envelope.ID) ||
			(len(envelope.Result) == 0) == (len(envelope.Error) == 0) {
			failure(request, "Local MCP endpoint returned an invalid or uncorrelated JSON-RPC response.")
			return
		}
		if request.Method == "initialize" && len(envelope.Result) != 0 {
			var initialization struct {
				ProtocolVersion string          `json:"protocolVersion"`
				Capabilities    json.RawMessage `json:"capabilities"`
				ServerInfo      struct {
					Name    string `json:"name"`
					Version string `json:"version"`
				} `json:"serverInfo"`
			}
			if json.Unmarshal(envelope.Result, &initialization) != nil || !supportedMCPProtocol(initialization.ProtocolVersion) || initialization.ServerInfo.Name != "visual-nerve" || initialization.ServerInfo.Version == "" {
				failure(request, "The local MCP endpoint is not a compatible Visual Nerve bridge.")
				return
			}
			if _, err := mcpNestedObject(initialization.Capabilities); err != nil {
				failure(request, "The local MCP endpoint returned invalid initialization capabilities.")
				return
			}
			versionMu.Lock()
			// Publish initialization only after verifying the endpoint identity.
			// This is not authentication of arbitrary local software; configured
			// bearer tokens remain the independent bridge credential.
			version = initialization.ProtocolVersion
			initialized = true
			versionMu.Unlock()
		}
		// Re-encoding keeps stdout one JSON message per line even if the HTTP
		// response was pretty-printed; content strings retain escaped newlines.
		var compact json.RawMessage = data
		write(compact)
	}
	type queuedFrame struct {
		bytes   []byte
		request stdioRequest
	}
	// The intake budget includes queued and active frames. Reserve it before
	// cloning input; eight workers plus at most eight pending requests stay
	// bounded. The scanner never waits for HTTP, so EOF cancels saturated work.
	intake := make(chan struct{}, 2*mcpConcurrency)
	frames := make(chan queuedFrame, 2*mcpConcurrency)
	var reader sync.WaitGroup
	reader.Add(1)
	go func() {
		defer reader.Done()
		defer close(frames)
		defer cancel()
		scanner := bufio.NewScanner(input)
		scanner.Buffer(make([]byte, 64<<10), mcpFrameBytes+1)
		for scanner.Scan() {
			if ctx.Err() != nil {
				return
			}
			if len(scanner.Bytes()) > mcpFrameBytes {
				failed(errors.New("MCP stdio frame exceeds the 32 MiB limit"))
				return
			}
			select {
			case intake <- struct{}{}:
			default:
				failed(errors.New("MCP stdio is saturated: at most 8 active and 8 pending requests are allowed; interrupted mutation outcomes are unknown and requests are never retried"))
				return
			}
			request, err := stdioEnvelope(scanner.Bytes())
			if err != nil {
				failed(err)
				return
			}
			frame := queuedFrame{bytes.Clone(scanner.Bytes()), request}
			select {
			case frames <- frame:
			case <-ctx.Done():
				return
			}
		}
		if err := scanner.Err(); err != nil && ctx.Err() == nil {
			failed(errors.New("could not read an MCP stdio frame within the 32 MiB limit"))
		}
	}()
	slots := make(chan struct{}, mcpConcurrency)
dispatch:
	for {
		var frame queuedFrame
		select {
		case <-ctx.Done():
			break dispatch
		case next, ok := <-frames:
			if !ok {
				break dispatch
			}
			frame = next
		}
		select {
		case slots <- struct{}{}:
		case <-ctx.Done():
			break dispatch
		}
		if ctx.Err() != nil {
			<-slots
			break
		}
		workers.Add(1)
		go func() {
			defer workers.Done()
			defer func() { <-slots }()
			defer func() { <-intake }()
			forward(frame.bytes, frame.request)
		}()
	}
	cancel()
	workers.Wait()
	reader.Wait()
	if firstError != nil {
		return firstError
	}
	return parent.Err()
}
