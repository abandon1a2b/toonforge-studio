package store

import (
	"context"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	_ "golang.org/x/image/webp"
)

func (s *Store) Probe(ctx context.Context, path string) Record {
	if MediaType(path) == "image" {
		f, e := os.Open(path)
		if e != nil {
			return Record{"probe_status": "unavailable"}
		}
		defer f.Close()
		cfg, format, e := image.DecodeConfig(f)
		if e == nil {
			return Record{"width": cfg.Width, "height": cfg.Height, "format": format}
		}
	}
	c, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	data, e := exec.CommandContext(c, "ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", path).Output()
	if e != nil {
		return Record{"probe_status": "unavailable"}
	}
	var raw Record
	if json.Unmarshal(data, &raw) != nil {
		return Record{"probe_status": "unavailable"}
	}
	var stream Record
	if a := List(raw["streams"]); len(a) > 0 {
		stream = Map(a[0])
	}
	var duration float64
	fmt.Sscan(Text(Map(raw["format"])["duration"]), &duration)
	return Record{"duration_seconds": duration, "codec": stream["codec_name"], "sample_rate": stream["sample_rate"], "channels": stream["channels"], "width": stream["width"], "height": stream["height"]}
}
func copyFile(src, dst string, mode os.FileMode) error {
	in, e := os.Open(src)
	if e != nil {
		return e
	}
	defer in.Close()
	if e = os.MkdirAll(filepath.Dir(dst), 0755); e != nil {
		return e
	}
	out, e := os.CreateTemp(filepath.Dir(dst), ".copy-*")
	if e != nil {
		return e
	}
	tmp := out.Name()
	defer os.Remove(tmp)
	_, e = io.Copy(out, in)
	if e == nil {
		e = out.Sync()
	}
	ce := out.Close()
	if e == nil {
		e = ce
	}
	if e != nil {
		return e
	}
	if e = os.Chmod(tmp, mode); e != nil {
		return e
	}
	return os.Rename(tmp, dst)
}
func (s *Store) freeze(path string) (string, error) {
	hash, e := Digest(path)
	if e != nil {
		return "", e
	}
	folder := filepath.Join(s.Home, "objects", hash[:2])
	if e = os.MkdirAll(folder, 0755); e != nil {
		return "", e
	}
	resolved, e := filepath.EvalSymlinks(folder)
	if e != nil || !within(s.Root, resolved) {
		return "", fmt.Errorf("媒体目录超出项目")
	}
	dst := filepath.Join(folder, hash+strings.ToLower(filepath.Ext(path)))
	if _, e = os.Stat(dst); os.IsNotExist(e) {
		if e = copyFile(path, dst, 0444); e != nil {
			return "", e
		}
	}
	check, e := Digest(dst)
	if e != nil || check != hash {
		return "", fmt.Errorf("媒体内容在登记时变化或已有副本损坏")
	}
	return hash, nil
}
func (s *Store) Register(ctx context.Context, d Record) (Record, error) {
	id, path, role := Text(d["entity_id"]), Text(d["path"]), Text(d["role"])
	if role == "" {
		role = "reference"
	}
	if !Roles[role] {
		return nil, fmt.Errorf("分类无效")
	}
	entity, e := s.Entity(ctx, id)
	if e != nil {
		return nil, e
	}
	file, e := s.SafeFile(path, true)
	if e != nil {
		return nil, e
	}
	hash, e := s.freeze(file)
	if e != nil {
		return nil, e
	}
	technical := s.Probe(ctx, file)
	note := Text(d["note"])
	source := Map(d["source"])
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	var sid any
	if len(source) > 0 {
		sid = ID("source")
		if _, e = tx.ExecContext(ctx, "INSERT INTO sources VALUES(?,?,?,?,?,?,?,?,?)", sid, Text(source["url"]), Text(source["author"]), Text(source["license_id"]), Text(source["license_url"]), Text(source["attribution"]), "unknown", Now(), hash); e != nil {
			return nil, e
		}
	}
	rid, e := s.revision(ctx, tx, id, filepath.Base(file), Record{"profile": entity["metadata"], "artifact_source": path, "sha256": hash, "note": note}, "pending_review")
	if e != nil {
		return nil, e
	}
	aid := ID("artifact")
	meta := Record{"technical": technical, "tags": []string{}, "historical": d["historical"] == true, "metadata_version": 1, "note": note}
	if _, e = tx.ExecContext(ctx, "INSERT INTO artifacts VALUES(?,?,?,?,?,?,?,?)", aid, rid, sid, filepath.ToSlash(path), hash, MediaType(file), role, JSON(meta)); e != nil {
		return nil, e
	}
	info, _ := os.Stat(file)
	fingerprint := fmt.Sprintf("%d:%d", info.ModTime().UnixNano(), info.Size())
	if _, e = tx.ExecContext(ctx, "INSERT OR REPLACE INTO files VALUES(?,?,?)", filepath.ToSlash(path), aid, fingerprint); e != nil {
		return nil, e
	}
	if e = s.event(ctx, tx, "artifact.register", id, nil, Record{"artifact_id": aid, "revision_id": rid, "path": path, "sha256": hash}, ""); e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return s.Artifact(ctx, aid)
}
func (s *Store) ExportEntity(ctx context.Context, id string) (Record, error) {
	e, err := s.Entity(ctx, id)
	if err != nil {
		return nil, err
	}
	folder := filepath.Join(s.Home, "exports")
	if err = os.MkdirAll(folder, 0755); err != nil {
		return nil, err
	}
	file := filepath.Join(folder, "entity-"+strings.TrimPrefix(ID("export"), "export:")+".json")
	if err = os.WriteFile(file, []byte(JSON(e)), 0644); err != nil {
		return nil, err
	}
	return Record{"path": file, "entity": e}, nil
}
