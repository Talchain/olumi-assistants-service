/**
 * ⭐⭐ THE OPTION-EFFECT CARRIER, ASSERTED AT THE WIRE — status code and body.
 *
 * ── WHY THIS FILE EXISTS, AND WHY THE UNIT TEST WAS NOT ENOUGH ──────────────
 * The sibling unit spec mocks the writer and asserts the dispatcher's booleans.
 * That is the right test for "does the arm hand the writer the right inputs" and
 * it is useless for the question this file answers: WHAT DOES THE CLIENT GET.
 *
 * An independent review found exactly that gap. `commitPerformed: false` with no
 * recognised skip reason becomes HTTP 500 `system_event_commit_failed`,
 * `retryable: true` at `route-v2`. So a same-value edit and a permanently stale
 * base — neither of which is a server failure, and neither of which can succeed
 * by being repeated — were both being advertised to the client as "retry this".
 * No dispatcher boolean can show that; only the response can.
 *
 * ── THE FOUR OUTCOMES ARE ASSERTED AS A SET, NOT INDIVIDUALLY ───────────────
 * They are driven through the REAL writer over the REAL route, differing only
 * in the request or the persisted model. A fix that collapsed any two of them
 * into one answer would pass a single case and fail the set.
 *
 *   committed      200 · analysis_ready stamped from the COMMITTED bytes
 *   verified no-op 200 · nothing written, nothing broken, nothing to retry
 *   stale base     409 · GRAPH_DIVERGED + refresh-and-reconfirm + the real hash
 *   refusal        422 · retryable:false — repeating it cannot help
 *
 * `unverified` is deliberately NOT forced here: it is the writer's
 * could-not-confirm state, it keeps the retryable 500 on purpose, and
 * manufacturing it would mean breaking the store mid-transaction to assert a
 * path whose whole point is that we do not know what happened.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../src/orchestrator-v5/persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';

function intervention(factorId: string, value: number) {
  return {
    value,
    source: 'cee_hypothesis',
    target_match: { node_id: factorId, match_type: 'exact_id', confidence: 'high' },
  };
}

/** An option wired to two factors, already holding 0.2 on the one under edit. */
function buildPersistedGraph() {
  return projectGraphForPersistence({
    ...GraphV3.parse({
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Service quality', goal_threshold: 0.1 },
        {
          id: 'option', kind: 'option', label: 'Pilot', provenance: 'ai_inferred',
          interventions: {
            factor: intervention('factor', 0.2),
            other_factor: intervention('other_factor', 0.55),
          },
        },
        {
          id: 'factor', kind: 'factor', label: 'Coverage',
          observed_state: {
            value: 0.5, baseline: 0.4, unit: '%', raw_value: 50, cap: 100, source: 'user_override',
          },
        },
        { id: 'other_factor', kind: 'factor', label: 'Reach', observed_state: { value: 0.6, source: 'brief_extraction' } },
        // A factor joined to the option the REVERSE way (unlinked_factor → option) — the refusal fixture: there is
        // no forward effect relationship, and a forward link beside the reverse one would make a cycle. (A factor
        // with NO edge to the option is no longer a refusal: the level brings its link, DL #70 5847137399.)
        { id: 'unlinked_factor', kind: 'factor', label: 'Unrelated', observed_state: { value: 0.3, source: 'brief_extraction' } },
        // A factor with no edge to the option at all: a level on it brings its option → factor link in the same commit.
        { id: 'new_factor', kind: 'factor', label: 'Adoption', observed_state: { value: 0.3, source: 'brief_extraction' } },
        // A factor with no value and no range yet (the served NEW-factor shape): a compound value gives it both.
        { id: 'amount_factor', kind: 'factor', label: 'Seats' },
        // A factor holding a bare amount with no range: a level read on it brings its range (today a SEPARATE commit).
        { id: 'bare_amount', kind: 'factor', label: 'Headcount', observed_state: { value: 40, source: 'brief_extraction' } },
      ],
      edges: [
        ['option', 'factor'], ['option', 'other_factor'], ['factor', 'goal'], ['other_factor', 'goal'],
        ['unlinked_factor', 'option'],
      ].map(([from, to]) => ({
        from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive',
      })),
    }),
    options: [] as Array<Record<string, unknown>>,
  });
}

/** JSONB's object key order (shorter keys first, then bytewise), applied recursively, through a JSON round trip. */
function jsonbRoundTrip(value: unknown): unknown {
  const order = (v: unknown): unknown => Array.isArray(v) ? v.map(order)
    : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v as Record<string, unknown>)
        .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
        .map(k => [k, order((v as Record<string, unknown>)[k])]))
      : v;
  return order(JSON.parse(JSON.stringify(value)));
}

let persisted: unknown = buildPersistedGraph();
/** When set, the store's atomic append reports this version receipt (as `append_turn_atomic_v5` does). */
let receiptFor: ((write: Record<string, unknown>) => Record<string, unknown>) | undefined;
const rows = new Map<string, { id: string; write: Record<string, unknown> }>();

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    readMostRecentPendingActions: async () => [],
    readFactsFor: async () => [],
    // No analysis has ever run on this fixture: a HEALTHY empty history, which
    // must derive `none` — a real verdict — and never `unknown`.
    readRecent: async () => [...rows.values()].reverse().map(r => ({
      id: r.id,
      scenario_id: r.write.scenario_id,
      turn_id: r.write.turn_id,
      turn_class: r.write.turn_class,
      handler_id: r.write.handler_id,
      request_hash: r.write.request_hash,
      response_emitted: r.write.response_emitted,
      llm_calls_used: r.write.llm_calls_used,
      duration_ms: r.write.duration_ms,
      assistant_message: r.write.assistantMessage ?? null,
      created_at: '2026-09-08T00:00:00.000Z',
    })),
    // The store's REAL read-back shape: each fact comes back from JSONB — keys re-ordered (by length, then bytes),
    // re-parsed — never the object that was written (AI Conversation #70 5849290342: a same-object fake hid a
    // key-order compare that fails on Supabase).
    readFactsWithTurnFor: async (ids: readonly string[]) => [...rows.values()].flatMap(r => {
      if (!ids.includes(r.id)) return [];
      const facts = (r.write.handler_facts ?? []) as unknown[];
      return facts.map(fact => ({ turn_id: r.id, fact_created_at: '2026-09-08T00:00:00.000Z', fact: jsonbRoundTrip(fact) }));
    }),
    append: async (write: Record<string, unknown>) => {
      const key = `${String(write.scenario_id)}/${String(write.turn_id)}`;
      const existing = rows.get(key);
      if (existing !== undefined) return { id: existing.id };
      const id = `row-${rows.size + 1}`;
      rows.set(key, { id, write: JSON.parse(JSON.stringify(write)) });
      if (write.graph !== undefined) persisted = write.graph;
      return { id, ...(receiptFor !== undefined ? { modelVersionReceipt: receiptFor(write) } : {}) };
    },
    getScenarioOwner: async () => null,
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

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');
const { runWithApprovedLevelAdoption } = await import('../../../src/orchestrator-v5/agent-lane/approved-adoption-context.js');

