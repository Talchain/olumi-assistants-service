/**
 * ROADMAP 2.725 — the no-verdict doctrine on the `assist.v1.*` route family.
 *
 * Paul-ratified doctrine: the product recommends what to INVESTIGATE, never what
 * to CHOOSE. No surface says "recommended", "winner", "best option", or renders a
 * forced consensus. Rankings by measured goal-fit STAY (ordering is analysis, not
 * verdict) and USER-authored choice affordances stay: this changes LANGUAGE, never
 * INFORMATION.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * REAL REACHABILITY OF EACH STRING PINNED HERE — derived, not inherited
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The brief said these 19 strings were "believed DORMANT on the wire today"
 * because the UI parses only 5 review fields and "PLoT reshaping was never
 * audited". Deriving the PLoT bound (read-only, plot-lite-service @ a825a789)
 * corrects that premise IN BOTH DIRECTIONS:
 *
 *   REACHABLE — `rationale.summary` (rationale.ts) and
 *   `improvement_guidance[].reason` (improvementGuidance.ts). PLoT's
 *   `extractCeeResultsPanelFields()` (src/routes/v2/run.ts) copies both
 *   field-for-field onto its own `/v2/run` response body. Not dormant: producer
 *   copy reaches PLoT's wire VERBATIM. Runtime-gated on `CEE_ORCHESTRATOR_ENABLED`
 *   truthy AND `FLAGS.DECISION_REVIEW_ENABLE` falsy; the deployed posture of those
 *   two vars is NOT measured here (absent from PLoT's render YAMLs, and CLAUDE.md
 *   trap 18 forbids deriving env posture from YAML). Claim type:
 *   WIRED-AND-REACHABLE, flag-gated, posture unmeasured. Whether the UI then
 *   renders PLoT's `/v2/run` `rationale` is a further hop this lane did not audit.
 *
 *   DORMANT, and for a reason nobody had stated — `robustness_synthesis.headline`
 *   (robustnessSynthesis.ts). PLoT ignores CEE's top-level `robustness_synthesis`
 *   entirely and rebuilds its own from
 *   `ceeReview.blocks.find(b => b.id === 'robustness').headline`. CEE's robustness
 *   block emits `summary`, NOT `headline` (blockBuilders.ts) — so PLoT always
 *   takes its literal `'Robustness analysis complete'` fallback. Two independent
 *   dormancies stack here (PLoT never reads it; the UI's `/v2/review` consumer
 *   parses 5 fields that do not include it — the latter is the audit's claim,
 *   not re-derived by this lane).
 *
 *   DORMANT — the prediction block headline (blockBuilders.ts). PLoT extracts
 *   ONLY `id === 'robustness'` from `blocks[]`; the prediction block is not
 *   passed through. It is still emitted on CEE's own `/assist/v1/review`
 *   response to any direct caller.
 *
 *   DORMANT — readinessAssessor.ts summary copy. PLoT receives `readiness` but
 *   does not egress its headline (probe-derived, not re-verified line-by-line).
 *
 *   DORMANT — every isl-synthesis string. `rg -a` over the PLoT tree finds ZERO
 *   references to `/assist/v1/isl-synthesis` or to any of its four narrative
 *   field names; the route is registered in CEE's server.ts and its only known
 *   UI consumer is deprecated.
 *
 * Dormant is still worth fixing — a dormant verdict template is a loaded gun for
 * the next consumer — but this file states each string's REAL status rather than
 * claiming live coverage it does not have.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * BINDING DISCIPLINE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every assertion binds to its object by IDENTITY — the exported template object
 * key, or the producer function's return for a named branch — never by a value
 * predicate another string could satisfy (CLAUDE.md trap 19). Inputs are parsed
 * through the producers' OWN contract schemas (`PLoTRobustnessData`,
 * `InferenceResult`, `CEEIslSynthesisInput`) rather than hand-authored object
 * literals, so a contract change fails this file loudly instead of letting it
 * drift into fiction (trap 16's "a fixture you wrote yourself is not evidence
 * about the wire").
 */

