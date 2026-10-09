// Package server serves static assets and forwards optional commands to a browser.
// It never stores application records or opens a persistent database.
package server

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"visualnerve/internal/model"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

type Config struct {
	StaticDir, Token         string
	Dev, AllowRemote, Bridge bool
	AllowedOrigins           []string
}
type reply struct {
	ID          string          `json:"id"`
	Status      int             `json:"status"`
	Body        json.RawMessage `json:"body"`
	OperationID string          `json:"operationId,omitempty"`
}
type pendingCommand struct {
	response  chan reply
	operation *bridgeOperation
	action    string
}
type peer struct {
	conn       *websocket.Conn
	workspace  string
	mode       string
	origin     string
	instanceID string
	grantID    string
	pending    map[string]*pendingCommand
}
type Server struct {
	config         Config
	handler        http.Handler
	mu             sync.Mutex
	peers          map[*peer]bool
	operationEpoch string
	operations     map[string]*bridgeOperation
}

func New(config Config) *Server {
	s := &Server{config: config, peers: make(map[*peer]bool), operationEpoch: randomIdentifier(), operations: make(map[string]*bridgeOperation)}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/health", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		count := len(s.peers)
		s.mu.Unlock()
		send(w, 200, map[string]any{"status": "ok", "storage": "indexeddb", "version": bridgeVersion, "bridge": config.Bridge, "connected": count, "tools": bridgeToolNames, "capabilities": bridgeCapabilities})
	})
	mux.HandleFunc("GET /bridge", s.connect)
	mux.HandleFunc("/mcp", s.mcp)
	mux.HandleFunc("/api/v1/", s.forwardHTTP)
	mux.HandleFunc("GET /api/docs", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, filepath.Join(config.StaticDir, "api/docs/index.html"))
	})
	mux.HandleFunc("GET /api/openapi.yaml", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, filepath.Join(config.StaticDir, "openapi.yaml"))
	})
	mux.Handle("/", http.FileServer(http.Dir(config.StaticDir)))
	s.handler = mux
	return s
}
func send(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if status != 204 {
		_ = json.NewEncoder(w).Encode(body)
	}
}
func failure(w http.ResponseWriter, status int, message string) {
	send(w, status, map[string]string{"error": message})
}
func loopback(host string) bool { return host == "localhost" || host == "127.0.0.1" || host == "::1" }
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "same-origin")
	w.Header().Set("X-Frame-Options", "SAMEORIGIN")
	host := r.Host
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	if !s.config.AllowRemote && !loopback(host) {
		failure(w, 403, "untrusted host")
		return
	}
	integration := r.URL.Path == "/bridge" || r.URL.Path == "/mcp" || strings.HasPrefix(r.URL.Path, "/api/v1/") && r.URL.Path != "/api/v1/health"
	if integration {
		peerHost, _, peerError := net.SplitHostPort(r.RemoteAddr)
		if peerError != nil || !loopback(peerHost) {
			failure(w, 403, "local integration accepts connections from this computer only")
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			u, err := url.Parse(origin)
			allowed := err == nil && u.Host == r.Host && (u.Scheme == "http" || u.Scheme == "https")
			if !allowed && s.config.Dev && err == nil {
				allowed = u.Scheme == "http" && loopback(u.Hostname()) && u.Port() == "5173"
			}
			if !allowed && err == nil {
				for _, trusted := range s.config.AllowedOrigins {
					if origin == trusted {
						allowed = true
						break
					}
				}
			}
			if !allowed {
				failure(w, 403, "untrusted origin")
				return
			}
		}
		if s.config.Token != "" {
			value := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if r.URL.Path == "/bridge" {
				value = r.URL.Query().Get("token")
			}
			if subtle.ConstantTimeCompare([]byte(value), []byte(s.config.Token)) != 1 {
				failure(w, 401, "a valid integration token is required")
				return
			}
		}
	}
	s.handler.ServeHTTP(w, r)
}
func (s *Server) Close() {
	s.mu.Lock()
	peers := make([]*peer, 0, len(s.peers))
	for p := range s.peers {
		peers = append(peers, p)
	}
	s.mu.Unlock()
	for _, p := range peers {
		_ = p.conn.CloseNow()
	}
}

