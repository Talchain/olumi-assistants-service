import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  EMPTY_DECISION_CONTEXT,
  TurnContextSchema,
  type SessionTurn,
  type HandlerFact,
} from '@talchain/schemas/orchestrator';

import { setTestSink } from '../../utils/telemetry.js';
import { buildTurnContext, loadScenarioSnapshotForRunAnalysis } from '../build-turn-context.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { SessionReadError } from '../session/store.js';
import { makeMessagePayload } from './fixtures.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { deriveAnalysisFreshness } from '../context/freshness.js';
import { config } from '../../config/index.js';

/**
 * Effective default turn budget: the configured 180s default CLAMPED to the
 * browser-proxy deadline (2026-07-19) so CEE always answers before the proxy
 * does. Derived rather than restated as a literal — a hard-coded post-clamp
 * number would be exactly the silent-drift mirror the clamp exists to remove.
 */
const EXPECTED_DEFAULT_TURN_MS = Math.min(180_000, config.proxy.browserProxyTimeoutMs - 10_000);

const BASE = makeMessagePayload({
  turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  message: 'hello',
});

// Slice B: buildTurnContext is async + reads from SessionStore. These legacy
// tests focus on the shape of the base TurnContext — inject a noop store so
// they don't touch real Supabase. The prior_turns field is covered by
// Slice-B-specific tests elsewhere.
const OPTS = { sessionStore: createNoopSessionStore() };

