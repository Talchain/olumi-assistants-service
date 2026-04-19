/**
 * Context Pack Assembler — unit tests.
 *
 * Floor per brief §4 D2: 10 tests. This suite covers the nine required items
 * plus graph-passthrough field-by-field equivalence and handler-scan of full
 * prior_turns (not just the five-turn window).
 */

import { describe, expect, it } from 'vitest';

import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';
import type { SessionTurn } from '@talchain/schemas/orchestrator';

import type { AnalysisResponseSummary } from '../../../orchestrator/context/analysis-compact.js';
import {
  assembleContextPack,
  CONTEXT_PACK_RECENT_TURNS_CAP,
  CONTEXT_PACK_VERSION,
  type GraphWithOptions,
} from '../context-pack-assembler.js';

const BASE_PAYLOAD: OrchestratorTurnPayload = Object.freeze({
  turn_id: 't-001',
  scenario_id: 'scen-abc',
  message: 'What should I do?',
  turn_class: 'frame',
  stage: 'frame',
});

function makeSessionTurn(overrides: Partial<SessionTurn> = {}): SessionTurn {
  return {
    id: overrides.id ?? 'row-1',
    scenario_id: overrides.scenario_id ?? 'scen-abc',
    user_id: overrides.user_id ?? 'user-1',
    turn_id: overrides.turn_id ?? 't-prev-1',
    turn_class: overrides.turn_class ?? 'direct_answer',
    handler_id: overrides.handler_id ?? null,
    request_hash: overrides.request_hash ?? 'hash-1',
    response_emitted: overrides.response_emitted ?? true,
    llm_calls_used: overrides.llm_calls_used ?? 1,
    duration_ms: overrides.duration_ms ?? 250,
    created_at: overrides.created_at ?? '2026-04-18T23:00:00.000Z',
  };
}

function makeAnalysis(overrides: Partial<AnalysisResponseSummary> = {}): AnalysisResponseSummary {
  return {
    winner: overrides.winner ?? { option_id: 'opt-a', option_label: 'Expand EU', win_probability: 0.72 },
    options: overrides.options ?? [
      { option_id: 'opt-a', option_label: 'Expand EU', win_probability: 0.72, outcome_mean: 120000 },
      { option_id: 'opt-b', option_label: 'Stay domestic', win_probability: 0.28, outcome_mean: 80000 },
    ],
    top_drivers: overrides.top_drivers ?? [
      { factor_id: 'f-churn', factor_label: 'Customer Churn', sensitivity: 0.41, direction: 'negative' },
    ],
    robustness_level: overrides.robustness_level ?? 'moderate',
    fragile_edge_count: overrides.fragile_edge_count ?? 2,
    top_fragile_edges: overrides.top_fragile_edges ?? [
      { from_label: 'Marketing Spend', to_label: 'New Leads' },
    ],
    margin: overrides.margin ?? 0.44,
    analysis_status: overrides.analysis_status ?? 'complete',
  };
}