func (s *Server) connect(w http.ResponseWriter, r *http.Request) {
	if !s.config.Bridge {
		failure(w, 404, "local integration is disabled")
		return
	}
	// Origin and host were validated before the WebSocket handshake, including development origins.
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(32 << 20)
	var hello struct {
		WorkspaceID       string `json:"workspaceId"`
		PeerMode          string `json:"peerMode"`
		BrowserInstanceID string `json:"browserInstanceId"`
		AccessGrantID     string `json:"accessGrantId"`
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	err = wsjson.Read(ctx, conn, &hello)
	cancel()
	if err != nil || len(hello.WorkspaceID) != 36 || !validPeerMode(hello.PeerMode) {
		return
	}
	if (hello.BrowserInstanceID == "") != (hello.AccessGrantID == "") ||
		(hello.BrowserInstanceID != "" && (!validAuthorityID(hello.BrowserInstanceID) || !validAuthorityID(hello.AccessGrantID))) {
		return
	}
	p := &peer{conn: conn, workspace: hello.WorkspaceID, mode: hello.PeerMode, origin: r.Header.Get("Origin"), instanceID: hello.BrowserInstanceID, grantID: hello.AccessGrantID, pending: make(map[string]*pendingCommand)}
	s.mu.Lock()
	s.peers[p] = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.peers, p)
		for id, pending := range p.pending {
			if pending.response != nil {
				if pending.operation != nil {
					pending.response <- operationFailure(503, "OPERATION_OUTCOME_UNKNOWN", pending.operation.id, "The browser disconnected after dispatch. Reconcile this operation before sending another write.")
				} else if pending.action == "execute" {
					pending.response <- operationFailure(503, "OPERATION_OUTCOME_UNKNOWN", "", "The legacy browser disconnected after dispatch. The write may have committed; inspect the model before repeating it.")
				} else {
					pending.response <- reply{Status: 503, Body: json.RawMessage(`{"error":"browser disconnected"}`)}
				}
			}
			delete(p.pending, id)
		}
		s.mu.Unlock()
	}()
	if p.instanceID != "" {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		err = wsjson.Write(ctx, conn, map[string]any{"type": "bridge-info", "version": bridgeVersion, "tools": bridgeToolNames, "capabilities": bridgeCapabilities})
		cancel()
		if err != nil {
			return
		}
	}
	for {
		var response struct {
			reply
			PeerMode          string `json:"peerMode"`
			BrowserInstanceID string `json:"browserInstanceId"`
			AccessGrantID     string `json:"accessGrantId"`
		}
		if err = wsjson.Read(r.Context(), conn, &response); err != nil {
			return
		}
		s.mu.Lock()
		if response.ID == "" && response.PeerMode != "" {
			if !validPeerMode(response.PeerMode) {
				s.mu.Unlock()
				return
			}
			if response.BrowserInstanceID != "" || response.AccessGrantID != "" {
				if response.BrowserInstanceID != p.instanceID || !validAuthorityID(response.AccessGrantID) {
					s.mu.Unlock()
					return
				}
				p.grantID = response.AccessGrantID
			}
			p.mode = response.PeerMode
			s.mu.Unlock()
			continue
		}
		pending := p.pending[response.ID]
		delete(p.pending, response.ID)
		var responseChannel chan reply
		if pending != nil {
			responseChannel = pending.response
		}
		if pending != nil && pending.operation != nil && pending.action == "execute" {
			pending.operation.terminal = true
			pending.operation.completed = time.Now()
		}
		s.mu.Unlock()
		if pending != nil && responseChannel != nil {
			// Operation identity is transport metadata; never trust a browser to replace it.
			if pending.operation != nil {
				response.OperationID = pending.operation.id
			}
			responseChannel <- response.reply
		}
	}
}

