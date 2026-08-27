/**
 * CONTEXT/MEMORY V5 defect 4 — ROUTE B: `dispatchChipClickRunAnalysis`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS PINS
 *
 * `fetchPriorFacts` (build-turn-context.ts) returns `[]` in FOUR different
 * situations — no store, no prior turns, no row ids, and `readFactsFor` THREW.
 * Only the last is a failure. Before the fix all four derived
 * `'none' / 'no_successful_run_analysis_fact'`, a POSITIVE claim that this
 * scenario has never been analysed, asserted on a turn where the store could
 * not be read.
 *
 * `deriveChipClickFreshness` (chip-click-dispatch.ts ~:483) gained a 3rd
 * parameter `priorFactsReadOk`, threaded from `context.prior_facts_read_ok` at
 * both call sites — the refusal path (~:856) and the post-dispatch path
 * (~:1270). This file drives the POST-DISPATCH path through the REAL
 * `buildTurnContext` and the REAL `fetchPriorFacts`, against a session store
 * whose `readFactsFor` genuinely rejects. Nothing hand-authors
 * `prior_facts_read_ok`; a test that constructed the flag itself would prove
 * only that the derivation reads a field, not that a real read failure reaches
 * it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE POST-DISPATCH PATH AND NOT THE REFUSAL PATH
 *
 * Both call sites were threaded, but only one yields an UNCLAMPED observable.
 * The refusal path passes its derivation through `clampRefusalFreshness`
 * (compose/analysis-ready-emit.ts:111), which rewrites `'none'` to `'unknown'`
 * — so on that path the healthy-empty control and the degraded case would BOTH
 * report `freshness: 'unknown'` and only the `reason` would still discriminate.
 * Testing there would silently weaken the twin. The post-dispatch path emits
 * the raw derivation, so `freshness` AND `reason` both carry the distinction.
 *
 * Reaching it requires the handler to SUCCEED while producing NO `run_analysis`
 * fact of its own: `postDispatchFacts` is `[...enrichedFacts,
 * ...context.prior_facts]`, so a fact from this turn would be selected first and
 * the prior-chain read state would be inert (as the source comment at ~:1264
 * says). `handlerOkNoFacts()` returns `handler_facts: []` precisely so the prior
 * chain — and therefore the read state — is what decides.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE OBSERVABLE
 *
 * The `v5.analysis_freshness.derived` telemetry event from
 * `emitFreshnessTelemetry` (context/freshness.ts:780), captured with
 * `setTestSink`. Bound BY IDENTITY to `dispatch_path === 'chip_click_run_analysis'`
 * — the dispatcher also emits on `chip_click_finalise`, and a value-predicate
 * match could be satisfied by that different derivation site. `soleDerived()`
 * additionally asserts EXACTLY ONE such event, so a second one appearing later
 * cannot be silently matched instead.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WOULD HAVE TO BE TRUE FOR THESE TESTS TO PASS WHILE THE PROPERTY IS BROKEN
 *
 * The dominant vacuity is a degraded arm that never degrades. `fetchPriorFacts`
 * short-circuits BEFORE its try/catch on three guards (`!store`,
 * `priorTurns.length === 0`, `priorTurnRowIds.length === 0`), each returning
 * `readOk: TRUE`. If `readRecent` returned `[]` the rejecting `readFactsFor`
 * would never run, the flag would be `true`, and arm 1 would be asserting
 * against the HEALTHY branch. Three defences:
 *   1. `readRecent` returns one row WITH a string `id`, clearing all three guards.
 *   2. `readFactsWithTurnFor` is DELIBERATELY ABSENT from the store mock — it is
 *      tried FIRST (build-turn-context.ts:1705), and a non-empty result there
 *      would mean `readFactsFor` never runs.
 *   3. Every arm asserts `readFactsForMock` WAS CALLED, pinning the precondition
 *      in-test so a short-circuit fails loud rather than passing quietly.
 * A fourth, specific to this route: `handlerRegistry` is deliberately NOT passed
 * to the dispatcher. Passing it makes the dispatcher skip the snapshot pre-load
 * (chip-click-dispatch.ts:722), leaving `cachedSnapshot` null — and with a null
 * snapshot the current graph hash is null, which would collapse arm 3's verdict
 * into `current_graph_hash_unavailable` regardless of the fact's hash.
 *
 * The second vacuity is a fix that downgraded EVERY empty read to `unknown`,
 * satisfying arm 1 while destroying the product's ability to say "no analysis
 * has been run". Arm 2 is the discriminating twin: identical stimulus except
 * that `readFactsFor` RESOLVES `[]`, and the verdict must still be
 * `'none' / 'no_successful_run_analysis_fact'`.
 *
 * The third vacuity is a degraded flag that blanks out a REAL analysis. Arm 3
 * proves the verdict is HASH-DERIVED by moving the hash and nothing else: a
 * diverged `graph_hash_at_run` must give `'stale' / 'graph_hash_diverged'`, and
 * the same fact re-run with the `current_graph_hash` the dispatcher itself
 * reported must give `'fresh' / 'graph_hash_match'`. A stuck verdict cannot
 * satisfy both halves.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import type { RunAnalysisScenarioSnapshot } from '../../tools/handlers/run-analysis.js';

import { makeMessagePayload } from '../../__tests__/fixtures.js';

// ── mutable seams (hoisted so the vi.mock factories can close over them) ─────

const {
  readRecentMock,
  readFactsForMock,
  readScenarioRunAnalysisFactsForMock,
  appendMock,
  loadScenarioSnapshotForRunAnalysisMock,
  commitDirectAnswerMock,
  enrichRunAnalysisMock,
  handlerFnMock,
  createRegistryMock,
} = vi.hoisted(() => ({
  readRecentMock: vi.fn(),
  readFactsForMock: vi.fn(),
  readScenarioRunAnalysisFactsForMock: vi.fn(),
  appendMock: vi.fn().mockResolvedValue({ id: 'mock-row-id' }),
  loadScenarioSnapshotForRunAnalysisMock: vi.fn(),
  commitDirectAnswerMock: vi.fn(),
  enrichRunAnalysisMock: vi.fn(),
  handlerFnMock: vi.fn(),
  createRegistryMock: vi.fn(),
}));

// ⚠ `readFactsWithTurnFor` is DELIBERATELY OMITTED — see the docblock.
vi.mock('../../session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: readRecentMock,
    readFactsFor: readFactsForMock,
    readScenarioRunAnalysisFactsFor: readScenarioRunAnalysisFactsForMock,
    readMostRecentPendingActions: async () => [],
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// `buildTurnContext` itself stays REAL — it is the producer of the read state
// under test. Only the scenario-snapshot loader is stubbed, so `cachedSnapshot`
// is non-null without a Supabase round-trip.
vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    loadScenarioSnapshotForRunAnalysis: loadScenarioSnapshotForRunAnalysisMock,
  };
});

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: commitDirectAnswerMock,
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../coaching/decision-review-enricher.js', () => ({
  enrichRunAnalysisWithDecisionReview: enrichRunAnalysisMock,
}));

vi.mock('../../tools/registry.js', async () => {
  const actual = await vi.importActual<typeof import('../../tools/registry.js')>(
    '../../tools/registry.js',
  );
  return {
    ...actual,
    createRegistry: createRegistryMock,
    getDefaultRegistry: () => new Map([['run_analysis', handlerFnMock]]),
    resolveHandler: (_registry: unknown, id: string) =>
      id === 'run_analysis' ? handlerFnMock : undefined,
  };
});

import { dispatchChipClickRunAnalysis } from '../chip-click-dispatch.js';
import { setTestSink } from '../../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

// ── fixtures ────────────────────────────────────────────────────────────────

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function payload() {
  return makeMessagePayload({
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse',
    message: 'Run the analysis.',
    turn_class: 'decide',
    source: 'chip_click',
    chip: { action_type: 'run_analysis' },
  });
}

const READY_GRAPH: GraphV3T = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue', goal_threshold: 0.8 },
    { id: 'fac_marketing', kind: 'factor', label: 'Marketing spend' },
    { id: 'opt_launch', kind: 'option', label: 'Launch now', interventions: { fac_marketing: 0.7 } },
    { id: 'opt_status_quo', kind: 'option', label: 'Status quo', interventions: { fac_marketing: 0.3 } },
  ],
  edges: [
    { from: 'dec_launch', to: 'opt_launch', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_launch', to: 'opt_status_quo', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_launch', to: 'fac_marketing', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'opt_status_quo', to: 'fac_marketing', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'fac_marketing', to: 'goal_revenue', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
} as unknown as GraphV3T;

/**
 * `rawPersistedGraph` is load-bearing: `deriveChipClickFreshness` derives the
 * CURRENT graph hash from it (chip-click-dispatch.ts:491-503). Omit it and the
 * hash is null, which would make arm 3 report `current_graph_hash_unavailable`
 * no matter what the fact says.
 */
