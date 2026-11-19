// Package api is the HTTP layer: routing, request decoding and response shapes.
// Scoring lives in core/trace, stamps in internal/stamp, persistence in internal/store.
package api

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/alitto/pond/v2"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	sloggin "github.com/samber/slog-gin"

	"github.com/xqy2006/modeltrace/backend/internal/stamp"
	"github.com/xqy2006/modeltrace/backend/internal/store"
	"github.com/xqy2006/modeltrace/core/trace"
)

//go:embed docs/openapi.yaml docs/llms.txt
var docs embed.FS

// Options configures the HTTP layer.
type Options struct {
	CORSOrigins    []string
	MaxBodyBytes   int64
	TrustedProxies []string
	ClientIPHeader string // e.g. CF-Connecting-IP when behind Cloudflare
	Logger         *slog.Logger
}

// Server holds the shared, read-only dependencies of the handlers.
type Server struct {
	bank   *trace.Bank
	pool   pond.ResultPool[trace.Result]
	stamps *stamp.Issuer
	store  store.Store
	opts   Options
}

// recordedHeaders are kept with each submission besides IP, user agent, language, origin, referer.
var recordedHeaders = []string{
	"Accept", "Accept-Encoding", "DNT", "Sec-CH-UA", "Sec-CH-UA-Mobile", "Sec-CH-UA-Platform",
	"Sec-Fetch-Site", "Sec-Fetch-Mode", "X-Forwarded-For", "CF-IPCountry",
}

func New(bank *trace.Bank, pool pond.ResultPool[trace.Result], stamps *stamp.Issuer, st store.Store, opts Options) *Server {
	return &Server{bank: bank, pool: pool, stamps: stamps, store: st, opts: opts}
}

// Router builds the gin engine.
func (s *Server) Router() *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())
	if s.opts.Logger != nil {
		r.Use(sloggin.New(s.opts.Logger))
	}
	if err := r.SetTrustedProxies(s.opts.TrustedProxies); err != nil {
		panic(err)
	}
	r.TrustedPlatform = s.opts.ClientIPHeader
	corsConfig := cors.Config{
		AllowMethods:  []string{"GET", "POST"},
		AllowHeaders:  []string{"Content-Type", "Altcha"},
		ExposeHeaders: []string{"Retry-After"},
		MaxAge:        12 * time.Hour,
	}
	if len(s.opts.CORSOrigins) == 0 || (len(s.opts.CORSOrigins) == 1 && s.opts.CORSOrigins[0] == "*") {
		corsConfig.AllowAllOrigins = true
	} else {
		corsConfig.AllowOrigins = s.opts.CORSOrigins
	}
	r.Use(cors.New(corsConfig))

	r.GET("/", s.index)
	r.GET("/openapi.yaml", s.doc("docs/openapi.yaml", "application/yaml"))
	r.GET("/llms.txt", s.doc("docs/llms.txt", "text/plain; charset=utf-8"))
	v1 := r.Group("/v1")
	v1.GET("/health", s.health)
	v1.GET("/models", s.models)
	v1.POST("/categorize", s.categorize)
	v1.GET("/stamp", s.stamp)
	v1.POST("/submissions", s.submit)
	return r
}

// problem writes an RFC 9457 error.
func problem(c *gin.Context, status int, detail string) {
	c.Header("Content-Type", "application/problem+json")
	c.AbortWithStatusJSON(status, gin.H{"type": "about:blank", "title": http.StatusText(status), "status": status, "detail": detail})
}

func (s *Server) index(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"name": "ModelTrace API", "bank_version": s.bank.Version,
		"links": gin.H{"openapi": "/openapi.yaml", "guide": "/llms.txt", "health": "/v1/health", "models": "/v1/models",
			"categorize": "/v1/categorize", "stamp": "/v1/stamp", "submissions": "/v1/submissions"},
	})
}

func (s *Server) doc(name, contentType string) gin.HandlerFunc {
	body, err := docs.ReadFile(name)
	if err != nil {
		panic(err)
	}
	return func(c *gin.Context) { c.Data(http.StatusOK, contentType, body) }
}

func (s *Server) health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok", "bank_version": s.bank.Version, "models": len(s.bank.Models)})
}

func (s *Server) models(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"bank_version": s.bank.Version, "families": s.bank.Families, "models": s.bank.Models})
}

type categorizeRequest struct {
	Replies []trace.Reply `json:"replies"`
}

type candidate struct {
	ID          string  `json:"id"`
	DisplayName string  `json:"display_name"`
	Family      string  `json:"family"`
	Probability float64 `json:"probability"`
}

