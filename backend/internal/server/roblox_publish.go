package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"time"
	"visualnerve/internal/model"
	"visualnerve/internal/robloxcloud"

	"github.com/coder/websocket/wsjson"
)

const robloxChunkBytes = 64 * 1024
const robloxPreparation = 60 * time.Second
const robloxOwnerLimit = 64
const robloxReceiptRetention = 15 * time.Minute
const robloxPendingByteLimit = 32 * 1024 * 1024

type RobloxPublisher interface {
	Target() robloxcloud.Target
	Publish(context.Context, []byte, string) robloxcloud.Result
}

type robloxOwner struct{ workspace, origin, instance string }
type robloxPublishRequest struct {
	Type              string          `json:"type"`
	RequestID         string          `json:"requestId"`
	BrowserInstanceID string          `json:"browserInstanceId"`
	AccessGrantID     string          `json:"accessGrantId"`
	Action            string          `json:"action"`
	Data              json.RawMessage `json:"data"`
}
type robloxPublishError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
type robloxPublishReceipt struct {
	Nonce                           string              `json:"nonce"`
	State                           string              `json:"state"`
	Target                          robloxcloud.Target  `json:"target"`
	SHA256                          string              `json:"sha256"`
	TotalBytes                      int                 `json:"totalBytes"`
	ReceivedBytes                   int                 `json:"receivedBytes"`
	NextIndex                       int                 `json:"nextIndex"`
	ExpiresAt                       string              `json:"expiresAt"`
	RequiresDashboardReconciliation bool                `json:"requiresDashboardReconciliation"`
	VersionNumber                   int64               `json:"versionNumber,omitempty"`
	Error                           *robloxPublishError `json:"error,omitempty"`
}
type robloxPublication struct {
	receipt     robloxPublishReceipt
	peer        *peer
	grant       string
	buffer      []byte
	expires     time.Time
	timer       *time.Timer
	cancel      context.CancelFunc
	finished    time.Time
	reserved    int
	diagramID   string
	baseVersion int64
}

func ownerOf(p *peer) robloxOwner      { return robloxOwner{p.workspace, p.origin, p.instanceID} }
func validMCPAccess(value string) bool { return value == "off" || value == "read" || value == "write" }

func strictRobloxJSON(data json.RawMessage, target any) error {
	if len(data) == 0 || len(data) > 96*1024 || !json.Valid(data) || bytes.TrimSpace(data)[0] != '{' {
		return errors.New("use an exact command object")
	}
	if uniqueRobloxKeys(json.NewDecoder(bytes.NewReader(data)), 0) != nil {
		return errors.New("duplicate or deeply nested publication fields are unsupported")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return errors.New("unsupported or malformed publication fields")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return errors.New("use one command object")
	}
	return nil
}

func uniqueRobloxKeys(decoder *json.Decoder, depth int) error {
	if depth > 8 {
		return errors.New("depth")
	}
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delim, compound := token.(json.Delim)
	if !compound {
		return nil
	}
	if delim == '{' {
		seen := map[string]bool{}
		for decoder.More() {
			key, err := decoder.Token()
			name, valid := key.(string)
			if err != nil || !valid || seen[name] {
				return errors.New("duplicate key")
			}
			seen[name] = true
			if err := uniqueRobloxKeys(decoder, depth+1); err != nil {
				return err
			}
		}
	} else if delim == '[' {
		for decoder.More() {
			if err := uniqueRobloxKeys(decoder, depth+1); err != nil {
				return err
			}
		}
	} else {
		return errors.New("delimiter")
	}
	_, err = decoder.Token()
	return err
}

func robloxFailure(code, message string) map[string]string {
	return map[string]string{"code": code, "error": message}
}

