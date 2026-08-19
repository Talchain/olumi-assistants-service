/**
 * ⭐ A TYPED COACHING INTENT OTHER THAN `add_option` REACHES THE COACH — ASSERTED
 * AT THE WIRE, AND WITHOUT COSTING THE USER THE RUN AFFORDANCE.
 *
 * ── WHY AT THE WIRE, AND NOT BY READING THE REPLY ────────────────────────────
 * The arm STEERS the coach; it never authors copy. So "did it work?" cannot be
 * answered from reply text — the adapter is a stub, and even against a real
 * model the prose would be a judgement call, which is not a test. The checkable
 * fact is the one the arm is actually responsible for: THE BYTES HANDED TO THE
 * ROUTER. Everything below asserts on the message the adapter received.
 *
 * ── WHAT THE HARM WAS, SO THE ASSERTIONS CAN BE READ AGAINST IT ──────────────
 * `CEE_ACCEPTED_INTENTS` held exactly one member. Four MOUNTED sparks declared
 * coaching intents with no routing arm behind them, so the send gate failed
 * closed and the click arrived as anonymous prose — and on the widening card the
 * fall-through was worse than silent: the turn took the free-text edit lane,
 * came back a refusal, and the recovery chips REPLACED the row that held
 * `Run analysis`. The user accepted the product's own suggestion and paid for it
 * with their ability to run. The last test in this file is that harm, pinned.
 *
 * ── BOUND BY IDENTITY, NEVER BY A TYPED SUBSTRING ────────────────────────────
 * Every expectation is derived by CALLING the production builders
 * (`buildCoachingMethodDirective`, `composeCoachingRoutingMessage`). A test that
 * asserted a hand-copied phrase would pass while the arm emitted something else
 * entirely, and would go RED on a copy edit that changed nothing (CLAUDE.md
 * trap 19).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { TelemetryEvents, setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import {
  ROUTED_COACHING_INTENTS,
  buildCoachingMethodDirective,
  composeCoachingRoutingMessage,
} from '../coaching/typed-intent-directive.js';
import { buildUserMessage } from '../routing/route-with-tool-use.js';
import type { ContextPack } from '../context/context-pack-assembler.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { PendingAction } from '../session/pending-action.js';

// ---------------------------------------------------------------------------
// Session-store mock — same harness shape as the sibling post-analysis suites.
// ---------------------------------------------------------------------------

const mockState: {
  priorTurns: Array<Record<string, unknown>>;
  priorFacts: Array<Record<string, unknown>>;
  persistedGraph: unknown | null;
  pendingActions: readonly PendingAction[];
} = { priorTurns: [], priorFacts: [], persistedGraph: null, pendingActions: [] };

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async () => mockState.priorTurns,
    readFactsFor: async () => mockState.priorFacts,
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => mockState.persistedGraph,
    loadGraphAndBriefText: async () => ({ graph: mockState.persistedGraph, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => mockState.pendingActions,
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** Two options, one goal, every non-baseline option carrying an intervention —
 * the shape `analysis_ready` resolves to `ready` on, so the Run affordance is
 * genuinely on offer and its LOSS is observable. */
