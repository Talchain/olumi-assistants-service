/**
 * T1 claim safety — the CONTRACT field, and the ramp off the interim.
 * ROADMAP 1.218 (PR2) · `@talchain/schemas@0.25.0`.
 *
 * WHAT MOVED. From #710 until this release the constraint verdict rode a
 * CEE-owned key inside the PLoT enrichment pass-through
 * (`enrichment.__cee_claim_safety`), because `RunAnalysisResultSchema` is
 * `.strict()` and had nowhere to put it. 0.25.0 gives it
 * `result.constraint_verdict`, mirroring CEE's `PersistedClaimSafety` verbatim.
 *
 * THE TWO OBLIGATIONS THIS FILE DISCHARGES, in the adoption manifest's own
 * vocabulary (`contracts/adoption-manifest.json`, arch step 2 / S0):
 *
 *   PRODUCER TEST — "a test that FAILS if the producer stops emitting the
 *     field. A test asserting the field is OPTIONAL on the wire is not a
 *     producer test." §1 below asserts the VALUE, per verdict state, off the
 *     real handler.
 *   CONSUMER TEST — "a test that FAILS if the consumer stops USING the value."
 *     §2 pins the reader's precedence ladder. The end-to-end consumer proof is
 *     `constraint-disclosure-route-level.test.ts`, whose entire withheld suite
 *     now runs on facts carrying ONLY the typed field: if the reader stopped
 *     consulting `result.constraint_verdict`, every one of those route tests
 *     would go red. That is the strongest form of the assertion and it is not
 *     duplicated here.
 *
 * WHY THE DRIFT TEST EXISTS AT ALL. The interim was documented as temporary and
 * carried a "delete this when the release unblocks" note for two weeks. A
 * temporary shape with no failing test is a permanent shape nobody has noticed
 * yet — the estate has shipped that exact pattern before. §1's second arm
 * asserts the interim key is GONE, so the interim cannot quietly come back.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { PLoTClient } from '../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../orchestrator/types.js';
import {
  CEE_CLAIM_SAFETY_ENRICHMENT_KEY,
  readConstraintVerdictStateFromResult,
  legacyReadMayName_DO_NOT_USE,
  readMayNameLeadingOptionFromResult,
} from '../../orchestrator/context/constraint-feasibility.js';
import {
  createRunAnalysisHandler,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../tools/registry.js';
import { setTestSink } from '../../utils/telemetry.js';

const SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

/** The user's ratified condition, in CEE's own persisted vocabulary. */
const RATIFIED_CONSTRAINT = {
  constraint_id: 'constraint_out_total_cost_max',
  node_id: 'out_total_cost',
  operator: '<=',
  threshold: 2500,
  label: 'Total three-year cost',
};

const GRAPH = {
  nodes: [
    { id: 'g', kind: 'goal', label: 'Growth' },
    { id: 'fac_x', kind: 'factor', label: 'Capacity' },
    { id: 'opt_1', kind: 'option', label: 'Plan A', interventions: { fac_x: 1 } },
    { id: 'opt_2', kind: 'option', label: 'Plan B', interventions: { fac_x: 0 } },
  ],
  edges: [],
  goal_node_id: 'g',
  goal_constraints: [RATIFIED_CONSTRAINT],
};

function makeInvocation(): HandlerInvocation {
  return {
    context: {
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }],
      session_id: SCENARIO_ID,
      request_id: 'req-constraint-verdict',
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      turn_id: 't1',
      scenario_id: SCENARIO_ID,
      message: 'run analysis',
      turn_class: 'decide',
      stage: 'analyse',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-constraint-verdict',
    signal: new AbortController().signal,
    orientationText: '',
  };
}

