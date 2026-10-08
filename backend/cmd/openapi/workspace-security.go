package main

const workspaceSecurityPolicyDescription = "GET /workspace/security reports safe versioned metadata for the connected browser's actual storage backend without reading private records or unlocking it. Encrypted app workspaces use AES-256-GCM in IndexedDB and require a human password/recovery action in the browser; existing legacy workspaces are explicitly mode:legacy. Logical workspace schemaVersion 8 is separate from vault schemaVersion 1. Private UI/API/MCP operations share the same revocable unlocked-session storage boundary. An already authorized live socket remains restricted to safe status while locked; it is not reconnected after closure. Cold locked startup creates no connection. Connected locked content requests return 423 WORKSPACE_LOCKED; an absent/disconnected browser remains 503. API/MCP requests do not renew idle timeout. Lock cancels jobs and invalidates originating requests, even after a later unlock. POST /workspace/lock accepts only an empty object or no arguments. It requires current fresh Read + write access while unlocked, waits for pending saves, and returns safe status after revocation; save failure does not silently discard edits. A durable revision fence rejects concurrent grant or saved-data changes with 409 without invalidating local keys; inspect current state before a fresh request. A locked retained connection returns idempotent status without revoking again; after unlock a fresh human grant is required. There are no password, recovery, unlock or session-policy control endpoints; /settings/vault-* writes are rejected. Documentation discovery through visual_nerve_api_docs and MCP resources needs no connected/unlocked browser. Explicit authorized API/AI requests and diagram exports return readable content; GET /workspace/export is a readable semantic WorkspaceBackup, not the browser's encrypted backup download. Downloaded encrypted backups retain their own credentials after the live workspace password changes."

const workspaceSecurityReauthorizationDescription = " After each encrypted-session unlock access starts Off; the human must choose a fresh Read only or Read + write grant in Settings."

func workspaceSecuritySchema() object {
	return strictObject([]string{"type", "schemaVersion", "mode", "state", "storage", "logicalSchemaVersion", "requiresHumanUnlock", "programmaticUnlock", "programmaticLock", "requestsRenewIdleTimeout", "contentRequiresUnlock"}, object{
		"type":                     object{"type": "string", "enum": []string{"workspace-security"}},
		"schemaVersion":            object{"type": "integer", "enum": []int{1}},
		"mode":                     object{"type": "string", "enum": []string{"encrypted", "legacy"}},
		"state":                    object{"type": "string", "enum": []string{"uninitialized", "locked", "unlocking", "unlocked", "legacy"}, "description": "Current in-memory browser session state. Uninitialized means this session has not yet initialized its vault; it does not identify a missing persisted vault."},
		"storage":                  object{"type": "string", "enum": []string{"indexeddb"}},
		"logicalSchemaVersion":     object{"type": "integer", "minimum": 1, "description": "Shared logical workspace schema; currently 8, independently of vault physical format."},
		"vaultSchemaVersion":       object{"type": "integer", "enum": []int{1}, "description": "Present only for the encrypted backend."},
		"cipher":                   object{"type": "string", "enum": []string{"AES-256-GCM"}, "description": "Present only for the encrypted backend."},
		"requiresHumanUnlock":      object{"type": "boolean"},
		"programmaticLock":         object{"type": "boolean", "description": "Encrypted backends support explicit POST /workspace/lock, with a fresh Read + write grant while unlocked."},
		"programmaticUnlock":       object{"type": "boolean", "enum": []bool{false}},
		"requestsRenewIdleTimeout": object{"type": "boolean", "enum": []bool{false}},
		"contentRequiresUnlock":    object{"type": "boolean", "description": "Encrypted content also requires the existing browser storage acceptance and external access grant. This response never grants content access."},
	})
}

func addWorkspaceSecuritySchemas(schemas object) {
	schemas["WorkspaceLockInput"] = strictObject([]string{}, object{})
	schemas["WorkspaceSecurityStatus"] = workspaceSecuritySchema()
	schemas["WorkspaceSecurityStatus"].(object)["description"] = workspaceSecurityPolicyDescription + workspaceSecurityReauthorizationDescription
	schemas["WorkspaceLockedError"] = strictObject([]string{"error", "code"}, object{
		"error": object{"type": "string"},
		"code":  object{"type": "string", "enum": []string{"WORKSPACE_LOCKED"}},
	})
}
