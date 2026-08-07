/**
 * Context Pack Assembler — unit tests.
 *
 * Floor per brief §4 D2: 10 tests. This suite covers the nine required items
 * plus graph-passthrough field-by-field equivalence and handler-scan of full
 * prior_turns (not just the five-turn window).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Mock the env predicates the assembler reads. Other config exports remain
// real via the actual passthrough — only the gate's two helpers are
// programmable per-test. Defaults are reset in `beforeEach` below.
const { isProductionMock, isTestMock } = vi.hoisted(() => ({
  isProductionMock: vi.fn<() => boolean>(),
  isTestMock: vi.fn<() => boolean>(),
}));

vi.mock('../../../config/index.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../../config/index.js')>(
      '../../../config/index.js',
    );
  return {
    ...actual,
    isProduction: isProductionMock,
    isTest: isTestMock,
  };
});

import type { HandlerFact, SessionTurn } from '@talchain/schemas/orchestrator';

import { makeMessagePayload } from '../../__tests__/fixtures.js';

import { log } from '../../../utils/telemetry.js';
import { sha8 } from '../../../utils/logger-config.js';

import type { AnalysisResponseSummary } from '../../../orchestrator/context/analysis-compact.js';
import { buildAnalysisFromPriorFacts } from '../analysis-fallback.js';
import {
  assembleContextPack,
  filterLeverSourcedFragileEdges,
  CONTEXT_PACK_RECENT_TURNS_CAP,
  CONTEXT_PACK_VERSION,
  type GraphWithOptions,
} from '../context-pack-assembler.js';
import { ContextPackSchema } from '../context-pack-schema.js';

const BASE_PAYLOAD = Object.freeze(makeMessagePayload());

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
    expect(pack.analysis?.fragile_edges).toEqual([
      { from_label: 'Marketing Spend', to_label: 'New Leads' },
    ]);
    // V5 state-trust: staleness_reason removed from the prompt-visible
    // ContextPackAnalysis. The field MUST NOT be present on the
    // projection at all (not "present and null") so Sonnet's context
    // doesn't carry the legacy fallback semantic.
    expect('staleness_reason' in (pack.analysis as object)).toBe(false);
  });

  it('seam: TOP-LEVEL staging fragile edges flow through buildAnalysisFromPriorFacts into pack.analysis + display_analysis', () => {
    // Guards the derive -> ContextPack projection seam (NOT turn-executor
    // freshness or chip-click dispatch): buildAnalysisFromPriorFacts derives
    // top_fragile_edges from the real staging V2 shape
    // (robustness.fragile_edges at the envelope top level, `option_comparison`
    // not `results`, inline labels, no top-level graph), and
    // assembleContextPack projects them into BOTH the handler-facing `analysis`
    // (the deterministic advice gate reads this) and the LLM-facing
    // `display_analysis` (the routing prompt reads this).
    const stagingFact = {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: '00000000-0000-4000-8000-0000000000fe',
        leading_option_id: 'opt_hire_local',
        win_probabilities: { opt_hire_local: 0.763, opt_status_quo: 0.115 },
        summary: 'Prior run',
        enrichment: {
          meta: { seed_used: 7, n_samples: 1500, response_hash: 'h-seam' },
          option_comparison: [
            { option_id: 'opt_hire_local', option_label: 'Hire Two Senior Engineers Locally', win_probability: 0.763 },
            { option_id: 'opt_status_quo', option_label: 'Continue with Current Team (Status Quo)', win_probability: 0.115 },
          ],
          robustness: {
            level: 'moderate',
            fragile_edges: [
              { edge_id: 'out_delivery_capacity->goal_q3_delivery', from_id: 'out_delivery_capacity', to_id: 'goal_q3_delivery', from_label: 'Q3 Roadmap Delivery Capacity', to_label: 'Deliver Q3 Roadmap Commitments on Time and Within Budget', switch_probability: 0.228, severity: 'warning' },
              { edge_id: 'fac_local_hire->out_delivery_capacity', from_id: 'fac_local_hire', to_id: 'out_delivery_capacity', from_label: 'Local Senior Hire', to_label: 'Q3 Roadmap Delivery Capacity', switch_probability: 0.24, severity: 'warning' },
            ],
          },
          analysis_status: 'complete',
        },
      },
    } as unknown as HandlerFact;

    const summary = buildAnalysisFromPriorFacts([stagingFact]);
    expect(summary).not.toBeNull();
    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [], analysis: summary });
    // Highest switch_probability edge (0.24) leads — parity with m1_coaching.
    const topPair = { from_label: 'Local Senior Hire', to_label: 'Q3 Roadmap Delivery Capacity' };
    // Handler-facing slot — the deterministic advice gate reads this.
    expect(pack.analysis?.fragile_edges?.[0]).toEqual(topPair);
    // LLM-facing slot — the routing prompt reads this; same edge must surface.
    expect(pack.display_analysis?.fragile_edges?.[0]).toEqual(topPair);
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

  it('conversation is capped at CONTEXT_PACK_RECENT_TURNS_CAP (memory window)', () => {
    // Feed one MORE than the cap so the window slice is exercised regardless of
    // the cap value (derive-don't-mirror: the assertion reads the constant).
    const total = CONTEXT_PACK_RECENT_TURNS_CAP + 1;
    const priorTurns = Array.from({ length: total }, (_, idx) =>
      makeSessionTurn({ turn_id: `t-prev-${idx}`, created_at: `2026-04-18T23:${String(idx).padStart(2, '0')}:00.000Z` }),
    );

    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns });

    expect(pack.conversation.recent_turns.length).toBe(CONTEXT_PACK_RECENT_TURNS_CAP);
    expect(pack.conversation.turn_count).toBe(total);
  });

  it('D-59-11 — the verbatim memory window is 8 (RED at the old cap of 5)', () => {
    // Boundary pin for the 5→8 flip: exactly-window turns are ALL kept verbatim
    // (no window disclosure cut); window+1 keeps the cap and discloses one behind.
    expect(CONTEXT_PACK_RECENT_TURNS_CAP).toBe(8);
    const atWindow = Array.from({ length: 8 }, (_, idx) =>
      makeSessionTurn({ turn_id: `w-${idx}`, created_at: `2026-04-19T10:${String(idx).padStart(2, '0')}:00.000Z` }),
    );
    const packAt = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: atWindow });
    expect(packAt.conversation.recent_turns.length).toBe(8);

    const overWindow = Array.from({ length: 9 }, (_, idx) =>
      makeSessionTurn({ turn_id: `o-${idx}`, created_at: `2026-04-19T11:${String(idx).padStart(2, '0')}:00.000Z` }),
    );
    const packOver = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: overWindow });
    expect(packOver.conversation.recent_turns.length).toBe(8);
    expect(packOver.conversation.turn_count).toBe(9);
  });

  it('last_tool_used picks the most-recent handler turn even beyond the verbatim window', () => {
    // Handler turn sits at the LAST index (beyond the verbatim window) — derived
    // from the cap so it stays "beyond the window" whatever the cap is.
    const filler = Array.from({ length: CONTEXT_PACK_RECENT_TURNS_CAP }, (_, idx) =>
      makeSessionTurn({ turn_id: `t-${idx}`, turn_class: 'direct_answer' }),
    );
    const priorTurns: SessionTurn[] = [
      ...filler,
      makeSessionTurn({ turn_id: 't-handler', turn_class: 'handler', handler_id: 'run_analysis' }),
    ];

    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns });

    // The window keeps exactly the cap; the handler at the tail is OUTSIDE it…
    expect(pack.conversation.recent_turns.length).toBe(CONTEXT_PACK_RECENT_TURNS_CAP);
    // …yet last_tool_used scans all prior turns and still surfaces it.
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

  // V5 ContextPack §10 compliance — `scenario_id` projection.
  it('projects scenario_id from the payload onto the assembled pack', () => {
    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [] });
    expect(pack.scenario_id).toBe(BASE_PAYLOAD.scenario_id);
  });

  it('projects scenario_id verbatim for a different payload', () => {
    // Use a UUID-shaped value: `OrchestratorTurnPayloadSchema` enforces
    // `.uuid()` on `scenario_id` at runtime even though the Zod type
    // appears as `z.ZodString`.
    const pack = assembleContextPack({
      payload: { ...BASE_PAYLOAD, scenario_id: '00000000-0000-4000-8000-0000000000c5' },
      priorTurns: [],
    });
    expect(pack.scenario_id).toBe('00000000-0000-4000-8000-0000000000c5');
  });

  // Empty-array semantics for parsed_quantities — explicit `[]` not undefined.
  it('parsed_quantities is [] (not undefined) when message has no parseable quantities', () => {
    const pack = assembleContextPack({
      payload: { ...BASE_PAYLOAD, message: 'hello there how are you today' },
      priorTurns: [],
    });
    expect(pack.parsed_quantities).toBeDefined();
    expect(Array.isArray(pack.parsed_quantities)).toBe(true);
    expect(pack.parsed_quantities).toEqual([]);
  });

  // Empty-array semantics for recent_changes — explicit `[]` not undefined,
  // including when caller omits priorFacts entirely.
  it('recent_changes is [] (not undefined) when no prior facts are supplied', () => {
    const packNoFacts = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [] });
    expect(packNoFacts.recent_changes).toBeDefined();
    expect(Array.isArray(packNoFacts.recent_changes)).toBe(true);
    expect(packNoFacts.recent_changes).toEqual([]);

    const packEmptyFacts = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [],
      priorFacts: [],
    });
    expect(packEmptyFacts.recent_changes).toEqual([]);
  });
});

describe('ContextPackSchema (canonical contract)', () => {
  it('accepts a freshly-assembled minimal pack', () => {
    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [] });
    const result = ContextPackSchema.safeParse(pack);
    expect(result.success).toBe(true);
  });

  it('accepts a fully-populated pack with analysis, graph, and prior turns', () => {
    const graph: GraphWithOptions = {
      nodes: [
        { id: 'g-1', kind: 'goal', label: 'Maximise NPV' },
        { id: 'f-1', kind: 'factor', label: 'Cost' },
        { id: 'o-1', kind: 'option', label: 'Launch Now' },
      ] as unknown as GraphWithOptions['nodes'],
      edges: [{ from: 'f-1', to: 'g-1' }] as unknown as GraphWithOptions['edges'],
      options: [{ id: 'o-1' }],
      goal_constraints: [{ id: 'c-1' }],
    };
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [makeSessionTurn({ turn_class: 'handler', handler_id: 'run_analysis' })],
      analysis: makeAnalysis(),
      graph,
      systemEvent: { kind: 'analysis_completed' },
    });
    const result = ContextPackSchema.safeParse(pack);
    if (!result.success) {
      // Surfacing zod errors makes a regression diagnosable in CI.
      throw new Error(`schema rejected fully-populated pack: ${JSON.stringify(result.error.issues)}`);
    }
    expect(result.success).toBe(true);
  });

  it('rejects a pack with missing version', () => {
    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [] });
    // Strip `version` to simulate contract drift.
    const { version: _omit, ...rest } = pack;
    void _omit;
    const result = ContextPackSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('version');
    }
  });

  it('rejects a pack with the wrong version literal (anything other than "2.0")', () => {
    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [] });
    const drifted = { ...pack, version: '2.1' };
    const result = ContextPackSchema.safeParse(drifted);
    expect(result.success).toBe(false);
  });

  it('rejects a pack with missing scenario_id', () => {
    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [] });
    const { scenario_id: _omit, ...rest } = pack;
    void _omit;
    const result = ContextPackSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('scenario_id');
    }
  });

  it('rejects a pack with empty-string scenario_id', () => {
    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [] });
    const drifted = { ...pack, scenario_id: '' };
    const result = ContextPackSchema.safeParse(drifted);
    expect(result.success).toBe(false);
  });

  it('rejects a pack where parsed_quantities has been silently dropped to undefined', () => {
    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [] });
    const { parsed_quantities: _omit, ...rest } = pack;
    void _omit;
    const result = ContextPackSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('parsed_quantities');
    }
  });

  it('accepts a pack where parsed_quantities is the empty array', () => {
    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [] });
    expect(pack.parsed_quantities).toEqual([]);
    const result = ContextPackSchema.safeParse(pack);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Non-production runtime gate
// ---------------------------------------------------------------------------
//
// The assembler invokes `ContextPackSchema.safeParse` on its return value
// when `isProduction()` is false. Behaviour ladder:
//   - test       → throw (CI catches drift loudly)
//   - other      → log.warn (developer-visible, non-fatal)
//   - production → no parse, no log (dead code)
//
// We program the env predicates via the hoisted mocks at the top of this
// file; defaults below match the "test" branch so the rest of the suite
// inherits the gate-enabled, throw-on-failure mode it implicitly relied on
// before the runtime gate was added. To force a failure, we spy on
// `ContextPackSchema.safeParse` and synthesise a `success: false` result.
// This keeps tests independent of any specific schema invariant, so they
// don't drift if the schema is later tightened or relaxed.
describe('non-production runtime gate', () => {
  function makeIssue(path: readonly (string | number)[], message: string): z.ZodIssue {
    return { code: 'custom', path: [...path], message } as z.ZodIssue;
  }

  function failureWith(issues: readonly z.ZodIssue[]): z.SafeParseError<unknown> {
    return {
      success: false,
      error: new z.ZodError([...issues]),
    };
  }

  beforeEach(() => {
    isProductionMock.mockReset().mockReturnValue(false);
    isTestMock.mockReset().mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws under test env on schema failure with the documented prefix', () => {
    vi.spyOn(ContextPackSchema, 'safeParse').mockReturnValue(
      failureWith([makeIssue(['version'], 'Required')]),
    );

    expect(() =>
      assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [] }),
    ).toThrowError(/^\[ContextPack validation\] version: Required$/);
  });

  it('caps the thrown error at five issues even when many fields fail', () => {
    const issues = Array.from({ length: 12 }, (_, i) =>
      makeIssue([`field_${i}`], `bad_${i}`),
    );
    vi.spyOn(ContextPackSchema, 'safeParse').mockReturnValue(failureWith(issues));

    let caught: Error | null = null;
    try {
      assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [] });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    const lines = caught!.message.split('\n');
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      expect(line).toMatch(/^\[ContextPack validation\] field_\d+: bad_\d+$/);
    }
  });

  it('renders root-level path as <root> in the error prefix', () => {
    vi.spyOn(ContextPackSchema, 'safeParse').mockReturnValue(
      failureWith([makeIssue([], 'Expected object, received null')]),
    );

    expect(() =>
      assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [] }),
    ).toThrowError(/^\[ContextPack validation\] <root>: Expected object, received null$/);
  });

  it('warns (not throws) under non-test, non-production environments on failure', () => {
    isTestMock.mockReturnValue(false);
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    vi.spyOn(ContextPackSchema, 'safeParse').mockReturnValue(
      failureWith([makeIssue(['version'], 'Required')]),
    );

    // priorFacts: [] so the canonical-state facts-absent warn does not fire —
    // this test isolates the schema-drift warn.
    expect(() =>
      assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [], priorFacts: [] }),
    ).not.toThrow();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [payload, msg] = warnSpy.mock.calls[0]!;
    expect((payload as { event: string }).event).toBe('context_pack_schema_drift');
    expect((payload as { issues: readonly string[] }).issues[0]).toBe(
      '[ContextPack validation] version: Required',
    );
    expect(msg).toBe('ContextPack failed schema validation');
  });

  it('skips safeParse entirely under production', () => {
    isProductionMock.mockReturnValue(true);
    const parseSpy = vi.spyOn(ContextPackSchema, 'safeParse');

    const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [] });

    expect(parseSpy).not.toHaveBeenCalled();
    expect(pack.version).toBe(CONTEXT_PACK_VERSION);
  });

  it('does not throw or warn when the assembled pack is valid', () => {
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => undefined);

    expect(() =>
      assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [] }),
    ).not.toThrow();

    // No drift event fired.
    for (const call of warnSpy.mock.calls) {
      expect((call[0] as { event?: string }).event).not.toBe('context_pack_schema_drift');
    }
  });
});

describe('projectAnalysis — enriched projection', () => {
  // Lane 21 (P0-A): the routed projection cap widened 3 → 5
  // (CONTEXT_PACK_TOP_DRIVER_CAP) so the LLM sees the same driver breadth
  // the UI renders. Ordering rule unchanged. A sixth driver is still capped
  // out — see the breadth suite (context-pack-analysis-breadth.test.ts).
  it('caps top_drivers at 5 on the routed path and sorts by absolute magnitude descending', () => {
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
      { factor_label: 'Small +', sensitivity_value: 0.05 },
      { factor_label: 'Tiny −', sensitivity_value: -0.01 },
    ]);
  });

  it('projects a neutral driver to sensitivity_value 0 so it renders as no directional effect', () => {
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [],
      analysis: makeAnalysis({
        top_drivers: [
          { factor_id: 'f1', factor_label: 'Strong +', sensitivity: 0.70, direction: 'positive' },
          { factor_id: 'f2', factor_label: 'Neutral',  sensitivity: 0.50, direction: 'neutral' },
        ],
      }),
    });
    // Neutral projects to 0 (not +0.50), so the near-zero band renders
    // "has little effect" rather than "strengthens"; it also sorts last.
    expect(pack.analysis?.top_drivers).toEqual([
      { factor_label: 'Strong +', sensitivity_value: 0.70 },
      { factor_label: 'Neutral',  sensitivity_value: 0 },
    ]);
  });

  it('demotes a HIGH-magnitude neutral below a lower-magnitude directional driver (sort runs after neutral → 0)', () => {
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [],
      analysis: makeAnalysis({
        top_drivers: [
          // The neutral has the LARGER raw magnitude but no directional signal.
          { factor_id: 'f1', factor_label: 'Big Neutral', sensitivity: 0.80, direction: 'neutral' },
          { factor_id: 'f2', factor_label: 'Small Directional', sensitivity: 0.30, direction: 'negative' },
        ],
      }),
    });
    // The directional driver leads despite its smaller raw magnitude; the
    // neutral (→ 0) ranks last, so it can never headline "would shift the most".
    expect(pack.analysis?.top_drivers).toEqual([
      { factor_label: 'Small Directional', sensitivity_value: -0.30 },
      { factor_label: 'Big Neutral',       sensitivity_value: 0 },
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

  // Lane 21 (P0-A): budget raised from 800 — the raw section now carries
  // EVERY option plus tipping/VOI/goal-fit signal slots (breadth was the
  // point: the old ~600-char projection starved the LLM). The measured size
  // for this fixture is ~1.25k; 1800 leaves headroom without letting the
  // section grow unbounded. The LLM-facing budget is asserted separately on
  // the display projection (format-analysis-for-context.test.ts).
  it('analysis section stays under 1800 chars for a realistic 4-option, 3-driver run', () => {
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
    expect(chars).toBeLessThan(1800);
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

      // Telemetry contract (14-Jul PII ruling): at least one warn
      // correlating to the dropped option via DIGEST, with a bounded
      // violation enum — never the raw label or the raw value.
      const matchingCalls = warnSpy.mock.calls.filter((call) => {
        const payload = call[0] as Record<string, unknown> | undefined;
        return (
          payload != null &&
          payload.event === 'analysis_projection_invalid_probability' &&
          payload.option_id_digest === sha8('opt-bad') &&
          payload.violation === 'out_of_range'
        );
      });
      expect(matchingCalls.length).toBeGreaterThan(0);
      // The raw label and raw value must NOT appear in any warn call.
      const allWarns = JSON.stringify(warnSpy.mock.calls);
      expect(allWarns).not.toContain('OutOfScale');
      expect(allWarns).not.toContain('"option_label"');
      expect(allWarns).not.toContain('1.5');
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

describe('filterLeverSourcedFragileEdges — P0b-1 source-only fragile-edge suppression', () => {
  const lever = 'fac_lever';
  const controlled: ReadonlySet<string> = new Set([lever]);

  it('suppresses an edge whose SOURCE is a controlled lever', () => {
    const out = filterLeverSourcedFragileEdges(
      [{ from_id: lever, from_label: 'Lever', to_label: 'Goal' }],
      controlled,
    );
    expect(out).toEqual([]);
  });

  it('PRESERVES an edge whose TARGET is a controlled lever (source-only rule, mirrors PLoT A1c)', () => {
    const e = { from_id: 'fac_plain', from_label: 'Plain', to_id: lever, to_label: 'Lever' };
    expect(filterLeverSourcedFragileEdges([e], controlled)).toEqual([e]);
  });

  it('PRESERVES a non-lever edge', () => {
    const e = { from_id: 'fac_plain', from_label: 'Plain', to_label: 'Goal' };
    expect(filterLeverSourcedFragileEdges([e], controlled)).toEqual([e]);
  });

  it('empty / undefined controlled set is a no-op', () => {
    const edges = [
      { from_id: lever, from_label: 'Lever', to_label: 'Goal' },
      { from_id: 'fac_plain', from_label: 'Plain', to_label: 'Goal' },
    ];
    expect(filterLeverSourcedFragileEdges(edges, new Set())).toEqual(edges);
    expect(filterLeverSourcedFragileEdges(edges, undefined)).toEqual(edges);
  });

  it('FAILS CLOSED on a missing from_id when a lever exists — no silent lever bypass on the fallback path', () => {
    const e = { from_label: 'Unknown-source', to_label: 'Goal' }; // no from_id (legacy/label-only)
    expect(filterLeverSourcedFragileEdges([e], controlled)).toEqual([]); // dropped (fail-closed)
    expect(filterLeverSourcedFragileEdges([e], new Set())).toEqual([e]); // but no over-suppression when no levers
  });
});

describe('projectAnalysis — P0b-1 fragile-edge lever suppression (via assembleContextPack)', () => {
  const fragile = [
    { from_id: 'fac_lever', from_label: 'Pinned Lever', to_label: 'Goal' }, // lever SOURCE → suppress
    { from_id: 'fac_plain', from_label: 'Background', to_label: 'Goal' }, // non-lever → keep
  ];

  it('drops lever-SOURCED fragile edges and preserves non-lever edges; output keeps the {from_label,to_label} shape', () => {
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [],
      analysis: makeAnalysis({ top_fragile_edges: fragile }),
      interventionControlledFactorIds: new Set(['fac_lever']),
    });
    expect((pack.analysis?.fragile_edges ?? []).map((e) => e.from_label)).toEqual(['Background']);
    // No from_id leaks onto the strict-validated ContextPack output.
    expect(pack.analysis?.fragile_edges).toEqual([{ from_label: 'Background', to_label: 'Goal' }]);
  });

  it('no controlled ids → all fragile edges preserved (no over-suppression)', () => {
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [],
      analysis: makeAnalysis({ top_fragile_edges: fragile }),
    });
    expect((pack.analysis?.fragile_edges ?? []).map((e) => e.from_label)).toEqual([
      'Pinned Lever',
      'Background',
    ]);
  });
});
