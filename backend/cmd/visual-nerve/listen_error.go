package main

import (
	"errors"
	"fmt"
	"syscall"
)

func listenError(addr, scheme string, err error) error {
	if errors.Is(err, syscall.EADDRINUSE) {
		return fmt.Errorf("listen address %s is already in use; stop its existing process or choose an explicit free --addr 127.0.0.1:PORT, then use that same port in the browser bridge address and --mcp-url %s://127.0.0.1:PORT/mcp (no automatic fallback): %w", addr, scheme, err)
	}
	return err
}