const SCENARIO_ID = '55555555-5555-4555-8555-555555555555';
let turnCounter = 0;

function turnId(): string {
  turnCounter += 1;
  return `66666666-6666-4666-8666-6666666666${String(turnCounter).padStart(2, '0')}`;
}

function currentHash(): string {
  const hash = computeAnalysisAffectingGraphHash(persisted as never);
  if (hash === null) throw new Error('fixture must have an analysis-affecting hash');
  return hash;
}

async function post(app: FastifyInstance, event: Record<string, unknown>) {
  return await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: { kind: 'system_event', turn_id: turnId(), scenario_id: SCENARIO_ID, stage: 'analyse', event },
  });
}

describe('POST /orchestrate/v2/turn — option_intervention_edit, at the wire', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    persisted = buildPersistedGraph();
    rows.clear();
    llmChatMock.mockClear();
  });

  it('COMMITTED — 200, the value lands, and readiness comes from the COMMITTED bytes', async () => {
    const before = currentHash();
    const res = await post(app, {
      kind: 'option_intervention_edit',
      option_id: 'option', factor_id: 'factor', value: 0.3, base_graph_hash: before,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // The durable model moved, and it moved on the named cell only.
    const option = (persisted as { nodes: Array<Record<string, unknown>> }).nodes
      .find(n => n.id === 'option') as { interventions: Record<string, { value: number }> };
    expect(option.interventions.factor.value).toBe(0.3);
    expect(option.interventions.other_factor.value).toBe(0.55);

    // ⭐ THE POST-WRITE AUTHORITY, which the first cut of this arm dropped.
    // `analysis_ready` absent here is what made the finaliser fall back to
    // unknown-degraded on a route whose whole purpose is changing the model.
    expect(body.analysis_ready, 'the committed edit shipped no readiness').toBeDefined();
    // Derived against the COMMITTED hash, not the client's asserted base.
    expect(body.graph_hash).toBeDefined();
    expect(body.graph_hash).not.toBe(before);
  });

  /**
   * ⭐ THE ADOPTION IDENTITY SURVIVES THE REAL ROUTE (review of #1902 at `8317a0d0`, residual 1). The
   * Agent's approval dispatches in-process through `app.inject()`; AsyncLocalStorage must reach the
   * writer through Fastify's handler, not only through a direct call. Cold read of the durable bytes.
   */
  it('ADOPTED — inside its adoption identity the cell lands cee_hypothesis at the wire; without it, user_specified', async () => {
    const adopted = await runWithApprovedLevelAdoption(
      { scenarioId: SCENARIO_ID, proposalId: 'prop_route', optionId: 'option', factorId: 'factor', modelValue: 0.3 },
      () => post(app, { kind: 'option_intervention_edit', option_id: 'option', factor_id: 'factor', value: 0.3, base_graph_hash: currentHash() }),
    );
    expect(adopted.statusCode).toBe(200);
    const cell = () => ((persisted as { nodes: Array<Record<string, unknown>> }).nodes
      .find(n => n.id === 'option') as { interventions: Record<string, { value: number; source: string }> }).interventions.factor;
    expect(cell()).toMatchObject({ value: 0.3, source: 'cee_hypothesis' });

    const typed = await post(app, { kind: 'option_intervention_edit', option_id: 'option', factor_id: 'factor', value: 0.35, base_graph_hash: currentHash() });
    expect(typed.statusCode).toBe(200);
    expect(cell()).toMatchObject({ value: 0.35, source: 'user_specified' });
  });

  it('VERIFIED NO-OP — 200, not a retryable server failure', async () => {
    // The model already holds 0.2 for this cell. Nothing is written, and
    // nothing has gone wrong: telling the client to retry would be false.
    const res = await post(app, {
      kind: 'option_intervention_edit',
      option_id: 'option', factor_id: 'factor', value: 0.2, base_graph_hash: currentHash(),
    });

    expect(res.statusCode).toBe(200);
    expect(rows.size, 'a no-op must not append a turn row').toBe(0);
    const body = JSON.parse(res.body);
    expect(body.error).toBeUndefined();
  });

  it('STALE BASE — 409 GRAPH_DIVERGED with a followable refresh-and-reconfirm', async () => {
    const res = await post(app, {
      kind: 'option_intervention_edit',
      option_id: 'option', factor_id: 'factor', value: 0.7,
      base_graph_hash: 'deadbeefdeadbeef',
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('GRAPH_DIVERGED');
    expect(body.details.retryable).toBe(false);
    expect(body.details.recovery_action).toBe('refresh_and_reconfirm');
    // ⚠ The hash must be the one the client can actually hold and resend —
    // analysis space, read from the CURRENT graph. A null here makes the
    // instruction unfollowable, which is the defect this field exists to close.
    expect(body.details.expected_base_graph_hash).toBe(currentHash());
    expect(rows.size, 'a refused write must append nothing').toBe(0);
  });

  it('REFUSAL — 422, NOT retryable: repeating an unhonourable request cannot help', async () => {
    // The factor exists but the option is not wired to it, so there is no effect
    // relationship to set. Correct base hash, so this is not a conflict.
    const res = await post(app, {
      kind: 'option_intervention_edit',
      option_id: 'option', factor_id: 'unlinked_factor', value: 0.4, base_graph_hash: currentHash(),
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.details.retryable, 'a permanent refusal advertised as retryable').toBe(false);
    expect(rows.size).toBe(0);
  });

  it('A LEVEL BRINGS ITS LINK — 200: an option with no edge to the factor gets the link AND the level in ONE row (DL #70 5847137399)', async () => {
    const res = await post(app, {
      kind: 'option_intervention_edit',
      option_id: 'option', factor_id: 'new_factor', value: 0.4, base_graph_hash: currentHash(),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(rows.size, 'ONE commit: the link and the level land together').toBe(1);
    const written = [...rows.values()][0]!.write.graph as { edges: { from: string; to: string }[]; nodes: { id: string; interventions?: Record<string, { value: number }> }[] };
    expect(written.edges.filter(e => e.from === 'option' && e.to === 'new_factor')).toHaveLength(1);
    expect(written.nodes.find(n => n.id === 'option')?.interventions?.new_factor?.value).toBe(0.4);
  });

  it('THE SET DISCRIMINATES — the four outcomes are four different answers', async () => {
    // The guard against a "fix" that learns one answer. Same event kind, same
    // scenario, same store: only the request or the model differs.
    const committed = await post(app, {
      kind: 'option_intervention_edit',
      option_id: 'option', factor_id: 'factor', value: 0.35, base_graph_hash: currentHash(),
    });
    const noop = await post(app, {
      kind: 'option_intervention_edit',
      option_id: 'option', factor_id: 'factor', value: 0.35, base_graph_hash: currentHash(),
    });
    const stale = await post(app, {
      kind: 'option_intervention_edit',
      option_id: 'option', factor_id: 'factor', value: 0.9, base_graph_hash: 'deadbeefdeadbeef',
    });
    const refused = await post(app, {
      kind: 'option_intervention_edit',
      option_id: 'option', factor_id: 'unlinked_factor', value: 0.4, base_graph_hash: currentHash(),
    });

    expect([committed.statusCode, noop.statusCode, stale.statusCode, refused.statusCode])
      .toEqual([200, 200, 409, 422]);
    // …and the two 200s are not the same 200: one wrote, one did not.
    expect(rows.size, 'exactly one of the two 200s should have appended').toBe(1);
  });
});

describe('the Agent\'s in-process batch door — ONE user operation → ONE atomic commit (ChatGPT #70 5847200462, BF5)', () => {
  let commitOptionLevelsInProcess: typeof import('../../../src/orchestrator-v5/system-events/dispatch.js').commitOptionLevelsInProcess;
  beforeAll(async () => {
    ({ commitOptionLevelsInProcess } = await import('../../../src/orchestrator-v5/system-events/dispatch.js'));
  });
  beforeEach(() => {
    persisted = buildPersistedGraph();
    rows.clear();
  });
  type Level = { option_id: string; factor_id: string; value: number; author: 'user_specified' | 'model_proposed'; raw_value?: number; unit?: string; cap?: number };
  const call = (levels: Level[], links: { option_id: string; factor_id: string }[], turnId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') =>
    commitOptionLevelsInProcess({ scenario_id: SCENARIO_ID, turn_id: turnId, base_graph_hash: currentHash(), links, levels }, 'req-batch');
  const graphNow = () => persisted as { edges: { from: string; to: string; provenance?: { source?: string } }[];
    nodes: { id: string; interventions?: Record<string, { value: number; source?: string }> }[] };
  const TWO: Level[] = [{ option_id: 'option', factor_id: 'factor', value: 0.35, author: 'user_specified' },
    { option_id: 'option', factor_id: 'new_factor', value: 0.4, author: 'user_specified' }];
  const NEW_LINK = [{ option_id: 'option', factor_id: 'new_factor' }];

  it('RED: two levels — one bringing its link — commit as ONE row: committed, not already applied, the revision is the model\'s', async () => {
    const r = await call(TWO, NEW_LINK);
    expect(r, JSON.stringify(r)).toMatchObject({ status: 'committed', already_applied: false, committed_levels: [
      { option_id: 'option', factor_id: 'factor', value: 0.35 }, { option_id: 'option', factor_id: 'new_factor', value: 0.4 }] });
    expect(rows.size).toBe(1);
    if (r.status === 'committed') expect(r.graph_hash).toBe(currentHash());
    expect(graphNow().edges.filter(e => e.from === 'option' && e.to === 'new_factor')).toHaveLength(1);
    expect(graphNow().nodes.find(n => n.id === 'option')?.interventions?.factor?.value).toBe(0.35);
    expect(graphNow().nodes.find(n => n.id === 'option')?.interventions?.new_factor?.value).toBe(0.4);
  });

  it('RED: the SECOND level refused → refused, naming its pair, and NOTHING committed (neither the first level nor the link)', async () => {
    const before = JSON.stringify(persisted);
    const r = await call([TWO[1]!, { option_id: 'option', factor_id: 'unlinked_factor', value: 0.4, author: 'user_specified' }], NEW_LINK);
    expect(r).toEqual({ status: 'refused', reason: 'unresolved_effect_relationship', pair: { option_id: 'option', factor_id: 'unlinked_factor' } });
    expect(rows.size).toBe(0);
    expect(JSON.stringify(persisted)).toBe(before);
  });

  it('what was approved is what is written: links that differ from the ones the levels need → refused, nothing written', async () => {
    const r = await call(TWO, []);
    expect(r).toEqual({ status: 'refused', reason: 'links_mismatch' });
    expect(rows.size).toBe(0);
  });

  it('RED: a retry of the committed batch writes nothing more — already applied, no receipt — and the model holds both levels', async () => {
    expect((await call(TWO, NEW_LINK)).status).toBe('committed');
    const retry = await call(TWO, [], 'ffffffff-ffff-4fff-8fff-ffffffffffff');
    expect(retry).toEqual({ status: 'committed', graph_hash: currentHash(), receipt: null, already_applied: true,
      committed_levels: TWO.map(l => ({ option_id: l.option_id, factor_id: l.factor_id, value: l.value })), links_resized: [] });
    expect(rows.size).toBe(1);
  });

  it('an Olumi level (model_proposed) is stamped Olumi\'s — the level AND the link it brings (#2004 N1) — through the server-side authority', async () => {
    const r = await call([{ option_id: 'option', factor_id: 'new_factor', value: 0.4, author: 'model_proposed' }], NEW_LINK);
    expect(r.status, JSON.stringify(r)).toBe('committed');
    expect(graphNow().nodes.find(n => n.id === 'option')?.interventions?.new_factor?.source).toBe('cee_hypothesis');
    expect(graphNow().edges.find(e => e.from === 'option' && e.to === 'new_factor')?.provenance?.source).toBe('cee_hypothesis');
  });

  it('ONE receipt: a committed batch hands back the commit\'s OWN version receipt, bound to this turn (Canvas N, #2007)', async () => {
    receiptFor = (write) => ({
      mutation_id: '33333333-3333-4333-8333-333333333333', version_id: '44444444-4444-4444-8444-444444444444', version_number: 7,
      graph_identity_hash: 'a'.repeat(64), analysis_affecting_hash: 'b'.repeat(64), hash_algorithm: 'sha256',
      identity_projection_version: 'v1', identity_normaliser_version: 'v1', graph_schema_version: 'graph.v3',
      actor_kind: 'system', authored_by: null, creation_kind: 'committed_mutation', source_version_id: null,
      parent_version_id: null, root_version_id: null, undo_version_id: null, event_id: 'evt-batch',
      graph: write.graph, source_turn_id: write.turn_id,
    });
    try {
      const r = await call(TWO, NEW_LINK);
      expect(r, JSON.stringify(r)).toMatchObject({ status: 'committed', already_applied: false, receipt: {
        version: 7, version_id: '44444444-4444-4444-8444-444444444444', mutation_id: '33333333-3333-4333-8333-333333333333',
        source_turn_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' } });
      expect(rows.size, 'ONE commit carries it').toBe(1);
    } finally {
      receiptFor = undefined;
    }
  });

  it('RED (AI Conversation 5848429576): a level carries the user\'s FIGURE — raw value, unit, range — onto the cell in the SAME commit', async () => {
    const r = await call([{ option_id: 'option', factor_id: 'new_factor', value: 0.1, author: 'user_specified', raw_value: 10, unit: '£ per month', cap: 100 } as Level], NEW_LINK);
    expect(r.status, JSON.stringify(r)).toBe('committed');
    expect(rows.size, 'ONE commit').toBe(1);
    const cell = graphNow().nodes.find(n => n.id === 'option')?.interventions?.new_factor as Record<string, unknown> | undefined;
    expect(cell, JSON.stringify(cell)).toMatchObject({ value: 0.1, raw_value: 10, unit: '£ per month', cap: 100, source: 'user_specified' });
  });

  it('RED (DL 5848777655): a £0 level keeps its range — the one case raw_value ÷ value cannot recover (0 ÷ 0)', async () => {
    const r = await call([{ option_id: 'option', factor_id: 'new_factor', value: 0, author: 'user_specified', raw_value: 0, unit: '£ per month', cap: 100 } as Level], NEW_LINK);
    expect(r.status, JSON.stringify(r)).toBe('committed');
    const cell = graphNow().nodes.find(n => n.id === 'option')?.interventions?.new_factor as Record<string, unknown> | undefined;
    expect(cell, JSON.stringify(cell)).toMatchObject({ value: 0, raw_value: 0, cap: 100, source: 'user_specified' });
  });

  it('a NEW number never inherits the old figure\'s range: a later level without a figure drops raw_value AND cap', async () => {
    expect((await call([{ option_id: 'option', factor_id: 'new_factor', value: 0.1, author: 'user_specified', raw_value: 10, unit: '£ per month', cap: 100 } as Level], NEW_LINK)).status).toBe('committed');
    const r = await call([{ option_id: 'option', factor_id: 'new_factor', value: 0.3, author: 'user_specified' }], [], 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    expect(r.status, JSON.stringify(r)).toBe('committed');
    const cell = graphNow().nodes.find(n => n.id === 'option')?.interventions?.new_factor as Record<string, unknown> | undefined;
    expect(cell?.value, JSON.stringify(cell)).toBe(0.3);
    expect('cap' in (cell ?? {}) || 'raw_value' in (cell ?? {}), JSON.stringify(cell)).toBe(false);
  });

  it('a figure that does not normalise to the level it is sent with is refused whole — nothing written', async () => {
    const r = await call([{ option_id: 'option', factor_id: 'new_factor', value: 0.2, author: 'user_specified', raw_value: 10, unit: '£ per month', cap: 100 } as Level], NEW_LINK);
    expect(r).toMatchObject({ status: 'refused', reason: 'level_frame_mismatch' });
    expect(rows.size).toBe(0);
  });

  describe('⭐ a COMPOUND approval — values AND levels — is ONE commit (Canonical #70 5849037691)', () => {
    type Value = { factor_id: string; value: number; unit?: string; author: 'user_specified' | 'model_proposed' };
    type Frame = { factor_id: string; cap: number };
    const callWith = (values: Value[], levels: Level[], links: { option_id: string; factor_id: string }[], turnId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', frames: Frame[] = []) =>
      commitOptionLevelsInProcess({ scenario_id: SCENARIO_ID, turn_id: turnId, base_graph_hash: currentHash(), links, levels, values,
        ...(frames.length > 0 ? { frames } : {}) }, 'req-compound');
    const factorOs = (id: string) => (graphNow().nodes.find(n => n.id === id) as { observed_state?: Record<string, unknown> } | undefined)?.observed_state;
    const COVERAGE_60: Value[] = [{ factor_id: 'factor', value: 60, unit: '%', author: 'user_specified' }];

    it('RED: the user\'s value and two levels (one bringing its link) land in ONE row, ONE receipt', async () => {
      receiptFor = (write) => ({
        mutation_id: '33333333-3333-4333-8333-333333333333', version_id: '55555555-5555-4555-8555-555555555555', version_number: 8,
        graph_identity_hash: 'a'.repeat(64), analysis_affecting_hash: 'b'.repeat(64), hash_algorithm: 'sha256',
        identity_projection_version: 'v1', identity_normaliser_version: 'v1', graph_schema_version: 'graph.v3',
        actor_kind: 'system', authored_by: null, creation_kind: 'committed_mutation', source_version_id: null,
        parent_version_id: null, root_version_id: null, undo_version_id: null, event_id: 'evt-compound',
        graph: write.graph, source_turn_id: write.turn_id,
      });
      try {
        const r = await callWith(COVERAGE_60, TWO, NEW_LINK);
        expect(r, JSON.stringify(r)).toMatchObject({ status: 'committed', already_applied: false,
          receipt: { version: 8, version_id: '55555555-5555-4555-8555-555555555555', source_turn_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } });
        expect(rows.size, 'ONE append for the value, the link and both levels').toBe(1);
        expect(factorOs('factor'), JSON.stringify(factorOs('factor'))).toMatchObject({ value: 0.6, raw_value: 60 });
        expect(graphNow().nodes.find(n => n.id === 'option')?.interventions?.factor?.value).toBe(0.35);
        expect(graphNow().nodes.find(n => n.id === 'option')?.interventions?.new_factor?.value).toBe(0.4);
        expect(graphNow().edges.filter(e => e.from === 'option' && e.to === 'new_factor')).toHaveLength(1);
        if (r.status === 'committed') expect(r.graph_hash).toBe(currentHash());
        // The ONE row carries BOTH writers' facts — the value's (`set_factor_value`) and the links+levels' (`edit_graph`).
        expect(([...rows.values()][0]!.write.handler_facts as { fact_type: string }[]).map(f => f.fact_type).sort())
          .toEqual(['edit_graph', 'set_factor_value']);
      } finally {
        receiptFor = undefined;
      }
    });

    it('RED: a level refused → the VALUE is not written either (no half of the approval lands)', async () => {
      const before = JSON.stringify(persisted);
      const r = await callWith(COVERAGE_60, [TWO[1]!, { option_id: 'option', factor_id: 'unlinked_factor', value: 0.4, author: 'user_specified' }], NEW_LINK);
      expect(r).toEqual({ status: 'refused', reason: 'unresolved_effect_relationship', pair: { option_id: 'option', factor_id: 'unlinked_factor' } });
      expect(rows.size).toBe(0);
      expect(JSON.stringify(persisted)).toBe(before);
    });

    it('a value refused → refused naming that value, and NOTHING written (not the levels either)', async () => {
      const before = JSON.stringify(persisted);
      const r = await callWith([{ factor_id: 'option', value: 3, author: 'user_specified' }], TWO, NEW_LINK);
      expect(r).toEqual({ status: 'refused', reason: 'value_target_not_factor', value: { factor_id: 'option' } });
      expect(rows.size).toBe(0);
      expect(JSON.stringify(persisted)).toBe(before);
    });

    it('RED (Canonical #70 5850018984): a VALUES-ONLY approval (Olumi\'s starting point) is ONE commit — every value, one row, one receipt', async () => {
      const r = await callWith([{ factor_id: 'factor', value: 60, unit: '%', author: 'model_proposed' },
        { factor_id: 'amount_factor', value: 10, unit: 'seats', author: 'model_proposed' }], [], [], 'cccccccc-cccc-4ccc-8ccc-cccccccccca5',
      [{ factor_id: 'amount_factor', cap: 100 }]);
      expect(r, JSON.stringify(r)).toMatchObject({ status: 'committed', already_applied: false, committed_levels: [] });
      expect(rows.size, 'every value of the approval: ONE append').toBe(1);
      expect(factorOs('factor')).toMatchObject({ value: 0.6, raw_value: 60, source: 'user_assumption' });
      expect(factorOs('amount_factor')).toMatchObject({ value: 0.1, raw_value: 10, cap: 100, source: 'user_assumption' });
      expect(([...rows.values()][0]!.write.handler_facts as { fact_type: string }[]).map(f => f.fact_type)).toEqual(['set_factor_value', 'set_factor_value']);
    });

    it('RED (DL 5850026671, served F1s shape): Olumi\'s 3 starting values on the served graph → ONE commit, and churn\'s links follow its level', async () => {
      const served = JSON.parse(readFileSync('tests/fixtures/magnitude/c-run1-served-graphs.json', 'utf-8')).run1_step01;
      persisted = projectGraphForPersistence(structuredClone(served));
      const START = [
        { factor_id: 'monthly_churn', value: 5, unit: '% of Pro subscribers per month', author: 'model_proposed' as const },
        { factor_id: 'active_pro_subscribers', value: 250, unit: 'Pro subscribers', author: 'model_proposed' as const },
        { factor_id: 'new_pro_subscriber_acquisition', value: 30, unit: 'new Pro subscribers per month', author: 'model_proposed' as const },
      ];
      const r = await callWith(START, [], [], 'cccccccc-cccc-4ccc-8ccc-cccccccccc10');
      expect(r, JSON.stringify(r)).toMatchObject({ status: 'committed', already_applied: false });
      expect(rows.size, 'the served 3 commits are ONE').toBe(1);
      expect(([...rows.values()][0]!.write.handler_facts as { fact_type: string }[]).filter(f => f.fact_type === 'set_factor_value')).toHaveLength(3);
      for (const v of START) expect(factorOs(v.factor_id), v.factor_id).toMatchObject({ raw_value: v.value, source: 'user_assumption' });
      const into = (from: string) => (graphNow().edges as { from: string; to: string; strength: { mean: number } }[]).find(e => e.from === from && e.to === 'monthly_churn')!;
      expect(into('price_sensitivity').strength.mean).toBe(0.0125);
      // A retry of the same approval adds no version.
      const retry = await callWith(START, [], [], 'cccccccc-cccc-4ccc-8ccc-cccccccccc11');
      expect(retry, JSON.stringify(retry)).toMatchObject({ status: 'committed', already_applied: true, receipt: null });
      expect(rows.size).toBe(1);
    });

    describe('⭐ P1-a (DL #70 5850069309, shape AI Quality 5850079041): the receipt names Olumi\'s links a value re-sized', () => {
      const CHURN_TO = (value: number) => [{ factor_id: 'monthly_churn', value, unit: '% of Pro subscribers per month', author: 'user_specified' as const }];
      // The ONE row's own conversation text: the receipt the user reads, as the commit persisted it.
      const said = () => String([...rows.values()][0]!.write.assistantMessage);
      const INTO_CHURN = [{ from: 'ai_feature_availability', to: 'monthly_churn' }, { from: 'price_sensitivity', to: 'monthly_churn' }];
      const byPair = (l: readonly { from: string; to: string }[]) => [...l].map(x => ({ from: x.from, to: x.to })).sort((a, b) => a.from.localeCompare(b.from));

      it('RED (served 201724Z, churn 7 → 12): BOTH links into churn are named — on the door result AND in the ONE receipt', async () => {
        const served = JSON.parse(readFileSync('tests/fixtures/magnitude/c-run1-served-graphs.json', 'utf-8')).run1_step01;
        persisted = projectGraphForPersistence(structuredClone(served));
        expect((await callWith(CHURN_TO(7), [], [], 'cccccccc-cccc-4ccc-8ccc-cccccccccc20')).status).toBe('committed');
        rows.clear();
        const r = await callWith(CHURN_TO(12), [], [], 'cccccccc-cccc-4ccc-8ccc-cccccccccc21');
        expect(r, JSON.stringify(r)).toMatchObject({ status: 'committed', already_applied: false });
        if (r.status !== 'committed') return;
        expect(byPair((r.links_resized ?? []).filter(l => l.to === 'monthly_churn'))).toEqual(INTO_CHURN);
        // Every pair named is one the committed graph actually re-sized, and no pair is named twice.
        expect(new Set((r.links_resized ?? []).map(l => `${l.from}::${l.to}`)).size).toBe((r.links_resized ?? []).length);
        expect(said()).toContain('Olumi also re-sized its own placeholder links into "Monthly churn" so they fit the new level');
        expect(said()).toContain('"Price sensitivity"');
        expect(said()).toContain('"AI feature availability"');
        expect(said()).toContain('They are Olumi\'s placeholders, not measurements.');
      });

      it('CONTRAST: a value on a factor with NO Olumi-sized link → an empty list and NO re-size line', async () => {
        const r = await callWith([{ factor_id: 'factor', value: 60, unit: '%', author: 'user_specified' }], [], [], 'cccccccc-cccc-4ccc-8ccc-cccccccccc22');
        expect(r, JSON.stringify(r)).toMatchObject({ status: 'committed', already_applied: false, links_resized: [] });
        expect(said()).not.toContain('re-sized');
      });

      it('CONTROL: a link the USER sized is never named (and never moved) — only Olumi\'s own link into churn is', async () => {
        const served = JSON.parse(readFileSync('tests/fixtures/magnitude/c-run1-served-graphs.json', 'utf-8')).run1_step01;
        const users = served.edges.find((e: { from: string; to: string }) => e.from === 'price_sensitivity' && e.to === 'monthly_churn');
        users.provenance = { source: 'user_specified' };
        persisted = projectGraphForPersistence(structuredClone(served));
        const usersBefore = structuredClone((persisted as { edges: { from: string; to: string }[] }).edges.find(e => e.from === 'price_sensitivity' && e.to === 'monthly_churn'));
        const r = await callWith(CHURN_TO(12), [], [], 'cccccccc-cccc-4ccc-8ccc-cccccccccc23');
        expect(r, JSON.stringify(r)).toMatchObject({ status: 'committed', already_applied: false });
        if (r.status !== 'committed') return;
        expect(byPair((r.links_resized ?? []).filter(l => l.to === 'monthly_churn'))).toEqual([{ from: 'ai_feature_availability', to: 'monthly_churn' }]);
        expect(said()).toContain('("AI feature availability")');
        expect(said()).not.toContain('"Price sensitivity"');
        expect((graphNow().edges as { from: string; to: string }[]).find(e => e.from === 'price_sensitivity' && e.to === 'monthly_churn')).toStrictEqual(usersBefore);
      });

      it('a retry re-sizes nothing: already applied, an empty list', async () => {
        const served = JSON.parse(readFileSync('tests/fixtures/magnitude/c-run1-served-graphs.json', 'utf-8')).run1_step01;
        persisted = projectGraphForPersistence(structuredClone(served));
        expect((await callWith(CHURN_TO(12), [], [], 'cccccccc-cccc-4ccc-8ccc-cccccccccc24')).status).toBe('committed');
        const retry = await callWith(CHURN_TO(12), [], [], 'cccccccc-cccc-4ccc-8ccc-cccccccccc25');
        expect(retry, JSON.stringify(retry)).toMatchObject({ status: 'committed', already_applied: true, receipt: null, links_resized: [] });
      });
    });

    it('served F1s shape with ONE value refused → NONE of the starting values is written (persisted byte-identical)', async () => {
      const served = JSON.parse(readFileSync('tests/fixtures/magnitude/c-run1-served-graphs.json', 'utf-8')).run1_step01;
      persisted = projectGraphForPersistence(structuredClone(served));
      const before = JSON.stringify(persisted);
      const r = await callWith([
        { factor_id: 'monthly_churn', value: 5, unit: '% of Pro subscribers per month', author: 'model_proposed' },
        { factor_id: 'raise_to_59_at_release', value: 3, author: 'model_proposed' },
      ], [], [], 'cccccccc-cccc-4ccc-8ccc-cccccccccc12');
      expect(r).toEqual({ status: 'refused', reason: 'value_target_not_factor', value: { factor_id: 'raise_to_59_at_release' } });
      expect(rows.size).toBe(0);
      expect(JSON.stringify(persisted)).toBe(before);
    });

    it('a values-only approval with ONE value refused → nothing written, the other value included (persisted byte-identical)', async () => {
      const before = JSON.stringify(persisted);
      const r = await callWith([{ factor_id: 'factor', value: 60, unit: '%', author: 'model_proposed' }, { factor_id: 'option', value: 3, author: 'model_proposed' }], [], [],
        'cccccccc-cccc-4ccc-8ccc-cccccccccca6');
      expect(r).toEqual({ status: 'refused', reason: 'value_target_not_factor', value: { factor_id: 'option' } });
      expect(rows.size).toBe(0);
      expect(JSON.stringify(persisted)).toBe(before);
    });

    it('a retry of a committed values-only approval writes nothing more — already applied', async () => {
      const V = [{ factor_id: 'factor', value: 60, unit: '%', author: 'model_proposed' as const }];
      expect((await callWith(V, [], [], 'cccccccc-cccc-4ccc-8ccc-cccccccccca7')).status).toBe('committed');
      const retry = await callWith(V, [], [], 'cccccccc-cccc-4ccc-8ccc-cccccccccca8');
      expect(retry, JSON.stringify(retry)).toMatchObject({ status: 'committed', already_applied: true, receipt: null });
      expect(rows.size).toBe(1);
    });

    it('an EMPTY approval (no level, no value, no range) is still refused — nothing to write', async () => {
      const r = await callWith([], [], [], 'cccccccc-cccc-4ccc-8ccc-cccccccccca9');
      expect(r).toMatchObject({ status: 'refused', reason: 'no_targets' });
      expect(rows.size).toBe(0);
    });

    it('a stale base → stale, and the value is not applied (the persisted model is byte-identical)', async () => {
      const before = JSON.stringify(persisted);
      const r = await commitOptionLevelsInProcess({ scenario_id: SCENARIO_ID, turn_id: 'abababab-abab-4bab-8bab-abababababac',
        base_graph_hash: 'deadbeefdeadbeef', links: NEW_LINK, levels: TWO, values: COVERAGE_60 }, 'req-compound');
      expect(r).toEqual({ status: 'stale' });
      expect(rows.size).toBe(0);
      expect(JSON.stringify(persisted)).toBe(before);
    });

    it('RED (AI Conversation N1): a range whose level the model ALREADY holds still commits — never silently dropped', async () => {
      const held: Level = { option_id: 'option', factor_id: 'factor', value: 0.2, author: 'user_specified' };
      const r = await callWith([], [held], [], 'cccccccc-cccc-4ccc-8ccc-cccccccccca2', [{ factor_id: 'bare_amount', cap: 100 }]);
      expect(r, JSON.stringify(r)).toMatchObject({ status: 'committed', already_applied: false });
      expect(rows.size, 'the range is ONE commit').toBe(1);
      expect(factorOs('bare_amount')).toMatchObject({ value: 0.4, raw_value: 40, cap: 100 });
    });

    it('RED: a value on a factor with NO range, and the range the approval disclosed, land in the SAME commit as the level', async () => {
      const r = await callWith([{ factor_id: 'amount_factor', value: 10, unit: 'seats', author: 'user_specified' }], [TWO[0]!], [],
        'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', [{ factor_id: 'amount_factor', cap: 100 }]);
      expect(r.status, JSON.stringify(r)).toBe('committed');
      expect(rows.size).toBe(1);
      expect(factorOs('amount_factor'), JSON.stringify(factorOs('amount_factor'))).toMatchObject({ value: 0.1, raw_value: 10, cap: 100, unit: 'seats', declared_scale: 'unit_interval' });
    });

    it('RED (the separate range commit): a level\'s range for a factor holding a bare amount lands WITH the level — no value, one commit', async () => {
      const r = await callWith([], [TWO[0]!], [], 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', [{ factor_id: 'bare_amount', cap: 100 }]);
      expect(r.status, JSON.stringify(r)).toBe('committed');
      expect(rows.size).toBe(1);
      expect(factorOs('bare_amount')).toMatchObject({ value: 0.4, raw_value: 40, cap: 100, declared_scale: 'unit_interval' });
      expect(graphNow().nodes.find(n => n.id === 'option')?.interventions?.factor?.value).toBe(0.35);
    });

    it('an Olumi value the user approved is stored as the user\'s ASSUMPTION, not their own figure — through the writer\'s adoption authority', async () => {
      const r = await callWith([{ factor_id: 'factor', value: 60, unit: '%', author: 'model_proposed' }], [TWO[0]!], [], 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3');
      expect(r.status, JSON.stringify(r)).toBe('committed');
      expect(factorOs('factor')?.source, JSON.stringify(factorOs('factor'))).toBe('user_assumption');
    });

    it('a range for a factor that already declares one is refused — naming it — and nothing is written', async () => {
      const before = JSON.stringify(persisted);
      const r = await callWith(COVERAGE_60, TWO, NEW_LINK, 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4', [{ factor_id: 'factor', cap: 1000 }]);
      expect(r).toEqual({ status: 'refused', reason: 'frame_not_applicable', frame: { factor_id: 'factor' } });
      expect(rows.size).toBe(0);
      expect(JSON.stringify(persisted)).toBe(before);
    });

    it('RED (Canvas 5849242463): a range + a REFUSED level → nothing lands, not even the range (no in-place write to the read graph)', async () => {
      const before = JSON.stringify(persisted);
      const r = await callWith([], [TWO[1]!, { option_id: 'option', factor_id: 'unlinked_factor', value: 0.4, author: 'user_specified' }], NEW_LINK,
        'cccccccc-cccc-4ccc-8ccc-ccccccccccc9', [{ factor_id: 'bare_amount', cap: 100 }]);
      expect(r).toEqual({ status: 'refused', reason: 'unresolved_effect_relationship', pair: { option_id: 'option', factor_id: 'unlinked_factor' } });
      expect(rows.size).toBe(0);
      expect(JSON.stringify(persisted)).toBe(before);
    });

    it('a value on one factor + a range on ANOTHER + a refused level → the read graph is untouched (no aliasing through the value writer\'s merge)', async () => {
      const before = JSON.stringify(persisted);
      const r = await callWith(COVERAGE_60, [TWO[1]!, { option_id: 'option', factor_id: 'unlinked_factor', value: 0.4, author: 'user_specified' }], NEW_LINK,
        'cccccccc-cccc-4ccc-8ccc-cccccccccca0', [{ factor_id: 'bare_amount', cap: 100 }]);
      expect(r).toEqual({ status: 'refused', reason: 'unresolved_effect_relationship', pair: { option_id: 'option', factor_id: 'unlinked_factor' } });
      expect(rows.size).toBe(0);
      expect(JSON.stringify(persisted)).toBe(before);
    });

    it('(R&C 5849235251) an Olumi value on a factor with NO range is stored as the user\'s assumption too — never their own figure', async () => {
      const r = await callWith([{ factor_id: 'amount_factor', value: 10, unit: 'seats', author: 'model_proposed' }], [TWO[0]!], [],
        'cccccccc-cccc-4ccc-8ccc-cccccccccca1', [{ factor_id: 'amount_factor', cap: 100 }]);
      expect(r.status, JSON.stringify(r)).toBe('committed');
      expect(factorOs('amount_factor'), JSON.stringify(factorOs('amount_factor'))).toMatchObject({ value: 0.1, raw_value: 10, cap: 100, source: 'user_assumption' });
    });

    it('RED (MG 5849417275, served F1 starting point): Olumi\'s churn 5% + a level → ONE commit, and the 2 links into churn follow the level', async () => {
      const served = JSON.parse(readFileSync('tests/fixtures/magnitude/c-run1-served-graphs.json', 'utf-8')).run1_step01;
      persisted = projectGraphForPersistence(structuredClone(served));
      const r = await callWith([{ factor_id: 'monthly_churn', value: 5, unit: '% of Pro subscribers per month', author: 'model_proposed' }],
        [{ option_id: 'keep_current_setup', factor_id: 'pro_plan_price', value: 0.245, author: 'user_specified' }], [], 'cccccccc-cccc-4ccc-8ccc-cccccccccca3');
      expect(r, JSON.stringify(r)).toMatchObject({ status: 'committed', already_applied: false });
      expect(rows.size, 'the value, its links\' re-size and the level: ONE append').toBe(1);
      expect(factorOs('monthly_churn')).toMatchObject({ value: 0.05, raw_value: 5, source: 'user_assumption' });
      const into = (from: string) => (graphNow().edges as { from: string; to: string; strength: { mean: number }; provenance?: { magnitude?: string } }[])
        .find(e => e.from === from && e.to === 'monthly_churn')!;
      expect([into('price_sensitivity').strength.mean, into('ai_feature_availability').strength.mean]).toEqual([0.0125, -0.0125]);
      expect(into('price_sensitivity').provenance?.magnitude).toBe('olumi_placeholder');
    });

    it('RED (MG 5849581652): a RANGE moves Olumi\'s links like a value does — churn\'s bare 5 on a range of 100 → the 2 links into churn ±0.0125', async () => {
      const served = JSON.parse(readFileSync('tests/fixtures/magnitude/c-run1-served-graphs.json', 'utf-8')).run1_step01;
      // The served graph, with churn holding a bare 5 and no range of its own (the shape a frame is for).
      const churn = served.nodes.find((n: { id: string }) => n.id === 'monthly_churn');
      delete churn.scale_frame;
      churn.observed_state = { value: 5, unit: '% of Pro subscribers per month', source: 'brief_extraction' };
      persisted = projectGraphForPersistence(structuredClone(served));
      const r = await callWith([], [{ option_id: 'keep_current_setup', factor_id: 'pro_plan_price', value: 0.245, author: 'user_specified' }], [],
        'cccccccc-cccc-4ccc-8ccc-cccccccccca4', [{ factor_id: 'monthly_churn', cap: 100 }]);
      expect(r, JSON.stringify(r)).toMatchObject({ status: 'committed', already_applied: false });
      expect(rows.size).toBe(1);
      expect(factorOs('monthly_churn')).toMatchObject({ value: 0.05, raw_value: 5, cap: 100 });
      const into = (from: string) => (graphNow().edges as { from: string; to: string; strength: { mean: number }; provenance?: { magnitude?: string } }[])
        .find(e => e.from === from && e.to === 'monthly_churn')!;
      expect([into('price_sensitivity').strength.mean, into('ai_feature_availability').strength.mean]).toEqual([0.0125, -0.0125]);
      expect(into('ai_feature_availability').provenance?.magnitude).toBe('olumi_placeholder');
    });

    it('a retry of the committed compound writes nothing more — already applied', async () => {
      expect((await callWith(COVERAGE_60, TWO, NEW_LINK)).status).toBe('committed');
      const retry = await callWith(COVERAGE_60, TWO, [], 'dddddddd-dddd-4ddd-8ddd-ddddddddddde');
      expect(retry, JSON.stringify(retry)).toMatchObject({ status: 'committed', already_applied: true, receipt: null });
      expect(rows.size).toBe(1);
    });
  });

  it('a stale base → stale, nothing written', async () => {
    const r = await commitOptionLevelsInProcess({ scenario_id: SCENARIO_ID, turn_id: 'abababab-abab-4bab-8bab-abababababab',
      base_graph_hash: 'deadbeefdeadbeef', links: NEW_LINK, levels: TWO }, 'req-batch');
    expect(r).toEqual({ status: 'stale' });
    expect(rows.size).toBe(0);
  });
});
