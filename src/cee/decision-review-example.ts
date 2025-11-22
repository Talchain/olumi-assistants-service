import type { CeeDecisionReviewPayloadV1 } from "../contracts/cee/decision-review.js";

const CEE_DECISION_REVIEW_EXAMPLE_V1_CANONICAL: CeeDecisionReviewPayloadV1 = {
  story: {
    headline:
      "CEE currently rates overall model quality at 7/10 (high). The model includes 2 explicit decision options. Team input from 3 participants has been summarised. Some response lists were capped; review risks and next actions before treating this as final.",
    key_drivers: [
      "2 CEE options were generated for this decision.",
      "3 evidence items were scored for strength and relevance.",
      "3 team perspectives contributed to this view.",
    ],
    risks_and_gaps: [
      "CEE reported validation issues for this result; check them before treating it as final.",
      "Some lists were truncated for performance; lower-priority items may be missing.",
    ],
    next_actions: [
      "Review the validation issues surfaced by CEE and address structural problems before committing.",
      "If this is a high-impact decision, consider narrowing the scope and re-running CEE to reduce truncation.",
    ],
    any_truncated: true,
    quality_overall: 7,
  },
  journey: {
    story: {
      headline:
        "CEE currently rates overall model quality at 7/10 (high). The model includes 2 explicit decision options. Team input from 3 participants has been summarised. Some response lists were capped; review risks and next actions before treating it as final.",
      key_drivers: [
        "2 CEE options were generated for this decision.",
        "3 evidence items were scored for strength and relevance.",
        "3 team perspectives contributed to this view.",
      ],
      risks_and_gaps: [
        "CEE reported validation issues for this result; check them before treating it as final.",
        "Some lists were truncated for performance; lower-priority items may be missing.",
      ],
      next_actions: [
        "Review the validation issues surfaced by CEE and address structural problems before committing.",
        "If this is a high-impact decision, consider narrowing the scope and re-running CEE to reduce truncation.",
      ],
      any_truncated: true,
      quality_overall: 7,
    },
    health: {
      perEnvelope: {
        draft: {
          status: "ok",
          reasons: [],
          any_truncated: false,
          has_validation_issues: false,
          quality_overall: 7,
          source: "draft",
        },
        options: {
          status: "warning",
          reasons: [
            "Some results were truncated for performance; lower-priority items may be missing.",
          ],
          any_truncated: true,
          has_validation_issues: true,
          quality_overall: 6,
          source: "options",
        },
        evidence: {
          status: "ok",
          reasons: [],
          any_truncated: false,
          has_validation_issues: false,
          quality_overall: 7,
          source: "evidence",
        },
        bias: {
          status: "risk",
          reasons: [
            "CEE reported validation issues for this result; check them before treating it as final.",
          ],
          any_truncated: false,
          has_validation_issues: true,
          quality_overall: 5,
          source: "bias",
        },
        team: {
          status: "ok",
          reasons: [],
          any_truncated: false,
          has_validation_issues: false,
          quality_overall: 7,
          source: "team",
        },
      },
      overallStatus: "risk",
      overallTone: "danger",
      any_truncated: true,
      has_validation_issues: true,
    },
    is_complete: false,
    missing_envelopes: ["explain", "sensitivity"],
    has_team_disagreement: true,
  },
  uiFlags: {
    has_high_risk_envelopes: true,
    has_team_disagreement: true,
    has_truncation_somewhere: true,
    is_journey_complete: false,
  },
  trace: {
    request_id: "cee_req_golden_123",
    correlation_id: "cee_req_golden_123",
  },
};

export const CEE_DECISION_REVIEW_EXAMPLE_V1 = Object.freeze(
  CEE_DECISION_REVIEW_EXAMPLE_V1_CANONICAL,
) as Readonly<CeeDecisionReviewPayloadV1>;

/**
 * Return a fresh deep copy of the canonical Decision Review example payload.
 * This avoids callers mutating the shared template across requests/tests.
 */
export function getCeeDecisionReviewExampleV1(): CeeDecisionReviewPayloadV1 {
  // Payload is plain JSON; a JSON round-trip is sufficient for a deep clone.
  return JSON.parse(JSON.stringify(CEE_DECISION_REVIEW_EXAMPLE_V1_CANONICAL)) as CeeDecisionReviewPayloadV1;
}
