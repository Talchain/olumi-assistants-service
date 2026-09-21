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
        // A factor the option is NOT wired to — the refusal fixture.
        { id: 'unlinked_factor', kind: 'factor', label: 'Unrelated', observed_state: { value: 0.3, source: 'brief_extraction' } },
      ],
      edges: [
        ['option', 'factor'], ['option', 'other_factor'], ['factor', 'goal'], ['other_factor', 'goal'],
      ].map(([from, to]) => ({
        from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive',
      })),
    }),
    options: [] as Array<Record<string, unknown>>,
  });
}

let persisted: unknown = buildPersistedGraph();
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
    readFactsWithTurnFor: async (ids: readonly string[]) => [...rows.values()].flatMap(r => {
      if (!ids.includes(r.id)) return [];
      const facts = (r.write.handler_facts ?? []) as unknown[];
      return facts.map(fact => ({ turn_id: r.id, fact_created_at: '2026-09-08T00:00:00.000Z', fact }));
    }),
    append: async (write: Record<string, unknown>) => {
      const key = `${String(write.scenario_id)}/${String(write.turn_id)}`;
      const existing = rows.get(key);
      if (existing !== undefined) return { id: existing.id };
      const id = `row-${rows.size + 1}`;
      rows.set(key, { id, write: JSON.parse(JSON.stringify(write)) });
      if (write.graph !== undefined) persisted = write.graph;
      return { id };
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
