/**
 * 1.41 FIX 3 — decision_review consume + attach, flag-gated.
 *
 * Investigation (see Docs/lanes/LANE-REVIEW-DELIVERABLE-1.41.md): the
 * block-composition path for `review_card` / `coaching` / `evidence`
 * blocks from `enrichment.decision_review` ALREADY EXISTS and is ALREADY
 * flag-gated — `compose.ts`'s `rebuildPhase3BlocksFresh` runs
 * unconditionally whenever `enrichment.decision_review` is present on a
 * run_analysis fact, and `enrichment.decision_review` is only populated
 * when `config.cee.runAnalysisAwaitDecisionReview`
 * (`V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW`, default false) gates
 * `enrichRunAnalysisWithDecisionReview` to actually run (see
 * turn-executor.ts ~L5375, `chip-click-decision-review-attachment.integration.test.ts`).
 *
 * What was MISSING — and what this file adds — is direct proof that:
 *   1. The blocks emitted when the review result is present are not just
 *      "present", they VALIDATE against the actual wire-boundary Zod
 *      schemas (`@talchain/schemas/boundary` — the same package UI's
 *      `mapV5Blocks` reads). This is the "attach it to the wire AS THE
 *      ALREADY-SUPPORTED TYPED BLOCKS" contract the task names — proven
 *      here, not just assumed.
 *   2. bias_findings, key_assumptions, pre_mortem, and the flip narrative
 *      each land in a specific block (review_card:bias / coaching:assumption
 *      / review_card:pre_mortem / review_card:flip_threshold respectively).
 *   3. Flag OFF (no `enrichment.decision_review`) is BYTE-IDENTICAL to
 *      today: same facts, same graph_hash — the composed blocks differ
 *      ONLY by the absence of decision_review-derived blocks. No other
 *      field on `analysis_result` changes.
 *
 * FIX 1/2 groundwork this depends on: this call path shares
 * `buildDecisionReviewUserMessage` (bounded prompt, FIX 2) but does NOT
 * go through PLoT's `/v2/run` client (FIX 1's timeout budget targets a
 * different call), since `enrichRunAnalysisWithDecisionReview` invokes
 * the LLM adapter directly. FIX 1 is not exercised by this file.
 */

import { describe, expect, it } from 'vitest';
import { BlockSchema } from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { composeToolCallResponse } from '../compose.js';

const GRAPH_HASH = 'gh_fix3_test_0001';
const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** Real-shaped decision_review LLM output — same fixture pattern as the
 *  existing chip-click-decision-review-attachment.integration.test.ts,
 *  extended to guarantee bias_findings / key_assumptions / pre_mortem /
 *  flip_thresholds ALL populate (the four content types FIX 3 names). */
const DECISION_REVIEW_OUTPUT: Record<string, unknown> = {
  narrative_summary: 'Plan A leads with a comfortable margin given the current evidence base.',
  story_headlines: { opt_a: 'Plan A wins on delivery confidence' },
  robustness_explanation: {
    summary: 'The lead is robust across most plausible scenarios.',
    primary_risk: 'Delivery risk volatility could compress the margin.',
    stability_factors: [],
    fragility_factors: [],
  },
  readiness_rationale: 'Model is ready for decision.',
  evidence_enhancements: {
    fac_delivery_risk: {
      specific_action: 'pull on-time delivery rate from the last two releases',
      rationale: 'delivery rate is the highest-leverage variance driver',
      evidence_type: 'internal_data',
      decision_hygiene: 'estimate first, then check the data',
    },
  },
  scenario_contexts: {},
  flip_thresholds: [
    {
      factor_id: 'fac_delivery_risk',
      factor_label: 'Delivery risk',
      current_display: 'low',
      flip_display: 'high',
      narrative: 'A move from low to high delivery risk would change the leader.',
    },
  ],
  bias_findings: [
    {
      type: 'ANCHORING',
      source: 'structural',
      description: 'Multiple factors share a default baseline; verify before relying.',
      affected_elements: ['fac_delivery_risk'],
      suggested_action: 'Check estimates against base rates.',
    },
  ],
  key_assumptions: ['Market conditions persist for the next two quarters.'],
  decision_quality_prompts: [
    {
      question: 'What would change your mind about delivery risk?',
      principle: 'Disconfirmation',
      applies_because: 'Margin is moderate.',
    },
  ],
  pre_mortem: {
    failure_scenario: 'The team underestimates integration cost.',
    warning_signs: ['Velocity drops during integration weeks'],
    mitigation: 'Weekly cross-team review.',
    grounded_in: ['fac_delivery_risk'],
  },
};

