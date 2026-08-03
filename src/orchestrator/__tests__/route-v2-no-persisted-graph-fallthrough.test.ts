/**
 * ROADMAP 2.388 — THE MINUTE-ONE DEAD END.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT, measured live on staging build `672b634` by L56
 * (`PHASE0-EVIDENCE-2026-07-28/diagnosis-first-message-deadend.md`, 27 turns /
 * 23 distinct first messages, 9/9 pre-registered predictions matched):
 *
 *   A user's FIRST message — "Increase annual revenue from £4 million today to
 *   £6 million within 12 months." — comes back
 *
 *     "I can see you want to update the model, but I couldn't access the
 *      current graph. Please try again in a moment."
 *
 *   with `llm_calls: []` and `suggested_actions: []`. **Retrying the same
 *   message never works** (3/3 here, 10/10 on the walk): the advice the copy
 *   gives is the one thing that cannot succeed.
 *
 * WHY. `editIntentDetected` is decided from the message TEXT ALONE — an edit
 * verb (`increase|add|raise|reduce|set|…`) with no draft-shaped brief around
 * it. The route then asks whether a graph exists, and the ONLY thing it does
 * with the answer "no" is emit an error. There was no fall-back edge from
 * "edit intent + nothing to edit" to "help them start".
 *
 * ⭐ THE FIX, and why it needs no new copy. `no_persisted_graph` stops
 * returning and simply falls through. `route-v2.ts` already computes
 *
 *     const effectiveGraphState = resolvedGraphState ?? extensions.graphState;
 *     const isEditGraphShape = effectiveGraphState != null && editIntentDetected;
 *
 * and both operands of that `??` are null on this branch — so declining to
 * return IS the complete fall-through. The turn lands on
 * `frame_no_brief_guard`, which is what the SAME user already gets today when
 * their sentence happens to miss the edit-verb list (L56 case X5, "Grow annual
 * revenue…" → the framing coaching PLUS a "Build the model" chip). Shipped
 * copy, shipped affordance, one branch.
 *
 * ⚠ WHAT IS DELIBERATELY *NOT* CHANGED. `session_store_failed` and
 * `persisted_graph_invalid` KEEP the recovery copy. Those are genuine
 * transient / infrastructure failures where "try again in a moment" is honest
 * advice — which is the whole reason the three reasons were discriminated in
 * `sendEditGraphRecovery` in the first place. Both are pinned below; a fix
 * that swept all three into the fall-through turns those arms red.
 *
 * ⚠ THE CORPUS IS HAND-WRITTEN, NOT DERIVED (CLAUDE.md trap 12d). A guard
 * derived from the regexes can only prove the regexes agree with themselves;
 * it is structurally blind to a message shape nobody listed. The ten messages
 * below are L56's MEASURED dead ends, verbatim from the probe case files.
 *
 * ⚠ IDENTITY BINDING (trap 19). The chip is asserted against the PRODUCTION
 * constants imported from `route-v2.ts` — never a retyped string, and never
 * "there is at least one suggested action", which any other chip would satisfy.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { setTestSink, TelemetryEvents } from '../../utils/telemetry.js';
import { _resetConfigCache } from '../../config/index.js';

// ── Session store: the ONE fact under test is what `loadGraph` does ────────
/** `null` ⇒ no persisted graph (the defect's precondition). */
let persistedGraphForRead: unknown = null;
/** `true` ⇒ `loadGraph` throws ⇒ `session_store_failed`. */
let loadGraphThrows = false;

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string | null) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => {
      if (loadGraphThrows) throw new Error('simulated session store failure');
      return persistedGraphForRead;
    },
    loadGraphAndBriefText: async () => ({
      graph: loadGraphThrows ? null : persistedGraphForRead,
      briefText: null,
    }),
    readMostRecentPendingActions: async () => [],
    hasPriorTurns: async () => false,
    countTurns: async () => 0,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