type familyProb struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Probability float64 `json:"probability"`
}

type categorizeResponse struct {
	BankVersion string            `json:"bank_version"`
	Used        int               `json:"used"`
	Tier        trace.Tier        `json:"tier"`
	Model       *candidate        `json:"model"`
	Family      *familyProb       `json:"family"`
	Known       float64           `json:"known"`
	Candidates  []candidate       `json:"candidates"`
	Families    []familyProb      `json:"families"`
	Diagnostics []trace.ReplyDiag `json:"diagnostics"`
}

func (s *Server) categorize(c *gin.Context) {
	var req categorizeRequest
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, s.opts.MaxBodyBytes)
	if err := c.ShouldBindJSON(&req); err != nil {
		problem(c, http.StatusBadRequest, "body must be JSON like {\"replies\":[{\"text\":\"...\",\"expected_count\":300}]}")
		return
	}
	if len(req.Replies) == 0 || len(req.Replies) > 10 {
		problem(c, http.StatusBadRequest, "send between 1 and 10 replies; 3 give the most reliable verdict")
		return
	}
	result, err := s.pool.Submit(func() trace.Result { return trace.Categorize(s.bank, req.Replies) }).Wait()
	if errors.Is(err, pond.ErrQueueFull) {
		c.Header("Retry-After", "1")
		problem(c, http.StatusTooManyRequests, "the server is busy; retry after a second")
		return
	} else if err != nil {
		problem(c, http.StatusServiceUnavailable, "the server is shutting down")
		return
	}
	c.JSON(http.StatusOK, s.describe(result))
}

func (s *Server) describe(r trace.Result) categorizeResponse {
	out := categorizeResponse{BankVersion: s.bank.Version, Used: r.Used, Tier: r.Tier, Known: r.Known,
		Diagnostics: r.Diagnostics, Candidates: []candidate{}, Families: []familyProb{}}
	if r.Used == 0 {
		return out
	}
	order := make([]int, len(r.Probs))
	for i := range order {
		order[i] = i
	}
	sort.Slice(order, func(a, b int) bool { return r.Probs[order[a]] > r.Probs[order[b]] })
	for _, i := range order[:min(5, len(order))] {
		m := s.bank.Models[i]
		out.Candidates = append(out.Candidates, candidate{m.ID, m.DisplayName, s.bank.Families[m.Family].ID, r.Probs[i]})
	}
	out.Model = &out.Candidates[0]
	for i, f := range s.bank.Families {
		out.Families = append(out.Families, familyProb{f.ID, f.Name, r.FamilyProbs[i]})
	}
	sort.Slice(out.Families, func(a, b int) bool { return out.Families[a].Probability > out.Families[b].Probability })
	out.Family = &out.Families[0]
	return out
}

func (s *Server) stamp(c *gin.Context) {
	challenge, err := s.stamps.Challenge(strings.ToLower(c.Query("h")))
	if err != nil {
		problem(c, http.StatusBadRequest, err.Error())
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, challenge)
}

func (s *Server) submit(c *gin.Context) {
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, s.opts.MaxBodyBytes))
	if err != nil {
		problem(c, http.StatusRequestEntityTooLarge, "body is larger than the limit")
		return
	}
	salt, err := s.stamps.Verify(c.GetHeader("Altcha"), body)
	if err != nil {
		problem(c, http.StatusBadRequest, err.Error())
		return
	}
	if !json.Valid(body) {
		problem(c, http.StatusBadRequest, "body must be JSON")
		return
	}
	sum := sha256.Sum256(body)
	headers := map[string]string{}
	for _, h := range recordedHeaders {
		if v := c.GetHeader(h); v != "" {
			headers[h] = v
		}
	}
	sub := store.Submission{
		ID: uuid.NewString(), ReceivedAt: time.Now().UTC(), StampSalt: salt, BodySHA256: hex.EncodeToString(sum[:]),
		Body: body, IP: c.ClientIP(), UserAgent: c.GetHeader("User-Agent"), AcceptLanguage: c.GetHeader("Accept-Language"),
		Origin: c.GetHeader("Origin"), Referer: c.GetHeader("Referer"), Headers: headers,
	}
	switch err := s.store.Save(c.Request.Context(), sub); {
	case errors.Is(err, store.ErrDuplicate):
		problem(c, http.StatusConflict, "this stamp was already used; request a new one")
	case err != nil:
		slog.Error("saving submission", "error", err)
		problem(c, http.StatusInternalServerError, "could not save the submission")
	default:
		c.JSON(http.StatusAccepted, gin.H{"id": sub.ID})
	}
}
