// Package store is the shared domain layer used by HTTP and the agent CLI.
package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schema string

type Record = map[string]any
type Store struct {
	DB                       *sql.DB
	Root, Home, Cache, Actor string
}
type Page struct {
	Items  []Record `json:"items"`
	Total  int      `json:"total"`
	Offset int      `json:"offset"`
	Limit  int      `json:"limit"`
}
type Filter struct {
	Type, Query, Tag, Entity, Role, Revision string
	Limit, Offset                            int
	History, Archived                        bool
}
type Conflict struct{ Message string }

func (e *Conflict) Error() string { return e.Message }

var ErrNotFound = errors.New("未找到对象")
var hashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var kinds = map[string]bool{"character": true, "look": true, "scene": true, "prop": true, "sound": true, "story": true, "shot": true, "clip": true, "mix": true, "style": true}
var Roles = map[string]bool{"reference": true, "turnaround": true, "look": true, "expression": true, "portrait": true, "action": true, "source_audio": true, "voice": true, "sfx": true, "music": true, "mix": true, "stem": true, "scene": true, "layout": true, "board": true, "frame": true, "preview": true, "video": true}

func ID(prefix string) string { return prefix + ":" + uuid.NewString() }
func Now() string             { return time.Now().UTC().Format(time.RFC3339Nano) }
func JSON(v any) string       { b, _ := json.Marshal(v); return string(b) }
func Text(v any) string {
	if v == nil {
		return ""
	}
	s, _ := v.(string)
	return s
}
func Number(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	}
	return 0
}
func Map(v any) Record {
	if m, ok := v.(map[string]any); ok && m != nil {
		return m
	}
	return Record{}
}
func List(v any) []any {
	if a, ok := v.([]any); ok {
		return a
	}
	return []any{}
}
func Strings(v any) []string {
	out := []string{}
	switch a := v.(type) {
	case []string:
		return a
	case []any:
		for _, s := range a {
			if t, ok := s.(string); ok {
				out = append(out, t)
			}
		}
	}
	return out
}
func copyMap(v Record) Record { var out Record; _ = json.Unmarshal([]byte(JSON(v)), &out); return out }

func Open(root, actor string) (*Store, error) {
	absolute, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	absolute, err = filepath.EvalSymlinks(absolute)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(absolute)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("项目目录不存在")
	}
	home := filepath.Join(absolute, ".toonforge")
	if err = os.MkdirAll(home, 0755); err != nil {
		return nil, err
	}
	resolved, err := filepath.EvalSymlinks(home)
	if err != nil || !within(absolute, resolved) {
		return nil, fmt.Errorf("管理目录超出项目")
	}
	path := filepath.Join(home, "library.sqlite")
	if p, e := filepath.EvalSymlinks(path); e == nil && !within(absolute, p) {
		return nil, fmt.Errorf("数据库路径超出项目")
	}
	db, err := sql.Open("sqlite", path+"?_pragma=foreign_keys(1)&_pragma=busy_timeout(10000)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	s := &Store{DB: db, Root: absolute, Home: home, Actor: actor}
	cache, _ := os.UserCacheDir()
	h := sha256.Sum256([]byte(absolute))
	s.Cache = filepath.Join(cache, "toonforge-studio", hex.EncodeToString(h[:8]))
	_ = os.MkdirAll(s.Cache, 0755)
	if _, err = db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		db.Close()
		return nil, err
	}
	var version int
	if err = db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		db.Close()
		return nil, err
	}
	if version > 1 {
		db.Close()
		return nil, fmt.Errorf("不支持此数据库版本，禁止降级打开")
	}
	if version == 0 {
		tx, e := db.Begin()
		if e != nil {
			db.Close()
			return nil, e
		}
		defer tx.Rollback()
		if _, e = tx.Exec(schema); e == nil {
			_, e = tx.Exec(`CREATE TABLE files(path TEXT PRIMARY KEY,artifact_id TEXT NOT NULL REFERENCES artifacts(id),fingerprint TEXT NOT NULL); CREATE TABLE pending_imports(id TEXT PRIMARY KEY,entity_id TEXT REFERENCES entities(id),source_path TEXT NOT NULL,content_hash TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(source_path,content_hash)); CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); PRAGMA user_version=1;`)
		}
		if e == nil {
			_, e = tx.Exec("INSERT INTO projects VALUES(?,?,?,?)", "project", filepath.Base(absolute), absolute, Now())
		}
		if e == nil {
			_, e = tx.Exec("INSERT INTO schema_migrations VALUES(?,?,?)", 1, "go-compatible-v1", Now())
		}
		if e == nil {
			e = tx.Commit()
		}
		if e != nil {
			db.Close()
			return nil, e
		}
	}
	_, err = db.Exec(`CREATE INDEX IF NOT EXISTS studio_artifact_revision ON artifacts(revision_id); CREATE INDEX IF NOT EXISTS studio_entity_parent ON entities(parent_id,type,archived); CREATE INDEX IF NOT EXISTS studio_revision_entity ON revisions(entity_id,created_at); CREATE TABLE IF NOT EXISTS studio_jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,input_json TEXT NOT NULL,progress INTEGER NOT NULL DEFAULT 0,result_json TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,cancel_requested INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS studio_recent(entity_id TEXT PRIMARY KEY REFERENCES entities(id),visited_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS studio_collections(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS studio_collection_items(collection_id TEXT REFERENCES studio_collections(id),entity_id TEXT REFERENCES entities(id),PRIMARY KEY(collection_id,entity_id)); CREATE TABLE IF NOT EXISTS studio_ignored(path TEXT PRIMARY KEY);`)
	if err != nil {
		db.Close()
		return nil, err
	}
	if err = s.initWorkflow(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}
