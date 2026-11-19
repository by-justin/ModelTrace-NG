// Package store persists stamped crowd submissions.
//
// Postgres in production (DATABASE_URL); an append-only JSONL file for local development.
package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

// ErrDuplicate means the stamp was already used.
var ErrDuplicate = errors.New("stamp already used")

// Submission is one stamped request: the client's body as sent, plus what the server saw.
type Submission struct {
	ID             string            `json:"id"`
	ReceivedAt     time.Time         `json:"received_at"`
	StampSalt      string            `json:"stamp_salt"`
	BodySHA256     string            `json:"body_sha256"`
	Body           json.RawMessage   `json:"body"`
	IP             string            `json:"ip"`
	UserAgent      string            `json:"user_agent"`
	AcceptLanguage string            `json:"accept_language"`
	Origin         string            `json:"origin"`
	Referer        string            `json:"referer"`
	Headers        map[string]string `json:"headers"`
}

// Store saves submissions. Save returns ErrDuplicate when the stamp salt was seen before.
type Store interface {
	Save(ctx context.Context, s Submission) error
	Close()
}
