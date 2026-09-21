/**
 * BIAS-SURFACE LIVENESS GATE — legs 1 and 2b.
 *
 * Design record binding (each case is bound to a named surface in
 * AI-EXPERIENCE-DESIGN-DRAFT-2026-07-14.md §1.5; the surface list there is
 * the source of truth — see BIAS-COACHING-PROPOSAL-2026-07-16.md §4):
 *
 *   Leg 1  (§1.5 spine)  — POSITIVE CONTROL: the deterministic 12-bias
 *          engine (src/cee/bias/) emits >=2 non-empty findings for the
 *          checked-in fixture graph. Every downstream absence assertion
 *          is vacuous without this (trap-13).
 *   Leg 2b (§1.5(3) REALITY-TEST surface) — a decision_review response
 *          carrying bias_findings still yields `review_card` blocks with
 *          `card_kind: 'bias'` (warning severity, no banner language).
 *
 *   Leg 2a (§1.5(1) FRAME surface, CEE side) lives in
 *          tests/unit/cee.bias-liveness-gate.pipeline.test.ts (needs the
 *          stage-level mock scaffold; kept separate so THIS file stays
 *          mock-free — the engine and card builder here are the real
 *          modules).
 *   Leg 3  (UI surfaces) lives in DecisionGuideAI (Track-2).
 *   Leg 4  (served-prompt behaviour) is
 *          scripts/bias-prompt-liveness-postcheck.ts — run on every
 *          prompt promotion.
 *
 * If this gate goes RED, a named bias surface has been silenced. That is
 * a design violation requiring a §5-class ruling, not a test to relax
 * (§1.5 closing rule).
 */

import { describe, expect, it } from "vitest";
import type { RunAnalysisHandlerFact } from "@talchain/schemas/orchestrator";

import { detectBiases, sortBiasFindings } from "../../src/cee/bias/index.js";
import {
  buildGraphNodeLookup,
  buildReviewCardBlocks,
  type BlockBuildCtx,
} from "../../src/orchestrator-v5/compose/phase3-blocks.js";
import {
  BIAS_LIVENESS_GRAPH,
  BIAS_LIVENESS_EXPECTED_FINDING_IDS,
  BIAS_LIVENESS_REVIEW_GRAPH_NODES,
  DECISION_REVIEW_BIAS_FIXTURE,
} from "../fixtures/cee/bias-liveness.fixture.js";

const CTX: BlockBuildCtx = {
  created_at: "2026-07-16T12:00:00.000Z",
  graph_hash_at_generation: "gh_bias_liveness_0001",
};

function makeReviewFact(): RunAnalysisHandlerFact {
  return {
    fact_type: "run_analysis",
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: "scen-bias-liveness",
      leading_option_id: "opt_continue",
      summary: "Ran analysis on your current scenario.",
      graph_hash_at_run: CTX.graph_hash_at_generation,
      computed_at: "2026-07-16T11:59:00.000Z",
      enrichment: {
        decision_review: DECISION_REVIEW_BIAS_FIXTURE,
        graph: { nodes: BIAS_LIVENESS_REVIEW_GRAPH_NODES },
      },
    },
  } as unknown as RunAnalysisHandlerFact;
}

describe("bias-surface liveness gate — leg 1: engine positive control (§1.5 spine)", () => {
  it("emits >=2 findings for the fixture graph, flag-independent detectors included", () => {
    const findings = detectBiases(BIAS_LIVENESS_GRAPH as never, null);

    // Positive control: non-empty, and specifically the two detectors the
    // fixture is constructed to trip. If either id vanishes, a detector
    // was renamed or removed — reconcile with the design record, do not
    // relax this assertion.
    expect(findings.length).toBeGreaterThanOrEqual(2);
    const ids = findings.map((f) => f.id);
    for (const expected of BIAS_LIVENESS_EXPECTED_FINDING_IDS) {
      expect(ids).toContain(expected);
    }

    // Findings must be user-explainable: category, severity, explanation.
    for (const f of findings) {
      expect(f.category).toBeTruthy();
      expect(f.severity).toBeTruthy();
      expect(typeof f.explanation).toBe("string");
      expect((f.explanation as string).length).toBeGreaterThan(0);
    }
  });

  it("survives deterministic ordering (sortBiasFindings keeps both control findings)", () => {
    const sorted = sortBiasFindings(
      detectBiases(BIAS_LIVENESS_GRAPH as never, null),
      "bias-liveness-seed",
    );
    const ids = sorted.map((f) => f.id);
    for (const expected of BIAS_LIVENESS_EXPECTED_FINDING_IDS) {
      expect(ids).toContain(expected);
    }
  });
});

describe("bias-surface liveness gate — leg 2b: decision_review → review_card card_kind 'bias' (§1.5(3))", () => {
  it("yields at least one bias review card from the fixture decision_review response", () => {
    const fact = makeReviewFact();
    const blocks = buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX);

    const biasCards = blocks.filter((b) => b.card_kind === "bias");
    expect(biasCards.length).toBeGreaterThanOrEqual(1);

    for (const card of biasCards) {
      // Card spec (COACHING-REVIEW-UI-BRIEF.md, ratified): warning — never
      // danger — severity, and no "bias detected" banner language.
      expect(card.severity).toBe("warning");
      expect(card.title.toLowerCase()).not.toContain("bias detected");
      expect(card.body.length).toBeGreaterThan(0);
      // No raw node ids may leak into user-facing prose.
      expect(card.title).not.toMatch(/\b(?:fac|opt|out|risk|goal|dec|node)_[a-z0-9_]+\b/i);
      expect(card.body).not.toMatch(/\b(?:fac|opt|out|risk|goal|dec|node)_[a-z0-9_]+\b/i);
    }
  });

  it("drops to zero cards when bias_findings are removed (the gate discriminates)", () => {
    // Mutation-shaped control INSIDE the gate: the same fact WITHOUT
    // bias_findings must produce zero bias cards, proving the positive
    // case above is seeing the findings, not test scaffolding.
    const fact = makeReviewFact();
    const bare = {
      ...fact,
      result: {
        ...(fact as unknown as { result: Record<string, unknown> }).result,
        enrichment: {
          decision_review: {},
          graph: { nodes: BIAS_LIVENESS_REVIEW_GRAPH_NODES },
        },
      },
    } as unknown as RunAnalysisHandlerFact;
    const blocks = buildReviewCardBlocks(bare, buildGraphNodeLookup(bare), CTX);
    expect(blocks.filter((b) => b.card_kind === "bias")).toHaveLength(0);
  });
});
