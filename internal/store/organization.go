package store

import (
	"context"
	"fmt"
	"strings"
)

func (s *Store) RenameTag(ctx context.Context, d Record) (Record, error) {
	id, name := Text(d["id"]), strings.TrimSpace(Text(d["name"]))
	if name == "" || len([]rune(name)) > 100 {
		return nil, fmt.Errorf("标签名称无效")
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	old, e := one(query(ctx, tx, "SELECT * FROM tags WHERE id=?", id))
	if e != nil {
		return nil, e
	}
	affected, e := query(ctx, tx, "SELECT e.* FROM entities e JOIN entity_tags t ON t.entity_id=e.id WHERE t.tag_id=?", id)
	if e != nil {
		return nil, e
	}
	target, e := query(ctx, tx, "SELECT id FROM tags WHERE namespace=? AND label=?", old["namespace"], name)
	if e != nil {
		return nil, e
	}
	if len(target) > 0 && target[0]["id"] != id {
		if d["merge"] != true {
			return nil, fmt.Errorf("同名标签已存在，请明确合并")
		}
		to := target[0]["id"]
		if _, e = tx.ExecContext(ctx, "INSERT OR IGNORE INTO entity_tags(entity_id,tag_id) SELECT entity_id,? FROM entity_tags WHERE tag_id=?", to, id); e != nil {
			return nil, e
		}
		if _, e = tx.ExecContext(ctx, "DELETE FROM entity_tags WHERE tag_id=?", id); e != nil {
			return nil, e
		}
		if _, e = tx.ExecContext(ctx, "DELETE FROM tags WHERE id=?", id); e != nil {
			return nil, e
		}
	} else {
		if _, e = tx.ExecContext(ctx, "UPDATE tags SET label=? WHERE id=?", name, id); e != nil {
			return nil, e
		}
	}
	for _, entity := range affected {
		decode(entity, "metadata_json", "metadata")
		metadata := Map(entity["metadata"])
		rows, err := query(ctx, tx, "SELECT namespace,label FROM tags JOIN entity_tags ON tags.id=entity_tags.tag_id WHERE entity_id=? ORDER BY namespace,label", entity["id"])
		if err != nil {
			return nil, err
		}
		tags := []string{}
		for _, row := range rows {
			tag := Text(row["label"])
			if row["namespace"] != "user" {
				tag = Text(row["namespace"]) + ":" + tag
			}
			tags = append(tags, tag)
		}
		metadata["tags"] = tags
		if _, err = tx.ExecContext(ctx, "UPDATE entities SET metadata_json=?,version=version+1 WHERE id=?", JSON(metadata), entity["id"]); err != nil {
			return nil, err
		}
		if _, err = s.revision(ctx, tx, Text(entity["id"]), "标签调整", metadata, "draft"); err != nil {
			return nil, err
		}
	}
	if e = s.event(ctx, tx, "tag.rename", "", old, d, Text(d["reason"])); e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return Record{"ok": true}, nil
}
func (s *Store) Collections(ctx context.Context) (Record, error) {
	rows, e := s.Query(ctx, "SELECT c.*,count(i.entity_id) count FROM studio_collections c LEFT JOIN studio_collection_items i ON i.collection_id=c.id GROUP BY c.id ORDER BY c.name")
	if e != nil {
		return nil, e
	}
	for _, c := range rows {
		items, err := s.Query(ctx, "SELECT e.* FROM entities e JOIN studio_collection_items i ON i.entity_id=e.id WHERE i.collection_id=? ORDER BY e.name", c["id"])
		if err != nil {
			return nil, err
		}
		for _, item := range items {
			_ = s.enrich(ctx, item, true)
		}
		c["items"] = items
	}
	return Record{"items": rows}, nil
}
func (s *Store) SaveCollection(ctx context.Context, d Record) (Record, error) {
	id, name := Text(d["id"]), strings.TrimSpace(Text(d["name"]))
	if name == "" {
		return nil, fmt.Errorf("分组名称不能为空")
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	if id == "" {
		id = ID("collection")
		_, e = tx.ExecContext(ctx, "INSERT INTO studio_collections VALUES(?,?,?)", id, name, Now())
	} else {
		res, err := tx.ExecContext(ctx, "UPDATE studio_collections SET name=? WHERE id=?", name, id)
		e = err
		if e == nil {
			n, _ := res.RowsAffected()
			if n == 0 {
				return nil, ErrNotFound
			}
		}
	}
	if e != nil {
		return nil, e
	}
	if items, ok := d["entity_ids"]; ok {
		if _, e = tx.ExecContext(ctx, "DELETE FROM studio_collection_items WHERE collection_id=?", id); e != nil {
			return nil, e
		}
		for _, eid := range Strings(items) {
			if _, e = tx.ExecContext(ctx, "INSERT INTO studio_collection_items VALUES(?,?)", id, eid); e != nil {
				return nil, e
			}
		}
	}
	if e = s.event(ctx, tx, "collection.save", "", nil, d, ""); e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return Record{"id": id, "name": name}, nil
}
