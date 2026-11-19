// The browser scorer (TypeScript wrapper + TinyGo build) must reproduce the Python reference,
// including the vendor (family) evaluation, on every golden case. Needs ../core/build/trace.wasm.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Scorer } from "./scorer";

interface GoldenCase {
  name: string;
  replies: { text: string; expected_count: number }[];
  expected: {
    used: number;
    tier: string;
    top?: number;
    family_top?: number;
    family_probs?: number[];
    probs?: number[];
    low_fit?: boolean;
  };
}

const golden = JSON.parse(readFileSync("../core/trace/testdata/golden.json", "utf8")) as { cases: GoldenCase[] };
const scorer = await Scorer.fromBytes(readFileSync("../core/build/trace.wasm"), new Uint8Array(readFileSync("../data/bank/bank.fb")));

describe("browser scorer matches the reference on golden cases", () => {
  it("loads the bank metadata", () => {
    expect(scorer.bank.models.length).toBeGreaterThan(0);
    expect(scorer.bank.families.length).toBeGreaterThan(1);
  });

  for (const c of golden.cases) {
    it(c.name, () => {
      const r = scorer.categorize(c.replies.map((x) => ({ text: x.text, expectedCount: x.expected_count })));
      const e = c.expected;
      expect(r.used).toBe(e.used);
      expect(r.tier).toBe(e.tier);
      if (e.used === 0) return;
      expect(r.top).toBe(e.top);
      expect(r.lowFit).toBe(e.low_fit);
      expect(r.familyTop).toBe(e.family_top);
      e.family_probs!.forEach((p, i) => expect(r.familyProbs[i]).toBeCloseTo(p, 6));
      e.probs!.forEach((p, i) => expect(r.probs[i]).toBeCloseTo(p, 6));
    });
  }
});
