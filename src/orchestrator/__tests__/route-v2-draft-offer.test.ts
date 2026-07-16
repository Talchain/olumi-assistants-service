/**
 * ROADMAP 2.63 C3+C4 — deterministic draft/redraft offer (route-v2).
 *
 * C3 kills the frame-no-brief dead end: the frame guard now SEEDS a
 * "Build the model" chip + a committed `draft_graph` pending action when the
 * guard-firing message carries a usable brief seed, so the next turn's chip
 * click / typed "yes" resumes through the route-level draft-offer pre-route
 * into the C1/C2 deterministic dispatch (server-side brief assembly, honest
 * decline when nothing usable exists).
 *
 * C4 (Paul-ratified 16 Jul, decline-with-redraft-offer): an explicit
 * generate on a scenario WITH a graph gets a deterministic decline plus a
 * "Redraft the model" offer whose consent REPLACES the model — never a
 * silent replace, never a silent ignore. The C4 decline itself is asserted
 * in route-v2-explicit-generate.test.ts (the flipped former fall-through
 * pin); this file covers the offer's consent resume and its guards.
 *
 * RED-first: the C3 seeding, resume, un-strand, re-fire and C4-resume cases
 * all fail on base b607da441 (verified in a throwaway worktree with only the
 * test files copied in); the goldens (chip-click guard turn, short-message
 * guard turn, fresh-scenario heuristic draft, "yes"-with-consent-hold
 * fall-through) pass before AND after — they pin that flag-absent/plain
 * turns stay byte-identical and that the pre-route shadows nothing.
 *
 * Mocking strategy mirrors route-v2-explicit-generate.test.ts: the LLM
 * router THROWS (every offer/resume path must be deterministic), and
 * dispatchDraftGraph is a detector returning a canned success.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { GraphV3 } from '../../schemas/cee-v3.js';
import type { SessionTurnWithContent } from '../../orchestrator-v5/session/conversation-content.js';
import type { PendingAction } from '../../orchestrator-v5/session/pending-action.js';
import { _resetConfigCache } from '../../config/index.js';

// ── dispatchDraftGraph: mocked as a detector + canned success ─────────────
const dispatchDraftGraphMock = vi.fn();
vi.mock('../../orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: dispatchDraftGraphMock,
}));

// ── Mutable per-test session-store behaviour ──────────────────────────────
let persistedGraphForRead: unknown | null = null;
let persistedBriefTextForRead: string | null = null;
let hasPriorTurnsForRead = false;
let recentTurnsForRead: readonly Partial<SessionTurnWithContent>[] = [];
let pendingActionsForRead: readonly PendingAction[] = [];

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => recentTurnsForRead,
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => persistedGraphForRead,
    loadGraphAndBriefText: async () => ({
      graph: persistedGraphForRead,
      briefText: persistedBriefTextForRead,
    }),
    readMostRecentPendingActions: async () => pendingActionsForRead,
    hasPriorTurns: async () => hasPriorTurnsForRead,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// Every offer/resume outcome must be deterministic; an LLM routing call on
// those paths is a wiring failure. The fall-through goldens EXPECT this to
// be called (proof the turn reached pre-existing TurnExecutor routing).
const chatWithToolsMock = vi.fn().mockImplementation(async () => {
  throw new Error('LLM router must NOT be called on a deterministic draft-offer path');
});
vi.mock('../../adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: chatWithToolsMock,
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: chatWithToolsMock,
    },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

vi.mock('../../config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === 'orchestratorV5') return true;
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

const { ceeOrchestratorRouteV2 } = await import('../../orchestrator/route-v2.js');

const SCENARIO_ID = '77777777-7777-4777-8777-777777777777';

/** ≥30 chars, deliberately FAILS the decision-brief regex (no keyword, no '?'). */
const UNSHAPED_CONTEXT =
  'Three pricing tiers for the new analytics product, mid-market focus, go-live is in Q4.';

/** The live P2 probe brief (104 chars, matches the decision regex). */
const REAL_BRIEF =
  'Should we hire a senior tech lead or two junior developers to accelerate the platform rebuild this year?';

