import { describe, it, expect } from "vitest";
import type {
  CeeDecisionReviewPayload,
  CeeEngineStatus,
  CeeTraceSummary,
  CeeErrorView,
} from "./ceeHelpers.js";
import golden from "./examples/cee-decision-review.v1.example.json";
import { formatGoldenDecisionReviewSummary } from "./examples/ceeDecisionReviewFixtureExample.js";

interface GoldenDecisionReviewFixture {
  review: CeeDecisionReviewPayload;
  trace: CeeTraceSummary | null;
  engineStatus: CeeEngineStatus;
  error: CeeErrorView | null;
}

describe("CEE golden decision review fixture", () => {
  const fixture = golden as GoldenDecisionReviewFixture;

  it("conforms to the expected CEE integration types", () => {
    const { review, trace, engineStatus, error } = fixture;

    // Basic shape checks for the canonical review payload
    expect(review.story).toBeDefined();
    expect(typeof review.story.headline).toBe("string");
    expect(Array.isArray(review.story.key_drivers)).toBe(true);
    expect(Array.isArray(review.story.next_actions)).toBe(true);

    expect(review.journey).toBeDefined();
    expect(review.journey.health).toBeDefined();
    expect(["ok", "warning", "risk"]).toContain(review.journey.health.overallStatus);
    expect(["success", "warning", "danger"]).toContain(review.journey.health.overallTone);

    expect(review.uiFlags).toBeDefined();
    expect(typeof review.uiFlags.is_journey_complete).toBe("boolean");

    // Trace summary and engine status should be metadata-only and optional
    if (trace) {
      expect(typeof trace.requestId).toBe("string");
      expect(typeof trace.degraded).toBe("boolean");
    }

    expect(typeof engineStatus.degraded).toBe("boolean");
    if (engineStatus.provider !== undefined) {
      expect(typeof engineStatus.provider).toBe("string");
    }
    if (engineStatus.model !== undefined) {
      expect(typeof engineStatus.model).toBe("string");
    }

    // Error view, when present, should match the CeeErrorView shape
    if (error) {
      expect(typeof error.retryable).toBe("boolean");
      if (error.code !== undefined) {
        expect(typeof error.code).toBe("string");
      }
    }
  });

  it("remains metadata-only and does not contain obvious sensitive markers", () => {
    const serialized = JSON.stringify(fixture).toLowerCase();

    const bannedTokens = [
      "secret",
      "password",
      "token",
      "apikey",
      "prompt",
      "brief",
      "label",
    ];

    for (const token of bannedTokens) {
      expect(serialized.includes(token)).toBe(false);
    }
  });

  it("can be rendered via the example formatter without throwing", () => {
    const summary = formatGoldenDecisionReviewSummary(fixture);

    expect(typeof summary).toBe("string");
    expect(summary.length).toBeGreaterThan(0);
    expect(summary.toLowerCase()).toContain("headline:");
    expect(summary.toLowerCase()).toContain("health:");
    expect(summary.toLowerCase()).toContain("journey:");
    expect(summary.toLowerCase()).toContain("engine:");
  });
});