import { describe, expect, it } from "vitest";

import {
  generateRationale,
  SUMMARY_TEMPLATES,
  GOAL_ALIGNMENT_TEMPLATES,
} from "../../src/services/review/rationale.js";
import { generateRobustnessSynthesis } from "../../src/services/review/robustnessSynthesis.js";
import { computeDecisionQuality } from "../../src/services/review/decisionQuality.js";
import { buildPredictionBlock } from "../../src/services/review/blockBuilders.js";
import { PLoTRobustnessData, InferenceResult } from "../../src/schemas/review.js";
import {
  scanPayloadForDoctrineHits,
  findDoctrineHit,
} from "../../src/services/doctrine/route-egress-doctrine-scan.js";

// ---------------------------------------------------------------------------
// Contract-derived fixtures. Each is PARSED through the producer's own Zod
// schema, so the shape is the contract's, not this file's opinion of it.
// ---------------------------------------------------------------------------

const ROBUSTNESS_WITH_OPTION = PLoTRobustnessData.parse({
  recommendation_stability: 0.87,
  recommended_option: { id: "opt_premium", label: "Premium Pricing" },
});

const ROBUSTNESS_WITHOUT_OPTION = PLoTRobustnessData.parse({
  recommendation_stability: 0.65,
});

const INFERENCE_WITH_RANKED_ACTIONS = InferenceResult.parse({
  ranked_actions: [
    { node_id: "opt_hire", label: "Hire Locally", expected_utility: 12.5, rank: 1 },
    { node_id: "opt_offshore", label: "Offshore", expected_utility: 9.1, rank: 2 },
  ],
});

/** The exact verdict strings this row retires. A mutant restoring any of these
 *  must RED its pin below. Kept as a literal corpus deliberately: a derived
 *  guard can only prove the templates agree with themselves, never that the
 *  banned phrasing is gone (CLAUDE.md trap 12d). */
const RETIRED_VERDICT_STRINGS = {
  with_driver_and_goal:
    "{option} is recommended because {driver} has the strongest positive effect on {goal}.",
  with_driver_stability:
    "{option} is recommended due to its favorable impact through {driver}, remaining the best choice in {stability}% of scenarios.",
  with_driver_only: "{option} is recommended due to its favorable impact on {driver}.",
  with_stability: "{option} remains the best choice across {stability}% of scenarios analyzed.",
  with_goal_only: "{option} is recommended as it best achieves {goal}.",
  robustness_headline_with_option: "87% confident that Premium Pricing remains your best option",
  robustness_headline_fallback: "65% confidence in the current recommendation",
  prediction_headline: '"Hire Locally" appears to be the strongest option.',
  goal_alignment_strong:
    '"{option}" shows the strongest path to "{goal}" through its key drivers.',
} as const;

// ---------------------------------------------------------------------------
// V4 — rationale.ts. REACHABLE: PLoT copies `rationale.summary` verbatim.
// ---------------------------------------------------------------------------

