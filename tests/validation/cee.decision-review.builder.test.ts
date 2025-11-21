import { describe, it, expect } from "vitest";

import type { CeeDecisionReviewPayloadV1 } from "../../src/contracts/cee/decision-review.js";
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

describe("CEE Decision Review v1 builder compatibility", () => {
  it("emits a payload compatible with CeeDecisionReviewPayloadV1", () => {
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

    // Type-level compatibility between SDK helper type and server contract.
    type _SdkToV1 = CeeDecisionReviewPayload extends CeeDecisionReviewPayloadV1 ? true : never;
    type _V1ToSdk = CeeDecisionReviewPayloadV1 extends CeeDecisionReviewPayload ? true : never;

    const _sdkToV1: _SdkToV1 = true;
    const _v1ToSdk: _V1ToSdk = true;
    void _sdkToV1;
    void _v1ToSdk;

    const v1Review: CeeDecisionReviewPayloadV1 = review;

    expect(v1Review.story).toBeDefined();
    expect(v1Review.journey).toBeDefined();
    expect(v1Review.uiFlags).toBeDefined();
    expect(v1Review.trace?.request_id).toBe("r-dr-v1");
  });
});
