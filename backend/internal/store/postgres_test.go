package store

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Runs against a real database when TEST_DATABASE_URL is set, e.g.
// docker run --rm -e POSTGRES_PASSWORD=pw -p 5432:5432 postgres:17
// TEST_DATABASE_URL=postgres://postgres:pw@localhost:5432/postgres go test ./internal/store
func TestPostgres(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pg, err := NewPostgres(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pg.Close()
	sub := Submission{ID: uuid.NewString(), ReceivedAt: time.Now().UTC(), StampSalt: uuid.NewString(),
		BodySHA256: "00", Body: []byte(`{"a":1}`), IP: "203.0.113.7", UserAgent: "test", Headers: map[string]string{"DNT": "1"}}
	if err := pg.Save(ctx, sub); err != nil {
		t.Fatal(err)
	}
	sub.ID = uuid.NewString()
	if err := pg.Save(ctx, sub); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("second save with the same stamp: %v, want ErrDuplicate", err)
	}
	sub.ID, sub.StampSalt, sub.IP = uuid.NewString(), uuid.NewString(), ""
	if err := pg.Save(ctx, sub); err != nil {
		t.Fatalf("empty IP: %v", err)
	}
}
