/**
 * ROADMAP 2.63 C1+C2 — stage-2 explicit-generate wire (CEE half).
 *
 * Root cause (diagnosis brief generate-wire-2.63.md, live-reproduced P1–P5
 * on CEE staging 2026-07-16): the `generate_model` / `explicit_generate`
 * fields parse through B1 ingress at the 0.16.0 pin but NO live V5 code
 * read them — `draft_graph` was reachable solely via the first-turn
 * brief-shape heuristic, which a confirm-chip's short canned message
 * structurally fails (frame_no_brief_guard on fresh scenarios — live P2;
 * TurnExecutor conversation on continuations — live P3).
 *
 * These tests drive `POST /orchestrate/v2/turn` with the LIVE P2 wire shape
 * (`kind:'message'`, `stage:'frame'`, `turn_class:'frame'`,
 * `source:'chip_click'`, `chip:{}`) plus the flag, with `dispatchDraftGraph`
 * mocked as a dispatch detector and the LLM router mocked to THROW (every
 * C1/C2 path must be deterministic — zero LLM routing calls).
 *
 * RED-first (verified on base 57959b2c3 by reverting the src/ half of this
 * change in a throwaway worktree): the flag-dispatch, continuation-bypass,
 * brief-assembly and honest-decline cases all fail on the unmodified route;
 * the no-flag guard case and the C4 graph-present pin pass before AND after
 * (behaviour-preservation pins).
 *
 * Scope note (UPDATED for the C3+C4 lane, Paul-ratified 16 Jul): the
 * original C1+C2 change PINNED the graph-present fall-through as a named
 * PAUL-GATED TODO. That pin is now REPLACED by the ratified C4 doctrine —
 * decline-with-redraft-offer — in the "flag with a persisted graph" case
 * below (the old fall-through expectation goes RED against the C4 build,
 * by design). C3/C4 mechanism coverage (offer seeding, consent resume,
 * goldens) lives in route-v2-draft-offer.test.ts.
 * Mocking strategy mirrors route-v2-held-proposal-confirm.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { GraphV3 } from '../../schemas/cee-v3.js';
import type { SessionTurnWithContent } from '../../orchestrator-v5/session/conversation-content.js';
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
    readMostRecentPendingActions: async () => [],
    hasPriorTurns: async () => hasPriorTurnsForRead,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// Every C1/C2 outcome (dispatch, decline) is deterministic; an LLM routing
// call on those paths is a wiring failure and must fail the test loudly.
// The C4 fall-through pin EXPECTS this to be called (proof the turn reached
// the pre-existing TurnExecutor routing).
const chatWithToolsMock = vi.fn().mockImplementation(async () => {
  throw new Error('LLM router must NOT be called on a deterministic explicit-generate path');
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

const SCENARIO_ID = '88888888-8888-4888-8888-888888888888';

/** The live P2 probe brief (104 chars, matches the decision regex). */
const REAL_BRIEF =
  'Should we hire a senior tech lead or two junior developers to accelerate the platform rebuild this year?';

/** The live P2 probe chip message — 31 chars, fails the decision regex. */
const CANNED_CHIP_MESSAGE = 'Yes, build the model now please';

/** frame_no_brief_guard's canned copy prefix (must NOT serve flag turns). */
const FRAME_GUARD_COPY = 'I need a single decision question to start';

/** Minimal strict GraphV3 fixture for the C4 graph-present pin. */
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

/** The live P2 wire shape (generate-wire-2.63.md Finding 4), field-for-field. */
function p2Payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: '99999999-9999-4999-8999-999999999999',
    scenario_id: SCENARIO_ID,
    stage: 'frame',
    turn_class: 'frame',
    message: CANNED_CHIP_MESSAGE,
    source: 'chip_click',
    chip: {},
    ...overrides,
  };
}

function turnWithUserMessage(userMessage: string | null): Partial<SessionTurnWithContent> {
  return {
    id: 'row-' + Math.random().toString(36).slice(2, 10),
    scenario_id: SCENARIO_ID,
    turn_id: 'turn-' + Math.random().toString(36).slice(2, 10),
    user_message: userMessage,
    assistant_message: 'Assistant reply.',
  };
}

