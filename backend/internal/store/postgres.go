package store

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
)

const schema = `
CREATE TABLE IF NOT EXISTS submissions (
  id              uuid PRIMARY KEY,
  received_at     timestamptz NOT NULL,
  stamp_salt      text NOT NULL UNIQUE,
  body_sha256     text NOT NULL,
  body            jsonb NOT NULL,
  ip              inet,
  user_agent      text NOT NULL DEFAULT '',
  accept_language text NOT NULL DEFAULT '',
  origin          text NOT NULL DEFAULT '',
  referer         text NOT NULL DEFAULT '',
  headers         jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS submissions_received_at ON submissions (received_at);`

// Postgres stores submissions in one table; the unique stamp_salt enforces single use.
type Postgres struct{ pool *pgxpool.Pool }

func NewPostgres(ctx context.Context, url string) (*Postgres, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	if _, err := pool.Exec(ctx, schema); err != nil {
		pool.Close()
		return nil, err
	}
	return &Postgres{pool: pool}, nil
}

func (p *Postgres) Save(ctx context.Context, s Submission) error {
	headers, _ := json.Marshal(s.Headers)
	tag, err := p.pool.Exec(ctx, `
INSERT INTO submissions (id, received_at, stamp_salt, body_sha256, body, ip, user_agent, accept_language, origin, referer, headers)
VALUES ($1, $2, $3, $4, $5, NULLIF($6, '')::inet, $7, $8, $9, $10, $11)
ON CONFLICT (stamp_salt) DO NOTHING`,
		s.ID, s.ReceivedAt, s.StampSalt, s.BodySHA256, s.Body, s.IP, s.UserAgent, s.AcceptLanguage, s.Origin, s.Referer, headers)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrDuplicate
	}
	return nil
}

func (p *Postgres) Close() { p.pool.Close() }