/**
 * The frame guard is DETERMINISTIC — reaching an LLM on these turns is itself
 * the failure. A throwing adapter turns "the route answered without a model"
 * into an observable, rather than something inferred from a body.
 */
const chatWithToolsMock = vi.fn().mockImplementation(async () => {
  throw new Error('LLM router must NOT be called on a deterministic frame-guard turn');
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
    resolution: {
      task: 'narrate',
      resolved_model: 'test-model',
      resolution_source: 'task_default' as const,
    },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

// The production constants themselves — this file and the guard cannot drift
// apart on the chip copy or the recovery copy (CLAUDE.md trap 12).
const {
  ceeOrchestratorRouteV2,
  EDIT_GRAPH_RECOVERY_TEXT,
  DRAFT_OFFER_CHIP_LABEL,
  DRAFT_OFFER_CHIP_MESSAGE,
} = await import('../route-v2.js');

const SCENARIO_ID = '23880000-2388-4388-8388-238823882388';

/** The guard's own opening clause — the coaching the user should see instead. */
const FRAME_GUARD_COPY = 'I need a single decision question to start';

/**
 * ⭐ L56'S MEASURED DEAD ENDS, VERBATIM. Each of these returned
 * `exit_path: edit_graph` + `EDIT_GRAPH_RECOVERY_TEXT` + zero chips on the
 * deployed build, as a FIRST message on a fresh scenario. Tags are L56's.
 *
 * `expectChip` is DERIVED from the shipped rule, not wished for: the frame
 * guard seeds the "Build the model" offer only when the normalised message
 * clears `DRAFT_GRAPH_MIN_BRIEF_LENGTH` (30). X2 is 24 characters, so it gets
 * the coaching WITHOUT a chip — recorded honestly rather than asserted away,
 * because a corpus that quietly expects the wrong thing is how a short list
 * survives.
 */
const MEASURED_DEAD_ENDS: ReadonlyArray<
  readonly [tag: string, message: string, expectChip: boolean]
> = [
  ['S1', 'Increase annual revenue from £4 million today to £6 million within 12 months.', true],
  ['S2', 'We need to reduce churn to under 5% this year.', true],
  ['S5', 'Add a second sales team in Berlin.', true],
  ['S7', 'Raise the price from £49 to £59.', true],
  [
    'X1',
    'Increase annual recurring revenue from £4 million today to £6 million within twelve months, while keeping the marketing budget flat and the engineering headcount exactly where it is right now.',
    true,
  ],
  ['X2', 'Launch it and add a fee.', false],
  [
    'X7',
    'Our board wants us to increase annual recurring revenue to £6 million next year while reducing support costs by a fifth. Nothing else has been agreed yet.',
    true,
  ],
  ['X9', 'Increase revenue to £6 million? That is the plan for the year ahead.', true],
  [
    'Z3',
    'After weighing our options, we will increase annual revenue from £4 million to £6 million within 12 months.',
    true,
  ],
  ['Z4', 'We could increase the price from £49 to £59 to improve margins.', true],
];

let events: Array<{ name: string; data: Record<string, unknown> }> = [];
let priorTraceFlag: string | undefined;

function post(app: FastifyInstance, message: string, stage: 'frame' | 'analyse' = 'frame') {
  return app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'message',
      turn_id: '23881111-2388-4388-8388-238823881111',
      scenario_id: SCENARIO_ID,
      stage,
      turn_class: stage === 'frame' ? 'frame' : 'propose',
      message,
      source: 'composer',
    },
  });
}

async function turn(app: FastifyInstance, message: string, stage: 'frame' | 'analyse' = 'frame') {
  const res = await post(app, message, stage);
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}

function exitPath(body: Record<string, any>): unknown {
  return body._diagnostic_trace?.exit_path;
}

