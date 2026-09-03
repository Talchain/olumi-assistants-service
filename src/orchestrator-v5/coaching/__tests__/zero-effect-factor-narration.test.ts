/**
 * THE 2026-09-03 P0 — a user's edit was structurally incapable of changing
 * anything, and the product invented a causal story for it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐⭐ EVERY NUMBER, ID AND LABEL BELOW IS READ OFF THE REAL CAPTURE:
 * `Talchain/olumi-programme-docs`
 * `artefacts/manual-test-2026-09-03/olumi-debug-f2e2df1b-20260903.json`
 * (UI build `86786efb`, CEE `f4c8f50`). Nothing here is a fixture the author
 * imagined — CLAUDE.md trap 22: a corpus drawn from the author's head cannot
 * see the class the author did not imagine, and this defect class had already
 * evaded a suite of 27,000 green tests.
 *
 * What the capture holds, and what the product said about it:
 *   - factor `919d7f50` "Sales Headcount Investment", corrected £80 -> £100,000
 *   - all three options set their own value for it: `05f973ef` 0.9,
 *     `15f7737d` 0.4, `94b13741` 0
 *   - the analysis scored it `sensitivity_score: 0`, `elasticity: 0`,
 *     `value_of_information: 0`, `zero_reason: "intervention_override"`,
 *     `influence_rank: 6 of 6`
 *   - win probabilities at n = 10,000: `94b13741` 0.6262, `05f973ef` 0.3705,
 *     `15f7737d` 0.0033
 *
 *   turn 12: "Updated Sales Headcount Investment from £80 to £100,000. ... This
 *            makes the last analysis stale. Re-run analysis to see how this
 *            affects the results."
 *   turn 13: "Since you changed a factor, Continue With Founder-Led Sales still
 *            leads after this re-run, and its lead has widened by about 1
 *            percentage point."
 *   turn 14: "... widened ... because the higher investment value increases the
 *            modelled Runway Depletion Risk more strongly"
 *   turn 15: "These two runs were not set up identically enough to attribute
 *            the change purely to your ... edit."
 *
 * ═══ WHAT THIS CORPUS DELIBERATELY EXCLUDES (trap 13d(c) — check what a corpus
 * OMITS, not only what it covers) ═══
 *
 *   - **The model-authored turns (14 and 15).** They are not composed by any
 *     module this suite can drive; they are `edit_graph` / `routing` prompt
 *     outputs. What is testable, and IS tested, is that the deterministic
 *     sentence turn 14 quoted and elaborated is no longer emitted. Closing the
 *     model paths needs an egress rail at `route-v2.ts`'s single
 *     `sendFinalised200`, which is outside this lane's file ownership.
 *   - **A margin NOISE BAND.** `licenceToReportMovementDirection` is a
 *     NECESSARY condition on the two options the margin is composed of, not a
 *     band on their difference; the covariance term is not implemented and is
 *     not faked here. Asserting a margin-band property would be asserting a
 *     computation that does not exist.
 *   - **`adjust_edge_strength` / `add_constraint` inertness.** Neither has an
 *     option-replaceable baseline, so the question does not arise for them —
 *     asserted directly below rather than left as an assumption.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { findForbiddenPhraseHit } from '../../compose/forbidden-user-facing-phrases.js';
import { baselineOverrideReach } from '../../context/baseline-override-reach.js';
import { tryRunComparisonGate } from '../../routing/run-comparison-gate.js';
import { detectCoachingSignal, INERT_EDIT_TAIL } from '../../signals/coaching-signals.js';
import type { SuccessfulHandlerOutcome } from '../../tools/handler-outcome.js';
import { createSetFactorValueHandler } from '../../tools/handlers/set-factor-value.js';
import {
  BASELINE_REPLACED_BY_OPTIONS_NARRATIVE,
  STALENESS_NARRATIVE,
} from '../../tools/handlers/set-factor-value.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import type { ProposalAction } from '../../routing/types.js';

import { deriveEditComparisonReach } from '../edit-comparison-reach.js';
import { licenceToReportMovementDirection } from '../movement-direction-licence.js';
import { collectZeroEffectFactors, zeroEffectReasonFor } from '../zero-effect-factors.js';

// ─────────────────────────────────────────────────────────────────────────────
// The capture, transcribed.
// ─────────────────────────────────────────────────────────────────────────────

/** "Sales Headcount Investment" — the factor the user corrected. */
const EDITED_FACTOR = '919d7f50';
/** "ICP Clarity" — influence rank 1, no option intervenes on it. The CONTRAST. */
const LIVE_FACTOR = '16ec3d64';

const OPT_HIRE = '05f973ef';
const OPT_SDR = '15f7737d';
const OPT_FOUNDER = '94b13741';

/** The capture's Monte-Carlo budget, identical on every option. */
const N = 10_000;

/**
 * `enrichment.factor_sensitivity[]`, transcribed from
 * `payloads/cee_response/blocks[0]/enrichment`. Trimmed to the three entries
 * this suite discriminates on; the scores are the capture's own.
 */
