package httpapi

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// Proxy connections may originate on loopback. A secret is therefore required
// in addition to a local Host and peer, never inferred from forwarding headers.
func (s *Server) localWrite(r *http.Request) bool {
	host := r.Host
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.Trim(host, "[]")
	if host != "localhost" {
		ip := net.ParseIP(host)
		if ip == nil || !ip.IsLoopback() {
			return false
		}
	}
	peer, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil || net.ParseIP(peer) == nil || !net.ParseIP(peer).IsLoopback() {
		return false
	}
	for _, h := range []string{"Forwarded", "X-Forwarded-For", "X-Forwarded-Host", "X-Real-IP"} {
		if r.Header.Get(h) != "" {
			return false
		}
	}
	return s.WriteToken != "" && subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Toonforge-Local-Token")), []byte(s.WriteToken)) == 1
}

func localToken(root string) (string, error) {
	dir := filepath.Join(root, ".toonforge")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	path := filepath.Join(dir, "local-write-token")
	b, err := os.ReadFile(path)
	if err == nil {
		if len(b) != 64 {
			return "", fmt.Errorf("invalid local write token")
		}
		return string(b), nil
	}
	if !os.IsNotExist(err) {
		return "", err
	}
	raw := make([]byte, 32)
	if _, err = rand.Read(raw); err != nil {
		return "", err
	}
	token := hex.EncodeToString(raw)
	return token, os.WriteFile(path, []byte(token), 0600)
}