const SNAPSHOT: RunAnalysisScenarioSnapshot = {
  graph: GRAPH,
  options: [
    { id: 'opt_1', option_id: 'opt_1', label: 'Plan A', interventions: { fac_x: 1 } },
    { id: 'opt_2', option_id: 'opt_2', label: 'Plan B', interventions: { fac_x: 0 } },
  ],
  goal_node_id: 'g',
  // The exact array the handler forwards to PLoT — the tightest statement of
  // "what we asked the engine to enforce".
  goal_constraints: [RATIFIED_CONSTRAINT],
  rawPersistedGraph: GRAPH,
} as unknown as RunAnalysisScenarioSnapshot;

const scenarioReader: ScenarioReader = async () => SNAPSHOT;

/**
 * `constraintKey` is the ONE variable that selects the verdict state: what PLoT
 * used to key its per-option `constraint_probabilities` map. CEE's own id ⇒
 * scored ⇒ `evaluated_feasible`; absent ⇒ nothing scored ⇒ `unevaluated`.
 */
function plotEnvelope(constraintKey?: string): V2RunResponseEnvelope {
  const option = (id: string, label: string, win: number) => ({
    option_id: id,
    id,
    option_label: label,
    label,
    win_probability: win,
    outcome: { mean: 0.5, std: 0.2 },
    ...(constraintKey !== undefined
      ? { constraint_probabilities: { [constraintKey]: 0.9 }, probability_of_joint_goal: 0.9 }
      : {}),
  });
  return {
    meta: { seed_used: 1, n_samples: 1000, response_hash: 'h' },
    response_hash: 'h',
    analysis_status: 'completed',
    option_comparison: [option('opt_1', 'Plan A', 0.7), option('opt_2', 'Plan B', 0.3)],
  } as unknown as V2RunResponseEnvelope;
}

function mkPlot(response: V2RunResponseEnvelope): PLoTClient {
  return {
    run: vi.fn(async () => response),
    validatePatch: vi.fn().mockResolvedValue({}),
  } as unknown as PLoTClient;
}

async function runHandler(constraintKey?: string) {
  const handler = createRunAnalysisHandler({
    plotClient: mkPlot(plotEnvelope(constraintKey)),
    scenarioReader,
  });
  const outcome = await handler(makeInvocation());
  const fact = outcome.handler_facts[0]!;
  if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
  return fact;
}

describe('§1 PRODUCER + DRIFT — every newly-persisted run_analysis fact carries result.constraint_verdict', () => {
  beforeEach(() => setTestSink(() => {}));
  afterEach(() => {
    setTestSink(null);
    vi.restoreAllMocks();
  });

  it('WITHHELD (unevaluated): the typed field carries the verdict, not a placeholder', async () => {
    // The ratified constraint is scored under NO key at all, so nothing
    // reconciles and the verdict is `unevaluated` — the live G-CEE-1 state.
    const fact = await runHandler();
    expect(fact.result.constraint_verdict).toEqual({
      may_name_leading_option: false,
      constraint_verdict_state: 'unevaluated',
    });
  });

  it('PERMITTED (evaluated_feasible): the same field carries the OTHER answer', async () => {
    // The discriminating control. Without it, a producer that hard-coded
    // `{ may_name_leading_option: false }` would pass the test above — and
    // would cost every healthy run its recommendation.
    const fact = await runHandler('constraint_out_total_cost_max');
    expect(fact.result.constraint_verdict).toEqual({
      may_name_leading_option: true,
      constraint_verdict_state: 'evaluated_feasible',
    });
  });

  it('DRIFT BOLT: the field is never absent, on either verdict', async () => {
    // The manifest's rule: "a test asserting the field is OPTIONAL on the wire
    // is not a producer test". This one fails the moment the writer is removed
    // or made conditional — which is what stops the interim becoming permanent
    // by neglect.
    for (const key of [undefined, 'constraint_out_total_cost_max']) {
      const fact = await runHandler(key);
      expect(fact.result.constraint_verdict, `verdict missing for constraintKey=${key}`).toBeDefined();
    }
  });

  it('THE INTERIM IS GONE: nothing writes __cee_claim_safety any more', async () => {
    // The other half of the ramp. If both keys were written, the estate would
    // carry two copies of one meaning — the mirror trap — and the interim would
    // never actually retire. The enrichment is now a TOTAL byte-for-byte PLoT
    // pass-through, which is the handler-ownership invariant satisfied exactly
    // rather than with a documented exception.
    const fact = await runHandler();
    const enrichment = fact.result.enrichment as Record<string, unknown>;
    expect(CEE_CLAIM_SAFETY_ENRICHMENT_KEY in enrichment).toBe(false);
    // …and the legacy reader therefore sees nothing on a modern fact. This is
    // the assertion that proves §2's fallback is load-bearing rather than
    // shadowing the typed read.
    expect(legacyReadMayName_DO_NOT_USE(enrichment)).toBe(false);
    // The typed reader, on the same fact, says the truth.
    expect(readMayNameLeadingOptionFromResult(fact.result)).toBe(false);
  });
});