const FACTOR_SENSITIVITY = [
  {
    factor_id: LIVE_FACTOR,
    factor_label: 'ICP Clarity',
    influence_score: 1,
    influence_rank: 1,
    sensitivity_score: -0.375,
    elasticity: 1,
    value_of_information: 0,
  },
  {
    factor_id: '27c23ebb',
    factor_label: 'hiring would free this up for product',
    influence_rank: 4,
    sensitivity_score: 0,
    elasticity: 0,
    value_of_information: 0,
    zero_reason: 'intervention_override',
  },
  {
    factor_id: EDITED_FACTOR,
    factor_label: 'Sales Headcount Investment',
    influence_rank: 6,
    sensitivity_score: 0,
    elasticity: 0,
    value_of_information: 0,
    zero_reason: 'intervention_override',
  },
];

/**
 * The PLoT envelope shape CEE actually persisted on 2026-09-03.
 *
 * ⚠ `meta` AND `_meta` ARE `null` HERE BECAUSE THEY WERE NULL ON THE WIRE.
 * That is measured, not stylised, and it is why `buildRunDelta` refuses the
 * whole `run_delta` block with `echoes_incomplete` on the live path while the
 * prose path — which has no echo requirement — spoke anyway. The per-option
 * `outcome.n_samples` was present throughout.
 */
function captureEnvelope(wins: {
  founder: number;
  hire: number;
  sdr: number;
}): Record<string, unknown> {
  return {
    analysis_status: 'completed',
    meta: null,
    _meta: null,
    factor_sensitivity: FACTOR_SENSITIVITY,
    option_comparison: [
      {
        option_id: OPT_HIRE,
        option_label: 'Hire a Dedicated Sales Team',
        win_probability: wins.hire,
        outcome: { n_samples: N },
      },
      {
        option_id: OPT_SDR,
        option_label: 'hiring a part-time SDR',
        win_probability: wins.sdr,
        outcome: { n_samples: N },
      },
      {
        option_id: OPT_FOUNDER,
        option_label: 'Continue With Founder-Led Sales',
        win_probability: wins.founder,
        outcome: { n_samples: N },
      },
    ],
  };
}

/** The run BEFORE the edit — the product reported 62% for founder-led. */
const PRIOR_ENVELOPE = captureEnvelope({ founder: 0.6162, hire: 0.3805, sdr: 0.0033 });
/** The run AFTER the edit — the product reported 63% and "widened by about 1 pp". */
const CURRENT_ENVELOPE = captureEnvelope({ founder: 0.6262, hire: 0.3705, sdr: 0.0033 });

/** The capture's graph: three options, every one of them overriding `919d7f50`. */
function captureGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g-mrr', kind: 'goal', label: 'Reach £30k MRR Within 18 Months' },
      {
        id: EDITED_FACTOR,
        kind: 'factor',
        label: 'Sales Headcount Investment',
        observed_state: { value: 0.615, raw_value: 80_000, unit: '£', cap: 130_000 },
      },
      {
        id: LIVE_FACTOR,
        kind: 'factor',
        label: 'ICP Clarity',
        observed_state: { value: 0.5 },
      },
      {
        id: OPT_HIRE,
        kind: 'option',
        label: 'Hire a Dedicated Sales Team',
        interventions: { '27c23ebb': 0.8, [EDITED_FACTOR]: 0.9 },
      },
      {
        id: OPT_SDR,
        kind: 'option',
        label: 'hiring a part-time SDR',
        interventions: { '27c23ebb': 0.5, [EDITED_FACTOR]: 0.4 },
      },
      {
        id: OPT_FOUNDER,
        kind: 'option',
        label: 'Continue With Founder-Led Sales',
        interventions: { '27c23ebb': 0.2, [EDITED_FACTOR]: 0 },
      },
    ],
    edges: [
      {
        from: EDITED_FACTOR,
        to: 'g-mrr',
        strength: { mean: 0.4, std: 0.1 },
        exists_probability: 0.8,
        effect_direction: 'positive',
      },
      {
        from: LIVE_FACTOR,
        to: 'g-mrr',
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 0.8,
        effect_direction: 'positive',
      },
    ],
  } as unknown as GraphV3T;
}

function runFact(
  enrichment: Record<string, unknown>,
  computedAt = '2026-09-03T00:00:00.000Z',
): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-capture',
      leading_option_id: OPT_FOUNDER,
      summary: 'Ran analysis',
      enrichment,
      graph_hash_at_run: `hash-${computedAt}`,
      computed_at: computedAt,
      constraint_verdict: { may_name_leading_option: true },
    },
  } as unknown as HandlerFact;
}

function factorEditFact(targetId: string): HandlerFact {
  return {
    fact_type: 'set_factor_value',
    fact_version: 1,
    noop: false,
    result: {
      target_id: targetId,
      status: 'applied',
      before: { value: 0.0006, raw_value: 80, unit: '£', cap: 100, label: 'Sales Headcount Investment' },
      after: { value: 0.769, raw_value: 100_000, unit: '£', cap: 130_000, label: 'Sales Headcount Investment' },
    },
  } as unknown as HandlerFact;
}

