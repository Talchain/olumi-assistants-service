/**
 * Crowning status gate — CEE half of the status-blind leader-selection defect
 * (2026-07-20).
 *
 * `selectLeadingOptionId` read `win_probability` alone and never looked at the
 * per-option ISL `status`, so an option that FAILED to compute
 * (`status: 'error'`) but carried a top win-probability was crowned as CEE's
 * `leading_option_id` on the live path. Codex reproduced the identical defect
 * in PLoT — `opt_far_over` (status `'error'`, win 0.9) crowned over a computed
 * option at 0.3 — and PLoT fixed its half in PR #238 (staging `13ecf98`).
 * PLoT's fix cannot reach this code path: CEE derives `leading_option_id`
 * itself from the raw `option_comparison[]` records.
 *
 * These tests are the CEE reproduction of that exact scenario plus the two
 * cases the fix must NOT break:
 *
 *   1. RED-first repro — errored top-probability option must not be crowned.
 *   2. Single-result branch — flagged explicitly by A3 as easy to miss; the
 *      old code returned `extractOptionId(records[0])` with no checks at all.
 *   3. Positive control — an all-computed set still crowns the highest, and a
 *      status-less (legacy) set is completely unaffected. Without these the
 *      fix could "pass" by withholding leaders wholesale, which would be a
 *      missing-value defect replacing a wrong-value one.
 *
 * NOTE: the per-option `status` here is NOT the envelope-level
 * `analysis_status` covered by `run-analysis-permissive-status.test.ts`.
 * Different field, different vocabulary, different failure mode.
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
import {
  COMPUTED_OPTION_STATUS,
  assertComputedStatusLiteralPinned,
  isRecommendableOption,
} from '../recommendable-option.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

const TEST_SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEST_REQUEST_ID = 'req-crowning-status';

function makeScenarioSnapshot(): RunAnalysisScenarioSnapshot {
  const graph = { nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }], edges: [] };
  return {
    graph,
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'A', interventions: { fac_price: 1.2 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'B', interventions: { fac_price: 0.9 } },
    ],
    goal_node_id: 'g',
    rawPersistedGraph: graph,
  } as unknown as RunAnalysisScenarioSnapshot;
}

function makeScenarioReader(): ScenarioReader {
  const snapshot = makeScenarioSnapshot();
  const reader: ScenarioReader = () => Promise.resolve(snapshot);
  return reader;
}

function makePlotClient(response: V2RunResponseEnvelope): PLoTClient {
  const run = vi.fn(() =>
    Promise.resolve(JSON.parse(JSON.stringify(response)) as V2RunResponseEnvelope),
  );
  return { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
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

/** Invoke the handler over a given option_comparison[] and read the crown. */
async function crownFrom(optionComparison: unknown[]): Promise<string | null> {
  const response = {
    meta: { seed_used: 1, n_samples: 1000, response_hash: 'crown' },
    response_hash: 'crown-top',
    analysis_status: 'computed',
    option_comparison: optionComparison,
  } as unknown as V2RunResponseEnvelope;

  const handler = createRunAnalysisHandler({
    plotClient: makePlotClient(response),
    scenarioReader: makeScenarioReader(),
  });
  const outcome = await handler(makeInvocation());
  const fact = outcome.handler_facts[0]!;
  if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
  return fact.result.leading_option_id;
}

