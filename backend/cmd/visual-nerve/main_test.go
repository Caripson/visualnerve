package main

import "testing"

func TestExplicitHostedOrigins(t *testing.T) {
	for _, value := range []string{"https://visualnerve.example.com", "https://visualnerve.example.com/", "http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173"} {
		var allowed origins
		if err := allowed.Set(value); err != nil {
			t.Fatalf("valid origin %s: %v", value, err)
		}
		if len(allowed) != 1 {
			t.Fatal(allowed)
		}
	}
	for _, value := range []string{"*", "http://remote.example", "https://remote.example/path", "https://user:password@remote.example", "https://remote.example?query=1", "https://remote.example#fragment", "ws://localhost:4317", "https://"} {
		var allowed origins
		if err := allowed.Set(value); err == nil {
			t.Fatalf("accepted invalid origin: %s", value)
		}
	}
}