// A routing hint only: browser-side leases and grants remain authoritative.
// Omitted modes preserve the existing legacy client protocol.
func validPeerMode(mode string) bool { return mode == "" || mode == "content" || mode == "control" }
func (s *Server) forward(ctx context.Context, workspace, path, method string, data json.RawMessage) (reply, error) {
	return s.forwardOperation(ctx, workspace, path, method, data, "")
}
func (s *Server) forwardOperation(ctx context.Context, workspace, path, method string, data json.RawMessage, operationID string) (reply, error) {
	if !s.config.Bridge {
		return reply{Status: 503}, errors.New("local integration is disabled")
	}
	if !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") || strings.HasPrefix(path, "/api/") || len(path) > 4096 {
		return reply{Status: 400}, errors.New("invalid browser command path")
	}
	if method != "GET" && method != "POST" && method != "PUT" && method != "PATCH" && method != "DELETE" {
		return reply{Status: 405}, errors.New("unsupported command method")
	}
	if err := validateDiagramFileCommand(path, method, data); err != nil {
		return reply{Status: 422}, err
	}
	if err := model.ValidatePresentationCommand(path, method, data); err != nil {
		return reply{Status: 422}, err
	}
	var key [16]byte
	if _, err := rand.Read(key[:]); err != nil {
		return reply{Status: 500}, err
	}
	id := hex.EncodeToString(key[:])
	s.mu.Lock()
	operation, action, operationError := s.prepareOperationLocked(workspace, path, method, data, operationID)
	if operationError != nil {
		s.mu.Unlock()
		return *operationError, nil
	}
	var selected *peer
	for p := range s.peers {
		if operation != nil && !operation.matches(p) {
			continue
		}
		if workspace != "" && p.workspace != workspace {
			continue
		}
		if selected != nil && selected.workspace != p.workspace {
			s.mu.Unlock()
			return reply{Status: 409}, errors.New("multiple workspaces are connected; provide X-Visual-Nerve-Workspace")
		}
		if selected == nil || (selected.mode == "control" && p.mode != "control") || (selected.mode != "control" && p.mode != "control" && selected.instanceID == "" && p.instanceID != "") {
			selected = p
		}
	}
	if selected == nil {
		s.mu.Unlock()
		if operation != nil {
			return operationFailure(409, "OPERATION_OUTCOME_UNKNOWN", operation.id, "The original browser and access grant are unavailable. A different tab or grant cannot retry this operation; reconcile the model manually."), nil
		}
		return reply{Status: 503}, errors.New("No active Visual Nerve browser session. Open https://app.visualnerve.com/, unlock the workspace and enable MCP access in Settings.")
	}
	if operation == nil && (action == "reserve" || operationID != "") && selected.instanceID == "" {
		s.mu.Unlock()
		return operationFailure(426, "OPERATION_PROTOCOL_REQUIRED", "", "Reload the browser to enable operation recovery before using operation IDs."), nil
	}
	if len(selected.pending) >= maxPendingCommands {
		s.mu.Unlock()
		return operationFailure(429, "BRIDGE_BUSY", operationID, "Too many browser commands are pending. Inspect the existing operation before retrying a write."), nil
	}
	operationNew := false
	if operation == nil && (action == "reserve" || method != "GET") && selected.instanceID != "" {
		operation, operationError = s.newOperationLocked(selected)
		if operationError != nil {
			s.mu.Unlock()
			return *operationError, nil
		}
		operationNew = true
	}
	if operation != nil && action == "execute" {
		if conflict := operation.bind(path, method, data); conflict != nil {
			s.mu.Unlock()
			return *conflict, nil
		}
		operation.dispatched = true
	}
	ch := make(chan reply, 1)
	pending := &pendingCommand{response: ch, operation: operation, action: action}
	selected.pending[id] = pending
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		if current := selected.pending[id]; current == pending {
			if operation != nil {
				// Keep only correlation metadata so a late acknowledgment can finish the
				// operation. Never retain its private result after the waiter has gone.
				pending.response = nil
			} else {
				delete(selected.pending, id)
			}
		}
		s.mu.Unlock()
	}()
	command := map[string]any{"id": id, "path": path, "method": method, "data": data}
	if operation != nil {
		command["operationId"] = operation.id
		command["browserInstanceId"] = operation.instanceID
		command["accessGrantId"] = operation.grantID
		command["operationAction"] = action
		command["operationNew"] = operationNew
	}
	if path == "/workspace/lock" && method == "POST" && len(data) == 0 {
		delete(command, "data")
	}
	if err := wsjson.Write(ctx, selected.conn, command); err != nil {
		if operation != nil {
			return operationFailure(503, "OPERATION_OUTCOME_UNKNOWN", operation.id, "The browser dispatch could not be acknowledged. Reconcile the operation before sending another write."), nil
		}
		return reply{Status: 503}, err
	}
	select {
	case response := <-ch:
		if response.Status < 200 || response.Status > 599 {
			if operation != nil {
				return operationFailure(502, "OPERATION_OUTCOME_UNKNOWN", operation.id, "The browser returned an invalid acknowledgment. Reconcile this operation before sending another write."), nil
			}
			if method != "GET" {
				return operationFailure(502, "OPERATION_OUTCOME_UNKNOWN", "", "The legacy browser returned an invalid acknowledgment. The write may have committed; inspect the model before repeating it."), nil
			}
			return reply{Status: 502}, errors.New("invalid browser response")
		}
		return response, nil
	case <-ctx.Done():
		if operation != nil {
			return operationFailure(504, "OPERATION_OUTCOME_UNKNOWN", operation.id, "The browser did not acknowledge before the transport deadline. This operation may still commit; query its status or retry only with the same operation ID and exact payload."), nil
		}
		if method != "GET" {
			return operationFailure(504, "OPERATION_OUTCOME_UNKNOWN", "", "The legacy browser did not acknowledge before the deadline. The write may still commit; inspect the model before repeating it."), nil
		}
		return reply{Status: 504}, ctx.Err()
	}
}
func readJSON(w http.ResponseWriter, r *http.Request) (json.RawMessage, error) {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		return nil, errors.New("Content-Type must be application/json")
	}
	bytes, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 32<<20))
	if err != nil {
		return nil, err
	}
	if !json.Valid(bytes) {
		return nil, errors.New("invalid JSON")
	}
	return bytes, nil
}

