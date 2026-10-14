package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
)

type zipEntry struct {
	name, body string
	mode       os.FileMode
}

func sourceZIP(t *testing.T, entries ...zipEntry) []byte {
	t.Helper()
	var raw bytes.Buffer
	archive := zip.NewWriter(&raw)
	for _, entry := range entries {
		header := &zip.FileHeader{Name: entry.name, Method: zip.Deflate}
		mode := entry.mode
		if mode == 0 {
			mode = 0600
		}
		header.SetMode(mode)
		f, err := archive.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = f.Write([]byte(entry.body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	return raw.Bytes()
}
func checksum(raw []byte) string { sum := sha256.Sum256(raw); return hex.EncodeToString(sum[:]) }
func installerOptions(t *testing.T) options {
	t.Helper()
	dir := t.TempDir()
	canonical, err := filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatal(err)
	}
	canonical = filepath.Join(canonical, "managed bridge")
	if err = os.Mkdir(canonical, 0700); err != nil {
		t.Fatal(err)
	}
	return options{InstallDir: canonical, Go: filepath.Join(canonical, "toolchains/go/bin/go"), SourceURL: "https://example.invalid/bridge.zip", SourceSHA: strings.Repeat("a", 64), Version: "0.11.1", Revision: strings.Repeat("b", 40), Origin: "https://app.visualnerve.com", Address: "127.0.0.1:47417"}
}
func TestInstallerValidatesOriginsAddressesAndOfflineActions(t *testing.T) {
	for _, origin := range []string{"https://app.visualnerve.com", "https://preview.example:8443", "http://127.0.0.1:4342", "http://localhost:5173", "http://[::1]:4342"} {
		if err := validateOrigin(origin); err != nil {
			t.Errorf("valid origin %s: %v", origin, err)
		}
	}
	for _, origin := range []string{"https://app.visualnerve.com/", "https://app.visualnerve.com/app/", "https://user:secret@app.visualnerve.com", "http://untrusted.example", "https://app.visualnerve.com?q=x", "https://app.visualnerve.com#x", "null"} {
		if err := validateOrigin(origin); err == nil {
			t.Errorf("accepted unsafe origin %s", origin)
		}
	}
	for _, address := range []string{"127.0.0.1:4317", "127.0.0.1:47417", "localhost:9443", "[::1]:47417"} {
		if err := validateAddress(address); err != nil {
			t.Error(err)
		}
	}
	for _, address := range []string{"0.0.0.0:47417", ":47417", "127.0.0.1:0", "127.0.0.1:-1", "localhost:http", "localhost:65536", "192.168.1.2:47417", "127.0.0.2:47417"} {
		if err := validateAddress(address); err == nil {
			t.Errorf("accepted unsafe listener %s", address)
		}
	}
	for _, source := range []string{"http://example.test/a.zip", "https://user:token@example.test/a.zip", "https://example.test/a.zip?token=x", "file:///tmp/a.zip"} {
		if err := validateSourceURL(source); err == nil {
			t.Error("accepted unsafe source", source)
		}
	}
	o := installerOptions(t)
	o.Status = true
	o.Go = ""
	o.SourceURL = ""
	o.SourceSHA = ""
	o.Version = ""
	o.Revision = ""
	if err := validateOptions(&o); err != nil {
		t.Fatal("offline status requires no build prerequisites", err)
	}
	o.Stop = true
	if err := validateOptions(&o); err == nil {
		t.Fatal("accepted conflicting actions")
	}
}
func TestSourceChecksumAndDownloadBound(t *testing.T) {
	raw := sourceZIP(t, zipEntry{name: "visual-nerve-bridge/backend/go.mod", body: "module example"})
	service := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(raw) }))
	defer service.Close()
	got, err := downloadSource(service.Client(), service.URL, checksum(raw))
	if err != nil || !bytes.Equal(got, raw) {
		t.Fatal("verified HTTPS source failed", err)
	}
	if _, err = downloadSource(service.Client(), service.URL, strings.Repeat("0", 64)); err == nil || !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatal("bad digest accepted", err)
	}
	large := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", fmt.Sprint(maxSourceBytes+1))
		w.WriteHeader(200)
	}))
	defer large.Close()
	if _, err = downloadSource(large.Client(), large.URL, checksum(raw)); err == nil || !strings.Contains(err.Error(), "16 MiB") {
		t.Fatal("oversized archive accepted", err)
	}
	if err = sourceClient().CheckRedirect(&http.Request{URL: mustURL(t, "http://untrusted.test/a.zip")}, nil); err == nil {
		t.Fatal("HTTPS source redirect downgrade accepted")
	}
}
func TestExtractionRejectsPathsLinksDuplicatesAndLimitsBeforeWriting(t *testing.T) {
	cases := [][]zipEntry{
		{{name: "../outside", body: "bad"}}, {{name: "visual-nerve-bridge/../../outside", body: "bad"}}, {{name: "visual-nerve-bridge/backend\\evil", body: "bad"}}, {{name: "other/backend/go.mod", body: "bad"}},
		{{name: "visual-nerve-bridge/link", body: "../../outside", mode: os.ModeSymlink | 0777}},
		{{name: "visual-nerve-bridge/a", body: "one"}, {name: "visual-nerve-bridge/a", body: "two"}},
		{{name: "visual-nerve-bridge/A", body: "one"}, {name: "visual-nerve-bridge/a", body: "two"}},
		{{name: "visual-nerve-bridge/a.", body: "bad"}}, {{name: "visual-nerve-bridge/a /b", body: "bad"}},
	}
	for i, entries := range cases {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			dest := t.TempDir()
			if err := extractSource(sourceZIP(t, entries...), dest); err == nil {
				t.Fatal("unsafe source accepted")
			}
			files, _ := os.ReadDir(dest)
			if len(files) != 0 {
				t.Fatal("preflight rejection wrote partial files")
			}
		})
	}
	many := make([]zipEntry, maxSourceFiles+1)
	for i := range many {
		many[i] = zipEntry{name: fmt.Sprintf("visual-nerve-bridge/%d", i)}
	}
	if err := extractSource(sourceZIP(t, many...), t.TempDir()); err == nil {
		t.Fatal("file count limit not enforced")
	}
	oversized := sourceZIP(t, zipEntry{name: "visual-nerve-bridge/a", body: "small"})
	central := bytes.Index(oversized, []byte("PK\x01\x02"))
	if central < 0 {
		t.Fatal("missing ZIP central directory")
	}
	binary.LittleEndian.PutUint32(oversized[central+24:central+28], maxExtractedBytes+1)
	if err := extractSource(oversized, t.TempDir()); err == nil || !strings.Contains(err.Error(), "expanded limit") {
		t.Fatal("expanded ZIP limit not enforced", err)
	}
	raw := sourceZIP(t, zipEntry{name: "visual-nerve-bridge/", mode: os.ModeDir | 0700}, zipEntry{name: "visual-nerve-bridge/backend/go.mod", body: "module example"})
	dest := t.TempDir()
	if err := extractSource(raw, dest); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(dest, "visual-nerve-bridge/backend/go.mod"))
	if err != nil || string(got) != "module example" {
		t.Fatal("valid source changed", err)
	}
	info, _ := os.Stat(filepath.Join(dest, "visual-nerve-bridge/backend/go.mod"))
	if info.Mode().Perm() != 0600 {
		t.Fatal("extracted file permissions", info.Mode())
	}
}
func TestHealthChecksIdentityVersionToolsAndNeverUsesProxy(t *testing.T) {
	good := map[string]any{"status": "ok", "storage": "indexeddb", "bridge": true, "version": "0.11.1", "tools": []string{"visual_nerve_request", "visual_nerve_api_docs"}, "capabilities": []string{"operations-v1", "endpoint-docs-v1"}}
	tests := []struct {
		name        string
		status      int
		contentType string
		mutate      func(map[string]any)
	}{
		{"valid", 200, "application/json; charset=utf-8", func(map[string]any) {}},
		{"wrong version", 200, "application/json", func(h map[string]any) { h["version"] = "0.11.0" }},
		{"wrong service", 200, "application/json", func(h map[string]any) { h["storage"] = "other" }},
		{"old tools", 200, "application/json", func(h map[string]any) { h["tools"] = []string{"visual_nerve_request"} }},
		{"old capabilities", 200, "application/json", func(h map[string]any) { h["capabilities"] = []string{"operations-v1"} }},
		{"html", 200, "text/html", func(map[string]any) {}}, {"failure", 503, "application/json", func(map[string]any) {}},
	}
	t.Setenv("HTTP_PROXY", "http://untrusted.invalid:99")
	t.Setenv("HTTPS_PROXY", "http://untrusted.invalid:99")
	t.Setenv("ALL_PROXY", "http://untrusted.invalid:99")
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			h := map[string]any{}
			for k, v := range good {
				h[k] = v
			}
			tc.mutate(h)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "" || r.URL.RawQuery != "" {
					t.Error("health supplied credentials")
				}
				w.Header().Set("Content-Type", tc.contentType)
				w.WriteHeader(tc.status)
				json.NewEncoder(w).Encode(h)
			}))
			defer server.Close()
			err := verifyHealth(loopbackClient(), strings.TrimPrefix(server.URL, "http://"), "0.11.1")
			if (err == nil) != (tc.name == "valid") {
				t.Fatalf("unexpected health result: %v", err)
			}
		})
	}
	if loopbackClient().Transport.(*http.Transport).Proxy != nil {
		t.Fatal("loopback health has ambient proxy policy")
	}
}
func TestBuildAndRuntimeEnvironmentsExcludeAmbientOverrides(t *testing.T) {
	for _, key := range []string{"VISUAL_NERVE_ADDR", "VISUAL_NERVE_BRIDGE_TOKEN", "VISUAL_NERVE_ALLOWED_ORIGINS", "VISUAL_NERVE_TLS_KEY", "GOFLAGS", "GOOS", "GOARCH", "GOTOOLCHAIN", "GOPROXY", "GOINSECURE", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES"} {
		t.Setenv(key, "ambient-secret")
	}
	o := installerOptions(t)
	for _, env := range [][]string{buildEnvironment(o), runtimeEnvironment()} {
		for _, entry := range env {
			if strings.Contains(entry, "ambient-secret") || strings.HasPrefix(entry, "VISUAL_NERVE_") {
				t.Fatal("ambient configuration leaked", entry)
			}
		}
	}
	joined := strings.Join(buildEnvironment(o), "\n")
	for _, required := range []string{"CGO_ENABLED=0", "GOTOOLCHAIN=local", "GOENV=off", "GOWORK=off", "GOSUMDB=sum.golang.org", "GOPROXY=https://proxy.golang.org"} {
		if !strings.Contains(joined, required) {
			t.Fatal("missing safe build environment", required)
		}
	}
}

