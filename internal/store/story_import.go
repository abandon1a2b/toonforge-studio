package store

import (
	"context"
	"fmt"
	"path/filepath"
)

// Import new structured shots and continuous clips, without replacing managed edits.
// Existing references and selections remain explicit user choices.
func (s *Store) importStoryChildren(ctx context.Context, story Record) error {
	m := Map(story["metadata"])
	base := filepath.Dir(Text(m["_legacy_source"]))
	if base == "." {
		return nil
	}
	for _, spec := range []struct{ kind, path, key, idkey string }{{"shot", Text(m["shot_list"]), "shots", "shot_id"}, {"clip", "animation/clip-plan.json", "clips", "clip_id"}} {
		if spec.path == "" {
			continue
		}
		path, e := s.SafeFile(filepath.ToSlash(filepath.Join(base, spec.path)), false)
		if e != nil {
			continue
		}
		doc, e := ReadDocument(path)
		if e != nil {
			return e
		}
		for _, v := range List(doc[spec.key]) {
			data := copyMap(Map(v))
			localID := Text(data[spec.idkey])
			if localID == "" {
				return fmt.Errorf("%s中缺少%s", spec.path, spec.idkey)
			}
			id := spec.kind + ":" + Text(story["id"]) + ":" + localID
			var exists int
			if e = s.DB.QueryRowContext(ctx, "SELECT count(*) FROM entities WHERE id=? OR (parent_id=? AND type=? AND json_extract(metadata_json,?)=?)", id, story["id"], spec.kind, "$.legacy_"+spec.idkey, localID).Scan(&exists); e != nil {
				return e
			}
			if exists > 0 {
				continue
			}
			data["legacy_"+spec.idkey] = localID
			data["id"] = localID
			data["source_document"] = filepath.ToSlash(filepath.Join(base, spec.path))
			name := Text(data["title"])
			if name == "" {
				name = localID
			}
			data["name"] = name
			tx, e := s.DB.BeginTx(ctx, nil)
			if e != nil {
				return e
			}
			if _, e = tx.ExecContext(ctx, "INSERT INTO entities(id,project_id,type,name,parent_id,metadata_json) VALUES(?,?,?,?,?,?)", id, "project", spec.kind, name, story["id"], JSON(data)); e == nil {
				_, e = s.revision(ctx, tx, id, "结构导入", data, "draft")
			}
			if e != nil {
				tx.Rollback()
				return e
			}
			if e = tx.Commit(); e != nil {
				return e
			}
		}
	}
	return nil
}