function makeRunAnalysisFact(withDecisionReview: boolean): HandlerFact {
  const enrichment: Record<string, unknown> = {
    graph: { nodes: [{ id: 'fac_delivery_risk', label: 'Delivery risk', kind: 'factor' }] },
    factor_sensitivity: [{ factor_id: 'fac_delivery_risk', confidence: 0.2 }],
    option_comparison: [
      {
        option_id: 'opt_a',
        option_label: 'Plan A',
        status: 'computed',
        outcome: { mean: 0.05, p10: -0.1, p50: 0.05, p90: 0.2 },
        win_probability: 0.7,
      },
    ],
  };
  if (withDecisionReview) {
    enrichment.decision_review = { ...DECISION_REVIEW_OUTPUT, produced_at: '2026-07-08T00:00:00.000Z' };
  }
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'Ran analysis on your current scenario.',
      win_probabilities: { opt_a: 0.7 },
      graph_hash_at_run: GRAPH_HASH,
      computed_at: '2026-07-08T00:00:00.000Z',
      enrichment,
    },
  } as unknown as HandlerFact;
}

function compose(withDecisionReview: boolean) {
  return composeToolCallResponse({
    orientation: '',
    confirmation: 'Ran analysis on your current scenario.',
    coaching: null,
    stage: 'analyse',
    handlerFacts: [makeRunAnalysisFact(withDecisionReview)],
  });
}

describe('1.41 FIX 3 — decision_review consume + attach (flag semantics: enrichment.decision_review presence)', () => {
  it('flag ON (decision_review present): every emitted block validates against the wire BlockSchema', () => {
    const composed = compose(true);
    expect(composed.blocks.length).toBeGreaterThan(1); // more than just analysis_result

    for (const block of composed.blocks) {
      const parsed = BlockSchema.safeParse(block);
      if (!parsed.success) {
        throw new Error(
          `Block failed BlockSchema validation (type=${(block as { type?: unknown }).type}): ` +
            JSON.stringify(parsed.error.flatten(), null, 2),
        );
      }
    }
  });

  it('flag ON: bias_findings lands in a review_card:bias block', () => {
    const composed = compose(true);
    const biasBlocks = composed.blocks.filter(
      (b) => b.type === 'review_card' && (b as { card_kind?: string }).card_kind === 'bias',
    );
    expect(biasBlocks.length).toBeGreaterThan(0);
  });

  it('flag ON: key_assumptions lands in a coaching:assumption_check block', () => {
    const composed = compose(true);
    const assumptionBlocks = composed.blocks.filter(
      (b) => b.type === 'coaching' && (b as { coaching_kind?: string }).coaching_kind === 'assumption_check',
    );
    expect(assumptionBlocks.length).toBeGreaterThan(0);
  });

  it('flag ON: pre_mortem lands in a review_card:pre_mortem block', () => {
    const composed = compose(true);
    const preMortemBlocks = composed.blocks.filter(
      (b) => b.type === 'review_card' && (b as { card_kind?: string }).card_kind === 'pre_mortem',
    );
    expect(preMortemBlocks.length).toBe(1);
  });

  it('flag ON: the flip narrative lands in a review_card:flip_threshold block', () => {
    const composed = compose(true);
    const flipBlocks = composed.blocks.filter(
      (b) => b.type === 'review_card' && (b as { card_kind?: string }).card_kind === 'flip_threshold',
    );
    expect(flipBlocks.length).toBeGreaterThan(0);
  });

  it('flag OFF (decision_review absent): byte-identical to today — no review_card/coaching/evidence blocks, analysis_result unchanged apart from the (already-existing, present-only) decision_review passthrough field', () => {
    const withReview = compose(true);
    const withoutReview = compose(false);

    // Only the analysis_result block survives when decision_review is absent.
    expect(withoutReview.blocks).toHaveLength(1);
    expect(withoutReview.blocks[0]!.type).toBe('analysis_result');

    // The analysis_result block is otherwise IDENTICAL whether or not
    // decision_review fires — attachment only ADDS blocks and (per the
    // pre-existing, FIX-3-unrelated safe-transport keep-list at
    // compose.ts:308) forwards `enrichment.decision_review` present-only
    // on analysis_result itself; it never mutates any other field.
    type AnalysisResultBlock = { type: 'analysis_result'; enrichment?: Record<string, unknown> };
    const analysisWithReview = withReview.blocks.find((b) => b.type === 'analysis_result') as
      | AnalysisResultBlock
      | undefined;
    const analysisWithoutReview = withoutReview.blocks.find((b) => b.type === 'analysis_result') as
      | AnalysisResultBlock
      | undefined;
    expect(analysisWithoutReview?.enrichment?.decision_review).toBeUndefined();
    expect(analysisWithReview?.enrichment?.decision_review).toBeDefined();
    const { decision_review: _omittedWith, ...enrichmentWithoutReview } =
      analysisWithReview?.enrichment ?? {};
    expect(analysisWithoutReview?.enrichment).toEqual(enrichmentWithoutReview);
    expect({ ...analysisWithoutReview, enrichment: undefined }).toEqual({
      ...analysisWithReview,
      enrichment: undefined,
    });

    // No decision_review-derived block types leak through when absent.
    const typesWithout = new Set(withoutReview.blocks.map((b) => b.type));
    expect(typesWithout.has('review_card')).toBe(false);
    expect(typesWithout.has('coaching')).toBe(false);
    expect(typesWithout.has('evidence')).toBe(false);
  });
});
