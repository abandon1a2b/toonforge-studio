package store

import (
	"context"
	"fmt"
	"sort"
	"strings"
)

func (s *Store) Context(ctx context.Context, storyID string, shotIDs []string, purpose string) (Record, error) {
	if len(shotIDs) == 0 || len(shotIDs) > 200 {
		return nil, fmt.Errorf("请提供1至200个镜号")
	}
	if purpose != "image" && purpose != "audio" && purpose != "video" {
		return nil, fmt.Errorf("用途无效")
	}
	story, e := s.Entity(ctx, storyID)
	if e != nil {
		return nil, e
	}
	if story["type"] != "story" {
		return nil, fmt.Errorf("请选择剧本")
	}
	shots := map[string]Record{}
	clips := []Record{}
	for _, item := range story["children"].([]Record) {
		if item["type"] == "shot" {
			shots[Text(Map(item["metadata"])["legacy_shot_id"])] = item
		}
		if item["type"] == "clip" {
			clips = append(clips, Map(item["metadata"]))
		}
	}
	requested := []string{}
	seen := map[string]bool{}
	for _, id := range shotIDs {
		if shots[id] == nil {
			return nil, fmt.Errorf("镜号不存在：%s", id)
		}
		if !seen[id] {
			requested = append(requested, id)
			seen[id] = true
		}
	}
	groups := []Record{}
	groupSeen := map[string]bool{}
	for changed := true; changed; {
		changed = false
		for _, clip := range clips {
			ids := Strings(clip["shots"])
			match := false
			for _, id := range ids {
				if seen[id] {
					match = true
				}
			}
			if !match {
				continue
			}
			key := JSON(ids)
			if !groupSeen[key] {
				groups = append(groups, clip)
				groupSeen[key] = true
			}
			for _, id := range ids {
				if !seen[id] && shots[id] != nil {
					seen[id] = true
					requested = append(requested, id)
					changed = true
				}
			}
		}
	}
	cast, scenes, voices := map[string]bool{}, map[string]bool{}, map[string]bool{}
	payload := []Record{}
	for _, id := range requested {
		m := Map(shots[id]["metadata"])
		payload = append(payload, m)
		for _, c := range Strings(m["characters"]) {
			cast[c] = true
		}
		if scene := Text(m["scene_id"]); scene != "" {
			scenes[scene] = true
		}
		for _, v := range List(m["voices"]) {
			if cue := Text(Map(v)["cue_id"]); cue != "" {
				voices[cue] = true
			}
		}
	}
	selection, e := s.Selections(ctx, storyID)
	if e != nil {
		return nil, e
	}
	selected := selection["items"].([]Record)
	slots := map[string]bool{}
	for _, r := range selected {
		slots[Text(r["slot"])] = true
	}
	missing := []string{}
	if purpose != "audio" {
		for c := range cast {
			found := false
			for slot := range slots {
				if strings.HasPrefix(slot, "character."+c+".") {
					found = true
				}
			}
			if !found {
				missing = append(missing, "character."+c)
			}
		}
		for scene := range scenes {
			if !slots["scene."+scene] {
				missing = append(missing, "scene."+scene)
			}
		}
	}
	if purpose != "image" {
		for cue := range voices {
			if !slots["voice."+cue] {
				missing = append(missing, "voice."+cue)
			}
		}
	}
	refs := []Record{}
	for _, r := range selected {
		slot := Text(r["slot"])
		audio := strings.HasPrefix(slot, "mix.") || voices[strings.TrimPrefix(slot, "voice.")]
		visual := strings.HasPrefix(slot, "board.") || scenes[strings.TrimPrefix(slot, "scene.")]
		for cid := range cast {
			visual = visual || strings.HasPrefix(slot, "character."+cid+".")
		}
		if purpose == "audio" && !audio || purpose == "image" && !visual || purpose == "video" && !audio && !visual {
			continue
		}
		rev, e := one(s.Query(ctx, "SELECT * FROM revisions WHERE id=?", r["revision_id"]))
		if e != nil {
			return nil, e
		}
		decode(rev, "snapshot_json", "snapshot")
		a, e := s.Query(ctx, "SELECT id,relative_path,sha256,role FROM artifacts WHERE revision_id=?", r["revision_id"])
		if e != nil {
			return nil, e
		}
		r["snapshot"] = rev["snapshot"]
		r["artifacts"] = a
		if r["status"] == "needs_changes" {
			missing = append(missing, slot+".needs_changes")
		}
		eid := Text(r["entity_id"])
		if len(a) == 0 && (strings.HasPrefix(eid, "character:") || strings.HasPrefix(eid, "look:") || strings.HasPrefix(eid, "scene:")) {
			missing = append(missing, slot+".selected_media")
		}
		refs = append(refs, r)
	}
	sort.Strings(missing)
	return Record{"schema_version": 1, "story_id": storyID, "purpose": purpose, "requested_shots": shotIDs, "expanded_shots": requested, "shots": payload, "continuous_clips": groups, "references": refs, "missing_selections": missing, "ready": len(missing) == 0, "policy": "固定选用版本；缺项需明确补选。引用完整不等于用户验收。"}, nil
}
