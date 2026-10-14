package main

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"visualnerve/internal/server"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func TestCompatibilityListenerRequiresImplicitBridgeDefault(t *testing.T) {
	for _, test := range []struct {
		bridge, explicit bool
		address, legacy  string
	}{
		{true, false, server.DefaultBridgeAddress, "127.0.0.1:4317"},
		{true, true, server.DefaultBridgeAddress, ""},
		{true, true, "127.0.0.1:4317", ""},
		{true, true, "localhost:9443", ""},
		{true, false, "127.0.0.1:9000", ""},
		{false, false, server.DefaultBridgeAddress, ""},
	} {
		plan := planHTTPListeners(test.bridge, test.address, test.explicit)
		if plan.primary != test.address || plan.compatibility != test.legacy {
			t.Fatalf("unexpected listener plan for %+v: %+v", test, plan)
		}
	}
}

func serveListenerFixture(t *testing.T, group *httpListenerGroup) context.CancelFunc {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- group.serve(ctx) }()
	t.Cleanup(func() {
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Error(err)
			}
		case <-time.After(6 * time.Second):
			t.Error("listener group did not shut down")
		}
	})
	return cancel
}

func listenerURLs(group *httpListenerGroup) []string {
	urls := make([]string, len(group.endpoints))
	for i, endpoint := range group.endpoints {
		urls[i] = group.scheme + "://" + endpoint.listener.Addr().String()
	}
	return urls
}

func TestBothListenersShareBrowserAndOperationAuthority(t *testing.T) {
	const token = "listener-test-token"
	const origin = "https://preview.example.test"
	handler := server.New(server.Config{Bridge: true, Token: token, AllowedOrigins: []string{origin}})
	group, err := bindHTTPListeners(httpListenerPlan{"127.0.0.1:0", "127.0.0.1:0"}, handler, "", "", t.Logf)
	if err != nil {
		t.Fatal(err)
	}
	serveListenerFixture(t, group)
	urls := listenerURLs(group)
	if len(urls) != 2 {
		t.Fatal("compatibility test requires both listeners")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, strings.Replace(urls[1], "http:", "ws:", 1)+"/bridge?token="+token, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{origin}}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	const browser = "11111111-1111-4111-8111-111111111111"
	const grant = "22222222-2222-4222-8222-222222222222"
	if err := wsjson.Write(ctx, conn, map[string]string{"workspaceId": "00000000-0000-4000-8000-000000000001", "peerMode": "content", "browserInstanceId": browser, "accessGrantId": grant}); err != nil {
		t.Fatal(err)
	}
	var info map[string]any
	if err := wsjson.Read(ctx, conn, &info); err != nil || info["type"] != "bridge-info" {
		t.Fatal("browser did not attach to legacy listener", err)
	}
	client := &http.Client{Timeout: 5 * time.Second}
	for _, url := range urls {
		response, err := client.Get(url + "/api/v1/health")
		if err != nil {
			t.Fatal(err)
		}
		var health struct{ Connected int }
		err = json.NewDecoder(response.Body).Decode(&health)
		response.Body.Close()
		if err != nil || response.StatusCode != 200 || health.Connected != 1 {
			t.Fatal("listeners must report the same browser", err, response.StatusCode, health)
		}
		for _, denied := range []struct {
			token, origin string
			status        int
		}{{"", origin, 401}, {token, "https://untrusted.example.test", 403}} {
			request, _ := http.NewRequest("GET", url+"/api/v1/diagrams", nil)
			request.Header.Set("Authorization", "Bearer "+denied.token)
			request.Header.Set("Origin", denied.origin)
			response, err := client.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			if response.StatusCode != denied.status {
				t.Fatal("compatibility listener changed authorization", response.StatusCode)
			}
		}
	}
	type result struct {
		status          int
		body, operation string
		err             error
	}
	request := func(base, method, path, body, operation string) <-chan result {
		completed := make(chan result, 1)
		go func() {
			req, err := http.NewRequestWithContext(ctx, method, base+"/api/v1"+path, strings.NewReader(body))
			if err != nil {
				completed <- result{err: err}
				return
			}
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("Content-Type", "application/json")
			if operation != "" {
				req.Header.Set("X-Visual-Nerve-Operation-Id", operation)
			}
			response, err := client.Do(req)
			if err != nil {
				completed <- result{err: err}
				return
			}
			defer response.Body.Close()
			data, err := io.ReadAll(response.Body)
			completed <- result{response.StatusCode, string(data), response.Header.Get("X-Visual-Nerve-Operation-Id"), err}
		}()
		return completed
	}
	read := func() map[string]any {
		var command map[string]any
		if err := wsjson.Read(ctx, conn, &command); err != nil {
			t.Fatal(err)
		}
		if command["browserInstanceId"] != browser || command["accessGrantId"] != grant {
			t.Fatal("lost original browser/grant authority", command)
		}
		return command
	}
	reply := func(command map[string]any, status int, body any) {
		if err := wsjson.Write(ctx, conn, map[string]any{"id": command["id"], "status": status, "body": body}); err != nil {
			t.Fatal(err)
		}
	}
	reservation := request(urls[0], "POST", "/operations", "{}", "")
	reserve := read()
	operation, _ := reserve["operationId"].(string)
	if operation == "" || reserve["operationAction"] != "reserve" {
		t.Fatal("operation was not reserved", reserve)
	}
	reply(reserve, 201, map[string]any{"operationId": operation, "state": "reserved", "resultAvailable": false})
	if got := <-reservation; got.err != nil || got.status != 201 || got.operation != operation {
		t.Fatal("reservation failed", got)
	}
	write := request(urls[1], "POST", "/diagrams", `{"name":"cross-port test"}`, operation)
	execute := read()
	if execute["operationId"] != operation || execute["operationAction"] != "execute" || execute["operationNew"] == true {
		t.Fatal("legacy port lost the primary reservation", execute)
	}
	reply(execute, 201, map[string]string{"id": "test-diagram"})
	if got := <-write; got.err != nil || got.status != 201 || !strings.Contains(got.body, "test-diagram") {
		t.Fatal("cross-port write failed", got)
	}
	inspect := request(urls[0], "GET", "/operations/"+operation, "", "")
	status := read()
	if status["operationId"] != operation || status["operationAction"] != "status" {
		t.Fatal("primary port lost legacy execution", status)
	}
	reply(status, 200, map[string]any{"operationId": operation, "state": "succeeded", "resultAvailable": true})
	if got := <-inspect; got.err != nil || got.status != 200 || !strings.Contains(got.body, "succeeded") {
		t.Fatal("cross-port status failed", got)
	}
}

