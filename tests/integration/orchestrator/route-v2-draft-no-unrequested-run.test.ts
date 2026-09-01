/**
 * TURN ONE FRAMES THE PROBLEM — it does not score it.
 *
 * This file is the NEGATIVE PIN left behind by the deletion of the post-draft
 * auto-run (`scheduleAutoRunAfterFreshDraft`, removed 2026-09-01). A deletion
 * with no guard is an invitation to re-add: the previous behaviour had a whole
 * spec asserting the auto-run FIRED, and nothing would have failed if a later
 * session restored it.
 *
 * ── WHY THE DELETION ────────────────────────────────────────────────────────
 * A user who had just described a messy situation got a Monte Carlo they never
 * asked for, and from then on the conversation was a status report on that
 * result. The run also armed the post-analysis advice gate, which then claimed
 * "help me understand …" and answered it with `llm_calls_used: 0`.
 *
 * ── BOTH DIRECTIONS, IN ONE RUN ─────────────────────────────────────────────
 * The decisive risk of removing an unrequested run is removing the REQUESTED
 * one, and a spec that only asserts the absence cannot see that. So every case
 * here is paired: the draft turn must start nothing, AND the chip turn must
 * still start a run, on the same harness in the same file. If a future change
 * disables the run path wholesale, the negative half would still pass — the
 * positive half is what makes this spec's absence claim mean anything
 * (CLAUDE.md trap 13: a probe that cannot see a presence proves no absence).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { DRAFT_GRAPH_MIN_BRIEF_LENGTH } from '../../../src/schemas/assist.js';

// -------- Mocks (same seams as route-v2-draft-graph.test.ts) --------
const dispatchDraftGraphMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: dispatchDraftGraphMock,
}));

/**
 * TWO observation seams, because the two directions enter by DIFFERENT doors
 * and a single mock would be pointed at the wrong one (CLAUDE.md trap 3b/19 —
 * a test bound to an object other than the one it names).
 *
 *   · `dispatchChipClickRunAnalysis` is what the DELETED auto-run imported and
 *     called DIRECTLY. It is the symbol a re-added auto-run would reach for, so
 *     it is the only seam on which "the draft started nothing" is a real claim.
 *     Asserting on the deterministic-chip seam instead would pass happily while
 *     a restored auto-run ran underneath it.
 *   · `dispatchDeterministicChipClick` is what route-v2 calls for a USER's chip
 *     turn. It is the seam the positive twin needs.
 */
const runAnalysisMock = vi.fn();
const dispatchChipClickMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/handlers/chip-click-dispatch.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/orchestrator-v5/handlers/chip-click-dispatch.js')
  >('../../../src/orchestrator-v5/handlers/chip-click-dispatch.js');
  return {
    ...actual,
    dispatchChipClickRunAnalysis: runAnalysisMock,
    dispatchDeterministicChipClick: dispatchChipClickMock,
  };
});

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
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
    resolution: {
      task: 'narrate',
      resolved_model: 'test-model',
      resolution_source: 'task_default' as const,
    },
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

const SCENARIO_ID = '22222222-2222-4222-8222-222222222222';
const TURN_ID = '11111111-1111-4111-8111-111111111111';
const LONG_BRIEF =
  'Should we expand the product into the German market next quarter or hold?';

const DRAFT_GRAPH = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Grow revenue' },
    { id: 'opt_1', kind: 'option', label: 'Expand', interventions: { fac_1: 0.4 } },
    { id: 'opt_2', kind: 'option', label: 'Hold' },
    { id: 'fac_1', kind: 'factor', label: 'Market demand' },
  ],
  edges: [],
};
const DRAFT_GRAPH_HASH = 'aag_v1:11112222333344445555666677778888';

function draftResult(overrides: Record<string, unknown> = {}) {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'Drafted a decision model from your brief.',
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

function draftTurnPayload(turnId = TURN_ID) {
  return {
    kind: 'message',
    turn_id: turnId,
    scenario_id: SCENARIO_ID,
    stage: 'frame',
    message: LONG_BRIEF,
    turn_class: 'frame',
    source: 'composer',
  };
}

describe('POST /orchestrate/v2/turn — a fresh draft starts no analysis the user did not ask for', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    expect(LONG_BRIEF.length).toBeGreaterThanOrEqual(DRAFT_GRAPH_MIN_BRIEF_LENGTH);
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    dispatchDraftGraphMock.mockReset();
    dispatchChipClickMock.mockReset();
    runAnalysisMock.mockReset();
    appendMock.mockClear();
  });

  // ── THE DELETION, PINNED ──────────────────────────────────────────────────

  it('a successful fresh draft dispatches NO run', async () => {
    dispatchDraftGraphMock.mockResolvedValueOnce(draftResult());

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: draftTurnPayload(),
    });

    expect(res.statusCode).toBe(200);
    // The draft itself still happens — without this the absence below could be
    // satisfied by the draft never running at all.
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    // And nothing started an analysis off the back of it — asserted on the
    // seam a re-added auto-run would actually use, not on a neighbouring one.
    expect(runAnalysisMock).not.toHaveBeenCalled();
    expect(dispatchChipClickMock).not.toHaveBeenCalled();
  });

  it('the draft response never claims an analysis is running', async () => {
    // `autoRunInFlight` was the ONE producer of `run_state.kind === 'running'`
    // in the estate (`compose/analysis-state-v1.ts`, limit L-A). With the
    // auto-run gone the draft exit can no longer make that claim, and a user
    // on turn one is not told a run they never requested is under way.
    dispatchDraftGraphMock.mockResolvedValueOnce(draftResult());

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: draftTurnPayload('11111111-1111-4111-8111-111111111112'),
    });

    expect(res.statusCode).toBe(200);
    expect(runAnalysisMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body) as {
      analysis_state?: { run_state?: { kind?: string } };
    };
    expect(body.analysis_state?.run_state?.kind).not.toBe('running');
  });

  // ── THE OPPOSITE DIRECTION — and it is what decides the change ────────────

  it('TWIN: an explicit "run the analysis" chip turn STILL dispatches a run', async () => {
    // Removing the unrequested run must not remove the requested one. This is
    // the assertion that makes the two negatives above meaningful rather than
    // vacuous: it proves the observation seam CAN see a run when one happens.
    dispatchChipClickMock.mockResolvedValueOnce({
      outcome: 'ok',
      response: {
        response_version: 2 as const,
        assistant_text: 'Analysis complete.',
        blocks: [],
        suggested_actions: [],
        insights: [],
        stage_indicator: 'analyse' as const,
      },
      commitPerformed: true,
      graph: null,
      answerKind: 'functional',
      mayNameLeadingOption: true,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-111111111115',
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'Run analysis.',
        turn_class: 'decide',
        source: 'chip_click',
        chip: { action_type: 'run_analysis' },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchChipClickMock).toHaveBeenCalledTimes(1);
    // Bound by IDENTITY (trap 19): it is the RUN that was dispatched, not some
    // other deterministic chip that happens to have been handled.
    expect(dispatchChipClickMock.mock.calls[0]![0]).toBe('run_analysis');
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
  });
});