const READY_GRAPH = {
  nodes: [
    { id: 'goal_q3', kind: 'goal', label: 'Q3 Roadmap' },
    { id: 'fac_capacity', kind: 'factor', label: 'Capacity' },
    { id: 'opt_hire', kind: 'option', label: 'Hire', interventions: { fac_capacity: 1 } },
    {
      id: 'opt_status_quo',
      kind: 'option',
      label: 'Hold',
      is_baseline: true,
      interventions: { fac_capacity: 0 },
    },
  ],
  edges: [
    {
      from: 'opt_hire',
      to: 'fac_capacity',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'opt_status_quo',
      to: 'fac_capacity',
      strength: { mean: 0.01, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'fac_capacity',
      to: 'goal_q3',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
  goal_node_id: 'goal_q3',
};

void computeAnalysisAffectingGraphHash(READY_GRAPH as never);

const SPARK_MESSAGE =
  'Is this the right question to be asking, and does it fit my wider goals?';

const PRIOR_RA_ROW_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/**
 * A prior SUCCESSFUL analysis whose `graph_hash_at_run` does NOT match the
 * current graph — so `deriveAnalysisFreshness` resolves `stale`, and the
 * post-analysis wrapper's stale path offers its `run_analysis` chip.
 *
 * ⭐ WHY THIS FIXTURE RATHER THAN A PRE-ANALYSIS ONE. The Run affordance has to
 * be genuinely, deterministically ON OFFER for its LOSS to be observable — an
 * assertion that Run survives on a turn where Run was never offered is
 * satisfied by any build at all. A stale analysis is the state where the
 * product owes the user a rerun control, it is derived rather than injected,
 * and it is also the state the wrapper's own stage gate governs, so this pins
 * the coaching arm and the wrapper fix against each other rather than
 * separately.
 */
function staleRunAnalysisFact(): Record<string, unknown> {
  return {
    fact_type: 'run_analysis' as const,
    fact_version: 1 as const,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_hire',
      summary: 'Prior analysis result',
      graph_hash_at_run: 'sha256:deliberately-not-the-current-graph',
      computed_at: new Date(Date.now() - 60_000).toISOString(),
      enrichment: { analysis_status: 'completed' },
      win_probabilities: { opt_hire: 0.72, opt_status_quo: 0.28 },
    },
  };
}

const PRIOR_RUN_ANALYSIS_TURN = {
  id: PRIOR_RA_ROW_ID,
  scenario_id: SCENARIO_ID,
  user_id: null,
  turn_id: 'prior-turn-run-analysis',
  turn_class: 'handler',
  handler_id: 'run_analysis',
  request_hash: 'sha256:prior-ra',
  response_emitted: true,
  llm_calls_used: 1,
  duration_ms: 200,
  created_at: new Date(Date.now() - 60_000).toISOString(),
};

function seedStaleAnalysis(): void {
  mockState.priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
  mockState.priorFacts = [staleRunAnalysisFact()];
}

function chipPayload(intent: string | undefined, stage: 'frame' | 'analyse'): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'chip_click',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message: SPARK_MESSAGE,
    turn_class: 'clarify',
    stage,
    ...(intent === undefined ? {} : { chip: { id: 'chip_spark', intent } }),
  } as unknown as MessageTurnPayload;
}

function composerPayload(stage: 'frame' | 'analyse'): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message: SPARK_MESSAGE,
    turn_class: 'clarify',
    stage,
  } as unknown as MessageTurnPayload;
}

function coachToolResultWithAnswer(): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    {
      type: 'tool_use',
      id: 'tu-1',
      name: OLUMI_ACTION_TOOL_NAME,
      input: {
        intent_class: 'coach',
        coaching_mode: 'reframe',
        answer_shape: {
          headline: 'Two framings are worth separating here.',
          bullets: [],
          detail:
            'The second framing changes which options are worth considering at all.',
        },
      },
    } as unknown as ToolResponseBlock,
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 5, output_tokens: 5 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 20,
  };
}

/** Captures the exact user message handed to the router — the wire under test. */
function makeCapturingAdapter(): {
  adapter: { chatWithTools: (a: ChatWithToolsArgs, o: { requestId: string }) => Promise<ChatWithToolsResult> };
  seen: string[];
} {
  const seen: string[] = [];
  const chatWithTools = vi
    .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
    .mockImplementation(async (args) => {
      const messages = (args as unknown as { messages?: Array<{ content?: unknown }> }).messages ?? [];
      for (const m of messages) {
        if (typeof m.content === 'string') seen.push(m.content);
        else if (Array.isArray(m.content)) {
          for (const part of m.content as Array<{ type?: string; text?: string }>) {
            if (part?.type === 'text' && typeof part.text === 'string') seen.push(part.text);
          }
        }
      }
      return coachToolResultWithAnswer();
    });
  return { adapter: { chatWithTools }, seen };
}

/**
 * ⚠ THE ASSERTION THAT NEARLY WENT UNWRITTEN, AND WOULD HAVE MADE THE HARM TEST
 * A LIE. The first version of this suite used a tool-call fixture the interpreter
 * could not parse, so every turn fell into the BOUNDED ROUTING FALLBACK
 * (`failure_type: LLM_UNAVAILABLE`) — which offers its own
 * `chip_action_run_analysis_retry`. The Run assertion below passed. It was
 * passing on a FAILED TURN's retry control, not on a healthy coaching turn
 * keeping the user's affordance, and no assertion in the file could tell the
 * two apart.
 *
 * So the harm tests pin the turn's HEALTH first. A Run chip that only exists
 * because the turn broke is not the affordance being defended.
 */
