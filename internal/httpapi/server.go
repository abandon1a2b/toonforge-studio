package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"toonforge.local/library/internal/store"
	"toonforge.local/library/resource"
)

type Server struct {
	Store          *store.Store
	Worker         *store.Worker
	Dev            bool
	RemoteReadOnly bool
	WriteToken     string
}

func New(s *store.Store, dev bool) *Server {
	return &Server{Store: s, Worker: store.NewWorker(s), Dev: dev}
}
func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, e error) {
	code := http.StatusBadRequest
	var conflict *store.Conflict
	if errors.As(e, &conflict) {
		code = http.StatusConflict
	}
	if errors.Is(e, store.ErrNotFound) {
		code = http.StatusNotFound
	}
	if errors.Is(e, context.Canceled) {
		code = 499
	}
	write(w, code, store.Record{"error": e.Error(), "code": code})
}
func number(q string) int { v, _ := strconv.Atoi(q); return v }
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions && s.RemoteReadOnly && !s.localWrite(r) {
		write(w, http.StatusForbidden, store.Record{"error": "此入口仅供查看，请使用本机编辑入口", "code": 403})
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "same-origin")
	origin := r.Header.Get("Origin")
	same := origin == "" || origin == "http://"+r.Host
	dev := s.Dev && (origin == "http://127.0.0.1:5175" || origin == "http://localhost:5175")
	if r.Method != "GET" && r.Method != "HEAD" && !same && !dev {
		write(w, 403, store.Record{"error": "请求来源不匹配"})
		return
	}
	if dev {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
	}
	if r.Method == "OPTIONS" {
		w.WriteHeader(204)
		return
	}
	if r.URL.Path == "/api/v2/upload" {
		s.upload(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/v2/") {
		s.api(w, r)
		return
	}
	switch r.URL.Path {
	case "/api/collection":
		s.collection(w, r)
		return
	case "/media", "/thumb":
		path, e := s.Store.SafeFile(r.URL.Query().Get("path"), true)
		if e != nil {
			fail(w, e)
			return
		}
		if r.URL.Path == "/thumb" {
			s.thumbnail(w, r, path, "")
			return
		}
		http.ServeFile(w, r, path)
		return
	case "/review":
		http.Redirect(w, r, "/entities/"+url.PathEscape("story:"+r.URL.Query().Get("story"))+"?section=boards", http.StatusTemporaryRedirect)
		return
	case "/review-collection":
		name := "review.html"
		if strings.Contains(r.URL.Path, "collection") {
			name = "review-collection.html"
		}
		b, e := resource.Legacy(name)
		if e != nil {
			fail(w, e)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(b)
		return
	}
	if r.Method != "GET" && r.Method != "HEAD" {
		w.WriteHeader(405)
		return
	}
	assets, e := resource.Assets()
	if e != nil {
		fail(w, e)
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" {
		name = "index.html"
	}
	if _, e = fs.Stat(assets, name); e != nil {
		if filepath.Ext(name) != "" || strings.HasPrefix(name, "api/") {
			http.NotFound(w, r)
			return
		}
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/"
		r = r2
	}
	if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", "public,max-age=31536000,immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.FileServer(http.FS(assets)).ServeHTTP(w, r)
}
func (s *Server) api(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()
	route := strings.TrimPrefix(r.URL.Path, "/api/v2/")
	filter := store.Filter{Type: q.Get("type"), Query: q.Get("q"), Tag: q.Get("tag"), Entity: q.Get("entity"), Role: q.Get("role"), Revision: q.Get("revision"), History: q.Get("history") == "1", Archived: q.Get("archived") == "1", Limit: number(q.Get("limit")), Offset: number(q.Get("offset"))}
	var out any
	var e error
	if r.Method == "GET" || r.Method == "HEAD" {
		switch route {
		case "overview":
			out, e = s.Store.Overview(ctx)
		case "entities":
			filter.Entity = q.Get("parent")
			out, e = s.Store.Entities(ctx, filter)
		case "entity":
			out, e = s.Store.Entity(ctx, q.Get("id"))
		case "artifacts":
			out, e = s.Store.Artifacts(ctx, filter)
		case "artifact":
			out, e = s.Store.Artifact(ctx, q.Get("id"))
		case "documents":
			out, e = s.Store.Documents(ctx, q.Get("entity"), q.Get("key"))
		case "selections":
			out, e = s.Store.Selections(ctx, q.Get("scope"))
		case "issues":
			out, e = s.Store.Issues(ctx, q.Get("entity"), q.Get("status"))
		case "events":
			out, e = s.Store.Events(ctx)
		case "tags":
			out, e = s.Store.TagList(ctx)
		case "settings":
			out, e = s.Store.Settings(ctx)
		case "pending":
			out, e = s.Store.Pending(ctx)
		case "inbox":
			out, e = s.Store.Inbox(ctx)
		case "jobs":
			out, e = s.Store.Jobs(ctx)
		case "health":
			out, e = s.Store.Health(ctx)
		case "context":
			out, e = s.Store.Context(ctx, q.Get("story"), strings.Split(q.Get("shots"), ","), q.Get("purpose"))
		case "file", "thumb", "waveform", "audio-preview":
			s.media(w, r, route)
			return
		case "collections":
			out, e = s.Store.Collections(ctx)
		default:
			write(w, 404, store.Record{"error": "未知接口"})
			return
		}
	} else if r.Method == "POST" {
		if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
			fail(w, fmt.Errorf("需要JSON请求"))
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 262144)
		dec := json.NewDecoder(r.Body)
		var d store.Record
		if e = dec.Decode(&d); e != nil {
			fail(w, e)
			return
		}
		if dec.Decode(&struct{}{}) != io.EOF {
			fail(w, fmt.Errorf("请求必须为单个JSON对象"))
			return
		}
		switch route {
		case "entity/cover":
			out, e = s.Store.SetCover(ctx, d)
		case "entity/create":
			out, e = s.Store.Create(ctx, d)
		case "entity/update":
			out, e = s.Store.Update(ctx, d)
		case "entity/archive":
			out, e = s.Store.Archive(ctx, d)
		case "entity/export":
			out, e = s.Store.ExportEntity(ctx, store.Text(d["id"]))
		case "entity/visit":
			e = s.Store.Visit(ctx, store.Text(d["id"]))
			out = store.Record{"ok": e == nil}
		case "artifact/register":
			out, e = s.Store.Register(ctx, d)
		case "artifact/update":
			out, e = s.Store.Annotate(ctx, d)
		case "revision/review":
			out, e = s.Store.Review(ctx, d)
		case "selection/set":
			out, e = s.Store.Select(ctx, d)
		case "issue/save":
			out, e = s.Store.SaveIssue(ctx, d)
		case "import/apply":
			out, e = s.Store.ApplyPending(ctx, d)
		case "import/refresh":
			out, e = s.Store.CreateJob(ctx, "refresh", d)
		case "backup":
			out, e = s.Store.CreateJob(ctx, "backup", d)
		case "jobs/create":
			out, e = s.Store.CreateJob(ctx, store.Text(d["kind"]), store.Map(d["input"]))
		case "jobs/cancel":
			e = s.Worker.Cancel(ctx, store.Text(d["id"]))
			out = store.Record{"ok": e == nil}
		case "settings/save":
			e = s.Store.Setting(ctx, store.Text(d["key"]), store.Text(d["value"]))
			out = store.Record{"ok": e == nil}
		case "tags/rename":
			out, e = s.Store.RenameTag(ctx, d)
		case "collections/save":
			out, e = s.Store.SaveCollection(ctx, d)
		default:
			write(w, 404, store.Record{"error": "未知写入接口"})
			return
		}
	} else {
		w.WriteHeader(405)
		return
	}
	if e != nil {
		fail(w, e)
		return
	}
	write(w, 200, out)
}
func Serve(ctx context.Context, s *store.Store, port int, dev bool, remoteReadOnly ...bool) error {
	handler := New(s, dev)
	handler.RemoteReadOnly = len(remoteReadOnly) == 0 || remoteReadOnly[0]
	if handler.RemoteReadOnly {
		token, err := localToken(s.Root)
		if err != nil {
			return err
		}
		handler.WriteToken = token
		link := fmt.Sprintf("http://127.0.0.1:%d/#local_token=%s", port, token)
		if err := os.WriteFile(filepath.Join(s.Root, ".toonforge", "local-editor-url.txt"), []byte(link+"\n"), 0600); err != nil {
			return err
		}
		fmt.Println("远程只读已开启；本机编辑链接保存在 .toonforge/local-editor-url.txt（请勿分享）")
	}
	server := &http.Server{Addr: fmt.Sprintf("127.0.0.1:%d", port), Handler: handler, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}
	go handler.Worker.Run(ctx)
	go func() {
		<-ctx.Done()
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(c)
	}()
	fmt.Printf("Toonforge Studio http://127.0.0.1:%d · %s · Go backend\n", port, s.Root)
	e := server.ListenAndServe()
	if errors.Is(e, http.ErrServerClosed) {
		return nil
	}
	return e
}
