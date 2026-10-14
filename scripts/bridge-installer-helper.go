// The hosted installer embeds this standard-library-only helper verbatim.
package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const maxSourceBytes = 16 << 20
const maxExtractedBytes = 64 << 20
const maxSourceFiles = 5000

var digestPattern = regexp.MustCompile(`^[a-fA-F0-9]{64}$`)
var versionPattern = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$`)
var errProcessGone = errors.New("managed process is no longer running")

type options struct {
	InstallDir, Go, SourceURL, SourceSHA, Version, Revision, Origin, Address string
	InstallOnly, Status, Stop                                                bool
}
type managedState struct {
	SchemaVersion    int    `json:"schemaVersion"`
	PID              int    `json:"pid"`
	Executable       string `json:"executable"`
	ProcessStart     string `json:"processStart"`
	Origin           string `json:"origin"`
	Address          string `json:"address"`
	SourceSHA        string `json:"sourceSha256"`
	Version          string `json:"version"`
	Revision         string `json:"revision"`
	ReleaseDirectory string `json:"releaseDirectory"`
}
type releaseInfo struct {
	SourceSHA string `json:"sourceSha256"`
	Version   string `json:"version"`
	Revision  string `json:"revision"`
}

func main() {
	var o options
	flag.StringVar(&o.InstallDir, "install-dir", "", "absolute installation directory")
	flag.StringVar(&o.Go, "go", "", "private Go executable")
	flag.StringVar(&o.SourceURL, "source-url", "", "pinned HTTPS source ZIP")
	flag.StringVar(&o.SourceSHA, "source-sha256", "", "source ZIP SHA-256")
	flag.StringVar(&o.Version, "version", "", "expected bridge version")
	flag.StringVar(&o.Revision, "revision", "", "source revision")
	flag.StringVar(&o.Origin, "origin", "https://app.visualnerve.com", "exact browser origin")
	flag.StringVar(&o.Address, "addr", "127.0.0.1:47417", "explicit loopback listener")
	flag.BoolVar(&o.InstallOnly, "install-only", false, "build without starting")
	flag.BoolVar(&o.Status, "status", false, "inspect this managed bridge offline")
	flag.BoolVar(&o.Stop, "stop", false, "stop only this verified managed bridge")
	flag.Parse()
	if flag.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "Unexpected positional arguments.")
		os.Exit(2)
	}
	if err := run(o); err != nil {
		fmt.Fprintln(os.Stderr, "Visual Nerve setup:", err)
		os.Exit(1)
	}
}

func validateOptions(o *options) error {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		return errors.New("only Linux/WSL and macOS are supported")
	}
	if !filepath.IsAbs(o.InstallDir) || filepath.Clean(o.InstallDir) != o.InstallDir || o.InstallDir == "/" {
		return errors.New("--install-dir must be a clean, dedicated absolute directory")
	}
	home, _ := os.UserHomeDir()
	if o.InstallDir == home {
		return errors.New("the home directory itself cannot be the installation directory")
	}
	actions := 0
	for _, active := range []bool{o.InstallOnly, o.Status, o.Stop} {
		if active {
			actions++
		}
	}
	if actions > 1 {
		return errors.New("choose only one of --install-only, --status or --stop")
	}
	if o.Status || o.Stop {
		return nil
	}
	if err := validateOrigin(o.Origin); err != nil {
		return err
	}
	if err := validateAddress(o.Address); err != nil {
		return err
	}
	if !filepath.IsAbs(o.Go) {
		return errors.New("--go must identify the absolute private Go executable")
	}
	if err := validateSourceURL(o.SourceURL); err != nil {
		return err
	}
	if !digestPattern.MatchString(o.SourceSHA) {
		return errors.New("source SHA-256 must contain exactly 64 hexadecimal digits")
	}
	o.SourceSHA = strings.ToLower(o.SourceSHA)
	if !versionPattern.MatchString(o.Version) {
		return errors.New("invalid bridge version")
	}
	if o.Revision != "working-tree" && !regexp.MustCompile(`^[a-fA-F0-9]{7,40}$`).MatchString(o.Revision) {
		return errors.New("invalid source revision")
	}
	return nil
}
func validateOrigin(value string) error {
	u, err := url.Parse(value)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || u.RawPath != "" || u.Opaque != "" || u.String() != value {
		return errors.New("--origin must be an exact browser origin without a path, credentials, query or fragment")
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && loopbackHost(u.Hostname())) {
		return errors.New("--origin requires HTTPS, except literal loopback HTTP development origins")
	}
	if u.Port() != "" {
		n, e := strconv.Atoi(u.Port())
		if e != nil || n < 1 || n > 65535 {
			return errors.New("invalid browser origin port")
		}
	}
	return nil
}
func loopbackHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}
func validateAddress(value string) error {
	host, port, err := net.SplitHostPort(value)
	n, e := strconv.Atoi(port)
	if err != nil || e != nil || n < 1 || n > 65535 || !loopbackHost(host) {
		return errors.New("--addr requires localhost, 127.0.0.1 or [::1] and an explicit port from 1 to 65535")
	}
	return nil
}
func validateSourceURL(value string) error {
	u, err := url.Parse(value)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" {
		return errors.New("source package must use a pinned HTTPS URL without credentials, query or fragment")
	}
	return nil
}
func ownedDirectory(name string, create bool) error {
	if create {
		if err := os.MkdirAll(name, 0700); err != nil {
			return err
		}
	}
	info, err := os.Lstat(name)
	if err != nil {
		return err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || !ok || int(stat.Uid) != os.Getuid() {
		return fmt.Errorf("directory is not owned by this user or is a symlink: %s", name)
	}
	return os.Chmod(name, 0700)
}
func ownedFile(name string) error {
	info, err := os.Lstat(name)
	if err != nil {
		return err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !info.Mode().IsRegular() || !ok || int(stat.Uid) != os.Getuid() || stat.Nlink != 1 {
		return fmt.Errorf("not a regular, singly linked file owned by this user: %s", name)
	}
	return nil
}
func atomicJSON(name string, value any) error {
	if _, err := os.Lstat(name); err == nil {
		if err = ownedFile(name); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(name), ".state-")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err = tmp.Write(append(raw, '\n')); err != nil {
		tmp.Close()
		return err
	}
	if err = tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), name)
}
func readJSON(name string, target any) error {
	if err := ownedFile(name); err != nil {
		return err
	}
	f, err := os.Open(name)
	if err != nil {
		return err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, 16385))
	if err != nil {
		return err
	}
	if len(raw) > 16384 {
		return errors.New("managed metadata exceeds limit")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err = d.Decode(target); err != nil {
		return err
	}
	if err = d.Decode(new(any)); err != io.EOF {
		return errors.New("managed metadata contains trailing content")
	}
	return nil
}
func loadState(dir string) (*managedState, error) {
	var s managedState
	if err := readJSON(filepath.Join(dir, "state.json"), &s); err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	if s.SchemaVersion != 1 || s.PID <= 1 || s.ProcessStart == "" || !digestPattern.MatchString(s.SourceSHA) || !versionPattern.MatchString(s.Version) {
		return nil, errors.New("managed state is invalid; no process was touched")
	}
	expected := filepath.Join(dir, "releases", s.SourceSHA)
	if s.ReleaseDirectory != expected || s.Executable != filepath.Join(expected, "visual-nerve") {
		return nil, errors.New("managed executable is outside its recorded release; no process was touched")
	}
	if err := validateAddress(s.Address); err != nil {
		return nil, err
	}
	if err := validateOrigin(s.Origin); err != nil {
		return nil, err
	}
	return &s, nil
}

func processIdentity(pid int, executable string) (string, error) {
	if pid <= 1 {
		return "", errors.New("refusing a system process")
	}
	if runtime.GOOS == "linux" {
		root := fmt.Sprintf("/proc/%d", pid)
		info, err := os.Stat(root)
		if os.IsNotExist(err) {
			return "", errProcessGone
		}
		if err != nil {
			return "", err
		}
		st, ok := info.Sys().(*syscall.Stat_t)
		if !ok || int(st.Uid) != os.Getuid() {
			return "", errors.New("process belongs to another user")
		}
		raw, err := os.ReadFile(filepath.Join(root, "stat"))
		if os.IsNotExist(err) {
			return "", errProcessGone
		}
		if err != nil {
			return "", err
		}
		end := bytes.LastIndexByte(raw, ')')
		if end < 0 {
			return "", errors.New("invalid process identity")
		}
		fields := strings.Fields(string(raw[end+1:]))
		if len(fields) < 20 {
			return "", errors.New("incomplete process identity")
		}
		if fields[0] == "Z" || fields[0] == "X" {
			return "", errProcessGone
		}
		actual, err := linuxProcessExecutable(root)
		if err != nil {
			return "", err
		}
		expected, err := filepath.EvalSymlinks(executable)
		if err != nil {
			return "", err
		}
		if actual != expected {
			return "", errors.New("PID executable does not match this managed bridge")
		}
		boot, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
		if err != nil {
			return "", err
		}
		return "linux:" + strings.TrimSpace(string(boot)) + ":" + fields[19], nil
	}
	ps := func(field string) (string, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "/bin/ps", "-ww", "-p", strconv.Itoa(pid), "-o", field+"=")
		cmd.Env = []string{"PATH=/usr/bin:/bin", "LC_ALL=C", "LANG=C"}
		raw, err := cmd.Output()
		if err != nil {
			var ex *exec.ExitError
			if errors.As(err, &ex) && ex.ExitCode() == 1 {
				return "", errProcessGone
			}
			return "", err
		}
		return strings.TrimSpace(string(raw)), nil
	}
	uid, err := ps("uid")
	if err != nil {
		return "", err
	}
	if uid != strconv.Itoa(os.Getuid()) {
		return "", errors.New("process belongs to another user")
	}
	status, err := ps("stat")
	if err != nil {
		return "", err
	}
	if strings.HasPrefix(status, "Z") {
		return "", errProcessGone
	}
	actual, err := ps("comm")
	if err != nil {
		return "", err
	}
	if actual != executable {
		return "", errors.New("PID executable does not match this managed bridge")
	}
	start, err := ps("lstart")
	if err != nil {
		return "", err
	}
	if start == "" {
		return "", errors.New("missing process start time")
	}
	return "darwin:" + start, nil
}

func linuxProcessExecutable(processDirectory string) (string, error) {
	executable, err := os.Readlink(filepath.Join(processDirectory, "exe"))
	// The process can exit after its live stat record was read. Only a vanished
	// procfs link means it is gone; permission and identity failures still fail.
	if os.IsNotExist(err) {
		return "", errProcessGone
	}
	return executable, err
}

func verifyManaged(s *managedState) error {
	if err := ownedDirectory(s.ReleaseDirectory, false); err != nil {
		return err
	}
	if err := ownedFile(s.Executable); err != nil {
		return err
	}
	start, err := processIdentity(s.PID, s.Executable)
	if err != nil {
		return err
	}
	if start != s.ProcessStart {
		return errors.New("PID start identity changed; refusing to signal a different process")
	}
	return nil
}
func signalManaged(s *managedState, signal syscall.Signal) error {
	if err := verifyManaged(s); err != nil {
		return err
	}
	p, err := os.FindProcess(s.PID)
	if err != nil {
		return err
	}
	defer p.Release()
	return p.Signal(signal)
}
func stopManaged(s *managedState) error {
	if err := signalManaged(s, syscall.SIGTERM); err != nil {
		if errors.Is(err, errProcessGone) {
			return nil
		}
		return err
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		err := verifyManaged(s)
		if errors.Is(err, errProcessGone) {
			return nil
		}
		if err != nil {
			return err
		}
		time.Sleep(50 * time.Millisecond)
	}
	if err := signalManaged(s, syscall.SIGKILL); err != nil {
		if errors.Is(err, errProcessGone) {
			return nil
		}
		return err
	}
	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		err := verifyManaged(s)
		if errors.Is(err, errProcessGone) {
			return nil
		}
		if err != nil {
			return err
		}
		time.Sleep(50 * time.Millisecond)
	}
	return errors.New("managed process did not exit; its state was retained")
}
func loopbackClient() *http.Client {
	return &http.Client{Timeout: 2 * time.Second, Transport: &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: time.Second}).DialContext, DisableKeepAlives: true}, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("health redirects are not accepted") }}
}
func verifyHealth(client *http.Client, address, version string) error {
	response, err := client.Get("http://" + address + "/api/v1/health")
	if err != nil {
		return fmt.Errorf("health request failed: %w", err)
	}
	defer response.Body.Close()
	media, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || response.StatusCode != 200 || media != "application/json" {
		return errors.New("listener did not return HTTP 200 application/json Visual Nerve health")
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 65537))
	if err != nil {
		return err
	}
	if len(raw) > 65536 {
		return errors.New("health response exceeds limit")
	}
	var h struct {
		Status, Storage, Version string
		Bridge                   bool
		Tools, Capabilities      []string
	}
	if err = json.Unmarshal(raw, &h); err != nil {
		return errors.New("listener did not return valid Visual Nerve health JSON")
	}
	contains := func(values []string, want string) bool {
		for _, v := range values {
			if v == want {
				return true
			}
		}
		return false
	}
	if h.Status != "ok" || h.Storage != "indexeddb" || !h.Bridge || h.Version != version || !contains(h.Tools, "visual_nerve_request") || !contains(h.Tools, "visual_nerve_api_docs") || !contains(h.Capabilities, "operations-v1") || !contains(h.Capabilities, "endpoint-docs-v1") {
		return errors.New("listener health does not match this bridge version and required MCP tools/capabilities")
	}
	return nil
}
func requireFreeAddress(address string) error {
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return fmt.Errorf("address %s is occupied or unavailable; no foreign process was contacted or stopped: %w", address, err)
	}
	return listener.Close()
}

func downloadSource(client *http.Client, source, digest string) ([]byte, error) {
	if err := validateSourceURL(source); err != nil {
		return nil, err
	}
	response, err := client.Get(source)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("source download returned HTTP %d", response.StatusCode)
	}
	if response.ContentLength > maxSourceBytes {
		return nil, errors.New("source ZIP exceeds 16 MiB limit")
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxSourceBytes+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > maxSourceBytes {
		return nil, errors.New("source ZIP exceeds 16 MiB limit")
	}
	sum := sha256.Sum256(raw)
	if !strings.EqualFold(hex.EncodeToString(sum[:]), digest) {
		return nil, errors.New("source checksum mismatch; source was not extracted or executed")
	}
	return raw, nil
}
func sourceClient() *http.Client {
	return &http.Client{Timeout: 3 * time.Minute, Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, DialContext: (&net.Dialer{Timeout: 20 * time.Second}).DialContext, TLSHandshakeTimeout: 20 * time.Second, DisableCompression: true}, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many source redirects")
		}
		return validateSourceURL(req.URL.String())
	}}
}
func extractSource(raw []byte, destination string) error {
	archive, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return err
	}
	if len(archive.File) > maxSourceFiles {
		return errors.New("source ZIP exceeds file-count limit")
	}
	seen := map[string]bool{}
	var total uint64
	for _, file := range archive.File {
		name := file.Name
		directory := strings.HasSuffix(name, "/")
		clean := strings.TrimSuffix(name, "/")
		if clean == "" || path.Clean(clean) != clean || strings.ContainsAny(name, "\\:\x00") || !(clean == "visual-nerve-bridge" && directory || strings.HasPrefix(clean, "visual-nerve-bridge/")) {
			return fmt.Errorf("unsafe ZIP path %q", name)
		}
		for _, r := range name {
			if r < 33 || r > 126 {
				return fmt.Errorf("non-ASCII or whitespace ZIP path %q", name)
			}
		}
		for _, part := range strings.Split(clean, "/") {
			if strings.HasSuffix(part, ".") {
				return fmt.Errorf("ambiguous ZIP path %q", name)
			}
		}
		key := strings.ToLower(clean)
		if seen[key] {
			return fmt.Errorf("duplicate ZIP path %q", name)
		}
		seen[key] = true
		mode := file.Mode()
		if directory != mode.IsDir() || (!directory && !mode.IsRegular()) {
			return fmt.Errorf("special ZIP entry rejected: %s", name)
		}
		if file.UncompressedSize64 > maxExtractedBytes-total {
			return errors.New("source ZIP exceeds 64 MiB expanded limit")
		}
		total += file.UncompressedSize64
	}
	var written int64
	for _, file := range archive.File {
		target := filepath.Join(destination, filepath.FromSlash(file.Name))
		if file.FileInfo().IsDir() {
			if err = os.MkdirAll(target, 0700); err != nil {
				return err
			}
			continue
		}
		if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return err
		}
		input, e := file.Open()
		if e != nil {
			return e
		}
		output, e := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			input.Close()
			return e
		}
		n, e := io.Copy(output, io.LimitReader(input, maxExtractedBytes-written+1))
		written += n
		closeIn, closeOut := input.Close(), output.Close()
		if e != nil {
			return e
		}
		if closeIn != nil {
			return closeIn
		}
		if closeOut != nil {
			return closeOut
		}
		if written > maxExtractedBytes || uint64(n) != file.UncompressedSize64 {
			return errors.New("expanded source size differs from its bounded ZIP metadata")
		}
	}
	return nil
}
func buildEnvironment(o options) []string {
	env := []string{"PATH=" + filepath.Dir(o.Go) + string(os.PathListSeparator) + "/usr/bin:/bin:/usr/sbin:/sbin", "GOENV=off", "GOWORK=off", "GO111MODULE=on", "GOTOOLCHAIN=local", "GOFLAGS=", "CGO_ENABLED=0", "GOCACHE=" + filepath.Join(o.InstallDir, "build-cache"), "GOMODCACHE=" + filepath.Join(o.InstallDir, "module-cache"), "GOPROXY=https://proxy.golang.org", "GOSUMDB=sum.golang.org", "GOPRIVATE=", "GONOPROXY=", "GONOSUMDB=", "GOINSECURE=", "LC_ALL=C", "LANG=C"}
	for _, key := range []string{"HOME", "USER", "LOGNAME", "TMPDIR", "SSL_CERT_FILE", "SSL_CERT_DIR"} {
		if value := os.Getenv(key); value != "" {
			env = append(env, key+"="+value)
		}
	}
	return env
}
func buildCommand(o options, dir string, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, o.Go, args...)
	cmd.Dir = dir
	cmd.Env = buildEnvironment(o)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("verified bridge build failed (existing managed release unchanged): %w", err)
	}
	return nil
}
func ensureRelease(o options, client *http.Client) (string, error) {
	releases := filepath.Join(o.InstallDir, "releases")
	if err := ownedDirectory(releases, true); err != nil {
		return "", err
	}
	release := filepath.Join(releases, o.SourceSHA)
	if _, err := os.Lstat(release); err == nil {
		if err = ownedDirectory(release, false); err != nil {
			return "", err
		}
		var info releaseInfo
		if err = readJSON(filepath.Join(release, "release.json"), &info); err != nil {
			return "", err
		}
		if info.SourceSHA != o.SourceSHA || info.Version != o.Version {
			return "", errors.New("existing immutable release metadata differs; it was not overwritten")
		}
		for _, file := range []string{"visual-nerve", "bridge-docs/openapi.yaml"} {
			if err = ownedFile(filepath.Join(release, file)); err != nil {
				return "", err
			}
		}
		return release, nil
	} else if !os.IsNotExist(err) {
		return "", err
	}
	fmt.Println("Downloading checksum-pinned bridge source and building the native bridge.")
	raw, err := downloadSource(client, o.SourceURL, o.SourceSHA)
	if err != nil {
		return "", err
	}
	temporary, err := os.MkdirTemp(releases, ".building-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(temporary)
	source := filepath.Join(temporary, "source")
	if err = os.Mkdir(source, 0700); err != nil {
		return "", err
	}
	if err = extractSource(raw, source); err != nil {
		return "", err
	}
	docs := filepath.Join(temporary, "bridge-docs")
	if err = os.Mkdir(docs, 0700); err != nil {
		return "", err
	}
	for _, dir := range []string{"build-cache", "module-cache"} {
		if err = ownedDirectory(filepath.Join(o.InstallDir, dir), true); err != nil {
			return "", err
		}
	}
	backend := filepath.Join(source, "visual-nerve-bridge", "backend")
	if err = buildCommand(o, backend, "run", "-mod=readonly", "./cmd/openapi", filepath.Join(docs, "openapi.yaml")); err != nil {
		return "", err
	}
	executable := filepath.Join(temporary, "visual-nerve")
	if err = buildCommand(o, backend, "build", "-mod=readonly", "-trimpath", "-o", executable, "./cmd/visual-nerve"); err != nil {
		return "", err
	}
	if err = os.Chmod(executable, 0700); err != nil {
		return "", err
	}
	if err = ownedFile(filepath.Join(docs, "openapi.yaml")); err != nil {
		return "", err
	}
	if err = atomicJSON(filepath.Join(temporary, "release.json"), releaseInfo{o.SourceSHA, o.Version, o.Revision}); err != nil {
		return "", err
	}
	if err = os.Rename(temporary, release); err != nil {
		return "", err
	}
	return release, nil
}
func runtimeEnvironment() []string {
	env := []string{"PATH=/usr/bin:/bin:/usr/sbin:/sbin", "LC_ALL=C", "LANG=C"}
	for _, key := range []string{"HOME", "USER", "LOGNAME", "TMPDIR", "SSL_CERT_FILE", "SSL_CERT_DIR"} {
		if value := os.Getenv(key); value != "" {
			env = append(env, key+"="+value)
		}
	}
	return env
}

func waitForFreeAddress(address string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		err := requireFreeAddress(address)
		if err == nil || !time.Now().Before(deadline) {
			return err
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func startManagedAfterStop(dir string, s managedState) (*managedState, error) {
	// Linux may remove /proc/PID/exe before releasing the stopped process's
	// sockets. Retry binding briefly, without contacting or signalling a listener.
	if err := waitForFreeAddress(s.Address, 2*time.Second); err != nil {
		return nil, err
	}
	return startManaged(dir, s)
}

func startManaged(dir string, s managedState) (result *managedState, err error) {
	if err = requireFreeAddress(s.Address); err != nil {
		return nil, err
	}
	logPath := filepath.Join(dir, "bridge.log")
	if _, err = os.Lstat(logPath); err == nil {
		if err = ownedFile(logPath); err != nil {
			return nil, err
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	log, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return nil, err
	}
	defer log.Close()
	if err = log.Chmod(0600); err != nil {
		return nil, err
	}
	input, err := os.Open(os.DevNull)
	if err != nil {
		return nil, err
	}
	defer input.Close()
	cmd := exec.Command(s.Executable, "--bridge", "--static", filepath.Join(s.ReleaseDirectory, "bridge-docs"), "--addr", s.Address, "--allowed-origin", s.Origin)
	cmd.Env = runtimeEnvironment()
	cmd.Dir = s.ReleaseDirectory
	cmd.Stdin = input
	cmd.Stdout = log
	cmd.Stderr = log
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err = cmd.Start(); err != nil {
		return nil, err
	}
	s.PID = cmd.Process.Pid
	s.SchemaVersion = 1
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()
	s.ProcessStart, err = processIdentity(s.PID, s.Executable)
	if err != nil {
		_ = cmd.Process.Kill()
		<-exited
		return nil, fmt.Errorf("could not record newly started bridge identity: %w", err)
	}
	// Failed startup cleanup signals only the same verified executable and process start.
	defer func() {
		if err != nil {
			_ = stopManaged(&s)
			if current, e := loadState(dir); e == nil && current != nil && current.PID == s.PID && current.ProcessStart == s.ProcessStart {
				_ = os.Remove(filepath.Join(dir, "state.json"))
			}
		}
	}()
	if err = atomicJSON(filepath.Join(dir, "state.json"), &s); err != nil {
		return nil, err
	}
	client := loopbackClient()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if identityErr := verifyManaged(&s); identityErr != nil {
			return nil, fmt.Errorf("managed bridge exited or changed identity; inspect %s: %w", logPath, identityErr)
		}
		if healthErr := verifyHealth(client, s.Address, s.Version); healthErr == nil {
			return &s, nil
		}
		select {
		case exitErr := <-exited:
			return nil, fmt.Errorf("managed bridge exited; inspect %s: %v", logPath, exitErr)
		case <-time.After(100 * time.Millisecond):
		}
	}
	return nil, fmt.Errorf("managed bridge health did not become ready; inspect %s", logPath)
}
func printReady(s *managedState, dir string) {
	fmt.Printf("Visual Nerve %s is running (managed PID %d).\nMCP URL: http://%s/mcp\nAllowed browser origin: %s\nLog: %s\n", s.Version, s.PID, s.Address, s.Origin, filepath.Join(dir, "bridge.log"))
	fmt.Println("Open the browser workspace, unlock it yourself, and choose Read only or Read + write in Settings. The installer cannot unlock or grant access.")
	fmt.Println("For Windows Chrome and WSL, verify both environments reach this same loopback bridge through Windows localhost forwarding; never substitute a LAN listener.")
}
func run(o options) error {
	if err := validateOptions(&o); err != nil {
		return err
	}
	if err := ownedDirectory(o.InstallDir, !o.Status && !o.Stop); err != nil {
		return err
	}
	state, err := loadState(o.InstallDir)
	if err != nil {
		return err
	}
	running := false
	if state != nil {
		err = verifyManaged(state)
		if err == nil {
			running = true
		} else if !errors.Is(err, errProcessGone) {
			return fmt.Errorf("stored PID could not be verified; no process was touched: %w", err)
		}
	}
	if o.Stop {
		if running {
			if err = stopManaged(state); err != nil {
				return err
			}
		}
		if state != nil {
			if err = os.Remove(filepath.Join(o.InstallDir, "state.json")); err != nil {
				return err
			}
		}
		fmt.Println("No managed bridge is running. Other listeners were not touched.")
		return nil
	}
	if o.Status {
		if !running {
			fmt.Println("No managed bridge is running.")
			return nil
		}
		if err = verifyHealth(loopbackClient(), state.Address, state.Version); err != nil {
			return err
		}
		printReady(state, o.InstallDir)
		return nil
	}
	if !o.InstallOnly {
		if running && state.Address == o.Address {
			if err = verifyHealth(loopbackClient(), state.Address, state.Version); err != nil {
				return fmt.Errorf("managed listener is not healthy; review --status and --stop before retrying: %w", err)
			}
		} else if err = requireFreeAddress(o.Address); err != nil {
			return err
		}
		if running && state.Address == o.Address && state.Origin == o.Origin && state.SourceSHA == o.SourceSHA && state.Version == o.Version {
			fmt.Println("Reusing the existing healthy managed bridge; PID unchanged.")
			printReady(state, o.InstallDir)
			return nil
		}
	}
	release, err := ensureRelease(o, sourceClient())
	if err != nil {
		return err
	}
	if o.InstallOnly {
		fmt.Println("Verified bridge installed without starting:", filepath.Join(release, "visual-nerve"))
		return nil
	}
	var provenance releaseInfo
	if err = readJSON(filepath.Join(release, "release.json"), &provenance); err != nil {
		return err
	}
	if running {
		if err = stopManaged(state); err != nil {
			return err
		}
	}
	next := managedState{Executable: filepath.Join(release, "visual-nerve"), ReleaseDirectory: release, SourceSHA: o.SourceSHA, Version: o.Version, Revision: provenance.Revision, Origin: o.Origin, Address: o.Address}
	var current *managedState
	if running {
		current, err = startManagedAfterStop(o.InstallDir, next)
	} else {
		current, err = startManaged(o.InstallDir, next)
	}
	if err != nil {
		if running {
			if previous, restoreErr := startManagedAfterStop(o.InstallDir, *state); restoreErr == nil {
				fmt.Println("The previous managed release was restarted after unsuccessful activation.")
				printReady(previous, o.InstallDir)
			} else {
				return errors.Join(err, fmt.Errorf("previous release restart also failed: %w", restoreErr))
			}
		}
		return err
	}
	printReady(current, o.InstallDir)
	return nil
}