describe('run_analysis — crowning is status-aware (per-option ISL status)', () => {
  it("REPRO (Codex): an errored option with the TOP win-probability is never crowned", async () => {
    // The exact PLoT reproduction, ported to CEE: opt_far_over failed to
    // compute but carries win 0.9; opt_computed genuinely computed at 0.3.
    // Pre-fix CEE crowned opt_far_over — a failed option presented to the
    // user as the leading recommendation.
    const crown = await crownFrom([
      { option_id: 'opt_far_over', option_label: 'Far over', win_probability: 0.9, status: 'error' },
      { option_id: 'opt_computed', option_label: 'Computed', win_probability: 0.3, status: 'computed' },
    ]);
    expect(crown).toBe('opt_computed');
    expect(crown).not.toBe('opt_far_over');
  });

  it("'skipped' status is likewise not crownable even at the top probability", async () => {
    const crown = await crownFrom([
      { option_id: 'opt_skipped', option_label: 'Skipped', win_probability: 0.95, status: 'skipped' },
      { option_id: 'opt_ok', option_label: 'OK', win_probability: 0.42, status: 'computed' },
    ]);
    expect(crown).toBe('opt_ok');
  });

  it('SINGLE-RESULT BRANCH: a lone errored option is not crowned (A3 flag)', async () => {
    // The old single-result branch returned extractOptionId(records[0])
    // unconditionally — "presence wins over magnitude" — so a solitary failed
    // option became the leader with no check whatsoever. There is no
    // recommendable option here, so the honest answer is the pre-existing
    // "no leader" state (null), not a fabricated crown.
    const crown = await crownFrom([
      { option_id: 'opt_only_error', option_label: 'Only, errored', win_probability: 0.77, status: 'error' },
    ]);
    expect(crown).toBeNull();
  });

  it('SINGLE-RESULT BRANCH: the single survivor of a filtered set IS crowned', async () => {
    // Complements the case above: filtering must collapse INTO the
    // single-result branch, not bypass it. Two records in, one recommendable
    // survivor out -> that survivor is the leader even though its probability
    // is the lower of the two.
    const crown = await crownFrom([
      { option_id: 'opt_error_high', option_label: 'Errored high', win_probability: 0.88, status: 'error' },
      { option_id: 'opt_lone_ok', option_label: 'Lone OK', win_probability: 0.12, status: 'computed' },
    ]);
    expect(crown).toBe('opt_lone_ok');
  });

  it('no recommendable option at all → null (degraded, never fabricated)', async () => {
    const crown = await crownFrom([
      { option_id: 'opt_e1', option_label: 'E1', win_probability: 0.9, status: 'error' },
      { option_id: 'opt_e2', option_label: 'E2', win_probability: 0.8, status: 'error' },
    ]);
    expect(crown).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Positive controls — the fix must not withhold leaders that should exist
  // -------------------------------------------------------------------------

  it('POSITIVE CONTROL: an all-computed set still crowns the highest probability', async () => {
    const crown = await crownFrom([
      { option_id: 'opt_lo', option_label: 'Lo', win_probability: 0.2, status: 'computed' },
      { option_id: 'opt_hi', option_label: 'Hi', win_probability: 0.7, status: 'computed' },
      { option_id: 'opt_mid', option_label: 'Mid', win_probability: 0.5, status: 'computed' },
    ]);
    expect(crown).toBe('opt_hi');
  });

  it('POSITIVE CONTROL: status-less (legacy) records are unaffected — absent status is recommendable', async () => {
    // Every fixture in the permissive-status suite, and the real staging
    // capture, carry NO per-option status. A strict `status === "computed"`
    // predicate would have filtered all of these out and withheld the leader.
    const crown = await crownFrom([
      { option_id: 'opt_legacy_hi', option_label: 'Legacy hi', win_probability: 0.66 },
      { option_id: 'opt_legacy_lo', option_label: 'Legacy lo', win_probability: 0.34 },
    ]);
    expect(crown).toBe('opt_legacy_hi');
  });

  it('POSITIVE CONTROL: R2 tie rule survives the gate — tie among computed options → null', async () => {
    const crown = await crownFrom([
      { option_id: 'opt_t1', option_label: 'T1', win_probability: 0.5, status: 'computed' },
      { option_id: 'opt_t2', option_label: 'T2', win_probability: 0.5, status: 'computed' },
    ]);
    expect(crown).toBeNull();
  });

  it('POSITIVE CONTROL: an errored option does not break a tie among computed options', async () => {
    // Guards against the gate accidentally being applied AFTER the max/tie
    // arithmetic: the errored 0.9 must be gone before ties are assessed, and
    // the remaining genuine tie must still resolve to null.
    const crown = await crownFrom([
      { option_id: 'opt_err', option_label: 'Err', win_probability: 0.9, status: 'error' },
      { option_id: 'opt_t1', option_label: 'T1', win_probability: 0.5, status: 'computed' },
      { option_id: 'opt_t2', option_label: 'T2', win_probability: 0.5, status: 'computed' },
    ]);
    expect(crown).toBeNull();
  });
});

describe('isRecommendableOption — the shared status predicate', () => {
  it('mirrors PLoT: absent status is recommendable (legacy shape)', () => {
    expect(isRecommendableOption({ option_id: 'a', win_probability: 0.5 })).toBe(true);
  });

  it("'computed' is recommendable", () => {
    expect(isRecommendableOption({ status: 'computed' })).toBe(true);
  });

  it.each(['error', 'skipped', 'unavailable', '', 'COMPUTED', 'computing'])(
    "status %j is NOT recommendable",
    (status) => {
      expect(isRecommendableOption({ status })).toBe(false);
    },
  );

  it('a non-string status is not recommendable', () => {
    // Defensive: these records come off a passthrough envelope, so `status`
    // can be any JSON value. Only `undefined` (absent) is the legacy escape.
    expect(isRecommendableOption({ status: null })).toBe(false);
    expect(isRecommendableOption({ status: 1 })).toBe(false);
    expect(isRecommendableOption({ status: { kind: 'computed' } })).toBe(false);
  });
});

describe('recommendable-option — fail-loud contract pin', () => {
  it("'computed' is still a member of the pinned EnrichmentFeatureStatus vocabulary", () => {
    // Fail-loud pin, not a hand-maintained mirror: if @talchain/schemas ever
    // renames or drops the literal, this throws with a named message instead
    // of leaving the crowning gate silently matching nothing.
    expect(() => assertComputedStatusLiteralPinned()).not.toThrow();
    expect(COMPUTED_OPTION_STATUS).toBe('computed');
  });
});
