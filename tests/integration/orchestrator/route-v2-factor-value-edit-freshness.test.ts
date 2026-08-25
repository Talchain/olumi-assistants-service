/**
 * THE TURN THAT PATCHED THE GRAPH MUST NOT SAY IT HAD NO GRAPH.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT (derived at `3feed089`, and it is NOT where the brief said).
 *
 * A user edits a factor from the inspector. That is a `system_event`
 * (`factor_value_edit`), NOT the `edit_graph` lane — so the exit is
 * `route-v2.ts`'s `system_event` call, whose freshness spread is
 * `...(sysResult.freshness !== undefined ? { freshness } : {})`.
 *
 * `dispatchFactorValueEdit` NEVER COMPUTED A DERIVATION AT ALL. Its success
 * return carried `graph: graphForReadiness` (non-null — the graph it had just
 * written) and no `freshness`. The finaliser's `exitDerivationFor` then
 * DELIBERATELY refuses the persisted-graph fallback whenever a graph is in
 * scope (a mutated graph must never inherit a `fresh` verdict about the graph
 * as it was BEFORE the turn), so the chain fell through to
 * `NO_ANALYSIS_CONTEXT_DERIVATION` → `unknown_degraded` / `no_graph_this_turn`.
 *
 * That cause's contract text is "no graph was in scope, so there was nothing to
 * classify" — asserted on the one turn that had the graph, mutated it, and
 * persisted it. The two sibling mutating writers in the same file
 * (`dispatchEdgeStrengthEdit`, `dispatchStructuralDelete`) already derive it on
 * their success returns; this one was the outlier.
 *
 * ⚠ WHAT IS **NOT** THE DEFECT, and is pinned below as the control:
 * a REFUSED edit returns `graph: null` and genuinely had no graph in scope.
 * Its verdict must be BYTE-IDENTICAL after this fix. Trading an understatement
 * for an overstatement would be strictly worse than the defect being fixed.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';

const SCENARIO_ID = '44444444-4444-4444-8444-444444444444';
const TURN_ID_BASE = '55555555-5555-4555-8555-55555555555';

/**
 * A GENUINELY ANALYSABLE model — goal + decision + two options wired to the
 * decision and to the factor, each carrying an intervention. Derived from
 * `graph-structure-validator.ts` (`checkRequiredNodeKinds`), not guessed: a
 * `blocked` readiness outranks the whole freshness ladder in `composeRunState`,
 * so a non-analysable fixture would mask the very verdict under test.
 *
 * `f-budget` is capped at 100000 with unit £, currently £40,000 (value 0.4).
 */
