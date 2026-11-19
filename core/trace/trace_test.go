package trace

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

type goldenFile struct {
	BankVersion string `json:"bank_version"`
	Cases       []struct {
		Name     string  `json:"name"`
		Replies  []Reply `json:"replies"`
		Expected struct {
			Used        int         `json:"used"`
			Tier        string      `json:"tier"`
			Top         *int        `json:"top"`
			Probs       []float64   `json:"probs"`
			FamilyTop   *int        `json:"family_top"`
			FamilyProbs []float64   `json:"family_probs"`
			Known       float64     `json:"known"`
			Diagnostics []ReplyDiag `json:"diagnostics"`
		} `json:"expected"`
	} `json:"cases"`
}

func loadBank(t testing.TB) *Bank {
	t.Helper()
	data, err := os.ReadFile("../../data/bank/bank.fb")
	if err != nil {
		t.Fatal(err)
	}
	b, err := Open(data)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// TestGolden checks that the Go core reproduces pipeline/scoring.py (written by pipeline.golden).
func TestGolden(t *testing.T) {
	b := loadBank(t)
	raw, err := os.ReadFile("testdata/golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var golden goldenFile
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	if golden.BankVersion != b.Version {
		t.Fatalf("golden file is for bank %s, bank is %s: rerun python -m pipeline.golden", golden.BankVersion, b.Version)
	}
	const tol = 1e-6
	for _, c := range golden.Cases {
		got := Categorize(b, c.Replies)
		want := c.Expected
		if got.Used != want.Used || got.Tier.String() != want.Tier {
			t.Errorf("%s: used/tier = %d/%s, want %d/%s", c.Name, got.Used, got.Tier, want.Used, want.Tier)
			continue
		}
		for i, d := range want.Diagnostics {
			if got.Diagnostics[i] != d {
				t.Errorf("%s: reply %d diagnostics = %+v, want %+v", c.Name, i, got.Diagnostics[i], d)
			}
		}
		if want.Used == 0 {
			continue
		}
		if got.Top != *want.Top || got.FamilyTop != *want.FamilyTop {
			t.Errorf("%s: top/family = %d/%d, want %d/%d", c.Name, got.Top, got.FamilyTop, *want.Top, *want.FamilyTop)
		}
		if math.Abs(got.Known-want.Known) > tol {
			t.Errorf("%s: known = %.9f, want %.9f", c.Name, got.Known, want.Known)
		}
		for i := range want.Probs {
			if math.Abs(got.Probs[i]-want.Probs[i]) > tol {
				t.Errorf("%s: probs[%d] = %.9f, want %.9f", c.Name, i, got.Probs[i], want.Probs[i])
				break
			}
		}
		for i := range want.FamilyProbs {
			if math.Abs(got.FamilyProbs[i]-want.FamilyProbs[i]) > tol {
				t.Errorf("%s: family_probs[%d] = %.9f, want %.9f", c.Name, i, got.FamilyProbs[i], want.FamilyProbs[i])
				break
			}
		}
	}
}

func TestParseNumbers(t *testing.T) {
	cases := map[string]int{
		"":                         0,
		"1, 2, 3":                  3,
		"1 2 3 four 5 6":           3, // a letter splits the run; the first longest run wins
		"[400, 12, 0, 355, 356]":   2, // out of range values are skipped
		"１２３ 7 8":                  2, // full-width digits are not digits
		"```json\n[10,20,30]\n```": 3,
	}
	for text, want := range cases {
		if got := len(ParseNumbers(text)); got != want {
			t.Errorf("ParseNumbers(%q) found %d numbers, want %d", text, got, want)
		}
	}
}

func BenchmarkCategorizeThreeReplies(b *testing.B) {
	bank := loadBank(b)
	text := ""
	for i := 0; i < 300; i++ {
		text += " " + itoa((i*97)%355+1)
	}
	replies := []Reply{{text, 300}, {text, 300}, {text, 300}}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Categorize(bank, replies)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	s := ""
	for ; n > 0; n /= 10 {
		s = string(rune('0'+n%10)) + s
	}
	return s
}
