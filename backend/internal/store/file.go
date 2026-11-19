package store

import (
	"context"
	"encoding/json"
	"os"
	"sync"
)

// File appends submissions to a JSONL file. For local development: single use is only enforced
// for stamps seen by this process.
type File struct {
	mu   sync.Mutex
	f    *os.File
	seen map[string]bool
}

func NewFile(path string) (*File, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	return &File{f: f, seen: map[string]bool{}}, nil
}

func (s *File) Save(_ context.Context, sub Submission) error {
	line, err := json.Marshal(sub)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.seen[sub.StampSalt] {
		return ErrDuplicate
	}
	if _, err := s.f.Write(append(line, '\n')); err != nil {
		return err
	}
	s.seen[sub.StampSalt] = true
	return nil
}

func (s *File) Close() { _ = s.f.Close() }
