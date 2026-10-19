package store

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Workflow nodes are immutable stage versions. Production entities keep their
// original IDs so existing selections, issues and media references stay valid.
func (s *Store) initWorkflow(ctx context.Context) error {
	_, err := s.DB.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS studio_story_members(entity_id TEXT PRIMARY KEY REFERENCES entities(id),story_id TEXT NOT NULL REFERENCES entities(id)); CREATE TABLE IF NOT EXISTS studio_workflow(id TEXT PRIMARY KEY,story_id TEXT NOT NULL REFERENCES entities(id),stage TEXT NOT NULL CHECK(stage IN('script','boards','voice','video')),label TEXT NOT NULL,source_id TEXT REFERENCES studio_workflow(id),production_entity_id TEXT REFERENCES entities(id),snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(story_id,stage,label));`)
	if err != nil {
		return err
	}
	rows, err := s.Query(ctx, "SELECT id,metadata_json,name FROM entities WHERE type='story' ORDER BY id")
	if err != nil {
		return err
	}
	for _, row := range rows {
		decode(row, "metadata_json", "metadata")
		m := Map(row["metadata"])
		legacy := Text(m["legacy_story_id"])
		if legacy == "" {
			continue
		}
		root := "story:" + strings.Split(legacy, "/adaptations/")[0]
		var exists int
		if err = s.DB.QueryRowContext(ctx, "SELECT count(*) FROM entities WHERE id=? AND type='story'", root).Scan(&exists); err != nil {
			return err
		}
		if exists == 0 {
			continue
		}
		tx, err := s.DB.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		id := Text(row["id"])
		_, err = tx.ExecContext(ctx, "INSERT OR IGNORE INTO studio_story_members VALUES(?,?)", id, root)
		snapshot := Record{"metadata": m, "entity_id": id, "provenance": "legacy_import", "note": "导入时记录的制作资料；历史生成时所用精确修订未知，不推定验收状态"}
		base := filepath.Dir(Text(m["_legacy_source"]))
		documents := Record{}
		for _, key := range []string{"script", "shot_list", "storyboard"} {
			if rel := Text(m[key]); rel != "" {
				path, e := s.SafeFile(filepath.ToSlash(filepath.Join(base, rel)), false)
				if e == nil {
					if b, e := os.ReadFile(path); e == nil {
						documents[key] = string(b)
					}
				}
			}
		}
		snapshot["documents"] = documents
		scriptID := "workflow:script:" + id
		if err == nil {
			_, err = tx.ExecContext(ctx, "INSERT OR IGNORE INTO studio_workflow VALUES(?,?,?,?,?,?,?,?)", scriptID, root, "script", Text(row["name"])+" · "+Text(m["script_version"]), nil, id, JSON(snapshot), Now())
		}
		if err == nil && (Text(m["shot_list"]) != "" || Text(m["storyboard"]) != "") {
			_, err = tx.ExecContext(ctx, "INSERT OR IGNORE INTO studio_workflow VALUES(?,?,?,?,?,?,?,?)", "workflow:boards:"+id, root, "boards", Text(row["name"])+" · 导入分镜", scriptID, id, JSON(snapshot), Now())
		}
		if err != nil {
			tx.Rollback()
			return err
		}
		if err = tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) Workflow(ctx context.Context, id string) (Record, error) {
	root := id
	rows, err := s.Query(ctx, "SELECT story_id FROM studio_story_members WHERE entity_id=?", id)
	if err != nil {
		return nil, err
	}
	if len(rows) > 0 {
		root = Text(rows[0]["story_id"])
	}
	story, err := s.Entity(ctx, root)
	if err != nil {
		return nil, err
	}
	if story["type"] != "story" {
		return nil, fmt.Errorf("需要故事对象")
	}
	nodes, err := s.Query(ctx, `SELECT w.*,e.name production_name FROM studio_workflow w LEFT JOIN entities e ON e.id=w.production_entity_id WHERE w.story_id=? ORDER BY w.created_at,w.rowid`, root)
	for _, n := range nodes {
		decode(n, "snapshot_json", "snapshot")
	}
	return Record{"story": story, "nodes": nodes}, err
}

func (s *Store) CreateWorkflowVersion(ctx context.Context, d Record) (Record, error) {
	root, stage, label := Text(d["story_id"]), Text(d["stage"]), strings.TrimSpace(Text(d["label"]))
	if label == "" || len([]rune(label)) > 200 {
		return nil, fmt.Errorf("请填写版本名称（最多200字）")
	}
	previous := map[string]string{"script": "script", "boards": "script", "voice": "script", "video": "boards"}
	if _, ok := previous[stage]; !ok {
		return nil, fmt.Errorf("未知制作阶段")
	}
	source := Text(d["source_id"])
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	story, err := one(query(ctx, tx, "SELECT type FROM entities WHERE id=? AND archived=0", root))
	if err != nil || story["type"] != "story" {
		return nil, fmt.Errorf("故事不存在")
	}
	var sourceArg any
	if source != "" {
		node, err := one(query(ctx, tx, "SELECT * FROM studio_workflow WHERE id=?", source))
		if err != nil {
			return nil, err
		}
		if Text(node["story_id"]) != root || Text(node["stage"]) != previous[stage] {
			return nil, fmt.Errorf("来源必须属于同一故事的%s版本", previous[stage])
		}
		sourceArg = source
	} else if stage != "script" {
		return nil, fmt.Errorf("必须指定上游版本")
	}
	var prod any
	if id := Text(d["production_entity_id"]); id != "" {
		var n int
		if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM studio_story_members WHERE entity_id=? AND story_id=?", id, root).Scan(&n); err != nil {
			return nil, err
		}
		if n == 0 {
			return nil, fmt.Errorf("制作空间必须属于当前故事")
		}
		prod = id
	}
	snapshot := copyMap(Map(d["snapshot"]))
	id := ID("workflow")
	_, err = tx.ExecContext(ctx, "INSERT INTO studio_workflow VALUES(?,?,?,?,?,?,?,?)", id, root, stage, label, sourceArg, prod, JSON(snapshot), Now())
	if err != nil {
		return nil, err
	}
	if err = s.event(ctx, tx, "workflow.create", root, nil, Record{"id": id, "stage": stage, "label": label, "source_id": source, "snapshot": snapshot}, "新增不可变制作版本"); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return s.Workflow(ctx, root)
}
