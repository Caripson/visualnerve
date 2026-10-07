package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestStaticServerSeparatesSiteAndWorkspaceRoutes(t *testing.T) {
	directory := t.TempDir()
	if err := os.Mkdir(filepath.Join(directory, "app"), 0755); err != nil {
		t.Fatal(err)
	}
	for path, content := range map[string]string{"index.html": "Public product home", "app/index.html": "Editor workspace"} {
		if err := os.WriteFile(filepath.Join(directory, path), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	server := New(Config{StaticDir: directory})
	defer server.Close()
	host := httptest.NewServer(server)
	defer host.Close()
	for _, test := range []struct{ path, content, canonical string }{
		{"/", "Public product home", "/"},
		{"/index.html", "Public product home", "/"},
		{"/app", "Editor workspace", "/app/"},
		{"/app/", "Editor workspace", "/app/"},
		{"/app/index.html", "Editor workspace", "/app/"},
	} {
		t.Run(test.path, func(t *testing.T) {
			response, err := http.Get(host.URL + test.path)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != http.StatusOK || string(body) != test.content || response.Request.URL.Path != test.canonical {
				t.Fatalf("%s: status %d, body %q, canonical %s", test.path, response.StatusCode, body, response.Request.URL.Path)
			}
		})
	}
}