/** The live P2 probe chip message (31 chars, fails the regex). */
const CANNED_CHIP_MESSAGE = 'Yes, build the model now please';

const FRAME_GUARD_COPY = 'I need a single decision question to start';
const BUILD_OFFER_LABEL = 'Build the model';
const BUILD_OFFER_MESSAGE = 'Yes, build the model from what I have shared.';
const REDRAFT_OFFER_MESSAGE = 'Yes, redraft the model from my brief.';

/** Minimal strict GraphV3 fixture. */
const STRICT_GRAPH = {
  nodes: [
    { id: 'opt-a', kind: 'option', label: 'Option A' },
    { id: 'goal-g', kind: 'goal', label: 'The goal' },
    {
      id: 'fac-f',
      kind: 'factor',
      label: 'A factor',
      observed_state: { value: 0.1, raw_value: 5, cap: 50 },
    },
  ],
  edges: [
    {
      from: 'fac-f',
      to: 'goal-g',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
};
{
  const parsed = GraphV3.safeParse(STRICT_GRAPH);
  if (!parsed.success) {
    throw new Error('Fixture failed GraphV3.safeParse: ' + JSON.stringify(parsed.error.issues));
  }
}

function makeDraftMockResult() {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'Drafted the model.',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'analyse' as const,
    },
    commitPerformed: true,
    graph: null,
  };
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: '99999999-9999-4999-8999-999999999999',
    scenario_id: SCENARIO_ID,
    stage: 'frame',
    turn_class: 'frame',
    message: UNSHAPED_CONTEXT,
    source: 'composer',
    ...overrides,
  };
}

/** A persisted draft_graph offer pending, live by default. */
function offerPending(overrides: {
  brief_seed?: string;
  redraft?: boolean;
  graph_hash?: string;
  expiredWall?: boolean;
  chip_id?: string;
  public_label?: string;
  public_message?: string;
} = {}): PendingAction {
  const now = Date.now();
  return {
    id: 'pa-draft-offer-1',
    scenario_id: SCENARIO_ID,
    chip_id: overrides.chip_id ?? 'draft-offer-chip-1',
    action: {
      kind: 'draft_graph',
      ...(overrides.brief_seed !== undefined ? { brief_seed: overrides.brief_seed } : {}),
      ...(overrides.redraft === true ? { redraft: true } : {}),
      public_label: overrides.public_label ?? BUILD_OFFER_LABEL,
      public_message: overrides.public_message ?? BUILD_OFFER_MESSAGE,
    },
    preconditions:
      overrides.graph_hash !== undefined ? { graph_hash: overrides.graph_hash } : {},
    expires_at_turn_count: 2,
    expires_at_iso: new Date(now + (overrides.expiredWall ? -1000 : 10 * 60 * 1000)).toISOString(),
    emitted_at_iso: new Date(now - 1000).toISOString(),
  } as PendingAction;
}

/**
 * A live chip-suggestion pending (run_analysis, TTL 2 turns) — the review
 * P1-1 probe shape: it survives the C4 commit's carry-forward, so a bare
 * "yes" on the next turn falls to deterministic-short-confirm's
 * RESUMABLE_KINDS (executes ANALYSIS), never to the draft-offer resume.
 */
function liveRunAnalysisPending(): PendingAction {
  const now = Date.now();
  return {
    id: 'pa-run-analysis-1',
    scenario_id: SCENARIO_ID,
    chip_id: 'run-analysis-chip-1',
    action: { kind: 'run_analysis' },
    preconditions: {},
    expires_at_turn_count: 2,
    expires_at_iso: new Date(now + 10 * 60 * 1000).toISOString(),
    emitted_at_iso: new Date(now).toISOString(),
  } as PendingAction;
}

/** A live consent hold (apply_proposed_change) for the non-shadowing golden. */
function liveConsentHold(): PendingAction {
  const now = Date.now();
  return {
    id: 'pa-hold-1',
    scenario_id: SCENARIO_ID,
    chip_id: 'proposal-ref-000000000001',
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: 'proposal-ref-000000000001',
      inline_patch: { handler_id: 'add_constraint', params: {}, target_entity_ids: [] },
      public_label: 'Add the budget cap',
      public_message: 'Add the budget cap to the model.',
    },
    preconditions: { graph_hash: 'abcd1234abcd1234' },
    expires_at_turn_count: 2,
    expires_at_iso: new Date(now + 10 * 60 * 1000).toISOString(),
    emitted_at_iso: new Date(now).toISOString(),
  } as PendingAction;
}

