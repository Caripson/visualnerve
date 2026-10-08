package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
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
	addr := flag.String("addr", env("VISUAL_NERVE_ADDR", "127.0.0.1:4317"), "listen address")
	static := flag.String("static", env("VISUAL_NERVE_STATIC_DIR", "public"), "built site directory")
	dev := flag.Bool("dev", false, "allow loopback Vite origin")
	bridge := flag.Bool("bridge", false, "enable optional browser communication bridge and MCP")
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
	if (*cert == "") != (*key == "") {
		log.Fatal("provide both --tls-cert and --tls-key")
	}
	host, _, err := net.SplitHostPort(*addr)
	if err != nil {
		log.Fatal(err)
	}
	token := os.Getenv("VISUAL_NERVE_BRIDGE_TOKEN")
	remote := host != "127.0.0.1" && host != "localhost" && host != "::1"
	if remote && *bridge {
		log.Fatal("local MCP integration must bind to 127.0.0.1, localhost or ::1")
	}
	handler := server.New(server.Config{StaticDir: *static, Token: token, Dev: *dev, AllowRemote: remote, Bridge: *bridge, AllowedOrigins: allowed})
	// Response delivery must outlive bounded request-body reading and project analysis.
	requestReadTimeout := 30 * time.Second
	httpServer := &http.Server{Addr: *addr, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: requestReadTimeout, WriteTimeout: requestReadTimeout + server.MaxCommandTimeout + 15*time.Second, IdleTimeout: 90 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		handler.Close()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdown)
	}()
	scheme := "http"
	if *cert != "" {
		scheme = "https"
	}
	log.Printf("Visual Nerve %s://%s · browser storage: IndexedDB · integration: %t", scheme, *addr, *bridge)
	if *cert != "" {
		err = httpServer.ListenAndServeTLS(*cert, *key)
	} else {
		err = httpServer.ListenAndServe()
	}
	if err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