describe('POST /orchestrate/v2/turn — explicit-generate wire flag (ROADMAP 2.63 C1+C2)', () => {
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
  });

  // ── C1+C2, the diagnosis's P2 pin: canned chip click + flag + persisted
  //    brief must draft FROM THE PERSISTED BRIEF (exit draft_graph, not
  //    frame_no_brief_guard) ────────────────────────────────────────────────
  it('P2 wire shape + generate_model + persisted brief_text drafts from the persisted brief (zero LLM routing calls)', async () => {
    persistedBriefTextForRead = REAL_BRIEF;
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: p2Payload({ generate_model: true }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const args = dispatchDraftGraphMock.mock.calls[0]![0] as Record<string, unknown>;
    // C2: the pipeline drafts from the server-assembled brief, not the
    // chip's canned text.
    expect(args.briefOverride).toBe(REAL_BRIEF);
    // The committed turn keeps the verbatim wire message.
    expect((args.payload as Record<string, unknown>).message).toBe(CANNED_CHIP_MESSAGE);
    expect(chatWithToolsMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body.assistant_text).not.toContain(FRAME_GUARD_COPY);
  });

  // ── C1: explicit_generate alias behaves identically ──────────────────────
  it('explicit_generate (the UI alias) triggers the same deterministic dispatch', async () => {
    persistedBriefTextForRead = REAL_BRIEF;
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: p2Payload({ explicit_generate: true }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  // ── C1: the continuation guard must NOT strand an explicit generate ─────
  it('a brief-shaped composer message + flag on a CONTINUATION scenario drafts (bypasses the Signature-Loop guard)', async () => {
    hasPriorTurnsForRead = true; // today this suppresses the draft shortcut
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: p2Payload({
        message: REAL_BRIEF,
        source: 'composer',
        chip: undefined,
        generate_model: true,
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const args = dispatchDraftGraphMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.briefOverride).toBe(REAL_BRIEF);
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  // ── C2: brief recovered from the conversation chain ─────────────────────
  it('canned chip click + flag with NO persisted brief drafts from the most recent brief-shaped user turn', async () => {
    hasPriorTurnsForRead = true;
    recentTurnsForRead = [
      turnWithUserMessage('thanks'), // most recent — too short, skipped
      turnWithUserMessage(REAL_BRIEF), // the actual brief, recovered
      turnWithUserMessage(null),
    ];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: p2Payload({ generate_model: true }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const args = dispatchDraftGraphMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.briefOverride).toBe(REAL_BRIEF);
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  // ── C2: honest deterministic decline when nothing usable exists ─────────
  it('canned chip click + flag with no brief anywhere returns the honest decline (no draft, no LLM, no frame-guard copy, no commit)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: p2Payload({ generate_model: true }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect(chatWithToolsMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    // Names what is missing and how to proceed — NOT the frame guard's
    // "first-time framing" copy, and never a silent conversational reply.
    expect(body.assistant_text).toContain("don't have a decision brief");
    expect(body.assistant_text).toContain('Tell me the decision in one sentence');
    expect(body.assistant_text).not.toContain(FRAME_GUARD_COPY);
    // Like frame_no_brief_guard (live P4/P5), the decline commits nothing —
    // the scenario stays draftable.
    expect(appendMock).not.toHaveBeenCalled();
  });

  // ── C4 (Paul-ratified 16 Jul — decline-with-redraft-offer): flag +
  //    persisted graph gets the deterministic decline, an offer chip, and a
  //    committed `draft_graph` (redraft) pending. REPLACES the previous
  //    PAUL-GATED fall-through pin (which this test used to assert: no
  //    draft, chatWithTools CALLED, no decline copy — that expectation goes
  //    RED against this build, by design). ─────────────────────────────────
  it('flag arriving with a PERSISTED graph gets the deterministic decline-with-redraft-offer (C4)', async () => {
    persistedGraphForRead = STRICT_GRAPH;
    persistedBriefTextForRead = REAL_BRIEF;
    hasPriorTurnsForRead = true;
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: p2Payload({ generate_model: true }),
    });
    expect(res.statusCode).toBe(200);
    // Deterministic: no draft dispatched, zero LLM routing calls.
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect(chatWithToolsMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    // Decline copy: says a model already exists; never the no-brief decline
    // and never the frame guard's first-time framing copy.
    expect(body.assistant_text).toContain('already has a model');
    expect(String(body.assistant_text)).not.toContain("don't have a decision brief");
    expect(body.assistant_text).not.toContain(FRAME_GUARD_COPY);
    // The redraft route is OFFERED: exactly one chip, whose message is the
    // replay copy the consent turn resumes on.
    expect(body.suggested_actions).toHaveLength(1);
    expect(body.suggested_actions[0].label).toBe('Redraft the model');
    // The offer COMMITS (pendings live on committed turn rows) with a
    // draft_graph redraft pending whose chip_id matches the offered chip.
    expect(appendMock).toHaveBeenCalledTimes(1);
    const write = appendMock.mock.calls[0]![0] as {
      pending_actions: readonly { chip_id: string; action: Record<string, unknown> }[];
    };
    expect(write.pending_actions).toHaveLength(1);
    expect(write.pending_actions[0]!.action.kind).toBe('draft_graph');
    expect(write.pending_actions[0]!.action.redraft).toBe(true);
    expect(write.pending_actions[0]!.chip_id).toBe(body.suggested_actions[0].id);
  });

  // ── No-flag regression pin: the P2 shape WITHOUT the flag keeps landing
  //    in frame_no_brief_guard (today's behaviour, live P2) ────────────────
  it('P2 wire shape WITHOUT the flag still gets the frame_no_brief_guard framing prompt', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: p2Payload(),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect(chatWithToolsMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain(FRAME_GUARD_COPY);
  });
});