/** The capture's actual edit fact, which carried NO label on either side. */
function labellessEditFact(targetId: string): HandlerFact {
  return {
    fact_type: 'set_factor_value',
    fact_version: 1,
    noop: false,
    result: {
      target_id: targetId,
      status: 'applied',
      before: { value: 0.0006, raw_value: 80, unit: '£' },
      after: { value: 0.769, raw_value: 100_000, unit: '£' },
    },
  } as unknown as HandlerFact;
}

function editOutcome(fact: HandlerFact): SuccessfulHandlerOutcome {
  return { assistant_text: 'Updated.', llm_calls_used: 0, handler_facts: [fact] };
}

function rerunOutcome(enrichment: Record<string, unknown>): SuccessfulHandlerOutcome {
  return {
    assistant_text: 'Ran.',
    llm_calls_used: 0,
    handler_facts: [runFact(enrichment, '2026-09-03T01:00:00.000Z')],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. The refutation was in the payload. Read it.
// ─────────────────────────────────────────────────────────────────────────────

describe('the analysis scored the edited factor at zero, and said why', () => {
  it('indexes the two intervention_override factors and NOT the live one (contrast control)', () => {
    const index = collectZeroEffectFactors(CURRENT_ENVELOPE);

    expect(zeroEffectReasonFor(index, EDITED_FACTOR)).toBe('intervention_override');
    expect(zeroEffectReasonFor(index, '27c23ebb')).toBe('intervention_override');
    // THE CONTRAST. ICP Clarity is influence rank 1 with a non-zero
    // sensitivity: an index that returned a reason for it would be reporting
    // on itself, not on the analysis (trap 13e — a probe needs a same-family
    // symbol it expects ABSENT as well as one it expects present).
    expect(zeroEffectReasonFor(index, LIVE_FACTOR)).toBeNull();
  });

  it('a producer zero reason this repo does not enumerate is still a zero', () => {
    // A hand-listed enum of PLoT's vocabulary here would be a mirror of a list
    // this repo does not own. A NEW reason must not read as "the factor is
    // live" (trap 12, in its silent direction).
    const index = collectZeroEffectFactors({
      factor_sensitivity: [
        { factor_id: 'f-new', sensitivity_score: 0.4, zero_reason: 'below_resolution' },
      ],
    });
    expect(zeroEffectReasonFor(index, 'f-new')).toBe('producer_declared_zero');
  });

  it('a thin or absent envelope indexes nothing rather than throwing', () => {
    expect(collectZeroEffectFactors(null).byId.size).toBe(0);
    expect(collectZeroEffectFactors({}).byId.size).toBe(0);
    expect(collectZeroEffectFactors({ factor_sensitivity: 'nope' }).byId.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. EVERY option overrides it — and SOME is a different question.
// ─────────────────────────────────────────────────────────────────────────────

describe('baselineOverrideReach: EVERY option, not SOME', () => {
  it('the edited factor is replaced by all three options', () => {
    expect(baselineOverrideReach(captureGraph(), EDITED_FACTOR)).toEqual({
      kind: 'replaced_by_every_option',
      optionCount: 3,
    });
  });

  it('DISCRIMINATING PAIR: a factor NO option overrides reaches the comparison', () => {
    expect(baselineOverrideReach(captureGraph(), LIVE_FACTOR)).toEqual({
      kind: 'reaches_comparison',
    });
  });

  it('DISCRIMINATING PAIR: a factor only SOME options override reaches the comparison', () => {
    // The single most important negative in this file. `SOME` is what
    // `intervention-controlled-drivers.ts` answers, and a module that
    // confused the two would report an edit as inert while one option still
    // consumes the baseline — a fabrication in the opposite direction.
    const graph = captureGraph() as unknown as { nodes: Array<Record<string, unknown>> };
    const founder = graph.nodes.find((n) => n.id === OPT_FOUNDER)!;
    founder.interventions = { '27c23ebb': 0.2 };
    expect(baselineOverrideReach(graph, EDITED_FACTOR)).toEqual({
      kind: 'reaches_comparison',
    });
  });

  it('reads the pre-normalisation and slash-keyed intervention shapes too', () => {
    const graph = {
      nodes: [
        { id: 'o1', kind: 'option', data: { interventions: { f: 1 } } },
        { id: 'o2', type: 'option', 'data/interventions/f': 0.5 },
      ],
    };
    expect(baselineOverrideReach(graph, 'f')).toEqual({
      kind: 'replaced_by_every_option',
      optionCount: 2,
    });
  });

  it('counts an option described in BOTH nodes[] and options[] exactly once', () => {
    const graph = {
      nodes: [
        { id: 'o1', kind: 'option', interventions: { f: 1 } },
        { id: 'o2', kind: 'option', interventions: {} },
      ],
      options: [{ id: 'o1', interventions: { f: 1 } }],
    };
    // o2 does not override `f`, so the answer must be `reaches_comparison`.
    // A double-counted o1 would not change that here, but the option COUNT is
    // asserted in the positive case above and would be wrong if it did.
    expect(baselineOverrideReach(graph, 'f')).toEqual({ kind: 'reaches_comparison' });
  });

  it('FAILS CLOSED on every degenerate shape — never claims inertness', () => {
    expect(baselineOverrideReach(null, 'f').kind).toBe('unknown');
    expect(baselineOverrideReach({}, 'f').kind).toBe('unknown');
    // One option is not a comparison; "every option overrides it" would be
    // vacuously true and would licence a sentence about a comparison that does
    // not exist.
    expect(
      baselineOverrideReach({ nodes: [{ id: 'o1', kind: 'option', interventions: { f: 1 } }] }, 'f')
        .kind,
    ).toBe('unknown');
    // An option with no resolvable id cannot be counted, so nothing is claimed.
    //
    // ⚠ THE FIXTURE IS BUILT SO THIS CANNOT PASS FOR THE WRONG REASON. An
    // earlier version had ONE id'd option plus one anonymous one; dropping the
    // fail-closed rule still answered 'unknown' there, via the two-option
    // floor. It read green while testing nothing (CLAUDE.md trap 13b — ask
    // what would have to be true for this guard to pass while the property
    // fails, then write THAT case). Here two id'd options DO override and the
    // anonymous one does NOT, so ignoring it yields
    // `replaced_by_every_option` — a live mutant, caught.
    expect(
      baselineOverrideReach(
        {
          nodes: [
            { id: 'o1', kind: 'option', interventions: { f: 1 } },
            { id: 'o2', kind: 'option', interventions: { f: 0.5 } },
            { kind: 'option', interventions: { other: 1 } },
          ],
        },
        'f',
      ).kind,
    ).toBe('unknown');
    expect(baselineOverrideReach(captureGraph(), '').kind).toBe('unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Two witnesses, and a measured zero is NOT one of them.
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveEditComparisonReach: the union of two structural witnesses', () => {
  it('fires on the graph alone, with no analysis at all', () => {
    expect(
      deriveEditComparisonReach({
        graph: captureGraph(),
        priorAnalysisEnrichment: null,
        factorId: EDITED_FACTOR,
      }),
    ).toEqual({ kind: 'inert', basis: 'every_option_overrides' });
  });

  it('fires on the producer alone, with no graph at all', () => {
    expect(
      deriveEditComparisonReach({
        graph: null,
        priorAnalysisEnrichment: CURRENT_ENVELOPE,
        factorId: EDITED_FACTOR,
      }),
    ).toEqual({ kind: 'inert', basis: 'producer_intervention_override' });
  });

  it('records that BOTH witnesses fired when both did', () => {
    expect(
      deriveEditComparisonReach({
        graph: captureGraph(),
        priorAnalysisEnrichment: CURRENT_ENVELOPE,
        factorId: EDITED_FACTOR,
      }),
    ).toEqual({ kind: 'inert', basis: 'both' });
  });

  it('⭐ A MEASURED ZERO IS NOT A STRUCTURAL ONE and must never read as inert', () => {
    // `sensitivity_score: 0` is a LOCAL derivative at the OLD value. A
    // non-linear factor can be flat there and steep at the new one, so
    // "changing this will not move the comparison" would be a fabrication in
    // the opposite direction to the one this PR closes.
    const flatButLive = {
      factor_sensitivity: [{ factor_id: 'f-flat', sensitivity_score: 0 }],
    };
    expect(zeroEffectReasonFor(collectZeroEffectFactors(flatButLive), 'f-flat')).toBe(
      'zero_sensitivity',
    );
    expect(
      deriveEditComparisonReach({
        graph: null,
        priorAnalysisEnrichment: flatButLive,
        factorId: 'f-flat',
      }),
    ).toEqual({ kind: 'unknown' });
  });

  it('the graph is the only authority that can return `reaches`', () => {
    // The ABSENCE of a zero_reason is not a statement that a factor is live —
    // the entry may be missing, the analysis stale, the envelope thin.
    expect(
      deriveEditComparisonReach({
        graph: null,
        priorAnalysisEnrichment: CURRENT_ENVELOPE,
        factorId: LIVE_FACTOR,
      }),
    ).toEqual({ kind: 'unknown' });
    expect(
      deriveEditComparisonReach({
        graph: captureGraph(),
        priorAnalysisEnrichment: CURRENT_ENVELOPE,
        factorId: LIVE_FACTOR,
      }),
    ).toEqual({ kind: 'reaches' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. ASK 4 — the ~1pp movement was inside the noise, at the capture's own n.
// ─────────────────────────────────────────────────────────────────────────────

describe('licenceToReportMovementDirection', () => {
  it('⭐ THE CAPTURE: the reported "widened by about 1 percentage point" is WITHIN NOISE', () => {
    // 0.6162 -> 0.6262 at n = 10,000 on each side. 2 SE of the difference of
    // two independent binomial proportions is 0.0137, i.e. 1.37pp. The
    // movement is 1.00pp. The product reported a direction anyway.
    expect(
      licenceToReportMovementDirection({
        priorEnrichment: PRIOR_ENVELOPE,
        currentEnrichment: CURRENT_ENVELOPE,
      }),
    ).toEqual({ kind: 'within_noise' });
  });

  it('POSITIVE CONTROL: a movement that really is outside the band IS licensed', () => {
    // Without this the suite cannot tell "the gate works" from "the gate
    // always says no" (trap 13 — an absence probe needs to prove it can see a
    // presence; trap 20 — a probe that returns one answer for every input is
    // reporting on itself).
    expect(
      licenceToReportMovementDirection({
        priorEnrichment: PRIOR_ENVELOPE,
        currentEnrichment: captureEnvelope({ founder: 0.72, hire: 0.2767, sdr: 0.0033 }),
      }),
    ).toEqual({ kind: 'licensed' });
  });

  it('⭐ MIXED VERDICTS ARE THEIR OWN STATE, NOT "within noise"', () => {
    // The leader moves hugely; the runner-up does not. Folding this into
    // `within_noise` would make the consumer say "the figures moved by less
    // than this model varies between runs" about a figure that plainly moved
    // by MORE — a false statement out of a guard written to prevent false
    // statements. One predicate cannot carry two harms (trap 22b).
    expect(
      licenceToReportMovementDirection({
        priorEnrichment: captureEnvelope({ founder: 0.55, hire: 0.3805, sdr: 0.0695 }),
        currentEnrichment: captureEnvelope({ founder: 0.72, hire: 0.3805, sdr: 0.0 }),
      }),
    ).toEqual({ kind: 'indeterminate', reason: 'mixed_verdicts' });
  });

  it('no per-option sample size ⇒ INDETERMINATE, never "within noise"', () => {
    const noSamples = {
      analysis_status: 'completed',
      option_comparison: [
        { option_id: OPT_FOUNDER, win_probability: 0.6262 },
        { option_id: OPT_HIRE, win_probability: 0.3705 },
      ],
    };
    expect(
      licenceToReportMovementDirection({
        priorEnrichment: noSamples,
        currentEnrichment: noSamples,
      }),
    ).toEqual({ kind: 'indeterminate', reason: 'sample_size_unavailable' });
  });

  it('fewer than two identity-bound options on either side ⇒ INDETERMINATE', () => {
    expect(
      licenceToReportMovementDirection({
        priorEnrichment: PRIOR_ENVELOPE,
        currentEnrichment: { option_comparison: [{ option_id: 'z', win_probability: 1 }] },
      }),
    ).toEqual({ kind: 'indeterminate', reason: 'no_identity_bound_pair' });
    // A margin constituent absent from the EARLIER run has no movement to
    // bound; treating its absence as a movement from zero would fabricate one.
    expect(
      licenceToReportMovementDirection({
        priorEnrichment: { option_comparison: [{ option_id: 'z', win_probability: 1 }] },
        currentEnrichment: CURRENT_ENVELOPE,
      }),
    ).toEqual({ kind: 'indeterminate', reason: 'no_identity_bound_pair' });
  });

  it('a sample too small for the normal approximation ⇒ INDETERMINATE, not a band', () => {
    const tiny = (founder: number): Record<string, unknown> => ({
      option_comparison: [
        { option_id: OPT_FOUNDER, win_probability: founder, outcome: { n_samples: 6 } },
        { option_id: OPT_HIRE, win_probability: 1 - founder, outcome: { n_samples: 6 } },
      ],
    });
    expect(
      licenceToReportMovementDirection({
        priorEnrichment: tiny(0.5),
        currentEnrichment: tiny(0.95),
      }),
    ).toEqual({ kind: 'indeterminate', reason: 'not_noise_qualified' });
  });

  it('a duplicated option id drops that option rather than guessing', () => {
    const duped = {
      option_comparison: [
        { option_id: OPT_FOUNDER, win_probability: 0.62, outcome: { n_samples: N } },
        { option_id: OPT_FOUNDER, win_probability: 0.10, outcome: { n_samples: N } },
        { option_id: OPT_HIRE, win_probability: 0.38, outcome: { n_samples: N } },
      ],
    };
    expect(
      licenceToReportMovementDirection({
        priorEnrichment: duped,
        currentEnrichment: duped,
      }),
    ).toEqual({ kind: 'indeterminate', reason: 'no_identity_bound_pair' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. ASKS 2 + 3 — the edit-time receipt.
// ─────────────────────────────────────────────────────────────────────────────

function buildInvocation(
  graph: GraphV3T,
  proposal: ProposalAction,
  priorFacts: readonly HandlerFact[],
): HandlerInvocation {
  return {
    context: {
      session_id: 'scen-capture',
      stage: 'frame',
      request_id: 'req-1',
      prior_turns: [],
      prior_facts: priorFacts,
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message',
      scenario_id: 'scen-capture',
      turn_id: 'turn-1',
      stage: 'frame',
      message: 'set sales headcount investment to £100,000',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-1',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
  };
}

function setValueProposal(entityId: string, value: unknown): ProposalAction {
  return {
    handler_id: 'set_factor_value',
    entity: {
      id: entityId,
      kind: 'node',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [{ name: 'value', value, operator: 'set', source: 'user_explicit' }],
    cited_context_fields: [],
  } as unknown as ProposalAction;
}

describe('set_factor_value receipt', () => {
  it('⭐ THE CAPTURE: says the value is a baseline every option replaces, and does NOT promise a re-run', async () => {
    const handler = createSetFactorValueHandler();
    const outcome = await handler(
      buildInvocation(
        captureGraph(),
        setValueProposal(EDITED_FACTOR, { value: 100_000, unit: '£', cap: 130_000 }),
        [runFact(PRIOR_ENVELOPE)],
      ),
    );

    expect(outcome.assistant_text).toContain(BASELINE_REPLACED_BY_OPTIONS_NARRATIVE.trim());
    // The sentence the product actually shipped, and the promise the re-run
    // could not keep.
    expect(outcome.assistant_text).not.toContain('makes the last analysis stale');
    expect(outcome.assistant_text).not.toContain('Re-run analysis to see how this affects');
    // The receipt itself is untouched: the edit DID happen and is confirmed.
    expect(outcome.assistant_text).toContain('Sales Headcount Investment');
  });

  it('DISCRIMINATING PAIR: a factor no option overrides still gets the staleness narrative', async () => {
    const handler = createSetFactorValueHandler();
    const outcome = await handler(
      buildInvocation(captureGraph(), setValueProposal(LIVE_FACTOR, 0.8), [
        runFact(PRIOR_ENVELOPE),
      ]),
    );
    expect(outcome.assistant_text).toContain(STALENESS_NARRATIVE.trim());
    expect(outcome.assistant_text).not.toContain(
      BASELINE_REPLACED_BY_OPTIONS_NARRATIVE.trim(),
    );
  });

  it('the baseline coaching does NOT wait for a prior analysis to exist', async () => {
    // It is a fact about the MODEL, true before any analysis has run, and it
    // is exactly the moment a user building the model needs to hear it.
    const handler = createSetFactorValueHandler();
    const outcome = await handler(
      buildInvocation(
        captureGraph(),
        setValueProposal(EDITED_FACTOR, { value: 100_000, unit: '£', cap: 130_000 }),
        [],
      ),
    );
    expect(outcome.assistant_text).toContain(BASELINE_REPLACED_BY_OPTIONS_NARRATIVE.trim());
  });

  it('the new copy passes the shared user-facing phrase guard', () => {
    // Asserted rather than reviewed: this file's siblings probe their
    // substituted constants at module load for exactly this reason.
    expect(findForbiddenPhraseHit(BASELINE_REPLACED_BY_OPTIONS_NARRATIVE)).toBeNull();
    expect(BASELINE_REPLACED_BY_OPTIONS_NARRATIVE).not.toMatch(/—/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. ASK 3 — the coaching signal must not repeat the false staleness claim.
// ─────────────────────────────────────────────────────────────────────────────

function editSignal(targetId: string, priorFacts: readonly HandlerFact[]) {
  return detectCoachingSignal({
    proposedHandlerId: 'set_factor_value',
    outcome: editOutcome(factorEditFact(targetId)),
    contextPack: null,
    priorFacts,
    mayNameLeadingOption: true,
  });
}

describe('STALE_ANALYSIS_AFTER_EDIT', () => {
  it('⭐ does not fire for a factor the producer scored intervention_override', () => {
    expect(editSignal(EDITED_FACTOR, [runFact(CURRENT_ENVELOPE)])).toBeNull();
  });

  it('DISCRIMINATING PAIR: still fires for a factor the analysis scored live', () => {
    const detection = editSignal(LIVE_FACTOR, [runFact(CURRENT_ENVELOPE)]);
    expect(detection?.signal_id).toBe('STALE_ANALYSIS_AFTER_EDIT');
    expect(detection?.coaching_text).toContain('This change affects the model');
  });

  it('KNOWN GAP, PINNED: with no graph on this path a factor missing from '
    + 'factor_sensitivity[] still gets the staleness claim', () => {
    // The graph is not threaded into `applyCoachingSignal`, so only the
    // PRODUCER witness can fire here. A factor absent from the envelope is not
    // caught. Recorded as an explicit expectation rather than left invisible:
    // a gap the suite can see is honest, a gap it cannot is how the original
    // defect shipped. This test must be INVERTED, not deleted, when a graph is
    // threaded through `turn-executor.ts` / `chip-click-dispatch.ts`.
    const thin = { analysis_status: 'completed', factor_sensitivity: [] };
    expect(editSignal(EDITED_FACTOR, [runFact(thin)])?.signal_id).toBe(
      'STALE_ANALYSIS_AFTER_EDIT',
    );
  });

  it('an edge or constraint edit is never reported as inert', () => {
    // Neither has an option-replaceable baseline, so the question does not
    // arise — asserted rather than assumed.
    const edgeFact = {
      fact_type: 'adjust_edge_strength',
      fact_version: 1,
      noop: false,
      result: { target_id: `${EDITED_FACTOR}->g-mrr`, status: 'applied', before: {}, after: {} },
    } as unknown as HandlerFact;
    const detection = detectCoachingSignal({
      proposedHandlerId: 'adjust_edge_strength',
      outcome: editOutcome(edgeFact),
      contextPack: null,
      priorFacts: [runFact(CURRENT_ENVELOPE)],
      mayNameLeadingOption: true,
    });
    expect(detection?.signal_id).toBe('STALE_ANALYSIS_AFTER_EDIT');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. ASKS 1 + 4 — the re-run sentence.
// ─────────────────────────────────────────────────────────────────────────────

function rerunText(priorFacts: readonly HandlerFact[], current: Record<string, unknown>): string {
  const detection = detectCoachingSignal({
    proposedHandlerId: 'run_analysis',
    outcome: rerunOutcome(current),
    contextPack: null,
    priorFacts,
    mayNameLeadingOption: true,
  });
  expect(detection?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
  return detection!.coaching_text;
}

describe('the re-run sentence after an inert edit', () => {
  const facts = () => [labellessEditFact(EDITED_FACTOR), runFact(PRIOR_ENVELOPE)];

  it('⭐ THE CAPTURE, END TO END: no direction, no attribution, and the reason why', () => {
    const text = rerunText(facts(), CURRENT_ENVELOPE);

    // (a) ASK 4 — the sub-noise direction is gone.
    expect(text).not.toContain('widened');
    expect(text).not.toContain('narrowed');
    expect(text).not.toContain('percentage point');
    // (b) ASK 1 — the attribution clause the model turned into a cause is gone.
    //     The capture's edit fact carried no label, so the shipped clause read
    //     literally "Since you changed a factor".
    expect(text).not.toContain('Since you changed');
    expect(text).not.toContain('Since your recent changes');
    // (c) the user still learns the result AND why their edit did nothing.
    expect(text).toContain('Continue With Founder-Led Sales still leads');
    // ⚠ ASSERTED AGAINST THE PRODUCTION CONSTANT, NOT A PARAPHRASE. A
    // paraphrase pins the sentence the test author wrote, which is the one
    // sentence that never changes (the note on `COACHING_TEXT`'s own export).
    expect(text).toContain(INERT_EDIT_TAIL.trim());
    expect(findForbiddenPhraseHit(text)).toBeNull();
  });

  it('DISCRIMINATING PAIR: an edit to a LIVE factor keeps its temporal attribution', () => {
    // Proves the suppression is bound to the inert factor and not to the
    // presence of any edit at all (trap 19 — bind by identity, and prove the
    // binding with a pair that must NOT fire).
    const text = rerunText(
      [factorEditFact(LIVE_FACTOR), runFact(PRIOR_ENVELOPE)],
      CURRENT_ENVELOPE,
    );
    expect(text).toContain('Since you changed');
    expect(text).not.toContain(INERT_EDIT_TAIL.trim());
  });

  it('the sub-noise movement is reported as a finding, not silence', () => {
    const text = rerunText([runFact(PRIOR_ENVELOPE)], CURRENT_ENVELOPE);
    expect(text).toContain('less than this model varies between runs');
    expect(text).not.toContain('widened');
  });

  it('an INDETERMINATE pair says it cannot tell, and never borrows the noise wording', () => {
    // Claiming "less than the model varies" without a band would assert a
    // bound we did not compute.
    const noSamples = (founder: number): Record<string, unknown> => ({
      analysis_status: 'completed',
      factor_sensitivity: FACTOR_SENSITIVITY,
      option_comparison: [
        { option_id: OPT_FOUNDER, option_label: 'Continue With Founder-Led Sales', win_probability: founder },
        { option_id: OPT_HIRE, option_label: 'Hire a Dedicated Sales Team', win_probability: 1 - founder },
      ],
    });
    const text = rerunText([runFact(noSamples(0.55))], noSamples(0.62));
    expect(text).toContain('cannot tell whether the movement');
    expect(text).not.toContain('less than this model varies');
    expect(text).not.toContain('widened');
  });

  it('⭐ A MIXED PAIR NEVER BORROWS THE NOISE WORDING', () => {
    // One constituent cleared the band, the other did not. Saying "the figures
    // moved by less than this model varies between runs" here would be false
    // of the one that moved.
    const text = rerunText(
      [runFact(captureEnvelope({ founder: 0.55, hire: 0.3805, sdr: 0.0695 }))],
      captureEnvelope({ founder: 0.72, hire: 0.3805, sdr: 0.0 }),
    );
    expect(text).toContain('cannot tell whether the movement');
    expect(text).not.toContain('less than this model varies');
    expect(text).not.toContain('widened');
  });

  it('POSITIVE CONTROL: a licensed movement still reports its direction and magnitude', () => {
    const text = rerunText(
      [runFact(PRIOR_ENVELOPE)],
      captureEnvelope({ founder: 0.72, hire: 0.2767, sdr: 0.0033 }),
    );
    expect(text).toContain('has widened by about');
    expect(text).toContain('percentage points');
  });

  it('an inert edit suppresses attribution on the LEADER-CHANGED arm too', () => {
    // "Since you changed X, the result has changed" is the strongest causal
    // reading in the composer, and it is exactly the sentence a factor every
    // option overrides cannot support.
    const leaderFlipped = captureEnvelope({ founder: 0.30, hire: 0.6962, sdr: 0.0038 });
    const text = rerunText([labellessEditFact(EDITED_FACTOR), runFact(PRIOR_ENVELOPE)], leaderFlipped);
    expect(text).not.toContain('Since you changed');
    expect(text).toContain('This re-run changed the outcome');
    expect(text).toContain(INERT_EDIT_TAIL.trim());
  });

  it('the inert tail never rides an ABSTENTION, which made no comparison at all', () => {
    // "It could not move this comparison" after "I have not compared the two"
    // would assert a comparison in the act of denying one.
    const unidentified = {
      analysis_status: 'completed',
      factor_sensitivity: FACTOR_SENSITIVITY,
      option_comparison: [
        { option_label: 'Continue With Founder-Led Sales', win_probability: 0.62, outcome: { n_samples: N } },
        { option_label: 'Hire a Dedicated Sales Team', win_probability: 0.38, outcome: { n_samples: N } },
      ],
    };
    const text = rerunText([labellessEditFact(EDITED_FACTOR), runFact(unidentified)], unidentified);
    expect(text).toContain('I have not compared the two');
    expect(text).not.toContain(INERT_EDIT_TAIL.trim());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. THE SIBLING SURFACE. Two composers emit "Its lead has widened by about N
//    percentage points" from the same field. A fix on one only is how they
//    drift, which is what `run-comparison-gate.ts`'s own register-parity note
//    exists to prevent.
// ─────────────────────────────────────────────────────────────────────────────

describe('run-comparison gate: the same movement gate', () => {
  function gateFact(enrichment: Record<string, unknown>, computedAt: string): HandlerFact {
    return {
      fact_type: 'run_analysis',
      noop: false,
      result: {
        enrichment,
        computed_at: computedAt,
        graph_hash_at_run: `h-${computedAt}`,
        constraint_verdict: {
          may_name_leading_option: true,
          constraint_verdict_state: 'evaluated_feasible' as const,
        },
      },
    } as unknown as HandlerFact;
  }

  function ask(prior: Record<string, unknown>, current: Record<string, unknown>): string {
    const out = tryRunComparisonGate({
      message: 'What changed?',
      // Newest-first, per the loader convention the pair selector relies on.
      priorFacts: [
        gateFact(current, '2026-09-03T01:00:00.000Z'),
        gateFact(prior, '2026-09-03T00:00:00.000Z'),
      ],
      freshness: 'fresh',
      mayNameLeadingOption: true,
    });
    expect(out.matched).toBe(true);
    if (!out.matched) throw new Error('gate did not match');
    expect(out.mode).toBe('compared');
    return out.assistant_text;
  }

  it('⭐ THE CAPTURE: the sub-noise movement gets no direction here either', () => {
    const text = ask(PRIOR_ENVELOPE, CURRENT_ENVELOPE);
    expect(text).toContain('Continue With Founder-Led Sales still leads');
    expect(text).not.toContain('widened');
    expect(text).not.toContain('narrowed');
    expect(text).toContain('moved by less than this model varies between runs');
  });

  it('POSITIVE CONTROL: a licensed movement keeps its direction and magnitude', () => {
    const text = ask(PRIOR_ENVELOPE, captureEnvelope({ founder: 0.72, hire: 0.2767, sdr: 0.0033 }));
    expect(text).toContain('Its lead has widened by about');
    expect(text).toContain('percentage points');
  });

  it('⭐ a mixed pair never borrows the noise wording here either', () => {
    const text = ask(
      captureEnvelope({ founder: 0.55, hire: 0.3805, sdr: 0.0695 }),
      captureEnvelope({ founder: 0.72, hire: 0.3805, sdr: 0.0 }),
    );
    expect(text).toContain('cannot tell whether the movement in the size of its lead');
    expect(text).not.toContain('less than this model varies');
    expect(text).not.toContain('widened');
  });

  it('no sample size ⇒ says it cannot tell, and never borrows the noise wording', () => {
    const noSamples = (founder: number): Record<string, unknown> => ({
      analysis_status: 'completed',
      results: [
        { option_id: OPT_FOUNDER, option_label: 'Continue With Founder-Led Sales', win_probability: founder },
        { option_id: OPT_HIRE, option_label: 'Hire a Dedicated Sales Team', win_probability: 1 - founder },
      ],
    });
    const text = ask(noSamples(0.55), noSamples(0.62));
    expect(text).toContain('cannot tell whether the movement in the size of its lead');
    expect(text).not.toContain('less than this model varies');
    expect(text).not.toContain('widened');
  });
});