func (s *Store) Close() error { return s.DB.Close() }

type querier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func query(ctx context.Context, q querier, statement string, args ...any) ([]Record, error) {
	rows, err := q.QueryContext(ctx, statement, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	out := []Record{}
	for rows.Next() {
		values := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err = rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		r := Record{}
		for i, k := range cols {
			v := values[i]
			if b, ok := v.([]byte); ok {
				v = string(b)
			}
			r[k] = v
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
func (s *Store) Query(ctx context.Context, q string, args ...any) ([]Record, error) {
	return query(ctx, s.DB, q, args...)
}
func one(rows []Record, err error) (Record, error) {
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	return rows[0], nil
}
func decode(r Record, key, target string) {
	var v any
	_ = json.Unmarshal([]byte(Text(r[key])), &v)
	if v == nil {
		v = Record{}
	}
	r[target] = v
	delete(r, key)
}
func (s *Store) enrich(ctx context.Context, r Record, cover bool) error {
	decode(r, "metadata_json", "metadata")
	tags, err := s.Query(ctx, `SELECT t.namespace,t.label FROM tags t JOIN entity_tags et ON et.tag_id=t.id WHERE et.entity_id=? ORDER BY t.namespace,t.label`, r["id"])
	if err != nil {
		return err
	}
	values := []string{}
	for _, t := range tags {
		v := Text(t["label"])
		if t["namespace"] != "user" {
			v = Text(t["namespace"]) + ":" + v
		}
		values = append(values, v)
	}
	r["tags"] = values
	if cover {
		if aid := Text(Map(r["metadata"])["cover_artifact_id"]); aid != "" {
			var count int
			if err := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM artifacts a JOIN revisions v ON v.id=a.revision_id JOIN entities e ON e.id=v.entity_id WHERE a.id=? AND a.media_type='image' AND (e.id=? OR e.parent_id=?)", aid, r["id"], r["id"]).Scan(&count); err != nil {
				return err
			}
			if count > 0 {
				r["cover_artifact_id"] = aid
				return nil
			}
		}
		rows, e := s.Query(ctx, `SELECT a.id FROM artifacts a JOIN revisions r ON r.id=a.revision_id LEFT JOIN files f ON f.artifact_id=a.id WHERE r.entity_id IN(SELECT id FROM entities WHERE id=? OR parent_id=?) AND a.media_type='image' ORDER BY (f.path IS NULL),CASE WHEN ?='character' THEN CASE a.role WHEN 'turnaround' THEN 0 WHEN 'look' THEN 1 WHEN 'portrait' THEN 2 ELSE 3 END ELSE CASE a.role WHEN 'look' THEN 0 WHEN 'turnaround' THEN 1 WHEN 'board' THEN 2 ELSE 3 END END,a.rowid DESC LIMIT 1`, r["id"], r["id"], r["type"])
		if e != nil {
			return e
		}
		r["cover_artifact_id"] = nil
		if len(rows) > 0 {
			r["cover_artifact_id"] = rows[0]["id"]
		}
	}
	return nil
}
func bounds(f Filter) (int, int) {
	l := f.Limit
	if l < 1 {
		l = 60
	}
	if l > 200 {
		l = 200
	}
	o := f.Offset
	if o < 0 {
		o = 0
	}
	return l, o
}
func (s *Store) Entities(ctx context.Context, f Filter) (Page, error) {
	l, o := bounds(f)
	where := []string{"e.archived=?"}
	archived := 0
	if f.Archived {
		archived = 1
	}
	args := []any{archived}
	if f.Type == "story" && f.Entity == "" {
		where = append(where, "NOT EXISTS(SELECT 1 FROM studio_story_members sm WHERE sm.entity_id=e.id AND sm.story_id<>e.id)")
	}
	if f.Type != "" {
		where = append(where, "e.type=?")
		args = append(args, f.Type)
	}
	if f.Query != "" {
		where = append(where, "(e.name LIKE ? OR e.id LIKE ? OR e.metadata_json LIKE ?)")
		q := "%" + f.Query + "%"
		args = append(args, q, q, q)
	}
	if f.Tag != "" {
		where = append(where, `EXISTS(SELECT 1 FROM entity_tags et JOIN tags t ON t.id=et.tag_id WHERE et.entity_id=e.id AND (t.namespace||':'||t.label=? OR t.label=?))`)
		args = append(args, f.Tag, f.Tag)
	}
	if f.Entity != "" {
		where = append(where, "e.parent_id=?")
		args = append(args, f.Entity)
	}
	clause := strings.Join(where, " AND ")
	var n int
	err := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM entities e WHERE "+clause, args...).Scan(&n)
	if err != nil {
		return Page{}, err
	}
	rows, err := s.Query(ctx, "SELECT e.* FROM entities e WHERE "+clause+" ORDER BY e.name LIMIT ? OFFSET ?", append(args, l, o)...)
	if err != nil {
		return Page{}, err
	}
	for _, r := range rows {
		if err = s.enrich(ctx, r, true); err != nil {
			return Page{}, err
		}
	}
	return Page{rows, n, o, l}, nil
}
func (s *Store) Entity(ctx context.Context, id string) (Record, error) {
	e, err := one(s.Query(ctx, "SELECT * FROM entities WHERE id=?", id))
	if err != nil {
		return nil, err
	}
	if err = s.enrich(ctx, e, true); err != nil {
		return nil, err
	}
	children, err := s.Query(ctx, "SELECT * FROM entities WHERE parent_id=? AND archived=0 ORDER BY type,name", id)
	if err != nil {
		return nil, err
	}
	for _, c := range children {
		if err = s.enrich(ctx, c, true); err != nil {
			return nil, err
		}
	}
	e["children"] = children
	revs, err := s.Query(ctx, "SELECT * FROM revisions WHERE entity_id=? ORDER BY rowid DESC", id)
	if err != nil {
		return nil, err
	}
	for _, r := range revs {
		decode(r, "snapshot_json", "snapshot")
		decode(r, "generation_json", "generation")
	}
	e["revisions"] = revs
	refs, err := s.Query(ctx, "SELECT s.*,e.name scope_name FROM selections s JOIN revisions r ON r.id=s.revision_id JOIN entities e ON e.id=s.scope_entity_id WHERE r.entity_id=?", id)
	if err != nil {
		return nil, err
	}
	e["selected_by"] = refs
	usage := []Record{}
	if e["type"] == "character" || e["type"] == "look" || e["type"] == "scene" {
		shots, e2 := s.Query(ctx, "SELECT id,name,parent_id,metadata_json FROM entities WHERE type='shot'")
		if e2 != nil {
			return nil, e2
		}
		key := Text(Map(e["metadata"])["id"])
		for _, shot := range shots {
			decode(shot, "metadata_json", "metadata")
			m := Map(shot["metadata"])
			match := e["type"] == "scene" && m["scene_id"] == key
			for _, c := range Strings(m["characters"]) {
				if e["type"] == "character" && c == key {
					match = true
				}
			}
			if e["type"] == "look" {
				parent := strings.TrimPrefix(Text(e["parent_id"]), "character:")
				match = Map(m["variants"])[parent] == key
			}
			if match {
				usage = append(usage, Record{"id": shot["id"], "name": shot["name"], "story_id": shot["parent_id"]})
			}
		}
	}
	e["usage"] = usage
	return e, nil
}
func (s *Store) Artifacts(ctx context.Context, f Filter) (Page, error) {
	l, o := bounds(f)
	where := []string{"1=1"}
	args := []any{}
	if f.Entity != "" {
		where = append(where, "(r.entity_id=? OR e.parent_id=?)")
		args = append(args, f.Entity, f.Entity)
	}
	if f.Role != "" {
		where = append(where, "a.role=?")
		args = append(args, f.Role)
	}
	if f.Revision != "" {
		where = append(where, "r.id=?")
		args = append(args, f.Revision)
	}
	if f.Type != "" {
		where = append(where, "a.media_type=?")
		args = append(args, f.Type)
	}
	if f.Query != "" {
		where = append(where, "(a.relative_path LIKE ? OR a.metadata_json LIKE ? OR e.name LIKE ?)")
		q := "%" + f.Query + "%"
		args = append(args, q, q, q)
	}
	if !f.History {
		where = append(where, "f.path IS NOT NULL AND COALESCE(json_extract(a.metadata_json,'$.historical'),0)=0")
	}
	if f.Tag != "" {
		where = append(where, "EXISTS(SELECT 1 FROM json_each(a.metadata_json,'$.tags') WHERE value=?)")
		args = append(args, f.Tag)
	}
	base := ` FROM artifacts a JOIN revisions r ON r.id=a.revision_id JOIN entities e ON e.id=r.entity_id LEFT JOIN files f ON f.artifact_id=a.id WHERE ` + strings.Join(where, " AND ")
	var n int
	if err := s.DB.QueryRowContext(ctx, "SELECT count(*)"+base, args...).Scan(&n); err != nil {
		return Page{}, err
	}
	rows, err := s.Query(ctx, "SELECT a.*,r.entity_id,r.status,r.label,e.name entity_name,f.path current_path"+base+" ORDER BY a.rowid DESC LIMIT ? OFFSET ?", append(args, l, o)...)
	if err != nil {
		return Page{}, err
	}
	for _, r := range rows {
		decode(r, "metadata_json", "metadata")
		r["historical"] = r["current_path"] == nil || Map(r["metadata"])["historical"] == true
	}
	return Page{rows, n, o, l}, nil
}
func (s *Store) Artifact(ctx context.Context, id string) (Record, error) {
	r, err := one(s.Query(ctx, "SELECT a.*,r.entity_id,r.status FROM artifacts a JOIN revisions r ON r.id=a.revision_id WHERE a.id=?", id))
	if err != nil {
		return nil, err
	}
	decode(r, "metadata_json", "metadata")
	r["source"] = nil
	if r["source_id"] != nil {
		source, e := one(s.Query(ctx, "SELECT * FROM sources WHERE id=?", r["source_id"]))
		if e == nil {
			r["source"] = source
		}
	}
	return r, nil
}
func (s *Store) ObjectPath(a Record) (string, error) {
	hash := Text(a["sha256"])
	if !hashPattern.MatchString(hash) {
		return "", fmt.Errorf("无效媒体校验值")
	}
	p := filepath.Join(s.Home, "objects", hash[:2], hash+strings.ToLower(filepath.Ext(Text(a["relative_path"]))))
	resolved, err := filepath.EvalSymlinks(p)
	if err != nil {
		return "", fmt.Errorf("媒体缺失，请恢复备份或重新定位")
	}
	if !within(s.Root, resolved) {
		return "", fmt.Errorf("媒体路径超出项目")
	}
	return resolved, nil
}
func within(root, path string) bool {
	r, e := filepath.Rel(root, path)
	return e == nil && r != ".." && !strings.HasPrefix(r, ".."+string(filepath.Separator)) && !filepath.IsAbs(r)
}
func (s *Store) SafeFile(value string, media bool) (string, error) {
	if filepath.IsAbs(value) {
		return "", fmt.Errorf("需要项目内相对路径")
	}
	p, e := filepath.EvalSymlinks(filepath.Join(s.Root, filepath.FromSlash(value)))
	if e != nil {
		return "", e
	}
	if !within(s.Root, p) {
		return "", fmt.Errorf("路径超出项目")
	}
	rel, _ := filepath.Rel(s.Root, p)
	for _, part := range strings.Split(rel, string(filepath.Separator)) {
		if strings.HasPrefix(part, ".") {
			return "", fmt.Errorf("不读取隐藏路径")
		}
	}
	info, e := os.Stat(p)
	if e != nil || !info.Mode().IsRegular() {
		return "", fmt.Errorf("不是普通文件")
	}
	if media && MediaType(p) == "" {
		return "", fmt.Errorf("不支持的媒体类型")
	}
	return p, nil
}
func MediaType(p string) string {
	switch strings.ToLower(filepath.Ext(p)) {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif":
		return "image"
	case ".mp4", ".mov", ".webm":
		return "video"
	case ".wav", ".mp3", ".flac", ".m4a", ".ogg", ".aac":
		return "audio"
	}
	return ""
}
func Digest(path string) (string, error) {
	f, e := os.Open(path)
	if e != nil {
		return "", e
	}
	defer f.Close()
	h := sha256.New()
	if _, e = io.Copy(h, f); e != nil {
		return "", e
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
func (s *Store) Documents(ctx context.Context, id, key string) (Record, error) {
	e, err := s.Entity(ctx, id)
	if err != nil {
		return nil, err
	}
	if e["type"] != "story" {
		return nil, fmt.Errorf("请选择剧本")
	}
	m := Map(e["metadata"])
	base := filepath.Dir(Text(m["_legacy_source"]))
	items := []Record{}
	for _, k := range []string{"script", "original_script", "voice_script", "voice_cues", "shot_list", "collection_manifest"} {
		v := Text(m[k])
		if v == "" {
			continue
		}
		path, err := s.SafeFile(filepath.ToSlash(filepath.Join(base, v)), false)
		if err != nil {
			continue
		}
		ext := strings.ToLower(filepath.Ext(path))
		if !strings.Contains("|.md|.txt|.json|.yaml|.yml|", "|"+ext+"|") {
			continue
		}
		info, _ := os.Stat(path)
		rel, _ := filepath.Rel(s.Root, path)
		item := Record{"key": k, "path": filepath.ToSlash(rel), "bytes": info.Size()}
		items = append(items, item)
		if key == k {
			if info.Size() > 2e6 {
				return nil, fmt.Errorf("文本超过2MB")
			}
			b, err := os.ReadFile(path)
			if err != nil {
				return nil, err
			}
			item["text"] = string(b)
			return item, nil
		}
	}
	if key != "" {
		return nil, ErrNotFound
	}
	return Record{"items": items}, nil
}
