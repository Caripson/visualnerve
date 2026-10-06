package server

import (
	"context"
	"encoding/json"
	"testing"
)

func TestPresentationValidationSharedByHTTPAndMCPTransport(t *testing.T) {
	server := New(Config{Bridge: true})
	defer server.Close()
	for _, test := range []struct {
		path, method, body string
		status             int
	}{
		{"/presentation", "GET", "", 503},
		{"/presentation/voices", "GET", "", 503},
		{"/presentation/play", "POST", `{}`, 503},
		{"/presentation/open", "POST", `{"diagramId":"bad"}`, 422},
		{"/presentation/pause", "POST", `{"unknown":true}`, 422},
		{"/presentation", "PATCH", `{"audio":true}`, 503},
		{"/presentation", "PATCH", `{"audio":"true"}`, 422},
		{"/settings/presentation-voice", "PUT", `{"value":"sv_SE-nst-medium"}`, 503},
	} {
		response, _ := server.forward(context.Background(), "", test.path, test.method, json.RawMessage(test.body))
		if response.Status != test.status {
			t.Fatalf("%s: got %d, want %d", test.path, response.Status, test.status)
		}
	}
}
