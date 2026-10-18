package store

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

func ReadDocument(path string) (Record, error) {
	b, e := os.ReadFile(path)
	if e != nil {
		return nil, e
	}
	var m Record
	if strings.EqualFold(filepath.Ext(path), ".json") {
		e = json.Unmarshal(b, &m)
	} else {
		e = yaml.Unmarshal(b, &m)
	}
	if e != nil {
		return nil, e
	}
	if m == nil {
		m = Record{}
	}
	return m, nil
}
func (s *Store) importProfile(ctx context.Context, path, kind, id, parent string) (string, error) {
	m, e := ReadDocument(path)
	if e != nil {
		return "", e
	}
	rel, _ := filepath.Rel(s.Root, path)
	source := filepath.ToSlash(rel)
	rows, e := s.Query(ctx, "SELECT id FROM entities WHERE json_extract(metadata_json,'$._legacy_source')=?", source)
	if e != nil {
		return "", e
	}
	existing := len(rows) > 0
	if existing {
		id = Text(rows[0]["id"])
	}
	hash, e := Digest(path)
	if e != nil {
		return "", e
	}
	key := "studio.source." + source
	var previous string
	_ = s.DB.QueryRowContext(ctx, "SELECT value FROM settings WHERE key=?", key).Scan(&previous)
	if existing {
		if previous != "" && previous != hash {
			payload := copyMap(m)
			payload["_legacy_source"] = source
			payload["_legacy_hash"] = hash
			if _, e = s.DB.ExecContext(ctx, "INSERT OR IGNORE INTO pending_imports VALUES(?,?,?,?,?,?)", ID("pending"), id, source, hash, JSON(payload), Now()); e != nil {
				return "", e
			}
		}
		if previous == "" {
			_, e = s.DB.ExecContext(ctx, "INSERT OR REPLACE INTO settings VALUES(?,?)", key, hash)
		}
		return id, e
	}
	var collision int
	if err := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM entities WHERE id=?", id).Scan(&collision); err != nil {
		return "", err
	}
	if collision > 0 {
		return "", fmt.Errorf("稳定ID已被其他资料使用：%s", id)
	}
	name := Text(m["name"])
	if kind == "story" {
		name = Text(m["title"])
	}
	if name == "" {
		name = Text(m["label"])
	}
	if name == "" {
		name = filepath.Base(filepath.Dir(path))
	}
	m["_legacy_source"] = source
	m["_legacy_hash"] = hash
	if kind == "character" {
		physical := Map(m["physical"])
		h := Map(physical["height_cm"])
		if h["unit"] == nil {
			h["unit"] = "cm"
		}
		if _, ok := h["value"]; !ok {
			h["value"] = nil
		}
		if h["status"] == nil {
			h["status"] = "unknown"
		}
		if _, ok := h["source"]; !ok {
			h["source"] = nil
		}
		physical["height_cm"] = h
		m["physical"] = physical
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return "", e
	}
	defer tx.Rollback()
	var p any
	if parent != "" {
		p = parent
	}
	tags, e := validTags(m["tags"])
	if e != nil {
		return "", e
	}
	if _, e = tx.ExecContext(ctx, "INSERT OR IGNORE INTO entities(id,project_id,type,name,parent_id,metadata_json) VALUES(?,?,?,?,?,?)", id, "project", kind, name, p, JSON(m)); e != nil {
		return "", e
	}
	if e = s.tags(ctx, tx, id, tags); e != nil {
		return "", e
	}
	if _, e = s.revision(ctx, tx, id, "资料导入", m, "draft"); e != nil {
		return "", e
	}
	if _, e = tx.ExecContext(ctx, "INSERT OR REPLACE INTO settings VALUES(?,?)", key, hash); e != nil {
		return "", e
	}
	if e = tx.Commit(); e != nil {
		return "", e
	}
	return id, nil
}
func (s *Store) Pending(ctx context.Context) (Record, error) {
	r, e := s.Query(ctx, "SELECT p.*,e.name FROM pending_imports p JOIN entities e ON e.id=p.entity_id ORDER BY p.rowid DESC")
	for _, p := range r {
		decode(p, "payload_json", "payload")
	}
	return Record{"items": r}, e
}
func (s *Store) ApplyPending(ctx context.Context, d Record) (Record, error) {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	p, e := one(query(ctx, tx, "SELECT * FROM pending_imports WHERE id=?", d["id"]))
	if e != nil {
		return nil, e
	}
	entity, e := one(query(ctx, tx, "SELECT * FROM entities WHERE id=?", p["entity_id"]))
	if e != nil {
		return nil, e
	}
	if Number(d["expected_version"]) != Number(entity["version"]) {
		return nil, &Conflict{"资料已改变，请重新比较"}
	}
	decode(p, "payload_json", "payload")
	m := Map(p["payload"])
	if e = validProfile(Text(entity["type"]), m); e != nil {
		return nil, e
	}
	tags, e := validTags(m["tags"])
	if e != nil {
		return nil, e
	}
	name := Text(m["name"])
	if entity["type"] == "story" {
		name = Text(m["title"])
	}
	if name == "" {
		name = Text(entity["name"])
	}
	if _, e = tx.ExecContext(ctx, "UPDATE entities SET name=?,metadata_json=?,version=version+1 WHERE id=?", name, JSON(m), p["entity_id"]); e != nil {
		return nil, e
	}
	if e = s.tags(ctx, tx, Text(p["entity_id"]), tags); e != nil {
		return nil, e
	}
	if _, e = s.revision(ctx, tx, Text(p["entity_id"]), "明确导入外部变更", m, "draft"); e != nil {
		return nil, e
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM pending_imports WHERE entity_id=?", p["entity_id"]); e != nil {
		return nil, e
	}
	if _, e = tx.ExecContext(ctx, "INSERT OR REPLACE INTO settings VALUES(?,?)", "studio.source."+Text(p["source_path"]), p["content_hash"]); e != nil {
		return nil, e
	}
	if e = s.event(ctx, tx, "import.apply", Text(p["entity_id"]), entity, m, ""); e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return s.Entity(ctx, Text(p["entity_id"]))
}