func readLockJSON(w http.ResponseWriter, r *http.Request) (json.RawMessage, error) {
	bytes, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 32<<20))
	if err != nil || len(bytes) == 0 {
		return nil, err
	}
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		return nil, errors.New("Content-Type must be application/json")
	}
	if !json.Valid(bytes) {
		return nil, errors.New("invalid JSON")
	}
	return bytes, nil
}

// MaxCommandTimeout bounds project ZIP scan, code analysis and the guarded save.
const MaxCommandTimeout = 165 * time.Second

func commandTimeout(path string) time.Duration {
	// Browser analysis is cancellable after 30 seconds. Leave time for layout,
	// validation and the final IndexedDB transaction before the transport expires.
	path = strings.TrimPrefix(path, "/api/v1")
	// ZIP scan has its own 120-second deadline, followed by 30-second code analysis.
	if path == "/code/project/preview" || path == "/code/project/diagrams" {
		return MaxCommandTimeout
	}
	if path == "/sql/preview" || path == "/sql/diagrams" || path == "/code/preview" || path == "/code/diagrams" || path == "/diagram-files/preview" || path == "/import" || strings.Contains(path, "/history") || strings.Contains(path, "/evidence?") {
		return 45 * time.Second
	}
	return 25 * time.Second
}
func (s *Server) forwardHTTP(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/v1")
	operationHeaders := r.Header.Values("X-Visual-Nerve-Operation-Id")
	if len(operationHeaders) > 1 || (len(operationHeaders) == 1 && operationHeaders[0] == "") {
		response := operationFailure(422, "INVALID_OPERATION_ID", "", "Supply exactly one nonempty operation ID header, or omit it for a new command.")
		send(w, response.Status, response.Body)
		return
	}
	var data json.RawMessage
	// Existing DELETE commands are bodyless; video cancellation has an exact {} contract.
	if r.Method != "GET" && (r.Method != "DELETE" || path == "/presentation/video") {
		var err error
		if path == "/workspace/lock" && r.Method == "POST" {
			data, err = readLockJSON(w, r)
		} else {
			data, err = readJSON(w, r)
		}
		if err != nil {
			failure(w, 400, err.Error())
			return
		}
	}
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	ctx, cancel := context.WithTimeout(r.Context(), commandTimeout(path))
	defer cancel()
	response, err := s.forwardOperation(ctx, r.Header.Get("X-Visual-Nerve-Workspace"), path, r.Method, data, r.Header.Get("X-Visual-Nerve-Operation-Id"))
	if response.OperationID != "" {
		w.Header().Set("X-Visual-Nerve-Operation-Id", response.OperationID)
	}
	if err != nil {
		failure(w, response.Status, err.Error())
		return
	}
	send(w, response.Status, response.Body)
}
