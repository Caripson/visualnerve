//go:build darwin || (linux && (amd64 || arm64 || 386))

package robloxcloud

import (
	"errors"
	"os"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

type nativeTerminal struct {
	fd     int
	mu     sync.Mutex
	closed bool
}
type terminalPollFD struct {
	fd              int32
	events, revents int16
}

// Reopen the controlling terminal independently in nonblocking mode. Never
// change the inherited stdin descriptor or consume MCP stdio/pipe input.
func NewTerminalApprover(stdin *os.File) (*TerminalApprover, error) {
	var input int
	var inputErr error
	if stdin != nil {
		raw, err := stdin.SyscallConn()
		inputErr = err
		if err == nil {
			controlErr := raw.Control(func(fd uintptr) {
				inputErr = terminalCheck(fd)
				if inputErr == nil {
					input, inputErr = terminalForeground(fd)
				}
			})
			if controlErr != nil {
				inputErr = controlErr
			}
		}
	}
	if stdin == nil || inputErr != nil {
		return nil, errors.New("optional Roblox publication requires interactive terminal stdin; use Studio export when running without a TTY")
	}
	fd, err := syscall.Open("/dev/tty", syscall.O_RDWR|syscall.O_NONBLOCK|syscall.O_NOCTTY|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, errors.New("optional Roblox publication requires a controlling interactive terminal")
	}
	control, controlErr := terminalForeground(uintptr(fd))
	if inputErr != nil || controlErr != nil || input != control || control != syscall.Getpgrp() || terminalCheck(uintptr(fd)) != nil {
		syscall.Close(fd)
		return nil, errors.New("optional Roblox publication requires foreground stdin on the controlling terminal")
	}
	terminal := &nativeTerminal{fd: fd}
	if terminal.flush() != nil {
		syscall.Close(fd)
		return nil, errors.New("the controlling terminal cannot safely reset publication input")
	}
	return &TerminalApprover{io: terminal, gate: make(chan struct{}, 1)}, nil
}

func terminalForeground(fd uintptr) (int, error) {
	var group int32
	_, _, err := syscall.Syscall(syscall.SYS_IOCTL, fd, syscall.TIOCGPGRP, uintptr(unsafe.Pointer(&group)))
	if err != 0 {
		return 0, err
	}
	return int(group), nil
}

func (t *nativeTerminal) foreground() error {
	if t.closed {
		return syscall.EBADF
	}
	group, err := terminalForeground(uintptr(t.fd))
	if err != nil {
		return err
	}
	if group != syscall.Getpgrp() {
		return syscall.EIO
	}
	return nil
}

func (t *nativeTerminal) flush() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if err := t.foreground(); err != nil {
		return err
	}
	return terminalFlush(uintptr(t.fd))
}
func (t *nativeTerminal) poll(timeout time.Duration) (bool, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if err := t.foreground(); err != nil {
		return false, err
	}
	return terminalPoll(uintptr(t.fd), timeout)
}
func (t *nativeTerminal) read(value []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if err := t.foreground(); err != nil {
		return 0, err
	}
	return syscall.Read(t.fd, value)
}
func (t *nativeTerminal) write(value []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if err := t.foreground(); err != nil {
		return 0, err
	}
	return syscall.Write(t.fd, value)
}
func (t *nativeTerminal) close() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return nil
	}
	t.closed = true
	return syscall.Close(t.fd)
}
