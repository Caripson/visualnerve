package main

import (
	"os"
	"strings"
	"testing"
)

func TestOptionalPublisherCannotReadCredentialsOrEnableWithoutInteractiveStdin(t *testing.T) {
	file, err := os.CreateTemp(t.TempDir(), "synthetic-non-tty")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	for _, enabled := range []string{"", "false", "true"} {
		reads := []string{}
		getenv := func(key string) string {
			reads = append(reads, key)
			if key == "VISUAL_NERVE_ROBLOX_PUBLISH_ENABLED" {
				return enabled
			}
			t.Fatal("non-TTY or disabled publisher accessed a credential")
			return ""
		}
		publisher, approval, cleanup, err := optionalRobloxPublisher(true, file, getenv)
		if publisher != nil || approval != nil || cleanup != nil || len(reads) != 1 {
			t.Fatal("disabled/noninteractive publisher acquired authority")
		}
		if enabled == "true" && (err == nil || !strings.Contains(err.Error(), "terminal")) || enabled != "true" && err != nil {
			t.Fatal("noninteractive configuration did not fail closed with clear guidance", err)
		}
	}
	if _, _, _, err := optionalRobloxPublisher(false, file, func(string) string { return "true" }); err == nil {
		t.Fatal("publication enabled without a local bridge")
	}
}
