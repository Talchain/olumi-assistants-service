/**
 * DRAFT-FIRST INTAKE — Paul's ratified target (17 Aug 2026): a substantive
 * brief produces the provisional model IMMEDIATELY, with clarification
 * ALONGSIDE and non-blocking. Clarification must never gate seeing the model.
 *
 * The acceptance debt this closes (located by two witnesses): route-v2's
 * clarify-v2 `kind === 'respond'` arm could answer a draft-shaped turn with
 * clarifying questions INSTEAD of drafting. The wire witness
 * (olumi-docs/witness-998-2026-08-16/, build c5e2430): session A1's fully
 * substantive brief got a `clarify_v2` exit on turn 1 (goal + options asked)
 * and the model only on turn 2, ~2 minutes later.
 *
 * The discriminator REUSED, not invented (traps 22/22b/22f — no new
 * natural-language predicate anywhere in this change):
 *   - "can produce a draft" = the route's own `draftShapedTurn` heuristic
 *     (route-v2.ts, threaded as `params.draftShaped`) — round 1 of clarify-v2
 *     only ever runs on turns the pipeline itself judged draft-shaped
 *     (clarify-v2-dispatch.ts round-1 guard);
 *   - the delivery composition = the EXISTING single-gap draft-first channel
 *     (`ClarifyV2Outcome.kind === 'draft'` + `deferredAsk.disclosure`,
 *     appended by route-v2 after a successful draft commit), which the #999
 *     lane confirmed composes correctly with auto-run.
 *
 * These specs pin the WHOLE composition in one turn:
 *   draft delivered + clarifying questions alongside + #999 auto-run fired.
 *
 * Negative pins:
 *   - a genuinely undraftable message ("help") is NOT draft-shaped, so it
 *     never reaches the draft dispatch — no draft, no fabricated graph, no
 *     auto-run (the clarify/conversational reply stands);
 *   - no clarify turn is COMMITTED on the draft-first path (the ask is
 *     non-blocking by construction — nothing persists, nothing to resume);
 *   - a live legacy clarify round still resumes correctly — pinned by the
 *     untouched RESUME suite in route-v2-clarify-v2.test.ts;
 *   - reloads send no turn at all, so they cannot re-draft by construction
 *     (route-v2-draft-graph-auto-run.test.ts pins the trigger's only caller).
 *
 * Harness: same seams as route-v2-draft-graph-auto-run.test.ts, PLUS a
 * store that answers the strict pendings read (clarify-v2 declines to claim
 * any turn it cannot prove the pending set for — hold-wipe guard).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { DRAFT_GRAPH_MIN_BRIEF_LENGTH } from '../../../src/schemas/assist.js';

// -------- Mocks --------
const dispatchDraftGraphMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: dispatchDraftGraphMock,
}));

const scheduleAutoRunMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/handlers/auto-run-after-draft.js', () => ({
  scheduleAutoRunAfterFreshDraft: scheduleAutoRunMock,
}));

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    // Strict pendings read SUCCEEDS with an empty set — clarify-v2 engages
    // (a throwing read makes it decline the turn, which would silently skip
    // the very arm under test).
    readMostRecentPendingActions: async () => [],
    hasPriorTurns: async () => false,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'short reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: async () => ({
      content: [{ type: 'text', text: 'short text-only response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'short reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: async () => ({
        content: [{ type: 'text', text: 'short text-only response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
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
const { composeClarifyQuestions } = await import(
  '../../../src/orchestrator-v5/clarify-v2/questions.js'
);

const SCENARIO_ID = '33333333-3333-4333-8333-333333333333';
const TURN_ID = '44444444-4444-4444-8444-444444444444';

/**
 * ⚠ HISTORIC WIRE CAPTURE — VERBATIM, NEVER EDIT (trap 14b).
 *
 * Session A1 turn-1 message from olumi-docs/witness-998-2026-08-16/
 * a1-turn1-request.json (scenario 447288c1-929d-47f1-9122-6f9815d1202a,
 * build c5e2430, FRESH guest state-class). On the deployed build this brief —
 * three named options, figures, a deadline, a stated ask — received the
 * clarify_v2 respond exit (goal + options asked) INSTEAD of a draft. It is
 * the corpus case for this change, from outside the author's head (trap 22).
 */
const WITNESS_A1_BRIEF =
  "We're a 40-person B2B SaaS company doing about £3.2m ARR, growing 15% a year, which is slower than we'd like. The board wants a plan by end of quarter. We're weighing three moves: expanding into the German market (probably £400k up front for localisation, sales hires and compliance — our CEO thinks it could add £800k ARR within 18 months but our head of sales thinks that's optimistic); doubling down on UK mid-market with a partner channel (cheaper, maybe £150k, but partners take a 25% cut and we've never run a channel before); or building the analytics add-on customers keep asking for (two quarters of engineering time, roughly £250k in payroll, might lift retention from 88% to 92% and support a 10% price rise). We can't fund more than one properly. Cash runway is about 14 months. The team is nervous about spreading ourselves thin, and honestly we disagree about how price-sensitive our customers actually are. What should we do?";

// A second outside-corpus case: S1 from the append-only wire-brief pack
// (two missing dimensions at the current rubric — the multi-gap arm).
const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fixtures',
  'clarify-v2-wire-briefs-2026-08-12.json',
);
const wirePack = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  briefs: Record<string, { class: string; brief: string }>;
};
const S1_BRIEF = wirePack.briefs['S1']!.brief;

