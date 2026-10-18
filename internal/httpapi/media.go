package httpapi

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"math"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/image/draw"
	"toonforge.local/library/internal/store"
)

var mediaLocks sync.Map

func cacheLock(key string) func() {
	v, _ := mediaLocks.LoadOrStore(key, &sync.Mutex{})
	m := v.(*sync.Mutex)
	m.Lock()
	return m.Unlock
}
func (s *Server) thumbnail(w http.ResponseWriter, r *http.Request, path, hash string) {
	if hash == "" {
		h, e := store.Digest(path)
		if e != nil {
			fail(w, e)
			return
		}
		hash = h
	}
	cached := filepath.Join(s.Store.Cache, hash+"-thumb-v1.jpg")
	unlock := cacheLock(cached)
	defer unlock()
	if _, e := os.Stat(cached); e != nil {
		f, e := os.Open(path)
		if e != nil {
			fail(w, e)
			return
		}
		cfg, _, e := image.DecodeConfig(f)
		_, _ = f.Seek(0, 0)
		if e != nil || cfg.Width*cfg.Height > 64000000 {
			f.Close()
			fail(w, fmt.Errorf("图片格式无效或尺寸超过预览限制"))
			return
		}
		im, _, e := image.Decode(f)
		f.Close()
		if e != nil {
			fail(w, e)
			return
		}
		ratio := math.Min(1, math.Min(640/float64(cfg.Width), 480/float64(cfg.Height)))
		dst := image.NewRGBA(image.Rect(0, 0, max(1, int(float64(cfg.Width)*ratio)), max(1, int(float64(cfg.Height)*ratio))))
		draw.Draw(dst, dst.Bounds(), image.NewUniform(image.White), image.Point{}, draw.Src)
		draw.CatmullRom.Scale(dst, dst.Bounds(), im, im.Bounds(), draw.Over, nil)
		var b bytes.Buffer
		if e = jpeg.Encode(&b, dst, &jpeg.Options{Quality: 85}); e == nil {
			e = os.WriteFile(cached, b.Bytes(), 0644)
		}
		if e != nil {
			fail(w, e)
			return
		}
	}
	w.Header().Set("Cache-Control", "private,max-age=86400")
	http.ServeFile(w, r, cached)
}
func (s *Server) media(w http.ResponseWriter, r *http.Request, route string) {
	a, e := s.Store.Artifact(r.Context(), r.URL.Query().Get("id"))
	if e != nil {
		fail(w, e)
		return
	}
	path, e := s.Store.ObjectPath(a)
	if e != nil {
		fail(w, e)
		return
	}
	if route == "thumb" {
		if a["media_type"] != "image" {
			fail(w, fmt.Errorf("不是图片"))
			return
		}
		s.thumbnail(w, r, path, store.Text(a["sha256"]))
		return
	}
	if route == "file" {
		w.Header().Set("Cache-Control", "private,max-age=86400")
		http.ServeFile(w, r, path)
		return
	}
	if a["media_type"] != "audio" {
		fail(w, fmt.Errorf("不是音频"))
		return
	}
	if route == "audio-preview" && strings.ToLower(filepath.Ext(path)) != ".flac" {
		http.ServeFile(w, r, path)
		return
	}
	suffix := "-wave-v1.json"
	if route == "audio-preview" {
		suffix = "-preview-v1.m4a"
	}
	cached := filepath.Join(s.Store.Cache, store.Text(a["sha256"])+suffix)
	unlock := cacheLock(cached)
	defer unlock()
	if _, e = os.Stat(cached); e != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
		defer cancel()
		if route == "waveform" {
			data, e := exec.CommandContext(ctx, "ffmpeg", "-v", "error", "-i", path, "-t", "600", "-f", "s16le", "-ar", "4000", "-ac", "1", "-").Output()
			if e != nil {
				fail(w, fmt.Errorf("波形不可用，请检查FFmpeg"))
				return
			}
			count := len(data) / 2
			step := max(1, count/180)
			peaks := []float64{}
			for i := 0; i < count; i += step {
				peak := 0.0
				for j := i; j < min(i+step, count); j++ {
					v := math.Abs(float64(int16(binary.LittleEndian.Uint16(data[j*2:j*2+2])))) / 32768
					if v > peak {
						peak = v
					}
				}
				peaks = append(peaks, peak)
			}
			payload := store.Record{"peaks": peaks, "sampled_seconds": float64(count) / 4000, "duration_seconds": store.Map(store.Map(a["metadata"])["technical"])["duration_seconds"], "truncated": count >= 2400000}
			e = os.WriteFile(cached, []byte(store.JSON(payload)), 0644)
			if e != nil {
				fail(w, e)
				return
			}
		} else {
			tmp := strings.TrimSuffix(cached, ".m4a") + ".tmp.m4a"
			defer os.Remove(tmp)
			if e = exec.CommandContext(ctx, "ffmpeg", "-v", "error", "-y", "-i", path, "-c:a", "aac", "-b:a", "160k", tmp).Run(); e == nil {
				e = os.Rename(tmp, cached)
			}
			if e != nil {
				fail(w, fmt.Errorf("试听转码失败，请检查FFmpeg"))
				return
			}
		}
	}
	if route == "waveform" {
		w.Header().Set("Content-Type", "application/json")
	}
	http.ServeFile(w, r, cached)
}
func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		w.WriteHeader(405)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 512<<20)
	if e := r.ParseMultipartForm(8 << 20); e != nil {
		fail(w, fmt.Errorf("文件超过512MB或格式错误"))
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	file, header, e := r.FormFile("file")
	if e != nil {
		fail(w, e)
		return
	}
	defer file.Close()
	name := filepath.Base(header.Filename)
	if store.MediaType(name) == "" {
		fail(w, fmt.Errorf("此入口接收图片、音频和视频"))
		return
	}
	folder := filepath.Join(s.Store.Root, "imports", time.Now().Format("2006-01-02"))
	if e = os.MkdirAll(folder, 0755); e != nil {
		fail(w, e)
		return
	}
	resolved, e := filepath.EvalSymlinks(folder)
	if e != nil {
		fail(w, e)
		return
	}
	relative, e := filepath.Rel(s.Store.Root, resolved)
	if e != nil || strings.HasPrefix(relative, "..") {
		fail(w, fmt.Errorf("导入路径超出项目"))
		return
	}
	destination := filepath.Join(folder, strings.ReplaceAll(store.ID("upload"), ":", "-")+"-"+name)
	out, e := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
	if e != nil {
		fail(w, e)
		return
	}
	_, e = io.Copy(out, file)
	ce := out.Close()
	if e == nil {
		e = ce
	}
	if e != nil {
		os.Remove(destination)
		fail(w, e)
		return
	}
	rel, _ := filepath.Rel(s.Store.Root, destination)
	write(w, 200, store.Record{"path": filepath.ToSlash(rel), "name": name, "type": store.MediaType(name)})
}
func (s *Server) collection(w http.ResponseWriter, r *http.Request) {
	story := r.URL.Query().Get("story")
	id := "story:" + story
	e, err := s.Store.Entity(r.Context(), id)
	if err != nil {
		fail(w, err)
		return
	}
	m := store.Map(e["metadata"])
	manifest := store.Text(m["collection_manifest"])
	if manifest == "" {
		fail(w, fmt.Errorf("本篇未登记分镜合集"))
		return
	}
	base := filepath.Dir(store.Text(m["_legacy_source"]))
	path, err := s.Store.SafeFile(filepath.ToSlash(filepath.Join(base, manifest)), false)
	if err != nil {
		fail(w, err)
		return
	}
	data, err := store.ReadDocument(path)
	if err != nil {
		fail(w, err)
		return
	}
	for _, v := range store.List(data["pages"]) {
		page := store.Map(v)
		if img := store.Text(page["image"]); img != "" {
			p, _ := filepath.Rel(s.Store.Root, filepath.Join(filepath.Dir(path), img))
			page["image"] = filepath.ToSlash(p)
		}
	}
	shots := []store.Record{}
	for _, c := range e["children"].([]store.Record) {
		if c["type"] == "shot" {
			sm := store.Map(c["metadata"])
			sm["id"] = sm["legacy_shot_id"]
			shots = append(shots, sm)
		}
	}
	for _, v := range store.List(data["pages"]) {
		page := store.Map(v)
		selected := []store.Record{}
		for _, id := range store.Strings(page["shot_ids"]) {
			for _, shot := range shots {
				if shot["id"] == id || shot["shot_id"] == id {
					selected = append(selected, shot)
				}
			}
		}
		page["shots"] = selected
	}
	data["page_count"] = len(store.List(data["pages"]))
	data["shot_count"] = len(shots)
	data["story"] = store.Record{"id": story, "title": e["name"], "shots": shots}
	data["title"] = e["name"]
	write(w, 200, data)
}
