/**
 * Source-of-truth contract test for POST_ANALYSIS_EXPLANATION_ACTIONS.
 *
 * Pins the membership of the policy set so a future maintainer can't
 * silently change which tools are classified as read-only explanation tools.
 */

import { describe, it, expect } from "vitest";
import { POST_ANALYSIS_EXPLANATION_ACTIONS } from "../../../../src/orchestrator/deterministic/post-analysis-policy.js";
import type { ActionName } from "../../../../src/orchestrator/deterministic/actions/types.js";

const EXPECTED_MEMBERS: readonly ActionName[] = [
  'explain_result',
  'compare_options',
  'what_would_flip',
];

describe("POST_ANALYSIS_EXPLANATION_ACTIONS (policy module)", () => {
  it("pins exact membership of the explanation tool set", () => {
    expect(POST_ANALYSIS_EXPLANATION_ACTIONS.size).toBe(EXPECTED_MEMBERS.length);
    for (const member of EXPECTED_MEMBERS) {
      expect(POST_ANALYSIS_EXPLANATION_ACTIONS.has(member)).toBe(true);
    }
  });

  it("does NOT contain run_analysis (run_analysis is suppressed by a separate staleness rule, not this policy)", () => {
    expect(POST_ANALYSIS_EXPLANATION_ACTIONS.has('run_analysis')).toBe(false);
  });
});