describe('assembleContextPack', () => {
  it('emits version "2.0" and stage passthrough for a minimal valid request', () => {
    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [] });

    expect(pack.version).toBe(CONTEXT_PACK_VERSION);
    expect(pack.version).toBe('2.0');
    expect(pack.stage).toBe('frame');
    expect(pack.coaching).toBeNull();
    expect(pack.compound_detected).toBe(false);
    expect(pack.system_event).toBeNull();
  });

  it('renders empty graph + null analysis when nothing is supplied', () => {
    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [] });

    expect(pack.graph.counts.nodes).toBe(0);
    expect(pack.graph.counts.edges).toBe(0);
    expect(pack.graph.counts.options).toBe(0);
    expect(pack.graph.counts.goals).toBe(0);
    expect(pack.graph.counts.constraints).toBe(0);
    expect(pack.analysis).toBeNull();
    expect(pack.conversation.recent_turns).toEqual([]);
    expect(pack.conversation.turn_count).toBe(0);
    expect(pack.conversation.last_tool_used).toBeNull();
    expect(pack.conversation.pending_confirmation).toBe(false);
  });

  it('projects analysis summary into compact ContextPack fields when supplied', () => {
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [],
      analysis: makeAnalysis(),
    });

    expect(pack.analysis).not.toBeNull();
    expect(pack.analysis?.status).toBe('complete');
    expect(pack.analysis?.leading_option).toBe('Expand EU');
    expect(pack.analysis?.runner_up).toBe('Stay domestic');
    expect(pack.analysis?.robustness_band).toBe('moderate');
    expect(pack.analysis?.top_drivers).toEqual(['Customer Churn']);
    expect(pack.analysis?.fragile_edges).toEqual(['Marketing Spend → New Leads']);
    expect(pack.analysis?.staleness_reason).toBeNull();
  });

  it('returns null analysis when the caller passes null explicitly', () => {
    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [], analysis: null });
    expect(pack.analysis).toBeNull();
  });

  it('graph counts match the sizes of nodes / edges / options / goals / constraints arrays', () => {
    const nodes = [
      { id: 'n-goal', kind: 'goal', label: 'Maximise NPV' },
      { id: 'n-factor', kind: 'factor', label: 'Cost' },
      { id: 'n-option-a', kind: 'option', label: 'Launch Now' },
    ];
    const edges = [{ from: 'n-factor', to: 'n-goal' }];
    const graph: GraphWithOptions = {
      nodes: nodes as unknown as GraphWithOptions['nodes'],
      edges: edges as unknown as GraphWithOptions['edges'],
      options: [{ id: 'opt-a' }, { id: 'opt-b' }],
      goal_constraints: [{ id: 'c-1' }],
    };

    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [], graph });

    expect(pack.graph.counts.nodes).toBe(3);
    expect(pack.graph.counts.edges).toBe(1);
    expect(pack.graph.counts.options).toBe(2);
    expect(pack.graph.counts.goals).toBe(1);
    expect(pack.graph.counts.constraints).toBe(1);
  });

  it('conversation is capped at CONTEXT_PACK_RECENT_TURNS_CAP (5)', () => {
    const priorTurns = Array.from({ length: 8 }, (_, idx) =>
      makeSessionTurn({ turn_id: `t-prev-${idx}`, created_at: `2026-04-18T23:${String(idx).padStart(2, '0')}:00.000Z` }),
    );

    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns });

    expect(pack.conversation.recent_turns.length).toBe(CONTEXT_PACK_RECENT_TURNS_CAP);
    expect(pack.conversation.turn_count).toBe(8);
  });

  it('last_tool_used picks the most-recent handler turn even beyond the five-turn window', () => {
    // Handler turn is sixth in prior_turns (index 5) — outside the five-turn
    // window — but it is still the only handler turn and must surface.
    const priorTurns: SessionTurn[] = [
      makeSessionTurn({ turn_id: 't-1', turn_class: 'direct_answer' }),
      makeSessionTurn({ turn_id: 't-2', turn_class: 'direct_answer' }),
      makeSessionTurn({ turn_id: 't-3', turn_class: 'clarify' }),
      makeSessionTurn({ turn_id: 't-4', turn_class: 'direct_answer' }),
      makeSessionTurn({ turn_id: 't-5', turn_class: 'direct_answer' }),
      makeSessionTurn({ turn_id: 't-6', turn_class: 'handler', handler_id: 'run_analysis' }),
    ];

    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns });

    expect(pack.conversation.recent_turns.length).toBe(5);
    expect(pack.conversation.last_tool_used).toBe('run_analysis');
  });

  it('coaching is null (Phase 1a stub — preserved across all inputs)', () => {
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [makeSessionTurn({ turn_class: 'handler', handler_id: 'run_analysis' })],
      analysis: makeAnalysis(),
    });

    expect(pack.coaching).toBeNull();
    expect(pack.compound_detected).toBe(false);
  });

  it('system_event passes through verbatim', () => {
    const systemEvent = { kind: 'analysis_completed', run_id: 'run-xyz' };
    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [], systemEvent });
    expect(pack.system_event).toEqual(systemEvent);
    expect(pack.system_event).toBe(systemEvent);
  });

  it('graph is a pure passthrough — node and edge entries are the same references as input (F.6 contract)', () => {
    const nodeObj = { id: 'n-1', kind: 'factor', label: 'Cost', extra_llm_field: 'keep-me' };
    const edgeObj = { from: 'n-1', to: 'n-2', bespoke: 42 };
    const graph: GraphWithOptions = {
      nodes: [nodeObj] as unknown as GraphWithOptions['nodes'],
      edges: [edgeObj] as unknown as GraphWithOptions['edges'],
    };

    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [], graph });

    // F.6: passthrough — no transform of graph content
    expect(pack.graph.nodes[0]).toBe(nodeObj);
    expect(pack.graph.edges[0]).toBe(edgeObj);
    expect((pack.graph.nodes[0] as { extra_llm_field?: string }).extra_llm_field).toBe('keep-me');
    expect((pack.graph.edges[0] as { bespoke?: number }).bespoke).toBe(42);
  });

  it('pending_confirmation passes through when caller supplies it', () => {
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [],
      pendingConfirmation: true,
    });

    expect(pack.conversation.pending_confirmation).toBe(true);
  });
});
