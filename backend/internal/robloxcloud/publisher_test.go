package robloxcloud

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

var place = []byte(`<roblox version="4"><Item class="Folder"><Properties><string name="Name">Synthetic</string></Properties></Item></roblox>`)

func digest(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func publisher(t *testing.T) *Publisher {
	t.Helper()
	p, err := New("synthetic-test-key", "123", "456")
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestPublisherPinsOfficialHTTPSMethodDestinationCredentialAndXML(t *testing.T) {
	p := publisher(t)
	calls := 0
	p.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.String() != "https://apis.roblox.com/universes/v1/123/places/456/versions?versionType=Published" || r.Method != http.MethodPost {
			t.Fatal("publication destination or method changed")
		}
		if r.Header.Get("x-api-key") != "synthetic-test-key" || r.Header.Get("Content-Type") != "application/xml" || r.Header.Get("Cookie") != "" {
			t.Fatal("only the process-local Open Cloud key and XML content type are accepted")
		}
		body, _ := io.ReadAll(r.Body)
		if string(body) != string(place) {
			t.Fatal("XML publication bytes changed")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"versionNumber":7,"private":"discard"}`)), Header: http.Header{}}, nil
	})
	result := p.Publish(context.Background(), place, digest(place))
	if result.State != "succeeded" || result.VersionNumber != 7 || calls != 1 || result.Message != "" {
		t.Fatal("only a validated version number may leave the official client", result)
	}
}

func TestPublisherRejectsInvalidDestinationKeyDigestXMLAndSizeBeforeHTTP(t *testing.T) {
	for _, id := range []string{"0", "01", "-1", "1/../../secret", "https://localhost", "9223372036854775808"} {
		if _, err := New("synthetic", id, "456"); err == nil {
			t.Fatal("invalid destination accepted", id)
		}
	}
	for _, key := range []string{"", " key", "key\r\nCookie: private", strings.Repeat("x", 4097)} {
		if _, err := New(key, "123", "456"); err == nil {
			t.Fatal("invalid key accepted")
		}
	}
	p := publisher(t)
	p.client.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("invalid artifact must reject before HTTP")
		return nil, nil
	})
	for _, body := range [][]byte{nil, []byte(`<notroblox/>`), []byte(`<roblox/><roblox/>`), []byte(`<!DOCTYPE roblox SYSTEM "http://localhost/private"><roblox/>`), []byte{0xff}, []byte(strings.Repeat("x", MaxPlaceBytes+1))} {
		if result := p.Publish(context.Background(), body, digest(body)); result.State != "failed" {
			t.Fatal("invalid artifact accepted")
		}
	}
	if result := p.Publish(context.Background(), place, strings.Repeat("0", 64)); result.State != "failed" {
		t.Fatal("incorrect digest accepted")
	}
}

func TestPublisherNeverFollowsRedirectsAndDoesNotRetryUnknownOutcomes(t *testing.T) {
	for _, fixture := range []struct {
		status int
		body   string
		err    error
		state  string
	}{
		{302, "", nil, "failed"}, {401, "synthetic-test-key", nil, "failed"},
		{403, "private account", nil, "failed"}, {500, "private body", nil, "unknown"},
		{200, `{"versionNumber":0}`, nil, "unknown"}, {200, `{"versionNumber":9007199254740993}`, nil, "unknown"}, {200, `{"versionNumber":2} {"private":true}`, nil, "unknown"},
		{200, strings.Repeat("x", 64*1024+1), nil, "unknown"}, {0, "", errors.New("private credential in transport error"), "unknown"},
	} {
		p := publisher(t)
		calls := 0
		p.client.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
			calls++
			if fixture.err != nil {
				return nil, fixture.err
			}
			return &http.Response{StatusCode: fixture.status, Header: http.Header{"Location": {"https://localhost/private"}}, Body: io.NopCloser(strings.NewReader(fixture.body))}, nil
		})
		result := p.Publish(context.Background(), place, digest(place))
		if result.State != fixture.state || calls != 1 || strings.Contains(result.Message, "private") || strings.Contains(result.Message, "synthetic-test-key") {
			t.Fatal("unsafe redirect, retry or private diagnostic", result)
		}
	}
}

func TestPublisherCancellationBeforeDispatchDoesNotSendCredential(t *testing.T) {
	p := publisher(t)
	p.client.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("cancelled request dispatched")
		return nil, nil
	})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if result := p.Publish(ctx, place, digest(place)); result.State != "cancelled" {
		t.Fatal("pre-dispatch cancellation changed", result)
	}
}
