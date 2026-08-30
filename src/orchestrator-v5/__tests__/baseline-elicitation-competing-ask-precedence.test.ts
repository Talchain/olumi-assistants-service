/**
 * ⭐⭐ THE COMPETING-ASK PRECEDENCE PIN — which PENDING owns the turn.
 *
 * WIRE-WITNESSED on deployed CEE `92176e6` (9 observations, fresh guest, server
 * read-back): the product asked *"Roughly what percentage is X at right now?"*,
 * the user answered, and in 4 of 9 observations the answer was applied to a
 * DIFFERENT THING — an option's effect value on a factor the user never named.
 * In every failing observation a competing option-effect elicitation
 * (`chip_prompt_repair_effect_value`) was live ALONGSIDE the baseline pending.
 *
 * ⭐ SO THIS IS NOT A NUMERAL-FORM DEFECT. The answer's SHAPE only decided which
 * pending won by accident. `30` and `roughly 30` bound correctly; `30 percent`,
 * `30%` and `0.6` were consumed as effect values. Derived at the bytes and
 * reproduced in-process: `findSoleLiveElicitBaselinePending` returns `null` the
 * moment a second bare-number-claiming ask is live, the resume returns
 * `no_pending_question`, and the turn falls through IN SILENCE to a lane that is
 * free to write. The first failing transition is that `null` — one value
 * standing for both "nothing was asked" and "something was asked and something
 * else is competing for the answer".
 *
 * THE INVARIANT, WRITTEN AGAINST THE SPEC AND NOT AGAINST THE WITNESS:
 *   while a baseline elicitation pending is live, an answer shaped like a reply
 *   to it resolves at the baseline path — binding or re-asking — and NEVER mints
 *   an unrelated edit.
 *
 * THE CORPUS IS CROSSED on both axes, because the witness could only vary one:
 * every answer form × {competing ask ABSENT, competing ask PRESENT}. The forms
 * that bind cleanly on the deployed build (`30`, `roughly 30`) are pinned as
 * MUST-NOT-REGRESS in the absent arm.
 *
 * ⚠ EVERY CASE ASSERTS ITS OWN PRECONDITION. The deployed witness's named
 * control (`30%`) was itself captured by the competing pending and failed to
 * fire twice, so a green result here could otherwise be measuring a different
 * pending entirely (trap 13b — a guard whose discrimination depends on a
 * fixture nothing pins). Each case proves the soleness state it claims to be
 * testing BEFORE it asserts anything about what the answer did.
 *
 * Harness inherited from `baseline-elicitation-route-level.test.ts`.
 */
/*
 * Original 2.918 header follows:
 * ROADMAP 2.918 — route-level pins for the baseline-elicitation loop, both
 * halves MOUNTED in the executor (trap 3b: a green unit suite is not evidence
 * the wiring exists):
 *
 *   EMIT — an add_constraint turn on the mintable-and-baseline-less cell must
 *   PERSIST the pending question in the same commit as the receipt that asks
 *   it. Driven through the typed-chip mutation route so the turn is fully
 *   deterministic (no LLM), which also proves the channel rides the ordinary
 *   handler-execute commit path, not a special one.
 *
 *   RESUME — with the pending question live and the graph unchanged, the
 *   bare answer "about 12%" must dispatch the add_constraint replay with ZERO
 *   LLM calls and commit the minted baseline on the named target.
 *   MUTATION-CHECK BY CONSTRUCTION (same doctrine as the typed-chip suite):
 *   the LLM adapter, if reached, returns a plain direct answer that commits
 *   nothing — so a green "baseline committed + adapter never called" pair
 *   flips RED if the pre-route wiring is reverted.
 *
 *   FAIL-CLOSED — a diverged graph hash must fall through SILENTLY to the
 *   normal flow (adapter called, nothing minted, no recovery copy).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { makeMessagePayload } from './fixtures.js';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import type { PendingAction } from '../session/pending-action.js';

const appendCalls: Array<Record<string, unknown>> = [];
let mockedPendingActions: ReadonlyArray<PendingAction> = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      appendCalls.push(write);
      return { id: `row-${appendCalls.length}` };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => mockedPendingActions,
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { computeAnalysisAffectingGraphHash } = await import('../context/graph-hash.js');

const SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

/**
 * A NON-ROOT outcome 'Churn rate' with no baseline; the persisted level-framed
 * '%' row rides `goal_constraints` (the RESUME fixtures' state-class — the ask
 * turn persists the row and the pending in one commit, so every answer turn
 * replays against a graph that carries both).
 */
