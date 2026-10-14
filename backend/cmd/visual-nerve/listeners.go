package main

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sync"
	"time"
	"visualnerve/internal/server"
)

type httpListenerPlan struct {
	primary, compatibility string
}

// Explicit listener configuration always wins, including an explicit default.
// The alias preserves existing clients without discovering or contacting any
// process already listening on the legacy port.
func planHTTPListeners(bridge bool, address string, explicit bool) httpListenerPlan {
	plan := httpListenerPlan{primary: address}
	if bridge && !explicit && address == server.DefaultBridgeAddress {
		plan.compatibility = "127.0.0.1:4317"
	}
	return plan
}

type httpEndpoint struct {
	listener net.Listener
	server   *http.Server
}

type httpListenerGroup struct {
	handler   *server.Server
	endpoints []httpEndpoint
	scheme    string
	closeOnce sync.Once
}

// Both listeners use one handler: browser peers, grants and operation receipts
// must never diverge depending on which approved loopback port a client uses.
func bindHTTPListeners(plan httpListenerPlan, handler *server.Server, cert, key string, diagnostic func(string, ...any)) (*httpListenerGroup, error) {
	group := &httpListenerGroup{handler: handler, scheme: "http"}
	var tlsConfig *tls.Config
	if cert != "" || key != "" {
		pair, err := tls.LoadX509KeyPair(cert, key)
		if err != nil {
			return nil, fmt.Errorf("load local TLS certificate: %w", err)
		}
		tlsConfig = &tls.Config{Certificates: []tls.Certificate{pair}, MinVersion: tls.VersionTLS12}
		group.scheme = "https"
	}
	bind := func(address string) error {
		listener, err := net.Listen("tcp", address)
		if err != nil {
			return err
		}
		// Response delivery outlives bounded body reading and project analysis.
		readTimeout := 30 * time.Second
		httpServer := &http.Server{Addr: address, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: readTimeout, WriteTimeout: readTimeout + server.MaxCommandTimeout + 15*time.Second, IdleTimeout: 90 * time.Second}
		if tlsConfig != nil {
			httpServer.TLSConfig = tlsConfig.Clone()
		}
		group.endpoints = append(group.endpoints, httpEndpoint{listener, httpServer})
		return nil
	}
	// Never take the legacy address if the requested primary service cannot start.
	if err := bind(plan.primary); err != nil {
		return nil, listenError(plan.primary, group.scheme, err)
	}
	if plan.compatibility != "" {
		if err := bind(plan.compatibility); err != nil {
			diagnostic("Legacy compatibility listener %s was not started: %v. Primary %s://%s is unchanged. The existing process was not contacted or stopped; review browser Settings and client addresses before switching to the primary port.", plan.compatibility, err, group.scheme, plan.primary)
		} else {
			diagnostic("Legacy compatibility listener %s://%s shares the primary bridge and its authorization. Set --addr or VISUAL_NERVE_ADDR explicitly to use only one listener.", group.scheme, plan.compatibility)
		}
	}
	return group, nil
}

func (group *httpListenerGroup) serve(ctx context.Context) error {
	results := make(chan error, len(group.endpoints))
	for _, endpoint := range group.endpoints {
		go func() {
			var err error
			if group.scheme == "https" {
				err = endpoint.server.ServeTLS(endpoint.listener, "", "")
			} else {
				err = endpoint.server.Serve(endpoint.listener)
			}
			if err != nil && !errors.Is(err, http.ErrServerClosed) {
				err = fmt.Errorf("serve %s://%s: %w", group.scheme, endpoint.listener.Addr(), err)
			} else {
				err = nil
			}
			results <- err
		}()
	}
	var result error
	select {
	case <-ctx.Done():
	case result = <-results:
	}
	group.close()
	return result
}

func (group *httpListenerGroup) close() {
	group.closeOnce.Do(func() {
		// HTTP Shutdown does not close hijacked WebSockets; revoke shared peers first.
		group.handler.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		var done sync.WaitGroup
		for _, endpoint := range group.endpoints {
			done.Go(func() {
				if err := endpoint.server.Shutdown(ctx); err != nil {
					_ = endpoint.server.Close()
				}
				_ = endpoint.listener.Close()
			})
		}
		done.Wait()
	})
}
