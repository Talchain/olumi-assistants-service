/**
 * THE TURN PATH'S PERSISTED FRESHNESS READS THE RESTORE MARKER IT HAS ALREADY READ.
 *
 * Independent pre-review 5828601536 (source trace at served CEE 9417228):
 * `buildTurnContext` reads `analysis_invalidated_at` (the DB-stamped restore
 * marker) and returns it on the context, but the `coachingFreshness`
 * derivation it returns as `persisted_analysis_freshness` passes only
 * `priorFactsReadOk`. That derivation feeds `deriveCoachingState` and, through
 * `turn-claim-safety.ts`, the graphless exits (`clarify_v2` spreads
 * `claimSafety.forExit()` with `graph: null`), where a fresh derivation with a
 * run timestamp composes `complete_current`. The routed derivations in
 * `turn-executor.ts` DO pass the marker, and so does the reload
 * (`scenario-graph-analysis-read.ts`): one turn family disagrees with the
 * others over the same stored analysis.
 *
 * The case only a marker can decide: the run's `graph_hash_at_run` EQUALS the
 * stored graph's hash (restore A after A → analyse → B), and the marker is
 * newer than the run.
 *   RED      marker NEWER than the run → stale / model_restored_after_analysis;
 *   CONTROL  marker OLDER than the run → fresh (by time, not presence);
 *   CONTROL  no marker at all → fresh.
 */
import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { buildTurnContext, deriveDecisionContextGraphHash } from '../build-turn-context.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { makeMessagePayload } from './fixtures.js';

const SCENARIO = '55555555-5555-4555-8555-555555555555';
const PAYLOAD = makeMessagePayload({ scenario_id: SCENARIO, message: 'Where does the analysis stand?' });
const RUN_AT = '2026-09-25T09:00:00.000Z';
const BEFORE_RUN = '2026-09-25T08:00:00.000Z';
const AFTER_RUN = '2026-09-25T09:30:00.000Z';

const GRAPH = {
  goal_node_id: 'g-revenue',
  nodes: [
    { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
    { id: 'f-budget', kind: 'factor', label: 'Marketing budget', observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 } },
    { id: 'o-launch', kind: 'option', label: 'Launch now' },
  ],
  edges: [
    { from: 'f-budget', to: 'g-revenue', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
  ],
};
const STORED_HASH = deriveDecisionContextGraphHash(GRAPH)!;

function runFactAgainst(hash: string): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO,
      computed_at: RUN_AT,
      graph_hash_at_run: hash,
      leading_option_id: 'o-launch',
      summary: 'Launch now leads on the analysed model.',
      enrichment: { analysis_status: 'completed' },
    },
  } as HandlerFact;
}

function storeWith(marker: string | null) {
  const run = runFactAgainst(STORED_HASH);
  return {
    ...createNoopSessionStore({ loadGraphResult: GRAPH }),
    readScenarioRunAnalysisFactsFor: async () => ({
      facts: [{ fact: run, fact_row_id: 'row-run', fact_created_at: RUN_AT }],
      total_count: 1,
    }),
    readAnalysisInvalidatedAt: async () => marker,
  };
}

describe('buildTurnContext — persisted freshness reads the restore marker', () => {
  it('premise: the run was computed against exactly the stored graph (a hash MATCH)', async () => {
    expect(typeof STORED_HASH).toBe('string');
    const context = await buildTurnContext(PAYLOAD, 'req-premise', { sessionStore: storeWith(null) });
    expect(context.persisted_analysis_freshness.graph_hash_at_run).toBe(STORED_HASH);
    expect(context.persisted_analysis_freshness.current_graph_hash).toBe(STORED_HASH);
  });

  it('RED: marker NEWER than the run → stale / model_restored_after_analysis (as the reload and routed turns say)', async () => {
    const context = await buildTurnContext(PAYLOAD, 'req-restored', { sessionStore: storeWith(AFTER_RUN) });
    expect(context.analysis_invalidated_at, 'premise: the turn READ the marker').toBe(AFTER_RUN);
    expect(context.persisted_analysis_freshness).toMatchObject({
      freshness: 'stale',
      reason: 'model_restored_after_analysis',
    });
  });

  it('CONTROL: marker OLDER than the run → fresh (bound by time, not presence)', async () => {
    const context = await buildTurnContext(PAYLOAD, 'req-older', { sessionStore: storeWith(BEFORE_RUN) });
    expect(context.persisted_analysis_freshness.freshness).toBe('fresh');
  });

  it('CONTROL: no marker → fresh', async () => {
    const context = await buildTurnContext(PAYLOAD, 'req-none', { sessionStore: storeWith(null) });
    expect(context.persisted_analysis_freshness.freshness).toBe('fresh');
  });
});
