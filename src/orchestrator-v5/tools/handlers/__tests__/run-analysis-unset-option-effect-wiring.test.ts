/**
 * THE WIRING PIN for the unset-option-effect disclosure — and it EXECUTES the
 * handler.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ WHY THIS FILE EXISTS.
 *
 * The three suites shipped with this surface test the BUILDERS in isolation —
 * `collectUnsetOptionEffects`, `buildUnsetOptionEffectDisclosure`,
 * `unsetOptionEffectFactorIds`, `resolveRunAdmission`. Not one of them imports
 * `run-analysis.ts`. So at the tip that introduced them, DELETING BOTH WIRING
 * HUNKS FROM THE HANDLER LEFT EVERY TEST IN THE REPOSITORY GREEN while the
 * feature shipped INERT. That is this estate's chronic failure #1 — built, not
 * plugged in; 42 recorded instances — and this file is the guard that closes it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ EXECUTING, NOT A STATIC-SOURCE PIN, AND THE CHOICE IS EVIDENCED.
 *
 * The house pattern for this seam is
 * `run-analysis-objective-contradiction-wiring.test.ts`, which reads
 * `run-analysis.ts` with `readFileSync` and says in its own header that it does
 * NOT execute the handler. That pattern is cheaper and strictly weaker: a
 * static pin cannot distinguish a live call from a call whose RESULT IS
 * DISCARDED, and it pins source text rather than behaviour.
 *
 * It was not needed here. `RunAnalysisHandlerDeps` declares exactly TWO
 * dependencies — `plotClient` and `scenarioReader` — both trivially stubbed,
 * and a dozen sibling specs already drive the handler this way. So this file
 * asserts the thing that actually matters: THE SENTENCE ARRIVES IN THE TEXT THE
 * USER RECEIVES, and the unset factor is not simultaneously crowned as the
 * reason the winner won. Values flowing, not call sites existing.
 *
 * Status ladder: TESTED. Stubbed PLoT + stubbed scenario reader is not a wire
 * witness and not a journey witness.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT EACH ARM GUARDS, STATED SO A LATER READER CANNOT DELETE HALF OF IT.
 *
 *   ARM 1  guards the `collectUnsetOptionEffects(...)` call (~run-analysis.ts:1556).
 *          Remove it and `unsetOptionEffects` stays `[]`, the builder returns
 *          `''`, and the sentence disappears from the summary.
 *
 *   ARM 2  guards the `unsetOptionEffectFactorIds:` pass-through into
 *          `headlineInput` (~run-analysis.ts:1610). Remove it and the
 *          disclosure still ships — ARM 1 stays GREEN — but the headline goes
 *          back to naming the unset factor as the strongest driver. Measured at
 *          this tip, that mutant produces VERBATIM the staging defect:
 *
 *            "Configured 0 came out ahead in 62% of runs of this model because
 *             Ramp Delay is the strongest driver. […] This analysis ran without
 *             a value for how “Partial” affects “Ramp Delay”…"
 *
 *          — one sentence crowning a factor the next sentence admits was never
 *          set. ARM 1 alone would let that ship.
 *
 *   ARM 3  is the DISCRIMINATING TWIN (CLAUDE.md trap 19). A single biting
 *          mutant proves sensitivity to SOMETHING; only the pair proves the
 *          binding. ARM 2 is an ABSENCE assertion, so on its own it would pass
 *          just as happily against a build that never names any driver at all.
 *          ARM 3 runs the same handler over the same graph with a top driver
 *          that is NOT unset and requires the driver clause to BE THERE, naming
 *          that factor. Together: the clause is suppressed for the unset factor
 *          and only for it.
 */

import { describe, expect, it, vi } from 'vitest';