function snapshotFor(graph: GraphV3T): RunAnalysisScenarioSnapshot {
  return {
    graph,
    options: [
      { id: 'opt_launch', option_id: 'opt_launch', label: 'Launch now', interventions: { fac_marketing: 0.7 } },
      { id: 'opt_status_quo', option_id: 'opt_status_quo', label: 'Status quo', interventions: { fac_marketing: 0.3 } },
    ],
    goal_node_id: 'goal_revenue',
    rawPersistedGraph: graph,
  } as unknown as RunAnalysisScenarioSnapshot;
}

/**
 * A SUCCESSFUL handler outcome that produces NO run_analysis fact of its own.
 *
 * This is what makes the prior-chain read state observable at all. With a fact
 * from this turn present, `postDispatchFacts` selects it first and the degraded
 * flag is inert — the dispatcher's own comment at ~:1264 says exactly this.
 */
function handlerOkNoFacts() {
  return {
    assistant_text: 'Ran analysis on your current scenario.',
    handler_facts: [],
    llm_calls_used: 0,
  };
}

/**
 * A run_analysis fact in the shape the PRODUCER actually reads.
 *
 * ⚠ `viewRunAnalysisFact` (context/freshness.ts:227) reads `graph_hash_at_run`
 * and `computed_at` from `fact.result` and requires `noop === false`. The same
 * fields at the TOP level make the fact silently UNSELECTABLE, and arm 3 would
 * be asserting against a fact the derivation cannot see.
 */
