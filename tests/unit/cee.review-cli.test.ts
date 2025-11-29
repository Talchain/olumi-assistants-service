import { describe, it, expect } from "vitest";
import type {
  CEEDraftGraphResponseV1,
  CEEOptionsResponseV1,
  CEEEvidenceHelperResponseV1,
} from "../../sdk/typescript/src/ceeTypes.js";
import type { CeeDecisionReviewPayload } from "../../sdk/typescript/src/ceeHelpers.js";
import golden from "../../sdk/typescript/src/examples/cee-decision-review.v1.example.json";
import {
  buildCeeReviewSummaryFromEnvelopes,
  buildCeeReviewSummaryFromReview,
  type CeeReviewSummary,
  formatCeeReviewSummaryPretty,
} from "../../scripts/cee-review-cli.js";
import { expectNoSecretLikeKeys } from "../utils/no-secret-like-keys.js";
import { expectNoBannedSubstrings } from "../utils/telemetry-banned-substrings.js";

interface GoldenDecisionReviewFixture {
  review: CeeDecisionReviewPayload;
}

describe("cee-review-cli helpers", () => {
  it("builds a stable summary from envelopes", () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-env", correlation_id: "r-env", engine: {} },
      quality: { overall: 7 } as any,
      graph: {} as any,
    } as any;

    const options: CEEOptionsResponseV1 = {
      trace: { request_id: "r-env", correlation_id: "r-env", engine: {} },
      quality: { overall: 6 } as any,
      options: [{ id: "opt-1" } as any, { id: "opt-2" } as any],
    } as any;

    const evidence: CEEEvidenceHelperResponseV1 = {
      trace: { request_id: "r-env", correlation_id: "r-env", engine: {} },
      quality: { overall: 6 } as any,
      items: [{ id: "e1" } as any],
      response_limits: { items_max: 10, items_truncated: false } as any,
    } as any;

    const summary: CeeReviewSummary = buildCeeReviewSummaryFromEnvelopes({
      draft,
      options,
      evidence,
    });

    expect(typeof summary.headline).toBe("string");
    expect(summary.headline.length).toBeGreaterThan(0);
    expect(["ok", "warning", "risk"]).toContain(summary.health.status);
    expect(typeof summary.journey.is_complete).toBe("boolean");
    expect(Array.isArray(summary.journey.missing_envelopes)).toBe(true);

    // Privacy: summary must remain metadata-only and free of secret-like keys or banned substrings
    expectNoSecretLikeKeys(summary);
    expectNoBannedSubstrings(summary as unknown as Record<string, unknown>);
  });

  it("builds a stable summary from the golden decision review fixture", () => {
    const fixture = golden as GoldenDecisionReviewFixture;
    const review = fixture.review;

    const summary = buildCeeReviewSummaryFromReview(review);

    expect(summary.headline).toBe(review.story.headline);
    expect(summary.health.status).toBe(review.journey.health.overallStatus);
    expect(summary.any_truncated).toBe(
      Boolean(review.story.any_truncated || review.journey.health.any_truncated),
    );

    // Privacy: golden-based summaries should also be metadata-only
    expectNoSecretLikeKeys(summary);
    expectNoBannedSubstrings(summary as unknown as Record<string, unknown>);
  });

  it("throws a clear error when given a malformed review", () => {
    const bad: unknown = { not: "a review" };

    expect(() => buildCeeReviewSummaryFromReview(bad as CeeDecisionReviewPayload)).toThrow(
      /does not look like CeeDecisionReviewPayload/i,
    );
  });

  it("formats a pretty summary without leaking implementation details", () => {
    const fixture = golden as GoldenDecisionReviewFixture;
    const review = fixture.review;

    const summary = buildCeeReviewSummaryFromReview(review);
    const text = formatCeeReviewSummaryPretty(summary);

    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
    expect(text.toLowerCase()).toContain("headline:");
    expect(text.toLowerCase()).toContain("health:");
    expect(text.toLowerCase()).toContain("journey:");

    // Pretty output should be safe to print in logs/CLIs
    expectNoBannedSubstrings({ text });
  });
});