import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import {
  createRunAnalysisHandler,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';
import { resolveRunAdmission } from '../analysis-ready-core.js';
import {
  buildUnsetOptionEffectDisclosure,
  collectUnsetOptionEffects,
} from '../../../coaching/unset-option-effect-disclosure.js';
import { isAllowedRunAnalysisAssistantText } from '../../../coaching/analysis-result-headline.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

const TEST_SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEST_REQUEST_ID = 'req-unset-option-effect-wiring';

// ============================================================================
// THE FIXTURE — not written by this lane, deliberately
// ============================================================================
//
// `PARTIAL_PLUS_EMPTY` is the same graph
// `coaching/__tests__/unset-option-effect-producer-bound.test.ts` uses, which
// lifted it verbatim from `run-admission-two-term.test.ts`, where the
// compute-discard-waiver lane built it to pin an unrelated claim. A fixture the
// author wrote is not evidence about the wire (trap 16-inverse); this one
// predates the surface it is now exercising.
//
// Its shape is exactly the staging defect: `opt_partial` is linked to TWO
// factors and valued on ONE, so its interventions are non-empty, the analysable
// gate SUBMITS it, and the readiness authority still raises
// `MISSING_OPTION_VALUE` for the unvalued factor — a blocker the run proceeds
// past with `may_run: true`.

const v3Edge = (id: string, from: string, to: string) => ({
  id,
  from,
  to,
  strength: { mean: 0.5, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: 'positive' as const,
});

const option = (id: string, label: string, interventions?: Record<string, number>) => ({
  id,
  kind: 'option',
  label,
  ...(interventions ? { interventions } : {}),
});

const PARTIAL_PLUS_EMPTY = {
  version: '1',
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Bridge the sales/engineering gap' },
    { id: 'decision', kind: 'decision', label: 'Hiring' },
    {
      id: 'fac_velocity',
      kind: 'factor',
      label: 'Engineering Delivery Velocity',
      category: 'controllable',
      observed_state: { value: 0.5, cap: 1 },
    },
    {
      id: 'fac_ramp',
      kind: 'factor',
      label: 'Ramp Delay',
      category: 'controllable',
      observed_state: { value: 0.5, cap: 1 },
    },
    option('opt_c0', 'Configured 0', { fac_velocity: 0.4 }),
    option('opt_c1', 'Configured 1', { fac_velocity: 0.8 }),
    option('opt_partial', 'Partial', { fac_velocity: 0.6 }),
    option('opt_empty', 'Empty'),
  ],
  edges: [
    v3Edge('e1', 'decision', 'opt_c0'),
    v3Edge('e2', 'decision', 'opt_c1'),
    v3Edge('e3', 'decision', 'opt_partial'),
    v3Edge('e4', 'decision', 'opt_empty'),
    v3Edge('e5', 'opt_c0', 'fac_velocity'),
    v3Edge('e6', 'opt_c1', 'fac_velocity'),
    v3Edge('e7', 'opt_partial', 'fac_velocity'),
    v3Edge('e8', 'opt_partial', 'fac_ramp'),
    v3Edge('e9', 'opt_empty', 'fac_velocity'),
    v3Edge('e10', 'fac_velocity', 'goal'),
    v3Edge('e11', 'fac_ramp', 'goal'),
  ],
};

/**
 * ARM 3's graph: the same model plus one factor NO option is linked to, so it
 * raises no `MISSING_OPTION_VALUE` blocker and is not an option-controlled
 * lever either — the only factor in this fixture family that is nameable as a
 * driver.
 */
const PLUS_NAMEABLE_DRIVER = {
  ...PARTIAL_PLUS_EMPTY,
  nodes: [
    ...PARTIAL_PLUS_EMPTY.nodes,
    {
      id: 'fac_market',
      kind: 'factor',
      label: 'Market Conditions',
      category: 'external',
      observed_state: { value: 0.5, cap: 1 },
    },
  ],
  edges: [...PARTIAL_PLUS_EMPTY.edges, v3Edge('e12', 'fac_market', 'goal')],
};

// ============================================================================
// HANDLER SCAFFOLDING — two deps, both stubbed
// ============================================================================

function makeScenarioReader(graph: Record<string, unknown>): ScenarioReader {
  const snapshot = {
    graph,
    options: (graph.nodes as Array<Record<string, unknown>>).filter((n) => n.kind === 'option'),
    goal_node_id: 'goal',
    rawPersistedGraph: graph,
  } as unknown as RunAnalysisScenarioSnapshot;
  return (() => Promise.resolve(snapshot)) as ScenarioReader;
}

/** `opt_empty` is absent because the analysable gate excludes it — the shape PLoT returns. */
const OPTION_COMPARISON: ReadonlyArray<Record<string, unknown>> = [
  { option_id: 'opt_c0', option_label: 'Configured 0', win_probability: 0.62, status: 'computed' },
  { option_id: 'opt_c1', option_label: 'Configured 1', win_probability: 0.25, status: 'computed' },
  { option_id: 'opt_partial', option_label: 'Partial', win_probability: 0.13, status: 'computed' },
];

const SENSITIVITY_ENTRY = (id: string, label: string, score: number) => ({
  node_id: id,
  factor_id: id,
  label,
  influence_score: score,
  sensitivity_score: score,
});

/** ARM 1/2: the strongest driver IS the factor whose option effect was never set. */
const SENSITIVITY_UNSET_ON_TOP = [
  SENSITIVITY_ENTRY('fac_ramp', 'Ramp Delay', 0.9),
  SENSITIVITY_ENTRY('fac_velocity', 'Engineering Delivery Velocity', 0.4),
];

/** ARM 3: the strongest driver is a factor with no unset option effect. */
const SENSITIVITY_NAMEABLE_ON_TOP = [
  SENSITIVITY_ENTRY('fac_market', 'Market Conditions', 0.95),
  SENSITIVITY_ENTRY('fac_ramp', 'Ramp Delay', 0.9),
  SENSITIVITY_ENTRY('fac_velocity', 'Engineering Delivery Velocity', 0.4),
];

function makePlotClient(factorSensitivity: ReadonlyArray<Record<string, unknown>>): PLoTClient {
  const response = {
    meta: { seed_used: 1, n_samples: 1000, response_hash: 'unset-effect-wiring' },
    response_hash: 'unset-effect-wiring',
    analysis_status: 'computed',
    option_comparison: OPTION_COMPARISON,
    factor_sensitivity: factorSensitivity,
  } as unknown as V2RunResponseEnvelope;
  return {
    run: vi.fn(() =>
      Promise.resolve(JSON.parse(JSON.stringify(response)) as V2RunResponseEnvelope),
    ),
    validatePatch: vi.fn().mockResolvedValue({}),
  } as unknown as PLoTClient;
}

function makeInvocation(): HandlerInvocation {
  return {
    context: {
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }],
      session_id: TEST_SCENARIO_ID,
      request_id: TEST_REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({
      turn_id: 't1',
      scenario_id: TEST_SCENARIO_ID,
      message: 'run analysis',
      turn_class: 'decide',
      stage: 'analyse',
    }),
    requestId: TEST_REQUEST_ID,
    signal: new AbortController().signal,
    orientationText: '',
  };
}

