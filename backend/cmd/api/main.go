// Command api serves the ModelTrace REST API. Configuration comes from environment variables;
// see backend/README.md.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/alitto/pond/v2"
	"github.com/caarlos0/env/v11"
	"github.com/gin-gonic/gin"

	"github.com/xqy2006/modeltrace/backend/internal/api"
	"github.com/xqy2006/modeltrace/backend/internal/stamp"
	"github.com/xqy2006/modeltrace/backend/internal/store"
	"github.com/xqy2006/modeltrace/core/trace"
)

type config struct {
	Addr           string        `env:"ADDR" envDefault:":8080"`
	BankPath       string        `env:"BANK_PATH" envDefault:"../data/bank/bank.fb"`
	StampHMACKey   string        `env:"STAMP_HMAC_KEY"`
	StampMaxNumber int64         `env:"STAMP_MAX_NUMBER" envDefault:"200000"`
	StampTTL       time.Duration `env:"STAMP_TTL" envDefault:"10m"`
	DatabaseURL    string        `env:"DATABASE_URL"`
	DataFile       string        `env:"DATA_FILE" envDefault:"submissions.jsonl"`
	CORSOrigins    []string      `env:"CORS_ORIGINS" envDefault:"*"`
	Workers        int           `env:"WORKERS"`
	Queue          int           `env:"QUEUE" envDefault:"256"`
	MaxBodyBytes   int64         `env:"MAX_BODY_BYTES" envDefault:"1048576"`
	TrustedProxies []string      `env:"TRUSTED_PROXIES"`
	ClientIPHeader string        `env:"CLIENT_IP_HEADER"`
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)
	if err := run(logger); err != nil {
		logger.Error("api stopped", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	var cfg config
	if err := env.Parse(&cfg); err != nil {
		return err
	}
	if cfg.Workers <= 0 {
		cfg.Workers = runtime.NumCPU()
	}
	if cfg.StampHMACKey == "" {
		key := make([]byte, 32)
		_, _ = rand.Read(key)
		cfg.StampHMACKey = hex.EncodeToString(key)
		logger.Warn("STAMP_HMAC_KEY not set: using a random key, so stamps only work on this instance until restart")
	}

	data, err := os.ReadFile(cfg.BankPath)
	if err != nil {
		return err
	}
	bank, err := trace.Open(data)
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var st store.Store
	if cfg.DatabaseURL != "" {
		st, err = store.NewPostgres(ctx, cfg.DatabaseURL)
	} else {
		logger.Warn("DATABASE_URL not set: writing submissions to a local file", "file", cfg.DataFile)
		st, err = store.NewFile(cfg.DataFile)
	}
	if err != nil {
		return err
	}
	defer st.Close()

	pool := pond.NewResultPool[trace.Result](cfg.Workers, pond.WithQueueSize(cfg.Queue), pond.WithNonBlocking(true))
	defer pool.StopAndWait()

	gin.SetMode(gin.ReleaseMode)
	server := api.New(bank, pool, stamp.NewIssuer(cfg.StampHMACKey, cfg.StampMaxNumber, cfg.StampTTL), st, api.Options{
		CORSOrigins: cfg.CORSOrigins, MaxBodyBytes: cfg.MaxBodyBytes,
		TrustedProxies: cfg.TrustedProxies, ClientIPHeader: cfg.ClientIPHeader, Logger: logger,
	})
	httpServer := &http.Server{Addr: cfg.Addr, Handler: server.Router(), ReadHeaderTimeout: 10 * time.Second}

	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdown)
	}()
	logger.Info("listening", "addr", cfg.Addr, "bank", bank.Version, "models", len(bank.Models), "workers", cfg.Workers)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
