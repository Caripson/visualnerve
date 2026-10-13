package robloxcloud

import (
	"context"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

const ApprovalDeadline = 60 * time.Second

// Approval contains only public confirmation metadata, never XML or credentials.
// It is created by the broker after the complete artifact digest is validated.
type Approval struct {
	Nonce, SHA256, DiagramID string
	Target                   Target
	BaseVersion              int64
	TotalBytes               int
}

func (a Approval) phrase() (string, bool) {
	if !validID(a.Target.UniverseID) || !validID(a.Target.PlaceID) || a.TotalBytes < 1 || a.TotalBytes > MaxPlaceBytes || a.BaseVersion < 1 || len(a.SHA256) != 64 || len(a.Nonce) < 16 {
		return "", false
	}
	if _, err := hex.DecodeString(a.SHA256); err != nil || strings.ToLower(a.SHA256) != a.SHA256 {
		return "", false
	}
	tail := a.Nonce[len(a.Nonce)-16:]
	if _, err := hex.DecodeString(tail); err != nil || strings.ToLower(tail) != tail {
		return "", false
	}
	return "PUBLISH " + a.Target.PlaceID + " " + a.SHA256[:12] + " " + tail, true
}

// The native descriptor is polled rather than read in a background goroutine.
// Cancellation therefore leaves no blocked reader to consume a later phrase.
type terminalIO interface {
	flush() error
	poll(time.Duration) (bool, error)
	read([]byte) (int, error)
	write([]byte) (int, error)
	close() error
}

type TerminalApprover struct {
	io   terminalIO
	gate chan struct{}
}

func (a *TerminalApprover) Close() error { return a.io.close() }

func (a *TerminalApprover) Approve(ctx context.Context, approval Approval) bool {
	phrase, valid := approval.phrase()
	if !valid || ctx.Err() != nil {
		return false
	}
	select {
	case a.gate <- struct{}{}:
		defer func() { <-a.gate }()
	default:
		return false
	}
	ctx, cancel := context.WithTimeout(ctx, ApprovalDeadline)
	defer cancel()
	if a.io.flush() != nil {
		return false
	}
	defer a.io.flush()
	prompt := fmt.Sprintf("\nRoblox publication approval (local terminal only)\nUniverse %s · Place %s · model revision %d · %d bytes\nSHA-256 %s\nConfirm only the artifact and destination reviewed in the browser.\nWithin 60 seconds, type this exact fresh phrase and press Enter:\n%s\n> ", approval.Target.UniverseID, approval.Target.PlaceID, approval.BaseVersion, approval.TotalBytes, approval.SHA256, phrase)
	if n, err := a.io.write([]byte(prompt)); err != nil || n != len(prompt) {
		return false
	}
	var buffer [256]byte
	defer clear(buffer[:])
	used := 0
	for ctx.Err() == nil && used < len(buffer) {
		ready, err := a.io.poll(100 * time.Millisecond)
		if err != nil {
			return false
		}
		if !ready {
			continue
		}
		if ctx.Err() != nil {
			return false
		}
		n, err := a.io.read(buffer[used:])
		if err != nil || n < 1 {
			return false
		}
		used += n
		if index := strings.IndexByte(string(buffer[:used]), '\n'); index >= 0 {
			// A pasted second line cannot preauthorize this or another receipt.
			if index != used-1 {
				return false
			}
			line := strings.TrimSuffix(string(buffer[:index]), "\r")
			return line == phrase && ctx.Err() == nil
		}
	}
	return false
}
