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
	if w := request("GET", "/api/v2/workspace", "evil.example", "", nil); w.Code != 403 {
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
