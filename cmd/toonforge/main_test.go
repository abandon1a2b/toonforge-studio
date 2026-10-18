package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestInputSingleJSONAndPayloadSize(t *testing.T) {
	for _, body := range []string{`{} {}`, `[]`, `null`} {
		p := filepath.Join(t.TempDir(), "input.json")
		os.WriteFile(p, []byte(body), 0600)
		if _, e := readInput(p); e == nil {
			t.Fatalf("accepted %s", body)
		}
	}
	p := filepath.Join(t.TempDir(), "valid.json")
	os.WriteFile(p, []byte(`{"name":"test","expected_version":2}`), 0600)
	m, e := readInput(p)
	if e != nil || m["name"] != "test" {
		t.Fatal(m, e)
	}
	b, _ := json.Marshal(m)
	if len(b) == 0 {
		t.Fatal("empty")
	}
}