describe('ROADMAP 2.388 — an edit verb with nothing to edit COACHES instead of erroring', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    priorTraceFlag = process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
    _resetConfigCache();
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    if (priorTraceFlag === undefined) delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    else process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = priorTraceFlag;
    _resetConfigCache();
    setTestSink(null);
  });

  beforeEach(() => {
    persistedGraphForRead = null;
    loadGraphThrows = false;
    events = [];
    setTestSink((name, data) => {
      events.push({ name, data: data as Record<string, unknown> });
    });
    chatWithToolsMock.mockClear();
    appendMock.mockClear();
  });

  // ── INSTRUMENT FIRST: an unmeasurable assertion is a vacuous one ──────────

  it('INSTRUMENT: `_diagnostic_trace.exit_path` really is on the wire', async () => {
    const { body } = await turn(app, MEASURED_DEAD_ENDS[0]![1]);
    expect(
      exitPath(body),
      'the flag-gated trace is the surface every exit_path assertion below reads',
    ).toBeDefined();
  });

  // ── THE HEADLINE CASE, identity-bound ────────────────────────────────────

  it('THE WALK\'S CASE A: a first message with an edit verb and no graph reaches the frame guard\'s coaching', async () => {
    const { status, body } = await turn(
      app,
      'Increase annual revenue from £4 million today to £6 million within 12 months.',
    );

    expect(status).toBe(200);
    expect(exitPath(body)).toBe('frame_no_brief_guard');
    expect(body.assistant_text).toContain(FRAME_GUARD_COPY);
    expect(
      body.assistant_text,
      'the "try again in a moment" dead end must be gone from this turn entirely',
    ).not.toContain(EDIT_GRAPH_RECOVERY_TEXT);

    // IDENTITY: the affordance is THE draft offer, matched against the
    // producer's own constants — not "some chip exists".
    expect(body.suggested_actions).toHaveLength(1);
    expect(body.suggested_actions[0]).toMatchObject({
      label: DRAFT_OFFER_CHIP_LABEL,
      message: DRAFT_OFFER_CHIP_MESSAGE,
    });
  });

  it('no LLM is called — the recovery is deterministic, as the dead end was', async () => {
    await turn(app, 'Increase annual revenue from £4 million today to £6 million within 12 months.');
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  // ── THE HAND-WRITTEN CORPUS ──────────────────────────────────────────────

  it.each(MEASURED_DEAD_ENDS)(
    '%s recovers: coaching, never the recovery error',
    async (_tag, message, expectChip) => {
      const { status, body } = await turn(app, message);

      expect(status).toBe(200);
      expect(
        body.assistant_text,
        'this exact message returned the dead-end copy on staging 672b634',
      ).not.toContain(EDIT_GRAPH_RECOVERY_TEXT);
      expect(exitPath(body)).toBe('frame_no_brief_guard');
      expect(body.assistant_text).toContain(FRAME_GUARD_COPY);

      if (expectChip) {
        expect(body.suggested_actions).toHaveLength(1);
        expect(body.suggested_actions[0]).toMatchObject({
          label: DRAFT_OFFER_CHIP_LABEL,
          message: DRAFT_OFFER_CHIP_MESSAGE,
        });
      } else {
        // Below the shipped brief-seed floor — coaching, no offer. Asserted
        // rather than skipped so a change to that floor is visible here.
        expect(body.suggested_actions).toHaveLength(0);
      }
    },
  );

  // ── TELEMETRY: the class must stay observable ────────────────────────────

  it('the fall-through emits its OWN event, so the class does not vanish from dashboards', () => {
    // A defect that stops erroring and stops being counted is a defect that
    // stops being measurable. The reason moved doors; it did not disappear.
    return turn(
      app,
      'Increase annual revenue from £4 million today to £6 million within 12 months.',
    ).then(() => {
      const fallthrough = events.filter(
        (e) => e.name === TelemetryEvents.V5EditGraphNoPersistedGraphFallthrough,
      );
      expect(fallthrough).toHaveLength(1);
      expect(fallthrough[0]!.data).toMatchObject({ scenario_id: SCENARIO_ID });
    });
  });

  it('`graph_state_unavailable{no_persisted_graph}` is NO LONGER emitted on a first turn', async () => {
    await turn(app, 'Increase annual revenue from £4 million today to £6 million within 12 months.');
    const unavailable = events.filter(
      (e) =>
        e.name === TelemetryEvents.V5EditGraphGraphStateUnavailable &&
        e.data.reason === 'no_persisted_graph',
    );
    expect(
      unavailable,
      'the dashboard must stop counting an error path that no longer errors',
    ).toHaveLength(0);
  });

  // ── THE DISCLOSED CARVE-OUT, pinned so it is a decision and not a gap ────

  it('SCOPE: at ANALYSE stage the typed recovery is UNCHANGED — the frame guard cannot catch it there', async () => {
    // Not an oversight. `isFrameNoBriefShape` requires `stage === 'frame'`, so
    // an analyse-stage fall-through would reach `runTurnExecutor` — a broad
    // LLM call, and a breach of the standing edit-lane routing contract
    // asserted in tests/integration/orchestrator/route-v2-edit-graph-recovery.
    // Every dead end L56 measured arrived at `stage: 'frame'`, which is what
    // the UI sends on a first message, so the narrow scoping fixes all of the
    // observed defect and moves nothing else. Pinned here so that a later lane
    // widening the scope has to come through this test deliberately.
    const { status, body } = await turn(
      app,
      'Add opportunity cost of founder time as a risk',
      'analyse',
    );

    expect(status).toBe(200);
    expect(body.assistant_text).toBe(EDIT_GRAPH_RECOVERY_TEXT);
    expect(exitPath(body)).toBe('edit_graph');
    expect(
      events.filter(
        (e) =>
          e.name === TelemetryEvents.V5EditGraphGraphStateUnavailable &&
          e.data.reason === 'no_persisted_graph',
      ),
      'the reason still exists — it is reachable off the frame stage, and only there',
    ).toHaveLength(1);
    expect(
      events.filter((e) => e.name === TelemetryEvents.V5EditGraphNoPersistedGraphFallthrough),
    ).toHaveLength(0);
  });

  // ── PRESERVATION: the two genuinely transient reasons keep the copy ──────

  describe('PRESERVATION — the transient failures still say "try again in a moment"', () => {
    it('`session_store_failed`: the store throwing still returns the recovery copy at `edit_graph`', async () => {
      loadGraphThrows = true;
      const { status, body } = await turn(app, 'Add a second sales team in Berlin.');

      expect(status).toBe(200);
      expect(
        body.assistant_text,
        'a store outage IS transient — "try again in a moment" is honest advice here',
      ).toBe(EDIT_GRAPH_RECOVERY_TEXT);
      expect(exitPath(body)).toBe('edit_graph');
      expect(
        events.filter(
          (e) =>
            e.name === TelemetryEvents.V5EditGraphGraphStateUnavailable &&
            e.data.reason === 'session_store_failed',
        ),
      ).toHaveLength(1);
    });

    it('`persisted_graph_invalid`: a stored graph that fails ingress validation still returns the recovery copy', async () => {
      // Present but unparseable — a DIFFERENT operational signal from absence,
      // which is exactly why the reason exists.
      persistedGraphForRead = { nodes: 'not-an-array', edges: 42 };
      const { status, body } = await turn(app, 'Add a second sales team in Berlin.');

      expect(status).toBe(200);
      expect(body.assistant_text).toBe(EDIT_GRAPH_RECOVERY_TEXT);
      expect(exitPath(body)).toBe('edit_graph');
      expect(
        events.filter(
          (e) =>
            e.name === TelemetryEvents.V5EditGraphGraphStateUnavailable &&
            e.data.reason === 'persisted_graph_invalid',
        ),
      ).toHaveLength(1);
    });
  });
});
