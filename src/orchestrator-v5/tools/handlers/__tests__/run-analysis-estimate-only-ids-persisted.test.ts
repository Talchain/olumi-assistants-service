/**
 * ⭐ RULING 4 — THE PERSISTED CAUSE (DL #70 5854470460, AIQ meaning 5854466559; schemas 0.60.0
 * `constraint_verdict.estimate_only_constraint_ids`). RED-first through the real `run_analysis` handler.
 *
 * THE GAP: rule (d) of `deriveConstraintVerdict` (the leading option SETS a limit's target at a level that earns no
 * authorship credit) withholds the verdict as `unevaluated` — the same state as a limit that was genuinely not scored.
 * `collectLeaderEstimatedTargetIds` computes the set at run time from the options PLoT received, and it was only
 * LOGGED, so no reader could tell the two apart, and the card had to say "could not be checked" for both.
 *
 * THE RULE: the persisted verdict carries the ids withheld ONLY by rule (d) — scored, decision-grade, scored for the
 * leader, and set by the leader at a non-credited level. The same PLoT body (verbatim C50 U2) and graph as
 * `run-analysis-limit-on-olumi-estimate.test.ts`; the only difference between rows is WHOSE level the leader sets.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  createRunAnalysisHandler,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { deriveConstraintVerdict, projectClaimSafety, readRatifiedConstraints } from '../../../../orchestrator/context/constraint-feasibility.js';

type Rec = Record<string, unknown>;
const U2 = readFileSync('tests/fixtures/cross-service/c50-level-demo/U2.plot-response.json', 'utf8');
const SCENARIO_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const REQUEST_ID = 'req-estimate-only-ids';
const LIMIT = {
  constraint_id: 'gc_u2', node_id: 'fac_churn', operator: '<=', value: 10, unit: '%', value_frame: 'level',
  label: 'Monthly churn', provenance: 'explicit',
};

function graphWith(leaderChurn: Rec | undefined): Rec {
  return {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'MRR' },
      { id: 'fac_price', kind: 'factor', label: 'Pro plan price' },
      { id: 'fac_churn', kind: 'factor', label: 'Monthly churn', observed_state: { value: 0.04, raw_value: 4, cap: 100, unit: '%' } },
      { id: 'opt_hold', kind: 'option', label: 'Keep £49', interventions: { fac_price: { value: 0.49, source: 'user_specified' } } },
      {
        id: 'opt_raise', kind: 'option', label: '£59 with win-back',
        interventions: { fac_price: { value: 0.59, source: 'user_specified' }, ...(leaderChurn === undefined ? {} : { fac_churn: leaderChurn }) },
      },
    ],
    edges: [
      { from: 'fac_price', to: 'goal', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'fac_churn', to: 'goal', strength: { mean: -0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' },
    ],
    goal_constraints: [LIMIT],
  };
}

function invocation(): HandlerInvocation {
  return {
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }], session_id: SCENARIO_ID, request_id: REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [],
      scenarioBriefText: null, persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({ scenario_id: SCENARIO_ID, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: REQUEST_ID,
    signal: new AbortController().signal,
    orientationText: '',
  } as HandlerInvocation;
}

async function persisted(leaderChurn: Rec | undefined): Promise<Rec> {
  const graph = graphWith(leaderChurn);
  const snapshot = {
    graph,
    options: [
      { id: 'opt_hold', option_id: 'opt_hold', label: 'Keep £49', interventions: { fac_price: 0.49 } },
      {
        id: 'opt_raise', option_id: 'opt_raise', label: '£59 with win-back',
        interventions: { fac_price: 0.59, ...(leaderChurn === undefined ? {} : { fac_churn: leaderChurn.value as number }) },
      },
    ],
    goal_node_id: 'goal', goal_constraints: [LIMIT], rawPersistedGraph: graph,
  } as unknown as RunAnalysisScenarioSnapshot;
  const scenarioReader: ScenarioReader = vi.fn(() => Promise.resolve(snapshot));
  const run = vi.fn(() => Promise.resolve(JSON.parse(U2) as V2RunResponseEnvelope));
  const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  const outcome = await createRunAnalysisHandler({ plotClient, scenarioReader })(invocation());
  const fact = outcome.handler_facts[0]!;
  if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
  const v = fact.result.constraint_verdict as Rec | undefined;
  if (v === undefined) throw new Error('no constraint_verdict on the fact');
  return v;
}

describe('the persisted verdict records WHICH withheld limits rest only on an assumed level (rule (d))', () => {
  it("RED: the leader sets churn at Olumi's draft (cee_hypothesis) → estimate_only_constraint_ids = ['gc_u2']", async () => {
    const v = await persisted({ value: 0.03, raw_value: 3, source: 'cee_hypothesis' });
    expect(v.constraint_verdict_state).toBe('unevaluated');
    expect(v.estimate_only_constraint_ids).toEqual(['gc_u2']);
  });

  it("RED: a level the user ADOPTED (user_confirmed → user_ratified, no authorship credit) is in the set too", async () => {
    const v = await persisted({ value: 0.03, raw_value: 3, source: 'user_confirmed' });
    expect(v.constraint_verdict_state).toBe('unevaluated');
    expect(v.estimate_only_constraint_ids).toEqual(['gc_u2']);
  });

  it("CONTROL: the leader sets churn at the USER's own stated figure → a real check, recorded as [] (not absent)", async () => {
    const v = await persisted({ value: 0.03, raw_value: 3, source: 'user_specified' });
    expect(v.constraint_verdict_state).toBe('evaluated_feasible');
    expect(v.estimate_only_constraint_ids).toEqual([]);
  });

  it('CONTROL: the leader does not set churn → recorded as []', async () => {
    expect((await persisted(undefined)).estimate_only_constraint_ids).toEqual([]);
  });

  it('CONTRAST ("ONLY"): a limit that is ALSO genuinely unscored (a) is never estimate-only, even when (d) holds too', () => {
    const ratified = readRatifiedConstraints(graphWith({ value: 0.03, source: 'cee_hypothesis' }));
    // An envelope with no constraint scores at all: the limit is withheld by (a) — nothing was checked.
    const v = deriveConstraintVerdict({} as Record<string, unknown>, ratified, 'opt_raise', undefined, new Set(['gc_u2']));
    expect(v.state).toBe('unevaluated');
    expect(projectClaimSafety(v, { estimateOnlyRecorded: true }).estimate_only_constraint_ids).toEqual([]);
  });

  it('a caller that did not supply the rule-(d) set leaves the member ABSENT ("not recorded"), never []', () => {
    const v = deriveConstraintVerdict({} as Record<string, unknown>, readRatifiedConstraints(graphWith(undefined)), null);
    expect('estimate_only_constraint_ids' in projectClaimSafety(v)).toBe(false);
  });
});
