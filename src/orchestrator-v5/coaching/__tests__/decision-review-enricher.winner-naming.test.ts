/**
 * THE DECISION BRIEF MUST NOT STATE A PRICE THAT EXISTS NOWHERE IN THE MODEL.
 *
 * ## What this file proves, and why it is at the SEAM
 *
 * It drives the REAL enricher (`enrichRunAnalysisWithDecisionReview`) with a
 * mocked review model and reads the `narrative_summary` that actually reaches
 * `enrichment.decision_review` — the string `phase3-blocks.ts`
 * `buildNarrativeCard` composes into the primary review_card body a user reads.
 *
 * A pure-function test on `winner-naming-egress-guard.ts` alone would prove the
 * policy CORRECT and could not prove it RUNS: delete the
 * `applyWinnerNamingEgressGuard` call from the enricher and every such
 * assertion stays green while the product ships the defect. That is CLAUDE.md
 * trap 13b at the WIRING level. This file is the mutant that bites for that
 * deletion, and it is modelled on `decision-review-enricher.runner-up-gap.test.ts`,
 * which exists for the same reason one rail over.
 *
 * ## Where the fixtures come from, stated exactly (trap 14b / trap 20)
 *
 * The (STATED figure, STORED label) pairs below are the MEASURED pairs from the
 * three defective runs of 2026-09-15 — run1 £44 vs stored £49, run2 £59 vs
 * stored £49, run4 £52 vs stored £59 — dropped into the two-sentence template
 * the captures carry ("… produced the best outcome in N% of runs of this model.
 * The link from X to Y is sensitive to your assumptions."), whose bytes are
 * pinned by CEE's own eval capture `r3-02-close-call.json`.
 *
 * ⚠ THEY ARE RECONSTRUCTIONS OF THE MEASURED PAIRS, NOT VERBATIM CAPTURES. The
 * figures and the template are measured; the surrounding wording is not claimed
 * to be byte-identical to any single capture. Said plainly so nobody later
 * inherits them as a dated capture corpus.
 *
 * ## The two controls are the point
 *
 * Cases 4 and 5 are the OPPOSITE-DIRECTION TWINS. Case 4 is an honest narrative.
 * Case 5 is the INFLECTED form ("Raising the Pro plan price to £49…") that the
 * predicate's stem tolerance exists for — the exact false positive that once put
 * the decomposed path's fallback rate at 100%. Both must ship BYTE-IDENTICAL.
 * Without them this file would show only that the guard is SENSITIVE, never that
 * it DISCRIMINATES.
 *
 * ## RED-first at pristine (CEE 07da2c0b) — MEASURED
 *
 * Measured by reverting ONLY `decision-review-enricher.ts` to HEAD (applied-check:
 * `applyWinnerNamingEgressGuard` 0 occurrences, contrast control
 * `redactRunnerUpGapStatistic` 2 — the probe can see): **3 failed | 3 passed (6)**.
 * The three failures are cases 1-3, each on `expected false to be true` for
 * `narrativeNamesOption(shipped, storedLabel)` — the model's prose reaches the
 * enrichment verbatim, because nothing on the live (monolith) path compares it
 * to the stored winner.
 *
 * The three PASSES at pristine are the two controls and the withheld twin. They
 * are controls, not RED-first evidence, and are stated as such so "3 passed" is
 * never read as partial coverage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import * as invokeMod from '../../../cee/decision-review/invoke.js';
import { narrativeNamesOption } from '../../../cee/decision-review/decompose.js';
import type { ModelResolution } from '../../../adapters/llm/router.js';
import { enrichRunAnalysisWithDecisionReview } from '../decision-review-enricher.js';
import {
  buildWinnerNamingReplacement,
  WINNER_NAMING_REASON,
} from '../../compose/winner-naming-egress-guard.js';

const MOCK_RESOLUTION: ModelResolution = {
  task: 'decision_review',
  resolved_model: 'gpt-4.1',
  resolution_source: 'task_default',
  provider: 'openai',
};

const REQUEST_ID = 'req-winner-naming';

const PRICE_49 = 'Raise the Pro plan price to £49';
const PRICE_59 = 'Raise the Pro plan price to £59';

/** The captured two-sentence shape, parameterised by what the model typed. */
function narrativeTemplate(statedOption: string, pct: number): string {
  return (
    `${statedOption} produced the best outcome in ${pct}% of runs of this model. ` +
    'The link from Price to Revenue is sensitive to your assumptions.'
  );
}

