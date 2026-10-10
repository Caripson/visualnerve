package main

const collaborationPolicy = "Optional realtime collaboration requires a configured Cloudflare relay and human approval in the browser. API/MCP cannot create/join rooms, issue invitations, approve devices, change roles, obtain keys or unlock a vault. The shared graph uses per-field Yjs updates carried as MLS RFC 9420 application messages with owner-approved devices and owner-signed access policy; this integration is not independently audited. Normal graph CRUD keeps the existing versioned API and requires both a human-approved owner/editor role and the current MCP write grant. Viewers cannot mutate the shared model. Deleting the active shared diagram, clearing/replacing the workspace, or editing/deleting its referenced global owner profiles returns 409 until the room is left; prepare those profiles before joining. Titles, descriptions, graph structure, styles and process assumptions are shared; metadata/source evidence, referenced owner profiles and raw CSV datasets require separate explicit scope choices. Private camera/view filters, folders, favorites, local clocks and unreferenced owner profiles remain local. The relay receives ciphertext and connection/room/device/timing metadata; authorized participants receive readable shared content. Local CRDT state and room associations use a dedicated encrypted vault namespace excluded from settings, native exports and all workspace backups. MLS ratchets and private signing keys remain in live memory only. Reconnect uses the same unlocked live device and exact ciphertext retries; reload/unlock needs a new device and owner approval, and owner reload requires a new room. Lock ends the local collaboration session; later unlock does not restore it. Removing a participant prevents future authorized delivery after the membership change, but cannot recall previously received content. Inspect endpoints expose only current local session state and explicit participant semantics, never invitation links, credentials, relay URLs, key material or raw error text. POST disconnect requires Read + write, leaves only this browser's current session and preserves its local graph. No query parameters or nonempty bodies are accepted."

func collaborationString(value string) object {
	return object{"type": "string", "enum": []string{value}}
}
func collaborationBoolean(value bool) object { return object{"type": "boolean", "enum": []bool{value}} }

