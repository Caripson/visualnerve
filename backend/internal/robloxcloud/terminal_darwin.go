//go:build darwin

package robloxcloud

import (
	"syscall"
	"time"
	"unsafe"
)

func terminalCheck(fd uintptr) error {
	var state syscall.Termios
	_, _, err := syscall.Syscall(syscall.SYS_IOCTL, fd, syscall.TIOCGETA, uintptr(unsafe.Pointer(&state)))
	if err != 0 {
		return err
	}
	return nil
}
func terminalFlush(fd uintptr) error {
	which := int32(1) // FREAD: flush pending terminal input, not output.
	_, _, err := syscall.Syscall(syscall.SYS_IOCTL, fd, syscall.TIOCFLUSH, uintptr(unsafe.Pointer(&which)))
	if err != 0 {
		return err
	}
	return nil
}
func terminalPoll(fd uintptr, timeout time.Duration) (bool, error) {
	value := terminalPollFD{fd: int32(fd), events: 1}
	n, _, err := syscall.Syscall(syscall.SYS_POLL, uintptr(unsafe.Pointer(&value)), 1, uintptr(timeout.Milliseconds()))
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
