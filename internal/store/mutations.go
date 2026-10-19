package store

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"regexp"
	"strings"
)

func validTags(v any) ([]string, error) {
	items := Strings(v)
	if len(items) > 80 {
		return nil, fmt.Errorf("标签最多80项")
	}
	if v != nil {
		switch raw := v.(type) {
		case []string:
		case []any:
			if len(raw) != len(items) {
				return nil, fmt.Errorf("标签必须是字符串数组")
			}
		default:
			return nil, fmt.Errorf("标签必须是字符串数组")
		}
	}
	out := []string{}
	seen := map[string]bool{}
	for _, t := range items {
		t = strings.TrimSpace(t)
		if t == "" || len([]rune(t)) > 100 {
			return nil, fmt.Errorf("标签不能为空且不超过100字")
		}
		if !seen[t] {
			out = append(out, t)
			seen[t] = true
		}
	}
	return out, nil
}
func validProfile(kind string, m Record) error {
	if len(JSON(m)) > 200000 {
		return fmt.Errorf("资料超过200KB")
	}
	if kind == "character" {
		p := Map(m["physical"])
		h := Map(p["height_cm"])
		_, hasValue := h["value"]
		_, hasSource := h["source"]
		if !hasValue || !hasSource || h["unit"] != "cm" || Text(h["status"]) == "" {
			return fmt.Errorf("身高需要value、unit:cm、status和source；未知值可为空")
		}
		if h["value"] != nil {
			v, ok := h["value"].(float64)
			if !ok || v <= 0 || math.IsNaN(v) || math.IsInf(v, 0) || h["source"] == nil || h["source"] == "" {
				return fmt.Errorf("身高必须为正数并填写依据")
			}
		}
	}
	return nil
}
func (s *Store) tags(ctx context.Context, tx *sql.Tx, id string, tags []string) error {
	if _, e := tx.ExecContext(ctx, "DELETE FROM entity_tags WHERE entity_id=?", id); e != nil {
		return e
	}
	for _, t := range tags {
		ns, label := "user", t
		if a, b, ok := strings.Cut(t, ":"); ok {
			ns, label = a, b
		}
		tid := "tag:" + ns + ":" + label
		if _, e := tx.ExecContext(ctx, "INSERT OR IGNORE INTO tags VALUES(?,?,?)", tid, ns, label); e != nil {
			return e
		}
		if e := tx.QueryRowContext(ctx, "SELECT id FROM tags WHERE namespace=? AND label=?", ns, label).Scan(&tid); e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, "INSERT INTO entity_tags VALUES(?,?)", id, tid); e != nil {
			return e
		}
	}
	return nil
}
func (s *Store) event(ctx context.Context, tx *sql.Tx, action, scope string, before, after any, reason string) error {
	var target any
	if scope != "" {
		target = scope
	}
	_, e := tx.ExecContext(ctx, "INSERT INTO audit_events VALUES(?,?,?,?,?,?,?,?,?)", ID("event"), ID("operation"), s.Actor, action, reason, target, JSON(before), JSON(after), Now())
	return e
}
func (s *Store) revision(ctx context.Context, tx *sql.Tx, eid, label string, snapshot Record, status string) (string, error) {
	rid := ID("rev")
	var parent any
	rows, e := query(ctx, tx, "SELECT id FROM revisions WHERE entity_id=? ORDER BY rowid DESC LIMIT 1", eid)
	if e != nil {
		return "", e
	}
	if len(rows) > 0 {
		parent = rows[0]["id"]
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO revisions VALUES(?,?,?,?,?,?,?,?,?,?)", rid, eid, parent, label+" · "+rid[len(rid)-8:], status, JSON(snapshot), "{}", Now(), s.Actor, nil)
	return rid, e
}
func (s *Store) Create(ctx context.Context, d Record) (Record, error) {
	kind, name := Text(d["type"]), strings.TrimSpace(Text(d["name"]))
	if !kinds[kind] || kind == "style" || name == "" || len([]rune(name)) > 200 {
		return nil, fmt.Errorf("名称或资料类型无效")
	}
	m := copyMap(Map(d["metadata"]))
	if err := validProfile(kind, m); err != nil {
		return nil, err
	}
	tags, e := validTags(d["tags"])
	if e != nil {
		return nil, e
	}
	id := ID(kind)
	m["name"] = name
	m["tags"] = tags
	if m["id"] == nil {
		m["id"] = strings.TrimPrefix(id, kind+":")
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	parent := Text(d["parent"])
	var p any
	if parent != "" {
		row, e := one(query(ctx, tx, "SELECT * FROM entities WHERE id=?", parent))
		if e != nil {
			return nil, fmt.Errorf("父对象不存在")
		}
		expected := ""
		if kind == "look" {
			expected = "character"
		}
		if kind == "shot" || kind == "clip" {
			expected = "story"
		}
		if expected != "" && row["type"] != expected {
			return nil, fmt.Errorf("父对象类型应为%s", expected)
		}
		p = parent
	} else if kind == "look" || kind == "shot" || kind == "clip" {
		return nil, fmt.Errorf("该类对象必须指定归属")
	}
	if _, e = tx.ExecContext(ctx, "INSERT INTO entities(id,project_id,type,name,parent_id,metadata_json) VALUES(?,?,?,?,?,?)", id, "project", kind, name, p, JSON(m)); e != nil {
		return nil, e
	}
	if e = s.tags(ctx, tx, id, tags); e != nil {
		return nil, e
	}
	if _, e = s.revision(ctx, tx, id, "新建资料", m, "draft"); e != nil {
		return nil, e
	}
	if e = s.event(ctx, tx, "entity.create", id, nil, m, ""); e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return s.Entity(ctx, id)
}
func (s *Store) Update(ctx context.Context, d Record) (Record, error) {
	id := Text(d["id"])
	name := strings.TrimSpace(Text(d["name"]))
	if name == "" || len([]rune(name)) > 200 {
		return nil, fmt.Errorf("名称无效")
	}
	tags, e := validTags(d["tags"])
	if e != nil {
		return nil, e
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	old, e := one(query(ctx, tx, "SELECT * FROM entities WHERE id=?", id))
	if e != nil {
		return nil, e
	}
	if Number(d["expected_version"]) != Number(old["version"]) {
		return nil, &Conflict{"资料已被其他窗口修改，请刷新并合并"}
	}
	decode(old, "metadata_json", "metadata")
	before := Map(old["metadata"])
	m := copyMap(Map(d["metadata"]))
	if e = validProfile(Text(old["type"]), m); e != nil {
		return nil, e
	}
	for _, k := range []string{"id", "_legacy_source", "_legacy_hash"} {
		if v, ok := before[k]; ok {
			m[k] = v
		}
	}
	m["name"] = name
	m["tags"] = tags
	if old["type"] == "story" {
		if _, ok := m["title"]; ok {
			m["title"] = name
		}
	}
	reason := Text(d["reason"])
	if reason == "" {
		reason = "资料修订"
	}
	if _, e = tx.ExecContext(ctx, "UPDATE entities SET name=?,metadata_json=?,version=version+1 WHERE id=?", name, JSON(m), id); e != nil {
		return nil, e
	}
	if e = s.tags(ctx, tx, id, tags); e != nil {
		return nil, e
	}
	if _, e = s.revision(ctx, tx, id, reason, m, "draft"); e != nil {
		return nil, e
	}
	if e = s.event(ctx, tx, "entity.update", id, before, m, reason); e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return s.Entity(ctx, id)
}
func (s *Store) Archive(ctx context.Context, d Record) (Record, error) {
	id := Text(d["id"])
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	old, e := one(query(ctx, tx, "SELECT * FROM entities WHERE id=?", id))
	if e != nil {
		return nil, e
	}
	if Number(d["expected_version"]) != Number(old["version"]) {
		return nil, &Conflict{"资料已变化，请刷新"}
	}
	value := 0
	if d["archived"] == true {
		value = 1
	}
	if _, e = tx.ExecContext(ctx, "UPDATE entities SET archived=?,version=version+1 WHERE id=?", value, id); e != nil {
		return nil, e
	}
	if e = s.event(ctx, tx, "entity.archive", id, old["archived"], value, Text(d["reason"])); e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return s.Entity(ctx, id)
}
func (s *Store) Annotate(ctx context.Context, d Record) (Record, error) {
	id, role := Text(d["id"]), Text(d["role"])
	if !Roles[role] {
		return nil, fmt.Errorf("分类无效")
	}
	tags, e := validTags(d["tags"])
	if e != nil {
		return nil, e
	}
	note := Text(d["note"])
	if len(note) > 10000 {
		return nil, fmt.Errorf("备注过长")
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	a, e := one(query(ctx, tx, "SELECT a.*,r.entity_id FROM artifacts a JOIN revisions r ON r.id=a.revision_id WHERE a.id=?", id))
	if e != nil {
		return nil, e
	}
	decode(a, "metadata_json", "metadata")
	m := Map(a["metadata"])
	v := Number(m["metadata_version"])
	if v == 0 {
		v = 1
	}
	if Number(d["expected_version"]) != v {
		return nil, &Conflict{"素材标记已改变，请刷新"}
	}
	before := copyMap(m)
	m["tags"] = tags
	m["note"] = note
	m["metadata_version"] = v + 1
	if _, e = tx.ExecContext(ctx, "UPDATE artifacts SET role=?,metadata_json=? WHERE id=?", role, JSON(m), id); e != nil {
		return nil, e
	}
	if e = s.event(ctx, tx, "artifact.annotate", Text(a["entity_id"]), before, m, ""); e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return s.Artifact(ctx, id)
}
func (s *Store) Review(ctx context.Context, d Record) (Record, error) {
	id, status := Text(d["id"]), Text(d["status"])
	if status != "draft" && status != "pending_review" && status != "needs_changes" && status != "accepted" {
		return nil, fmt.Errorf("审阅状态无效")
	}
	evidence := Text(d["evidence"])
	if status == "accepted" && len([]rune(strings.TrimSpace(evidence))) < 4 {
		return nil, fmt.Errorf("确认可用需要填写用户验收依据")
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	old, e := one(query(ctx, tx, "SELECT * FROM revisions WHERE id=?", id))
	if e != nil {
		return nil, e
	}
	if expected := Text(d["expected_status"]); expected != "" && expected != old["status"] {
		return nil, &Conflict{"审阅状态已改变"}
	}
	var proof any
	if status == "accepted" {
		proof = evidence
	}
	if _, e = tx.ExecContext(ctx, "UPDATE revisions SET status=?,acceptance_evidence=? WHERE id=?", status, proof, id); e != nil {
		return nil, e
	}
	if e = s.event(ctx, tx, "revision.review", Text(old["entity_id"]), Record{"status": old["status"], "evidence": old["acceptance_evidence"]}, d, ""); e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return Record{"revision_id": id, "status": status}, nil
}
func (s *Store) Selections(ctx context.Context, scope string) (Record, error) {
	r, e := s.Query(ctx, "SELECT s.*,r.entity_id,r.status,e.name,r.label FROM selections s JOIN revisions r ON r.id=s.revision_id JOIN entities e ON e.id=r.entity_id WHERE s.scope_entity_id=? ORDER BY slot", scope)
	return Record{"items": r}, e
}

var slotPattern = regexp.MustCompile(`^[^.\s]+(?:\.[^.\s]+)+$`)

func (s *Store) Select(ctx context.Context, d Record) (Record, error) {
	scope, slot, rid := Text(d["scope"]), Text(d["slot"]), Text(d["revision_id"])
	if !slotPattern.MatchString(slot) || len(slot) > 200 {
		return nil, fmt.Errorf("选用用途无效")
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	target, e := one(query(ctx, tx, "SELECT * FROM entities WHERE id=?", scope))
	if e != nil || target["type"] != "story" {
		return nil, fmt.Errorf("选用范围必须为剧本")
	}
	rev, e := one(query(ctx, tx, "SELECT r.*,e.type,e.parent_id,e.metadata_json FROM revisions r JOIN entities e ON e.id=r.entity_id WHERE r.id=?", rid))
	if e != nil {
		return nil, e
	}
	if rev["status"] == "needs_changes" {
		return nil, fmt.Errorf("需修改版本不能新增选用")
	}
	decode(rev, "metadata_json", "owner")
	parts := strings.Split(slot, ".")
	switch parts[0] {
	case "character":
		if len(parts) != 3 || (parts[2] != "look" && parts[2] != "profile") || (rev["type"] != "character" && rev["type"] != "look") {
			return nil, fmt.Errorf("角色版本与用途不符")
		}
		owner := rev
		if rev["type"] == "look" {
			p, e2 := one(query(ctx, tx, "SELECT id,metadata_json FROM entities WHERE id=?", rev["parent_id"]))
			if e2 != nil {
				return nil, e2
			}
			decode(p, "metadata_json", "owner")
			owner = p
		}
		cid := Text(Map(owner["owner"])["id"])
		if cid == "" {
			cid = strings.TrimPrefix(Text(owner["entity_id"]), "character:")
		}
		if parts[1] != cid {
			return nil, fmt.Errorf("不能选用其他角色的版本")
		}
	case "scene":
		sid := Text(Map(rev["owner"])["id"])
		if sid == "" {
			sid = strings.TrimPrefix(Text(rev["entity_id"]), "scene:")
		}
		if rev["type"] != "scene" || slot != "scene."+sid {
			return nil, fmt.Errorf("场景版本与用途不符")
		}
	case "board", "voice":
		if rev["entity_id"] != scope {
			return nil, fmt.Errorf("分镜或配音必须属于本篇")
		}
		role := "board"
		if parts[0] == "voice" {
			role = "voice"
		}
		a, err := query(ctx, tx, "SELECT id FROM artifacts WHERE revision_id=? AND role=?", rid, role)
		if err != nil {
			return nil, err
		}
		if len(a) == 0 {
			return nil, fmt.Errorf("素材分类与用途不符")
		}
	case "mix":
		if rev["type"] != "mix" || rev["parent_id"] != scope {
			return nil, fmt.Errorf("混音必须属于本篇")
		}
	case "reference":
	default:
		return nil, fmt.Errorf("未知选用用途")
	}
	old, e := query(ctx, tx, "SELECT * FROM selections WHERE scope_entity_id=? AND slot=?", scope, slot)
	if e != nil {
		return nil, e
	}
	v := 0
	var before any
	if len(old) > 0 {
		v = Number(old[0]["version"])
		before = old[0]
	}
	if Number(d["expected_version"]) != v {
		return nil, &Conflict{"本篇选用已变化，请重新比较"}
	}
	if _, e = tx.ExecContext(ctx, "INSERT OR REPLACE INTO selections VALUES(?,?,?,?,?,?)", scope, slot, rid, v+1, s.Actor, Now()); e != nil {
		return nil, e
	}
	if e = s.event(ctx, tx, "selection.set", scope, before, d, Text(d["reason"])); e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return Record{"scope": scope, "slot": slot, "revision_id": rid, "version": v + 1}, nil
}
func (s *Store) Issues(ctx context.Context, entity, status string) (Record, error) {
	where := "1=1"
	args := []any{}
	if entity != "" {
		where += " AND (r.entity_id=? OR e.parent_id=?)"
		args = append(args, entity, entity)
	}
	if status != "" {
		where += " AND i.status=?"
		args = append(args, status)
	}
	r, e := s.Query(ctx, "SELECT i.*,r.entity_id,e.name FROM issues i JOIN revisions r ON r.id=i.revision_id JOIN entities e ON e.id=r.entity_id WHERE "+where+" ORDER BY i.rowid DESC", args...)
	return Record{"items": r}, e
}
func (s *Store) SaveIssue(ctx context.Context, d Record) (Record, error) {
	rid, body, status, severity := Text(d["revision_id"]), strings.TrimSpace(Text(d["body"])), Text(d["status"]), Text(d["severity"])
	if status == "" {
		status = "open"
	}
	if severity == "" {
		severity = "minor"
	}
	if body == "" || len(body) > 10000 || !map[string]bool{"open": true, "in_progress": true, "resolved": true, "verified": true}[status] || !map[string]bool{"note": true, "minor": true, "major": true, "blocking": true}[severity] {
		return nil, fmt.Errorf("问题内容或状态无效")
	}
	evidence := Text(d["evidence"])
	if status == "verified" && len([]rune(strings.TrimSpace(evidence))) < 4 {
		return nil, fmt.Errorf("复核需要用户确认依据")
	}
	start, end := d["start_ms"], d["end_ms"]
	if start != nil && Number(start) < 0 || end != nil && (start == nil || Number(end) < Number(start)) {
		return nil, fmt.Errorf("时间区间无效")
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	rev, e := one(query(ctx, tx, "SELECT entity_id FROM revisions WHERE id=?", rid))
	if e != nil {
		return nil, e
	}
	id := Text(d["id"])
	version := 1
	var before any
	if id != "" {
		old, e := one(query(ctx, tx, "SELECT * FROM issues WHERE id=?", id))
		if e != nil {
			return nil, e
		}
		if old["revision_id"] != rid {
			return nil, fmt.Errorf("不能将问题移到其他版本")
		}
		if Number(d["expected_version"]) != Number(old["version"]) {
			return nil, &Conflict{"问题已被修改，请刷新"}
		}
		version = Number(old["version"]) + 1
		before = old
		_, e = tx.ExecContext(ctx, "UPDATE issues SET body=?,severity=?,status=?,start_ms=?,end_ms=?,verification_evidence=?,version=? WHERE id=?", body, severity, status, start, end, evidence, version, id)
		if e != nil {
			return nil, e
		}
	} else {
		id = ID("issue")
		if _, e = tx.ExecContext(ctx, "INSERT INTO issues VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", id, rid, nil, start, end, status, severity, body, s.Actor, 1, Now(), evidence); e != nil {
			return nil, e
		}
	}
	if e = s.event(ctx, tx, "issue.save", Text(rev["entity_id"]), before, d, ""); e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return Record{"id": id, "status": status, "version": version}, nil
}
func (s *Store) Overview(ctx context.Context) (Record, error) {
	rows, e := s.Query(ctx, "SELECT type,count(*) n FROM entities e WHERE archived=0 AND NOT EXISTS(SELECT 1 FROM studio_story_members sm WHERE sm.entity_id=e.id AND sm.story_id<>e.id) GROUP BY type")
	if e != nil {
		return nil, e
	}
	counts := Record{}
	for _, r := range rows {
		counts[Text(r["type"])] = r["n"]
	}
	var total, pending int
	_ = s.DB.QueryRowContext(ctx, "SELECT count(*) FROM artifacts").Scan(&total)
	_ = s.DB.QueryRowContext(ctx, "SELECT count(*) FROM pending_imports").Scan(&pending)
	a, e := s.Artifacts(ctx, Filter{Limit: 1})
	if e != nil {
		return nil, e
	}
	stories, e := s.Entities(ctx, Filter{Type: "story"})
	if e != nil {
		return nil, e
	}
	issues, e := s.Issues(ctx, "", "")
	if e != nil {
		return nil, e
	}
	recent, _ := s.Query(ctx, "SELECT e.* FROM studio_recent r JOIN entities e ON e.id=r.entity_id WHERE e.archived=0 ORDER BY r.visited_at DESC LIMIT 8")
	for _, r := range recent {
		_ = s.enrich(ctx, r, true)
	}
	return Record{"project": s.Root[strings.LastIndex(s.Root, string('/'))+1:], "root": s.Root, "counts": counts, "artifacts": total, "visible_artifacts": a.Total, "pending_imports": pending, "stories": stories.Items, "issues": issues["items"], "recent": recent, "engine": "go", "version": "0.2.0"}, nil
}
func (s *Store) Visit(ctx context.Context, id string) error {
	_, e := s.DB.ExecContext(ctx, "INSERT OR REPLACE INTO studio_recent VALUES(?,?)", id, Now())
	return e
}
func (s *Store) Events(ctx context.Context) (Record, error) {
	r, e := s.Query(ctx, "SELECT a.*,e.name entity_name FROM audit_events a LEFT JOIN entities e ON e.id=a.scope_entity_id ORDER BY a.rowid DESC LIMIT 200")
	return Record{"items": r}, e
}
func (s *Store) TagList(ctx context.Context) (Record, error) {
	r, e := s.Query(ctx, "SELECT t.*,count(et.entity_id) count FROM tags t LEFT JOIN entity_tags et ON et.tag_id=t.id GROUP BY t.id ORDER BY t.namespace,t.label")
	return Record{"items": r}, e
}
func (s *Store) Settings(ctx context.Context) (Record, error) {
	r, e := s.Query(ctx, "SELECT key,value FROM settings WHERE key LIKE 'studio.%'")
	out := Record{}
	for _, v := range r {
		out[Text(v["key"])] = v["value"]
	}
	return out, e
}
func (s *Store) Setting(ctx context.Context, key, value string) error {
	if !strings.HasPrefix(key, "studio.") || len(value) > 20000 {
		return fmt.Errorf("设置无效")
	}
	_, e := s.DB.ExecContext(ctx, "INSERT OR REPLACE INTO settings VALUES(?,?)", key, value)
	return e
}
