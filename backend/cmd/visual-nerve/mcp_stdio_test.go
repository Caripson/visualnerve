package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"flag"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
	"visualnerve/internal/server"
)

// Launch the actual main function in an isolated test executable. No external
// binary/build, shell wrapper or second bridge listener is needed.
func TestMCPStdioCLIProcess(t *testing.T) {
	if os.Getenv("VISUAL_NERVE_TEST_STDIO_PROCESS") != "1" {
		return
	}
	flag.CommandLine = flag.NewFlagSet("visual-nerve", flag.ExitOnError)
	os.Args = []string{"visual-nerve", "--mcp-stdio", "--mcp-url", os.Getenv("VISUAL_NERVE_TEST_MCP_URL")}
	main()
	os.Exit(0)
}

func TestMCPStdioCLIWritesOnlyProtocolAndDoesNotStartOrStopSharedServer(t *testing.T) {
	const token = "test-only-cli-token"
	handler := server.New(server.Config{Bridge: true, Token: token})
	host := httptest.NewServer(handler)
	defer host.Close()
	defer handler.Close()
	cmd := exec.Command(os.Args[0], "-test.run=^TestMCPStdioCLIProcess$")
	cmd.Env = append(os.Environ(), "VISUAL_NERVE_TEST_STDIO_PROCESS=1", "VISUAL_NERVE_TEST_MCP_URL="+host.URL+"/mcp", "VISUAL_NERVE_ALLOWED_ORIGINS=", "VISUAL_NERVE_BRIDGE_TOKEN="+token)
	input, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var diagnostic bytes.Buffer
	cmd.Stderr = &diagnostic
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if cmd.ProcessState == nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
	})
	_, err = io.WriteString(input, `{"jsonrpc":"2.0","id":"cli-init","method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"generic CLI","version":"1"}}}`+"\n")
	if err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(output)
	line, err := reader.ReadBytes('\n')
	if err != nil {
		t.Fatal(err)
	}
	var response struct {
		JSONRPC string `json:"jsonrpc"`
		ID      string `json:"id"`
		Result  struct {
			ProtocolVersion string `json:"protocolVersion"`
		} `json:"result"`
	}
	if json.Unmarshal(line, &response) != nil || response.JSONRPC != "2.0" || response.ID != "cli-init" || response.Result.ProtocolVersion != "2025-11-25" {
		t.Fatal("CLI stdout must be exactly the correlated protocol result")
	}
	_ = input.Close()
	// Drain stdout before Wait closes the parent's StdoutPipe descriptor.
	remaining, readError := io.ReadAll(reader)
	waited := make(chan error, 1)
	go func() { waited <- cmd.Wait() }()
	select {
	case err := <-waited:
		if err != nil {
			t.Fatal("adapter exit", err, diagnostic.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("adapter must exit after EOF")
	}
	if diagnostic.Len() != 0 {
		t.Fatal("successful adapter launch must not write server startup diagnostics", diagnostic.String())
	}
	if readError != nil || len(remaining) != 0 {
		t.Fatal("stdout must contain no startup banner or test output")
	}
	request, _ := http.NewRequest(http.MethodPost, host.URL+"/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":7,"method":"ping"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	result, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	result.Body.Close()
	if result.StatusCode != 200 {
		t.Fatal("adapter EOF must leave shared HTTP server running", result.StatusCode)
	}
}

func TestMCPStdioCLIRejectsRemoteCredentialURLsOnStderrOnly(t *testing.T) {
	cmd := exec.Command(os.Args[0], "-test.run=^TestMCPStdioCLIProcess$")
	cmd.Env = append(os.Environ(), "VISUAL_NERVE_TEST_STDIO_PROCESS=1", "VISUAL_NERVE_TEST_MCP_URL=https://test-user:test-password@remote.example:443/mcp?token=test-token", "VISUAL_NERVE_ALLOWED_ORIGINS=", "VISUAL_NERVE_BRIDGE_TOKEN=test-env-token")
	var output, diagnostic bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &diagnostic
	if err := cmd.Run(); err == nil {
		t.Fatal("unsafe endpoint must fail")
	}
	if output.Len() != 0 || !strings.Contains(diagnostic.String(), "--mcp-url requires") || strings.Contains(diagnostic.String(), "test-password") || strings.Contains(diagnostic.String(), "test-token") || strings.Contains(diagnostic.String(), "test-env-token") {
		t.Fatal("only a generic validation diagnostic belongs on stderr")
	}
}
