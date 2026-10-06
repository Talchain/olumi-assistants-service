// ============================================================================
// 0.79 (SD-1 Slice R on the agent lane; DL ruling #87, option A): a `run_delivery` fact in the PRIOR FACTS changes
// nothing any prior-facts consumer selects.
//
// The unfiltered prior-facts read (`readFactsWithTurnFor` / `readFactsFor`, every turn's `prior_facts` and the reload's
// hot window) returns every fact on the window's turns. On 0.79 it admits `run_delivery` (the agent's answer row records
// one after the Run). The fact is a record of what was SHOWN, never an analysis, a mutation or a claim, so every
// selector below must read the window exactly as if it were absent. Differential rows: the same window with and
// without the delivery, newest-first as the store returns it, plus a non-vacuity control on each selection.
// ============================================================================
import { describe, expect, it } from 'vitest';
import { maximalRunDeliveredRecord } from '@talchain/schemas/fixtures';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import {
  deriveAnalysisFreshness,
  selectClaimBearingRunAnalysisFact,
  selectRunAnalysisFact,
} from '../freshness.js';
import { projectRecentChanges } from '../recent-changes.js';
import { selectTwoNewestRunAnalysisFacts } from '../../coaching/compare-runs.js';

const SCENARIO_ID = '11111111-1111-4111-8111-111111111111';
const HASH = 'aaaaaaaaaaaaaaaa';

function run(runId: string, computedAt: string): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      run_id: runId,
      leading_option_id: 'opt_a',
      summary: 'Option A leads.',
      win_probabilities: { opt_a: 0.64, opt_b: 0.36 },
      graph_hash_at_run: HASH,
      computed_at: computedAt,
    },
  };
}

const delivery = {
  fact_type: 'run_delivery',
  fact_version: 1,
  noop: false,
  result: { run_id: 'run_b', record: { ...maximalRunDeliveredRecord, run_id: 'run_b' } },
} as unknown as HandlerFact;

const constraint = {
  fact_type: 'add_constraint',
  fact_version: 1,
  noop: false,
  result: {
    target_id: 'c1', status: 'applied', before: null,
    after: { constraint_id: 'c1', node_id: 'goal-g', operator: '<=', value: 100 },
  },
} as unknown as HandlerFact;

// Newest first, as the store returns the window: the answer row's delivery, then Run B, a mutation, then Run A.
const without: readonly HandlerFact[] = [run('run_b', '2026-10-06T06:00:00.000Z'), constraint, run('run_a', '2026-10-06T05:00:00.000Z')];
const withDelivery: readonly HandlerFact[] = [delivery, ...without];

describe('0.79 · a run_delivery in prior_facts changes no selection', () => {
  it('the newest Run selection is the same Run (CONTROL: it selects Run B)', () => {
    expect(selectRunAnalysisFact(without)?.fact).toBe(without[0]);
    expect(selectRunAnalysisFact(withDelivery)?.fact).toBe(without[0]);
  });

  it('the claim-bearing Run is the same Run', () => {
    expect(selectClaimBearingRunAnalysisFact(without)?.fact).toBe(without[0]);
    expect(selectClaimBearingRunAnalysisFact(withDelivery)?.fact).toBe(without[0]);
  });

  it('the run_delta pair is the same pair (CONTROL: B over A)', () => {
    const pair = selectTwoNewestRunAnalysisFacts(withDelivery);
    expect(pair?.current).toBe(without[0]);
    expect(pair?.prior).toBe(without[2]);
    expect(pair).toStrictEqual(selectTwoNewestRunAnalysisFacts(without));
  });

  it('freshness reads the same verdict on the same Run (CONTROL: fresh on the Run\'s own graph)', () => {
    const verdict = deriveAnalysisFreshness(withDelivery, HASH);
    const base = deriveAnalysisFreshness(without, HASH);
    expect(verdict.freshness).toBe('fresh');
    // `selected_fact_index` is a position in the array it was given, so it moves with any fact ahead of the Run (a
    // mutation would move it too). The invariant is that it names the SAME Run.
    expect(withDelivery[verdict.selected_fact_index!]).toBe(without[0]);
    expect(without[base.selected_fact_index!]).toBe(without[0]);
    const { selected_fact_index: _a, ...rest } = verdict;
    const { selected_fact_index: _b, ...baseRest } = base;
    expect(rest).toStrictEqual(baseRest);
  });

  it('the model-facing recent changes are the same mutations — a delivery is never a change (CONTROL: one change)', () => {
    const changes = projectRecentChanges(withDelivery);
    expect(changes).toHaveLength(1);
    expect(changes).toStrictEqual(projectRecentChanges(without));
  });
});
