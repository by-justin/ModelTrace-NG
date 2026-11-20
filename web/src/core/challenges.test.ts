import { describe, expect, it } from "vitest";
import { generateChallenges, promptFor } from "./challenges";

describe("generateChallenges", () => {
  it("gives three challenges with distinct counts between 292 and 332", () => {
    const counts = generateChallenges().map((c) => c.expectedCount);
    expect(counts).toHaveLength(3);
    expect(new Set(counts).size).toBe(3);
    for (const n of counts) {
      expect(n).toBeGreaterThanOrEqual(292);
      expect(n).toBeLessThanOrEqual(332);
    }
  });

  it("words a challenge the same way every time, in either language", () => {
    for (const c of generateChallenges()) {
      for (const language of ["zh", "en"] as const) {
        const prompt = promptFor(c, language);
        expect(prompt).toBe(promptFor(c, language));
        expect(prompt).toContain(String(c.expectedCount));
        expect(prompt).toContain("355");
      }
      expect(promptFor(c, "zh")).not.toBe(promptFor(c, "en"));
    }
  });
});
