package main

import (
	"context"
	"fmt"
	"os"
	"visualnerve/internal/robloxcloud"
	"visualnerve/internal/server"
)

// Validate the independent interactive boundary before accessing credentials.
// The getenv injection is a unit-test seam, never an integration command field.
func optionalRobloxPublisher(bridge bool, stdin *os.File, getenv func(string) string) (server.RobloxPublisher, func(context.Context, robloxcloud.Approval) bool, func() error, error) {
	if getenv("VISUAL_NERVE_ROBLOX_PUBLISH_ENABLED") != "true" {
		return nil, nil, nil, nil
	}
	if !bridge {
		return nil, nil, nil, fmt.Errorf("optional Roblox publication requires an interactive local --bridge terminal")
	}
	terminal, err := robloxcloud.NewTerminalApprover(stdin)
	if err != nil {
		return nil, nil, nil, err
	}
	publisher, err := robloxcloud.New(getenv("VISUAL_NERVE_ROBLOX_API_KEY"), getenv("VISUAL_NERVE_ROBLOX_UNIVERSE_ID"), getenv("VISUAL_NERVE_ROBLOX_PLACE_ID"))
	if err != nil {
		terminal.Close()
		return nil, nil, nil, fmt.Errorf("optional Roblox publisher: %w", err)
	}
	return publisher, terminal.Approve, terminal.Close, nil
}
