/**
 * Golden-Journey Harness v1 — turn-context completeness, in-process.
 *
 * The EnrichedTurnContext is internal — never serialised on the wire — so it
 * cannot be proven from a live response. This test proves it in-process: seed
 * an in-memory SessionStore, run `buildTurnContext` with the store injected
 * (zero Supabase / network), derive structural readiness, and assert the
 * context elements are present. (The ContextPack arm and the A2 classifier
 * feed were removed with the deleted context-pack assembler; the classifier
 * keeps its own rows in `invariants.test.ts`.)
 *
 * Capabilities are asserted by PRESENCE only: `buildTurnContext` seeds them
 * all `false` and they are flipped on later in the pipeline — we do not
 * patch product to flip them here (dispatch guardrail: no product changes).
 */

import { describe, expect, it } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import { buildTurnContext } from '../../../src/orchestrator-v5/build-turn-context.js';
import { computeStructuralReadiness } from '../../../src/orchestrator/tools/analysis-ready-helper.js';
import type { GraphV3T } from '../../../src/schemas/cee-v3.js';

import { InMemorySessionStore } from './in-memory-session-store.js';

const SCENARIO_ID = '11111111-1111-4111-8111-111111111111';

// Minimal but structurally-real graph: a goal, two options (one configured,
// one not — so readiness has something to say), and a factor.
const GRAPH = {
  nodes: [
    { id: 'goal_delivery', kind: 'goal', label: 'Scale delivery for Q3' },
    { id: 'opt_hire', kind: 'option', label: 'Hire two senior engineers', data: { interventions: { fac_budget: 0.6 } } },
    { id: 'opt_offshore', kind: 'option', label: 'Engage an offshore partner' },
    { id: 'fac_budget', kind: 'factor', label: 'Budget' },
  ],
  edges: [
    { from: 'opt_hire', to: 'fac_budget' },
    { from: 'opt_offshore', to: 'fac_budget' },
    { from: 'fac_budget', to: 'goal_delivery' },
  ],
};

const PAYLOAD = {
  kind: 'message',
  turn_id: '22222222-2222-4222-8222-222222222222',
  scenario_id: SCENARIO_ID,
  stage: 'decide',
  message: 'Why does the leading option win?',
  turn_class: 'decide',
  source: 'composer',
} as unknown as MessageTurnPayload;

describe('turn-context completeness (in-process)', () => {
  it('buildTurnContext + structural readiness carry graph, capabilities, recent turns and the context spine', async () => {
    const store = new InMemorySessionStore({
      scenarioId: SCENARIO_ID,
      graph: GRAPH,
      briefText: 'Scaling delivery for Q3 — hire vs offshore vs tiered pricing.',
      turns: [
        { user_message: 'Help me decide how to scale delivery.', assistant_message: 'Here is a draft model with three options.' },
        { user_message: 'Run the analysis.', assistant_message: 'Hire two senior engineers leads at about 62%.' },
      ],
    });

    // 1) buildTurnContext with the store injected — no Supabase, no network.
    const ctx = await buildTurnContext(PAYLOAD, 'req-a2-test', { sessionStore: store });

    // current graph present
    expect(ctx.persistedGraph).toEqual(GRAPH);
    // capabilities object present (presence only — values are seeded false
    // in buildTurnContext and populated downstream; we do not patch product).
    expect(ctx.capabilities).toBeDefined();
    expect(ctx.capabilities).toHaveProperty('can_run_analysis');
    // recent-turn state present
    expect(ctx.prior_turns.length).toBe(2);
    // derived context spine present
    expect(ctx.decision_context).toBeDefined();
    expect(ctx.coaching_state).toBeDefined();

    // 2) structural readiness — the blocker surface derived from the graph.
    const readiness = computeStructuralReadiness(GRAPH as unknown as GraphV3T);
    expect(readiness).toBeDefined();
    expect(typeof readiness!.status).toBe('string');
  });
});
