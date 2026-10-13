//go:build darwin || (linux && (amd64 || arm64 || 386))

package robloxcloud

import (
	"syscall"
	"testing"
	"time"
)

// Exercise the real descriptor polling primitive with a synthetic pipe, never
// process stdin or a terminal approval. This also runs on Linux in CI.
func TestTerminalNativePollingNeverBlocksAReadWithoutAvailableInput(t *testing.T) {
	fd := make([]int, 2)
	if err := syscall.Pipe(fd); err != nil {
		t.Fatal(err)
	}
	defer syscall.Close(fd[0])
	defer syscall.Close(fd[1])
	if err := syscall.SetNonblock(fd[0], true); err != nil {
		t.Fatal(err)
	}
	if ready, err := terminalPoll(uintptr(fd[0]), time.Millisecond); err != nil || ready {
		t.Fatal("empty descriptor must return after bounded poll", err)
	}
	if _, err := syscall.Write(fd[1], []byte("synthetic\n")); err != nil {
		t.Fatal(err)
	}
	if ready, err := terminalPoll(uintptr(fd[0]), 10*time.Millisecond); err != nil || !ready {
		t.Fatal("ready descriptor not detected", err)
	}
	var line [256]byte
	if n, err := syscall.Read(fd[0], line[:]); err != nil || string(line[:n]) != "synthetic\n" {
		t.Fatal("descriptor did not return exact available input", err)
	}
	if _, err := syscall.Read(fd[0], line[:]); err != syscall.EAGAIN {
		t.Fatal("nonblocking descriptor could leave a reader behind", err)
	}
}
