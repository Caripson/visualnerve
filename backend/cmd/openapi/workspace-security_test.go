package main

import (
	"reflect"
	"strings"
	"testing"
)

func TestWorkspaceSecurityDiscoverySchemaIsSafeAndVersioned(t *testing.T) {
	schemas := object{}
	addWorkspaceSecuritySchemas(schemas)
	status := schemas["WorkspaceSecurityStatus"].(object)
	if status["additionalProperties"] != false {
		t.Fatal("status must not permit undeclared private metadata")
	}
	props := status["properties"].(object)
	for _, name := range []string{"vaultId", "keyVersion", "epoch", "password", "recoveryKey", "salt", "keys", "token", "idleExpiresAt", "absoluteExpiresAt", "mcpAccess", "policy"} {
		if props[name] != nil {
			t.Fatal("security discovery must not expose private metadata", name)
		}
	}
	for _, name := range []string{"programmaticUnlock", "requestsRenewIdleTimeout"} {
		if !reflect.DeepEqual(props[name].(object)["enum"], []bool{false}) {
			t.Fatal("security behavior is not an external capability", name)
		}
	}
	if !reflect.DeepEqual(props["schemaVersion"].(object)["enum"], []int{1}) || !reflect.DeepEqual(props["vaultSchemaVersion"].(object)["enum"], []int{1}) {
		t.Fatal("status and vault formats must be versioned independently of the logical workspace schema")
	}
	description := status["description"].(string)
	for _, phrase := range []string{"mode:legacy", "423 WORKSPACE_LOCKED", "503", "human", "do not renew idle", "originating", "/settings/vault-*", "readable", "own credentials"} {
		if !strings.Contains(description, phrase) {
			t.Fatal("security discovery contract missing", phrase)
		}
	}
	if props["programmaticLock"].(object)["type"] != "boolean" {
		t.Fatal("encrypted lock capability must be discoverable")
	}
	lockInput := schemas["WorkspaceLockInput"].(object)
	if lockInput["additionalProperties"] != false || len(lockInput["properties"].(object)) != 0 {
		t.Fatal("lock must never accept credentials, policy or force arguments")
	}
	locked := schemas["WorkspaceLockedError"].(object)
	if !reflect.DeepEqual(locked["required"], []string{"error", "code"}) || !reflect.DeepEqual(locked["properties"].(object)["code"].(object)["enum"], []string{"WORKSPACE_LOCKED"}) {
		t.Fatal("locked errors must preserve their semantic code")
	}
}
