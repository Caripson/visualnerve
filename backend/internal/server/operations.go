package server

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"
)

const (
	bridgeVersion       = "0.7.0"
	operationRetention  = 15 * time.Minute
	maxBridgeOperations = 1024
	maxPendingCommands  = 256
)

var bridgeCapabilities = []string{"operations-v1", "endpoint-docs-v1", "fork-join-v1", "async-svg-export-v1", "exchange-export-v1", "collaboration-v1"}
var bridgeToolNames = []string{"visual_nerve_request", "visual_nerve_api_docs"}

// The bridge retains only opaque routing/correlation metadata. Request and result
// bodies remain in the authorized browser; this map is never persisted to disk.
type bridgeOperation struct {
	id                          string
	workspace, origin           string
	instanceID, grantID         string
	fingerprint                 [32]byte
	bound, dispatched, terminal bool
	created, completed          time.Time
}

func randomIdentifier() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		panic("secure random identifiers are unavailable")
	}
	return hex.EncodeToString(value[:])
}

func validAuthorityID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for i, c := range value {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
		} else if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

func operationFailure(status int, code, id, message string) reply {
	body := map[string]any{"error": message, "code": code, "state": "unknown"}
	if id != "" {
		body["operationId"] = id
	}
	encoded, _ := json.Marshal(body)
	return reply{Status: status, Body: encoded, OperationID: id}
}

func (operation *bridgeOperation) matches(p *peer) bool {
	return operation.workspace == p.workspace && operation.origin == p.origin &&
		operation.instanceID == p.instanceID && operation.grantID == p.grantID
}

func operationFingerprint(path, method string, data json.RawMessage) [32]byte {
	canonical := []byte("<absent>")
	if len(data) != 0 {
		decoder := json.NewDecoder(bytes.NewReader(data))
		decoder.UseNumber()
		var value any
		if decoder.Decode(&value) == nil {
			canonical, _ = json.Marshal(value)
		} else {
			canonical = data
		}
	}
	value := append([]byte(method+"\n"+path+"\n"), canonical...)
	return sha256.Sum256(value)
}

func (operation *bridgeOperation) bind(path, method string, data json.RawMessage) *reply {
	fingerprint := operationFingerprint(path, method, data)
	if operation.bound && fingerprint != operation.fingerprint {
		failure := operationFailure(409, "OPERATION_CONFLICT", operation.id, "This operation ID is already bound to a different method, path or payload. Never change the payload when retrying a write.")
		return &failure
	}
	operation.fingerprint, operation.bound = fingerprint, true
	return nil
}

// The process nonce makes bridge restarts explicit. An old, evicted, expired or
// invented token is never interpreted as permission to execute a new write.
func (s *Server) operationLocked(id string) (*bridgeOperation, *reply) {
	parts := strings.Split(id, ".")
	if len(parts) != 3 || parts[0] != "vnop1" || len(parts[1]) != 32 || len(parts[2]) != 32 {
		failure := operationFailure(422, "INVALID_OPERATION_ID", id, "Reserve an operation ID with POST /operations before supplying it on a write.")
		return nil, &failure
	}
	for _, part := range parts[1:] {
		if _, err := hex.DecodeString(part); err != nil {
			failure := operationFailure(422, "INVALID_OPERATION_ID", id, "The operation ID is malformed.")
			return nil, &failure
		}
	}
	if parts[1] != s.operationEpoch {
		failure := operationFailure(409, "OPERATION_OUTCOME_UNKNOWN", id, "This ID belongs to another bridge process. The bridge may have restarted; reconcile the model before creating a new operation.")
		return nil, &failure
	}
	operation := s.operations[id]
	if operation == nil {
		failure := operationFailure(410, "OPERATION_EXPIRED", id, "This operation is no longer retained. Its outcome cannot be recovered; reconcile the model before creating a new operation.")
		return nil, &failure
	}
	return operation, nil
}

func (s *Server) pruneOperationsLocked(now time.Time) {
	for id, operation := range s.operations {
		retainedSince := operation.created
		if !operation.completed.IsZero() {
			retainedSince = operation.completed
		}
		if now.Sub(retainedSince) < operationRetention {
			continue
		}
		active := false
		for p := range s.peers {
			for transportID, pending := range p.pending {
				if pending.operation != operation {
					continue
				}
				if pending.response != nil {
					active = true
				} else {
					delete(p.pending, transportID)
				}
			}
		}
		if !active {
			delete(s.operations, id)
		}
	}
}

func (s *Server) newOperationLocked(selected *peer) (*bridgeOperation, *reply) {
	if len(s.operations) >= maxBridgeOperations {
		// Refuse new work rather than evict an ambiguous operation and execute a
		// retry as fresh. Explicitly reserved IDs continue to work at the limit.
		failure := operationFailure(429, "OPERATION_LIMIT", "", "The bridge operation retention limit is full. Wait for retained operations to expire before starting new writes.")
		return nil, &failure
	}
	operation := &bridgeOperation{
		id:        "vnop1." + s.operationEpoch + "." + randomIdentifier(),
		workspace: selected.workspace, origin: selected.origin,
		instanceID: selected.instanceID, grantID: selected.grantID,
		created: time.Now(),
	}
	s.operations[operation.id] = operation
	return operation, nil
}

func (s *Server) prepareOperationLocked(workspace, path, method string, data json.RawMessage, id string) (*bridgeOperation, string, *reply) {
	s.pruneOperationsLocked(time.Now())
	action := "execute"
	if method == "GET" {
		action = ""
	}
	if path == "/operations" {
		var empty map[string]json.RawMessage
		if method != "POST" || len(bytes.TrimSpace(data)) == 0 || bytes.TrimSpace(data)[0] != '{' || json.Unmarshal(data, &empty) != nil || len(empty) != 0 {
			failure := operationFailure(422, "INVALID_OPERATION_RESERVATION", id, "Reserve an operation with POST /operations and exactly {}.")
			return nil, "", &failure
		}
		action = "reserve"
	} else if strings.HasPrefix(path, "/operations/") {
		if method != "GET" || (id != "" && id != strings.TrimPrefix(path, "/operations/")) {
			failure := operationFailure(422, "INVALID_OPERATION_STATUS", id, "Inspect an operation with GET /operations/{operationId} and no conflicting operation header.")
			return nil, "", &failure
		}
		id = strings.TrimPrefix(path, "/operations/")
		action = "status"
	} else if method == "GET" && id != "" {
		failure := operationFailure(422, "INVALID_OPERATION_READ", id, "Operation IDs belong to writes; use GET /operations/{operationId} to inspect one.")
		return nil, "", &failure
	}
	if id == "" {
		return nil, action, nil
	}
	operation, failure := s.operationLocked(id)
	if failure != nil {
		return nil, action, failure
	}
	if workspace != "" && workspace != operation.workspace {
		failure := operationFailure(409, "OPERATION_SCOPE_MISMATCH", id, "The operation belongs to a different workspace.")
		return nil, action, &failure
	}
	return operation, action, nil
}
