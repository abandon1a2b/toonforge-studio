package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/spf13/cobra"
	"toonforge.local/library/internal/httpapi"
	"toonforge.local/library/internal/store"
)

type app struct{ root string }

func output(v any) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	encoder.SetEscapeHTML(false)
	return encoder.Encode(v)
}
func (a *app) run(cmd *cobra.Command, fn func(*store.Store) (any, error)) error {
	s, e := store.Open(a.root, "agent-cli")
	if e != nil {
		return e
	}
	defer s.Close()
	v, e := fn(s)
	if e != nil {
		return e
	}
	return output(v)
}
func readInput(path string) (store.Record, error) {
	if path == "" {
		return store.Record{}, nil
	}
	var r io.Reader
	var f *os.File
	var e error
	if path == "-" {
		r = os.Stdin
	} else {
		f, e = os.Open(path)
		if e != nil {
			return nil, e
		}
		defer f.Close()
		r = f
	}
	var m store.Record
	dec := json.NewDecoder(io.LimitReader(r, 262145))
	if e = dec.Decode(&m); e != nil {
		return nil, e
	}
	if m == nil {
		return nil, fmt.Errorf("输入须为JSON对象")
	}
	if dec.Decode(&struct{}{}) != io.EOF {
		return nil, fmt.Errorf("输入须为单个JSON对象且不超过256KB")
	}
	return m, nil
}
func (a *app) mutation(name, description string, fn func(context.Context, *store.Store, store.Record) (any, error)) *cobra.Command {
	var input, id, entity, nameFlag, kind, parent, role, scope, slot, rid, status, evidence, path, metaFile string
	var expected int
	var tags []string
	var archive bool
	c := &cobra.Command{Use: name, Short: description, RunE: func(c *cobra.Command, _ []string) error {
		d, e := readInput(input)
		if e != nil {
			return e
		}
		for key, value := range map[string]string{"id": id, "entity_id": entity, "name": nameFlag, "type": kind, "parent": parent, "role": role, "scope": scope, "slot": slot, "revision_id": rid, "status": status, "evidence": evidence, "path": path} {
			if c.Flags().Changed(strings.ReplaceAll(key, "_", "-")) {
				d[key] = value
			}
		}
		if c.Flags().Changed("expected-version") {
			d["expected_version"] = expected
		}
		if c.Flags().Changed("tag") {
			d["tags"] = tags
		}
		if c.Flags().Changed("archived") {
			d["archived"] = archive
		}
		if metaFile != "" {
			m, e := readInput(metaFile)
			if e != nil {
				return e
			}
			d["metadata"] = m
		}
		return a.run(c, func(s *store.Store) (any, error) { return fn(c.Context(), s, d) })
	}}
	f := c.Flags()
	f.StringVar(&input, "input", "", "JSON payload file, or - for stdin")
	f.StringVar(&id, "id", "", "Stable object/asset/issue ID")
	f.StringVar(&entity, "entity-id", "", "Owning entity ID")
	f.StringVar(&nameFlag, "name", "", "Human readable name")
	f.StringVar(&kind, "type", "", "Entity or task type")
	f.StringVar(&parent, "parent", "", "Parent entity ID")
	f.StringVar(&role, "role", "", "Media role")
	f.StringVar(&scope, "scope", "", "Story ID for selection")
	f.StringVar(&slot, "slot", "", "Selection purpose")
	f.StringVar(&rid, "revision-id", "", "Exact revision ID")
	f.StringVar(&status, "status", "", "Explicit review status")
	f.StringVar(&evidence, "evidence", "", "User confirmation evidence")
	f.StringVar(&path, "path", "", "Project-relative media path")
	f.StringVar(&metaFile, "metadata-file", "", "Complete metadata JSON object")
	f.IntVar(&expected, "expected-version", 0, "Version read before editing (required for updates)")
	f.StringArrayVar(&tags, "tag", nil, "Complete tag set; repeat flag")
	f.BoolVar(&archive, "archived", true, "Archive or restore entity")
	return c
}
func newRoot() *cobra.Command {
	a := &app{}
	cwd, _ := os.Getwd()
	fallback := os.Getenv("TOONFORGE_ROOT")
	if fallback == "" {
		fallback = cwd
	}
	root := &cobra.Command{Use: "toonforge", Short: "Toonforge Studio: local creative library for people and agents", Version: "0.2.0", SilenceErrors: true, SilenceUsage: true}
	root.PersistentFlags().StringVar(&a.root, "root", fallback, "Project directory (or TOONFORGE_ROOT)")
	root.PersistentFlags().Bool("json", true, "Structured JSON output for data commands")
	serve := &cobra.Command{Use: "serve", Aliases: []string{"service"}, Short: "Start embedded React UI and local API", RunE: func(c *cobra.Command, _ []string) error {
		s, e := store.Open(a.root, "web-user")
		if e != nil {
			return e
		}
		defer s.Close()
		port, _ := c.Flags().GetInt("port")
		dev, _ := c.Flags().GetBool("dev")
		remoteReadOnly, _ := c.Flags().GetBool("remote-read-only")
		return httpapi.Serve(c.Context(), s, port, dev, remoteReadOnly)
	}}
	serve.Flags().Int("port", 8795, "Loopback port")
	serve.Flags().Bool("remote-read-only", true, "Require local editing credential; remote visitors can only read")
	serve.Flags().Bool("dev", false, "Allow local Vite development origin")
	root.AddCommand(serve)
	for _, name := range []string{"workspace", "health", "pending", "inbox", "events", "tags", "collections", "jobs"} {
		n := name
		root.AddCommand(&cobra.Command{Use: n, Short: "Read " + n + " as JSON", RunE: func(c *cobra.Command, _ []string) error {
			return a.run(c, func(s *store.Store) (any, error) {
				switch n {
				case "workspace":
					return s.Overview(c.Context())
				case "health":
					h, e := s.Health(c.Context())
					if e == nil && h["ok"] != true {
						return nil, fmt.Errorf("完整性检查失败：%s", store.JSON(h))
					}
					return h, e
				case "pending":
					return s.Pending(c.Context())
				case "inbox":
					return s.Inbox(c.Context())
				case "events":
					return s.Events(c.Context())
				case "tags":
					return s.TagList(c.Context())
				case "collections":
					return s.Collections(c.Context())
				default:
					return s.Jobs(c.Context())
				}
			})
		}})
	}
	for _, family := range []string{"entity", "artifact"} {
		family := family
		group := &cobra.Command{Use: family, Short: "Manage " + family + " records"}
		var kind, q, tag, eid, role string
		var limit, offset int
		var history, archived bool
		list := &cobra.Command{Use: "list", Short: "Paged query with stable IDs", RunE: func(c *cobra.Command, _ []string) error {
			return a.run(c, func(s *store.Store) (any, error) {
				f := store.Filter{Type: kind, Query: q, Tag: tag, Entity: eid, Role: role, Limit: limit, Offset: offset, History: history, Archived: archived}
				if family == "entity" {
					return s.Entities(c.Context(), f)
				}
				return s.Artifacts(c.Context(), f)
			})
		}}
		f := list.Flags()
		f.StringVar(&kind, "type", "", "Entity/media type")
		f.StringVar(&q, "query", "", "Text search")
		f.StringVar(&tag, "tag", "", "Exact tag")
		f.StringVar(&eid, "entity", "", "Parent/owning entity")
		f.StringVar(&role, "role", "", "Artifact role")
		f.IntVar(&limit, "limit", 60, "Page size, at most 200")
		f.IntVar(&offset, "offset", 0, "Page offset")
		f.BoolVar(&history, "historical", false, "Include historical artifacts")
		f.BoolVar(&archived, "archived", false, "Query archived entities")
		group.AddCommand(list)
		var id string
		show := &cobra.Command{Use: "show", Short: "Read object, versions and references", RunE: func(c *cobra.Command, _ []string) error {
			return a.run(c, func(s *store.Store) (any, error) {
				if family == "entity" {
					return s.Entity(c.Context(), id)
				}
				return s.Artifact(c.Context(), id)
			})
		}}
		show.Flags().StringVar(&id, "id", "", "Stable ID")
		_ = show.MarkFlagRequired("id")
		group.AddCommand(show)
		if family == "entity" {
			group.AddCommand(a.mutation("create", "Create a profile", func(c context.Context, s *store.Store, d store.Record) (any, error) { return s.Create(c, d) }), a.mutation("update", "Save a profile revision with expected_version", func(c context.Context, s *store.Store, d store.Record) (any, error) { return s.Update(c, d) }), a.mutation("archive", "Archive without removing references", func(c context.Context, s *store.Store, d store.Record) (any, error) { return s.Archive(c, d) }), a.mutation("export", "Export a readable entity snapshot", func(c context.Context, s *store.Store, d store.Record) (any, error) {
				return s.ExportEntity(c, store.Text(d["id"]))
			}))
		} else {
			group.AddCommand(a.mutation("register", "Register existing media as immutable candidate", func(c context.Context, s *store.Store, d store.Record) (any, error) { return s.Register(c, d) }), a.mutation("annotate", "Edit role/tags with expected_version", func(c context.Context, s *store.Store, d store.Record) (any, error) { return s.Annotate(c, d) }))
		}
		root.AddCommand(group)
	}
	revision := &cobra.Command{Use: "revision"}
	revision.AddCommand(a.mutation("review", "Save explicit review evidence", func(c context.Context, s *store.Store, d store.Record) (any, error) { return s.Review(c, d) }))
	root.AddCommand(revision)
	selection := &cobra.Command{Use: "selection"}
	var scope string
	selList := &cobra.Command{Use: "list", RunE: func(c *cobra.Command, _ []string) error {
		return a.run(c, func(s *store.Store) (any, error) { return s.Selections(c.Context(), scope) })
	}}
	selList.Flags().StringVar(&scope, "scope", "", "Story ID")
	_ = selList.MarkFlagRequired("scope")
	selection.AddCommand(selList, a.mutation("set", "Pin exact revision; never choose latest", func(c context.Context, s *store.Store, d store.Record) (any, error) { return s.Select(c, d) }))
	root.AddCommand(selection)
	issue := &cobra.Command{Use: "issue"}
	var entity, status string
	il := &cobra.Command{Use: "list", RunE: func(c *cobra.Command, _ []string) error {
		return a.run(c, func(s *store.Store) (any, error) { return s.Issues(c.Context(), entity, status) })
	}}
	il.Flags().StringVar(&entity, "entity", "", "Entity ID")
	il.Flags().StringVar(&status, "status", "", "Issue state")
	issue.AddCommand(il, a.mutation("save", "Record or update a version-bound issue", func(c context.Context, s *store.Store, d store.Record) (any, error) { return s.SaveIssue(c, d) }))
	root.AddCommand(issue)
	var story, shots, purpose string
	pack := &cobra.Command{Use: "context", Short: "Export pinned references and continuous shot groups", RunE: func(c *cobra.Command, _ []string) error {
		return a.run(c, func(s *store.Store) (any, error) {
			return s.Context(c.Context(), story, strings.Split(shots, ","), purpose)
		})
	}}
	pack.Flags().StringVar(&story, "story", "", "Story ID")
	pack.Flags().StringVar(&shots, "shots", "", "Comma-separated stable shot IDs")
	pack.Flags().StringVar(&purpose, "purpose", "video", "image, audio or video")
	_ = pack.MarkFlagRequired("story")
	_ = pack.MarkFlagRequired("shots")
	root.AddCommand(pack)
	root.AddCommand(&cobra.Command{Use: "refresh", Short: "Explicit incremental import; preserves selections", RunE: func(c *cobra.Command, _ []string) error {
		return a.run(c, func(s *store.Store) (any, error) { return s.Refresh(c.Context(), nil, nil) })
	}})
	var include bool
	backup := &cobra.Command{Use: "backup", Short: "Create verified database and optional immutable media backup", RunE: func(c *cobra.Command, _ []string) error {
		return a.run(c, func(s *store.Store) (any, error) { return s.Backup(c.Context(), include) })
	}}
	backup.Flags().BoolVar(&include, "include-media", false, "Include media for portable recovery")
	root.AddCommand(backup)
	var source, destination string
	restore := &cobra.Command{Use: "restore", Short: "Verify and restore a full backup to a new empty directory", RunE: func(c *cobra.Command, _ []string) error {
		v, e := store.Restore(c.Context(), source, destination)
		if e != nil {
			return e
		}
		return output(v)
	}}
	restore.Flags().StringVar(&source, "backup", "", "Backup directory")
	restore.Flags().StringVar(&destination, "destination", "", "New empty directory")
	_ = restore.MarkFlagRequired("backup")
	_ = restore.MarkFlagRequired("destination")
	root.AddCommand(restore)
	root.AddCommand(a.mutation("apply-pending", "Explicitly import compared external metadata", func(c context.Context, s *store.Store, d store.Record) (any, error) { return s.ApplyPending(c, d) }), a.mutation("job-submit", "Submit a persisted local task for the running service", func(c context.Context, s *store.Store, d store.Record) (any, error) {
		return s.CreateJob(c, store.Text(d["type"]), store.Map(d["input"]))
	}))
	root.AddCommand(a.mutation("tag-rename", "Rename or explicitly merge a tag", func(c context.Context, s *store.Store, d store.Record) (any, error) { return s.RenameTag(c, d) }), a.mutation("collection-save", "Save a named collection", func(c context.Context, s *store.Store, d store.Record) (any, error) { return s.SaveCollection(c, d) }), a.mutation("settings-save", "Save a studio preference", func(c context.Context, s *store.Store, d store.Record) (any, error) {
		e := s.Setting(c, store.Text(d["key"]), store.Text(d["value"]))
		return store.Record{"ok": e == nil}, e
	}), a.mutation("job-cancel", "Request cancellation of a persisted task", func(c context.Context, s *store.Store, d store.Record) (any, error) {
		e := store.NewWorker(s).Cancel(c, store.Text(d["id"]))
		return store.Record{"ok": e == nil}, e
	}))
	root.AddCommand(a.mutation("cover-set", "Set an exact image cover with version check", func(c context.Context, s *store.Store, d store.Record) (any, error) { return s.SetCover(c, d) }))
	root.AddCommand(&cobra.Command{Use: "describe", Short: "Machine-readable CLI contract and policy", RunE: func(c *cobra.Command, _ []string) error {
		return output(store.Record{"version": "0.2.0", "output": "JSON", "input": "--input FILE or --input - (stdin)", "updates": "Read version then pass expected_version; conflicts exit 3", "policies": []string{"No automatic acceptance", "No automatic latest selection", "No source file overwrite", "Restore only to a new empty directory"}, "commands": []string{"workspace", "entity list/show/create/update/archive/export", "artifact list/show/register/annotate", "selection list/set", "revision review", "issue list/save", "context", "refresh", "pending", "apply-pending", "inbox", "tags", "tag-rename", "collections", "collection-save", "settings-save", "cover-set", "jobs", "job-submit", "job-cancel", "backup", "restore", "health", "serve"}})
	}})
	return root
}
func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	root := newRoot()
	if e := root.ExecuteContext(ctx); e != nil {
		code, name := 2, "invalid_request"
		var conflict *store.Conflict
		if errors.As(e, &conflict) {
			code, name = 3, "conflict"
		}
		if errors.Is(e, store.ErrNotFound) {
			code, name = 4, "not_found"
		}
		b, _ := json.Marshal(store.Record{"error": e.Error(), "code": name})
		fmt.Fprintln(os.Stderr, string(b))
		os.Exit(code)
	}
}