// Refresh is explicit: discover changes, never change a current selection.
func (s *Store) Refresh(ctx context.Context, progress func(int), cancelled func() bool) (Record, error) {
	owners := map[string]string{}
	profiles := []string{}
	media := []string{}
	warnings := []string{}
	for _, cat := range []string{"characters", "scenes", "props", "stories", "voice-references", "drafts", "styles"} {
		base := filepath.Join(s.Root, cat)
		_ = filepath.WalkDir(base, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if d.IsDir() {
				if strings.HasPrefix(d.Name(), ".") {
					return filepath.SkipDir
				}
				return nil
			}
			if d.Type()&os.ModeSymlink != 0 {
				return nil
			}
			name := d.Name()
			if name == "profile.yaml" || name == "profile.json" || name == "scene.yaml" || name == "prop.yaml" || name == "story.yaml" {
				profiles = append(profiles, path)
			}
			if MediaType(path) != "" {
				media = append(media, path)
			}
			return nil
		})
	}
	sort.Slice(profiles, func(i, j int) bool { return len(profiles[i]) < len(profiles[j]) })
	for _, path := range profiles {
		if cancelled != nil && cancelled() {
			return nil, context.Canceled
		}
		rel, _ := filepath.Rel(s.Root, path)
		parts := strings.Split(filepath.ToSlash(rel), "/")
		kind, id, parent := "", "", ""
		switch parts[0] {
		case "characters":
			if len(parts) == 3 {
				kind = "character"
				id = "character:" + parts[1]
			} else if len(parts) >= 5 && parts[2] == "variants" {
				kind = "look"
				id = "look:" + parts[1] + ":" + parts[3]
				parent = "character:" + parts[1]
			}
		case "scenes":
			if len(parts) == 3 {
				kind = "scene"
				id = "scene:" + parts[1]
			}
		case "props":
			if len(parts) == 3 {
				kind = "prop"
				id = "prop:" + parts[1]
			}
		case "stories":
			if filepath.Base(path) == "story.yaml" {
				kind = "story"
				id = "story:" + strings.Join(parts[1:len(parts)-1], "/")
			}
		}
		if kind == "" {
			continue
		}
		eid, e := s.importProfile(ctx, path, kind, id, parent)
		if e != nil {
			warnings = append(warnings, filepath.ToSlash(rel)+": "+e.Error())
			continue
		}
		prefix := filepath.ToSlash(filepath.Dir(rel)) + "/"
		owners[prefix] = eid
	}
	ownerRows, e := s.Query(ctx, "SELECT id,type,metadata_json FROM entities")
	if e != nil {
		return nil, e
	}
	exact := map[string]string{}
	for _, r := range ownerRows {
		decode(r, "metadata_json", "metadata")
		m := Map(r["metadata"])
		if r["type"] == "story" {
			if err := s.importStoryChildren(ctx, r); err != nil {
				warnings = append(warnings, Text(r["id"])+": "+err.Error())
			}
		}
		source := Text(m["_legacy_source"])
		if source != "" {
			owners[filepath.ToSlash(filepath.Dir(source))+"/"] = Text(r["id"])
		}
		if r["type"] == "character" {
			for vid, v := range Map(m["variants"]) {
				entry := Map(v)
				if sheet := Text(entry["sheet"]); sheet != "" {
					exact[filepath.ToSlash(filepath.Join(filepath.Dir(source), sheet))] = "look:" + Text(m["id"]) + ":" + vid
				}
			}
		}
	}
	prefixes := []string{}
	for p := range owners {
		prefixes = append(prefixes, p)
	}
	sort.Slice(prefixes, func(i, j int) bool { return len(prefixes[i]) > len(prefixes[j]) })
	newCount, unchanged := 0, 0
	for i, path := range media {
		if e = ctx.Err(); e != nil {
			return nil, e
		}
		if cancelled != nil && cancelled() {
			return nil, context.Canceled
		}
		rel, _ := filepath.Rel(s.Root, path)
		key := filepath.ToSlash(rel)
		info, e := os.Stat(path)
		if e != nil {
			continue
		}
		fingerprint := fmt.Sprintf("%d:%d", info.ModTime().UnixNano(), info.Size())
		var oldFingerprint, oldHash string
		_ = s.DB.QueryRowContext(ctx, "SELECT f.fingerprint,a.sha256 FROM files f JOIN artifacts a ON a.id=f.artifact_id WHERE f.path=?", key).Scan(&oldFingerprint, &oldHash)
		if oldFingerprint == fingerprint {
			unchanged++
			continue
		}
		if oldHash != "" {
			h, e := Digest(path)
			if e == nil && h == oldHash {
				_, _ = s.DB.ExecContext(ctx, "UPDATE files SET fingerprint=? WHERE path=?", fingerprint, key)
				unchanged++
				continue
			}
		}
		owner := exact[key]
		if owner == "" {
			for _, p := range prefixes {
				if strings.HasPrefix(key, p) {
					owner = owners[p]
					break
				}
			}
		}
		if owner == "" {
			warnings = append(warnings, key+": 未关联资料对象，请在待整理中登记")
			continue
		}
		role := "reference"
		kind := MediaType(path)
		name := strings.ToLower(filepath.Base(path))
		if kind == "audio" {
			role = "voice"
			if strings.HasPrefix(key, "voice-references/") {
				role = "source_audio"
			}
			if strings.Contains(key, "/sfx/") {
				role = "sfx"
			}
			if strings.Contains(key, "/soundscape-") {
				role = "mix"
			}
		} else if kind == "video" {
			role = "video"
			if strings.Contains(key, "animatic") {
				role = "preview"
			}
		} else {
			switch {
			case strings.Contains(name, "collection-"):
				role = "board"
			case strings.Contains(name, "shot-"):
				role = "frame"
			case strings.HasPrefix(owner, "look:"):
				role = "look"
			case strings.HasPrefix(owner, "scene:"):
				role = "scene"
			case strings.Contains(key, "/drafts/"):
				role = "turnaround"
			}
		}
		history := strings.Contains(key, "/history/") || strings.Contains(key, "/crops/") || strings.Contains(key, "/preview-frames/") || strings.Contains(key, "/revisions/")
		if _, e = s.Register(ctx, Record{"entity_id": owner, "path": key, "role": role, "historical": history}); e != nil {
			warnings = append(warnings, key+": "+e.Error())
		} else {
			newCount++
		}
		if progress != nil {
			progress((i + 1) * 100 / max(len(media), 1))
		}
	}
	return Record{"new_artifacts": newCount, "unchanged": unchanged, "warnings": warnings}, nil
}
func (s *Store) Inbox(ctx context.Context) (Record, error) {
	known := map[string]bool{}
	rows, e := s.Query(ctx, "SELECT path FROM files UNION SELECT path FROM studio_ignored")
	if e != nil {
		return nil, e
	}
	for _, r := range rows {
		known[Text(r["path"])] = true
	}
	items := []Record{}
	for _, cat := range []string{"characters", "scenes", "stories", "props", "voice-references", "drafts", "imports"} {
		_ = filepath.WalkDir(filepath.Join(s.Root, cat), func(path string, d fs.DirEntry, err error) error {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if err != nil {
				return nil
			}
			if d.IsDir() {
				if strings.HasPrefix(d.Name(), ".") {
					return filepath.SkipDir
				}
				return nil
			}
			if len(items) >= 500 || d.Type()&os.ModeSymlink != 0 || MediaType(path) == "" {
				return nil
			}
			rel, _ := filepath.Rel(s.Root, path)
			key := filepath.ToSlash(rel)
			if !known[key] {
				info, _ := d.Info()
				items = append(items, Record{"path": key, "name": d.Name(), "type": MediaType(path), "bytes": info.Size()})
			}
			return nil
		})
	}
	return Record{"items": items, "limit": 500}, nil
}