function runAnalysisFact(
  graphHashAtRun: string,
  options: {
    readonly computedAt?: string;
    readonly status?: string;
    readonly mayNameLeadingOption?: boolean;
  } = {},
) {
  const mayNameLeadingOption = options.mayNameLeadingOption ?? true;
  return {
    fact_type: 'run_analysis' as const,
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_launch',
      summary: 'Launch now leads on the recorded model.',
      win_probabilities: { opt_launch: 0.62, opt_status_quo: 0.38 },
      graph_hash_at_run: graphHashAtRun,
      computed_at: options.computedAt ?? '2026-08-15T00:00:00.000Z',
      enrichment: {
        analysis_status: options.status ?? 'completed',
        option_comparison: [
          {
            option_id: 'opt_launch',
            option_label: 'Launch now',
            win_probability: 0.62,
            outcome_mean: 0.6,
          },
          {
            option_id: 'opt_status_quo',
            option_label: 'Status quo',
            win_probability: 0.38,
            outcome_mean: 0.4,
          },
        ],
      },
      constraint_verdict: {
        may_name_leading_option: mayNameLeadingOption,
        constraint_verdict_state: mayNameLeadingOption
          ? 'evaluated_feasible'
          : 'unevaluated',
      },
    },
  };
}

function handlerOutcomeWithFact(fact: ReturnType<typeof runAnalysisFact>) {
  return {
    assistant_text: 'Ran analysis on your current scenario.',
    handler_facts: [fact],
    llm_calls_used: 0,
  };
}

// ── telemetry capture ───────────────────────────────────────────────────────

type Captured = { event: string; data: Record<string, unknown> };
let captured: Captured[] = [];

/**
 * The sole post-dispatch `v5.analysis_freshness.derived` event. Bound by
 * IDENTITY (`dispatch_path === 'chip_click_run_analysis'`), never by a value
 * predicate, and asserted unique.
 */
function soleDerived(): Record<string, unknown> {
  const matches = captured.filter(
    (c) =>
      c.event === 'v5.analysis_freshness.derived' &&
      c.data.dispatch_path === 'chip_click_run_analysis',
  );
  expect(matches).toHaveLength(1);
  return matches[0]!.data;
}