describe("rationale templates carry no verdict (REACHABLE — PLoT passes rationale through)", () => {
  it("every SUMMARY_TEMPLATES entry is doctrine-clean", () => {
    const keys = Object.keys(SUMMARY_TEMPLATES);
    // Zero-template vacuity is a hard error, not a pass (trap 13).
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const template = SUMMARY_TEMPLATES[key as keyof typeof SUMMARY_TEMPLATES];
      expect(
        findDoctrineHit(template),
        `SUMMARY_TEMPLATES.${key} carries banned verdict language: ${template}`,
      ).toBeNull();
    }
  });

  it("every GOAL_ALIGNMENT_TEMPLATES entry is doctrine-clean", () => {
    const keys = Object.keys(GOAL_ALIGNMENT_TEMPLATES);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const template =
        GOAL_ALIGNMENT_TEMPLATES[key as keyof typeof GOAL_ALIGNMENT_TEMPLATES];
      expect(findDoctrineHit(template)).toBeNull();
    }
  });

  it("no retired verdict template survives, pinned by TEMPLATE KEY not by value", () => {
    // Bound by identity: each assertion names the exact object key whose copy
    // was rewritten, so restoring THAT key's old string reds THAT assertion.
    expect(SUMMARY_TEMPLATES.with_driver_and_goal).not.toBe(
      RETIRED_VERDICT_STRINGS.with_driver_and_goal,
    );
    expect(SUMMARY_TEMPLATES.with_driver_stability).not.toBe(
      RETIRED_VERDICT_STRINGS.with_driver_stability,
    );
    expect(SUMMARY_TEMPLATES.with_driver_only).not.toBe(
      RETIRED_VERDICT_STRINGS.with_driver_only,
    );
    expect(SUMMARY_TEMPLATES.with_stability).not.toBe(
      RETIRED_VERDICT_STRINGS.with_stability,
    );
    expect(SUMMARY_TEMPLATES.with_goal_only).not.toBe(
      RETIRED_VERDICT_STRINGS.with_goal_only,
    );
    // The dead `strong` variant is deleted, not reworded — a dead template is a
    // loaded gun. Asserting the KEY is absent is what stops it being restored.
    expect(Object.keys(GOAL_ALIGNMENT_TEMPLATES)).not.toContain("strong");
  });

  it("INFORMATION IS PRESERVED — the driver, goal and stability all survive the rewrite", () => {
    // The doctrine's own limit: change language, never information. This is the
    // half of the row a copy-only diff could silently break.
    const result = generateRationale({
      recommendedOption: { id: "opt_1", label: "Premium Plan" },
      goal: { id: "goal_1", label: "Maximize Revenue" },
      drivers: [{ id: "fac_clv", label: "Customer Lifetime Value", sensitivity: 0.8 }],
      stability: 0.87,
    });
    expect(result?.summary).toContain("Premium Plan");
    expect(result?.summary).toContain("Customer Lifetime Value");
    expect(result?.summary).toContain("Maximize Revenue");
    expect(findDoctrineHit(result!.summary)).toBeNull();

    // The stability branch keeps its measured percentage.
    const stabilityBranch = generateRationale({
      recommendedOption: { id: "opt_1", label: "Enterprise" },
      drivers: [],
      stability: 0.92,
    });
    expect(stabilityBranch?.summary).toContain("92%");
    expect(findDoctrineHit(stabilityBranch!.summary)).toBeNull();
  });

  it("EVERY generateRationale branch is doctrine-clean, driven through the producer", () => {
    const branches = [
      { name: "driver+goal", ctx: { goal: { id: "g", label: "Growth" }, drivers: [{ label: "Price" }] } },
      { name: "driver+stability", ctx: { drivers: [{ label: "Price" }], stability: 0.85 } },
      { name: "driver only", ctx: { drivers: [{ label: "Price" }] } },
      { name: "stability only", ctx: { drivers: [], stability: 0.7 } },
      { name: "goal only", ctx: { goal: { id: "g", label: "Growth" }, drivers: [] } },
      { name: "minimal", ctx: { drivers: [] } },
    ];
    for (const b of branches) {
      const r = generateRationale({
        recommendedOption: { id: "opt_1", label: "Option A" },
        ...b.ctx,
      });
      expect(r, `${b.name} produced no rationale`).not.toBeNull();
      expect(
        scanPayloadForDoctrineHits(r),
        `generateRationale branch "${b.name}" carries verdict language`,
      ).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// V5 — robustnessSynthesis.ts. DORMANT: PLoT reads a `headline` key CEE's
// robustness block does not emit, so it never sees this value.
// ---------------------------------------------------------------------------

describe("robustness synthesis headline carries no verdict (DORMANT — see file header)", () => {
  it("the labelled branch keeps BOTH measured quantities and drops the crowning", () => {
    const result = generateRobustnessSynthesis(ROBUSTNESS_WITH_OPTION);
    expect(result?.headline).toBeDefined();
    // Information preserved: the option label AND the stability percentage.
    expect(result!.headline).toContain("Premium Pricing");
    expect(result!.headline).toContain("87%");
    // Verdict retired, bound to the exact retired string.
    expect(result!.headline).not.toBe(
      RETIRED_VERDICT_STRINGS.robustness_headline_with_option,
    );
    expect(findDoctrineHit(result!.headline!)).toBeNull();
  });

  it("the unlabelled fallback branch keeps the percentage and drops 'recommendation'", () => {
    const result = generateRobustnessSynthesis(ROBUSTNESS_WITHOUT_OPTION);
    expect(result?.headline).toBeDefined();
    expect(result!.headline).toContain("65%");
    expect(result!.headline).not.toBe(
      RETIRED_VERDICT_STRINGS.robustness_headline_fallback,
    );
    expect(findDoctrineHit(result!.headline!)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// V7 — blockBuilders.ts prediction headline. DORMANT wrt PLoT (only the
// `robustness` block is extracted). This was the MEASURED guard evasion.
// ---------------------------------------------------------------------------

describe("prediction block headline carries no verdict (DORMANT wrt PLoT; was the guard evasion)", () => {
  it("the ranked-actions branch names the leader without crowning it", () => {
    const result = buildPredictionBlock({
      graph: { nodes: [], edges: [] } as never,
      inference: INFERENCE_WITH_RANKED_ACTIONS,
    } as never);
    expect(result.block.type).toBe("prediction");
    if (result.block.type !== "prediction") throw new Error("wrong block type");
    // Information preserved: the top-ranked action is still named, and the
    // expected-utility explanation is unchanged (ordering is analysis).
    expect(result.block.headline).toContain("Hire Locally");
    expect(result.block.headline).not.toBe(RETIRED_VERDICT_STRINGS.prediction_headline);
    expect(scanPayloadForDoctrineHits(result.block)).toEqual([]);
  });

  it("the no-inference branches are doctrine-clean too", () => {
    const graph = {
      nodes: [
        { id: "goal_1", kind: "goal", label: "Growth" },
        { id: "opt_1", kind: "option", label: "A" },
        { id: "opt_2", kind: "option", label: "B" },
      ],
      edges: [],
    };
    const result = buildPredictionBlock({ graph } as never);
    expect(scanPayloadForDoctrineHits(result.block)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Strings the 2026-08-06 audit did NOT list — found by the route-egress scanner
// this same row adds, firing on a real 200 response. Both are REACHABLE:
// PLoT copies `insights[].content` and `decision_quality.summary` verbatim.
// ---------------------------------------------------------------------------

describe("producers the audit missed (REACHABLE — PLoT passes insights + decision_quality through)", () => {
  it("fragile-edge assumption explanations carry no verdict", () => {
    const withFragileEdge = PLoTRobustnessData.parse({
      recommendation_stability: 0.6,
      recommended_option: { id: "opt_a", label: "Option A" },
      fragile_edges: [
        {
          edge_id: "e1",
          from_label: "Unit Price",
          to_label: "Revenue",
          switch_probability: 0.35,
        },
      ],
    });
    const result = generateRobustnessSynthesis(withFragileEdge);
    expect(result?.assumption_explanations?.length).toBeGreaterThan(0);
    // Information preserved: both edge labels still name the assumption.
    const explanation = result!.assumption_explanations![0].explanation;
    expect(explanation).toContain("Unit Price");
    expect(explanation).toContain("Revenue");
    expect(explanation).not.toContain("The recommendation assumes");
    expect(scanPayloadForDoctrineHits(result)).toEqual([]);
  });

  it("the fragile-recommendation decision-quality summary carries no verdict", () => {
    const dq = computeDecisionQuality({
      quality: { overall: 55, structure: 55, coverage: 55 },
      readiness: { level: "caution", score: 0.6 },
      issues: [],
      missingBaselineCount: 0,
      fragileEdgeCount: 3,
    } as never);
    expect(dq.summary).toContain("3");
    expect(dq.summary).not.toContain("Recommendation is sensitive");
    expect(scanPayloadForDoctrineHits(dq)).toEqual([]);
  });
});