var fixtureOnce sync.Once
var fixturePath string
var fixtureError error

func nativeFixture(t *testing.T) string {
	t.Helper()
	fixtureOnce.Do(func() {
		dir, err := os.MkdirTemp("", "vn-installer-fixture-")
		if err != nil {
			fixtureError = err
			return
		}
		fixturePath = filepath.Join(dir, "fixture")
		code := `package main
import("encoding/json";"flag";"net/http";"os";"strings")
func main(){addr:=flag.String("addr","","");flag.Bool("bridge",false,"");flag.String("static","","");flag.String("allowed-origin","","");flag.Parse();for _,v:=range os.Environ(){if strings.HasPrefix(v,"VISUAL_NERVE_"){os.Exit(23)}};http.HandleFunc("/api/v1/health",func(w http.ResponseWriter,r *http.Request){w.Header().Set("Content-Type","application/json");json.NewEncoder(w).Encode(map[string]any{"status":"ok","storage":"indexeddb","bridge":true,"version":"0.11.1","tools":[]string{"visual_nerve_request","visual_nerve_api_docs"},"capabilities":[]string{"operations-v1","endpoint-docs-v1"}})});if http.ListenAndServe(*addr,nil)!=nil{os.Exit(24)}}`
		source := filepath.Join(dir, "fixture.go")
		if err = os.WriteFile(source, []byte(code), 0600); err != nil {
			fixtureError = err
			return
		}
		cmd := exec.Command(filepath.Join(runtime.GOROOT(), "bin", "go"), "build", "-o", fixturePath, source)
		cmd.Env = append(os.Environ(), "GOENV=off", "GOTOOLCHAIN=local", "CGO_ENABLED=0", "GOFLAGS=")
		if output, err := cmd.CombinedOutput(); err != nil {
			fixtureError = fmt.Errorf("fixture build: %w: %s", err, output)
		}
	})
	if fixtureError != nil {
		t.Fatal(fixtureError)
	}
	return fixturePath
}
func TestMain(m *testing.M) {
	code := m.Run()
	if fixturePath != "" {
		os.RemoveAll(filepath.Dir(fixturePath))
	}
	os.Exit(code)
}
func installFixtureRelease(t *testing.T, o options) string {
	t.Helper()
	release := filepath.Join(o.InstallDir, "releases", o.SourceSHA)
	if err := os.MkdirAll(filepath.Join(release, "bridge-docs"), 0700); err != nil {
		t.Fatal(err)
	}
	input, err := os.Open(nativeFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	output, err := os.OpenFile(filepath.Join(release, "visual-nerve"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0700)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = io.Copy(output, input); err != nil {
		t.Fatal(err)
	}
	output.Close()
	if err = os.WriteFile(filepath.Join(release, "bridge-docs/openapi.yaml"), []byte(`{"openapi":"3.0.3"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err = atomicJSON(filepath.Join(release, "release.json"), releaseInfo{o.SourceSHA, o.Version, o.Revision}); err != nil {
		t.Fatal(err)
	}
	return release
}
func freeAddress(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := l.Addr().String()
	l.Close()
	return address
}
func TestManagedLifecycleReusesHealthyPIDAndStopsOnlyExactProcess(t *testing.T) {
	o := installerOptions(t)
	o.Address = freeAddress(t)
	installFixtureRelease(t, o)
	t.Setenv("VISUAL_NERVE_BRIDGE_TOKEN", "must-not-be-inherited")
	if err := run(o); err != nil {
		t.Fatal(err)
	}
	state, err := loadState(o.InstallDir)
	if err != nil || state == nil {
		t.Fatal("missing managed state", err)
	}
	t.Cleanup(func() { stopManaged(state) })
	if err = verifyManaged(state); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(filepath.Join(o.InstallDir, "state.json"))
	if info.Mode().Perm() != 0600 {
		t.Fatal("state must be private")
	}
	if err = run(o); err != nil {
		t.Fatal(err)
	}
	again, _ := loadState(o.InstallDir)
	if again.PID != state.PID {
		t.Fatal("idempotent setup restarted healthy process")
	}
	newRevision := o
	newRevision.Revision = strings.Repeat("c", 40)
	if _, err = ensureRelease(newRevision, sourceClient()); err != nil {
		t.Fatal("identical source with newer website revision should reuse cached release", err)
	}
	if err = run(newRevision); err != nil {
		t.Fatal("identical source with newer website revision should reuse managed process", err)
	}
	again, _ = loadState(o.InstallDir)
	if again.PID != state.PID || again.Revision != o.Revision {
		t.Fatal("same source changed PID or original build provenance")
	}
	forged := *state
	forged.ProcessStart += "-different"
	if err = stopManaged(&forged); err == nil {
		t.Fatal("stopped PID with wrong start identity")
	}
	if err = verifyHealth(loopbackClient(), o.Address, o.Version); err != nil {
		t.Fatal("identity mismatch touched active listener", err)
	}
	other := o
	other.SourceSHA = strings.Repeat("d", 64)
	otherRelease := installFixtureRelease(t, other)
	forged = *state
	forged.ReleaseDirectory = otherRelease
	forged.Executable = filepath.Join(otherRelease, "visual-nerve")
	if err = stopManaged(&forged); err == nil {
		t.Fatal("stopped a PID using a different executable")
	}
	if err = verifyHealth(loopbackClient(), o.Address, o.Version); err != nil {
		t.Fatal("executable mismatch touched active listener", err)
	}
	status := options{InstallDir: o.InstallDir, Status: true}
	if err = run(status); err != nil {
		t.Fatal("offline status", err)
	}
	if err = run(options{InstallDir: o.InstallDir, Stop: true}); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(o.InstallDir, "state.json")); !os.IsNotExist(err) {
		t.Fatal("stopped process state remained", err)
	}
	if err = requireFreeAddress(o.Address); err != nil {
		t.Fatal("stop did not release listener", err)
	}
}
func TestOccupiedUnmanagedPortIsUntouchedBeforeDownloadOrBuild(t *testing.T) {
	o := installerOptions(t)
	requests := 0
	foreign := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests++; w.WriteHeader(202) }))
	defer foreign.Close()
	o.Address = strings.TrimPrefix(foreign.URL, "http://")
	if err := run(o); err == nil || !strings.Contains(err.Error(), "occupied") {
		t.Fatal("foreign listener accepted", err)
	}
	if requests != 0 {
		t.Fatal("installer probed an unowned listener")
	}
	if _, err := os.Stat(filepath.Join(o.InstallDir, "releases")); !os.IsNotExist(err) {
		t.Fatal("occupied port started an installation")
	}
	response, err := http.Get(foreign.URL)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 202 {
		t.Fatal("foreign service changed")
	}
}
func TestFailedBuildPreservesTheExistingReleaseAndRunningBridge(t *testing.T) {
	o := installerOptions(t)
	o.Address = freeAddress(t)
	oldRelease := installFixtureRelease(t, o)
	if err := run(o); err != nil {
		t.Fatal(err)
	}
	old, _ := loadState(o.InstallDir)
	t.Cleanup(func() { stopManaged(old) })
	raw := sourceZIP(t, zipEntry{name: "visual-nerve-bridge/backend/go.mod", body: "module broken"})
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(raw) }))
	defer server.Close()
	broken := o
	broken.SourceURL = server.URL
	broken.SourceSHA = checksum(raw)
	broken.Go = filepath.Join(t.TempDir(), "go")
	if err := os.WriteFile(broken.Go, []byte("#!/bin/sh\nexit 1\n"), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := ensureRelease(broken, server.Client()); err == nil {
		t.Fatal("failed build installed a release")
	}
	state, _ := loadState(o.InstallDir)
	if state.PID != old.PID || state.ReleaseDirectory != oldRelease {
		t.Fatal("failed build changed active state")
	}
	if err := verifyHealth(loopbackClient(), o.Address, o.Version); err != nil {
		t.Fatal("failed build interrupted old bridge", err)
	}
	entries, err := os.ReadDir(filepath.Join(o.InstallDir, "releases"))
	if err != nil || len(entries) != 1 {
		t.Fatal("failed build left a partial release", err, len(entries))
	}
}

func mustURL(t *testing.T, value string) *url.URL {
	t.Helper()
	u, e := url.Parse(value)
	if e != nil {
		t.Fatal(e)
	}
	return u
}

func TestManagedMetadataRejectsSymlinksHardlinksAndForeignReleasePaths(t *testing.T) {
	o := installerOptions(t)
	target := filepath.Join(t.TempDir(), "untouched")
	if err := os.WriteFile(target, []byte("private"), 0600); err != nil {
		t.Fatal(err)
	}
	stateFile := filepath.Join(o.InstallDir, "state.json")
	if err := os.Symlink(target, stateFile); err != nil {
		t.Fatal(err)
	}
	if _, err := loadState(o.InstallDir); err == nil {
		t.Fatal("followed managed-state symlink")
	}
	if err := atomicJSON(stateFile, map[string]any{"pid": 123}); err == nil {
		t.Fatal("replaced symlink metadata")
	}
	os.Remove(stateFile)
	if err := os.Link(target, stateFile); err != nil {
		t.Fatal(err)
	}
	if _, err := loadState(o.InstallDir); err == nil {
		t.Fatal("accepted multiply linked managed metadata")
	}
	os.Remove(stateFile)
	raw, err := os.ReadFile(target)
	if err != nil || string(raw) != "private" {
		t.Fatal("foreign file modified", err)
	}
	state := managedState{SchemaVersion: 1, PID: 123, ProcessStart: "unknown", SourceSHA: o.SourceSHA, Version: o.Version, Origin: o.Origin, Address: o.Address, ReleaseDirectory: "/tmp/unrelated", Executable: "/tmp/unrelated/visual-nerve"}
	if err = atomicJSON(stateFile, state); err != nil {
		t.Fatal(err)
	}
	if _, err = loadState(o.InstallDir); err == nil {
		t.Fatal("accepted process outside managed release")
	}
}

func TestManagedLifecycleAllowsAnExistingSymlinkedParentDirectory(t *testing.T) {
	o := installerOptions(t)
	aliasRoot := filepath.Join(t.TempDir(), "parent-alias")
	if err := os.Symlink(filepath.Dir(o.InstallDir), aliasRoot); err != nil {
		t.Fatal(err)
	}
	o.InstallDir = filepath.Join(aliasRoot, filepath.Base(o.InstallDir))
	o.Go = filepath.Join(o.InstallDir, "toolchains/go/bin/go")
	o.Address = freeAddress(t)
	installFixtureRelease(t, o)
	if err := run(o); err != nil {
		t.Fatal(err)
	}
	state, err := loadState(o.InstallDir)
	if err != nil || state == nil {
		t.Fatal("missing managed state", err)
	}
	t.Cleanup(func() { stopManaged(state) })
	if err = verifyManaged(state); err != nil {
		t.Fatal("safe parent alias prevented process identity check", err)
	}
	if err = run(options{InstallDir: o.InstallDir, Stop: true}); err != nil {
		t.Fatal(err)
	}
}