describe('§2 CONSUMER — the reader ladder: typed first, interim second, closed third', () => {
  const TYPED_PERMIT = { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' };
  const TYPED_WITHHOLD = { may_name_leading_option: false, constraint_verdict_state: 'unevaluated' };
  const INTERIM_PERMIT = {
    [CEE_CLAIM_SAFETY_ENRICHMENT_KEY]: {
      may_name_leading_option: true,
      constraint_verdict_state: 'evaluated_feasible',
    },
  };
  const INTERIM_WITHHOLD = {
    [CEE_CLAIM_SAFETY_ENRICHMENT_KEY]: {
      may_name_leading_option: false,
      constraint_verdict_state: 'unevaluated',
    },
  };

  it('a MODERN fact (typed only) is read from the typed field — both answers', () => {
    expect(readMayNameLeadingOptionFromResult({ constraint_verdict: TYPED_PERMIT })).toBe(true);
    expect(readMayNameLeadingOptionFromResult({ constraint_verdict: TYPED_WITHHOLD })).toBe(false);
  });

  it('a LEGACY staging row (interim only) still reads correctly — both answers', () => {
    // A1 ruling: no data migration. Every fact persisted between #710 and this
    // release carries only the interim stamp, and dropping this fallback would
    // silently reclassify all of them as "unknown" ⇒ withheld, costing real
    // users their leader-presuming cards on a re-opened historic analysis for
    // no safety gain.
    expect(readMayNameLeadingOptionFromResult({ enrichment: INTERIM_PERMIT })).toBe(true);
    expect(readMayNameLeadingOptionFromResult({ enrichment: INTERIM_WITHHOLD })).toBe(false);
  });

  it('a PRE-#710 fact (neither) FAILS CLOSED', () => {
    // "Unknown" and "verified feasible" are different claims, and only the
    // second licenses naming a leader.
    expect(readMayNameLeadingOptionFromResult({ enrichment: { option_comparison: [] } })).toBe(false);
    expect(readMayNameLeadingOptionFromResult({})).toBe(false);
    expect(readMayNameLeadingOptionFromResult(null)).toBe(false);
    expect(readMayNameLeadingOptionFromResult(undefined)).toBe(false);
    expect(readMayNameLeadingOptionFromResult([])).toBe(false);
  });

  it('PRECEDENCE, pinned in BOTH directions: the typed field wins over a disagreeing interim', () => {
    // This case cannot occur on a fact this codebase writes — exactly one key
    // is ever present. It is pinned anyway because precedence that is never
    // asserted is precedence nobody can rely on, and because a future
    // migration script that back-fills one of the two must not be able to flip
    // a verdict by accident.
    expect(
      readMayNameLeadingOptionFromResult({
        constraint_verdict: TYPED_WITHHOLD,
        enrichment: INTERIM_PERMIT,
      }),
      'the interim overrode the contract field — precedence is inverted',
    ).toBe(false);
    expect(
      readMayNameLeadingOptionFromResult({
        constraint_verdict: TYPED_PERMIT,
        enrichment: INTERIM_WITHHOLD,
      }),
      'the interim overrode the contract field — precedence is inverted',
    ).toBe(true);
  });

  it('a MALFORMED typed field does not fall through to a permissive interim', () => {
    // Fail-closed must not be routable around. A typed field that is present
    // but junk is a producer bug; reading past it to an older key would let the
    // bug pick the more permissive of two answers.
    for (const junk of [{}, { may_name_leading_option: 'yes' }, { may_name_leading_option: 1 }]) {
      expect(
        readMayNameLeadingOptionFromResult({ constraint_verdict: junk, enrichment: INTERIM_PERMIT }),
        `malformed verdict ${JSON.stringify(junk)} fell through to the interim`,
      ).toBe(false);
    }
  });

  /**
   * F5 — THE HALF OF THAT INVARIANT THE JUNK LIST NEVER COVERED.
   *
   * The test above states the rule ("reading past it to an older key would let
   * the bug pick the more permissive of two answers") and then exercises only
   * three OBJECT shapes. The typed branch is entered on
   * `typed !== null && typeof typed === 'object' && !Array.isArray(typed)`, so a
   * `constraint_verdict` that is present but a BOOLEAN, a STRING, an ARRAY, a
   * NUMBER or `null` skips the branch entirely and falls through to the interim
   * key — which can answer `true`. The invariant was written down and then
   * enforced over a strict subset of the values that violate it.
   *
   * `constraint_verdict` is `z.optional(z.object(...))` on the contract, so
   * ABSENT is `undefined` and nothing else. Every other present value is a
   * producer bug, and a producer bug must not be able to buy the permissive
   * answer.
   */
  it('F5: a NON-OBJECT typed field is fail-closed, not a fall-through to the interim', () => {
    const nonObjectJunk: readonly unknown[] = [true, 'feasible', [], 0, null];
    for (const junk of nonObjectJunk) {
      expect(
        readMayNameLeadingOptionFromResult({
          constraint_verdict: junk,
          enrichment: INTERIM_PERMIT,
        }),
        `constraint_verdict: ${JSON.stringify(junk)} fell through to a permissive interim`,
      ).toBe(false);
    }
  });

  it('F5 POSITIVE CONTROL: an ABSENT typed field still reaches the interim', () => {
    // Rule 2, and the anti-over-correction half: `undefined` is the ONLY honest
    // "no typed verdict recorded", and the migration ramp depends on it. A fix
    // that fail-closed on absence too would silently reclassify every
    // #710-to-0.25.0 fact as withheld.
    expect(readMayNameLeadingOptionFromResult({ enrichment: INTERIM_PERMIT })).toBe(true);
    expect(
      readMayNameLeadingOptionFromResult({
        constraint_verdict: undefined,
        enrichment: INTERIM_PERMIT,
      }),
    ).toBe(true);
  });

  it('F5: readConstraintVerdictStateFromResult carries the SAME asymmetry, and must not', () => {
    // The two readers walk one ladder by design ("the boolean and the state can
    // never be read from different stamps on one fact"). A junk typed field that
    // fail-closes the boolean while the STATE is read from the interim would
    // break exactly that property — the note would describe a verdict the
    // permission does not.
    const interimState = {
      [CEE_CLAIM_SAFETY_ENRICHMENT_KEY]: {
        may_name_leading_option: true,
        constraint_verdict_state: 'evaluated_feasible',
      },
    };
    for (const junk of [true, 'feasible', [], 0, null]) {
      expect(
        readConstraintVerdictStateFromResult({
          constraint_verdict: junk,
          enrichment: interimState,
        }),
        `constraint_verdict: ${JSON.stringify(junk)} read its STATE from the interim`,
      ).toBeNull();
    }
    // POSITIVE CONTROL: absent ⇒ the interim state is still read.
    expect(readConstraintVerdictStateFromResult({ enrichment: interimState })).toBe(
      'evaluated_feasible',
    );
  });
});
