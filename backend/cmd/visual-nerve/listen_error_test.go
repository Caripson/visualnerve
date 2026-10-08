package main

import (
	"bytes"
	"flag"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
	"visualnerve/internal/server"
)

func TestMCPBridgePortCLIProcess(t *testing.T) {
	if os.Getenv("VISUAL_NERVE_TEST_PORT_PROCESS") != "1" {
		return
	}
	flag.CommandLine = flag.NewFlagSet("visual-nerve", flag.ExitOnError)
	os.Args = []string{"visual-nerve", "--bridge", "--addr", os.Getenv("VISUAL_NERVE_TEST_ADDR")}
	main()
	os.Exit(0)
}

func TestMCPOccupiedPortFailsWithExplicitMatchingConfigurationAdvice(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	addr := listener.Addr().String()
	cmd := exec.Command(os.Args[0], "-test.run=^TestMCPBridgePortCLIProcess$")
	cmd.Env = append(os.Environ(), "VISUAL_NERVE_TEST_PORT_PROCESS=1", "VISUAL_NERVE_TEST_ADDR="+addr, "VISUAL_NERVE_ALLOWED_ORIGINS=", "VISUAL_NERVE_TLS_CERT=", "VISUAL_NERVE_TLS_KEY=", "VISUAL_NERVE_BRIDGE_TOKEN=")
	var output, diagnostic bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &diagnostic
	if err := cmd.Run(); err == nil {
		t.Fatal("bridge must not silently choose a new port")
	}
	for _, phrase := range []string{addr, "already in use", "--addr", "browser bridge address", "--mcp-url http://127.0.0.1:PORT/mcp", "no automatic fallback"} {
		if !strings.Contains(diagnostic.String(), phrase) {
			t.Fatal("occupied-port error needs actionable matching configuration", phrase, diagnostic.String())
		}
	}
	if output.Len() != 0 {
		t.Fatal("server errors belong on stderr")
	}
}

func TestMCPBridgeCustomAddrBindsOnlyTheExplicitPort(t *testing.T) {
	reserved, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := reserved.Addr().String()
	_ = reserved.Close()
	cmd := exec.Command(os.Args[0], "-test.run=^TestMCPBridgePortCLIProcess$")
	cmd.Env = append(os.Environ(), "VISUAL_NERVE_TEST_PORT_PROCESS=1", "VISUAL_NERVE_TEST_ADDR="+addr, "VISUAL_NERVE_ALLOWED_ORIGINS=", "VISUAL_NERVE_TLS_CERT=", "VISUAL_NERVE_TLS_KEY=", "VISUAL_NERVE_BRIDGE_TOKEN=")
	var output, diagnostic bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &diagnostic
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if cmd.ProcessState == nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
	}()
	client := &http.Client{Timeout: 200 * time.Millisecond}
	deadline := time.Now().Add(5 * time.Second)
	for {
		response, err := client.Get("http://" + addr + "/api/v1/health")
		if err == nil {
			response.Body.Close()
			if response.StatusCode != 200 {
				t.Fatal(response.StatusCode)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("--addr did not start the bridge at its explicit port")
		}
		time.Sleep(5 * time.Millisecond)
	}
	// Adapter endpoint validation accepts this same explicitly selected port.
	if _, err := server.MCPStdioURL("http://" + addr + "/mcp"); err != nil {
		t.Fatal(err)
	}
	_ = cmd.Process.Kill()
	_ = cmd.Wait()
	if output.Len() != 0 {
		t.Fatal("server diagnostics belong on stderr")
	}
}

func TestMCPBridgeRejectsAutomaticAndNonNumericPorts(t *testing.T) {
	for _, addr := range []string{"127.0.0.1:0", "127.0.0.1:-1", "127.0.0.1:65536", "127.0.0.1:http"} {
		t.Run(addr, func(t *testing.T) {
			cmd := exec.Command(os.Args[0], "-test.run=^TestMCPBridgePortCLIProcess$")
			cmd.Env = append(os.Environ(), "VISUAL_NERVE_TEST_PORT_PROCESS=1", "VISUAL_NERVE_TEST_ADDR="+addr, "VISUAL_NERVE_ALLOWED_ORIGINS=", "VISUAL_NERVE_TLS_CERT=", "VISUAL_NERVE_TLS_KEY=", "VISUAL_NERVE_BRIDGE_TOKEN=")
			var output, diagnostic bytes.Buffer
			cmd.Stdout, cmd.Stderr = &output, &diagnostic
			if err := cmd.Run(); err == nil {
				t.Fatal("bridge must require an explicit stable numeric port")
			}
			if output.Len() != 0 || !strings.Contains(diagnostic.String(), "between 1 and 65535") || !strings.Contains(diagnostic.String(), "no automatic or ephemeral port") {
				t.Fatal("invalid port must fail before listening with matching configuration advice", diagnostic.String())
			}
		})
	}
}
