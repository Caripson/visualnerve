//go:build !darwin && !(linux && (amd64 || arm64 || 386))

package robloxcloud

import (
	"errors"
	"os"
)

func NewTerminalApprover(*os.File) (*TerminalApprover, error) {
	return nil, errors.New("optional Roblox publication requires a supported interactive macOS/Linux terminal; Studio export remains available")
}
