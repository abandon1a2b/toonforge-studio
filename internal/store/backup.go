package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func (s *Store) Health(ctx context.Context) (Record, error) {
	var integrity string
	if e := s.DB.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&integrity); e != nil {
		return nil, e
	}
	fk, e := s.Query(ctx, "PRAGMA foreign_key_check")
	if e != nil {
		return nil, e
	}
	rows, e := s.Query(ctx, "SELECT id,sha256,relative_path FROM artifacts")
	if e != nil {
		return nil, e
	}
	missing, damaged := []string{}, []string{}
	for _, a := range rows {
		if e = ctx.Err(); e != nil {
			return nil, e
		}
		path, e := s.ObjectPath(a)
		if e != nil {
			missing = append(missing, Text(a["id"]))
			continue
		}
		hash, e := Digest(path)
		if e != nil || hash != a["sha256"] {
			damaged = append(damaged, Text(a["id"]))
		}
	}
	tools := Record{}
	for _, name := range []string{"ffmpeg", "ffprobe"} {
		p, _ := exec.LookPath(name)
		tools[name] = p != ""
	}
	return Record{"ok": integrity == "ok" && len(fk) == 0 && len(missing) == 0 && len(damaged) == 0, "integrity": integrity, "foreign_key_errors": fk, "missing_objects": missing, "damaged_objects": damaged, "tools": tools, "engine": "go"}, nil
}
func (s *Store) Backup(ctx context.Context, media bool) (Record, error) {
	folder := filepath.Join(s.Home, "backups", time.Now().Format("20060102-150405")+"-go-"+strings.TrimPrefix(ID("b"), "b:")[:6])
	if e := os.MkdirAll(folder, 0755); e != nil {
		return nil, e
	}
	dbfile := filepath.Join(folder, "library.sqlite")
	if _, e := s.DB.ExecContext(ctx, "VACUUM INTO ?", dbfile); e != nil {
		return nil, e
	}
	backup, e := sql.Open("sqlite", dbfile+"?_pragma=query_only(1)")
	if e != nil {
		return nil, e
	}
	defer backup.Close()
	var integrity string
	if e = backup.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&integrity); e != nil || integrity != "ok" {
		return nil, fmt.Errorf("备份数据库验证失败")
	}
	rows, e := query(ctx, backup, "SELECT id,sha256,relative_path FROM artifacts")
	if e != nil {
		return nil, e
	}
	files := []Record{}
	seen := map[string]bool{}
	for _, a := range rows {
		if e = ctx.Err(); e != nil {
			return nil, e
		}
		sha := Text(a["sha256"])
		if !hashPattern.MatchString(sha) {
			return nil, fmt.Errorf("媒体哈希无效")
		}
		rel := sha[:2] + "/" + sha + strings.ToLower(filepath.Ext(Text(a["relative_path"])))
		files = append(files, Record{"id": a["id"], "sha256": sha, "object": rel})
		if media && !seen[rel] {
			p, e := s.ObjectPath(a)
			if e != nil {
				return nil, e
			}
			h, e := Digest(p)
			if e != nil || h != sha {
				return nil, fmt.Errorf("媒体损坏，备份已停止")
			}
			if e = copyFile(p, filepath.Join(folder, "objects", filepath.FromSlash(rel)), 0444); e != nil {
				return nil, e
			}
			seen[rel] = true
		}
	}
	hash, e := Digest(dbfile)
	if e != nil {
		return nil, e
	}
	manifest := Record{"schema_version": 1, "created_at": Now(), "project": filepath.Base(s.Root), "portable": media, "database_sha256": hash, "files": files}
	if e = os.WriteFile(filepath.Join(folder, "manifest.json"), []byte(JSON(manifest)), 0644); e != nil {
		return nil, e
	}
	return Record{"directory": folder, "portable": media, "artifacts": len(files), "integrity_check": integrity}, nil
}
func Restore(ctx context.Context, folder, target string) (Record, error) {
	folder, e := filepath.Abs(folder)
	if e != nil {
		return nil, e
	}
	target, e = filepath.Abs(target)
	if e != nil {
		return nil, e
	}
	if entries, e := os.ReadDir(target); e == nil && len(entries) > 0 {
		return nil, fmt.Errorf("恢复目标必须为新的空目录")
	}
	b, e := os.ReadFile(filepath.Join(folder, "manifest.json"))
	if e != nil {
		return nil, e
	}
	var m Record
	if e = json.Unmarshal(b, &m); e != nil {
		return nil, e
	}
	if m["portable"] != true {
		return nil, fmt.Errorf("备份不含媒体，不能独立恢复")
	}
	hash, e := Digest(filepath.Join(folder, "library.sqlite"))
	if e != nil || hash != m["database_sha256"] {
		return nil, fmt.Errorf("备份数据库校验失败")
	}
	files := List(m["files"])
	for _, v := range files {
		f := Map(v)
		p := filepath.Join(folder, "objects", filepath.FromSlash(Text(f["object"])))
		resolved, e := filepath.EvalSymlinks(p)
		if e != nil || !within(folder, resolved) {
			return nil, fmt.Errorf("备份媒体路径无效")
		}
		hash, e := Digest(p)
		if e != nil || hash != f["sha256"] {
			return nil, fmt.Errorf("备份媒体校验失败")
		}
	}
	home := filepath.Join(target, ".toonforge")
	if e = os.MkdirAll(home, 0755); e != nil {
		return nil, e
	}
	if e = copyFile(filepath.Join(folder, "library.sqlite"), filepath.Join(home, "library.sqlite"), 0600); e != nil {
		return nil, e
	}
	for _, v := range files {
		f := Map(v)
		rel := filepath.FromSlash(Text(f["object"]))
		dst := filepath.Join(home, "objects", rel)
		if !within(home, dst) {
			return nil, fmt.Errorf("备份媒体路径无效")
		}
		if _, e = os.Stat(dst); e == nil {
			continue
		}
		if e = copyFile(filepath.Join(folder, "objects", rel), dst, 0444); e != nil {
			return nil, e
		}
	}
	s, e := Open(target, "restore")
	if e != nil {
		return nil, e
	}
	defer s.Close()
	if _, e = s.DB.ExecContext(ctx, "UPDATE projects SET storage_root=?", s.Root); e != nil {
		return nil, e
	}
	return s.Health(ctx)
}