/** Reset every per-run seam. Kept in one place so the two halves of arm 3 are identical. */
function primeMocks() {
  handlerFnMock.mockResolvedValue(handlerOkNoFacts());
  enrichRunAnalysisMock.mockImplementation(
    async ({ handlerFacts }: { handlerFacts: unknown[] }) => handlerFacts,
  );
  commitDirectAnswerMock.mockResolvedValue({
    response: {},
    performed: true,
    persisted_row_id: 'row-1',
    graphPersisted: true,
  });
  createRegistryMock.mockImplementation(() => new Map([['run_analysis', handlerFnMock]]));
  loadScenarioSnapshotForRunAnalysisMock.mockResolvedValue(snapshotFor(READY_GRAPH));
  // Non-empty prior turns WITH row ids — clears the three `fetchPriorFacts`
  // short-circuits so the try/catch is genuinely reached.
  readRecentMock.mockResolvedValue([{ id: 'prior-run-row' }]);
  readFactsForMock.mockResolvedValue([]);
  readScenarioRunAnalysisFactsForMock.mockResolvedValue({
    facts: [],
    total_count: 0,
  });
}

async function runDispatch() {
  // ⚠ NO `handlerRegistry` — see the docblock. Injecting one skips the snapshot
  // pre-load and nulls `cachedSnapshot`.
  return dispatchChipClickRunAnalysis({
    payload: payload(),
    requestId: 'req-chip-degraded',
  });
}

