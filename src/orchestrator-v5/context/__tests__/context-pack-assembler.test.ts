/**
 * Context Pack Assembler — unit tests.
 *
 * Floor per brief §4 D2: 10 tests. This suite covers the nine required items
 * plus graph-passthrough field-by-field equivalence and handler-scan of full
 * prior_turns (not just the five-turn window).
 */

import { describe, expect, it, vi } from 'vitest';

import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';
import type { SessionTurn } from '@talchain/schemas/orchestrator';

import { log } from '../../../utils/telemetry.js';

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
  const margin = overrides.margin ?? 0.44;
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
    margin,
    margin_pp: overrides.margin_pp ?? (margin === null ? null : Math.round(margin * 1000) / 10),
    analysis_status: overrides.analysis_status ?? 'complete',
  };
}

describe('assembleContextPack', () => {
  it('emits version "2.0" and stage passthrough for a minimal valid request', () => {
    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [] });

    expect(pack.version).toBe(CONTEXT_PACK_VERSION);
    expect(pack.version).toBe('2.0');
    expect(pack.stage).toBe('frame');
    expect(pack.coaching).toEqual({
      draft_coaching: null,
      decision_review: null,
      last_coaching_signal: null,
    });
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
    expect(pack.analysis?.leading_option).toEqual({ label: 'Expand EU', probability: 0.72 });
    expect(pack.analysis?.runner_up).toEqual({ label: 'Stay domestic', probability: 0.28 });
    expect(pack.analysis?.margin_pp).toBeCloseTo(44, 1);
    expect(pack.analysis?.robustness_band).toBe('moderate');
    expect(pack.analysis?.top_drivers).toEqual([
      // sensitivity 0.41, direction 'negative' → signed sensitivity_value = -0.41
      { factor_label: 'Customer Churn', sensitivity_value: -0.41 },
    ]);
    expect(pack.analysis?.fragile_edges).toEqual(['Marketing Spend → New Leads']);
    // V5 state-trust: staleness_reason removed from the prompt-visible
    // ContextPackAnalysis. The field MUST NOT be present on the
    // projection at all (not "present and null") so Sonnet's context
    // doesn't carry the legacy fallback semantic.
    expect('staleness_reason' in (pack.analysis as object)).toBe(false);
  });

  it('returns null analysis when the caller passes null explicitly', () => {
    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [], analysis: null });
    expect(pack.analysis).toBeNull();
  });

  // brief brief-display-safe-analysis A2 — display_analysis projection
  it('emits a display-safe analysis projection with no raw floats alongside the raw analysis', () => {
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [],
      analysis: makeAnalysis(),
    });

    // Raw projection still present for handler-side reads (signals, chips,
    // explanation fallbacks).
    expect(pack.analysis?.leading_option).toEqual({ label: 'Expand EU', probability: 0.72 });

    // Display-safe projection — what Sonnet sees after buildUserMessage
    // strips the raw projection.
    expect(pack.display_analysis).not.toBeNull();
    expect(pack.display_analysis?.leading_option).toEqual({
      label: 'Expand EU',
      win_probability: '72%',
    });
    expect(pack.display_analysis?.runner_up).toEqual({
      label: 'Stay domestic',
      win_probability: '28%',
    });
    expect(pack.display_analysis?.margin).toBe('44 percentage points');
    expect(pack.display_analysis?.robustness_band).toBe('moderate');
    expect(pack.display_analysis?.top_drivers).toEqual([
      { label: 'Customer Churn', influence: 'moderate negative influence' },
    ]);
    expect(pack.display_analysis?.fragile_edges).toEqual([
      { from_label: 'Marketing Spend', to_label: 'New Leads' },
    ]);

    // Boundary invariant: serialised display_analysis contains no raw decimal floats.
    const serialised = JSON.stringify(pack.display_analysis);
    expect(serialised).not.toMatch(/\b0\.\d{2,}/);
    expect(serialised).not.toContain('sensitivity_value');
    expect(serialised).not.toContain('strength');
  });

  it('display_analysis is null when raw analysis is null', () => {
    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [], analysis: null });
    expect(pack.display_analysis).toBeNull();
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

  it('derives graph.options from option-kind nodes when persisted graph has no explicit options[]', () => {
    const graph: GraphWithOptions = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Ship on time' },
        { id: 'opt_launch_now', kind: 'option', label: 'Launch now' },
        { id: 'opt_delay', kind: 'option', label: 'Delay' },
      ],
      edges: [],
    };

    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [], graph });

    expect(pack.graph.counts.options).toBe(2);
    expect(pack.graph.options).toEqual([
      { id: 'opt_launch_now', label: 'Launch now' },
      { id: 'opt_delay', label: 'Delay' },
    ]);
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

  it('coaching defaults to empty cache when caller supplies nothing (Group 1: shape replaces Phase 1a null stub)', () => {
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [makeSessionTurn({ turn_class: 'handler', handler_id: 'run_analysis' })],
      analysis: makeAnalysis(),
    });

    expect(pack.coaching).toEqual({
      draft_coaching: null,
      decision_review: null,
      last_coaching_signal: null,
    });
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