type AppendWrite = {
  pending_actions: readonly {
    chip_id: string;
    action: Record<string, unknown>;
  }[];
};

describe('POST /orchestrate/v2/turn — draft/redraft offer (ROADMAP 2.63 C3+C4)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    _resetConfigCache();
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    _resetConfigCache();
  });
  beforeEach(() => {
    dispatchDraftGraphMock.mockReset();
    dispatchDraftGraphMock.mockResolvedValue(makeDraftMockResult());
    appendMock.mockClear();
    chatWithToolsMock.mockClear();
    persistedGraphForRead = null;
    persistedBriefTextForRead = null;
    hasPriorTurnsForRead = false;
    recentTurnsForRead = [];
    pendingActionsForRead = [];
  });

  // ── C3 — the guard seeds the offer ───────────────────────────────────────
  it('frame guard on a typed unshaped >=30-char message emits the Build-the-model chip AND commits a seeded draft_graph pending', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect(chatWithToolsMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    // The guard's original copy is preserved, the offer sentence appended.
    expect(body.assistant_text).toContain(FRAME_GUARD_COPY);
    expect(body.assistant_text).toContain('draft a first model');
    expect(body.suggested_actions).toHaveLength(1);
    expect(body.suggested_actions[0].label).toBe(BUILD_OFFER_LABEL);
    expect(body.suggested_actions[0].message).toBe(BUILD_OFFER_MESSAGE);
    // Commit carries the pending: kind draft_graph, seed = the message,
    // chip_id linked to the rendered chip.
    expect(appendMock).toHaveBeenCalledTimes(1);
    const write = appendMock.mock.calls[0]![0] as AppendWrite;
    expect(write.pending_actions).toHaveLength(1);
    expect(write.pending_actions[0]!.action.kind).toBe('draft_graph');
    expect(write.pending_actions[0]!.action.brief_seed).toBe(UNSHAPED_CONTEXT);
    expect(write.pending_actions[0]!.action.redraft).toBeUndefined();
    expect(write.pending_actions[0]!.chip_id).toBe(body.suggested_actions[0].id);
  });

  // ── C3 goldens — unusable-seed guard turns stay byte-identical ──────────
  it('GOLDEN: the P2 chip-click guard turn is unchanged (no chip, no commit — canned chip text never seeds)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: CANNED_CHIP_MESSAGE, source: 'chip_click', chip: {} }),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain(FRAME_GUARD_COPY);
    expect(body.assistant_text).not.toContain('draft a first model');
    expect(body.suggested_actions).toEqual([]);
    expect(appendMock).not.toHaveBeenCalled();
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  it('GOLDEN: a short typed message (<30 chars) guard turn is unchanged (no chip, no commit)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'help me decide' }),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain(FRAME_GUARD_COPY);
    expect(body.suggested_actions).toEqual([]);
    expect(appendMock).not.toHaveBeenCalled();
  });

  it('GOLDEN: a shaped brief on a FRESH scenario still drafts via the heuristic with no briefOverride and no consumedPendingRefs', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: REAL_BRIEF }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const args = dispatchDraftGraphMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.briefOverride).toBeUndefined();
    expect(args.consumedPendingRefs).toBeUndefined();
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  // ── C3 — consent resume ──────────────────────────────────────────────────
  it('typed "yes" after a guard offer drafts from the persisted brief_seed (zero LLM calls, offer consumed)', async () => {
    hasPriorTurnsForRead = true;
    pendingActionsForRead = [offerPending({ brief_seed: UNSHAPED_CONTEXT })];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'yes' }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const args = dispatchDraftGraphMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.briefOverride).toBe(UNSHAPED_CONTEXT);
    expect(args.consumedPendingRefs).toEqual(['draft-offer-chip-1']);
    // The committed turn keeps the verbatim wire message.
    expect((args.payload as Record<string, unknown>).message).toBe('yes');
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  it('clicking the Build-the-model chip (its copy replayed verbatim) drafts from the seed', async () => {
    hasPriorTurnsForRead = true;
    pendingActionsForRead = [offerPending({ brief_seed: UNSHAPED_CONTEXT })];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: BUILD_OFFER_MESSAGE, source: 'chip_click', chip: {} }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const args = dispatchDraftGraphMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.briefOverride).toBe(UNSHAPED_CONTEXT);
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  it('consent with NOTHING usable (no seed, no persisted brief, no shaped turns) gets the honest decline — never a silent LLM fall-through', async () => {
    hasPriorTurnsForRead = true;
    pendingActionsForRead = [offerPending()]; // no brief_seed
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'yes' }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect(chatWithToolsMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain("don't have a decision brief");
    expect(appendMock).not.toHaveBeenCalled();
  });

  // ── C3 — un-strand + re-fire on the guard's own continuation ────────────
  it('a shaped brief typed AFTER a guard offer drafts (the guard-committed turn no longer strands it), retiring the offer', async () => {
    hasPriorTurnsForRead = true;
    // Marker semantics: even a wall-expired offer un-strands a shaped brief
    // (drafting what the user just typed carries no consent risk).
    pendingActionsForRead = [offerPending({ brief_seed: UNSHAPED_CONTEXT, expiredWall: true })];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: REAL_BRIEF }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const args = dispatchDraftGraphMock.mock.calls[0]![0] as Record<string, unknown>;
    // Heuristic path (message IS the brief): no override needed; the stale
    // offer is consumed so it cannot zombie-resume after the draft.
    expect(args.briefOverride).toBeUndefined();
    expect(args.consumedPendingRefs).toEqual(['draft-offer-chip-1']);
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  it('a second unshaped non-confirm message RE-FIRES the guard deterministically with a fresh seeded offer', async () => {
    hasPriorTurnsForRead = true;
    pendingActionsForRead = [offerPending({ brief_seed: UNSHAPED_CONTEXT })];
    const secondContext =
      'Also worth knowing: the enterprise tier depends on a partner integration landing first.';
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: secondContext }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect(chatWithToolsMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain(FRAME_GUARD_COPY);
    expect(body.suggested_actions).toHaveLength(1);
    // Fresh offer committed, re-seeded from the NEW message.
    expect(appendMock).toHaveBeenCalledTimes(1);
    const write = appendMock.mock.calls[0]![0] as AppendWrite;
    const offers = write.pending_actions.filter((pa) => pa.action.kind === 'draft_graph');
    expect(offers).toHaveLength(1);
    expect(offers[0]!.action.brief_seed).toBe(secondContext);
  });

  // ── Non-shadowing goldens ────────────────────────────────────────────────
  it('GOLDEN: a bare "yes" with a live consent HOLD alongside the offer falls through untouched (consent-priority is never shadowed)', async () => {
    hasPriorTurnsForRead = true;
    pendingActionsForRead = [offerPending({ brief_seed: UNSHAPED_CONTEXT }), liveConsentHold()];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'yes' }),
    });
    // The draft offer must NOT claim the turn: it reaches pre-existing
    // TurnExecutor routing (whose short-confirm machinery owns the hold).
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect(res.statusCode).toBeGreaterThanOrEqual(200);
  });

  it('GOLDEN: a bare "yes" on an EXPIRED offer falls through to pre-existing routing (no draft, no canned guard copy)', async () => {
    hasPriorTurnsForRead = true;
    pendingActionsForRead = [offerPending({ brief_seed: UNSHAPED_CONTEXT, expiredWall: true })];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'yes' }),
    });
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(String(body.assistant_text ?? '')).not.toContain(FRAME_GUARD_COPY);
    expect(res.statusCode).toBeGreaterThanOrEqual(200);
  });

  // ── C4 — redraft consent resume ──────────────────────────────────────────
  it('redraft consent (exact chip replay) with a persisted graph dispatches the draft from the persisted brief and consumes the offer', async () => {
    persistedGraphForRead = STRICT_GRAPH;
    persistedBriefTextForRead = REAL_BRIEF;
    pendingActionsForRead = [
      offerPending({
        redraft: true,
        chip_id: 'redraft-offer-chip-1',
        public_label: 'Redraft the model',
        public_message: REDRAFT_OFFER_MESSAGE,
      }),
    ];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: REDRAFT_OFFER_MESSAGE,
        source: 'chip_click',
        chip: {},
        stage: 'analyse',
        turn_class: 'propose',
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const args = dispatchDraftGraphMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.briefOverride).toBe(REAL_BRIEF);
    expect(args.consumedPendingRefs).toEqual(['redraft-offer-chip-1']);
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  it('redraft consent is REFUSED (honest re-offer, no draft) when the graph moved after the offer (hash mismatch)', async () => {
    persistedGraphForRead = STRICT_GRAPH;
    persistedBriefTextForRead = REAL_BRIEF;
    pendingActionsForRead = [
      offerPending({
        redraft: true,
        graph_hash: 'ffffffffffffffff', // never matches the fixture's hash
        chip_id: 'redraft-offer-chip-1',
        public_label: 'Redraft the model',
        public_message: REDRAFT_OFFER_MESSAGE,
      }),
    ];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: REDRAFT_OFFER_MESSAGE,
        source: 'chip_click',
        chip: {},
        stage: 'analyse',
        turn_class: 'propose',
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect(chatWithToolsMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    // Re-offered against the graph as it stands now: decline copy + a fresh
    // redraft chip + a fresh committed redraft pending. The chip carries the
    // ALTERNATE replay copy — the user's message IS the standard copy (they
    // clicked the previous offer), and the egress looping-chip guard would
    // rightly drop a chip that replays it verbatim.
    expect(body.assistant_text).toContain('already has a model');
    expect(body.suggested_actions).toHaveLength(1);
    expect(body.suggested_actions[0].message).toBe('Yes, start the redraft from my brief.');
    expect(appendMock).toHaveBeenCalledTimes(1);
    const write = appendMock.mock.calls[0]![0] as AppendWrite;
    const offers = write.pending_actions.filter((pa) => pa.action.kind === 'draft_graph');
    expect(offers).toHaveLength(1);
    expect(offers[0]!.action.redraft).toBe(true);
    // A consent phrase is never captured as a brief seed.
    expect(offers[0]!.action.brief_seed).toBeUndefined();
  });

  it('a TYPED replay of the offer copy never seeds the confirmation sentence as a brief (re-offer pending carries no seed)', async () => {
    persistedGraphForRead = STRICT_GRAPH;
    persistedBriefTextForRead = REAL_BRIEF;
    pendingActionsForRead = [
      offerPending({
        redraft: true,
        graph_hash: 'ffffffffffffffff',
        chip_id: 'redraft-offer-chip-1',
        public_label: 'Redraft the model',
        public_message: REDRAFT_OFFER_MESSAGE,
      }),
    ];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: REDRAFT_OFFER_MESSAGE, // typed, 37 chars — over the seed floor
        source: 'composer',
        stage: 'analyse',
        turn_class: 'propose',
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect(appendMock).toHaveBeenCalledTimes(1);
    const write = appendMock.mock.calls[0]![0] as AppendWrite;
    const offers = write.pending_actions.filter((pa) => pa.action.kind === 'draft_graph');
    expect(offers).toHaveLength(1);
    expect(offers[0]!.action.brief_seed).toBeUndefined();
  });

  // ── P1-1 (adversarial review) — the "reply yes" promise is DERIVED from
  //    the carried pendings, never asserted unconditionally. A bare confirm
  //    resumes the offer ONLY when it is the sole live pending
  //    (resolveDraftOfferResume); with a live chip-suggestion pending
  //    surviving the commit's carry-forward, "yes" at the next turn executes
  //    ANALYSIS via deterministic-short-confirm — so copy promising "reply
  //    yes" would promise the wrong action. ─────────────────────────────────
  it('P1-1 C4: decline copy with a live run_analysis pending carried through names the chip as the ONLY route (no "reply yes" promise)', async () => {
    persistedGraphForRead = STRICT_GRAPH;
    persistedBriefTextForRead = REAL_BRIEF;
    hasPriorTurnsForRead = true;
    pendingActionsForRead = [liveRunAnalysisPending()];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: CANNED_CHIP_MESSAGE,
        source: 'chip_click',
        chip: {},
        generate_model: true,
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect(chatWithToolsMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain('already has a model');
    // The chip route is named; the bare-confirm route is NOT promised.
    expect(body.assistant_text).toContain('Redraft the model');
    expect(body.assistant_text).not.toMatch(/reply yes/i);
    // Premise pin: the carried run_analysis pending SURVIVES this commit
    // alongside the fresh offer — exactly why "yes" cannot reach the offer.
    expect(appendMock).toHaveBeenCalledTimes(1);
    const write = appendMock.mock.calls[0]![0] as AppendWrite;
    const kinds = write.pending_actions.map((pa) => pa.action.kind).sort();
    expect(kinds).toEqual(['draft_graph', 'run_analysis']);
  });

  it('P1-1 C4 / review P2-a: a live proposed_concept hold carried through likewise suppresses the "reply yes" promise', async () => {
    persistedGraphForRead = STRICT_GRAPH;
    persistedBriefTextForRead = REAL_BRIEF;
    hasPriorTurnsForRead = true;
    const now = Date.now();
    pendingActionsForRead = [
      {
        id: 'pa-concept-1',
        scenario_id: SCENARIO_ID,
        chip_id: 'concept-chip-1',
        action: {
          kind: 'proposed_concept',
          concept: 'churn risk',
          preferred_kind: 'risk',
          public_label: 'Add churn risk',
          public_message: 'Add churn risk to the model.',
        },
        preconditions: {},
        expires_at_turn_count: 2,
        expires_at_iso: new Date(now + 10 * 60 * 1000).toISOString(),
        emitted_at_iso: new Date(now).toISOString(),
      } as PendingAction,
    ];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: CANNED_CHIP_MESSAGE,
        source: 'chip_click',
        chip: {},
        generate_model: true,
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain('already has a model');
    expect(body.assistant_text).not.toMatch(/reply yes/i);
  });

  it('P1-1 C4 golden: decline copy keeps the "reply yes" promise when the offer WILL be the sole live pending', async () => {
    persistedGraphForRead = STRICT_GRAPH;
    persistedBriefTextForRead = REAL_BRIEF;
    hasPriorTurnsForRead = true;
    pendingActionsForRead = [];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: CANNED_CHIP_MESSAGE,
        source: 'chip_click',
        chip: {},
        generate_model: true,
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain('already has a model');
    expect(body.assistant_text).toContain('or reply yes');
  });

  it('P1-1 C3: guard re-fire with another live pending derives the guard sentence chip-only (no "just reply yes")', async () => {
    hasPriorTurnsForRead = true;
    pendingActionsForRead = [
      offerPending({ brief_seed: UNSHAPED_CONTEXT }),
      liveRunAnalysisPending(),
    ];
    const secondContext =
      'Also worth knowing: the enterprise tier depends on a partner integration landing first.';
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: secondContext }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain('draft a first model');
    expect(body.assistant_text).toContain('Build the model');
    expect(body.assistant_text).not.toMatch(/reply yes/i);
  });

  it('P1-1 C3 golden: guard offer on a fresh scenario (sole-live) keeps "just reply yes"', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain('draft a first model');
    expect(body.assistant_text).toContain('just reply yes');
  });

  // ── P1-2 (adversarial review) — GraphStateIngressSchema accepts
  //    {nodes:[],edges:[]}; a zero-node request graph_state must be treated
  //    as ABSENT by the C4 arms, never as "this decision already has a
  //    model". ────────────────────────────────────────────────────────────
  it('P1-2: build-offer consent ("yes") with an EMPTY request graph_state and no persisted graph dispatches the FIRST draft — never a redraft re-offer for a nonexistent model', async () => {
    hasPriorTurnsForRead = true;
    persistedGraphForRead = null;
    pendingActionsForRead = [offerPending({ brief_seed: UNSHAPED_CONTEXT })];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'yes',
        graph_state: { nodes: [], edges: [] },
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const args = dispatchDraftGraphMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.briefOverride).toBe(UNSHAPED_CONTEXT);
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });
});
