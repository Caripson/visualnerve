// Package robloxcloud implements the optional fixed-destination Open Cloud
// request. It neither compiles games nor stores models, credentials or artifacts.
package robloxcloud

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const MaxPlaceBytes = 10 * 1024 * 1024
const NetworkDeadline = 60 * time.Second

type Target struct {
	UniverseID string `json:"universeId"`
	PlaceID    string `json:"placeId"`
}

type Result struct {
	State         string
	Code, Message string
	VersionNumber int64
}

type Publisher struct {
	key    string
	target Target
	client *http.Client
}

func validID(value string) bool {
	if value == "" || value[0] == '0' {
		return false
	}
	for _, ch := range value {
		if ch < '0' || ch > '9' {
			return false
		}
	}
	n, err := strconv.ParseInt(value, 10, 64)
	return err == nil && n > 0
}

// New pins a process-local credential and destination. These values cannot be
// changed by a model, artifact, tool command or publication frame.
func New(key, universeID, placeID string) (*Publisher, error) {
	if key == "" || len(key) > 4096 || strings.TrimSpace(key) != key {
		return nil, errors.New("configure a valid process-local Roblox API key")
	}
	for _, ch := range key {
		if ch < 33 || ch > 126 {
			return nil, errors.New("configure a valid process-local Roblox API key")
		}
	}
	if !validID(universeID) || !validID(placeID) {
		return nil, errors.New("configure positive decimal int64 Roblox destination IDs")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	// Credentials are never sent through a caller-supplied endpoint or proxy.
	transport.Proxy = nil
	client := &http.Client{
		Transport: transport,
		Timeout:   NetworkDeadline,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	return &Publisher{key: key, target: Target{universeID, placeID}, client: client}, nil
}

func (p *Publisher) Target() Target { return p.target }

func ValidatePlace(data []byte, digest string) error {
	if len(data) < 1 || len(data) > MaxPlaceBytes || !utf8.Valid(data) {
		return errors.New("use a UTF-8 Roblox XML artifact of at most 10 MiB")
	}
	if len(digest) != 64 || strings.ToLower(digest) != digest {
		return errors.New("use the exact lowercase SHA-256 artifact digest")
	}
	if _, err := hex.DecodeString(digest); err != nil {
		return errors.New("use the exact lowercase SHA-256 artifact digest")
	}
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) != digest {
		return errors.New("the artifact digest does not match its exact bytes")
	}
	decoder := xml.NewDecoder(bytes.NewReader(data))
	depth, roots := 0, 0
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return errors.New("the artifact is not valid Roblox XML")
		}
		switch value := token.(type) {
		case xml.Directive:
			return errors.New("XML directives are unsupported")
		case xml.StartElement:
			if depth == 0 {
				roots++
				if roots != 1 || value.Name.Local != "roblox" || value.Name.Space != "" {
					return errors.New("use one Roblox XML root")
				}
			}
			depth++
			if depth > 128 {
				return errors.New("Roblox XML nesting exceeds the publication limit")
			}
		case xml.EndElement:
			depth--
		case xml.CharData:
			if depth == 0 && len(bytes.TrimSpace(value)) != 0 {
				return errors.New("text outside the Roblox XML root is unsupported")
			}
		}
	}
	if roots != 1 || depth != 0 {
		return errors.New("use one complete Roblox XML root")
	}
	return nil
}

func unknown() Result {
	return Result{State: "unknown", Code: "ROBLOX_PUBLISH_OUTCOME_UNKNOWN", Message: "Publication may have committed. Inspect Creator Dashboard version history before acknowledging this outcome; do not automatically retry."}
}

// Publish performs exactly one fixed HTTPS request, with no redirect or retry.
// Callers must consume their human-authorized one-use receipt before invoking it.
func (p *Publisher) Publish(ctx context.Context, data []byte, digest string) Result {
	if err := ValidatePlace(data, digest); err != nil {
		return Result{State: "failed", Code: "ROBLOX_PUBLISH_ARTIFACT_INVALID", Message: err.Error()}
	}
	if ctx.Err() != nil {
		return Result{State: "cancelled", Code: "ROBLOX_PUBLISH_CANCELLED", Message: "Publication was cancelled before dispatch."}
	}
	url := "https://apis.roblox.com/universes/v1/" + p.target.UniverseID + "/places/" + p.target.PlaceID + "/versions?versionType=Published"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return Result{State: "failed", Code: "ROBLOX_PUBLISH_REQUEST_INVALID", Message: "The fixed publishing request could not be prepared."}
	}
	req.Header.Set("Content-Type", "application/xml")
	req.Header.Set("x-api-key", p.key)
	response, err := p.client.Do(req)
	if err != nil {
		return unknown()
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		if response.StatusCode >= 500 || response.StatusCode >= 200 && response.StatusCode < 300 {
			return unknown()
		}
		// Do not forward Roblox bodies or headers: they may contain private data.
		code := "ROBLOX_PUBLISH_REJECTED"
		if response.StatusCode == 401 || response.StatusCode == 403 {
			code = "ROBLOX_PUBLISH_PERMISSION_DENIED"
		}
		return Result{State: "failed", Code: code, Message: "Roblox rejected publication. Review the configured key scope, destination and artifact in Creator Dashboard."}
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 64*1024+1))
	if err != nil || len(body) > 64*1024 {
		return unknown()
	}
	var value struct {
		VersionNumber int64 `json:"versionNumber"`
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	var trailing any
	if decoder.Decode(&value) != nil || value.VersionNumber < 1 || value.VersionNumber > 9007199254740991 || decoder.Decode(&trailing) != io.EOF {
		return unknown()
	}
	return Result{State: "succeeded", VersionNumber: value.VersionNumber}
}