/** Drive the real handler and return the assistant text it puts on the turn. */
async function runAndReadSummary(
  graph: Record<string, unknown>,
  factorSensitivity: ReadonlyArray<Record<string, unknown>>,
): Promise<string> {
  const handler = createRunAnalysisHandler({
    plotClient: makePlotClient(factorSensitivity),
    scenarioReader: makeScenarioReader(graph),
  });
  const outcome = await handler(makeInvocation());
  const fact = outcome.handler_facts[0];
  if (fact === undefined || fact.fact_type !== 'run_analysis') {
    throw new Error(`expected a run_analysis fact, got ${String(fact?.fact_type)}`);
  }
  return fact.result.summary ?? '';
}

/**
 * The literal driver clause the headline emits. Hand-written on purpose: a
 * derived guard proves agreement, never correctness (trap 12d), and this is the
 * exact string a user reads.
 */
const DRIVER_CLAUSE = 'is the strongest driver';

describe('wiring — the run_analysis handler consumes the unset-option-effect seam', () => {
  // ==========================================================================
  // PRECONDITION — pinned in-test, so no arm below can pass on an empty case
  // ==========================================================================
  it('⭐ PRECONDITION — the fixture really does yield MISSING_OPTION_VALUE with may_run true', () => {
    // Without this, every assertion below could be true of a run that had
    // nothing unset at all: a guard agreeing with itself (trap 13b). Pinned
    // against the REAL readiness authority, not a hand-made blocker.
    const admission = resolveRunAdmission(PARTIAL_PLUS_EMPTY);

    // `may_run: true` — the run PROCEEDS past the gap. This surface is a
    // disclosure, not a gate; if the graph started being refused, the sentence
    // would never ship and these tests would be measuring a different product.
    expect(admission.willProceed).toBe(true);

    const partial = (admission.assessment.blockingIssues ?? []).find(
      (i) => i.code === 'MISSING_OPTION_VALUE' && i.option_id === 'opt_partial',
    );
    expect(partial).toBeDefined();
    expect(partial?.option_label).toBe('Partial');
    expect(partial?.factor_label).toBe('Ramp Delay');
    expect(partial?.factor_id).toBe('fac_ramp');
    // Not already spoken for by the exclusion disclosure — otherwise this
    // surface is correctly silent and the arms below prove nothing.
    expect(partial?.waived_by_exclusion).not.toBe(true);
  });

  // ==========================================================================
  // ARM 1 — the sentence reaches the assistant text
  // ==========================================================================
  it('⭐ ARM 1 — the disclosure the builders compose ARRIVES in the turn the user receives', async () => {
    const summary = await runAndReadSummary(PARTIAL_PLUS_EMPTY, SENSITIVITY_UNSET_ON_TOP);

    // (a) The literal user-visible sentence. A hand-written expectation, so a
    //     builder change that silently alters what the user reads REDs here
    //     rather than being blessed by a derivation of itself.
    expect(summary).toContain(
      'This analysis ran without a value for how “Partial” affects “Ramp Delay”,' +
        ' so that option was analysed as leaving it unchanged.' +
        ' Set that value and run the analysis again to see whether the comparison changes.',
    );

    // (b) …and it is BYTE-IDENTICAL to what the builder produces from the REAL
    //     admission, bound by identity to this graph's own blockers rather than
    //     to any sentence that happens to match the shape (trap 19).
    const admission = resolveRunAdmission(PARTIAL_PLUS_EMPTY);
    const expected = buildUnsetOptionEffectDisclosure(
      collectUnsetOptionEffects(
        admission.assessment.blockingIssues,
        new Set(['opt_c0', 'opt_c1', 'opt_partial']),
      ),
    );
    expect(expected).not.toBe(''); // the builder is not vacuously agreeing
    expect(summary.endsWith(expected)).toBe(true);

    // (c) THE LOAD-BEARING HALF. A tail the egress allowlist rejects does not
    //     error — it silently replaces the whole summary with the locked
    //     template, and the user receives nothing. Composed ≠ delivered.
    expect(isAllowedRunAnalysisAssistantText(summary)).toBe(true);
  });

  // ==========================================================================
  // ARM 2 — the unset factor is not crowned as the reason the winner won
  // ==========================================================================
  it('⭐ ARM 2 — the unset factor is NOT named as the strongest driver on the same turn', async () => {
    const summary = await runAndReadSummary(PARTIAL_PLUS_EMPTY, SENSITIVITY_UNSET_ON_TOP);

    // `fac_ramp` is the raw strongest driver in this envelope, so without the
    // `unsetOptionEffectFactorIds` pass-through the headline names it — the
    // measured staging defect, in which the product says a factor decided the
    // winner and then says it never had a value for it.
    expect(summary).not.toContain(DRIVER_CLAUSE);
    expect(summary).not.toContain('because Ramp Delay');

    // The disclosure still ships on this same turn — the two halves are
    // additive, and a "fix" that suppressed the sentence to silence the driver
    // clause would be the mirror-image defect.
    expect(summary).toContain('“Partial” affects “Ramp Delay”');
  });

  // ==========================================================================
  // ARM 3 — the discriminating twin
  // ==========================================================================
  it('⭐ ARM 3 (DISCRIMINATING TWIN) — a driver that is NOT unset is still named', async () => {
    // Same handler, same graph family, one extra factor no option is linked to.
    // If this arm went silent, ARM 2 would be passing against a build that
    // never names any driver at all — an absence assertion with nothing to
    // discriminate against.
    const summary = await runAndReadSummary(PLUS_NAMEABLE_DRIVER, SENSITIVITY_NAMEABLE_ON_TOP);

    expect(summary).toContain('because Market Conditions is the strongest driver.');

    // The suppression is bound to the UNSET factor by identity, not applied
    // wholesale: `fac_ramp` is still unset here and still never named as the
    // driver, while `fac_market` — same envelope, same builder — is.
    expect(summary).not.toContain('because Ramp Delay');

    // And the disclosure rides alongside the driver clause, unchanged.
    expect(summary).toContain('“Partial” affects “Ramp Delay”');
    expect(isAllowedRunAnalysisAssistantText(summary)).toBe(true);
  });
});
