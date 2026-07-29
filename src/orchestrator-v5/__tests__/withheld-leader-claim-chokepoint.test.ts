/**
 * ⭐ CLAIM SAFETY AT THE `finalizeRun` CHOKEPOINT — the exit-bypass shape.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE IS ABOUT, AND WHY IT IS NOT ANOTHER GATE TEST.
 *
 * `runTurnExecutor` is 9,973 lines with **39** `return finalizeRun()` exits.
 * The T1 leader-claim ENFORCER sits at ONE of the points inside it — the
 * explanation-answer claim gate, guarded by
 * `isExplanationHandler && !mayNameLeadingOptionForRun`, immediately before
 * compose. That gate is correct about what it covers and structurally blind to
 * the rest:
 *
 *   - 27 of the 39 exits are POSITIONALLY upstream of it and never reach it;
 *   - of the 12 downstream, only an EXPLANATION-handler dispatch satisfies its
 *     condition — converse, coach and clarify never do.
 *
 * The POST-#713 live walk captured **3 of 3 non-execute turns** on a withheld
 * scenario naming the leading option, one with a probability and no disclosure
 * at all. 65 test files aimed at this executor did not see it. A live walk did.
 *
 * So the shape this file constructs is not "does the gate work" — it is
 * **an exit that BYPASSES the in-flow gate entirely, and still must not ship a
 * leader claim on a withheld turn.** Every RED arm below pairs its assertion
 * with a BRANCH DISCRIMINATOR proving the in-flow gate did not run, so a green
 * arm cannot be the in-flow gate quietly doing the work.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ OVER-SUPPRESSION IS A FAILURE, NOT A SAFE DEFAULT (house rule).
 *
 * A guard that blanks every answer would satisfy every RED arm here and would
 * be a WORSE defect than the leak. So each RED is paired with:
 *   - a PERMIT-WINS control (permitted scenario, same leader prose → the bytes
 *     must be IDENTICAL); and
 *   - a CLEAN-TEXT control (withheld scenario, no leader claim → IDENTICAL);
 *   - a FALSE-POSITIVE control ("leads to" / "team leads" — the two spans the
 *     ENFORCER's reader documents and carves out. These pin that the chokepoint
 *     uses `textAssertsLeadingOption`, the enforcer's reader, and NOT the
 *     alarm's wider `textNamesLeadingOption`).
 *
 * ⚠ AND THE VACUITY CHECK IS EXPLICIT. "Telemetry fired" is not the assertion —
 * a guard that emits its event and enforces nothing would pass that. Every RED
 * asserts on the BYTES: the leak string is GONE, the withheld copy is PRESENT,
 * and the shared enforcer predicate scores the final text FALSE.
 *
 * Assertions are on the serialised HTTP response of `POST /orchestrate/v2/turn`.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

import { setTestSink, TelemetryEvents } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
// THE SHARED PREDICATE, imported — the same function the production chokepoint
// calls. A hand-written regex here would let the test and the guard drift, and
// the test would go green on a guard that had stopped matching (trap #12).
import { textAssertsLeadingOption } from '../compose/leading-option-egress-guard.js';
import {
  WITHHELD_EXPLANATION_OPENING,
  WITHHELD_EXPLANATION_NO_DISCLOSURE_TAIL,
} from '../compose/withheld-explanation-answer.js';
import { EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT } from '../compose/forbidden-user-facing-phrases.js';
import { V5_STRUCTURAL_DECLINE_TEXT } from '../routing/mutation-language.js';

const SCENARIO_ID = 'c4d5e6f7-7a15-4954-8954-c4d5e6f77a15';
const LEADER_LABEL = 'Hire Marketing Manager';
const RUNNER_LABEL = 'Hold';

/**
 * ⭐ THE LEAK STRING — the POST-#713 walk's `case5.clarify` shape: a leading
 * option named, with a probability, on a turn that withheld it.
 *
 * `\bleads\b` from `LEADER_CLAIM_PATTERNS`. Deliberately NOT a phrase from the
 * forbidden-phrase list — a text that trips BOTH guards could be neutralised by
 * the wrong one and this file would not be able to tell.
 */
const LEAK_TEXT = `${LEADER_LABEL} leads with a win probability of about 72%, with ${RUNNER_LABEL} behind at 28%.`;

/** No leader claim anywhere — the over-suppression control's input. */
const CLEAN_TEXT =
  'There is a genuine trade-off here between speed and cost, and the evidence is still thin on the cost side.';

