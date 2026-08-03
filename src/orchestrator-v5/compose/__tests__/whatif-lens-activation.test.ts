/**
 * ROADMAP 1.195 — the what-if counterfactual SUGGESTION is ACTIVATED.
 *
 * ── WHY THIS IS SAFE TO CLEAR, DERIVED AT THE BYTES ─────────────────────────
 * The three uncleared gate items (2 ISL model-fidelity probe · 3 owner-placement ·
 * 4 target-semantics) are all claims about the NUMBER an EXECUTED counterfactual
 * returns. This constant gates only whether the coach ever OFFERS the lens, and
 * the offer carries no number:
 *
 *   - the suggestion is a prose-only `coaching` block with `target_refs: []`
 *     (`phase3-blocks.ts` — `buildLensSurface`), whose copy is the fixed
 *     `TITLE_BY_LENS` / `BODY_BY_RATIONALE` pair (prose-guard-clean: no factor id,
 *     no cap, no baseline, no tipping point, no decimals);
 *   - its companion-block set is empty BY CONSTRUCTION —
 *     `buildLensCompanionBlocks` returns `[]` for `what_if_counterfactual`;
 *   - `evaluateWhatIfCounterfactual` is a pure read of the already-computed
 *     influence ranking. Clearing the gate issues no ISL call.
 *
 * The what-if EXECUTOR (explicit `what_would_flip`) is already live and ungated
 * on staging, so the capability the offer points at is one the user can already
 * reach; this constant only decided whether they were ever told about it.
 *
 * ── WHAT THIS SUITE PROVES ──────────────────────────────────────────────────
 * A default-value pin alone would be theatre (it reads the constant back). So
 * every arm below is paired with a BEHAVIOURAL witness driven through the LIVE
 * availability path — `liveLensExecutorAvailability()`, the single function all
 * three `selectLens` call sites are handed — and asserts the capability actually
 * FIRES: a real block, with the what-if lens's OWN identity.
 *
 *   1. the constant is cleared;
 *   2. the transport leg is still ANDed (fail-closed preserved — activation did
 *      not turn the gate into an unconditional `true`);
 *   3. THE WITNESS: with the transport up, a fact whose only candidate is what-if
 *      now yields a real coaching block, bound by IDENTITY to the what-if lens
 *      (telemetry `lens_id` + `rationale_code`, and the title compared against
 *      the copy constant itself — never a substring another lens could satisfy);
 *   4. transport down ⇒ still nothing (the ANDed leg, witnessed not asserted);
 *   5. NON-REGRESSION: activation cannot displace a core lens — what-if is last
 *      on the priority ladder, so a dominant-driver fact still gets sensitivity.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { setTestSink } from '../../../utils/telemetry.js';
import { _resetConfigCache } from '../../../config/index.js';
import {
  WHATIF_SUGGESTION_GATE_CLEARED,
  whatIfSuggestionExecutorAvailable,
  selectLens,
  TITLE_BY_LENS,
  BODY_BY_RATIONALE,
} from '../lens-selector.js';
import {
  buildLensSuggestionCoachingBlock,
  liveLensExecutorAvailability,
  type BlockBuildCtx,
} from '../phase3-blocks.js';

const GRAPH_HASH = 'gh_a1b2c3d4e5f60001';
const CTX: BlockBuildCtx = {
  created_at: '2026-08-03T15:00:00.000Z',
  graph_hash_at_generation: GRAPH_HASH,
};

interface SinkEvent {
  readonly event: string;
  readonly data: Record<string, unknown>;
}
let sink: SinkEvent[] = [];

beforeEach(() => {
  sink = [];
  setTestSink((event, data) => {
    sink.push({ event, data });
  });
});
afterEach(() => {
  setTestSink(null);
  vi.unstubAllEnvs();
  _resetConfigCache();
});

/** Item 1 of the gate: the ISL transport configured (`ISL_BASE_URL` set). */
function withIslTransport(): void {
  vi.stubEnv('ISL_BASE_URL', 'https://isl.example.invalid');
  _resetConfigCache();
}

/** Item 1 unmet: no transport. */
function withoutIslTransport(): void {
  vi.stubEnv('ISL_BASE_URL', '');
  _resetConfigCache();
}

/**
 * The ONLY fact shape whose sole eligible lens is what-if: a rank-1 driver
 * exists (so `evaluateWhatIfCounterfactual` fires) while no core lens triggers
 * (influence spread is flat, tier is strong, no flip-risk category, no EVPI).
 * This is the same `HEALTHY` shape the lens-selector suite uses for the
 * executor-availability probe — reused deliberately so the two suites cannot
 * drift about what "only what-if fires" means.
 */
