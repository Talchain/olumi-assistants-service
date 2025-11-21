import { describe, it, expect } from "vitest";

import type { CeeDecisionReviewPayloadV1 } from "../../src/contracts/cee/decision-review.js";
import { loadCeeDecisionReviewFixture } from "../utils/cee-decision-review.js";

function expectNoBannedSubstrings(payload: unknown): void {
  const serialized = JSON.stringify(payload).toLowerCase();
  const banned = ["secret", "password", "token", "apikey", "prompt", "brief", "label"];
  for (const token of banned) {
    expect(serialized.includes(token)).toBe(false);
  }
}

describe("CEE Decision Review v1 golden fixture", () => {
  it("conforms to CeeDecisionReviewPayloadV1 and remains metadata-only", async () => {
    const fixture: CeeDecisionReviewPayloadV1 = await loadCeeDecisionReviewFixture();

    // Basic structural checks matching the v1 contract
    expect(fixture.story).toBeDefined();
    expect(typeof fixture.story.headline).toBe("string");
    expect(Array.isArray(fixture.story.key_drivers)).toBe(true);
    expect(Array.isArray(fixture.story.risks_and_gaps)).toBe(true);
    expect(Array.isArray(fixture.story.next_actions)).toBe(true);
    expect(typeof fixture.story.any_truncated).toBe("boolean");

    expect(fixture.journey).toBeDefined();
    expect(fixture.journey.story).toBeDefined();
    expect(fixture.journey.health).toBeDefined();
    expect(["ok", "warning", "risk"]).toContain(fixture.journey.health.overallStatus);
    expect(["success", "warning", "danger"]).toContain(fixture.journey.health.overallTone);

    expect(fixture.uiFlags).toBeDefined();
    expect(typeof fixture.uiFlags.is_journey_complete).toBe("boolean");

    // Privacy: fixture must be metadata-only and free of obvious sensitive markers
    expectNoBannedSubstrings(fixture);
  });
});
