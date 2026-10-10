package main

const operationPolicyDescription = "Recoverable write operations use a server-issued opaque operationId, not a graph UUID. POST /operations with exactly {} reserves an ID before submitting a write. Pass it in X-Visual-Nerve-Operation-Id for REST or the operationId argument of visual_nerve_request for MCP. Successful command bodies remain unchanged; the response header or MCP structuredContent.operationId identifies the operation. GET /operations/{operationId} reads the original browser's receipt. Reuse the same ID only with the exact method, path and JSON data, including absent versus null; conflicting reuse returns 409 OPERATION_CONFLICT. A timeout or lost acknowledgement after dispatch returns OPERATION_OUTCOME_UNKNOWN with state:unknown: the write may still commit. Inspect that operation or retry the identical command with the same ID, never blindly repeat it under a new ID. Identity is bound to the original workspace, origin, browser instance and access grant; another tab or grant cannot reroute it. Bridge restart returns 409 OPERATION_OUTCOME_UNKNOWN; expired receipts return 410 OPERATION_EXPIRED. Reconcile saved model state manually before fresh work when recovery is unavailable. Browser-only transient receipts are bounded to 15 minutes, 256 entries and 8 MiB of readable results; bridge RAM retains only opaque routing/fingerprint metadata, bounded to 15 minutes and 1024 entries. Nothing is persisted to IndexedDB or the server's disk. Lock, reload, grant revocation or storage loss can remove recovery data. Older browser tabs without operations-v1 remain one-shot and cannot reserve/recover IDs: refresh the browser and use a current bridge. Check bridge health/version/capabilities; static health contains no workspace records or grants."

var operationResponseNames = map[string]string{
	"409": "OperationConflict", "410": "OperationExpired", "422": "OperationValidation",
	"426": "OperationProtocolRequired", "429": "OperationLimit", "502": "OperationInvalidAcknowledgment", "503": "OperationUnavailable", "504": "OperationTimeout",
}

func bridgeResponses() object {
	responses := simulationResponses()
	for code, description := range map[string]string{
		"409": "Version/identity conflict, conflicting operation reuse, or recovery unavailable after a bridge restart or authority change; inspect the semantic code",
		"410": "Operation receipt expired or no longer retained; reconcile saved model state before new work",
		"422": "Invalid command/model or malformed/conflicting operation identity; no partial validation writes",
		"426": "The connected browser does not support operation recovery; refresh the tab and current bridge",
		"429": "Bounded bridge operation/pending-command limit reached; inspect existing work before retrying",
		"502": "Invalid browser acknowledgment after dispatch; OPERATION_OUTCOME_UNKNOWN means the write may have committed",
		"503": "Browser unavailable, browser receipt limit reached, or dispatch could not be acknowledged; a dispatched write may have unknown outcome",
		"504": "Browser deadline exceeded; OPERATION_OUTCOME_UNKNOWN means the write may still commit",
	} {
		responses[operationResponseNames[code]] = object{"description": description, "content": object{"application/json": object{"schema": object{"anyOf": []any{ref("Error"), ref("OperationError")}}}}}
	}
	return responses
}

func operationIDSchema() object {
	return object{"type": "string", "minLength": 1, "description": "Opaque server-issued operation token returned by POST /operations or an earlier write. Not a graph UUID; never invent or alter it."}
}

func addOperationSchemas(schemas object) {
	schemas["OperationReservationInput"] = strictObject(nil, object{})
	schemas["OperationReservationInput"].(object)["description"] = "Exactly {}. Requires a connected, unlocked browser with accepted storage and Read + write access. Reserves recoverable transport identity before submitting the actual write."
	properties := object{
		"operationId":     operationIDSchema(),
		"state":           object{"type": "string", "enum": []string{"reserved", "running", "succeeded", "failed", "unknown"}},
		"status":          object{"type": "integer", "minimum": 200, "maximum": 599, "description": "Original command HTTP status, when a terminal response was received."},
		"resultAvailable": object{"type": "boolean", "description": "Whether the browser still retains the original command result within its bounded transient receipt cache."},
		"result":          object{"description": "Original readable command body, present only when resultAvailable is true. Its schema is the response schema of the originating command."},
	}
	schemas["OperationStatus"] = strictObject([]string{"operationId", "state", "resultAvailable"}, properties)
	schemas["OperationStatus"].(object)["description"] = operationPolicyDescription
	properties["state"].(object)["description"] = "failed means the browser command returned an error; it does not prove rollback of all multi-phase runtime side effects. Receipts provide at-most-once command execution within their retained browser/grant scope, not exactly-once transactions across page or bridge lifetimes."
	errorProperties := clone(properties)
	errorProperties["error"] = object{"type": "string"}
	errorProperties["code"] = object{"type": "string", "description": "Semantic transport/recovery code, such as OPERATION_OUTCOME_UNKNOWN, OPERATION_CONFLICT, OPERATION_EXPIRED, OPERATION_RESULT_UNAVAILABLE or OPERATION_PROTOCOL_REQUIRED."}
	schemas["OperationError"] = strictObject([]string{"error", "code"}, errorProperties)
}

func addOperationPaths(add func(string, string, string, string, string, string), paths object, schemas object) {
	add("POST", "/operations", "Reserve a recoverable browser write operation", "OperationReservationInput", "OperationStatus", "201")
	add("GET", "/operations/{operationId}", "Inspect an operation in its original browser and access grant", "", "OperationStatus", "200")
	statusOperation := paths["/operations/{operationId}"].(object)["get"].(object)
	statusOperation["parameters"] = []any{object{"name": "operationId", "in": "path", "required": true, "schema": operationIDSchema()}}
	for _, path := range []string{"/operations", "/operations/{operationId}"} {
		for _, raw := range paths[path].(object) {
			raw.(object)["description"] = operationPolicyDescription
		}
	}
	health := schemas["Health"].(object)["properties"].(object)
	health["tools"] = object{"type": "array", "items": object{"type": "string"}, "description": "MCP tool names provided by this bridge, currently visual_nerve_request and visual_nerve_api_docs."}
	health["capabilities"] = object{"type": "array", "items": object{"type": "string"}, "description": "Supported bridge capabilities. Version 0.7.0 advertises operations-v1, endpoint-docs-v1, fork-join-v1, async-svg-export-v1, exchange-export-v1 and collaboration-v1; this is software discovery, not permission or workspace status."}
	for path, raw := range paths {
		for method, raw := range raw.(object) {
			op := raw.(object)
			if method == "get" && path != "/operations/{operationId}" {
				continue
			}
			if method != "get" {
				parameters, _ := op["parameters"].([]any)
				op["parameters"] = append(parameters, object{"name": "X-Visual-Nerve-Operation-Id", "in": "header", "required": false, "schema": operationIDSchema(), "description": "Optional reserved operation identity for this non-GET command. Reuse only for the same method, path and exact JSON data. Omit on initial POST /operations reservation."})
			}
			responses := op["responses"].(object)
			for _, status := range []string{"200", "201", "204"} {
				if success, ok := responses[status].(object); ok {
					success["headers"] = object{"X-Visual-Nerve-Operation-Id": object{"description": "Server-issued identity for this operation when the current browser supports recoverable operations. Successful response bodies are unchanged.", "schema": operationIDSchema()}}
				}
			}
			for code, name := range operationResponseNames {
				responses[code] = object{"$ref": "#/components/responses/" + name}
			}
		}
	}
}
