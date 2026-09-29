import { describe, it, expect } from "vitest";

import type { CeeDecisionReviewBundle } from "../../src/contracts/cee/decision-review.js";
import {
  buildCeeDecisionReviewPayload,
  type CeeDecisionReviewPayload,
  type CeeJourneyEnvelopes,
} from "../../sdk/typescript/src/ceeHelpers.js";
import type {
  CEEDraftGraphResponseV1,
  CEEOptionsResponseV1,
  CEEEvidenceHelperResponseV1,
  CEEBiasCheckResponseV1,
  CEETeamPerspectivesResponseV1,
} from "../../sdk/typescript/src/ceeTypes.js";

describe("CEE Decision Review Bundle builder compatibility", () => {
  it("emits a payload compatible with CeeDecisionReviewBundle", () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-dr-v1", correlation_id: "r-dr-v1", engine: {} },
      quality: { overall: 7 } as any,
      graph: {} as any,
    } as any;

    const options: CEEOptionsResponseV1 = {
      trace: { request_id: "r-dr-v1", correlation_id: "r-dr-v1", engine: {} },
      quality: { overall: 7 } as any,
      options: [{ id: "opt-1" } as any],
    } as any;

    const evidence: CEEEvidenceHelperResponseV1 = {
      trace: { request_id: "r-dr-v1", correlation_id: "r-dr-v1", engine: {} },
      quality: { overall: 6 } as any,
      items: [{ id: "e1" } as any],
    } as any;

    const bias: CEEBiasCheckResponseV1 = {
      trace: { request_id: "r-dr-v1", correlation_id: "r-dr-v1", engine: {} },
      quality: { overall: 6 } as any,
      bias_findings: [] as any,
    } as any;

    const team: CEETeamPerspectivesResponseV1 = {
      trace: { request_id: "r-dr-v1", correlation_id: "r-dr-v1", engine: {} },
      quality: { overall: 7 } as any,
      summary: {
        participant_count: 3,
        for_count: 2,
        against_count: 1,
        neutral_count: 0,
        weighted_for_fraction: 2 / 3,
        disagreement_score: 0.4,
      } as any,
    } as any;

    const envelopes: CeeJourneyEnvelopes = { draft, options, evidence, bias, team };

    const review: CeeDecisionReviewPayload = buildCeeDecisionReviewPayload(envelopes);

    // Type-level compatibility between SDK helper type and server contract bundle type.
    type _SdkToBundle = CeeDecisionReviewPayload extends CeeDecisionReviewBundle ? true : never;
    type _BundleToSdk = CeeDecisionReviewBundle extends CeeDecisionReviewPayload ? true : never;

    const _sdkToBundle: _SdkToBundle = true;
    const _bundleToSdk: _BundleToSdk = true;
    void _sdkToBundle;
    void _bundleToSdk;

    const bundleReview: CeeDecisionReviewBundle = review;

    expect(bundleReview.story).toBeDefined();
    expect(bundleReview.journey).toBeDefined();
    expect(bundleReview.uiFlags).toBeDefined();
    expect(bundleReview.trace?.request_id).toBe("r-dr-v1");
  });
});
