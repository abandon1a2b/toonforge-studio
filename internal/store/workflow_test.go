package store

import (
	"context"
	"testing"
)

func TestStoryWorkflowVersions(t *testing.T) {
	ctx := context.Background()
	s, err := Open(t.TempDir(), "test")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	root, err := s.Create(ctx, Record{"type": "story", "name": "One story", "metadata": Record{}})
	if err != nil {
		t.Fatal(err)
	}
	rid := Text(root["id"])
	first, err := s.CreateWorkflowVersion(ctx, Record{"story_id": rid, "stage": "script", "label": "v1", "snapshot": Record{"text": "old dialogue"}})
	if err != nil {
		t.Fatal(err)
	}
	nodes := first["nodes"].([]Record)
	source := Text(Map(nodes[0])["id"])
	_, err = s.CreateWorkflowVersion(ctx, Record{"story_id": rid, "stage": "boards", "label": "boards1", "source_id": source, "snapshot": Record{"text": "wide shot"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.CreateWorkflowVersion(ctx, Record{"story_id": rid, "stage": "video", "label": "bad", "source_id": source}); err == nil {
		t.Fatal("video accepted script source")
	}
	other, _ := s.Create(ctx, Record{"type": "story", "name": "Other", "metadata": Record{}})
	if _, err = s.CreateWorkflowVersion(ctx, Record{"story_id": other["id"], "stage": "boards", "label": "bad", "source_id": source}); err == nil {
		t.Fatal("cross-story source accepted")
	}
	_, err = s.CreateWorkflowVersion(ctx, Record{"story_id": rid, "stage": "script", "label": "v2", "source_id": source, "snapshot": Record{"text": "new dialogue"}})
	if err != nil {
		t.Fatal(err)
	}
	out, err := s.Workflow(ctx, rid)
	if err != nil {
		t.Fatal(err)
	}
	if len(out["nodes"].([]Record)) != 3 {
		t.Fatal(out)
	}
	if Text(Map(out["nodes"].([]Record)[0]["snapshot"])["text"]) != "old dialogue" {
		t.Fatal("source changed")
	}
	if err = s.initWorkflow(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestLegacyStoriesAreGroupedWithoutChangingIDs(t *testing.T) {
	ctx := context.Background()
	s, err := Open(t.TempDir(), "test")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, id := range []string{"episode", "episode/adaptations/v2", "episode/adaptations/v3"} {
		_, err = s.DB.Exec("INSERT INTO entities(id,project_id,type,name,metadata_json) VALUES(?,'project','story',?,?)", "story:"+id, id, JSON(Record{"legacy_story_id": id, "script_version": "1", "shot_list": "missing.json"}))
		if err != nil {
			t.Fatal(err)
		}
	}
	if err = s.initWorkflow(ctx); err != nil {
		t.Fatal(err)
	}
	page, err := s.Entities(ctx, Filter{Type: "story"})
	if err != nil || page.Total != 1 {
		t.Fatalf("%+v %v", page, err)
	}
	out, err := s.Workflow(ctx, "story:episode/adaptations/v3")
	if err != nil {
		t.Fatal(err)
	}
	if len(out["nodes"].([]Record)) != 6 {
		t.Fatal(out)
	}
	if err = s.initWorkflow(ctx); err != nil {
		t.Fatal(err)
	}
	out, _ = s.Workflow(ctx, "story:episode")
	if len(out["nodes"].([]Record)) != 6 {
		t.Fatal("non-idempotent")
	}
	e, err := s.Entity(ctx, "story:episode/adaptations/v3")
	if err != nil || e["id"] != "story:episode/adaptations/v3" {
		t.Fatal("legacy ID changed")
	}
}
