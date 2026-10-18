package store

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type Worker struct {
	Store  *Store
	mu     sync.Mutex
	cancel map[string]context.CancelFunc
}

func NewWorker(s *Store) *Worker { return &Worker{Store: s, cancel: map[string]context.CancelFunc{}} }
func (s *Store) Jobs(ctx context.Context) (Record, error) {
	rows, e := s.Query(ctx, "SELECT * FROM studio_jobs ORDER BY created_at DESC LIMIT 100")
	for _, r := range rows {
		decode(r, "input_json", "input")
		decode(r, "result_json", "result")
	}
	return Record{"items": rows}, e
}
func (s *Store) CreateJob(ctx context.Context, kind string, input Record) (Record, error) {
	if kind != "refresh" && kind != "backup" && kind != "health" {
		return nil, fmt.Errorf("不支持的本地任务")
	}
	id := ID("job")
	t := Now()
	_, e := s.DB.ExecContext(ctx, "INSERT INTO studio_jobs(id,kind,status,input_json,created_at,updated_at) VALUES(?,?,?,?,?,?)", id, kind, "queued", JSON(input), t, t)
	return Record{"id": id, "kind": kind, "status": "queued"}, e
}
func (w *Worker) Cancel(ctx context.Context, id string) error {
	res, e := w.Store.DB.ExecContext(ctx, "UPDATE studio_jobs SET cancel_requested=1,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,updated_at=? WHERE id=? AND status IN('queued','running')", Now(), id)
	if e != nil {
		return e
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("任务已结束或不存在")
	}
	w.mu.Lock()
	if cancel := w.cancel[id]; cancel != nil {
		cancel()
	}
	w.mu.Unlock()
	return nil
}
func (w *Worker) Run(ctx context.Context) {
	_, _ = w.Store.DB.ExecContext(ctx, "UPDATE studio_jobs SET status='interrupted',error='服务已重启；请检查结果后明确重新提交',updated_at=? WHERE status='running'", Now())
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.next(ctx)
		}
	}
}
func (w *Worker) next(parent context.Context) {
	s := w.Store
	rows, e := s.Query(parent, "SELECT * FROM studio_jobs WHERE status='queued' AND cancel_requested=0 ORDER BY created_at LIMIT 1")
	if e != nil || len(rows) == 0 {
		return
	}
	j := rows[0]
	id := Text(j["id"])
	result, e := s.DB.ExecContext(parent, "UPDATE studio_jobs SET status='running',updated_at=? WHERE id=? AND status='queued'", Now(), id)
	if e != nil {
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return
	}
	ctx, cancel := context.WithCancel(parent)
	w.mu.Lock()
	w.cancel[id] = cancel
	w.mu.Unlock()
	defer func() { cancel(); w.mu.Lock(); delete(w.cancel, id); w.mu.Unlock() }()
	decode(j, "input_json", "input")
	progress := func(v int) {
		_, _ = s.DB.ExecContext(ctx, "UPDATE studio_jobs SET progress=?,updated_at=? WHERE id=?", v, Now(), id)
	}
	var output Record
	switch j["kind"] {
	case "refresh":
		output, e = s.Refresh(ctx, progress, func() bool { return ctx.Err() != nil })
	case "backup":
		output, e = s.Backup(ctx, Map(j["input"])["include_media"] != false)
	case "health":
		output, e = s.Health(ctx)
	}
	status, message := "completed", ""
	if e != nil {
		status = "failed"
		message = e.Error()
		if ctx.Err() != nil {
			status = "cancelled"
			if parent.Err() != nil {
				status = "interrupted"
			}
		}
	}
	_, _ = s.DB.ExecContext(context.Background(), "UPDATE studio_jobs SET status=?,progress=?,result_json=?,error=?,updated_at=? WHERE id=?", status, 100, JSON(output), message, Now(), id)
}