function graphWithFramedRow(): GraphV3T {
  return {
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      { id: 'f-quality', kind: 'factor', label: 'Product quality' },
      { id: 'o-churn-rate', kind: 'outcome', label: 'Churn rate' },
    ],
    edges: [
      {
        from: 'f-quality',
        to: 'o-churn-rate',
        strength: { mean: -0.5, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'negative',
      },
    ],
    goal_constraints: [
      {
        constraint_id: 'gc-live-1',
        node_id: 'o-churn-rate',
        operator: '<=',
        value: 10,
        label: 'Churn rate',
        provenance: 'explicit',
        unit: '%',
        value_frame: 'level',
      },
    ],
  } as unknown as GraphV3T;
}

function elicitPending(graphHash: string, overrides?: Partial<PendingAction>): PendingAction {
  return {
    id: 'pa-elicit-route-1',
    scenario_id: SCENARIO_ID,
    chip_id: 'chip_elicit_target_baseline',
    action: {
      kind: 'elicit_target_baseline',
      target_id: 'o-churn-rate',
      target_label: 'Churn rate',
      constraint_type: 'at_most',
      value: 10,
      unit: '%',
      label: 'Churn rate',
    },
    preconditions: { graph_hash: graphHash },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-08-08T00:00:00.000Z',
    ...overrides,
  } as PendingAction;
}

function payload(message: string, extra?: Partial<MessageTurnPayload>): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    message,
    ...extra,
  });
}

