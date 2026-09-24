/**
 * Persist the lens the producer SELECTED onto the run-analysis fact.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The lens id is INSIDE the block identity: `phase3-blocks.ts` mints
 * `coach:lens:${selection.lens}` and derives `block_id` from it. A later turn
 * that rebuilds Phase-3 blocks with a DIFFERENT lens therefore mints a
 * DIFFERENT `block_id`, its match loop falls through, and the user is told a
 * selected finding is `not_in_model` when nothing about their model changed.
 *
 * The selection depends on `previousAnalysisLens`, and `compose`'s prior-fact
 * branch DELIBERATELY omits it (see `buildBlocksFromFacts`), so the input is
 * not recoverable at rebuild time. Recording the OUTPUT is therefore the only
 * honest option — one authority, read later, never recomputed.
 *
 * ── THE DISCRIMINATING PAIR ─────────────────────────────────────────────────
 * A test that passes whatever the lens is has not tested anything. Both arms
 * below drive the REAL producer (`composeToolCallResponse`) over the SAME
 * current-turn fact and differ ONLY in the lens history, which is the one
 * input the selector's no-immediate-repeat tie-break reads:
 *   - no prior analysis  → `sensitivity_flip_risk`
 *   - prior analysis     → `pre_mortem`
 * Fixtures are the a5 golden from `lens-no-immediate-repeat.test.ts`, whose
 * two-arm behaviour is already pinned there against the 31 Jul live walk.
 */

import { describe, expect, it, vi } from 'vitest';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { composeToolCallResponse } from '../../compose.js';
import {
  SELECTED_LENS_ENRICHMENT_KEY,
  attachSelectedLensToRunAnalysisFact,
  readSelectedLensFromFact,
} from '../selected-lens-record.js';
import type { LensId } from '../lens-selector.js';

// ── Fixtures (shape verbatim from lens-no-immediate-repeat.test.ts) ──────────

interface FactorInput {
  readonly factor_id?: string;
  readonly influence_score?: number;
  readonly influence_rank?: number;
  readonly confidence?: number | null;
  readonly flip_risk_category?: string;
}

interface EnrichmentInput {
  readonly factor_sensitivity?: readonly FactorInput[];
  readonly option_comparison?: readonly { readonly win_probability?: number }[];
  readonly confidence_tier?: string;
}

function makeFact(input: EnrichmentInput = {}, hash = 'gh_2211aaaabbbbcccc'): RunAnalysisHandlerFact {
  const enrichment: Record<string, unknown> = {};
  if (input.factor_sensitivity !== undefined) enrichment.factor_sensitivity = input.factor_sensitivity;
  if (input.option_comparison !== undefined) enrichment.option_comparison = input.option_comparison;
  if (input.confidence_tier !== undefined) enrichment.confidence_tier = input.confidence_tier;
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-lens-persist',
      leading_option_id: 'opt_a',
      summary: 'Ran analysis on your current scenario.',
      graph_hash_at_run: hash,
      computed_at: '2026-07-31T10:00:00.000Z',
      enrichment,
    },
  } as unknown as RunAnalysisHandlerFact;
}

/** The a5 golden — flip-risk ISOLATED with pre-mortem's rule 2c simultaneously live. */
const A5_GOLDEN: EnrichmentInput = {
  confidence_tier: 'fair',
  factor_sensitivity: [
    { factor_id: 'fac_sales_capacity', influence_score: 1.0, influence_rank: 1, confidence: 0.3, flip_risk_category: 'isolated' },
    { factor_id: 'fac_market_demand', influence_score: 0.74, influence_rank: 2, confidence: 0.448, flip_risk_category: 'correlated' },
    { factor_id: 'fac_product_investment', influence_score: 0.178, influence_rank: 3, confidence: 0.3, flip_risk_category: 'isolated' },
    { factor_id: 'fac_marketing_spend', influence_score: 0.141, influence_rank: 4, confidence: 0.3, flip_risk_category: 'correlated' },
  ],
  option_comparison: [
    { win_probability: 0.6242 },
    { win_probability: 0.2 },
    { win_probability: 0.1 },
    { win_probability: 0.0758 },
  ],
};