interface Pair {
  readonly name: string;
  /** The label STORED on the run — the identity every assertion binds to. */
  readonly storedLabel: string;
  readonly storedWinProbability: number;
  /** What the review model actually wrote. */
  readonly narrative: string;
  /** Must the guard substitute? */
  readonly defective: boolean;
}

const PAIRS: readonly Pair[] = [
  {
    name: 'run1 — stated £44, stored £49',
    storedLabel: PRICE_49,
    storedWinProbability: 0.56,
    narrative: narrativeTemplate('Raise the Pro plan price to £44', 56),
    defective: true,
  },
  {
    name: 'run2 — stated £59, stored £49 (no percentage coincidence at all)',
    storedLabel: PRICE_49,
    storedWinProbability: 0.62,
    narrative: narrativeTemplate('Raise the Pro plan price to £59', 62),
    defective: true,
  },
  {
    name: 'run4 — stated £52, stored £59',
    storedLabel: PRICE_59,
    storedWinProbability: 0.52,
    narrative: narrativeTemplate('Raise the Pro plan price to £52', 52),
    defective: true,
  },
  {
    name: 'CONTROL — honest narrative naming the stored label exactly',
    storedLabel: PRICE_49,
    storedWinProbability: 0.56,
    narrative: narrativeTemplate(PRICE_49, 56),
    defective: false,
  },
  {
    name: 'CONTROL — inflected "Raising…", the tolerance this predicate exists for',
    storedLabel: PRICE_49,
    storedWinProbability: 0.56,
    narrative: narrativeTemplate('Raising the Pro plan price to £49', 56),
    defective: false,
  },
];

function runAnalysisFact(
  enrichment: Record<string, unknown>,
  extraResult: Record<string, unknown> = {},
): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-wn',
      leading_option_id: 'opt-1',
      summary: 'Ran analysis',
      // PRECONDITION, PINNED RATHER THAN INHERITED. The leader claim must be
      // PERMITTED for these five cases: that is the state the three defective
      // runs were measured in (each shipped a headline naming an option), and
      // it is the state in which the guard is allowed to name the winner at
      // all. The harness default is the OPPOSITE — with no `constraint_verdict`
      // the reader falls through to the legacy enrichment path and withholds,
      // which sends every case down the no-option branch and would make this
      // table silently measure the withheld twin instead. Measured, not
      // assumed: without this line all three defective cases ship the
      // option-free disclosure.
      constraint_verdict: { may_name_leading_option: true },
      enrichment,
      ...extraResult,
    },
  } as HandlerFact;
}

function enrichmentFor(pair: Pair): Record<string, unknown> {
  return {
    results: [
      {
        option_id: 'opt-1',
        option_label: pair.storedLabel,
        win_probability: pair.storedWinProbability,
      },
      { option_id: 'opt-2', option_label: 'Hold the price at £39', win_probability: 0.2 },
    ],
    factor_sensitivity: [{ label: 'Price', direction: 'positive', elasticity: 0.2 }],
    robustness: { level: 'stable', fragile_edges: [] },
    graph: { nodes: [], edges: [] },
  };
}

function reviewOutput(narrative: string): Record<string, unknown> {
  return {
    narrative_summary: narrative,
    story_headlines: { 'opt-1': 'Highest revenue at an acceptable churn risk' },
    robustness_explanation: { summary: 'Stable across runs.' },
    readiness_rationale: 'Evidence is thin on one factor.',
    evidence_enhancements: {},
    bias_findings: [],
    key_assumptions: [],
    decision_quality_prompts: [],
  };
}