/**
 * The two spans `ENFORCEMENT_FALSE_POSITIVE_SPANS` carves out. Ordinary English
 * that trips `LEADER_CLAIM_PATTERNS` and asserts nothing about ranking. If the
 * chokepoint blanks these, it is running the ALARM's reader, not the ENFORCER's.
 */
const FALSE_POSITIVE_TEXT =
  'Higher capacity leads to faster delivery, and your team leads will need to agree the sequencing.';

const READY_GRAPH = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Customer growth', goal_threshold: 0.8 },
    { id: 'fac_capacity', kind: 'factor', label: 'Capacity' },
    { id: 'fac_market', kind: 'factor', label: 'Market demand' },
    { id: 'opt_hire', kind: 'option', label: LEADER_LABEL, interventions: { fac_capacity: 1 } },
    {
      id: 'opt_hold',
      kind: 'option',
      label: RUNNER_LABEL,
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
      from: 'opt_hold',
      to: 'fac_capacity',
      strength: { mean: 0.1, std: 0.05 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'fac_capacity',
      to: 'goal_growth',
      strength: { mean: 0.8, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'fac_market',
      to: 'goal_growth',
      strength: { mean: 0.6, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
};

const READY_GRAPH_HASH = computeAnalysisAffectingGraphHash(READY_GRAPH as never);

function baseRunAnalysisFact(): Record<string, unknown> {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      leading_option_id: 'opt_hire',
      summary: 'Prior analysis result',
      graph_hash_at_run: READY_GRAPH_HASH,
      computed_at: new Date(Date.now() - 9_000_000).toISOString(),
      enrichment: {
        analysis_status: 'completed',
        option_comparison: [
          { option_id: 'opt_hire', option_label: LEADER_LABEL, win_probability: 0.72, outcome_mean: 0.5 },
          { option_id: 'opt_hold', option_label: RUNNER_LABEL, win_probability: 0.28, outcome_mean: 0.3 },
        ],
      },
      win_probabilities: { opt_hire: 0.72, opt_hold: 0.28 },
    },
  };
}

/** STAMPED WITHHELD — the leader claim is not licensed on this scenario. */
function withheldRunAnalysisFact(): Record<string, unknown> {
  const fact = baseRunAnalysisFact();
  (fact.result as Record<string, unknown>).constraint_verdict = {
    may_name_leading_option: false,
    constraint_verdict_state: 'unevaluated',
  };
  return fact;
}

/** STAMPED PERMITTED — the PERMIT-WINS control's input. */
function permittedRunAnalysisFact(): Record<string, unknown> {
  const fact = baseRunAnalysisFact();
  (fact.result as Record<string, unknown>).constraint_verdict = {
    may_name_leading_option: true,
    constraint_verdict_state: 'evaluated_feasible',
  };
  return fact;
}

const ANALYSIS_TURN_ROW_ID = 'bbbbbbbb-7a15-4bbb-8bbb-bbbbbbbbbbbb';

/**
 * The FK-parent turn row. Without it `prior_facts` loads EMPTY, the verdict
 * reads "no analysis ⇒ true", and every withheld arm below would pass
 * vacuously on the permitting branch. The INSTRUMENT test exists for this.
 */
const ANALYSIS_TURN = {
  id: ANALYSIS_TURN_ROW_ID,
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
  user_message: 'Run the analysis',
  assistant_message: 'Analysis complete.',
};

let factsByTurnRowId: Record<string, Array<Record<string, unknown>>> = {};

function makeStore(): Record<string, unknown> {
  return {
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async (_id: string, limit: number = 20) => [ANALYSIS_TURN].slice(0, limit),
    countTurns: async () => 1,
    readFactsFor: async (turnRowIds: readonly string[]) =>
      turnRowIds.flatMap((id) => factsByTurnRowId[id] ?? []),
    readFactsWithTurnFor: async (turnRowIds: readonly string[]) =>
      turnRowIds.flatMap((id) =>
        (factsByTurnRowId[id] ?? []).map((fact) => ({
          fact,
          turn_id: id,
          fact_created_at: new Date(Date.now() - 9_000_000).toISOString(),
        })),
      ),
    readNewestAnalysisFactFor: async () => {
      const all = Object.values(factsByTurnRowId).flat();
      return all.find((f) => f.fact_type === 'run_analysis' && f.noop === false) ?? null;
    },
    loadGraph: async () => READY_GRAPH,
    loadGraphAndBriefText: async () => ({ graph: READY_GRAPH, briefText: null }),
    ensureScenarioExists: async (_id: string, userId: string | null) => ({ user_id: userId }),
    readMostRecentPendingActions: async () => [],
    storeDraftGraph: async () => undefined,
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  };
}

vi.mock('../session/index.js', () => ({
  getSessionStore: () => makeStore(),
  resetSessionStoreForTests: () => undefined,
  SessionReadError: class SessionReadError extends Error {},
}));

/**
 * `importOriginal`-spread, never a hand-listed factory: a `vi.mock` factory
 * REPLACES the module, so listing only the stubbed export silently blanks the
 * rest (CLAUDE.md trap #12 — this exact pattern killed 51 tests once).
 */
vi.mock('../decision-records/index.js', async () => {
  const actual = await vi.importActual<typeof import('../decision-records/index.js')>(
    '../decision-records/index.js',
  );
  return {
    ...actual,
    getDecisionRecordStore: () => ({
      createRecord: async () => ({ record_id: 'unused', deduped: false }),
      retrieveRecords: async () => ({ records: [], totalCount: 0 }),
    }),
  };
});

const routeWithToolUseMock = vi.fn();
vi.mock('../routing/route-with-tool-use.js', async () => {
  const actual = await vi.importActual<typeof import('../routing/route-with-tool-use.js')>(
    '../routing/route-with-tool-use.js',
  );
  return { ...actual, routeWithToolUse: routeWithToolUseMock };
});

const RAW_RESULT = {
  content: [],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
  model: 'mock',
  latencyMs: 0,
};

/** The CONVERSE exit — `text_only`, the model's prose used verbatim. */
function converseTextOnly(text: string) {
  return {
    type: 'text_only' as const,
    text,
    inferredIntent: 'converse',
    llmCallCount: 1,
    droppedActions: [],
    orientationText: '',
    rawResult: RAW_RESULT,
  };
}

/** The COACH exit — `tool_call`, `answer_text` used as the user-facing answer. */
function coachToolCall(text: string) {
  return {
    type: 'tool_call' as const,
    proposal: { intent_class: 'coach', coaching_mode: 'reframe', answer_text: text },
    orientationText: text,
    llmCallCount: 1,
    droppedActions: [],
    rawResult: RAW_RESULT,
  };
}

/** The CLARIFY exit — `tool_call`, the clarification question as the answer. */
function clarifyToolCall(text: string) {
  return {
    type: 'tool_call' as const,
    proposal: {
      intent_class: 'clarify',
      clarification: { question: text, options: [] },
    },
    orientationText: text,
    llmCallCount: 1,
    droppedActions: [],
    rawResult: RAW_RESULT,
  };
}

const { ceeOrchestratorRouteV2 } = await import('../../orchestrator/route-v2.js');

async function postTurn(app: FastifyInstance, message: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'message',
      turn_id: randomUUID(),
      scenario_id: SCENARIO_ID,
      stage: 'analyse',
      message,
      turn_class: 'clarify',
      source: 'composer',
      graph_state: READY_GRAPH,
    },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}