func addCollaborationSchemas(schemas object) {
	schemas["CollaborationScope"] = strictObject([]string{"shareMetadata", "shareOwners", "shareDatasets"}, object{
		"shareMetadata": object{"type": "boolean", "description": "Explicit disclosure of custom metadata and retained code/SQL source evidence. Default false."},
		"shareOwners":   object{"type": "boolean", "description": "Explicit disclosure of referenced owner profiles/assignments. Unreferenced owner profiles remain private. Default false."},
		"shareDatasets": object{"type": "boolean", "description": "Explicit disclosure of raw CSV source datasets and their analysis configuration. Default false."},
	})
	schemas["CollaborationParticipant"] = strictObject([]string{"deviceId", "name", "role", "connected", "selectedNodeIds"}, object{
		"deviceId": object{"type": "string", "description": "Opaque approved live device identifier; not a vault credential."},
		"name":     object{"type": "string"}, "role": object{"type": "string", "enum": []string{"owner", "editor", "viewer"}},
		"connected":       object{"type": "boolean"},
		"selectedNodeIds": object{"type": "array", "items": svgExportIdentity()},
		"actor":           object{"type": "string", "enum": []string{"human", "mcp"}},
	})
	schemas["CollaborationSession"] = strictObject([]string{"configured", "status", "scope", "participants", "pendingJoinCount"}, object{
		"configured": object{"type": "boolean"},
		"status":     object{"type": "string", "enum": []string{"idle", "connecting", "awaiting-approval", "syncing", "live", "offline", "conflict", "error"}},
		"roomId":     object{"type": "string", "description": "Opaque public room identifier; no admission capability."},
		"diagramId":  svgExportIdentity(), "selfDeviceId": object{"type": "string"},
		"role":  object{"type": "string", "enum": []string{"owner", "editor", "viewer"}},
		"scope": ref("CollaborationScope"), "participants": object{"type": "array", "items": ref("CollaborationParticipant")},
		"pendingJoinCount": object{"type": "integer", "minimum": 0},
		"syncProgress":     strictObject([]string{"completed", "total"}, object{"completed": object{"type": "integer", "minimum": 0}, "total": object{"type": "integer", "minimum": 0}}),
	})
	schemas["CollaborationSession"].(object)["description"] = collaborationPolicy
	schemas["CollaborationDisconnectInput"] = strictObject([]string{}, object{})
	schemas["CollaborationDisconnected"] = strictObject([]string{"diagramId", "status"}, object{"diagramId": svgExportIdentity(), "status": collaborationString("disconnected")})
	limits := object{}
	for field, value := range map[string]int{
		"nodes": 20000, "edges": 100000, "owners": 20000, "jsonBytes": 16 * 1024 * 1024,
		"updateBytes": 8 * 1024 * 1024, "stateBytes": 32 * 1024 * 1024, "fields": 1000000, "depth": 48,
		"vectorBytes": 64 * 1024, "actors": 4096, "frameBytes": 64 * 1024, "chunkBytes": 32 * 1024,
		"messageBytes": 32 * 1024 * 1024, "activeMessages": 8, "totalBufferedBytes": 32 * 1024 * 1024,
		"parts": 2048, "timeoutMs": 60000, "replayIds": 256,
		"compressedPayloadBytes": 3 * 1024 * 1024, "plaintextPayloadBytes": 64 * 1024 * 1024,
	} {
		limits[field] = svgExportConstant(value, "Independent client-side bounded collaboration budget; exceeding it rejects rather than truncates the shared model.")
	}
	limits["updateBytes"].(object)["description"] = "Maximum causal incremental delta: 8 MiB. Nonempty base vectors retain this bound."
	limits["stateBytes"].(object)["description"] = "Maximum encoded CRDT state and full-state refresh: 32 MiB. The existing update envelope uses canonical empty baseVector [0] for a full-state refresh; the same authenticated sender, sharing scope, actor and semantic model validation applies."
	limitRequired := []string{"nodes", "edges", "owners", "jsonBytes", "updateBytes", "stateBytes", "fields", "depth", "vectorBytes", "actors", "frameBytes", "chunkBytes", "messageBytes", "activeMessages", "totalBufferedBytes", "parts", "timeoutMs", "replayIds", "compressedPayloadBytes", "plaintextPayloadBytes"}
	schemas["CollaborationLimits"] = strictObject(limitRequired, limits)
	schemas["CollaborationCapabilities"] = strictObject([]string{"schemaVersion", "protocol", "configured", "execution", "transport", "sharedModel", "encryption", "authentication", "roles", "controls", "storage", "recovery", "assurance", "requiresConfiguredRelay", "limits"}, object{
		"schemaVersion": svgExportConstant(1, "Collaboration semantic API schema, separate from native graph/vault schemas."),
		"protocol":      svgExportConstant(1, "Application sharing/framing protocol version."), "configured": object{"type": "boolean"},
		"execution": collaborationString("browser-local"), "transport": collaborationString("cloudflare-durable-object-websocket"),
		"sharedModel": collaborationString("yjs-per-field"), "encryption": collaborationString("mls-rfc9420"),
		"authentication": collaborationString("owner-approved-device-and-owner-signed-acl"),
		"roles":          object{"type": "array", "minItems": 3, "maxItems": 3, "uniqueItems": true, "items": object{"type": "string", "enum": []string{"owner", "editor", "viewer"}}},
		"controls": strictObject([]string{"inspect", "existingGraphCrud", "disconnect", "create", "join", "invite", "approve", "unlock"}, object{
			"inspect": collaborationBoolean(true), "existingGraphCrud": collaborationBoolean(true), "disconnect": collaborationBoolean(true),
			"create": collaborationBoolean(false), "join": collaborationBoolean(false), "invite": collaborationBoolean(false), "approve": collaborationBoolean(false), "unlock": collaborationBoolean(false),
		}),
		"storage":   strictObject([]string{"workspace", "privateState", "mlsSecrets"}, object{"workspace": collaborationString("encrypted-indexeddb"), "privateState": collaborationString("non-exported-encrypted-vault"), "mlsSecrets": collaborationString("live-memory-only")}),
		"recovery":  strictObject([]string{"reconnect", "reload", "ownerReload"}, object{"reconnect": collaborationString("same-unlocked-live-device"), "reload": collaborationString("fresh-device-owner-approval"), "ownerReload": collaborationString("new-room")}),
		"assurance": collaborationString("not-independently-audited"), "requiresConfiguredRelay": collaborationBoolean(true), "limits": ref("CollaborationLimits"),
	})
	schemas["CollaborationCapabilities"].(object)["description"] = collaborationPolicy
}

func addCollaborationPaths(add func(string, string, string, string, string, string), paths object) {
	add("GET", "/collaboration/capabilities", "Discover optional collaboration configuration, semantic controls and security boundaries", "", "CollaborationCapabilities", "200")
	add("GET", "/collaboration/sessions", "Inspect current browser-local collaboration sessions without credentials", "", "CollaborationSession[]", "200")
	add("GET", "/diagrams/{diagramId}/collaboration", "Inspect one diagram's current local sharing state, or idle if not connected", "", "CollaborationSession", "200")
	add("POST", "/diagrams/{diagramId}/collaboration/disconnect", "Leave this browser's collaboration session while preserving the local graph", "CollaborationDisconnectInput", "CollaborationDisconnected", "200")
	for _, path := range []string{"/collaboration/capabilities", "/collaboration/sessions", "/diagrams/{diagramId}/collaboration", "/diagrams/{diagramId}/collaboration/disconnect"} {
		for _, raw := range paths[path].(object) {
			raw.(object)["description"] = collaborationPolicy
		}
	}
	disconnect := paths["/diagrams/{diagramId}/collaboration/disconnect"].(object)["post"].(object)
	disconnect["requestBody"].(object)["required"] = false
}
