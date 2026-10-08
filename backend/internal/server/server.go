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
	ID     string          `json:"id"`
	Status int             `json:"status"`
	Body   json.RawMessage `json:"body"`
}
type peer struct {
	conn      *websocket.Conn
	workspace string
	mode      string
	pending   map[string]chan reply
}
type Server struct {
	config  Config
	handler http.Handler
	mu      sync.Mutex
	peers   map[*peer]bool
}

func New(config Config) *Server {
	s := &Server{config: config, peers: make(map[*peer]bool)}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/health", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		count := len(s.peers)
		s.mu.Unlock()
		send(w, 200, map[string]any{"status": "ok", "storage": "indexeddb", "version": "0.3.0", "bridge": config.Bridge, "connected": count})
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
		WorkspaceID string `json:"workspaceId"`
		PeerMode    string `json:"peerMode"`
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	err = wsjson.Read(ctx, conn, &hello)
	cancel()
	if err != nil || len(hello.WorkspaceID) != 36 || !validPeerMode(hello.PeerMode) {
		return
	}
	p := &peer{conn: conn, workspace: hello.WorkspaceID, mode: hello.PeerMode, pending: make(map[string]chan reply)}
	s.mu.Lock()
	s.peers[p] = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.peers, p)
		for id, ch := range p.pending {
			ch <- reply{Status: 503, Body: json.RawMessage(`{"error":"browser disconnected"}`)}
			delete(p.pending, id)
		}
		s.mu.Unlock()
	}()
	for {
		var response struct {
			reply
			PeerMode string `json:"peerMode"`
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
			p.mode = response.PeerMode
			s.mu.Unlock()
			continue
		}
		ch := p.pending[response.ID]
		delete(p.pending, response.ID)
		s.mu.Unlock()
		if ch != nil {
			ch <- response.reply
		}
	}
}

// A routing hint only: browser-side leases and grants remain authoritative.
// Omitted modes preserve the existing legacy client protocol.
func validPeerMode(mode string) bool { return mode == "" || mode == "content" || mode == "control" }
func (s *Server) forward(ctx context.Context, workspace, path, method string, data json.RawMessage) (reply, error) {
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
	var selected *peer
	for p := range s.peers {
		if workspace != "" && p.workspace != workspace {
			continue
		}
		if selected != nil && selected.workspace != p.workspace {
			s.mu.Unlock()
			return reply{Status: 409}, errors.New("multiple workspaces are connected; provide X-Visual-Nerve-Workspace")
		}
		if selected == nil || (selected.mode == "control" && p.mode != "control") {
			selected = p
		}
	}
	if selected == nil {
		s.mu.Unlock()
		return reply{Status: 503}, errors.New("No active Visual Nerve browser session. Open the workspace at /app/ and enable MCP access in Settings.")
	}
	ch := make(chan reply, 1)
	selected.pending[id] = ch
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(selected.pending, id); s.mu.Unlock() }()
	command := map[string]any{"id": id, "path": path, "method": method, "data": data}
	if path == "/workspace/lock" && method == "POST" && len(data) == 0 {
		delete(command, "data")
	}
	if err := wsjson.Write(ctx, selected.conn, command); err != nil {
		return reply{Status: 503}, err
	}
	select {
	case response := <-ch:
		if response.Status < 200 || response.Status > 599 {
			return reply{Status: 502}, errors.New("invalid browser response")
		}
		return response, nil
	case <-ctx.Done():
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
	response, err := s.forward(ctx, r.Header.Get("X-Visual-Nerve-Workspace"), path, r.Method, data)
	if err != nil {
		failure(w, response.Status, err.Error())
		return
	}
	send(w, response.Status, response.Body)
}
