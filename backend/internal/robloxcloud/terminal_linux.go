//go:build linux && (amd64 || arm64 || 386)

package robloxcloud

import (
	"syscall"
	"time"
	"unsafe"
)

func terminalCheck(fd uintptr) error {
	var state syscall.Termios
	_, _, err := syscall.Syscall(syscall.SYS_IOCTL, fd, syscall.TCGETS, uintptr(unsafe.Pointer(&state)))
	if err != 0 {
		return err
	}
	return nil
}
func terminalFlush(fd uintptr) error {
	_, _, err := syscall.Syscall(syscall.SYS_IOCTL, fd, 0x540b, syscall.TCIFLUSH)
	if err != 0 {
		return err
	}
	return nil // TCFLSH on the supported Linux architectures.
}
func terminalPoll(fd uintptr, timeout time.Duration) (bool, error) {
	value := terminalPollFD{fd: int32(fd), events: 1}
	duration := syscall.NsecToTimespec(timeout.Nanoseconds())
	n, _, err := syscall.Syscall6(syscall.SYS_PPOLL, uintptr(unsafe.Pointer(&value)), 1, uintptr(unsafe.Pointer(&duration)), 0, 0, 0)
	if err == syscall.EINTR {
		return false, nil
	}
	if err != 0 {
		return false, err
	}
	if value.revents&0x38 != 0 {
		return false, syscall.EIO
	}
	return n > 0 && value.revents&1 != 0, nil
}
