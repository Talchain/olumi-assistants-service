/**
 * Golden-Journey Harness v1 — A2 (AI-facing context completeness), in-process.
 *
 * The ContextPack / EnrichedTurnContext are internal — never serialised on
 * the wire — so A2 cannot be proven from a live response. This test proves
 * it in-process: seed an in-memory SessionStore, run `buildTurnContext` with
 * the store injected (zero Supabase / network), assemble the ContextPack,
 * and derive structural readiness, then assert all five required AI-facing
 * context elements are present and feed them through the real A2 classifier.
 *
 * Capabilities are asserted by PRESENCE only: `buildTurnContext` seeds them
 * all `false` and they are flipped on later in the pipeline — we do not
 * patch product to flip them here (dispatch guardrail: no product changes).
 */

import { describe, expect, it } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import { buildTurnContext } from '../../../src/orchestrator-v5/build-turn-context.js';
import { assembleContextPack } from '../../../src/orchestrator-v5/context/context-pack-assembler.js';
import { computeStructuralReadiness } from '../../../src/orchestrator/tools/analysis-ready-helper.js';
import type { GraphV3T } from '../../../src/schemas/cee-v3.js';
import type { AnalysisResponseSummary } from '../../../src/orchestrator/context/analysis-compact.js';

import { a2ContextCompleteness, type ContextSnapshot } from '../../../tools/golden-journey-harness/invariants.js';
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

const ANALYSIS_SUMMARY: AnalysisResponseSummary = {
  winner: { option_id: 'opt_hire', option_label: 'Hire two senior engineers', win_probability: 0.62 },
  options: [
    { option_id: 'opt_hire', option_label: 'Hire two senior engineers', win_probability: 0.62, outcome_mean: 0.7 },
    { option_id: 'opt_offshore', option_label: 'Engage an offshore partner', win_probability: 0.26, outcome_mean: 0.4 },
  ],
  top_drivers: [
    { factor_id: 'fac_budget', factor_label: 'Budget', sensitivity: 0.41, direction: 'positive' },
  ],
  robustness_level: 'medium',
  fragile_edge_count: 0,
  margin: 0.36,
  margin_pp: 36,
  analysis_status: 'completed',
} as unknown as AnalysisResponseSummary;

const PAYLOAD = {
  kind: 'message',
  turn_id: '22222222-2222-4222-8222-222222222222',
  scenario_id: SCENARIO_ID,
  stage: 'decide',
  message: 'Why does the leading option win?',
  turn_class: 'decide',
  source: 'composer',
} as unknown as MessageTurnPayload;

describe('A2 — AI-facing context completeness (in-process)', () => {
  it('buildTurnContext + assembleContextPack + structural readiness carry all five context elements', async () => {
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

    // 2) assembleContextPack — the LLM-facing projection.
    const pack = assembleContextPack({
      payload: PAYLOAD,
      priorTurns: ctx.prior_turns,
      priorFacts: ctx.prior_facts,
      graph: GRAPH,
      analysis: ANALYSIS_SUMMARY,
    });
    expect(pack.graph.counts.nodes).toBeGreaterThan(0); // graph
    expect(pack.analysis).not.toBeNull(); // analysis state
    expect(pack.conversation.recent_turns.length).toBe(2); // recent-turn state
    expect(Array.isArray(pack.recent_changes)).toBe(true);

    // 3) structural readiness — the blocker surface derived from the graph.
    const readiness = computeStructuralReadiness(GRAPH as unknown as GraphV3T);
    expect(readiness).toBeDefined();
    expect(typeof readiness!.status).toBe('string');

    // 4) feed the assembled completeness through the real A2 classifier.
    const snapshot: ContextSnapshot = {
      graph: pack.graph.counts.nodes > 0,
      analysis_state: pack.analysis !== null,
      blockers: readiness !== undefined,
      capabilities: ctx.capabilities !== undefined,
      recent_turn_state: pack.conversation.recent_turns.length > 0,
      source: 'in-process (buildTurnContext + assembleContextPack + computeStructuralReadiness)',
    };
    const findings = a2ContextCompleteness(snapshot);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.status).toBe('pass');
    expect(findings[0]!.component_primary).toBe('context_management');
  });
});