function expectHealthyCoachingTurn(result: { response: { assistant_text?: string } }): void {
  expect(
    events.filter(e => e.event === 'v5.routing_bounded_fallback'),
    'the turn fell into the bounded routing fallback — any chip it carries is a ' +
      'failure control, not the affordance under test',
  ).toEqual([]);
  expect(
    (result.response.assistant_text ?? '').length,
    'the turn produced no answer text — a chip on an empty turn is not coaching',
  ).toBeGreaterThan(0);
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

beforeEach(() => {
  events = [];
  mockState.priorTurns = [];
  mockState.priorFacts = [];
  mockState.persistedGraph = READY_GRAPH;
  mockState.pendingActions = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  vi.clearAllMocks();
  setTestSink(null);
});

describe('the seam is byte-equivalent to the routing-module append it replaces', () => {
  it('appending inside `message` and appending after `buildUserMessage` emit the SAME bytes', () => {
    // ⭐ THE CLAIM THIS PINS. The arm composes its directive into the `message`
    // argument at the TurnExecutor call site, because
    // `orchestrator-v5/routing/**` is under a concurrent rebuild this lane must
    // not touch. That is only acceptable if it is not a compromise — and it is
    // not, because `buildUserMessage` ends with
    // `parts.push('', '## User turn', message)` and joins on '\n', so `message`
    // is the FINAL segment. Both placements therefore emit identical bytes.
    //
    // This equality is an ASSUMPTION ABOUT ANOTHER MODULE'S INTERNALS, which is
    // exactly the kind of claim that rots silently. Pinned here so that if the
    // day comes when `buildUserMessage` appends anything after the user turn,
    // this REDs and names the reason rather than the arm quietly mis-placing
    // its directive.
    const pack = { stage: 'frame' } as unknown as ContextPack;
    const directive = buildCoachingMethodDirective('challenge_frame', 'frame').directive;

    const composedInside = buildUserMessage(pack, composeCoachingRoutingMessage(SPARK_MESSAGE, directive));
    const appendedAfter = `${buildUserMessage(pack, SPARK_MESSAGE)}\n\n${directive}`;

    expect(composedInside).toBe(appendedAfter);
    // Non-vacuity: both sides must actually contain the directive, or the
    // equality above could hold between two strings that dropped it (trap 13 —
    // an agreement between two empty results is not evidence).
    expect(composedInside).toContain(directive);
    expect(composedInside.length).toBeGreaterThan(directive.length);
  });
});

describe('a typed coaching intent routes end-to-end and reaches the coach', () => {
  it.each(ROUTED_COACHING_INTENTS)(
    '%s — the routing turn carries this intent\'s method directive verbatim',
    async intent => {
      const { adapter, seen } = makeCapturingAdapter();
      const result = await runTurnExecutor(chipPayload(intent, 'frame'), `req-wire-${intent}`, {
        routingAdapter: adapter as never,
        graphState: READY_GRAPH as never,
      });

      expect(seen.length, 'the router must have been called — zero captures proves nothing').toBeGreaterThan(0);

      // Derived from the PRODUCTION builder at the stage the executor derived,
      // never a phrase retyped here.
      const stage = result.response.stage_indicator ?? 'frame';
      const expected = buildCoachingMethodDirective(
        intent,
        typeof stage === 'string' ? stage : (stage as { stage: string }).stage,
      ).directive;

      expect(
        seen.some(m => m.includes(expected)),
        `the routing turn for \`${intent}\` did not carry its method directive — ` +
          'the chip has degraded to an untyped prose turn, which is the defect this arm removes',
      ).toBe(true);
    },
  );

  it('emits the routing telemetry with the intent it routed', async () => {
    const { adapter } = makeCapturingAdapter();
    await runTurnExecutor(chipPayload('challenge_frame', 'frame'), 'req-wire-telemetry', {
      routingAdapter: adapter as never,
      graphState: READY_GRAPH as never,
    });
    // Bound to the registry constant, not to the string — a renamed event must
    // move this test with it rather than silently emptying the filter.
    const routed = events.filter(e => e.event === TelemetryEvents.V5TypedCoachingIntentRoute);
    expect(routed).toHaveLength(1);
    expect(routed[0]!.data.intent).toBe('challenge_frame');
  });

  it('CONTRAST CONTROL — the SAME message from the composer carries NO directive', async () => {
    // ⭐ Without this the suite could not tell "the arm fired on the chip's
    // typed intent" from "the directive is appended to every turn". The two
    // arms differ ONLY in `source` + `chip.intent`; the message bytes are
    // identical, so a passing pair is evidence about the intent and nothing
    // else (CLAUDE.md trap 19 — bind by identity, and prove the binding with a
    // discriminating pair rather than a single green assertion).
    const withIntent = makeCapturingAdapter();
    await runTurnExecutor(chipPayload('challenge_frame', 'frame'), 'req-wire-pair-a', {
      routingAdapter: withIntent.adapter as never,
      graphState: READY_GRAPH as never,
    });
    const withoutIntent = makeCapturingAdapter();
    await runTurnExecutor(composerPayload('frame'), 'req-wire-pair-b', {
      routingAdapter: withoutIntent.adapter as never,
      graphState: READY_GRAPH as never,
    });

    const directive = buildCoachingMethodDirective('challenge_frame', 'frame').directive;
    const marker = directive.split('\n')[0]!; // '## Requested coaching method (explicit)'

    expect(withIntent.seen.some(m => m.includes(marker)), 'the chip turn must carry it').toBe(true);
    expect(withoutIntent.seen.length, 'the control turn must have reached the router').toBeGreaterThan(0);
    expect(
      withoutIntent.seen.some(m => m.includes(marker)),
      'a composer turn with the same words must NOT be steered — otherwise the ' +
        'assertion above is about the message, not about the typed intent',
    ).toBe(false);
  });

  it('an UNROUTED published intent is not steered (the gate is the four, not the enum)', async () => {
    // `pre_mortem` is a published `Intent` member with a mounted spark and NO
    // arm. Routing the whole enum because the enum lists it would re-create the
    // silent-drop defect in the opposite direction.
    const { adapter, seen } = makeCapturingAdapter();
    await runTurnExecutor(chipPayload('pre_mortem', 'frame'), 'req-wire-unrouted', {
      routingAdapter: adapter as never,
      graphState: READY_GRAPH as never,
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some(m => m.includes('## Requested coaching method (explicit)'))).toBe(false);
  });
});

describe('THE WITNESSED HARM — accepting the coaching chip must not cost the Run affordance', () => {
  it('CONTROL FIRST — on a stale analysis the product DOES offer a Run affordance', async () => {
    // ⭐ The baseline, asserted BEFORE the claim it grounds. Without it, the
    // test below is satisfied by a build where Run is never offered at all, and
    // a green suite would be recording an affordance nobody has (trap 13 — an
    // absence/presence claim needs the opposite reading demonstrated).
    seedStaleAnalysis();
    const { adapter } = makeCapturingAdapter();
    const result = await runTurnExecutor(composerPayload('analyse'), 'req-wire-run-control', {
      routingAdapter: adapter as never,
      graphState: READY_GRAPH as never,
    });
    expectHealthyCoachingTurn(result);
    expect(
      result.response.suggested_actions.some(a => a.action_type === 'run_analysis'),
      'the fixture no longer offers Run, so the harm test below asserts nothing',
    ).toBe(true);
  });

  it('a routed coaching turn KEEPS the Run affordance', async () => {
    // ⚠ THIS IS THE ONE THE USER FELT. On the pre-fix path a coaching chip
    // click fell through to the free-text edit lane, returned a refusal, and
    // the recovery chips replaced the row — so the user lost `Run analysis` by
    // accepting a suggestion the product itself had made.
    //
    // Asserted on the WIRE RESPONSE (`suggested_actions`), not on rendered UI:
    // the executor is the only party that can put the affordance in the
    // payload, and if it is absent here no UI can show it.
    seedStaleAnalysis();
    const { adapter, seen } = makeCapturingAdapter();
    const result = await runTurnExecutor(chipPayload('challenge_frame', 'analyse'), 'req-wire-run-kept', {
      routingAdapter: adapter as never,
      graphState: READY_GRAPH as never,
    });

    // Bind the two halves together: this must be the turn that WAS steered,
    // otherwise it is only evidence about an ordinary turn.
    expect(
      seen.some(m => m.includes('## Requested coaching method (explicit)')),
      'sanity: this turn must actually have been routed as a coaching intent',
    ).toBe(true);

    expectHealthyCoachingTurn(result);
    expect(
      result.response.suggested_actions.some(a => a.action_type === 'run_analysis'),
      'the coaching turn withdrew the Run affordance — the exact cost the widening-card ' +
        'defect imposed on the user (ROADMAP 2.1288)',
    ).toBe(true);
  });
});

/**
 * ⭐ F2 — A NON-ROUTED `chip.intent` MUST NOT BE SILENTLY DROPPED.
 *
 * `resolveCoachingIntent` answers `undefined` for an intent CEE does not route,
 * and the arm above then simply skips — no telemetry, no log, no trace. A
 * silently-dropped intent is the exact mechanism that kept the four mounted
 * sparks degrading to anonymous prose for as long as they did: nothing anywhere
 * recorded that a typed click had arrived and been ignored.
 *
 * ── THE EVENT'S JOB, STATED PRECISELY ────────────────────────────────────────
 * It fires when a turn CARRIES a `chip.intent` and the router DECLINED it. It
 * must NOT fire on an ordinary turn — every composer turn in the product has no
 * `chip.intent` at all, and an event that fired on those would bury its own
 * signal under the entire traffic of the service.
 *
 * Content-free by construction: the intent token, the request id, the session
 * id and the stage. Never user text.
 */
describe('F2 — an unrouted typed intent is OBSERVABLE, not silently dropped', () => {
  // Bound to the literal, not to the enum member: at the pristine commit the
  // member does not exist, so a constant-bound filter would read `undefined`
  // and match nothing — a test that could not go red for the right reason.
  const UNROUTED_EVENT = 'v5.typed_coaching_intent_unrouted';

  it('the event name is registered in the frozen TelemetryEvents registry', () => {
    expect(
      (TelemetryEvents as Record<string, string>).V5TypedCoachingIntentUnrouted,
      'the emit is not registered in the frozen enum — `validate-event-names` CI ' +
        'would red on the raw string',
    ).toBe(UNROUTED_EVENT);
  });

  it('a PUBLISHED-but-unrouted intent emits the drop, naming the exact token', async () => {
    const { adapter, seen } = makeCapturingAdapter();
    await runTurnExecutor(chipPayload('pre_mortem', 'frame'), 'req-f2-unrouted', {
      routingAdapter: adapter as never,
      graphState: READY_GRAPH as never,
    });

    // Sanity: the turn must actually have reached the router, or the arm's
    // whole neighbourhood never executed and this asserts nothing.
    expect(seen.length, 'the turn never reached the router').toBeGreaterThan(0);

    const dropped = events.filter(e => e.event === UNROUTED_EVENT);
    expect(
      dropped,
      'a typed `chip.intent` CEE does not route left no trace at all — the silent ' +
        'drop is the mechanism that made this whole defect class invisible',
    ).toHaveLength(1);
    expect(dropped[0]!.data.intent).toBe('pre_mortem');
    expect(dropped[0]!.data.stage).toBe('frame');
    // Content-free: the user's message must never ride this event.
    expect(JSON.stringify(dropped[0]!.data)).not.toContain(SPARK_MESSAGE);
  });

  it('CONTRAST CONTROL — a turn with NO chip.intent does NOT emit it', async () => {
    // ⭐ The absence claim below is worthless without proof the sink was live
    // and the turn ran, so both are asserted first (CLAUDE.md trap 13).
    const { adapter, seen } = makeCapturingAdapter();
    await runTurnExecutor(composerPayload('frame'), 'req-f2-composer', {
      routingAdapter: adapter as never,
      graphState: READY_GRAPH as never,
    });

    expect(seen.length, 'the control turn never reached the router').toBeGreaterThan(0);
    expect(
      events.length,
      'the telemetry sink captured nothing at all — the absence below is about the ' +
        'sink, not about the arm',
    ).toBeGreaterThan(0);
    expect(
      events.filter(e => e.event === UNROUTED_EVENT),
      'the drop event fired on an ordinary turn with no typed intent — it would ' +
        'drown its own signal under the whole traffic of the service',
    ).toEqual([]);
  });

  it('CONTRAST CONTROL — a ROUTED intent emits the route event and NOT the drop', async () => {
    // The two events are mutually exclusive by construction. Asserting the pair
    // in one run is what proves the new emit discriminates on the ROUTING
    // decision rather than on the mere presence of a chip.
    const { adapter } = makeCapturingAdapter();
    await runTurnExecutor(chipPayload('challenge_frame', 'frame'), 'req-f2-routed', {
      routingAdapter: adapter as never,
      graphState: READY_GRAPH as never,
    });

    expect(
      events.filter(e => e.event === TelemetryEvents.V5TypedCoachingIntentRoute),
      'positive control: the routed arm must have fired on this turn',
    ).toHaveLength(1);
    expect(
      events.filter(e => e.event === UNROUTED_EVENT),
      'a ROUTED intent was also reported as dropped — the emit is firing on the ' +
        'presence of a chip, not on the routing decision',
    ).toEqual([]);
  });
});
