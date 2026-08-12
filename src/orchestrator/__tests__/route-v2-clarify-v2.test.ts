/**
 * Clarify v2 — route-v2 wiring (E0-B, ROADMAP 1.94 Option A replacement).
 *
 * Drives `POST /orchestrate/v2/turn` with the REAL clarify-v2 modules
 * (rubric, composer, dispatch, commit) and the standard route-test mocks
 * (session store, LLM router that THROWS — every clarify-v2 path must be
 * deterministic with zero LLM calls; `dispatchDraftGraph` as a dispatch
 * detector). Mocking strategy mirrors route-v2-explicit-generate.test.ts.
 *
 * RED-first (verified in a throwaway worktree by reverting the src/ half):
 * the flag-on ask/resume/proceed cases fail on the unwired route; the
 * flag-off cases pass before AND after (behaviour-preservation pins — the
 * flag-off wire is byte-identical to today's draft path).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import type { PendingAction } from '../../orchestrator-v5/session/pending-action.js';
import { parsePendingAction } from '../../orchestrator-v5/session/pending-action.js';
import { _resetConfigCache } from '../../config/index.js';
import {
  CLARIFY_V2_PROCEED_CHIP_ID,
  CLARIFY_V2_PROCEED_MESSAGE,
} from '../../orchestrator-v5/clarify-v2/preflight.js';

// ── dispatchDraftGraph: mocked as a detector + canned success ─────────────
const dispatchDraftGraphMock = vi.fn();
vi.mock('../../orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: dispatchDraftGraphMock,
}));

// ── Mutable per-test session-store behaviour ──────────────────────────────
let persistedGraphForRead: unknown | null = null;
let persistedBriefTextForRead: string | null = null;
let hasPriorTurnsForRead = false;
let pendingActionsForRead: readonly PendingAction[] = [];

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
const readMostRecentPendingActionsMock = vi.fn(async () => pendingActionsForRead);
vi.mock('../../orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
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
    readMostRecentPendingActions: readMostRecentPendingActionsMock,
    hasPriorTurns: async () => hasPriorTurnsForRead,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// Every clarify-v2 outcome is deterministic; an LLM routing call on a
// claimed path is a wiring failure and must fail the test loudly. The
// fall-through pins EXPECT this to be called.
const chatWithToolsMock = vi.fn().mockImplementation(async () => {
  throw new Error('LLM router must NOT be called on a deterministic clarify_v2 path');
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

// Flag control: `cee.clarifyV2Enabled` reads this mutable variable so each
// test flips the dark flag without re-parsing config.
vi.mock('../../config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../config/index.js')>();
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
        if (prop === 'cee') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(ceeTarget, ceeProp) {
              return Reflect.get(ceeTarget, ceeProp);
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
const TURN_ID = '99999999-9999-4999-8999-999999999999';

/** Thin but draft-shaped: matches the decision regex + length ≥ 30. */
const THIN_BRIEF = 'Should we expand into the German market?';
/** Complete on all four rubric dimensions. */
const COMPLETE_BRIEF =
  'Should we hire a senior tech lead or two junior developers to accelerate the platform rebuild this year?';

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

function messagePayload(message: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    stage: 'frame',
    turn_class: 'frame',
    message,
    source: 'composer',
    ...overrides,
  };
}

/** A live, unrelated pre-graph hold (V5 proposal memory) — the silent-wipe probe. */
function makeProposedConceptHold(): PendingAction {
  const now = Date.now();
  return {
    id: 'pc_prior-turn',
    scenario_id: SCENARIO_ID,
    chip_id: 'pc_chip-1',
    action: {
      kind: 'proposed_concept',
      concept: 'a churn-risk factor',
      preferred_kind: 'factor',
      public_label: 'Add churn risk',
      public_message: 'Yes, add the churn-risk factor.',
    },
    preconditions: {},
    expires_at_turn_count: 3,
    expires_at_iso: new Date(now + 60_000).toISOString(),
    emitted_at_iso: new Date(now).toISOString(),
  } as PendingAction;
}