/** An adapter that, if reached, returns a mint-free direct answer. */
function directAnswerAdapter() {
  const chatWithTools = vi
    .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
    .mockImplementation(async () => ({
      content: [{ type: 'text', text: 'Understood.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 } as unknown as ChatWithToolsResult['usage'],
      model: 'mock',
      latencyMs: 0,
    }));
  return { adapter: { chatWithTools }, chatWithTools };
}

type SinkEvent = { event: string; data: Record<string, unknown> };
let events: SinkEvent[] = [];

beforeEach(() => {
  events = [];
  appendCalls.length = 0;
  mockedPendingActions = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});


const { findSoleLiveElicitBaselinePending, readLiveElicitBaselineCompetition } = await import(
  '../session/pending-action.js'
);
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

/**
 * ⭐ THE ADAPTER THAT ARMS THE FALL-THROUGH LANE TO WRITE.
 *
 * `directAnswerAdapter` commits nothing, so a suite built only on it can prove
 * the SILENCE (the answer landed nowhere) but never the HARM (the answer landed
 * somewhere else). The wire witness is explicit about the harm: the number was
 * applied as an option's effect value on a factor the user never named, and the
 * receipt announced it.
 *
 * So the lane is armed to mutate the option→factor cell through the ordinary
 * validated-proposal lifecycle, and the graph is read back by identity below.
 *
 * ⚠ WHAT THIS DOES AND DOES NOT MODEL, measured rather than asserted: the
 * deployed write landed as an option's effect VALUE (an intervention). This
 * adapter proposes an `adjust_edge_strength`, which at pristine is REFUSED by
 * the existing outstanding-effect-ask misroute guard. So it does not reproduce
 * the landed write; it proves the answer reaches a lane free to attempt one,
 * and pins the graph against the day a handler gets through.
 */
function misroutingAdapter(value: number) {
  const chatWithTools = vi
    .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
    .mockImplementation(async () => ({
      content: [
        {
          type: 'tool_use',
          id: 'tu-misroute',
          name: OLUMI_ACTION_TOOL_NAME,
          input: {
            intent_class: 'execute',
            action: {
              handler_id: 'adjust_edge_strength',
              entity: {
                id: 'opt-annual->f-adoption',
                kind: 'edge',
                label: 'opt-annual->f-adoption',
                resolution_status: 'resolved',
                resolution_method: 'label_match',
              },
              parameters: [{ name: 'strength', value, source: 'user_explicit' }],
              cited_context_fields: [],
            },
          },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
      model: 'claude-sonnet-4-6',
      latencyMs: 50,
    }));
  return { adapter: { chatWithTools }, chatWithTools };
}

/** The witnessed edge, read back by IDENTITY out of the persisted graph. */
function misroutedEdge(g: GraphV3T | undefined) {
  return (
    g?.edges as ReadonlyArray<{ from?: string; to?: string; strength?: { mean?: number } }> | undefined
  )?.find((e) => e.from === 'opt-annual' && e.to === 'f-adoption');
}

/**
 * The witness shape: the baseline question's target PLUS an unrelated option
 * and the factor it links to, carrying NO intervention — i.e. exactly the
 * entity the deployed build wrote 0.6 onto. Without this option in the graph
 * there is nothing for a misroute to hit, and the suite could not observe the
 * harm at all.
 */
function witnessGraph(): GraphV3T {
  const g = graphWithFramedRow() as unknown as {
    nodes: unknown[];
    edges: unknown[];
  };
  g.nodes.push({
    id: 'opt-annual',
    kind: 'option',
    label: 'introduce annual contracts with a discount to lock customers in',
  });
  g.nodes.push({ id: 'f-adoption', kind: 'factor', label: 'Annual Contract Adoption Rate' });
  g.edges.push({
    from: 'opt-annual',
    to: 'f-adoption',
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 1,
    effect_direction: 'positive',
  });
  return g as unknown as GraphV3T;
}

/**
 * The competing ask. BOTH spellings the estate persists for an outstanding
 * effect-value question are exercised: binding the pin to one of them would
 * leave the other unprotected and would read as deliberate.
 */
function competingPending(
  kind: 'elicit_option_effect' | 'elicit_effect_target',
  graphHash: string,
): PendingAction {
  const action =
    kind === 'elicit_option_effect'
      ? {
          kind,
          option_id: 'opt-annual',
          option_label: 'introduce annual contracts with a discount to lock customers in',
          factor_id: 'f-adoption',
          factor_label: 'Annual Contract Adoption Rate',
        }
      : {
          kind,
          source: 'repair_value_ask',
          value_text: '0.6',
          candidates: [
            {
              option_id: 'opt-annual',
              option_label: 'introduce annual contracts with a discount to lock customers in',
              factor_id: 'f-adoption',
              factor_label: 'Annual Contract Adoption Rate',
            },
          ],
        };
  return {
    id: 'pa-competing-1',
    scenario_id: SCENARIO_ID,
    chip_id: 'chip_prompt_repair_effect_value',
    action,
    preconditions: { graph_hash: graphHash },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-08-08T00:00:00.000Z',
  } as unknown as PendingAction;
}

const CONTESTED_COPY = 'I have more than one question open';

/**
 * ⭐ THE CROSSED CORPUS. `expected` is the ABSENT-arm outcome, derived by
 * execution at pristine `92176e66` and pinned so the fix cannot move it.
 */
const CORPUS = [
  { msg: '0.6', expected: 'reask_scale' },
  { msg: '.6', expected: 'reask_unreadable' },
  { msg: '0.3', expected: 'reask_scale' },
  { msg: '0.9', expected: 'reask_scale' },
  { msg: '0.0', expected: 'reask_scale' },
  { msg: '0', expected: 'bind', value: 0 },
  { msg: '30', expected: 'bind', value: 0.3 },
  { msg: 'roughly 30', expected: 'bind', value: 0.3 },
  { msg: '30 percent', expected: 'bind', value: 0.3 },
  { msg: '30%', expected: 'bind', value: 0.3 },
  { msg: '120', expected: 'reask_range' },
] as const;

/** Every node that is NOT the baseline question's target. */
function unrelatedNodes(g: GraphV3T) {
  return g.nodes.filter((n) => n.id !== 'o-churn-rate');
}

/**
 * THE SPEC INVARIANT, asserted on the PERSISTED graph and bound by NODE ID —
 * never read off the receipt, which is what made the deployed defect look
 * deliberate rather than wrong.
 */
function expectNoUnrelatedWrite(committed: GraphV3T | undefined) {
  if (!committed) return;
  for (const n of unrelatedNodes(committed)) {
    expect(n.observed_state?.baseline).toBeUndefined();
    expect(
      (n as unknown as { data?: { interventions?: Record<string, unknown> } }).data?.interventions ??
        {},
    ).toEqual({});
  }
}

function committedGraph(): GraphV3T | undefined {
  return appendCalls[0]?.graph as GraphV3T | undefined;
}

describe('COMPETING-ASK PRECEDENCE — the competing ask is ABSENT (must not regress)', () => {
  it.each(CORPUS)('$msg', async ({ msg, expected, ...rest }) => {
    const graph = witnessGraph();
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    const pendings = [elicitPending(liveHash)];
    mockedPendingActions = pendings;

    // ⚠ PRECONDITION, PINNED IN-TEST: this arm is only meaningful if the
    // baseline question really IS the sole live claim on a bare number.
    expect(findSoleLiveElicitBaselinePending(pendings, Date.now())).not.toBeNull();

    const { adapter, chatWithTools } = directAnswerAdapter();
    const { response } = await runTurnExecutor(payload(msg), `absent-${msg}`, {
      routingAdapter: adapter,
      graphState: graph,
    });

    // The baseline path owned the turn either way — no LLM, no fall-through.
    expect(chatWithTools).not.toHaveBeenCalled();
    const committed = committedGraph();
    const target = committed?.nodes.find((n) => n.id === 'o-churn-rate');

    if (expected === 'bind') {
      expect(target?.observed_state?.baseline).toBe((rest as { value: number }).value);
    } else {
      expect(target?.observed_state?.baseline).toBeUndefined();
      if (expected === 'reask_scale') {
        expect(response.assistant_text).toContain('hundredfold difference');
      } else if (expected === 'reask_range') {
        expect(response.assistant_text).toContain('between 0 and 100 percent');
      } else {
        expect(response.assistant_text).toContain('One number is enough');
      }
    }
    // Never the contested copy — there is nothing competing in this arm.
    expect(response.assistant_text).not.toContain(CONTESTED_COPY);
    expectNoUnrelatedWrite(committed);
  });
});

describe.each(['elicit_option_effect', 'elicit_effect_target'] as const)(
  'COMPETING-ASK PRECEDENCE — the competing ask is PRESENT (%s)',
  (competingKind) => {
    it.each(CORPUS)('$msg is never applied to an unrelated entity', async ({ msg }) => {
      const graph = witnessGraph();
      const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
      const pendings = [elicitPending(liveHash), competingPending(competingKind, liveHash)];
      mockedPendingActions = pendings;

      // ⚠ PRECONDITION, PINNED IN-TEST — and it is the exact state the deployed
      // witness's own control fell into without noticing: the baseline question
      // is live, and it is NOT the sole claim. Both halves are asserted, so a
      // fixture that stopped constructing the competition (or stopped carrying
      // the baseline ask at all) fails here rather than passing vacuously.
      //
      // ⭐ DELIBERATELY EXPRESSED WITHOUT THIS FIX'S OWN NEW HELPER. An earlier
      // draft asserted the precondition via `readLiveElicitBaselineCompetition`,
      // and at pristine the whole case then died on "not a function" — a RED
      // that proves only that a new export is new, never that the old behaviour
      // was wrong. Stated in pre-existing API plus plain data, the case is
      // runnable at pristine and the RED lands on the BEHAVIOUR.
      const now = Date.now();
      expect(findSoleLiveElicitBaselinePending(pendings, now)).toBeNull();
      expect(pendings.filter((p) => p.action.kind === 'elicit_target_baseline')).toHaveLength(1);
      expect(pendings.filter((p) => p.action.kind === competingKind)).toHaveLength(1);

      // ⭐ THE FALL-THROUGH LANE IS ARMED TO WRITE. If precedence lets the
      // answer past the baseline path, this adapter mutates the option→factor
      // edge — the exact write the deployed server read-back observed.
      const { adapter, chatWithTools } = misroutingAdapter(0.6);
      const { response } = await runTurnExecutor(payload(msg), `present-${competingKind}-${msg}`, {
        routingAdapter: adapter,
        graphState: graph,
      });

      // ⭐ THE SPEC INVARIANT. Nothing the user did not name is written — read
      // out of the PERSISTED graph, bound by node id.
      const committed = committedGraph();
      expectNoUnrelatedWrite(committed);

      // ⭐ THE WRITE INVARIANT, ASSERTED BY EDGE IDENTITY.
      //
      // ⚠ STATED AS MEASURED, NOT AS ASSUMED. At pristine this edge does NOT
      // come back carrying 0.6: the armed `adjust_edge_strength` proposal is
      // refused by the EXISTING outstanding-effect-ask misroute guard, which
      // answers *"what you asked for would have moved the strength of the link
      // … instead"*. So for THIS handler shape a second guard already stands
      // between the fall-through and the graph, and the pristine RED below
      // lands on the SILENCE, not on a landed write.
      //
      // The invariant is pinned anyway, and deliberately: the deployed witness
      // shows a write that DID land (an option's effect VALUE, i.e. an
      // intervention, not an edge strength), so the fall-through is only as
      // safe as whichever handler the lane happens to choose. Pinning the
      // graph here costs nothing and fails loudly if that ever changes.
      const edge = misroutedEdge(committed);
      if (edge !== undefined) {
        expect(edge.strength?.mean).not.toBe(0.6);
        expect(edge.strength?.mean).toBe(0.5);
      }

      // Nothing is MINTED on the baseline target either: the soleness rule is
      // the licence for writing and it is not satisfied here.
      expect(
        committed?.nodes.find((n) => n.id === 'o-churn-rate')?.observed_state?.baseline,
      ).toBeUndefined();

      // ⭐ AND THE USER IS TOLD. Silence here is what let the number reach a
      // writer; the product asks which question it answers instead.
      expect(response.assistant_text).toContain(CONTESTED_COPY);
      expect(response.assistant_text).toContain('Churn rate');
      // The turn never reached the LLM, so no lane downstream could mint.
      expect(chatWithTools).not.toHaveBeenCalled();

      // The question SURVIVES, so the next attempt still has a referent.
      const persisted = (appendCalls[0]?.pending_actions ?? []) as PendingAction[];
      expect(
        persisted.filter((p) => p.action.kind === 'elicit_target_baseline'),
      ).toHaveLength(1);
    });
  },
);

describe('⭐ THE OPPOSITE HARM — a genuine option-effect instruction still reaches the edit lane', () => {
  /**
   * A user with a live baseline question may legitimately want to set an option
   * effect. That is a NEW INSTRUCTION, not an answer to the question asked, and
   * it must keep its route. This is the GREEN half of the discriminating pair:
   * the fix above changes NOTHING for it, in either competition state.
   */
  const INSTRUCTIONS = [
    "set the pilot's effect on cost to 0.3",
    "Set the introduce annual contracts with a discount to lock customers in option's effect on Annual Contract Adoption Rate to 0.6.",
    'increase the adoption rate effect to 0.4',
  ];

  it.each(INSTRUCTIONS)('%s falls through to the ordinary edit path', async (msg) => {
    const graph = witnessGraph();
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    const pendings = [elicitPending(liveHash), competingPending('elicit_option_effect', liveHash)];
    mockedPendingActions = pendings;
    // Same contested state as the arm above — so any difference in outcome is
    // the MESSAGE's doing and not the fixture's.
    expect(findSoleLiveElicitBaselinePending(pendings, Date.now())).toBeNull();

    const { adapter } = directAnswerAdapter();
    const { response } = await runTurnExecutor(payload(msg), `instruction-${msg.slice(0, 12)}`, {
      routingAdapter: adapter,
      graphState: graph,
    });

    // ⚠ THE CLAIM IS "THE BASELINE PATH DID NOT TAKE IT", NOT "THE LLM RAN".
    // An earlier draft asserted `chatWithTools` was called and RED-ed on the
    // third instruction, which a DETERMINISTIC value-update route claims
    // without any LLM at all — a correct outcome that the assertion called a
    // failure. The route downstream is not this fix's business; what matters is
    // that the elicitation did not swallow an instruction.
    expect(response.assistant_text).not.toContain(CONTESTED_COPY);
    // Nor any other baseline re-ask: the question was not put to the user again.
    expect(response.assistant_text).not.toContain('hundredfold difference');
    expect(response.assistant_text).not.toContain('One number is enough');
    expect(response.assistant_text).not.toContain('What percentage is Churn rate at right now?');
    // And no baseline was minted from an instruction.
    expect(
      committedGraph()?.nodes.find((n) => n.id === 'o-churn-rate')?.observed_state?.baseline,
    ).toBeUndefined();
  });
});

describe('FAIL-CLOSED — the contested exit inherits every gate the resume already had', () => {
  it('a diverged graph hash still falls through silently, contested or not', async () => {
    const graph = witnessGraph();
    mockedPendingActions = [
      elicitPending('sha256:something-else-entirely'),
      competingPending('elicit_option_effect', 'sha256:something-else-entirely'),
    ];
    const { adapter, chatWithTools } = directAnswerAdapter();
    const { response } = await runTurnExecutor(payload('0.6'), 'contested-diverged', {
      routingAdapter: adapter,
      graphState: graph,
    });
    expect(chatWithTools).toHaveBeenCalled();
    expect(response.assistant_text).not.toContain(CONTESTED_COPY);
    expectNoUnrelatedWrite(committedGraph());
  });

  it('a message that is NOT answering falls through silently even when contested', async () => {
    const graph = witnessGraph();
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    mockedPendingActions = [
      elicitPending(liveHash),
      competingPending('elicit_option_effect', liveHash),
    ];
    const { adapter, chatWithTools } = directAnswerAdapter();
    const { response } = await runTurnExecutor(
      payload('run the analysis please'),
      'contested-nonanswer',
      { routingAdapter: adapter, graphState: graph },
    );
    expect(chatWithTools).toHaveBeenCalled();
    expect(response.assistant_text).not.toContain(CONTESTED_COPY);
    expectNoUnrelatedWrite(committedGraph());
  });

  it('CONTRAST CONTROL — with NO baseline question live, a bare number is nobody\'s business here', async () => {
    const graph = witnessGraph();
    const liveHash = computeAnalysisAffectingGraphHash(graph as never)!;
    // Only the competing ask. `readLiveElicitBaselineCompetition` must decline,
    // or the new branch would be claiming turns the baseline never asked about.
    const pendings = [competingPending('elicit_option_effect', liveHash)];
    mockedPendingActions = pendings;
    // Pristine-expressible precondition: no baseline ask in the set at all.
    expect(pendings.filter((p) => p.action.kind === 'elicit_target_baseline')).toHaveLength(0);

    const { adapter, chatWithTools } = directAnswerAdapter();
    const { response } = await runTurnExecutor(payload('0.6'), 'contested-nobaseline', {
      routingAdapter: adapter,
      graphState: graph,
    });
    expect(chatWithTools).toHaveBeenCalled();
    expect(response.assistant_text).not.toContain(CONTESTED_COPY);
  });
});

/**
 * The new reader in isolation. Kept SEPARATE from the behavioural cases above
 * on purpose: those must be runnable at pristine so their RED is about
 * behaviour, and a case that imports a new export can only ever fail there with
 * "not a function".
 */
describe('readLiveElicitBaselineCompetition — the contested read itself', () => {
  const now = Date.now();
  const hash = 'sha256:x';

  it('returns the pending and the competitor count when contested', () => {
    const r = readLiveElicitBaselineCompetition(
      [elicitPending(hash), competingPending('elicit_option_effect', hash)],
      now,
    );
    expect(r).not.toBeNull();
    expect(r!.competingCount).toBe(1);
    expect(r!.pending.action.kind).toBe('elicit_target_baseline');
  });

  it('returns competingCount 0 when the baseline ask is alone (the sole case)', () => {
    const r = readLiveElicitBaselineCompetition([elicitPending(hash)], now);
    expect(r!.competingCount).toBe(0);
  });

  it('declines when NO baseline ask is live', () => {
    expect(
      readLiveElicitBaselineCompetition([competingPending('elicit_option_effect', hash)], now),
    ).toBeNull();
  });

  it('declines when TWO baseline asks are live — ambiguous between TARGETS', () => {
    expect(
      readLiveElicitBaselineCompetition(
        [elicitPending(hash), { ...elicitPending(hash), id: 'pa-elicit-2' } as PendingAction],
        now,
      ),
    ).toBeNull();
  });

  it('a confirmation-expecting sibling is NOT a competitor (the ask ships a Run chip)', () => {
    const runChip = {
      id: 'pa-run-1',
      scenario_id: SCENARIO_ID,
      chip_id: 'chip_run_analysis',
      action: { kind: 'run_analysis' },
      preconditions: {},
      expires_at_turn_count: 2,
      expires_at_iso: '2099-12-31T23:59:59.000Z',
      emitted_at_iso: '2026-08-08T00:00:00.000Z',
    } as unknown as PendingAction;
    const r = readLiveElicitBaselineCompetition([elicitPending(hash), runChip], now);
    expect(r!.competingCount).toBe(0);
  });
});
