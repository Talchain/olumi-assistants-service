/**
 * ⭐ C5 (Codex native E2E, 6 Sep 2026, deployed CEE `ed2b3b8`, fresh guest
 * scenario `01ce6982-a7f7-4397-bf6b-fbe4a75050ad`) — THE RECORDED ASK MUST
 * SURVIVE AN INCIDENTAL CANVAS SELECTION.
 *
 * WITNESSED, byte-verbatim from the raw captures:
 *   turn 1  chip `chip_prompt_repair_effect_value` → route-v2's configure-clarify
 *           intercept answered *"Hire a Temporary Technical Lead (Mentor/Coach)"
 *           has no effect value on Technical Leadership Capacity yet. Just the
 *           percentage is enough …"* and armed an `elicit_option_effect` pending
 *           for that cell (`exit_path: edit_graph`, zero model calls).
 *   turn 2  "Let's go for 50%" — with the SAME incidental selection on both
 *           requests: node `71589191`, an OUTCOME, "Code Quality and
 *           Architecture" — was answered by the routing LLM with *"Before I set
 *           that percentage, I need to check which value this belongs to."*
 *           (`exit_path: turn_executor`, one routing call, `blocks: []`) and the
 *           same chip was offered again.
 *
 * MECHANISM, established by execution: the answered-ask block of the pre-route
 * is guarded by `!repairSelectionPresent`, which is true for ANY non-empty
 * `selected_elements`. The pending read and the recorded-ask resumer both sit
 * INSIDE that block, so the ask was never READ. Had it been,
 * `resolveRecordedOptionEffectAnswer("Let's go for 50%")` binds 0.5 to the
 * recorded cell (slot contract: `lets`, `go`, `for` are filler).
 *
 * The gate's rationale (review #1000 B1) is REAL for DEICTIC messages: "Set this
 * one to 50%" with a selection means the SELECTED node, and the slot contract
 * would otherwise bind it to the recorded ask. So the gate is NARROWED, never
 * removed: a selection withdraws the RECORDED-ask claim only when the message
 * carries a deictic reference (the executor's own `DEICTIC_REFERENCE_PATTERN`,
 * imported — not re-spelled). The readiness-derived bare-value claim (2.1261)
 * keeps its wholesale withdrawal on any selection, exactly as B1 ruled — see
 * `route-v2-repair-bare-value-binding.test.ts`.
 *
 * Fixture: the C5 scenario graph reconstructed from the native-state capture
 * (13 nodes / 20 edges; real ids, kinds, labels, interventions, edge endpoints;
 * `strength.std` and `effect_direction` defaulted, so this graph's hash is NOT
 * the deployed hash — the pending below is armed against THIS fixture's hash,
 * computed by the same function route-v2 uses at both ends).
 *
 * Harness modelled on `route-v2-repair-bare-value-binding.test.ts`, with
 * `runTurnExecutor` mocked as in `route-v2-no-persisted-graph-fallthrough.test.ts`
 * so "fell through to the executor" is an observable call, not an inference.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const dispatchEditGraphMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphMock,
}));

const runTurnExecutorMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/turn-executor.js', () => ({
  runTurnExecutor: runTurnExecutorMock,
}));

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
const loadGraphMock = vi.fn();
const readPendingsMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readScenarioRunAnalysisFactsFor: async () => ({ facts: [], total_count: 0 }),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string | null) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: loadGraphMock,
    loadGraphAndBriefText: async () => ({ graph: await loadGraphMock(), briefText: null }),
    readMostRecentPendingActions: readPendingsMock,
    hasPriorTurns: async () => true,
    countTurns: async () => 2,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

/** Any model call is a fall-through the pre-route failed to pre-empt. */
const chatWithToolsMock = vi.fn(async () => ({
  content: [{ type: 'text', text: 'text-only response' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
}));
vi.mock('../../../src/adapters/llm/router.js', () => ({
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
vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

const telemetryEvents: Array<{ name: string; payload: Record<string, unknown> }> = [];
vi.mock('../../../src/utils/telemetry.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/utils/telemetry.js')>();
  return {
    ...original,
    emit: (name: string, payload: Record<string, unknown>) => {
      telemetryEvents.push({ name, payload });
      return original.emit(name as never, payload as never);
    },
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');
const { computeAnalysisAffectingGraphHash } = await import(
  '../../../src/orchestrator-v5/context/graph-hash.js'
);
const { buildCanonicalAnalysisReadyFromGraph } = await import(
  '../../../src/orchestrator/tools/analysis-ready-helper.js'
);
const { resolveRecordedOptionEffectAnswer } = await import(
  '../../../src/orchestrator-v5/routing/repair-value-binding.js'
);
const { carriesDeicticReference } = await import(
  '../../../src/orchestrator-v5/routing/deterministic-value-update.js'
);
type PendingAction = import('../../../src/orchestrator-v5/session/pending-action.js').PendingAction;

// ── The C5 identities, verbatim from the captures ─────────────────────────
const SCENARIO_ID = '01ce6982-a7f7-4397-bf6b-fbe4a75050ad';
const OPT = 'new_temp_lead_option';
const OPT_LABEL = 'Hire a Temporary Technical Lead (Mentor/Coach)';
const FAC = '756a7698';
const FAC_LABEL = 'Technical Leadership Capacity';
const WITNESSED_MESSAGE = "Let's go for 50%";
/** `C5-50-request.json` `selected_elements`, byte-verbatim (the published V5 ref shape). */
const INCIDENTAL_SELECTION = [{ id: '71589191', kind: 'outcome', label: 'Code Quality and Architecture' }];

function edge(from: string, to: string, weight: number, exists: number) {
  return { from, to, strength: { mean: weight, std: 0.1 }, exists_probability: exists, effect_direction: 'positive' };
}
function buildGraph() {
  return {
    goal_node_id: 'a2593c3c',
    nodes: [
      { id: '124ec3bb', kind: 'factor', label: 'Team Coordination Overhead', category: 'external' },
      { id: '12dec351', kind: 'decision', label: 'Question' },
      { id: '71589191', kind: 'outcome', label: 'Code Quality and Architecture' },
      { id: '72ede081', kind: 'risk', label: 'Coordination Bottleneck' },
      { id: FAC, kind: 'factor', label: FAC_LABEL, category: 'controllable' },
      { id: '943110e8', kind: 'factor', label: 'Developer Headcount Added', category: 'controllable' },
      { id: 'a2593c3c', kind: 'goal', label: 'Boost Productivity and Hit Our Next Feature Launch Deadline' },
      { id: 'b0c56077', kind: 'outcome', label: 'Feature Delivery Velocity' },
      { id: 'b41ffea0', kind: 'option', label: 'Continue with Current Team (Status Quo)',
        data: { interventions: { [FAC]: 0, '943110e8': 0 } }, is_baseline: true },
      { id: 'be215545', kind: 'option', label: 'Two Developers', data: { interventions: { '943110e8': 0.4 } } },
      { id: 'e70301eb', kind: 'option', label: 'Hire a Tech Lead', data: { interventions: { [FAC]: 1 } } },
      { id: 'fa309b99', kind: 'risk', label: 'Onboarding and Ramp-up Delay' },
      { id: OPT, kind: 'option', label: OPT_LABEL },
    ],
    edges: [
      edge('124ec3bb', '72ede081', 0.35, 0.8), edge('12dec351', 'b41ffea0', 1, 1),
      edge('12dec351', 'be215545', 1, 1), edge('12dec351', 'e70301eb', 1, 1),
      edge('71589191', 'a2593c3c', 0.5, 0.8), edge('72ede081', 'a2593c3c', 0.6, 0.8),
      edge(FAC, '71589191', 0.45, 0.8), edge(FAC, '72ede081', 0.21, 0.8),
      edge(FAC, 'b0c56077', 0.5, 0.75), edge(FAC, 'fa309b99', 0.7, 0.8),
      edge('943110e8', '71589191', 0.55, 0.8), edge('943110e8', '72ede081', 0.39, 0.8),
      edge('b0c56077', 'a2593c3c', 0.7, 0.9), edge('b41ffea0', FAC, 1, 1),
      edge('b41ffea0', '943110e8', 1, 1), edge('be215545', '943110e8', 1, 1),
      edge('e70301eb', FAC, 1, 1), edge('fa309b99', 'a2593c3c', 0.5, 0.8),
      edge('12dec351', OPT, 1, 1), edge(OPT, FAC, 1, 1),
    ],
  };
}
const GRAPH = buildGraph();
const GRAPH_HASH = computeAnalysisAffectingGraphHash(GRAPH);
if (GRAPH_HASH === null) throw new Error('fixture graph must hash');

/** What turn 1's intercept armed (`route-v2.ts` configure-clarify persist block). */
function liveAsk(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    id: '00000000-0000-4000-8000-0000000000c5',
    scenario_id: SCENARIO_ID,
    chip_id: 'chip_configure_option_clarify',
    action: { kind: 'elicit_option_effect', option_id: OPT, option_label: OPT_LABEL, factor_id: FAC, factor_label: FAC_LABEL },
    preconditions: { graph_hash: GRAPH_HASH! },
    expires_at_turn_count: 2,
    expires_at_iso: new Date(Date.now() + 600_000).toISOString(),
    emitted_at_iso: new Date(Date.now() - 30_000).toISOString(),
    ...overrides,
  } as PendingAction;
}

let turnCounter = 0;
function payload(message: string, selection?: unknown): Record<string, unknown> {
  turnCounter += 1;
  return {
    kind: 'message',
    turn_id: `c7d5aa7e-2265-495f-b3e8-f1021b97${String(turnCounter).padStart(4, '0')}`,
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    turn_class: 'frame',
    message,
    source: 'composer',
    ...(selection === undefined ? {} : { selected_elements: selection }),
  };
}

function editGraphResult() {
  return {
    response: { response_version: 2 as const, assistant_text: 'Applied edit.', blocks: [] as const,
      suggested_actions: [] as const, insights: [] as const, stage_indicator: 'analyse' as const },
    commitPerformed: true,
  };
}
function executorResult() {
  return {
    response: { response_version: 2 as const, assistant_text: 'executor reply', blocks: [] as const,
      suggested_actions: [] as const, insights: [] as const, stage_indicator: 'analyse' as const },
    analysisReady: undefined, effectiveGraph: null, answerKind: 'substantive',
    mayNameLeadingOption: true, mayNameLeadingOptionProvenance: { kind: 'no_analysis' },
    telemetry: { stages_completed: ['orient', 'compose', 'commit'], response_emitted: true, llm_calls_used: 1,
      commit_performed: true, failure_type: null, wall_clock_ms: 5, turn_class: 'explore',
      intent_class: 'converse', coaching_mode: null, validation_error_code: null },
  };
}

function repairEvents() {
  return telemetryEvents.filter((e) => e.name === 'v5.edit_graph.repair_value_binding_resolved');
}
/** Every `dispatchEditGraph` call's `recordedEffectAnswer`, so "not bound to the ask" is a claim about EVERY dispatch. */
function recordedAnswersDispatched(): unknown[] {
  return dispatchEditGraphMock.mock.calls.map((c) => (c[0] as { recordedEffectAnswer?: unknown }).recordedEffectAnswer);
}
/**
 * How many TERMINAL handlers the turn reached.
 *
 * ⚠ `recordedAnswersDispatched().every(r => r === undefined)` is VACUOUSLY TRUE
 * when nothing was dispatched at all, so on its own it cannot tell "the ask was
 * correctly not bound" from "the turn died before any terminal" — the same
 * assertion would pass against a route that threw. Every not-bound claim below
 * therefore pairs it with this count, so the claim is about a turn that
 * demonstrably ENDED somewhere carrying no recorded answer.
 */
function terminalsReached(): number {
  return dispatchEditGraphMock.mock.calls.length + runTurnExecutorMock.mock.calls.length;
}

async function send(app: FastifyInstance, message: string, selection?: unknown) {
  const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: payload(message, selection) });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}

describe('POST /orchestrate/v2/turn — the recorded ask survives an incidental selection (C5)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    dispatchEditGraphMock.mockReset();
    dispatchEditGraphMock.mockResolvedValue(editGraphResult());
    runTurnExecutorMock.mockReset();
    runTurnExecutorMock.mockResolvedValue(executorResult());
    appendMock.mockClear();
    chatWithToolsMock.mockClear();
    loadGraphMock.mockReset();
    loadGraphMock.mockResolvedValue(GRAPH);
    readPendingsMock.mockReset();
    readPendingsMock.mockResolvedValue([liveAsk()]);
    telemetryEvents.length = 0;
  });

  // ── PRECONDITIONS PINNED IN-TEST (trap 13b): the fixture reaches the branch ──
  it('precondition: the fixture is outstanding on exactly the C5 cell, and the resumer alone binds the witnessed reply', () => {
    const readiness = buildCanonicalAnalysisReadyFromGraph(GRAPH);
    const optionBlockers = ((readiness?.blockers ?? []) as Array<Record<string, unknown>>)
      .filter((b) => typeof b.option_id === 'string');
    expect(optionBlockers).toHaveLength(1);
    expect(optionBlockers[0]).toMatchObject({ option_id: OPT, factor_id: FAC, blocker_type: 'missing_value' });
    const direct = resolveRecordedOptionEffectAnswer({
      message: WITNESSED_MESSAGE, pendings: [liveAsk()], graph: GRAPH, readiness,
      scenarioId: SCENARIO_ID, nowMs: Date.now(),
    });
    expect(direct.kind).toBe('bind');
    if (direct.kind === 'bind') {
      expect(direct.answer.pair).toMatchObject({ optionId: OPT, factorId: FAC });
      expect(direct.answer.valueText).toBe('0.5');
    }
  });

  // ── THE WITNESSED TURN ─────────────────────────────────────────────────────
  it('⭐ RED-FIRST — the witnessed reply WITH the incidental selection binds to the recorded cell', async () => {
    const { status } = await send(app, WITNESSED_MESSAGE, INCIDENTAL_SELECTION);
    expect(status).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    const args = dispatchEditGraphMock.mock.calls[0]![0] as {
      payload: { message: string };
      recordedEffectAnswer?: { pair: { optionId: string; factorId: string }; valueText: string };
    };
    expect(args.payload.message).toBe(WITNESSED_MESSAGE);
    expect(args.recordedEffectAnswer?.pair).toMatchObject({ optionId: OPT, factorId: FAC });
    expect(args.recordedEffectAnswer?.valueText).toBe('0.5');
    expect(runTurnExecutorMock).not.toHaveBeenCalled();
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  it('CONTROL — the same reply WITHOUT a selection binds identically (the harness reaches the pre-route)', async () => {
    const { status } = await send(app, WITNESSED_MESSAGE);
    expect(status).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    const args = dispatchEditGraphMock.mock.calls[0]![0] as { recordedEffectAnswer?: { pair: unknown; valueText: string } };
    expect(args.recordedEffectAnswer?.pair).toMatchObject({ optionId: OPT, factorId: FAC });
    expect(args.recordedEffectAnswer?.valueText).toBe('0.5');
    expect(runTurnExecutorMock).not.toHaveBeenCalled();
  });

  it('the same reply with the selection in the V4 `{node_ids}` shape binds identically', async () => {
    const { status } = await send(app, WITNESSED_MESSAGE, { node_ids: ['71589191'] });
    expect(status).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    const args = dispatchEditGraphMock.mock.calls[0]![0] as { recordedEffectAnswer?: { pair: unknown } };
    expect(args.recordedEffectAnswer?.pair).toMatchObject({ optionId: OPT, factorId: FAC });
  });

  it('⭐ RED-FIRST — a bare "50" WITH the selection gets the re-ask that NAMES the recorded cell, not a routing call', async () => {
    const { status, body } = await send(app, '50', INCIDENTAL_SELECTION);
    expect(status).toBe(200);
    expect(body.assistant_text).toMatch(new RegExp(`^For "${OPT_LABEL.replace(/[()]/g, '\\$&')}" on "${FAC_LABEL}":`));
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(runTurnExecutorMock).not.toHaveBeenCalled();
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  // ── THE GATE'S RATIONALE, KEPT: a DEICTIC reply belongs to the selection ──
  it('TWIN — "Set this one to 50%" WITH a selection is NOT bound to the recorded ask (the selection owns the referent)', async () => {
    const { status } = await send(app, 'Set this one to 50%', INCIDENTAL_SELECTION);
    expect(status).toBe(200);
    expect(recordedAnswersDispatched().every((r) => r === undefined)).toBe(true);
    expect(repairEvents()).toHaveLength(0);
    expect(runTurnExecutorMock).toHaveBeenCalledTimes(1);
  });

  it('TWIN CONTRAST — the same deictic reply WITHOUT a selection has only the recorded ask as antecedent, and binds', async () => {
    // This is what makes the deictic twin above a claim about the SELECTION and
    // not about the words: the slot contract admits "this one" as filler.
    const { status } = await send(app, 'Set this one to 50%');
    expect(status).toBe(200);
    const args = dispatchEditGraphMock.mock.calls[0]?.[0] as { recordedEffectAnswer?: { pair: unknown } } | undefined;
    expect(args?.recordedEffectAnswer?.pair).toMatchObject({ optionId: OPT, factorId: FAC });
  });

  // ── THE PREDICATE'S DOCUMENTED BOUNDARY: bare "it" is NOT deictic ─────────
  // `carriesDeicticReference`'s own doc comment claims bare "it" stays OUT of
  // the pattern, because a reply saying "it" has no selection-aware path to
  // claim it and a recorded ask is therefore its only deterministic antecedent.
  // That is a claim about behaviour under a selection, and nothing pinned it —
  // a comment beside a predicate is not coverage of the predicate (trap 22b).
  // If the pattern is ever widened to swallow "it", THIS test goes red rather
  // than the founder's defect quietly reopening for a whole phrasing class.
  it('BOUNDARY — "set it to 50%" WITH the selection is still bound to the recorded ask (bare "it" is not deictic)', async () => {
    const { status } = await send(app, 'set it to 50%', INCIDENTAL_SELECTION);
    expect(status).toBe(200);
    expect(carriesDeicticReference('set it to 50%')).toBe(false);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    const args = dispatchEditGraphMock.mock.calls[0]![0] as {
      recordedEffectAnswer?: { pair: { optionId: string; factorId: string }; valueText: string };
    };
    expect(args.recordedEffectAnswer?.pair).toMatchObject({ optionId: OPT, factorId: FAC });
    expect(args.recordedEffectAnswer?.valueText).toBe('0.5');
    expect(runTurnExecutorMock).not.toHaveBeenCalled();
  });

  // ── AN EXPLICIT SWITCH TO ANOTHER TARGET is never the ask's answer ─────────
  it.each([
    'set Developer Headcount Added to 50%',
    'Set Code Quality and Architecture to 50%',
    'Set Two Developers to 50%',
  ])('TWIN — "%s" WITH the selection is NOT bound to the recorded ask, and reaches a terminal', async (message) => {
    const { status } = await send(app, message, INCIDENTAL_SELECTION);
    expect(status).toBe(200);
    expect(terminalsReached()).toBe(1);
    expect(recordedAnswersDispatched().every((r) => r === undefined)).toBe(true);
  });

  it('TWIN CONTRAST — an explicit switch WITHOUT the selection is not bound either (the discriminator is the named entity)', async () => {
    const { status } = await send(app, 'set Developer Headcount Added to 50%');
    expect(status).toBe(200);
    expect(terminalsReached()).toBe(1);
    expect(recordedAnswersDispatched().every((r) => r === undefined)).toBe(true);
  });

  // ── A STALE OR DELETED ASK under a selection keeps TODAY'S route, never a refusal ──
  it('TWIN — an EXPIRED ask + selection + "50%" falls through to the executor; no stale refusal is issued on the ask\'s behalf', async () => {
    readPendingsMock.mockResolvedValue([liveAsk({ expires_at_turn_count: 0 })]);
    const { status, body } = await send(app, '50%', INCIDENTAL_SELECTION);
    expect(status).toBe(200);
    expect(body.assistant_text).not.toMatch(/cannot safely match/i);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(runTurnExecutorMock).toHaveBeenCalledTimes(1);
  });

  it('TWIN CONTRAST — the same EXPIRED ask + "50%" WITHOUT a selection keeps its honest stale refusal (unchanged)', async () => {
    readPendingsMock.mockResolvedValue([liveAsk({ expires_at_turn_count: 0 })]);
    const { status, body } = await send(app, '50%');
    expect(status).toBe(200);
    expect(body.assistant_text).toMatch(/cannot safely match that answer to the previous question/i);
    expect(runTurnExecutorMock).not.toHaveBeenCalled();
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
  });

  it('TWIN — a DELETED ask + selection + the witnessed reply falls through to the executor', async () => {
    readPendingsMock.mockResolvedValue([]);
    const { status } = await send(app, WITNESSED_MESSAGE, INCIDENTAL_SELECTION);
    expect(status).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(repairEvents()).toHaveLength(0);
    expect(runTurnExecutorMock).toHaveBeenCalledTimes(1);
  });

  it('TWIN — with NO recorded ask, a selection still withdraws the readiness-derived bare-value claim wholesale (B1 stands)', async () => {
    readPendingsMock.mockResolvedValue([]);
    const { status } = await send(app, '50%', INCIDENTAL_SELECTION);
    expect(status).toBe(200);
    expect(repairEvents()).toHaveLength(0);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(runTurnExecutorMock).toHaveBeenCalledTimes(1);
  });

  it('TWIN CONTRAST — with NO recorded ask and NO selection, the bare-value claim binds the sole missing pair (unchanged)', async () => {
    readPendingsMock.mockResolvedValue([]);
    const { status } = await send(app, '50%');
    expect(status).toBe(200);
    expect(repairEvents()).toHaveLength(1);
    expect(repairEvents()[0]!.payload).toMatchObject({ outcome: 'bind', pair_count: 1 });
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
  });

  it('TWIN — a RANGE is never turned into a scalar for the ask, selection or not, and each arm reaches a terminal', async () => {
    for (const selection of [INCIDENTAL_SELECTION, undefined]) {
      // ⚠ BOTH terminal mocks are cleared per arm: clearing only the dispatch
      // mock would let the executor count accumulate across the loop, so the
      // second arm's terminal assertion would pass on the FIRST arm's call.
      dispatchEditGraphMock.mockClear();
      runTurnExecutorMock.mockClear();
      const { status } = await send(app, 'somewhere between 40% and 60%', selection);
      expect(status).toBe(200);
      expect(terminalsReached()).toBe(1);
      expect(recordedAnswersDispatched().every((r) => r === undefined)).toBe(true);
    }
  });
});