describe('projectAnalysis — enriched projection', () => {
  it('caps top_drivers at 3 and sorts by absolute magnitude descending', () => {
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [],
      analysis: makeAnalysis({
        top_drivers: [
          { factor_id: 'f1', factor_label: 'Small +', sensitivity: 0.05, direction: 'positive' },
          { factor_id: 'f2', factor_label: 'Big −',  sensitivity: 0.80, direction: 'negative' },
          { factor_id: 'f3', factor_label: 'Med +',  sensitivity: 0.40, direction: 'positive' },
          { factor_id: 'f4', factor_label: 'Big +',  sensitivity: 0.60, direction: 'positive' },
          { factor_id: 'f5', factor_label: 'Tiny −', sensitivity: 0.01, direction: 'negative' },
        ],
      }),
    });
    expect(pack.analysis?.top_drivers).toEqual([
      { factor_label: 'Big −', sensitivity_value: -0.80 },
      { factor_label: 'Big +', sensitivity_value: 0.60 },
      { factor_label: 'Med +', sensitivity_value: 0.40 },
    ]);
  });

  it('returns empty top_drivers when none supplied', () => {
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [],
      analysis: makeAnalysis({ top_drivers: [] }),
    });
    expect(pack.analysis?.top_drivers).toEqual([]);
    expect(pack.analysis?.leading_option).not.toBeNull();
    expect(pack.analysis?.runner_up).not.toBeNull();
  });

  it('runner_up and margin_pp are null when only one option present', () => {
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [],
      analysis: makeAnalysis({
        winner: { option_id: 'opt-a', option_label: 'Solo', win_probability: 0.9 },
        options: [
          { option_id: 'opt-a', option_label: 'Solo', win_probability: 0.9, outcome_mean: 100 },
        ],
        margin: null,
      }),
    });
    expect(pack.analysis?.leading_option).toEqual({ label: 'Solo', probability: 0.9 });
    expect(pack.analysis?.runner_up).toBeNull();
    expect(pack.analysis?.margin_pp).toBeNull();
  });

  it('excludes top_drivers entries with non-finite sensitivity (NaN, Infinity)', () => {
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [],
      analysis: makeAnalysis({
        top_drivers: [
          { factor_id: 'f1', factor_label: 'Good',     sensitivity: 0.30, direction: 'positive' },
          { factor_id: 'f2', factor_label: 'NaN-y',    sensitivity: Number.NaN, direction: 'positive' },
          { factor_id: 'f3', factor_label: 'Inf-y',    sensitivity: Number.POSITIVE_INFINITY, direction: 'negative' },
          { factor_id: 'f4', factor_label: 'NegInf-y', sensitivity: Number.NEGATIVE_INFINITY, direction: 'negative' },
          { factor_id: 'f5', factor_label: 'Stronger', sensitivity: 0.50, direction: 'positive' },
        ],
      }),
    });
    expect(pack.analysis?.top_drivers).toEqual([
      { factor_label: 'Stronger', sensitivity_value: 0.5 },
      { factor_label: 'Good',     sensitivity_value: 0.3 },
    ]);
  });

  it('handles a probability tie — both options surfaced, margin_pp === 0', () => {
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [],
      analysis: makeAnalysis({
        options: [
          { option_id: 'opt-a', option_label: 'A', win_probability: 0.5, outcome_mean: 100 },
          { option_id: 'opt-b', option_label: 'B', win_probability: 0.5, outcome_mean: 90 },
        ],
        margin: 0,
      }),
    });
    expect(pack.analysis?.leading_option?.probability).toBe(0.5);
    expect(pack.analysis?.runner_up?.probability).toBe(0.5);
    expect(pack.analysis?.margin_pp).toBe(0);
  });

  it('robustness_band is null when source is "unknown" (no fabrication)', () => {
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [],
      analysis: makeAnalysis({ robustness_level: 'unknown' }),
    });
    expect(pack.analysis?.robustness_band).toBeNull();
  });

  it('scale guard: option with win_probability > 1 is excluded; remaining options project normally', () => {
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [],
      analysis: makeAnalysis({
        options: [
          // Bad upstream value (e.g. someone returned a 0–100 percentage)
          { option_id: 'opt-bad', option_label: 'Bad',  win_probability: 1.5, outcome_mean: 100 },
          { option_id: 'opt-a',   option_label: 'GoodA', win_probability: 0.6, outcome_mean: 100 },
          { option_id: 'opt-b',   option_label: 'GoodB', win_probability: 0.4, outcome_mean: 90 },
        ],
      }),
    });
    expect(pack.analysis?.leading_option).toEqual({ label: 'GoodA', probability: 0.6 });
    expect(pack.analysis?.runner_up).toEqual({ label: 'GoodB', probability: 0.4 });
  });

  it('scale guard: option with NaN probability is excluded', () => {
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [],
      analysis: makeAnalysis({
        options: [
          { option_id: 'opt-nan', option_label: 'Nan',   win_probability: Number.NaN, outcome_mean: 100 },
          { option_id: 'opt-a',   option_label: 'GoodA', win_probability: 0.7,        outcome_mean: 100 },
          { option_id: 'opt-b',   option_label: 'GoodB', win_probability: 0.3,        outcome_mean: 90 },
        ],
      }),
    });
    expect(pack.analysis?.leading_option?.label).toBe('GoodA');
    expect(pack.analysis?.runner_up?.label).toBe('GoodB');
  });

  it('all projected probabilities lie in [0, 1]', () => {
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [],
      analysis: makeAnalysis(),
    });
    const probs = [
      pack.analysis?.leading_option?.probability,
      pack.analysis?.runner_up?.probability,
    ].filter((p): p is number => typeof p === 'number');
    expect(probs.length).toBeGreaterThan(0);
    for (const p of probs) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('analysis section stays under 800 chars for a realistic 4-option, 3-driver run', () => {
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [],
      analysis: makeAnalysis({
        winner: { option_id: 'opt-launch', option_label: 'Launch Now', win_probability: 0.62 },
        options: [
          { option_id: 'opt-launch', option_label: 'Launch Now',     win_probability: 0.62, outcome_mean: 1500000, outcome_p10: 1200000, outcome_p90: 1800000 },
          { option_id: 'opt-wait',   option_label: 'Wait One Quarter', win_probability: 0.21, outcome_mean: 1100000, outcome_p10: 900000,  outcome_p90: 1300000 },
          { option_id: 'opt-pivot',  option_label: 'Pivot Strategy',  win_probability: 0.12, outcome_mean: 800000,  outcome_p10: 500000,  outcome_p90: 1100000 },
          { option_id: 'opt-defer',  option_label: 'Defer Decision',  win_probability: 0.05, outcome_mean: 600000,  outcome_p10: 400000,  outcome_p90: 800000 },
        ],
        top_drivers: [
          { factor_id: 'fac-marketing-spend',     factor_label: 'Marketing Spend Allocation',         sensitivity: 0.45, direction: 'positive' },
          { factor_id: 'fac-engineering-cap',     factor_label: 'Engineering Capacity Constraints',   sensitivity: 0.32, direction: 'negative' },
          { factor_id: 'fac-customer-acquisition', factor_label: 'Customer Acquisition Cost Trend',    sensitivity: 0.21, direction: 'negative' },
        ],
        top_fragile_edges: [
          { from_label: 'Marketing Spend Allocation', to_label: 'New Leads Generated' },
          { from_label: 'Engineering Capacity', to_label: 'Time to Market' },
        ],
        margin: 0.41,
      }),
      analysisStalenessReason: null,
    });
    const chars = JSON.stringify(pack.analysis ?? {}).length;
    expect(chars).toBeLessThan(800);
  });

  it('scale guard: degradation log fires when the dropped option would have been the leader', () => {
    // Source order has the bad option at win_probability 1.5 — the highest
    // raw value, so it would have been the leader without the scale guard.
    // Assert the log fires with the offending value AND that the runner-up
    // promotes silently to leading_option (no exception, no error).
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    try {
      const pack = assembleContextPack({
        payload: BASE_PAYLOAD,
        priorTurns: [],
        analysis: makeAnalysis({
          options: [
            // Highest raw value — the would-be leader. Out-of-scale → drop.
            { option_id: 'opt-bad',  option_label: 'OutOfScale', win_probability: 1.5, outcome_mean: 100 },
            { option_id: 'opt-good', option_label: 'PromotedA',  win_probability: 0.6, outcome_mean: 90 },
            { option_id: 'opt-c',    option_label: 'PromotedB',  win_probability: 0.4, outcome_mean: 80 },
          ],
        }),
      });
      // Runner-up promoted silently (no exception).
      expect(pack.analysis?.leading_option).toEqual({ label: 'PromotedA', probability: 0.6 });
      expect(pack.analysis?.runner_up).toEqual({ label: 'PromotedB', probability: 0.4 });

      // Telemetry contract: at least one warn carrying the dropped option's
      // label and the offending value.
      const matchingCalls = warnSpy.mock.calls.filter((call) => {
        const payload = call[0] as Record<string, unknown> | undefined;
        return (
          payload != null &&
          payload.event === 'analysis_projection_invalid_probability' &&
          payload.option_label === 'OutOfScale' &&
          payload.value === 1.5
        );
      });
      expect(matchingCalls.length).toBeGreaterThan(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('no-leak: analysis projection contains none of the raw enrichment keys', () => {
    // If a future refactor accidentally passes the raw fact / enrichment into
    // the projection instead of the AnalysisResponseSummary, the ~97KB
    // payload would leak into the prompt. This test guards against that.
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [],
      analysis: makeAnalysis(),
    });
    const json = JSON.stringify(pack.analysis ?? {});
    for (const banned of ['results', 'edge_sensitivity', 'review_cards', 'm1_coaching', 'enrichment']) {
      expect(json).not.toContain(banned);
    }
  });
});
