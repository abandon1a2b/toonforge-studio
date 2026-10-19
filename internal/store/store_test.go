package store

import (
	"context"
	"errors"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

var testctx = context.Background()

func fixture(t *testing.T) *Store {
	t.Helper()
	s, e := Open(t.TempDir(), "test")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
func create(t *testing.T, s *Store, kind, name string, m Record) Record {
	t.Helper()
	r, e := s.Create(testctx, Record{"type": kind, "name": name, "metadata": m, "tags": []string{"测试"}})
	if e != nil {
		t.Fatal(e)
	}
	return r
}
func pngFile(t *testing.T, s *Store, name string) string {
	t.Helper()
	p := filepath.Join(s.Root, name)
	f, e := os.Create(p)
	if e != nil {
		t.Fatal(e)
	}
	if e = png.Encode(f, image.NewRGBA(image.Rect(0, 0, 24, 16))); e != nil {
		t.Fatal(e)
	}
	f.Close()
	return name
}
func TestMetadataConflictAndTagRename(t *testing.T) {
	s := fixture(t)
	if _, e := s.Create(testctx, Record{"type": "character", "name": "Unknown"}); e == nil {
		t.Fatal("missing physical height accepted")
	}
	m := Record{"physical": Record{"height_cm": Record{"value": nil, "unit": "cm", "status": "unknown", "source": nil}}}
	r := create(t, s, "character", "角色", m)
	tags, e := s.TagList(testctx)
	if e != nil {
		t.Fatal(e)
	}
	tag := tags["items"].([]Record)[0]
	if _, e = s.RenameTag(testctx, Record{"id": tag["id"], "name": "新标签"}); e != nil {
		t.Fatal(e)
	}
	_, e = s.Update(testctx, Record{"id": r["id"], "name": "覆盖", "metadata": m, "tags": []string{"测试"}, "expected_version": r["version"]})
	var conflict *Conflict
	if !errors.As(e, &conflict) {
		t.Fatalf("stale editor must conflict: %v", e)
	}
	now, e := s.Entity(testctx, Text(r["id"]))
	if e != nil {
		t.Fatal(e)
	}
	if Strings(now["tags"])[0] != "新标签" {
		t.Fatal(now)
	}
	if _, e = s.Create(testctx, Record{"type": "look", "name": "错误归属", "parent": r["id"], "metadata": Record{}}); e != nil {
		t.Fatal(e)
	}
	many := make([]string, 81)
	if _, e = validTags(many); e == nil {
		t.Fatal("oversized tags accepted")
	}
}
func TestImmutableMediaPinnedVersionAndRestore(t *testing.T) {
	s := fixture(t)
	scene := create(t, s, "scene", "办公室", Record{"id": "office"})
	story := create(t, s, "story", "故事", Record{})
	name := pngFile(t, s, "first.png")
	a, e := s.Register(testctx, Record{"entity_id": scene["id"], "path": name, "role": "reference"})
	if e != nil {
		t.Fatal(e)
	}
	pin := Record{"scope": story["id"], "slot": "scene.office", "revision_id": a["revision_id"], "expected_version": 0}
	if _, e = s.Select(testctx, pin); e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(filepath.Join(s.Root, name), []byte("source replaced"), 0644); e != nil {
		t.Fatal(e)
	}
	obj, e := s.ObjectPath(a)
	if e != nil {
		t.Fatal(e)
	}
	hash, e := Digest(obj)
	if e != nil || hash != a["sha256"] {
		t.Fatal("immutable snapshot changed", e)
	}
	b, e := s.Register(testctx, Record{"entity_id": scene["id"], "path": pngFile(t, s, "second.png"), "role": "reference"})
	if e != nil {
		t.Fatal(e)
	}
	sels, e := s.Selections(testctx, Text(story["id"]))
	if e != nil {
		t.Fatal(e)
	}
	if sels["items"].([]Record)[0]["revision_id"] != a["revision_id"] {
		t.Fatal("pin followed latest")
	}
	if _, e = s.Review(testctx, Record{"revision_id": b["revision_id"], "status": "accepted"}); e == nil {
		t.Fatal("acceptance without evidence")
	}
	backup, e := s.Backup(testctx, true)
	if e != nil {
		t.Fatal(e)
	}
	dst := filepath.Join(t.TempDir(), "restore")
	restored, e := Restore(testctx, Text(backup["directory"]), dst)
	if e != nil {
		t.Fatal(e)
	}
	if restored["ok"] != true {
		t.Fatal(restored)
	}
	if _, e = Restore(testctx, Text(backup["directory"]), dst); e == nil {
		t.Fatal("restored over nonempty directory")
	}
	if _, e = s.SafeFile("../secret.png", true); e == nil {
		t.Fatal("traversal accepted")
	}
	outside := filepath.Join(t.TempDir(), "outside.png")
	os.WriteFile(outside, []byte("outside"), 0644)
	os.Symlink(outside, filepath.Join(s.Root, "escape.png"))
	if _, e = s.SafeFile("escape.png", true); e == nil {
		t.Fatal("symlink escape accepted")
	}
}
func TestJobCancelAndPendingImport(t *testing.T) {
	s := fixture(t)
	job, e := s.CreateJob(testctx, "health", Record{})
	if e != nil {
		t.Fatal(e)
	}
	if e = NewWorker(s).Cancel(testctx, Text(job["id"])); e != nil {
		t.Fatal(e)
	}
	jobs, e := s.Jobs(testctx)
	if e != nil {
		t.Fatal(e)
	}
	if jobs["items"].([]Record)[0]["status"] != "cancelled" {
		t.Fatal(jobs)
	}
	p := filepath.Join(s.Root, "scene.yaml")
	os.WriteFile(p, []byte("id: room\nname: Original\n"), 0644)
	id, e := s.importProfile(testctx, p, "scene", "scene:room", "")
	if e != nil {
		t.Fatal(e)
	}
	os.WriteFile(p, []byte("id: room\nname: Changed externally\n"), 0644)
	if _, e = s.importProfile(testctx, p, "scene", "scene:room", ""); e != nil {
		t.Fatal(e)
	}
	r, _ := s.Entity(testctx, id)
	if r["name"] != "Original" {
		t.Fatal("external source silently overwrote managed metadata")
	}
	pending, _ := s.Pending(testctx)
	items := pending["items"].([]Record)
	if len(items) != 1 {
		t.Fatal(pending)
	}
	if _, e = s.ApplyPending(testctx, Record{"id": items[0]["id"], "expected_version": r["version"]}); e != nil {
		t.Fatal(e)
	}
	r, _ = s.Entity(testctx, id)
	if r["name"] != "Changed externally" {
		t.Fatal(r)
	}
}

func TestStructuredStoryImportPreservesEdits(t *testing.T) {
	s := fixture(t)
	folder := filepath.Join(s.Root, "stories", "demo", "storyboard")
	os.MkdirAll(folder, 0755)
	os.WriteFile(filepath.Join(folder, "shots.json"), []byte(`{"shots":[{"shot_id":"shot-001","title":"入口","direction":"固定机位"}]}`), 0644)
	story := create(t, s, "story", "Demo", Record{"_legacy_source": "stories/demo/story.yaml", "shot_list": "storyboard/shots.json"})
	if e := s.importStoryChildren(testctx, story); e != nil {
		t.Fatal(e)
	}
	entity, _ := s.Entity(testctx, Text(story["id"]))
	children := entity["children"].([]Record)
	if len(children) != 1 {
		t.Fatal(children)
	}
	if e := s.importStoryChildren(testctx, story); e != nil {
		t.Fatal(e)
	}
	entity, _ = s.Entity(testctx, Text(story["id"]))
	if len(entity["children"].([]Record)) != 1 {
		t.Fatal("duplicate shots")
	}
}

func TestReferenceContextExpandsContinuousShots(t *testing.T) {
	s := fixture(t)
	story := create(t, s, "story", "连续镜头", Record{})
	for _, sid := range []string{"shot-014", "shot-015"} {
		_, e := s.Create(testctx, Record{"type": "shot", "name": sid, "parent": story["id"], "metadata": Record{"legacy_shot_id": sid, "characters": []string{}, "scene_id": "office"}})
		if e != nil {
			t.Fatal(e)
		}
	}
	_, e := s.Create(testctx, Record{"type": "clip", "name": "连续片段", "parent": story["id"], "metadata": Record{"shots": []string{"shot-014", "shot-015"}}})
	if e != nil {
		t.Fatal(e)
	}
	pack, e := s.Context(testctx, Text(story["id"]), []string{"shot-014"}, "video")
	if e != nil {
		t.Fatal(e)
	}
	if len(Strings(pack["expanded_shots"])) != 2 {
		t.Fatal(pack)
	}
	if pack["ready"] == true {
		t.Fatal("missing scene should block ready")
	}
}
func TestCoverOwnershipAndConflict(t *testing.T) {
	s := fixture(t)
	one := create(t, s, "scene", "A", Record{})
	two := create(t, s, "scene", "B", Record{})
	a, e := s.Register(testctx, Record{"entity_id": one["id"], "path": pngFile(t, s, "cover.png"), "role": "scene"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.SetCover(testctx, Record{"id": two["id"], "artifact_id": a["id"], "expected_version": two["version"]}); e == nil {
		t.Fatal("cross entity cover accepted")
	}
	r, e := s.SetCover(testctx, Record{"id": one["id"], "artifact_id": a["id"], "expected_version": one["version"]})
	if e != nil {
		t.Fatal(e)
	}
	if r["cover_artifact_id"] != a["id"] {
		t.Fatal(r)
	}
}

func TestCharacterDefaultsToTurnaroundAndKeepsExplicitCover(t *testing.T) {
	s := fixture(t)
	c := create(t, s, "character", "角色", Record{"physical": Record{"height_cm": Record{"value": nil, "unit": "cm", "status": "unknown", "source": nil}}})
	sheet, err := s.Register(testctx, Record{"entity_id": c["id"], "path": pngFile(t, s, "sheet.png"), "role": "turnaround"})
	if err != nil {
		t.Fatal(err)
	}
	portrait, err := s.Register(testctx, Record{"entity_id": c["id"], "path": pngFile(t, s, "portrait.png"), "role": "portrait"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Register(testctx, Record{"entity_id": c["id"], "path": pngFile(t, s, "look.png"), "role": "look"}); err != nil {
		t.Fatal(err)
	}
	current, err := s.Entity(testctx, Text(c["id"]))
	if err != nil {
		t.Fatal(err)
	}
	if current["cover_artifact_id"] != sheet["id"] {
		t.Fatal("newer look replaced default turnaround", current["cover_artifact_id"])
	}
	if _, err = s.SetCover(testctx, Record{"id": c["id"], "artifact_id": portrait["id"], "expected_version": current["version"]}); err != nil {
		t.Fatal(err)
	}
	current, err = s.Entity(testctx, Text(c["id"]))
	if err != nil {
		t.Fatal(err)
	}
	if current["cover_artifact_id"] != portrait["id"] {
		t.Fatal("explicit default ignored")
	}
}
