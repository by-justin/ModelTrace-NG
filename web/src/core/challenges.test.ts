import { describe, expect, it } from "vitest";
import { generateChallenges } from "./challenges";

describe("generateChallenges", () => {
  for (const language of ["zh", "en"] as const) {
    it(`gives three ${language} challenges with distinct counts between 292 and 332`, () => {
      const challenges = generateChallenges(language);
      const counts = challenges.map((c) => c.expectedCount);
      expect(challenges).toHaveLength(3);
      expect(new Set(counts).size).toBe(3);
      for (const c of challenges) {
        expect(c.expectedCount).toBeGreaterThanOrEqual(292);
        expect(c.expectedCount).toBeLessThanOrEqual(332);
        expect(c.prompt).toContain(String(c.expectedCount));
        expect(c.prompt).toContain("355");
      }
    });
  }
});
