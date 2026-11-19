// Package stamp issues and verifies ALTCHA proof-of-work stamps bound to a request body.
//
// The client hashes the exact body it will send, asks for a challenge for that hash, solves it,
// and sends the body with the solution in the Altcha header. The hash travels inside the signed
// challenge, so a stamp is valid for one body only; single use is enforced by the store.
package stamp

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"time"

	altcha "github.com/altcha-org/altcha-lib-go"
)

var (
	ErrBadHash  = errors.New("h must be the 64-character hex SHA-256 of the request body")
	ErrInvalid  = errors.New("stamp is missing, malformed, expired or not solved")
	ErrMismatch = errors.New("stamp was issued for a different request body")
	hexHash     = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

// Issuer creates and checks stamps. It holds no state besides its settings.
type Issuer struct {
	key       string
	maxNumber int64
	ttl       time.Duration
}

func NewIssuer(hmacKey string, maxNumber int64, ttl time.Duration) *Issuer {
	return &Issuer{key: hmacKey, maxNumber: maxNumber, ttl: ttl}
}

// Challenge returns a challenge bound to the body hash h.
func (i *Issuer) Challenge(h string) (altcha.Challenge, error) {
	if !hexHash.MatchString(h) {
		return altcha.Challenge{}, ErrBadHash
	}
	expires := time.Now().Add(i.ttl)
	return altcha.CreateChallenge(altcha.ChallengeOptions{
		Algorithm: altcha.SHA256,
		MaxNumber: i.maxNumber,
		HMACKey:   i.key,
		Expires:   &expires,
		Params:    url.Values{"h": {h}},
	})
}

// Verify checks the Altcha header against the raw body and returns the challenge salt, which
// identifies the stamp for single-use checks.
func (i *Issuer) Verify(header string, body []byte) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(header)
	if err != nil {
		return "", ErrInvalid
	}
	var payload altcha.Payload
	if json.Unmarshal(raw, &payload) != nil {
		return "", ErrInvalid
	}
	if ok, err := altcha.VerifySolutionSafe(payload, i.key, true); err != nil || !ok {
		return "", ErrInvalid
	}
	sum := sha256.Sum256(body)
	if altcha.ExtractParams(payload).Get("h") != hex.EncodeToString(sum[:]) {
		return "", ErrMismatch
	}
	return payload.Salt, nil
}
