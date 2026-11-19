package api

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/alitto/pond/v2"
	altcha "github.com/altcha-org/altcha-lib-go"
	"github.com/gin-gonic/gin"

	"github.com/xqy2006/modeltrace/backend/internal/stamp"
	"github.com/xqy2006/modeltrace/backend/internal/store"
	"github.com/xqy2006/modeltrace/core/trace"
)

func newServer(t *testing.T) (http.Handler, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	data, err := os.ReadFile("../../../data/bank/bank.fb")
	if err != nil {
		t.Fatal(err)
	}
	bank, err := trace.Open(data)
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(t.TempDir(), "submissions.jsonl")
	st, err := store.NewFile(file)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(st.Close)
	pool := pond.NewResultPool[trace.Result](2, pond.WithQueueSize(8), pond.WithNonBlocking(true))
	t.Cleanup(pool.StopAndWait)
	issuer := stamp.NewIssuer("test-key", 5000, time.Minute)
	return New(bank, pool, issuer, st, Options{MaxBodyBytes: 1 << 20}).Router(), file
}

func do(t *testing.T, h http.Handler, method, path string, body []byte, header map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "api-test")
	for k, v := range header {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func goldenReplies(t *testing.T) []trace.Reply {
	t.Helper()
	raw, err := os.ReadFile("../../../core/trace/testdata/golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var golden struct {
		Cases []struct {
			Replies []trace.Reply `json:"replies"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	return golden.Cases[0].Replies
}

func TestCategorize(t *testing.T) {
	h, _ := newServer(t)
	body, _ := json.Marshal(map[string]any{"replies": goldenReplies(t)})
	rec := do(t, h, "POST", "/v1/categorize", body, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var res categorizeResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.Used != 3 || res.Model == nil || res.Family == nil || len(res.Candidates) != 5 {
		t.Fatalf("unexpected response: %s", rec.Body)
	}

	if rec := do(t, h, "POST", "/v1/categorize", []byte(`{"replies":[]}`), nil); rec.Code != http.StatusBadRequest ||
		rec.Header().Get("Content-Type") != "application/problem+json" {
		t.Fatalf("empty replies: status %d, type %s", rec.Code, rec.Header().Get("Content-Type"))
	}
}

func TestStampedSubmission(t *testing.T) {
	h, file := newServer(t)
	body := []byte(`{"schema":"modeltrace-submission/1","replies":[{"text":"1 2 3","expected_count":300}]}`)
	sum := sha256.Sum256(body)

	rec := do(t, h, "GET", "/v1/stamp?h="+hex.EncodeToString(sum[:]), nil, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("stamp: %d %s", rec.Code, rec.Body)
	}
	var challenge altcha.Challenge
	_ = json.Unmarshal(rec.Body.Bytes(), &challenge)
	solution, err := altcha.SolveChallenge(challenge.Challenge, challenge.Salt, altcha.SHA256, int(challenge.MaxNumber), 0, nil)
	if err != nil || solution == nil {
		t.Fatalf("solve: %v", err)
	}
	payload, _ := json.Marshal(altcha.Payload{Algorithm: challenge.Algorithm, Challenge: challenge.Challenge,
		Number: int64(solution.Number), Salt: challenge.Salt, Signature: challenge.Signature})
	header := map[string]string{"Altcha": base64.StdEncoding.EncodeToString(payload)}

	if rec := do(t, h, "POST", "/v1/submissions", append([]byte(" "), body...), header); rec.Code != http.StatusBadRequest {
		t.Fatalf("different body accepted: %d", rec.Code)
	}
	if rec := do(t, h, "POST", "/v1/submissions", body, header); rec.Code != http.StatusAccepted {
		t.Fatalf("submit: %d %s", rec.Code, rec.Body)
	}
	if rec := do(t, h, "POST", "/v1/submissions", body, header); rec.Code != http.StatusConflict {
		t.Fatalf("reused stamp: %d", rec.Code)
	}
	if rec := do(t, h, "POST", "/v1/submissions", body, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("missing stamp: %d", rec.Code)
	}

	f, _ := os.Open(file)
	defer f.Close()
	lines := 0
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		var sub store.Submission
		if err := json.Unmarshal(scanner.Bytes(), &sub); err != nil {
			t.Fatal(err)
		}
		if sub.UserAgent != "api-test" || sub.IP == "" || !bytes.Equal(sub.Body, body) {
			t.Fatalf("stored submission is missing request details: %+v", sub)
		}
		lines++
	}
	if lines != 1 {
		t.Fatalf("stored %d submissions, want 1", lines)
	}
}
