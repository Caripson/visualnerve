package server

import (
	"context"
	"encoding/json"
	"testing"
)

func TestDiagramFileContractIsSharedByBrowserTransports(t *testing.T) {
	server := New(Config{Bridge: true})
	defer server.Close()
	for _, test := range []struct {
		path, body string
		status     int
	}{
		{"/diagram-files/preview", `{"format":"drawio","data":"<mxfile/>"}`, 503},
		{"/diagram-files/preview", `{"format":"drawio","data":"xml","pageId":"p"}`, 422},
		{"/diagram-files/preview", `{"format":"vsdx","data":"ordinary text"}`, 422},
		{"/import", `{"format":"drawio","data":"xml","pageId":"p"}`, 503},
		{"/import", `{"format":"drawio","data":"xml","pageId":1}`, 422},
		// Existing import formats are forwarded to the browser unchanged.
		{"/import", `{"format":"json","data":{"nodes":[]},"existingOption":true}`, 503},
		{"/import", `{"format":"markdown","data":"# Root"}`, 503},
		{"/import", `{"format":"csv","data":"title\nRoot"}`, 503},
	} {
		response, _ := server.forward(context.Background(), "", test.path, "POST", json.RawMessage(test.body))
		if response.Status != test.status {
			t.Fatalf("%s %s: got %d, want %d", test.path, test.body, response.Status, test.status)
		}
	}
}
