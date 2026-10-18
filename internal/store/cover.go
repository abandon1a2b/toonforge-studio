package store

import (
	"context"
	"fmt"
)

func (s *Store) SetCover(ctx context.Context, d Record) (Record, error) {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	entity, e := one(query(ctx, tx, "SELECT * FROM entities WHERE id=?", d["id"]))
	if e != nil {
		return nil, e
	}
	if Number(entity["version"]) != Number(d["expected_version"]) {
		return nil, &Conflict{"资料已改变，请刷新后设置封面"}
	}
	aid := Text(d["artifact_id"])
	if aid != "" {
		a, e := one(query(ctx, tx, "SELECT a.media_type,r.entity_id,e.parent_id FROM artifacts a JOIN revisions r ON r.id=a.revision_id JOIN entities e ON e.id=r.entity_id WHERE a.id=?", aid))
		if e != nil {
			return nil, e
		}
		if a["media_type"] != "image" || (a["entity_id"] != entity["id"] && a["parent_id"] != entity["id"]) {
			return nil, fmt.Errorf("封面须为本对象或其造型的图片")
		}
	}
	decode(entity, "metadata_json", "metadata")
	m := Map(entity["metadata"])
	m["cover_artifact_id"] = aid
	if _, e = tx.ExecContext(ctx, "UPDATE entities SET metadata_json=?,version=version+1 WHERE id=?", JSON(m), entity["id"]); e != nil {
		return nil, e
	}
	if _, e = s.revision(ctx, tx, Text(entity["id"]), "封面调整", m, "draft"); e != nil {
		return nil, e
	}
	if e = s.event(ctx, tx, "entity.cover", Text(entity["id"]), nil, d, ""); e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return s.Entity(ctx, Text(entity["id"]))
}