function whatIfOnlyFact(): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-test',
      leading_option_id: 'opt_a',
      summary: 'Ran analysis.',
      graph_hash_at_run: GRAPH_HASH,
      enrichment: {
        confidence_tier: 'strong',
        factor_sensitivity: [
          { factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9 },
          { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
          { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
        ],
        option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
      },
    },
  } as unknown as RunAnalysisHandlerFact;
}

/** A fact that trips the sensitivity lens — used for the non-regression arm. */
function dominantDriverFact(): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-test',
      leading_option_id: 'opt_a',
      summary: 'Ran analysis.',
      graph_hash_at_run: GRAPH_HASH,
      enrichment: {
        confidence_tier: 'strong',
        factor_sensitivity: [
          { factor_id: 'fac_a', influence_score: 0.8, influence_rank: 1, confidence: 0.9 },
          { factor_id: 'fac_b', influence_score: 0.15, influence_rank: 2, confidence: 0.9 },
          { factor_id: 'fac_c', influence_score: 0.05, influence_rank: 3, confidence: 0.9 },
        ],
        option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
      },
    },
  } as unknown as RunAnalysisHandlerFact;
}

function suggestionEvents(): SinkEvent[] {
  return sink.filter((e) => e.event === 'v5.capability.lens_suggestion_emitted');
}

describe('ROADMAP 1.195 — the what-if suggestion gate is CLEARED', () => {
  it('the enable-gate constant is cleared (items 2/3/4 do not bear on a number-free offer)', () => {
    expect(WHATIF_SUGGESTION_GATE_CLEARED).toBe(true);
  });

  it('the ISL transport leg is STILL ANDed — activation did not make the gate unconditional', () => {
    // Item 1 met ⇒ available. Item 1 unmet ⇒ still false. If the activation had
    // replaced the helper with a bare `true`, the second assertion goes RED.
    expect(whatIfSuggestionExecutorAvailable(true)).toBe(true);
    expect(whatIfSuggestionExecutorAvailable(false)).toBe(false);
  });

  it('the LIVE availability path reports the what-if executor available when the transport is up', () => {
    withIslTransport();
    expect(liveLensExecutorAvailability()).toStrictEqual({
      executorAvailable: { what_if_counterfactual: true },
    });
  });
});

describe('ROADMAP 1.195 — the capability FIRES (behavioural witness, live path)', () => {
  it('emits a real what-if suggestion block, bound by lens IDENTITY', () => {
    withIslTransport();
    const block = buildLensSuggestionCoachingBlock(whatIfOnlyFact(), CTX, null);

    // 1. A block exists at all — before activation this was `null`.
    expect(block).not.toBeNull();

    // 2. IDENTITY, not a value predicate: the telemetry event names the lens and
    //    its rationale code. No other lens can satisfy this pair.
    const events = suggestionEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.data.lens_id).toBe('what_if_counterfactual');
    expect(events[0]!.data.rationale_code).toBe('WHATIF_EXPLORE_DRIVER');

    // 3. The rendered copy is the what-if lens's OWN copy — compared against the
    //    exported constants, so a copy edit moves both sides together and this
    //    can never pass on another lens's card.
    expect(block!.title).toBe(TITLE_BY_LENS.what_if_counterfactual);
    expect(block!.body).toBe(BODY_BY_RATIONALE.WHATIF_EXPLORE_DRIVER);

    // 4. The offer is still number-free: no target refs, no on-card action.
    expect(block!.target_refs).toStrictEqual([]);
    expect(block!.action_intent).toBeUndefined();
    expect(block!.action_label).toBeUndefined();
  });

  it('stays dark when the ISL transport is absent — the ANDed leg, witnessed', () => {
    withoutIslTransport();
    expect(liveLensExecutorAvailability()).toStrictEqual({
      executorAvailable: { what_if_counterfactual: false },
    });
    expect(buildLensSuggestionCoachingBlock(whatIfOnlyFact(), CTX, null)).toBeNull();
    expect(suggestionEvents()).toHaveLength(0);
  });

  it('NON-REGRESSION: activation never displaces a core lens (what-if is last on the ladder)', () => {
    withIslTransport();
    const fact = dominantDriverFact();
    // Through the live availability path, with the transport up.
    const selection = selectLens(fact, liveLensExecutorAvailability());
    expect(selection?.lens).toBe('sensitivity_flip_risk');
    expect(selection?.rationaleCode).toBe('DOMINANT_DRIVER');

    // And end-to-end through the block builder: the emitted card is the core
    // lens's, identified by its telemetry pair.
    const block = buildLensSuggestionCoachingBlock(fact, CTX, null);
    expect(block).not.toBeNull();
    const events = suggestionEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.data.lens_id).toBe('sensitivity_flip_risk');
  });
});