async function shipReview(
  pair: Pair,
  extraResult: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  vi.spyOn(invokeMod, 'invokeDecisionReview').mockResolvedValue({
    output: reviewOutput(pair.narrative),
    raw: '{}',
    model: 'gpt-4.1',
    provider: 'openai',
    llm_latency_ms: 200,
    input_tokens: 100,
    output_tokens: 200,
    prompt_version: 'v1',
    resolution: MOCK_RESOLUTION,
  } as never);

  const out = await enrichRunAnalysisWithDecisionReview({
    handlerFacts: [runAnalysisFact(enrichmentFor(pair), extraResult)],
    requestId: REQUEST_ID,
    scenarioId: 'scen-wn',
    signal: new AbortController().signal,
    brief: 'Should we raise the Pro plan price this quarter?',
  });
  const patched = out[0];
  if (patched.fact_type !== 'run_analysis') throw new Error('narrowing');
  const enrichment = patched.result.enrichment as Record<string, unknown>;
  const dr = enrichment.decision_review as Record<string, unknown> | undefined;
  if (dr === undefined) throw new Error('decision_review was not attached');
  return dr;
}

describe('the shipped decision-review narrative names the STORED winner', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(PAIRS)('$name', async (pair) => {
    // PRECONDITION PINNED IN-TEST (trap 13b): the fixture must genuinely be the
    // state it claims to be, or the assertion below is a tautology that would
    // stay green if the fixture silently stopped reproducing the defect.
    expect(narrativeNamesOption(pair.narrative, pair.storedLabel)).toBe(!pair.defective);

    const dr = await shipReview(pair);
    const shipped = dr.narrative_summary as string;

    // THE INVARIANT, bound by IDENTITY — the winner's own stored label, with
    // numerals matched exactly. Not "contains a currency figure", which another
    // object could satisfy.
    expect(narrativeNamesOption(shipped, pair.storedLabel)).toBe(true);
    // Never emptied: an empty narrative composes NO review_card at all.
    expect(shipped.trim().length).toBeGreaterThan(0);

    if (pair.defective) {
      // The model's sentence did not ship.
      expect(shipped).not.toBe(pair.narrative);
      // NOTHING FAILS SILENTLY (Paul, 2026-09-15): the substitution discloses
      // itself, as Olumi's fault, with a copyable reference the user can quote.
      expect(shipped).toContain('Olumi fault');
      expect(shipped).toContain(REQUEST_ID);
      const details = dr.narrative_summary_substitution as Record<string, unknown>;
      expect(details.fault).toBe('olumi');
      expect(details.request_id).toBe(REQUEST_ID);
      expect(details.reason).toBe(WINNER_NAMING_REASON);
      expect(details.winner_label).toBe(pair.storedLabel);
      expect(typeof details.readable).toBe('string');
    } else {
      // BYTE-IDENTICAL. The guard discriminates; it does not merely fire.
      expect(shipped).toBe(pair.narrative);
      expect(dr.narrative_summary_substitution).toBeUndefined();
    }
  });

  it('withheld leader claim: the replacement names NO option and still discloses', () => {
    // The opposite-direction twin at the CLAIM level. On a withheld run the
    // guard must not author the crowning sentence the withhold exists to
    // prevent (`recommendation_suppressed`, set at buildInvokeInput from the one
    // constraint verdict).
    const withheld = buildWinnerNamingReplacement(
      { label: PRICE_49, win_probability: 0.56, recommendation_suppressed: true },
      REQUEST_ID,
    );
    expect(withheld).not.toContain('£49');
    expect(withheld).not.toContain('56%');
    expect(withheld).toContain('Olumi fault');
    expect(withheld).toContain(REQUEST_ID);

    // CONTRAST, same run: the permitted case DOES name the winner — so the
    // assertion above measures the withhold, not a guard that never names
    // anything.
    const permitted = buildWinnerNamingReplacement(
      { label: PRICE_49, win_probability: 0.56 },
      REQUEST_ID,
    );
    expect(narrativeNamesOption(permitted, PRICE_49)).toBe(true);
    expect(permitted).toContain('56%');
  });
});
