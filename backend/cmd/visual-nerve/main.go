package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"visualnerve/internal/server"
)

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

type origins []string

func (o *origins) String() string { return strings.Join(*o, ",") }
func (o *origins) Set(value string) error {
	u, err := url.Parse(value)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"))) {
		return fmt.Errorf("allowed origins must be exact HTTPS site origins or loopback HTTP origins")
	}
	*o = append(*o, u.Scheme+"://"+u.Host)
	return nil
}
func main() {
	addr := flag.String("addr", env("VISUAL_NERVE_ADDR", server.DefaultBridgeAddress), "listen address")
	static := flag.String("static", env("VISUAL_NERVE_STATIC_DIR", "public"), "built site directory")
	dev := flag.Bool("dev", false, "allow loopback Vite origin")
	bridge := flag.Bool("bridge", false, "enable optional browser communication bridge and MCP")
	mcpStdio := flag.Bool("mcp-stdio", false, "adapt newline-delimited MCP stdio to an already-running local bridge")
	mcpURL := flag.String("mcp-url", server.DefaultMCPURL, "HTTP(S) loopback /mcp endpoint for --mcp-stdio")
	var allowed origins
	for _, value := range strings.Split(os.Getenv("VISUAL_NERVE_ALLOWED_ORIGINS"), ",") {
		if strings.TrimSpace(value) != "" {
			if err := allowed.Set(strings.TrimSpace(value)); err != nil {
				log.Fatal(err)
			}
		}
	}
	flag.Var(&allowed, "allowed-origin", "exact hosted app origin allowed to connect to the local bridge; repeat for more origins")
	cert := flag.String("tls-cert", os.Getenv("VISUAL_NERVE_TLS_CERT"), "optional trusted local TLS certificate")
	key := flag.String("tls-key", os.Getenv("VISUAL_NERVE_TLS_KEY"), "optional local TLS private key")
	flag.Parse()
	explicitAddress := os.Getenv("VISUAL_NERVE_ADDR") != ""
	flag.Visit(func(value *flag.Flag) {
		if value.Name == "addr" {
			explicitAddress = true
		}
	})
	if *mcpStdio {
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		if err := server.RunMCPStdio(ctx, os.Stdin, os.Stdout, *mcpURL, os.Getenv("VISUAL_NERVE_BRIDGE_TOKEN")); err != nil {
			log.Fatal("MCP stdio adapter: ", err)
		}
		return
	}
	if (*cert == "") != (*key == "") {
		log.Fatal("provide both --tls-cert and --tls-key")
	}
	host, port, err := net.SplitHostPort(*addr)
	if err != nil {
		log.Fatal(err)
	}
	if *bridge {
		portNumber, err := strconv.Atoi(port)
		if err != nil || portNumber < 1 || portNumber > 65535 {
			log.Fatal("local MCP integration requires an explicit numeric --addr port between 1 and 65535; no automatic or ephemeral port is selected")
		}
	}
	token := os.Getenv("VISUAL_NERVE_BRIDGE_TOKEN")
	remote := host != "127.0.0.1" && host != "localhost" && host != "::1"
	if remote && *bridge {
		log.Fatal("local MCP integration must bind to 127.0.0.1, localhost or ::1")
	}
	handler := server.New(server.Config{StaticDir: *static, Token: token, Dev: *dev, AllowRemote: remote, Bridge: *bridge, AllowedOrigins: allowed})
	listeners, err := bindHTTPListeners(planHTTPListeners(*bridge, *addr, explicitAddress), handler, *cert, *key, log.Printf)
	if err != nil {
		handler.Close()
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	log.Printf("Visual Nerve %s://%s · browser storage: IndexedDB · integration: %t", listeners.scheme, *addr, *bridge)
	if err := listeners.serve(ctx); err != nil {
		log.Fatal(err)
	}
}