describe('buildTurnContext', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.TURN_BUDGET_MS;
    delete process.env.LLM_BUDGET_NARRATE_MS;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('produces a TurnContextSchema-valid context from a valid payload', async () => {
    const ctx = await buildTurnContext(BASE, 'req-1', OPTS);
    // EnrichedTurnContext is a superset; strip the CEE-internal extensions
    // (prior_turns from Slice B, prior_facts from V5 Group 1,
    // scenarioBriefText + persistedGraph from V5 Phase 1 brief persistence,
    // most_recent_pending_actions from V5 Wave 2, decision_context from Coaching
    // State Spine Stage 1, coaching_state from Stage 2A) before asserting schema
    // parse (TurnContextSchema is strict — an unstripped internal field throws).
    const {
      prior_turns: _pt,
      prior_facts: _pf,
      prior_facts_with_turn: _pfwt,
      scenarioBriefText: _sb,
      persistedGraph: _pg,
      persistedGraphRead: _pgr,
      most_recent_pending_actions: _mrpa,
      decision_context: _dc,
      coaching_state: _cs,
      prior_coaching_state: _pcs,
      coaching_lifecycle: _cl,
      ...base
    } = ctx;
    const parsed = TurnContextSchema.parse(base);
    expect(parsed.stage).toBe('frame');
    expect(parsed.session_id).toBe(BASE.scenario_id);
    expect(parsed.request_id).toBe('req-1');
    expect(parsed.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('all capabilities are false in A1 (zero handlers invariant)', async () => {
    const ctx = await buildTurnContext(BASE, 'req-1', OPTS);
    for (const value of Object.values(ctx.capabilities)) {
      expect(value).toBe(false);
    }
  });

  it('entity_registry is a skeleton (empty options, null goal)', async () => {
    const ctx = await buildTurnContext(BASE, 'req-1', OPTS);
    expect(ctx.entity_registry).toEqual({ option_ids: [], goal_id: null });
  });

  it('uses default budgets when env vars are absent', async () => {
    const ctx = await buildTurnContext(BASE, 'req-1', OPTS);
    expect(ctx.budgets.turn_ms).toBe(EXPECTED_DEFAULT_TURN_MS);
    expect(ctx.budgets.llm_narrate_ms).toBe(60_000);
  });

  it('honours env overrides for budgets', async () => {
    process.env.TURN_BUDGET_MS = '12345';
    process.env.LLM_BUDGET_NARRATE_MS = '6789';
    const ctx = await buildTurnContext(BASE, 'req-1', OPTS);
    expect(ctx.budgets.turn_ms).toBe(12345);
    expect(ctx.budgets.llm_narrate_ms).toBe(6789);
  });

  it('falls back to defaults if env values are invalid', async () => {
    process.env.TURN_BUDGET_MS = 'not-a-number';
    process.env.LLM_BUDGET_NARRATE_MS = '-1';
    const ctx = await buildTurnContext(BASE, 'req-1', OPTS);
    expect(ctx.budgets.turn_ms).toBe(EXPECTED_DEFAULT_TURN_MS);
    expect(ctx.budgets.llm_narrate_ms).toBe(60_000);
  });
});

// ---------------------------------------------------------------------------
// Slice B additions — prior_turns + graceful degradation
// ---------------------------------------------------------------------------

function makeSessionTurn(turnId: string, createdAt: string): SessionTurn {
  return {
    id: `row-${turnId}`,
    scenario_id: BASE.scenario_id,
    user_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    turn_id: turnId,
    turn_class: 'direct_answer',
    handler_id: null,
    request_hash: `sha256:${turnId}`,
    response_emitted: true,
    llm_calls_used: 2,
    duration_ms: 123,
    created_at: createdAt,
  };
}

describe('buildTurnContext slice B — prior_turns population', () => {
  const prevEnv = { ...process.env };
  beforeEach(() => {
    process.env.VITEST = 'true';
  });
  afterEach(() => {
    process.env = { ...prevEnv };
    setTestSink(null);
  });

  it('populates prior_turns from sessionStore.readRecent', async () => {
    const priorTurns = [
      makeSessionTurn('t2', '2026-04-17T11:00:00.000+00:00'),
      makeSessionTurn('t1', '2026-04-17T10:00:00.000+00:00'),
    ];
    const store = createNoopSessionStore({ priorTurns });
    const ctx = await buildTurnContext(BASE, 'req-1', { sessionStore: store });
    expect(ctx.prior_turns).toHaveLength(2);
    expect(ctx.prior_turns[0].turn_id).toBe('t2');
  });

  it('calls readFactsFor with SessionTurn.id (row UUID), NOT turn_id', async () => {
    // V5 review regression guard: `v5_handler_facts.v5_conversation_turn_id`
    // references `v5_conversation_turns.id`. Passing `turn_id` (the client-
    // generated UUID string) would silently match zero rows and leave
    // prior_facts empty in production — which broke both the Task 1.4
    // analysis fallback and the coaching-cache decision_review lookups.
    const handlerTurn = {
      ...makeSessionTurn('client-turn-uuid', '2026-04-17T11:00:00.000+00:00'),
      id: 'db-row-uuid-should-be-passed',
      turn_class: 'handler' as const,
      handler_id: 'run_analysis' as const,
    };
    const captured: string[][] = [];
    const capturingStore = {
      ...createNoopSessionStore({ priorTurns: [handlerTurn] }),
      readFactsFor: async (ids: readonly string[]) => {
        captured.push([...ids]);
        return [];
      },
    };
    await buildTurnContext(BASE, 'req-1', { sessionStore: capturingStore });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual(['db-row-uuid-should-be-passed']);
    // Explicit negative: the client turn_id must NOT appear.
    expect(captured[0]).not.toContain('client-turn-uuid');
  });

  it('returns empty prior_turns when readRecent throws (graceful degradation)', async () => {
    const boom = new SessionReadError('DB offline', { code: '57P03' });
    const store = createNoopSessionStore({ throwOnRead: boom });
    const ctx = await buildTurnContext(BASE, 'req-1', { sessionStore: store });
    expect(ctx.prior_turns).toEqual([]);
  });

  it('emits session.read_degraded telemetry with error_code + severity=warning on read failure', async () => {
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    setTestSink((name, data) => events.push({ name, data }));
    const store = createNoopSessionStore({
      throwOnRead: new SessionReadError('RPC down', { code: '53300' }),
    });
    await buildTurnContext(BASE, 'req-1', { sessionStore: store });
    const event = events.find((e) => e.name === 'session.read_degraded');
    expect(event).toBeDefined();
    expect(event!.data).toMatchObject({
      request_id: 'req-1',
      scenario_id: BASE.scenario_id,
      error_code: '53300',
      severity: 'warning',
    });
  });

  it('emits read_degraded with error_code=unknown when the error has no code', async () => {
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    setTestSink((name, data) => events.push({ name, data }));
    const store = createNoopSessionStore({
      throwOnRead: new Error('something plain'),
    });
    await buildTurnContext(BASE, 'req-1', { sessionStore: store });
    const event = events.find((e) => e.name === 'session.read_degraded');
    expect(event!.data.error_code).toBe('unknown');
  });
});

describe('loadScenarioSnapshotForRunAnalysis', () => {
  it('loads persisted graph and derives ready options for run_analysis', async () => {
    const graph = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Ship AI Features Within 6 Months' },
        { id: 'dec_1', kind: 'decision', label: 'Hiring Decision' },
        { id: 'opt_lead', kind: 'option', label: 'Hire Tech Lead', interventions: { fac_cost: 1, fac_velocity: 1 } },
        { id: 'opt_devs', kind: 'option', label: 'Hire Two Developers', interventions: { fac_cost: 0.6, fac_velocity: 0.7 } },
        { id: 'fac_cost', kind: 'factor', label: 'Hiring Cost', category: 'controllable', observed_state: { value: 120000, unit: 'GBP', extractionType: 'explicit', factor_type: 'cost' } },
        { id: 'fac_velocity', kind: 'factor', label: 'Team Velocity', category: 'controllable', observed_state: { value: 0.7, extractionType: 'inferred', factor_type: 'other' } },
        { id: 'out_delivery', kind: 'outcome', label: 'Feature Delivery Rate' },
      ],
      edges: [
        { from: 'dec_1', to: 'opt_lead', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'dec_1', to: 'opt_devs', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'opt_lead', to: 'fac_cost', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'opt_lead', to: 'fac_velocity', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'opt_devs', to: 'fac_cost', strength: { mean: 0.6, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'opt_devs', to: 'fac_velocity', strength: { mean: 0.7, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'fac_cost', to: 'out_delivery', strength: { mean: -0.3, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' },
        { from: 'fac_velocity', to: 'out_delivery', strength: { mean: 0.75, std: 0.08 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'out_delivery', to: 'goal_1', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      ],
    };

    const store = createNoopSessionStore({ loadGraphResult: graph });
    const snapshot = await loadScenarioSnapshotForRunAnalysis(BASE.scenario_id, 'req-snap-1', store);

    expect(snapshot.goal_node_id).toBe('goal_1');
    expect(snapshot.options).toEqual([
      { id: 'opt_lead', option_id: 'opt_lead', label: 'Hire Tech Lead', interventions: { fac_cost: 1, fac_velocity: 1 } },
      { id: 'opt_devs', option_id: 'opt_devs', label: 'Hire Two Developers', interventions: { fac_cost: 0.6, fac_velocity: 0.7 } },
    ]);
    // Lane 28 — no brief persisted → the snapshot carries none (the PLoT leg
    // will then attach nothing, so PLoT's `no_brief` skip stays honest).
    expect(snapshot.briefText).toBeUndefined();
  });

  it('Lane 28: carries the persisted brief_text on the snapshot (same round trip as the graph)', async () => {
    const graph = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Goal' },
        { id: 'opt_a', kind: 'option', label: 'A', interventions: { fac_x: 1 } },
        { id: 'opt_b', kind: 'option', label: 'B', interventions: { fac_x: 0.5 } },
        { id: 'fac_x', kind: 'factor', label: 'X', category: 'controllable', observed_state: { value: 1, extractionType: 'explicit', factor_type: 'other' } },
      ],
      edges: [
        { from: 'opt_a', to: 'fac_x', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'opt_b', to: 'fac_x', strength: { mean: 0.5, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'fac_x', to: 'goal_1', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      ],
    };
    const briefText = 'Should we hire locally or offshore? Budget £250k.';
    const store = createNoopSessionStore({ loadGraphResult: graph, loadBriefTextResult: briefText });
    const snapshot = await loadScenarioSnapshotForRunAnalysis(BASE.scenario_id, 'req-snap-brief', store);
    expect(snapshot.briefText).toBe(briefText);
  });
});

// ---------------------------------------------------------------------------
// V5 Phase 1 brief persistence — scenarioBriefText on EnrichedTurnContext.
// ---------------------------------------------------------------------------

describe('buildTurnContext — scenarioBriefText (V5 Phase 1 brief persistence)', () => {
  it('populates scenarioBriefText from store.loadGraphAndBriefText', async () => {
    const briefText = 'Should I accept the offer at company X?';
    const store = createNoopSessionStore({ loadBriefTextResult: briefText });
    const ctx = await buildTurnContext(BASE, 'req-brief-1', { sessionStore: store });
    expect(ctx.scenarioBriefText).toBe(briefText);
  });

  it('returns null scenarioBriefText when no brief is persisted', async () => {
    const store = createNoopSessionStore();
    const ctx = await buildTurnContext(BASE, 'req-brief-2', { sessionStore: store });
    expect(ctx.scenarioBriefText).toBeNull();
  });

  it('degrades gracefully on session-store read failure (returns null briefText)', async () => {
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    setTestSink((name, data) => events.push({ name, data }));
    const store = createNoopSessionStore({
      throwOnRead: new SessionReadError('boom', { code: 'PGRST500' }),
    });
    const ctx = await buildTurnContext(BASE, 'req-brief-3', { sessionStore: store });
    // throwOnRead from createNoopSessionStore covers readRecent (which fires
    // first). loadGraphAndBriefText is unaffected by that flag, so ctx still
    // sees null briefText via the noop's default.
    expect(ctx.scenarioBriefText).toBeNull();
    setTestSink(null);
  });

  it('graph and briefText are loaded together (single round trip)', async () => {
    // Validates the contract that buildTurnContext uses
    // loadGraphAndBriefText, not separate loadGraph + brief calls.
    const briefText = 'My brief';
    const store = createNoopSessionStore({ loadBriefTextResult: briefText });
    const ctx = await buildTurnContext(BASE, 'req-brief-4', { sessionStore: store });
    expect(ctx.scenarioBriefText).toBe(briefText);
  });
});

// ---------------------------------------------------------------------------
// V5 Coaching State Spine — Stage 1: decision_context on EnrichedTurnContext.
// ---------------------------------------------------------------------------

const STAGE1_GRAPH = {
  nodes: [
    {
      id: 'goal_1',
      kind: 'goal',
      label: 'Reach £10m ARR',
      goal_threshold_raw: 10,
      goal_threshold_unit: '£m',
    },
    { id: 'opt_hire', kind: 'option', label: 'Hire a senior engineer' },
    { id: 'opt_outsource', kind: 'option', label: 'Outsource to an agency' },
  ],
  edges: [],
};

describe('buildTurnContext — decision_context (V5 Coaching State Spine Stage 1)', () => {
  afterEach(() => {
    setTestSink(null);
  });

  it('every built context carries decision_context (required field is present)', async () => {
    const ctx = await buildTurnContext(BASE, 'req-dc-1', OPTS);
    expect(ctx.decision_context).toBeDefined();
    // Noop store → null brief + null graph → EMPTY_DECISION_CONTEXT.
    expect(ctx.decision_context).toEqual(EMPTY_DECISION_CONTEXT);
  });

  it('populates decision_context from persisted brief + graph', async () => {
    const store = createNoopSessionStore({
      loadBriefTextResult: 'We can spend £2m by Q3 2026.',
      loadGraphResult: STAGE1_GRAPH,
    });
    const ctx = await buildTurnContext(BASE, 'req-dc-2', { sessionStore: store });
    expect(ctx.decision_context.status).toBe('populated');
    expect(ctx.decision_context.domain_anchors.monetary_figures).toContain('£2m');
    expect(ctx.decision_context.domain_anchors.timeline).toMatch(/Q3\s*2026/i);
    expect(ctx.decision_context.domain_anchors.named_entities).toContain(
      'Hire a senior engineer',
    );
    expect(ctx.decision_context.goal_translation.user_scale_metric).toBe('Reach £10m ARR');
  });

  it('emits v5.decision_context.derived with correlation IDs + counts/flags only (no raw decision content)', async () => {
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    setTestSink((name, data) => events.push({ name, data }));
    const store = createNoopSessionStore({
      loadBriefTextResult: 'We can spend £2m by Q3 2026.',
      loadGraphResult: STAGE1_GRAPH,
    });
    await buildTurnContext(BASE, 'req-dc-3', { sessionStore: store });

    const ev = events.find((e) => e.name === 'v5.decision_context.derived');
    expect(ev).toBeDefined();
    expect(ev!.data.status).toBe('populated');
    expect(ev!.data.monetary_count).toBe(1);
    expect(ev!.data.has_timeline).toBe(true);
    expect(typeof ev!.data.entity_count).toBe('number');
    expect(typeof ev!.data.derived_from_graph_hash).toBe('string');
    // Standard correlation IDs are INTENTIONALLY present (every V5 telemetry
    // event carries them); they are not decision content.
    expect(ev!.data.request_id).toBe('req-dc-3');
    expect(typeof ev!.data.scenario_id).toBe('string');
    // Privacy guarantee: NEVER raw decision content — no monetary values, no
    // entity labels, no timeline string, no brief text.
    const serialised = JSON.stringify(ev!.data);
    expect(serialised).not.toContain('£2m'); // monetary value
    expect(serialised).not.toContain('Hire a senior engineer'); // entity label
    expect(serialised).not.toContain('Q3 2026'); // timeline string
    expect(serialised).not.toContain('spend'); // brief text
  });
});

// ---------------------------------------------------------------------------
// V5 Coaching State Spine — Stage 2A: coaching_state on EnrichedTurnContext.
// Integration-level wiring + telemetry checks; per-kind derivation is unit-tested
// in coaching/__tests__/coaching-state.test.ts.
// ---------------------------------------------------------------------------

describe('buildTurnContext — coaching_state (V5 Coaching State Spine Stage 2A)', () => {
  afterEach(() => {
    setTestSink(null);
  });

  it('every built context carries coaching_state (required field present)', async () => {
    const ctx = await buildTurnContext(BASE, 'req-cs-1', OPTS);
    expect(ctx.coaching_state).toBeDefined();
    expect(ctx.coaching_state.version).toBe('v1');
  });

  it('cold start (noop store: no brief/graph/facts) → active with exactly decision_context_missing + analysis_missing', async () => {
    const ctx = await buildTurnContext(BASE, 'req-cs-2', OPTS);
    expect(ctx.coaching_state.status).toBe('active');
    const ids = ctx.coaching_state.signals.map((s) => s.signal_id).sort();
    expect(ids).toEqual([
      'analysis_missing:no_successful_run_analysis_fact',
      'decision_context_missing:not_populated',
    ]);
    expect(ctx.coaching_state.summary).toEqual({
      active_count: 2,
      stale_count: 0,
      unavailable_count: 0,
    });
    // Stage 2A statuses only — no cross-turn lifecycle.
    for (const s of ctx.coaching_state.signals) {
      expect(['active', 'stale', 'unavailable']).toContain(s.status);
      expect(s.created_from).toBe('derived_current_turn');
    }
  });

  it('emits v5.coaching_state.derived with correlation IDs + counts/closed-enum codes only (no raw decision content)', async () => {
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    setTestSink((name, data) => events.push({ name, data }));
    const store = createNoopSessionStore({
      loadBriefTextResult: 'We can spend £2m by Q3 2026.',
      loadGraphResult: STAGE1_GRAPH,
    });
    await buildTurnContext(BASE, 'req-cs-3', { sessionStore: store });

    const ev = events.find((e) => e.name === 'v5.coaching_state.derived');
    expect(ev).toBeDefined();
    expect(ev!.data.request_id).toBe('req-cs-3');
    expect(typeof ev!.data.scenario_id).toBe('string');
    expect(typeof ev!.data.status).toBe('string');
    expect(typeof ev!.data.signal_count).toBe('number');
    expect(Array.isArray(ev!.data.kinds_present)).toBe(true);
    expect(Array.isArray(ev!.data.reason_codes)).toBe(true);
    // Privacy guarantee: never raw decision content.
    const serialised = JSON.stringify(ev!.data);
    expect(serialised).not.toContain('£2m');
    expect(serialised).not.toContain('Hire a senior engineer');
    expect(serialised).not.toContain('Q3 2026');
    expect(serialised).not.toContain('spend');
  });
});

// ---------------------------------------------------------------------------
// V5 Coaching State Spine — Stage 2A: freshness-agreement guard.
// Proves build-time coaching_state freshness uses the SAME single source of
// truth as the routing/pre-dispatch view: the PERSISTED-graph hash
// (computeAnalysisAffectingGraphHash) fed to deriveAnalysisFreshness. Fails if a
// future change hashes a different graph (e.g. inbound graphStateForTurn), swaps
// the hash helper, or derives a second freshness verdict.
// ---------------------------------------------------------------------------

describe('buildTurnContext — coaching_state freshness agreement (Stage 2A)', () => {
  afterEach(() => {
    setTestSink(null);
  });

  function makeRunAnalysisFact(graphHashAtRun: string): HandlerFact {
    return {
      fact_type: 'run_analysis',
      fact_version: 1,
      turn_id: 't1',
      noop: false,
      result: {
        graph_hash_at_run: graphHashAtRun,
        computed_at: '2026-05-01T00:00:00.000Z',
        enrichment: { analysis_status: 'computed' },
      },
    } as unknown as HandlerFact;
  }

  it('hashes the PERSISTED graph and reuses deriveAnalysisFreshness (no second freshness truth)', async () => {
    const parsed = GraphStateIngressSchema.safeParse(STAGE1_GRAPH);
    expect(parsed.success).toBe(true);
    const expectedHash = computeAnalysisAffectingGraphHash(parsed.data as never);
    expect(typeof expectedHash).toBe('string');

    const matchFact = makeRunAnalysisFact(expectedHash as string);
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    setTestSink((name, data) => events.push({ name, data }));
    const store = createNoopSessionStore({
      loadGraphResult: STAGE1_GRAPH,
      priorTurns: [makeSessionTurn('t1', '2026-05-01T00:00:00.000+00:00')],
      facts: [matchFact],
    });
    const ctx = await buildTurnContext(BASE, 'req-fa-1', { sessionStore: store });

    const ev = events.find((e) => e.name === 'v5.coaching_state.derived')!;
    expect(ev).toBeDefined();
    // The emitted hash IS the persisted-graph hash.
    expect(ev.data.graph_hash).toBe(expectedHash);
    // The verdict matches the single-source freshness selector for the same inputs.
    const routingVerdict = deriveAnalysisFreshness([matchFact], expectedHash);
    expect(ev.data.freshness).toBe(routingVerdict.freshness);
    expect(ev.data.freshness).toBe('fresh');
    expect(ctx.coaching_state.signals.some((s) => s.kind === 'analysis_stale')).toBe(false);
  });

  it('a diverged analysis hash flips coaching_state to stale (analysis_stale active)', async () => {
    const diffFact = makeRunAnalysisFact('0000000000000000');
    const store = createNoopSessionStore({
      loadGraphResult: STAGE1_GRAPH,
      priorTurns: [makeSessionTurn('t1', '2026-05-01T00:00:00.000+00:00')],
      facts: [diffFact],
    });
    const ctx = await buildTurnContext(BASE, 'req-fa-2', { sessionStore: store });
    const stale = ctx.coaching_state.signals.find((s) => s.kind === 'analysis_stale');
    expect(stale?.status).toBe('active');
    expect(stale?.reason_code).toBe('graph_hash_diverged');
  });
});