func (s *Server) robloxCapabilities() map[string]any {
	configured := s.config.RobloxPublisher != nil && s.config.RobloxApproval != nil
	value := map[string]any{"configured": configured, "terminalApprovalRequired": true, "limits": map[string]any{
		"chunkBytes": robloxChunkBytes, "artifactBytes": robloxcloud.MaxPlaceBytes, "pendingPerPeer": 1,
		"retainedOwners": robloxOwnerLimit, "pendingBytes": robloxPendingByteLimit, "preparationMs": robloxPreparation.Milliseconds(), "approvalMs": robloxcloud.ApprovalDeadline.Milliseconds(), "networkMs": robloxcloud.NetworkDeadline.Milliseconds(),
	}}
	if configured {
		value["target"] = s.config.RobloxPublisher.Target()
	}
	return value
}

// Only this original, currently content-enabled grant can receive an async result.
func (s *Server) robloxReply(p *peer, request robloxPublishRequest, status int, body any) {
	s.mu.Lock()
	current := s.peers[p] && p.mode != "control" && p.instanceID == request.BrowserInstanceID && p.grantID == request.AccessGrantID
	s.mu.Unlock()
	if !current {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = wsjson.Write(ctx, p.conn, map[string]any{"type": "roblox-publish-result", "requestId": request.RequestID, "status": status, "body": body})
}

func (s *Server) destroyRobloxLocked(publication *robloxPublication, code, message string) {
	if publication.timer != nil {
		publication.timer.Stop()
	}
	clear(publication.buffer)
	publication.buffer = nil
	if publication.cancel != nil {
		publication.cancel()
	}
	if publication.receipt.State == "publishing" || publication.receipt.State == "unknown" {
		publication.receipt.State = "unknown"
		publication.receipt.RequiresDashboardReconciliation = true
		publication.receipt.Error = &robloxPublishError{"ROBLOX_PUBLISH_OUTCOME_UNKNOWN", "Publication may have committed. Inspect Creator Dashboard version history before acknowledging this outcome."}
	} else if publication.receipt.State == "receiving" || publication.receipt.State == "awaiting-approval" {
		s.releaseRobloxBytesLocked(publication)
		publication.receipt.State = "cancelled"
		publication.receipt.Error = &robloxPublishError{code, message}
		publication.finished = time.Now()
	}
}

func (s *Server) releaseRobloxBytesLocked(publication *robloxPublication) {
	s.robloxPendingBytes -= publication.reserved
	publication.reserved = 0
}

// Expire definitive receipts only. Unknown outcomes continue blocking the same
// owner until explicit Dashboard reconciliation, within the bounded registry.
func (s *Server) pruneRobloxLocked(now time.Time) {
	for owner, publication := range s.robloxPublications {
		if !publication.finished.IsZero() && now.Sub(publication.finished) >= robloxReceiptRetention && publication.receipt.State != "unknown" {
			delete(s.robloxPublications, owner)
		}
	}
}

// A safe unknown receipt may outlive this grant, but never its XML buffer or I/O authority.
func (s *Server) revokeRobloxLocked(p *peer) {
	publication := s.robloxPublications[ownerOf(p)]
	if publication != nil && publication.peer == p {
		s.destroyRobloxLocked(publication, "ROBLOX_PUBLISH_REVOKED", "The original workspace session or write grant ended.")
	}
}

func (s *Server) handleRobloxPublish(p *peer, raw json.RawMessage) {
	var request robloxPublishRequest
	if strictRobloxJSON(raw, &request) != nil || !model.ValidID(request.RequestID) {
		return // Invalid correlation metadata never causes I/O or exposes an unsolicited receipt.
	}
	s.mu.Lock()
	if !s.peers[p] || p.mode == "control" || p.origin == "" || p.instanceID == "" ||
		request.BrowserInstanceID != p.instanceID || request.AccessGrantID != p.grantID {
		s.mu.Unlock()
		s.robloxReply(p, request, 403, robloxFailure("ROBLOX_PUBLISH_AUTHORITY_REQUIRED", "Use the current unlocked browser session and grant."))
		return
	}
	if request.Action != "capabilities" && p.mcpAccess != "write" {
		s.mu.Unlock()
		s.robloxReply(p, request, 403, robloxFailure("ROBLOX_PUBLISH_WRITE_REQUIRED", "Publication requires an explicit current Read + write grant."))
		return
	}
	status, body := s.robloxPublishActionLocked(p, request)
	s.mu.Unlock()
	if status != 0 {
		s.robloxReply(p, request, status, body)
	}
}

// Caller holds s.mu. Pending state is bounded metadata plus the unfinished XML,
// never a game model. Final HTTP work runs independently so revocation remains live.
func (s *Server) robloxPublishActionLocked(p *peer, request robloxPublishRequest) (int, any) {
	bad := func() (int, any) {
		return 422, robloxFailure("ROBLOX_PUBLISH_INVALID", "Use the exact documented publication fields.")
	}
	if request.Action == "capabilities" {
		var value struct{}
		if strictRobloxJSON(request.Data, &value) != nil {
			return bad()
		}
		return 200, s.robloxCapabilities()
	}
	if s.config.RobloxPublisher == nil || s.config.RobloxApproval == nil {
		return 503, robloxFailure("ROBLOX_PUBLISH_DISABLED", "Configure the optional publisher in an interactive local bridge terminal; no credential or terminal approval belongs in a game, browser setting or API request.")
	}
	owner := ownerOf(p)
	s.pruneRobloxLocked(time.Now())
	publication := s.robloxPublications[owner]
	if publication != nil && publication.receipt.State == "receiving" && time.Now().After(publication.expires) {
		s.destroyRobloxLocked(publication, "ROBLOX_PUBLISH_EXPIRED", "The one-use publication preparation expired.")
	}
	if request.Action == "begin" {
		var value struct {
			DiagramID    string `json:"diagramId"`
			BaseVersion  int64  `json:"baseVersion"`
			ArtifactName string `json:"artifactName"`
			SHA256       string `json:"sha256"`
			TotalBytes   int    `json:"totalBytes"`
			UniverseID   string `json:"universeId"`
			PlaceID      string `json:"placeId"`
		}
		if strictRobloxJSON(request.Data, &value) != nil || !model.ValidID(value.DiagramID) || value.BaseVersion < 1 ||
			value.ArtifactName != "game.rbxlx" || value.TotalBytes < 1 || value.TotalBytes > robloxcloud.MaxPlaceBytes || len(value.SHA256) != 64 {
			return bad()
		}
		digest, err := hex.DecodeString(value.SHA256)
		if err != nil || hex.EncodeToString(digest) != value.SHA256 {
			return bad()
		}
		target := s.config.RobloxPublisher.Target()
		if target.UniverseID != value.UniverseID || target.PlaceID != value.PlaceID {
			return 422, robloxFailure("ROBLOX_PUBLISH_TARGET_MISMATCH", "The destination must match the process-local configured Universe and Place.")
		}
		if publication != nil && (publication.receipt.State == "unknown" || publication.receipt.State == "publishing" || publication.receipt.State == "receiving" || publication.receipt.State == "awaiting-approval") {
			return 409, robloxFailure("ROBLOX_PUBLISH_PENDING", "Inspect the existing receipt. Reconcile an unknown outcome in Creator Dashboard before beginning another publication.")
		}
		if publication == nil && len(s.robloxPublications) >= robloxOwnerLimit {
			return 429, robloxFailure("ROBLOX_PUBLISH_LIMIT", "The bounded publication receipt registry is full.")
		}
		if s.robloxPendingBytes+value.TotalBytes > robloxPendingByteLimit {
			return 429, robloxFailure("ROBLOX_PUBLISH_BYTES_LIMIT", "Pending publication buffers exceed the 32 MiB aggregate budget. Wait for cleanup or cancel preparation.")
		}
		expires := time.Now().Add(robloxPreparation)
		publication = &robloxPublication{peer: p, grant: p.grantID, expires: expires, reserved: value.TotalBytes, buffer: make([]byte, 0, value.TotalBytes), receipt: robloxPublishReceipt{
			Nonce: "vnrbx1." + s.operationEpoch + "." + randomIdentifier(), State: "receiving", Target: target, SHA256: value.SHA256, TotalBytes: value.TotalBytes, ExpiresAt: expires.UTC().Format(time.RFC3339Nano),
		}}
		publication.diagramID = value.DiagramID
		publication.baseVersion = value.BaseVersion
		s.robloxPendingBytes += value.TotalBytes
		s.robloxPublications[owner] = publication
		publication.timer = time.AfterFunc(robloxPreparation, func() {
			s.mu.Lock()
			defer s.mu.Unlock()
			if s.robloxPublications[owner] == publication && publication.receipt.State == "receiving" {
				s.destroyRobloxLocked(publication, "ROBLOX_PUBLISH_EXPIRED", "The one-use publication preparation expired.")
			}
		})
		return 201, publication.receipt
	}
	if request.Action == "status" {
		var value struct {
			Nonce string `json:"nonce"`
		}
		if strictRobloxJSON(request.Data, &value) != nil {
			return bad()
		}
		if publication == nil || value.Nonce != "" && value.Nonce != publication.receipt.Nonce {
			return 404, robloxFailure("ROBLOX_PUBLISH_NOT_FOUND", "No publication receipt belongs to this live browser owner.")
		}
		return 200, publication.receipt
	}
	var value struct {
		Nonce  string `json:"nonce"`
		Index  int    `json:"index"`
		Offset int    `json:"offset"`
		Data   string `json:"data"`
	}
	if request.Action == "chunk" {
		if strictRobloxJSON(request.Data, &value) != nil {
			return bad()
		}
	} else {
		var identity struct {
			Nonce string `json:"nonce"`
		}
		if strictRobloxJSON(request.Data, &identity) != nil {
			return bad()
		}
		value.Nonce = identity.Nonce
	}
	if publication == nil || value.Nonce == "" || value.Nonce != publication.receipt.Nonce {
		return 404, robloxFailure("ROBLOX_PUBLISH_NOT_FOUND", "The original one-use receipt is unavailable.")
	}
	if request.Action == "acknowledge-unknown" {
		if publication.receipt.State != "unknown" {
			return 409, robloxFailure("ROBLOX_PUBLISH_NOT_UNKNOWN", "Only an unknown receipt can be acknowledged after human Dashboard review.")
		}
		receipt := publication.receipt
		receipt.State = "cancelled"
		receipt.RequiresDashboardReconciliation = false
		receipt.Error = &robloxPublishError{"ROBLOX_PUBLISH_ACKNOWLEDGED", "The human acknowledged Dashboard version-history review; this receipt cannot publish again."}
		delete(s.robloxPublications, owner)
		return 200, receipt
	}
	if publication.peer != p || publication.grant != p.grantID {
		return 403, robloxFailure("ROBLOX_PUBLISH_REVOKED", "A fresh grant cannot continue an earlier publication upload.")
	}
	if request.Action == "cancel" {
		s.destroyRobloxLocked(publication, "ROBLOX_PUBLISH_CANCELLED", "The original publisher cancelled preparation.")
		return 200, publication.receipt
	}
	if publication.receipt.State != "receiving" {
		return 409, robloxFailure("ROBLOX_PUBLISH_NONCE_USED", "The nonce is consumed; inspect the receipt rather than retrying finalization.")
	}
	if request.Action == "chunk" {
		chunk, err := base64.StdEncoding.Strict().DecodeString(value.Data)
		if err != nil || len(chunk) < 1 || len(chunk) > robloxChunkBytes || base64.StdEncoding.EncodeToString(chunk) != value.Data || value.Index != publication.receipt.NextIndex || value.Offset != publication.receipt.ReceivedBytes || value.Index >= 160 || len(publication.buffer)+len(chunk) > publication.receipt.TotalBytes {
			return bad()
		}
		publication.buffer = append(publication.buffer, chunk...)
		clear(chunk)
		publication.receipt.ReceivedBytes = len(publication.buffer)
		publication.receipt.NextIndex++
		return 200, publication.receipt
	}
	if request.Action != "finalize" {
		return bad()
	}
	if len(publication.buffer) != publication.receipt.TotalBytes {
		return 409, robloxFailure("ROBLOX_PUBLISH_UPLOAD_INCOMPLETE", "Upload the exact complete artifact before finalization.")
	}
	sum := sha256.Sum256(publication.buffer)
	if hex.EncodeToString(sum[:]) != publication.receipt.SHA256 || robloxcloud.ValidatePlace(publication.buffer, publication.receipt.SHA256) != nil {
		s.destroyRobloxLocked(publication, "ROBLOX_PUBLISH_ARTIFACT_INVALID", "The complete digest or Roblox XML does not match the prepared artifact.")
		publication.receipt.State = "failed"
		return 422, publication.receipt
	}
	publication.timer.Stop()
	publication.receipt.State = "awaiting-approval" // Consume nonce before the independent local approval.
	publication.receipt.ExpiresAt = time.Now().Add(robloxcloud.ApprovalDeadline).UTC().Format(time.RFC3339Nano)
	ctx, cancel := context.WithTimeout(context.Background(), robloxcloud.ApprovalDeadline)
	publication.cancel = cancel
	approval := robloxcloud.Approval{Nonce: publication.receipt.Nonce, SHA256: publication.receipt.SHA256, Target: publication.receipt.Target, DiagramID: publication.diagramID, BaseVersion: publication.baseVersion, TotalBytes: publication.receipt.TotalBytes}
	publication.timer = time.AfterFunc(robloxcloud.ApprovalDeadline, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.robloxPublications[owner] == publication && publication.receipt.State == "awaiting-approval" {
			s.destroyRobloxLocked(publication, "ROBLOX_PUBLISH_APPROVAL_EXPIRED", "Terminal approval expired; no Roblox request was sent.")
		}
	})
	go func() {
		defer cancel()
		approved := s.config.RobloxApproval(ctx, approval)
		s.mu.Lock()
		if s.robloxPublications[owner] != publication {
			s.mu.Unlock()
			return
		}
		if publication.receipt.State != "awaiting-approval" {
			receipt := publication.receipt
			s.mu.Unlock()
			if receipt.State == "cancelled" {
				s.robloxReply(p, request, 200, receipt)
			}
			return
		}
		current := s.peers[p] && p.mode != "control" && p.origin == owner.origin && p.workspace == owner.workspace && p.instanceID == owner.instance && p.grantID == publication.grant && p.mcpAccess == "write"
		if !approved || ctx.Err() != nil || !current {
			s.destroyRobloxLocked(publication, "ROBLOX_PUBLISH_APPROVAL_DENIED", "Independent local terminal approval was not given; no Roblox request was sent.")
			receipt := publication.receipt
			s.mu.Unlock()
			s.robloxReply(p, request, 200, receipt)
			return
		}
		publication.timer.Stop()
		cancel()
		publication.receipt.State = "publishing"
		publication.receipt.ExpiresAt = time.Now().Add(robloxcloud.NetworkDeadline).UTC().Format(time.RFC3339Nano)
		payload := publication.buffer
		publication.buffer = nil
		network, networkCancel := context.WithTimeout(context.Background(), robloxcloud.NetworkDeadline)
		publication.cancel = networkCancel
		s.mu.Unlock()
		defer networkCancel()
		result := s.config.RobloxPublisher.Publish(network, payload, publication.receipt.SHA256)
		payload = nil // Release private XML; terminal records contain safe metadata only.
		s.mu.Lock()
		s.releaseRobloxBytesLocked(publication)
		if s.robloxPublications[owner] != publication || publication.receipt.State != "publishing" {
			s.mu.Unlock()
			return // Revocation/cancellation already established the unknown outcome.
		}
		publication.receipt.State = result.State
		publication.finished = time.Now()
		publication.receipt.VersionNumber = result.VersionNumber
		publication.receipt.RequiresDashboardReconciliation = result.State == "unknown"
		if result.Code != "" {
			publication.receipt.Error = &robloxPublishError{result.Code, result.Message}
		}
		receipt := publication.receipt
		s.mu.Unlock()
		s.robloxReply(p, request, 200, receipt)
	}()
	return 0, nil
}