describe('chip-click-dispatch — a degraded prior-fact read must not claim "never analysed" (defect 4, route B)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured = [];
    setTestSink((event, data) => {
      if (event.startsWith('v5.analysis_freshness.')) captured.push({ event, data });
    });
    primeMocks();
  });

  afterEach(() => {
    setTestSink(null);
  });

  it('DEGRADED: the exact scenario fact read THROWS → unknown / derivation_failed, never none', async () => {
    readScenarioRunAnalysisFactsForMock.mockRejectedValue(
      new Error('simulated scenario analysis-fact read failure'),
    );

    const out = await runDispatch();
    expect(out.outcome).toBe('ok');
    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    expect(out.mayNameLeadingOption).toBe(false);

    // Precondition pin: the rejecting read was genuinely reached.
    expect(readScenarioRunAnalysisFactsForMock).toHaveBeenCalledWith(SCENARIO_ID, 21);

    const derived = soleDerived();
    expect(derived.freshness).toBe('unknown');
    expect(derived.reason).toBe('derivation_failed');
    // The defect, as its own assertion.
    expect(derived.freshness).not.toBe('none');
    expect(derived.reason).not.toBe('no_successful_run_analysis_fact');
    // Pins that this turn contributed no fact, so the verdict is genuinely the
    // prior chain's — i.e. the degraded flag was live rather than inert.
    expect(derived.current_turn_fact_count).toBe(0);
    expect(derived.prior_fact_count).toBe(0);
  });

  it('OK-ARM CONTROL: the exact scenario page is complete-empty → none / no_successful_run_analysis_fact', async () => {
    // The discriminating twin: identical to the arm above except the read
    // SUCCEEDS and is genuinely empty. A fix that downgraded every empty read
    // would pass arm 1 and fail here.
    readScenarioRunAnalysisFactsForMock.mockResolvedValue({ facts: [], total_count: 0 });

    const out = await runDispatch();
    expect(out.outcome).toBe('ok');
    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    expect(out.mayNameLeadingOption).toBe(true);

    expect(readScenarioRunAnalysisFactsForMock).toHaveBeenCalledWith(SCENARIO_ID, 21);

    const derived = soleDerived();
    expect(derived.freshness).toBe('none');
    expect(derived.reason).toBe('no_successful_run_analysis_fact');
    expect(derived.reason).not.toBe('derivation_failed');
    expect(derived.current_turn_fact_count).toBe(0);
  });

  it('FACT-AUTHORITATIVE: a real run_analysis fact is never blanked out, and the verdict tracks the HASH', async () => {
    // ── half 1: diverged hash → the hash-derived stale verdict ───────────────
    readScenarioRunAnalysisFactsForMock.mockResolvedValue({
      facts: [runAnalysisFact('sha256:deliberately-diverged')],
      total_count: 1,
    });

    const out = await runDispatch();
    expect(out.outcome).toBe('ok');
    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    expect(out.mayNameLeadingOption).toBe(true);

    expect(readScenarioRunAnalysisFactsForMock).toHaveBeenCalledWith(SCENARIO_ID, 21);

    const diverged = soleDerived();
    expect(diverged.freshness).toBe('stale');
    expect(diverged.reason).toBe('graph_hash_diverged');
    expect(diverged.freshness).not.toBe('none');
    expect(diverged.reason).not.toBe('no_successful_run_analysis_fact');
    expect(diverged.reason).not.toBe('derivation_failed');
    // Pins that the fact was genuinely SELECTED — the guard against the
    // silently-unselectable fixture shape.
    expect(diverged.selected_fact_index).toBe(0);
    expect(diverged.graph_hash_at_run).toBe('sha256:deliberately-diverged');

    const currentGraphHash = diverged.current_graph_hash;
    expect(typeof currentGraphHash).toBe('string');
    expect(currentGraphHash).not.toBe('sha256:deliberately-diverged');

    // ── half 2: the SAME fact with a matching hash must flip to fresh ────────
    captured = [];
    vi.clearAllMocks();
    primeMocks();
    readScenarioRunAnalysisFactsForMock.mockResolvedValue({
      facts: [runAnalysisFact(currentGraphHash as string)],
      total_count: 1,
    });

    const out2 = await runDispatch();
    expect(out2.outcome).toBe('ok');
    if (out2.outcome !== 'ok') throw new Error(`expected ok, got ${out2.outcome}`);
    expect(out2.mayNameLeadingOption).toBe(true);

    expect(readScenarioRunAnalysisFactsForMock).toHaveBeenCalledWith(SCENARIO_ID, 21);

    const matched = soleDerived();
    expect(matched.freshness).toBe('fresh');
    expect(matched.reason).toBe('graph_hash_match');
    expect(matched.selected_fact_index).toBe(0);
  });

  it('CURRENT SUCCESS: same-turn analysis outranks a future-skewed durable fact', async () => {
    const currentGraphHash = computeAnalysisAffectingGraphHash(READY_GRAPH as never)!;
    const durableFutureWithheld = runAnalysisFact('sha256:durable-diverged', {
      computedAt: '2099-01-01T00:00:00.000Z',
      mayNameLeadingOption: false,
    });
    const currentPermitted = runAnalysisFact(currentGraphHash, {
      computedAt: '2026-08-27T00:00:00.000Z',
      mayNameLeadingOption: true,
    });
    readScenarioRunAnalysisFactsForMock.mockResolvedValue({
      facts: [durableFutureWithheld],
      total_count: 1,
    });
    handlerFnMock.mockResolvedValue(handlerOutcomeWithFact(currentPermitted));

    const out = await runDispatch();
    expect(out.outcome).toBe('ok');
    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    expect(out.freshness.freshness).toBe('fresh');
    expect(out.freshness.reason).toBe('graph_hash_match');
    expect(out.freshness.computed_at).toBe('2026-08-27T00:00:00.000Z');
    expect(out.mayNameLeadingOption).toBe(true);
  });

  it('CURRENT PARTIAL: a withheld same-turn result cannot be widened by older durable permission', async () => {
    const currentGraphHash = computeAnalysisAffectingGraphHash(READY_GRAPH as never)!;
    const durablePermitted = runAnalysisFact(currentGraphHash, {
      computedAt: '2026-08-26T00:00:00.000Z',
      mayNameLeadingOption: true,
    });
    const currentPartialWithheld = runAnalysisFact(currentGraphHash, {
      computedAt: '2026-08-27T00:00:00.000Z',
      status: 'partial',
      mayNameLeadingOption: false,
    });
    readScenarioRunAnalysisFactsForMock.mockResolvedValue({
      facts: [durablePermitted],
      total_count: 1,
    });
    handlerFnMock.mockResolvedValue(handlerOutcomeWithFact(currentPartialWithheld));

    const out = await runDispatch();
    expect(out.outcome).toBe('ok');
    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    expect(out.mayNameLeadingOption).toBe(false);
  });
});