func TestBusyCompatibilityPortIsUntouchedAndPrimaryStillWorks(t *testing.T) {
	var contacted atomic.Int32
	occupied := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { contacted.Add(1); w.WriteHeader(202) }))
	defer occupied.Close()
	var logs bytes.Buffer
	handler := server.New(server.Config{Bridge: true})
	group, err := bindHTTPListeners(httpListenerPlan{"127.0.0.1:0", occupied.Listener.Addr().String()}, handler, "", "", func(format string, args ...any) { fmt.Fprintf(&logs, format, args...) })
	if err != nil {
		t.Fatal(err)
	}
	serveListenerFixture(t, group)
	if len(group.endpoints) != 1 || contacted.Load() != 0 || !strings.Contains(logs.String(), "not contacted or stopped") {
		t.Fatal("busy compatibility port was not safely skipped", logs.String())
	}
	client := &http.Client{Timeout: 5 * time.Second}
	for _, test := range []struct {
		url    string
		status int
	}{{listenerURLs(group)[0] + "/api/v1/health", 200}, {occupied.URL, 202}} {
		response, err := client.Get(test.url)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != test.status {
			t.Fatal("one of the independent services was interrupted", response.StatusCode)
		}
	}
	if contacted.Load() != 1 {
		t.Fatal("the existing service received unexpected requests")
	}
}

func TestBusyPrimaryDoesNotBindCompatibility(t *testing.T) {
	primary, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer primary.Close()
	legacy, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	legacyAddress := legacy.Addr().String()
	legacy.Close()
	handler := server.New(server.Config{Bridge: true})
	defer handler.Close()
	if _, err := bindHTTPListeners(httpListenerPlan{primary.Addr().String(), legacyAddress}, handler, "", "", t.Logf); err == nil {
		t.Fatal("occupied primary must fail")
	}
	available, err := net.Listen("tcp", legacyAddress)
	if err != nil {
		t.Fatal("failed primary unexpectedly occupied compatibility port", err)
	}
	available.Close()
}

func TestCancellationClosesBothListeners(t *testing.T) {
	handler := server.New(server.Config{Bridge: true})
	group, err := bindHTTPListeners(httpListenerPlan{"127.0.0.1:0", "127.0.0.1:0"}, handler, "", "", t.Logf)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- group.serve(ctx) }()
	client := &http.Client{Timeout: 5 * time.Second}
	for _, url := range listenerURLs(group) {
		response, err := client.Get(url + "/api/v1/health")
		if err != nil {
			cancel()
			t.Fatal(err)
		}
		response.Body.Close()
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(6 * time.Second):
		t.Fatal("shutdown did not complete")
	}
	for _, endpoint := range group.endpoints {
		available, err := net.Listen("tcp", endpoint.listener.Addr().String())
		if err != nil {
			t.Fatal("shutdown leaked a listener", err)
		}
		available.Close()
	}
}

func TestBothListenersUseTheSameTrustedTLSCertificate(t *testing.T) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	certificate := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "local listener test"}, NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour), IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, certificate, certificate, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	certPath, keyPath := filepath.Join(directory, "cert.pem"), filepath.Join(directory, "key.pem")
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	if err := os.WriteFile(certPath, certPEM, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}), 0600); err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(certPEM)
	client := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}}}
	defer client.CloseIdleConnections()
	handler := server.New(server.Config{Bridge: true})
	group, err := bindHTTPListeners(httpListenerPlan{"127.0.0.1:0", "127.0.0.1:0"}, handler, certPath, keyPath, t.Logf)
	if err != nil {
		t.Fatal(err)
	}
	serveListenerFixture(t, group)
	for _, url := range listenerURLs(group) {
		response, err := client.Get(url + "/api/v1/health")
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 200 || response.TLS == nil || !bytes.Equal(response.TLS.PeerCertificates[0].Raw, der) {
			t.Fatal("listeners did not share the configured TLS identity")
		}
	}
}