/** The may-recommend-nothing baseline — `selectLens` returns null on this. */
const HEALTHY: EnrichmentInput = {
  confidence_tier: 'strong',
  factor_sensitivity: [
    { factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9 },
    { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
    { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
  ],
  option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
};

/**
 * Drive the real producer and return BOTH what the sink observed and the fact
 * as it would be committed. `priorFacts === undefined` ⇒ no lens history at
 * all; `[]` ⇒ a history that is present but empty (both select with a null
 * previous lens, which is the pre-amendment behaviour).
 */
function runProducer(
  current: RunAnalysisHandlerFact,
  priorFacts?: readonly HandlerFact[],
): { readonly observed: readonly (LensId | null)[]; readonly committed: readonly HandlerFact[] } {
  const observed: (LensId | null)[] = [];
  const onLensSelected = vi.fn((lens: LensId | null) => {
    observed.push(lens);
  });
  composeToolCallResponse({
    answerKind: 'substantive',
    orientation: '',
    confirmation: 'Ran the analysis.',
    coaching: null,
    stage: 'analyse',
    handlerFacts: [current],
    ...(priorFacts !== undefined ? { priorTurnFactsForLensHistory: priorFacts } : {}),
    onLensSelected,
  });
  // The producer reports exactly once per current-turn run_analysis fact.
  expect(onLensSelected).toHaveBeenCalledTimes(1);
  return {
    observed,
    committed: attachSelectedLensToRunAnalysisFact([current], observed[0] ?? null),
  };
}

function enrichmentOf(facts: readonly HandlerFact[]): Record<string, unknown> {
  const fact = facts.find((f) => f.fact_type === 'run_analysis');
  if (fact === undefined || fact.fact_type !== 'run_analysis') {
    throw new Error('fixture error: no run_analysis fact');
  }
  return (fact.result.enrichment ?? {}) as Record<string, unknown>;
}

// ============================================================================
// 1. THE DISCRIMINATING PAIR — the same fact, two histories, two lenses.
// ============================================================================

describe('selected-lens persistence — the discriminating pair', () => {
  it('ARM X: no lens history → the producer selects sensitivity_flip_risk, and the fact records it', () => {
    const { observed, committed } = runProducer(makeFact(A5_GOLDEN), []);
    expect(observed[0]).toBe('sensitivity_flip_risk');
    expect(enrichmentOf(committed)[SELECTED_LENS_ENRICHMENT_KEY]).toBe('sensitivity_flip_risk');
    expect(readSelectedLensFromFact(committed[0])).toBe('sensitivity_flip_risk');
  });

  it('ARM Y: a prior flip-risk analysis → the producer selects pre_mortem, and the fact records THAT', () => {
    const prior = makeFact(A5_GOLDEN, 'gh_prior_turn_0001');
    const { observed, committed } = runProducer(makeFact(A5_GOLDEN), [prior]);
    expect(observed[0]).toBe('pre_mortem');
    expect(enrichmentOf(committed)[SELECTED_LENS_ENRICHMENT_KEY]).toBe('pre_mortem');
    expect(readSelectedLensFromFact(committed[0])).toBe('pre_mortem');
  });

  it('the two arms genuinely differ — the record tracks the selection, it is not a constant', () => {
    const armX = runProducer(makeFact(A5_GOLDEN), []);
    const armY = runProducer(makeFact(A5_GOLDEN), [makeFact(A5_GOLDEN, 'gh_prior_turn_0001')]);
    expect(enrichmentOf(armX.committed)[SELECTED_LENS_ENRICHMENT_KEY]).not.toBe(
      enrichmentOf(armY.committed)[SELECTED_LENS_ENRICHMENT_KEY],
    );
  });
});

// ============================================================================
// 2. THE OPPOSITE-DIRECTION TWIN — absence must be ABSENCE, never a default.
// ============================================================================

describe('selected-lens persistence — no lens selected records ABSENCE', () => {
  it('a healthy analysis selects nothing, so the key is ABSENT (not null, not a default lens)', () => {
    const { observed, committed } = runProducer(makeFact(HEALTHY), []);
    expect(observed[0]).toBeNull();
    const enrichment = enrichmentOf(committed);
    expect(SELECTED_LENS_ENRICHMENT_KEY in enrichment).toBe(false);
    expect(readSelectedLensFromFact(committed[0])).toBeNull();
  });

  it('absence does not silently imply a value — the committed enrichment is byte-identical to the input', () => {
    const current = makeFact(HEALTHY);
    const { committed } = runProducer(current, []);
    expect(committed).toStrictEqual([current]);
  });
});

// ============================================================================
// 3. The record survives a round trip as PERSISTED enrichment (what the
//    consuming resolver actually reads back off a prior fact).
// ============================================================================

describe('selected-lens persistence — read-back', () => {
  it('reads back off a fact that went through JSON, the way prior_facts arrive', () => {
    const { committed } = runProducer(makeFact(A5_GOLDEN), []);
    const roundTripped = JSON.parse(JSON.stringify(committed[0])) as HandlerFact;
    expect(readSelectedLensFromFact(roundTripped)).toBe('sensitivity_flip_risk');
  });

  it('a non-run_analysis fact is returned untouched and reads back null', () => {
    const edit = {
      fact_type: 'set_factor_value',
      fact_version: 1,
      noop: false,
      result: { scenario_id: 's', status: 'applied' },
    } as unknown as HandlerFact;
    expect(attachSelectedLensToRunAnalysisFact([edit], 'pre_mortem')).toStrictEqual([edit]);
    expect(readSelectedLensFromFact(edit)).toBeNull();
  });
});
