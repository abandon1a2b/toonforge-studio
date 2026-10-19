package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/png"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"toonforge.local/library/internal/store"
)

func TestHTTPBoundariesMediaAndConflict(t *testing.T) {
	root := t.TempDir()
	s, e := store.Open(root, "api-test")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	h := New(s, false)
	request := func(method, path, host, origin string, body any) *httptest.ResponseRecorder {
		b, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, bytes.NewReader(b))
		r.Host = host
		r.Header.Set("Origin", origin)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := request("GET", "/", "evil.example", "", nil); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if w := request("POST", "/api/v2/entity/create", "localhost:8795", "https://evil.example", nil); w.Code != 403 {
		t.Fatal(w.Code)
	}
	w := request("POST", "/api/v2/entity/create", "localhost:8795", "", store.Record{"type": "scene", "name": "Office", "metadata": store.Record{}})
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var entity store.Record
	json.Unmarshal(w.Body.Bytes(), &entity)
	w = request("POST", "/api/v2/entity/update", "localhost:8795", "", store.Record{"id": entity["id"], "name": "Stale", "expected_version": 0, "metadata": store.Record{}})
	if w.Code != 409 {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, p := range []string{"/", "/library/character", "/entities/scene%3Aexample"} {
		w = request("GET", p, "localhost:8795", "", nil)
		if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte("root")) {
			t.Fatal(p, w.Code)
		}
	}
	if w = request("GET", "/assets/missing.js", "localhost:8795", "", nil); w.Code != 404 {
		t.Fatal("missing asset served SPA", w.Code)
	}
	f, _ := os.Create(filepath.Join(root, "sample.png"))
	png.Encode(f, image.NewRGBA(image.Rect(0, 0, 20, 20)))
	f.Close()
	a, e := s.Register(context.Background(), store.Record{"entity_id": entity["id"], "path": "sample.png", "role": "reference"})
	if e != nil {
		t.Fatal(e)
	}
	r := httptest.NewRequest("GET", "/api/v2/file?id="+store.Text(a["id"]), nil)
	r.Host = "localhost:8795"
	r.Header.Set("Range", "bytes=0-7")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 206 || w.Body.Len() != 8 {
		t.Fatal("range", w.Code, w.Body.String())
	}
	if w = request("GET", "/media?path=..%2Fsecret.png", "localhost:8795", "", nil); w.Code == 200 {
		t.Fatal("path escape")
	}
}

func TestRemoteReadOnly(t *testing.T) {
	s, err := store.Open(t.TempDir(), "access-test")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	h := New(s, false)
	h.RemoteReadOnly = true
	h.WriteToken = "test-secret"
	for _, tc := range []struct {
		name, method, host, peer, token, forwarded string
		want                                       int
	}{
		{"remote read", "GET", "studio.example", "127.0.0.1:1234", "", "", 200},
		{"frp loopback no token", "POST", "localhost:8795", "127.0.0.1:1234", "", "", 403},
		{"remote host with token", "POST", "studio.example", "127.0.0.1:1234", "test-secret", "", 403},
		{"nonlocal peer", "POST", "localhost:8795", "192.0.2.1:1234", "test-secret", "", 403},
		{"forwarded local", "POST", "localhost:8795", "127.0.0.1:1234", "test-secret", "192.0.2.1", 403},
		{"local write", "POST", "localhost:8795", "127.0.0.1:1234", "test-secret", "", 200},
		{"local ipv6", "POST", "[::1]:8795", "[::1]:1234", "test-secret", "", 200},
		{"upload blocked", "PUT", "localhost:8795", "127.0.0.1:1234", "", "", 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := "/"
			if tc.method != "GET" {
				path = "/api/v2/entity/create"
			}
			r := httptest.NewRequest(tc.method, path, bytes.NewBufferString(`{"type":"scene","name":"Office","metadata":{}}`))
			r.Header.Set("Content-Type", "application/json")
			r.Host = tc.host
			r.RemoteAddr = tc.peer
			r.Header.Set("X-Toonforge-Local-Token", tc.token)
			r.Header.Set("X-Forwarded-For", tc.forwarded)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tc.want {
				t.Fatalf("got %d want %d: %s", w.Code, tc.want, w.Body.String())
			}
		})
	}
}