/** A message that carries no intercept keyword, so the turn reaches the executor. */
const NEUTRAL_MESSAGE = 'Where does this leave things?';

function permissionOnTheWire(body: Record<string, any>): unknown {
  return body._diagnostic_trace?.claim_safety?.may_name_leading_option;
}

let priorTraceFlag: string | undefined;
let events: Array<{ name: string; data: Record<string, any> }> = [];

function eventsNamed(name: string) {
  return events.filter((e) => e.name === name);
}

/** The CHOKEPOINT guard's only observable. */
const CHOKEPOINT_EVENT = TelemetryEvents.V5WithheldLeaderClaimNeutralisedAtFinalise;
/** The IN-FLOW gate's only observable — the branch discriminator. */
const IN_FLOW_GATE_EVENT = TelemetryEvents.V5WithheldExplanationAnswerProjected;

describe('claim safety at the finalizeRun CHOKEPOINT — exits that bypass the in-flow gate', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    priorTraceFlag = process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
    const { _resetConfigCache } = await import('../../config/index.js');
    _resetConfigCache();
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    if (priorTraceFlag === undefined) delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    else process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = priorTraceFlag;
    const { _resetConfigCache } = await import('../../config/index.js');
    _resetConfigCache();
  });

  beforeEach(() => {
    events = [];
    setTestSink((name, data) => {
      events.push({ name, data: data as Record<string, any> });
    });
    routeWithToolUseMock.mockReset();
    factsByTurnRowId = { [ANALYSIS_TURN_ROW_ID]: [withheldRunAnalysisFact()] };
  });
  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  // ══ INSTRUMENT CHECKS — every assertion below is vacuous without these ════

  describe('INSTRUMENT', () => {
    it('the LEAK STRING really trips the SHARED enforcer predicate', () => {
      // Without this, a RED arm asserting "the claim is gone" would pass on a
      // guard that never had a claim to remove. Asserted with the imported
      // production predicate, never a local regex.
      expect(
        textAssertsLeadingOption(LEAK_TEXT),
        'the leak fixture must be a real leader claim by the ENFORCER’s own reader',
      ).toBe(true);
    });

    it('the CLEAN and FALSE-POSITIVE controls really score FALSE on that predicate', () => {
      expect(textAssertsLeadingOption(CLEAN_TEXT)).toBe(false);
      expect(
        textAssertsLeadingOption(FALSE_POSITIVE_TEXT),
        '"leads to" / "team leads" are the documented ENFORCEMENT carve-outs; if this is true the control is measuring the wrong thing',
      ).toBe(false);
    });

    it('the SUBSTITUTED copy is leader-free, so "guard fired" and "claim survived" are distinguishable', () => {
      expect(
        textAssertsLeadingOption(WITHHELD_EXPLANATION_OPENING + WITHHELD_EXPLANATION_NO_DISCLOSURE_TAIL),
      ).toBe(false);
    });

    it('the withheld FIXTURE really reaches the permission on the wire', async () => {
      routeWithToolUseMock.mockResolvedValue(converseTextOnly('Noted.'));
      const { status, body } = await postTurn(app, NEUTRAL_MESSAGE);
      expect(status).toBe(200);
      expect(
        body._diagnostic_trace?.claim_safety,
        'the flag-gated claim_safety block must be present or `undefined === false` never fails',
      ).toBeDefined();
      expect(
        permissionOnTheWire(body),
        'the fixture must WITHHOLD, or every RED below measures a permitting turn',
      ).toBe(false);
    });

    it('ORDERING PIN: the other two finalise guards’ substitution copy is leader-free', () => {
      // The chokepoint guard runs FIRST of the three, so its replacement is
      // itself subject to the other two. That is only safe while neither of
      // their own substitutions can introduce a leader claim downstream of it.
      // If this ever goes red, the ordering in `finalizeRun` must be revisited.
      expect(textAssertsLeadingOption(EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT)).toBe(false);
      expect(textAssertsLeadingOption(V5_STRUCTURAL_DECLINE_TEXT)).toBe(false);
    });
  });

  // ══ THE EXIT MANIFEST — one arm per bypassing exit ════════════════════════

  const BYPASSING_EXITS: ReadonlyArray<{
    readonly name: string;
    readonly routingResult: (text: string) => unknown;
  }> = [
    { name: 'CONVERSE (text_only)', routingResult: converseTextOnly },
    { name: 'COACH (tool_call)', routingResult: coachToolCall },
    { name: 'CLARIFY (tool_call)', routingResult: clarifyToolCall },
  ];

  for (const exit of BYPASSING_EXITS) {
    describe(`the ${exit.name} exit`, () => {
      it('BRANCH DISCRIMINATOR: the turn reaches the EXECUTOR, and the IN-FLOW gate does NOT run', async () => {
        routeWithToolUseMock.mockResolvedValue(exit.routingResult(LEAK_TEXT));
        await postTurn(app, NEUTRAL_MESSAGE);
        expect(
          routeWithToolUseMock,
          'a route-level intercept would mean this arm never entered the executor at all',
        ).toHaveBeenCalled();
        expect(
          eventsNamed(IN_FLOW_GATE_EVENT),
          'this exit dispatches no explanation handler — if the in-flow gate fired, the arm is not testing the chokepoint',
        ).toHaveLength(0);
      });

      it('⭐ RED-FIRST: a leader claim on a WITHHELD turn must not reach the wire', async () => {
        routeWithToolUseMock.mockResolvedValue(exit.routingResult(LEAK_TEXT));
        const { status, body } = await postTurn(app, NEUTRAL_MESSAGE);
        expect(status).toBe(200);
        const finalText = String(body.assistant_text ?? '');

        // ⚠ THE VACUITY GUARD, THREE WAYS. "an event fired" is deliberately NOT
        // the assertion — a chokepoint that emits and enforces nothing passes
        // that and fails all three of these.
        expect(
          finalText,
          'the leak sentence itself must be gone from the bytes',
        ).not.toContain('leads with a win probability');
        expect(
          textAssertsLeadingOption(finalText),
          'the FINAL bytes must score FALSE on the same enforcer predicate the leak scored TRUE on',
        ).toBe(false);
        expect(
          finalText,
          'and it must be REPLACED with the withheld copy, not merely blanked',
        ).toContain(WITHHELD_EXPLANATION_OPENING);
      });

      it('the chokepoint reports itself, tagged as an exit the in-flow gate could not cover', async () => {
        routeWithToolUseMock.mockResolvedValue(exit.routingResult(LEAK_TEXT));
        await postTurn(app, NEUTRAL_MESSAGE);
        const fired = eventsNamed(CHOKEPOINT_EVENT);
        expect(fired, 'the guard must be observable, or a live walk is the only instrument again').toHaveLength(1);
        expect(
          fired[0]?.data.in_flow_gate_eligible,
          'this exit is exactly the population the backstop exists for',
        ).toBe(false);
        expect(fired[0]?.data.dispatch_path).toBe('turn_executor_finalise');
        // Privacy contract (R-004): lengths and bounded enums only.
        expect(Object.values(fired[0]?.data ?? {}).join(' ')).not.toContain(LEADER_LABEL);
      });

      it('PERMIT-WINS CONTROL: the SAME prose on a PERMITTED scenario is byte-identical', async () => {
        factsByTurnRowId = { [ANALYSIS_TURN_ROW_ID]: [permittedRunAnalysisFact()] };
        routeWithToolUseMock.mockResolvedValue(exit.routingResult(LEAK_TEXT));
        const { body } = await postTurn(app, NEUTRAL_MESSAGE);
        expect(
          permissionOnTheWire(body),
          'the control is only meaningful if this scenario really permits',
        ).toBe(true);
        expect(
          String(body.assistant_text ?? ''),
          'a blanket suppression would be a WORSE defect than the leak — this arm is what catches it',
        ).toContain('leads with a win probability');
        expect(eventsNamed(CHOKEPOINT_EVENT)).toHaveLength(0);
      });

      it('CLEAN-TEXT CONTROL: a withheld turn with no leader claim is untouched', async () => {
        routeWithToolUseMock.mockResolvedValue(exit.routingResult(CLEAN_TEXT));
        const { body } = await postTurn(app, NEUTRAL_MESSAGE);
        expect(String(body.assistant_text ?? '')).toContain('genuine trade-off');
        expect(String(body.assistant_text ?? '')).not.toContain(WITHHELD_EXPLANATION_OPENING);
        expect(eventsNamed(CHOKEPOINT_EVENT)).toHaveLength(0);
      });

      it('FALSE-POSITIVE CONTROL: "leads to" / "team leads" survive a withheld turn intact', async () => {
        // This is what pins the chokepoint to `textAssertsLeadingOption` (the
        // ENFORCER's reader, with its documented carve-outs) rather than the
        // alarm's wider `textNamesLeadingOption`. Swap the import in production
        // and this arm goes red.
        routeWithToolUseMock.mockResolvedValue(exit.routingResult(FALSE_POSITIVE_TEXT));
        const { body } = await postTurn(app, NEUTRAL_MESSAGE);
        expect(permissionOnTheWire(body)).toBe(false);
        expect(String(body.assistant_text ?? '')).toContain('leads to faster delivery');
        expect(eventsNamed(CHOKEPOINT_EVENT)).toHaveLength(0);
      });

      it('IDEMPOTENT: the substituted copy does not re-trip the guard on a second turn', async () => {
        routeWithToolUseMock.mockResolvedValue(exit.routingResult(LEAK_TEXT));
        const first = await postTurn(app, NEUTRAL_MESSAGE);
        const substituted = String(first.body.assistant_text ?? '');
        events = [];
        routeWithToolUseMock.mockResolvedValue(exit.routingResult(substituted));
        const second = await postTurn(app, NEUTRAL_MESSAGE);
        // ⚠ NOT byte-equality, and the reason is recorded so a future reader
        // does not "tighten" this back into a false failure: feeding the copy
        // back through as MODEL text puts it through the compose/shape pipeline,
        // which inserts a paragraph break between the opening and the tail. That
        // is the composer's formatting, not the guard — measured, not assumed
        // (the whole diff on the first run of this arm was `\n\n`). The property
        // that belongs to the GUARD is the two assertions below.
        const normalise = (s: string) => s.replace(/\s+/g, ' ').trim();
        expect(normalise(String(second.body.assistant_text ?? ''))).toBe(normalise(substituted));
        expect(
          eventsNamed(CHOKEPOINT_EVENT),
          'the substituted copy is leader-free, so a second pass must find nothing to replace',
        ).toHaveLength(0);
      });
    });
  }
});