function buildPersistedGraph() {
  return {
    goal_node_id: 'g-revenue',
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      { id: 'd-spend', kind: 'decision', label: 'How much to spend' },
      {
        id: 'f-budget',
        kind: 'factor',
        label: 'Marketing budget',
        observed_state: { value: 0.4, raw_value: 40000, unit: '\u00a3', cap: 100000 },
      },
      {
        id: 'o-launch',
        kind: 'option',
        label: 'Launch now',
        interventions: { 'f-budget': { value: 0.6 } },
      },
      {
        id: 'o-wait',
        kind: 'option',
        label: 'Wait a quarter',
        interventions: { 'f-budget': { value: 0.2 } },
      },
    ],
    edges: [
      {
        from: 'f-budget',
        to: 'g-revenue',
        strength: { mean: 0.4, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
      { from: 'd-spend', to: 'o-launch', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' as const },
      { from: 'd-spend', to: 'o-wait', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' as const },
      { from: 'o-launch', to: 'f-budget', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' as const },
      { from: 'o-wait', to: 'f-budget', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' as const },
    ],
  };
}

/**
 * The hash of the model AS THE PRIOR ANALYSIS SAW IT. Seeding the prior
 * `run_analysis` fact with exactly this makes the pre-edit state genuinely
 * FRESH — so a `stale` verdict after the edit is caused by the edit and by
 * nothing else. (Trap 13b: the guard must pin its own precondition.)
 */
const PRE_EDIT_HASH = computeAnalysisAffectingGraphHash(buildPersistedGraph() as never);

const PRIOR_RUN_ANALYSIS_FACT = {
  fact_type: 'run_analysis' as const,
  fact_version: 1,
  noop: false,
  result: {
    scenario_id: SCENARIO_ID,
    leading_option_id: 'o-launch',
    summary: 'prior analysis',
    enrichment: { analysis_status: 'complete' },
    graph_hash_at_run: PRE_EDIT_HASH,
    computed_at: '2026-05-01T02:00:00.000Z',
  },
};

const PRIOR_TURN_ROW = {
  id: 'row-prior-freshness-1',
  scenario_id: SCENARIO_ID,
  user_id: null,
  turn_id: 'prior-turn-freshness-1',
  turn_class: 'handler',
  handler_id: 'run_analysis',
  request_hash: 'sha256:prior-freshness-1',
  response_emitted: true,
  llm_calls_used: 0,
  duration_ms: 8,
  created_at: '2026-05-01T01:00:00.000Z',
  user_message: 'Run the analysis.',
  assistant_message: 'Analysis complete.',
};

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
let persisted: unknown = buildPersistedGraph();
let priorFacts: unknown[] = [PRIOR_RUN_ANALYSIS_FACT];
let priorTurns: unknown[] = [PRIOR_TURN_ROW];

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => priorTurns,
    readFactsFor: async () => priorFacts,
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const llmChatMock = vi.fn();
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === 'pipelineV4Enabled') return false;
              return Reflect.get(featTarget, featProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');

function payloadFor(event: Record<string, unknown>, suffix: string) {
  return {
    kind: 'system_event',
    turn_id: `${TURN_ID_BASE}${suffix}`,
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    event,
  };
}

interface WireBody {
  analysis_state?: {
    run_state?: { kind?: string; cause?: string; computed_at?: string };
    requires_rerun?: boolean;
  };
  analysis_ready?: { freshness?: string | null; freshness_reason?: string | null };
}

async function post(app: FastifyInstance, event: Record<string, unknown>, suffix: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: payloadFor(event, suffix),
  });
  return { statusCode: res.statusCode, body: JSON.parse(res.body) as WireBody };
}

describe('factor_value_edit — the turn that patched the graph states what it knows', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    appendMock.mockClear();
    llmChatMock.mockClear();
    persisted = buildPersistedGraph();
    priorFacts = [PRIOR_RUN_ANALYSIS_FACT];
    priorTurns = [PRIOR_TURN_ROW];
  });

  // ── PRECONDITION (trap 13b: pin what makes the verdict discriminating) ────

  it('PRECONDITION — the seeded prior analysis is genuinely FRESH against the pre-edit model', () => {
    // Without this, a `stale` verdict below could come from a mismatched
    // fixture rather than from the edit, and the test would pass for the
    // wrong reason.
    expect(PRE_EDIT_HASH).toEqual(expect.any(String));
    expect(PRIOR_RUN_ANALYSIS_FACT.result.graph_hash_at_run).toBe(PRE_EDIT_HASH);
  });

  // ── DIRECTION 1: the applied edit ────────────────────────────────────────

  it('APPLIED EDIT — run_state is complete_stale/graph_changed, NOT unknown_degraded/no_graph_this_turn', async () => {
    const { statusCode, body } = await post(
      app,
      { kind: 'factor_value_edit', target_id: 'f-budget', value: 0.5, raw_value: 50000, unit: '£' },
      '0',
    );

    expect(statusCode).toBe(200);
    // The graph really was written this turn — the precondition for the whole
    // claim. Bound by identity (the append carried a graph), never by a value
    // predicate another turn could satisfy.
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect((appendMock.mock.calls.at(-1)?.[0] as { graph?: unknown })?.graph).toBeDefined();

    // THE FAILING ASSERTION AT PRISTINE: `unknown_degraded` / `no_graph_this_turn`.
    expect(body.analysis_state?.run_state?.kind).toBe('complete_stale');
    expect(body.analysis_state?.run_state?.cause).toBe('graph_changed');
  });

  it('APPLIED EDIT — requires_rerun is TRUE, so the UI can label the Rerun affordance', async () => {
    const { body } = await post(
      app,
      { kind: 'factor_value_edit', target_id: 'f-budget', value: 0.5, raw_value: 50000, unit: '£' },
      '1',
    );
    expect(body.analysis_state?.requires_rerun).toBe(true);
  });

  it('APPLIED EDIT — analysis_ready carries the freshness fields the UI strip reads', async () => {
    const { body } = await post(
      app,
      { kind: 'factor_value_edit', target_id: 'f-budget', value: 0.5, raw_value: 50000, unit: '£' },
      '2',
    );
    expect(body.analysis_ready?.freshness).toBe('stale');
    expect(body.analysis_ready?.freshness_reason).toBe('graph_hash_diverged');
  });

  it('APPLIED EDIT — a NO-OP-valued edit that still writes reports fresh, not stale', async () => {
    // The opposite-direction twin (trap 22b): the fix must not simply hardcode
    // "an edit means stale". Re-applying the SAME value leaves the
    // analysis-affecting hash unmoved, so the prior analysis is still current.
    const { body } = await post(
      app,
      { kind: 'factor_value_edit', target_id: 'f-budget', value: 0.4, raw_value: 40000, unit: '£' },
      '3',
    );
    expect(body.analysis_state?.run_state?.kind).toBe('complete_current');
    expect(body.analysis_ready?.freshness).toBe('fresh');
  });

  // ── DIRECTION 2: the genuinely-no-graph turn, unchanged ───────────────────

  it('CONTROL — a REFUSED edit writes no graph and its verdict is UNCHANGED', async () => {
    // 150000 exceeds the 100000 cap → honest refusal, `graph: null`, no write.
    const { statusCode, body } = await post(
      app,
      { kind: 'factor_value_edit', target_id: 'f-budget', value: 1.5, raw_value: 150000, unit: '£' },
      '4',
    );

    expect(statusCode).toBe(200);
    // The precondition that makes this a genuinely-graph-less turn.
    expect((appendMock.mock.calls.at(-1)?.[0] as { graph?: unknown })?.graph).toBeUndefined();

    // BYTE-IDENTICAL TO PRISTINE. This exit genuinely had no graph in scope, so
    // `no_graph_this_turn` is a TRUE statement here and must survive the fix
    // untouched. Trading this understatement for an overstatement would be
    // strictly worse than the defect being fixed.
    expect(body.analysis_state?.run_state).toEqual({
      kind: 'unknown_degraded',
      cause: 'no_graph_this_turn',
    });
    expect(body.analysis_state?.requires_rerun).toBe(false);
    expect(body.analysis_ready?.freshness).toBeUndefined();
  });

  it('CONTROL — a scenario with NO prior analysis still reports never_run on an applied edit', async () => {
    // The other end of the ladder: the fix must not manufacture a claim about a
    // fact chain that does not exist.
    priorFacts = [];
    priorTurns = [];
    const { body } = await post(
      app,
      { kind: 'factor_value_edit', target_id: 'f-budget', value: 0.5, raw_value: 50000, unit: '£' },
      '5',
    );
    expect(body.analysis_state?.run_state?.kind).toBe('never_run');
    expect(body.analysis_state?.requires_rerun).toBe(false);
  });
});