function livePending(brief: string, asked: readonly string[], round: number): PendingAction {
  const now = Date.now();
  return {
    id: 'cv2_prior-turn',
    scenario_id: SCENARIO_ID,
    chip_id: CLARIFY_V2_PROCEED_CHIP_ID,
    action: { kind: 'clarify_v2_round', brief, asked_dimensions: asked, round },
    preconditions: {},
    expires_at_turn_count: 2,
    expires_at_iso: new Date(now + 60_000).toISOString(),
    emitted_at_iso: new Date(now).toISOString(),
  } as PendingAction;
}

describe('POST /orchestrate/v2/turn — clarify v2 wiring (E0-B)', () => {
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
    readMostRecentPendingActionsMock.mockClear();
    persistedGraphForRead = null;
    persistedBriefTextForRead = null;
    hasPriorTurnsForRead = false;
    pendingActionsForRead = [];
  });

  // NO-DARK-LAUNCH (Paul, 19 Jul): CEE_CLARIFY_V2_ENABLED is deleted — clarify
  // v2 runs unconditionally, so the former FLAG-OFF byte-identity pin is gone.
  // ── FLAG ON: draft preflight ─────────────────────────────────────────────
  it('FLAG ON: a thin brief gets tap-able clarifying questions instead of a draft (zero LLM calls)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(THIN_BRIEF),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect(chatWithToolsMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    // Questions + candidates + the default-forward escape chip.
    expect(body.assistant_text).toContain('?');
    expect(body.assistant_text).toContain('go ahead');
    const chipIds = (body.suggested_actions as Array<{ id: string }>).map((a) => a.id);
    expect(chipIds).toContain(CLARIFY_V2_PROCEED_CHIP_ID);
    expect(chipIds.length).toBeGreaterThanOrEqual(3);
    // The clarify turn COMMITS (turn_class clarify, round-state pending)
    // so the next turn can resume. Review fix A9 (1.152): the ask commit
    // seeds NO brief_text — the column is write-once at the RPC, so an
    // ask-time seed would freeze the PRE-ANSWER brief forever; the FINAL
    // brief seeds at the flow's terminal points (draft dispatch / decline).
    expect(appendMock).toHaveBeenCalledTimes(1);
    const committed = appendMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(committed.turn_class).toBe('clarify');
    expect(committed.llm_calls_used).toBe(0);
    expect(committed.briefText).toBeUndefined();
    const pendings = committed.pending_actions as PendingAction[];
    expect(pendings).toHaveLength(1);
    expect(pendings[0]!.action.kind).toBe('clarify_v2_round');
  });

  // ── Review fix A5 (17 Jul) — behavioural pin (deferred from #497) ───────
  it('A5: an EMPTY canvas ({nodes:[],edges:[]}) does NOT defeat clarify v2 — questions still engage', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(THIN_BRIEF, {
        graph_state: { nodes: [], edges: [] },
      }),
    });
    expect(res.statusCode).toBe(200);
    // Before A5 the gate was `graphState == null`, so the empty canvas the
    // capability was built for silently disabled it (straight to draft).
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain('?');
    const chipIds = (body.suggested_actions as Array<{ id: string }>).map((a) => a.id);
    expect(chipIds).toContain(CLARIFY_V2_PROCEED_CHIP_ID);
  });

  it('A5 control: a POPULATED canvas keeps clarify v2 out (gate is population, not nullness)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(THIN_BRIEF, {
        graph_state: {
          nodes: [{ id: 'n1', kind: 'decision', label: 'Expand?' }],
          edges: [],
        },
      }),
    });
    // A populated graph means the scenario has a model: clarify v2 (a
    // strictly pre-draft capability) must not claim the turn. The pin is
    // the ROUTING: no clarify chips on the wire.
    expect(res.statusCode).toBeGreaterThanOrEqual(200);
    const body = JSON.parse(res.body);
    const chipIds = ((body.suggested_actions ?? []) as Array<{ id: string }>).map((a) => a.id);
    expect(chipIds).not.toContain(CLARIFY_V2_PROCEED_CHIP_ID);
  });

  it('FLAG ON: a complete brief proceeds SILENTLY — the draft dispatch is bit-identical to flag-off', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const args = dispatchDraftGraphMock.mock.calls[0]![0] as Record<string, unknown>;
    expect('briefOverride' in args).toBe(false);
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toBe('Drafted the model.');
  });

  // ── TRACK-1 INTAKE FIX (2026-08-13): draft-first on a single-gap brief ──
  // Real wire captures (draft-reliability baseline 2026-08-12): S5 is
  // goal-only-missing (single gap), S1 is goal+quantities (two gaps).
  const SINGLE_GAP_BRIEF =
    'Should we raise our subscription price by 10% next quarter, or hold it steady?';
  const TWO_GAP_BRIEF =
    'Should we hire a second support engineer this quarter, or wait until January?';
  /** The provenance marker the disclosure must carry on the wire. */
  const PROVENANCE_MARKER = 'not something you told me';

  it('DRAFT-FIRST: a single-gap brief drafts immediately and the wire carries the disclosed assistant-authored assumption', async () => {
    dispatchDraftGraphMock.mockResolvedValue({
      ...makeDraftMockResult(),
      // A graph actually landed on the canvas — the disclosure's truth
      // condition (route gate: dg.graph !== null).
      graph: { nodes: [{ id: 'goal_1', kind: 'goal', label: 'Grow revenue' }], edges: [] },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(SINGLE_GAP_BRIEF),
    });
    expect(res.statusCode).toBe(200);
    // The draft ran — no blocking clarify turn, no LLM routing call.
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    expect(chatWithToolsMock).not.toHaveBeenCalled();
    const args = dispatchDraftGraphMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(String(args.briefOverride)).toBe(SINGLE_GAP_BRIEF);
    // Non-blocking by construction: NO clarify turn committed, NO
    // clarify_v2_round pending persisted (nothing to resume post-draft).
    expect(appendMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    // The draft narrative ships, PLUS the disclosure: assumption named as
    // the ASSISTANT's, carrying the goal question — never presented as
    // something the user stated.
    expect(body.assistant_text).toContain('Drafted the model.');
    expect(body.assistant_text).toContain(PROVENANCE_MARKER);
    expect(body.assistant_text).toContain('What outcome would make this decision a success?');
    // No clarify chips ride the draft response (chip-row budget is the
    // draft's own; the question is answerable by typing or on the canvas).
    const chipIds = ((body.suggested_actions ?? []) as Array<{ id: string }>).map((a) => a.id);
    expect(chipIds).not.toContain(CLARIFY_V2_PROCEED_CHIP_ID);
  });

  it('DRAFT-FIRST truth gate: when no graph landed, the disclosure is withheld (a claim about a canvas model needs a canvas model)', async () => {
    dispatchDraftGraphMock.mockResolvedValue(makeDraftMockResult()); // graph: null
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(SINGLE_GAP_BRIEF),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(res.body);
    expect(body.assistant_text).not.toContain(PROVENANCE_MARKER);
  });

  it('DRAFT-FIRST off-by-one control: a TWO-gap brief still gets the blocking ask, never a draft', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(TWO_GAP_BRIEF),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain('?');
    const chipIds = ((body.suggested_actions ?? []) as Array<{ id: string }>).map((a) => a.id);
    expect(chipIds).toContain(CLARIFY_V2_PROCEED_CHIP_ID);
  });

  it('FLAG ON: explicit-generate RESPECTS the generate instruction and DRAFTS — even on a thin brief (clarifying over Generate is a dead-end class)', async () => {
    // First-message-drafts doctrine (a1/first-message-drafts, 19 Jul journey
    // probe): a user who pressed Generate (generate_model) has EXPLICITLY
    // asked to draft. Clarify v2 must never interrupt that with a question
    // list — the verified worst-first-impression bug. This inverts the E0-B
    // launch behaviour (which clarified over explicit-generate on a thin
    // brief); the rubric still governs every NON-generate draft-shaped turn.
    persistedBriefTextForRead = THIN_BRIEF;
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload('Yes, build the model now please', {
        source: 'chip_click',
        chip: {},
        generate_model: true,
      }),
    });
    expect(res.statusCode).toBe(200);
    // Drafts (respects Generate), never clarifies: the draft dispatch runs
    // with the assembled explicit-generate brief, and no clarify chips ship.
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const args = dispatchDraftGraphMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(String(args.briefOverride)).toBe(THIN_BRIEF);
    const body = JSON.parse(res.body);
    const chipIds = ((body.suggested_actions ?? []) as Array<{ id: string }>).map((a) => a.id);
    expect(chipIds).not.toContain(CLARIFY_V2_PROCEED_CHIP_ID);
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  it('FIRST MESSAGE DRAFTS: the journey probe (fully-specified brief + generate_model on turn 1) DRAFTS, never clarifies (scenario 43238dd6, 19 Jul)', async () => {
    // The verified worst-first-impression bug: a new user's first message
    // carried a fully-specified decision AND generate_model:true, yet the
    // clarify_v2 gate interrupted with goal+timeframe questions — no graph
    // arrived until a second "go ahead" turn. With the generate flag
    // respected AND the rubric crediting the already-given runway, turn 1
    // must draft.
    const PROBE_BRIEF =
      'Should we hire a senior engineer now or wait until after our next funding round? Budget around £120k, current runway 14 months.';
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(PROBE_BRIEF, { generate_model: true }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const args = dispatchDraftGraphMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(String(args.briefOverride)).toContain('senior engineer');
    const body = JSON.parse(res.body);
    const chipIds = ((body.suggested_actions ?? []) as Array<{ id: string }>).map((a) => a.id);
    expect(chipIds).not.toContain(CLARIFY_V2_PROCEED_CHIP_ID);
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  // ── PR #490 review P1 — over-length round-1 brief must round-trip ───────
  it('ROUND-TRIP: a >5000-char round-1 brief persists a pending its own READER accepts; the answer turn resumes and drafts', async () => {
    // Thin decision question + long pasted background (the live probe that
    // proved the dead end was 6,341 chars).
    const longBrief = `${THIN_BRIEF} ${'Background detail. '.repeat(340)}`.trim();
    expect(longBrief.length).toBeGreaterThan(5000);
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(longBrief),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    const committed = appendMock.mock.calls[0]![0] as Record<string, unknown>;
    const pendingRow = (committed.pending_actions as PendingAction[]).find(
      (p) => p.action.kind === 'clarify_v2_round',
    );
    expect(pendingRow).toBeDefined();
    // The REAL read-side gate: the store only returns rows parsePendingAction
    // accepts (supabase-store drops the rest as PendingActionsReadDegraded).
    // Before the round-1 cap this returned null and the round was dead.
    const parsed = parsePendingAction(pendingRow);
    expect(parsed).not.toBeNull();

    // Answer turn: feed the parse-accepted row back, exactly as the store would.
    pendingActionsForRead = [parsed!];
    hasPriorTurnsForRead = true;
    appendMock.mockClear();
    const answer =
      'The goal is to increase revenue; the alternative is doing nothing; the stakes are around £200,000; it plays out within this year.';
    const res2 = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(answer),
    });
    expect(res2.statusCode).toBe(200);
    // Answers incorporated → the draft dispatch runs with the augmented
    // brief (still ≤ the draft pipeline's Zod max).
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const args = dispatchDraftGraphMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(String(args.briefOverride)).toContain('increase revenue');
    expect(String(args.briefOverride).length).toBeLessThanOrEqual(5000);
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  it('ROUND-TRIP: the escape chip stays ALIVE after a >5000-char round-1 brief (go-ahead proceeds to draft)', async () => {
    const longBrief = `${THIN_BRIEF} ${'Background detail. '.repeat(340)}`.trim();
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(longBrief),
    });
    const committed = appendMock.mock.calls[0]![0] as Record<string, unknown>;
    const parsed = parsePendingAction(
      (committed.pending_actions as PendingAction[]).find(
        (p) => p.action.kind === 'clarify_v2_round',
      ),
    );
    expect(parsed).not.toBeNull();
    pendingActionsForRead = [parsed!];
    hasPriorTurnsForRead = true;
    const res2 = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(CLARIFY_V2_PROCEED_MESSAGE, { source: 'chip_click', chip: {} }),
    });
    expect(res2.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const args = dispatchDraftGraphMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(String(args.briefOverride).length).toBeLessThanOrEqual(5000);
  });

  // ── First-message-drafts doctrine — explicit-generate on a continuation
  //    with a live hold DRAFTS (never clarifies); hold carry-forward is then
  //    the draft dispatch's own concern (task_2e1b8c87, pinned in
  //    draft-graph-dispatch tests). Round-1 clarify-commit hold survival is
  //    still pinned NON-generate at the dispatch level (clarify-v2.dispatch
  //    .test.ts "A7 survival control"), which reaches round 1 with
  //    draftShaped:true directly, bypassing the route's continuation guard.
  it('EXPLICIT-GENERATE continuation: a live hold present, the turn DRAFTS with the assembled brief (respects Generate; does not clarify)', async () => {
    hasPriorTurnsForRead = true;
    persistedBriefTextForRead = THIN_BRIEF;
    pendingActionsForRead = [makeProposedConceptHold()];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload('Yes, build the model now please', {
        source: 'chip_click',
        chip: {},
        generate_model: true,
      }),
    });
    expect(res.statusCode).toBe(200);
    // Drafts, never clarifies: the explicit-generate instruction is honoured.
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const args = dispatchDraftGraphMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(String(args.briefOverride)).toBe(THIN_BRIEF);
    const body = JSON.parse(res.body);
    const chipIds = ((body.suggested_actions ?? []) as Array<{ id: string }>).map((a) => a.id);
    expect(chipIds).not.toContain(CLARIFY_V2_PROCEED_CHIP_ID);
  });

  it('HOLD SURVIVAL on RESUME: the follow-up ask supersedes the previous round but CARRIES an unrelated hold', async () => {
    hasPriorTurnsForRead = true;
    pendingActionsForRead = [
      livePending(THIN_BRIEF, ['goal', 'options', 'timeframe'], 1),
      makeProposedConceptHold(),
    ];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(
        'The goal is to increase revenue; the alternative is doing nothing; it plays out within this year.',
      ),
    });
    expect(res.statusCode).toBe(200);
    const committed = appendMock.mock.calls[0]![0] as Record<string, unknown>;
    const pendings = committed.pending_actions as PendingAction[];
    const clarifyRounds = pendings.filter((p) => p.action.kind === 'clarify_v2_round');
    // Exactly one round survives (same chip_id → supersession, no zombie twin)…
    expect(clarifyRounds).toHaveLength(1);
    if (clarifyRounds[0]!.action.kind === 'clarify_v2_round') {
      expect(clarifyRounds[0]!.action.round).toBe(2);
    }
    // …and the unrelated hold is carried, not wiped.
    expect(pendings.map((p) => p.action.kind)).toContain('proposed_concept');
  });

  // ── FLAG ON: resume ──────────────────────────────────────────────────────
  it('RESUME: an answer is incorporated and a NEVER-ASKED dimension is asked next (no-repeat)', async () => {
    hasPriorTurnsForRead = true;
    // Round 1 asked goal/options/timeframe. quantities was never asked.
    pendingActionsForRead = [livePending(THIN_BRIEF, ['goal', 'options', 'timeframe'], 1)];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(
        // Answers goal + options + timeframe in one go; quantities still open.
        'The goal is to increase revenue; the alternative is doing nothing; it plays out within this year.',
      ),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect(chatWithToolsMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    // Only the never-asked dimension may be asked.
    expect(body.assistant_text).toContain('scale');
    expect(body.assistant_text).not.toContain('What outcome would make this decision a success?');
    // Follow-up round persisted with accumulated asked-history.
    const committed = appendMock.mock.calls[0]![0] as Record<string, unknown>;
    const pending = (committed.pending_actions as PendingAction[])[0]!;
    if (pending.action.kind !== 'clarify_v2_round') throw new Error('wrong pending kind');
    expect(pending.action.round).toBe(2);
    expect(pending.action.asked_dimensions).toContain('quantities');
    expect(pending.action.asked_dimensions).toContain('goal');
    expect(pending.action.brief).toContain(THIN_BRIEF);
    expect(pending.action.brief).toContain('increase revenue');
  });

  it('RESUME: a completing answer proceeds to the draft with the answer-augmented briefOverride', async () => {
    hasPriorTurnsForRead = true;
    pendingActionsForRead = [livePending(THIN_BRIEF, ['goal', 'options', 'timeframe'], 1)];
    const answer =
      'The goal is to increase revenue; the alternative is doing nothing; the stakes are around £200,000; it plays out within this year.';
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(answer),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const args = dispatchDraftGraphMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(String(args.briefOverride)).toContain(THIN_BRIEF);
    expect(String(args.briefOverride)).toContain('£200,000');
    // The committed turn keeps the verbatim wire message.
    expect((args.payload as Record<string, unknown>).message).toBe(answer);
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  it('RESUME: the default-forward chip proceeds immediately with the working brief (ready-to-draft stop rule)', async () => {
    hasPriorTurnsForRead = true;
    pendingActionsForRead = [livePending(THIN_BRIEF, ['goal', 'options', 'timeframe'], 1)];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(CLARIFY_V2_PROCEED_MESSAGE, { source: 'chip_click', chip: {} }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const args = dispatchDraftGraphMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.briefOverride).toBe(THIN_BRIEF);
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  it('RESUME: never claims a turn once a graph exists — falls through to pre-existing routing', async () => {
    hasPriorTurnsForRead = true;
    pendingActionsForRead = [livePending(THIN_BRIEF, ['goal'], 1)];
    persistedGraphForRead = { nodes: [], edges: [] };
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload('The goal is to increase revenue.'),
    });
    // Pre-existing routing = TurnExecutor (deterministic pre-routes or the
    // routing LLM — either way, NOT clarify v2). The pin is the ROUTING:
    // no draft dispatch, no clarify response on the wire.
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    const chipIds = ((body.suggested_actions ?? []) as Array<{ id: string }>).map((a) => a.id);
    expect(chipIds).not.toContain(CLARIFY_V2_PROCEED_CHIP_ID);
    expect(res.statusCode).toBeGreaterThanOrEqual(200);
  });

  it('FLAG ON: an EXPIRED clarify pending does not claim the turn (falls through)', async () => {
    hasPriorTurnsForRead = true;
    const expired = {
      ...livePending(THIN_BRIEF, ['goal'], 1),
      expires_at_iso: new Date(Date.now() - 60_000).toISOString(),
    } as PendingAction;
    pendingActionsForRead = [expired];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload('The goal is to increase revenue.'),
    });
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    const chipIds = ((body.suggested_actions ?? []) as Array<{ id: string }>).map((a) => a.id);
    expect(chipIds).not.toContain(CLARIFY_V2_PROCEED_CHIP_ID);
    expect(res.statusCode).toBeGreaterThanOrEqual(200);
  });
});