const DRAFT_GRAPH = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Grow ARR' },
    { id: 'opt_1', kind: 'option', label: 'Germany', interventions: { fac_1: 0.4 } },
    { id: 'opt_2', kind: 'option', label: 'UK channel' },
    { id: 'fac_1', kind: 'factor', label: 'Price sensitivity' },
  ],
  edges: [],
};
const DRAFT_GRAPH_HASH = 'aag_v1:99998888777766665555444433332222';
const DRAFT_NARRATIVE = 'Drafted a decision model from your brief.';

function draftResult(overrides: Record<string, unknown> = {}) {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: DRAFT_NARRATIVE,
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'analyse' as const,
    },
    commitPerformed: true,
    graph: DRAFT_GRAPH,
    freshness: {
      freshness: 'none' as const,
      reason: 'no_successful_run_analysis_fact',
      selected_fact_index: null,
      graph_hash_at_run: null,
      current_graph_hash: DRAFT_GRAPH_HASH,
      computed_at: null,
    },
    ...overrides,
  };
}

function turnPayload(message: string, turnId = TURN_ID) {
  return {
    kind: 'message',
    turn_id: turnId,
    scenario_id: SCENARIO_ID,
    stage: 'frame',
    message,
    turn_class: 'frame',
    source: 'composer',
  };
}

describe('POST /orchestrate/v2/turn — draft-first intake (clarification alongside, never instead)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    expect(WITNESS_A1_BRIEF.length).toBeGreaterThanOrEqual(DRAFT_GRAPH_MIN_BRIEF_LENGTH);
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    dispatchDraftGraphMock.mockReset();
    scheduleAutoRunMock.mockReset();
    appendMock.mockClear();
  });

  it('THE WITNESS CASE: the A1 brief drafts on turn 1, questions ride alongside, auto-run fires — one turn', async () => {
    dispatchDraftGraphMock.mockResolvedValueOnce(draftResult());

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: turnPayload(WITNESS_A1_BRIEF),
    });

    expect(res.statusCode).toBe(200);

    // 1. The DRAFT was dispatched — not a clarify respond exit.
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const dispatchArgs = dispatchDraftGraphMock.mock.calls[0][0];
    // The briefOverride is the working brief (trimmed, draft-cap enforced) —
    // for this in-cap brief, byte-identical to the user's message.
    expect(dispatchArgs.briefOverride).toBe(WITNESS_A1_BRIEF);

    // 2. The clarifying questions ride ALONGSIDE the draft, in the same
    //    turn's assistant text — assistant-authored provenance, and the
    //    question text itself so the user can answer it.
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain(DRAFT_NARRATIVE);
    expect(body.assistant_text).toContain("I've assumed");
    // Identity binding: the deployed witness ask was goal + options; the
    // disclosure must carry BOTH questions' text (bound via the template
    // module, not retyped).
    const [goalQ] = composeClarifyQuestions(['goal'], 1);
    const [optionsQ] = composeClarifyQuestions(['options'], 1);
    expect(body.assistant_text).toContain(goalQ!.text);
    expect(body.assistant_text).toContain(optionsQ!.text);

    // 3. #999's auto-run fired on this draft exactly as on any fresh draft.
    expect(scheduleAutoRunMock).toHaveBeenCalledTimes(1);
    const autoRunArgs = scheduleAutoRunMock.mock.calls[0][0];
    expect(autoRunArgs.scenarioId).toBe(SCENARIO_ID);
    expect(autoRunArgs.draftTurnId).toBe(TURN_ID);
    expect(autoRunArgs.draftGraph).toEqual(DRAFT_GRAPH);
    expect(autoRunArgs.draftGraphHash).toBe(DRAFT_GRAPH_HASH);

    // 4. NON-BLOCKING by construction: no clarify turn was committed and no
    //    clarify round was persisted (the draft dispatch is mocked, so ANY
    //    append here would be the blocking clarify commit).
    expect(appendMock).not.toHaveBeenCalled();
  });

  it('the S1 wire brief (two rubric gaps) also drafts first, with BOTH questions alongside', async () => {
    dispatchDraftGraphMock.mockResolvedValueOnce(draftResult());

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: turnPayload(S1_BRIEF, '44444444-4444-4444-8444-444444444445'),
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain(DRAFT_NARRATIVE);
    expect(body.assistant_text).toContain("I've assumed");
    expect(scheduleAutoRunMock).toHaveBeenCalledTimes(1);
    expect(appendMock).not.toHaveBeenCalled();
  });

  it('truth gate preserved: when the draft commits but NO graph lands, the disclosure is withheld and auto-run stays silent', async () => {
    dispatchDraftGraphMock.mockResolvedValueOnce(
      draftResult({ graph: null, freshness: undefined, analysisReady: undefined }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: turnPayload(WITNESS_A1_BRIEF, '44444444-4444-4444-8444-444444444446'),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // A disclosure about assumptions "in this draft" needs a draft on the
    // canvas — same truth gate as the single-gap path (dg.graph !== null).
    expect(body.assistant_text).not.toContain("I've assumed");
    expect(scheduleAutoRunMock).not.toHaveBeenCalled();
  });

  it("NEGATIVE PIN: a genuinely undraftable message ('help') never drafts — no draft dispatch, no fabricated graph, no auto-run", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: turnPayload('help', '44444444-4444-4444-8444-444444444447'),
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect(scheduleAutoRunMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    // Whatever branch answers (deterministic guard or TurnExecutor), it must
    // not carry a fabricated draft disclosure.
    expect(body.assistant_text ?? '').not.toContain("I've assumed");
  });
});
