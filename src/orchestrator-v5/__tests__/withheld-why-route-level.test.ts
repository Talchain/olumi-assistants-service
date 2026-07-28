/**
 * ROADMAP 2.104 — "Why is there no option?", at the real boundary.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE PINS, AND WHY IT HAD TO BE AT THE WIRE.
 *
 * Live, 28 Jul (Codex journey): on a WITHHELD run the user asked why no option
 * had been put forward, and the turn answered "open the latest recap". The
 * reason was on the fact the whole time.
 *
 * The fix is a routing decision — a new guard, ahead of the post-analysis advice
 * gate, gated on the turn's persisted verdict. A unit test of the composer
 * cannot see a routing decision, and #703 shipped two of three requirements
 * inert behind green unit tests for exactly that reason. Every assertion below
 * reads `res.body` — past the real router, the real registry forwarder, the real
 * egress sanitiser and the real finaliser.
 *
 * THE BRANCH EACH FIXTURE MUST REACH (TESTING-DISCIPLINE rule 1 — "name the
 * branch, and assert something ONLY that branch can produce"):
 *
 *   WITHHELD ARM — the new guard. Its branch-only signature is that the LLM
 *   ROUTER IS NEVER CALLED: the guard returns before routing, so
 *   `routeWithToolUseMock` records zero invocations and `llm_calls_used` is 0.
 *   A fixture that fell through to routing would still produce prose, and
 *   without this counter the file would happily measure Sonnet's answer and
 *   call it the fix.
 *
 *   PERMITTED ARM — the pre-existing path, unchanged. Its branch-only signature
 *   is Sonnet's answer shipped BYTE-FOR-BYTE: no template in this repo contains
 *   that string. A guard that leaked onto a permitting run turns this RED.
 *
 * THE TWO ARMS DIFFER IN EXACTLY ONE FIXTURE MEMBER — the fact's
 * `constraint_verdict`. Everything else, including the question asked, is
 * identical. Any behavioural difference is therefore attributable to the
 * verdict and to nothing else in the fixture.
 *
 * ⚠ THE FK-PARENT TURN ROW IS LOAD-BEARING, and this is the trap the sibling
 * route-level file was earned by: `buildTurnContext` loads `prior_facts` by FK
 * from the prior-turn ids, so a fact seeded without its turn row yields an
 * EMPTY `prior_facts`, the verdict reader takes its no-analysis branch, and
 * every assertion here would pass or fail for the wrong reason.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

// The production alarm's OWN scanner, so this acceptance test and the guard
// cannot drift apart.
import { findLeaderClaims } from '../compose/leading-option-egress-guard.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { composeWithheldWhyAnswer } from '../compose/withheld-why-answer.js';
import { readRatifiedConstraints } from '../../orchestrator/context/constraint-feasibility.js';

const SCENARIO_ID = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1';

/** The user's ratified condition, in CEE's own persisted vocabulary. */
const RATIFIED_CONSTRAINT = {
  constraint_id: 'constraint_out_total_cost_max',
  node_id: 'out_total_cost',
  operator: '<=',
  threshold: 2500,
  label: 'Three-Year Total Cost of Ownership',
};

const READY_GRAPH = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Customer growth', goal_threshold: 0.8 },
    { id: 'fac_capacity', kind: 'factor', label: 'Capacity' },
    {
      id: 'opt_hire',
      kind: 'option',
      label: 'Hire Marketing Manager',
      interventions: { fac_capacity: 1 },
    },
    {
      id: 'opt_hold',
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
      from: 'opt_hold',
      to: 'fac_capacity',
      strength: { mean: 0.01, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'fac_capacity',
      to: 'goal_growth',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
  goal_node_id: 'goal_growth',
  goal_constraints: [RATIFIED_CONSTRAINT],
};

/**
 * The freshness anchor, computed with the SAME production function the turn
 * executor uses, over the SAME object both graph seams serve — so `fresh` is
 * derived rather than asserted.
 */
const READY_GRAPH_HASH = computeAnalysisAffectingGraphHash(READY_GRAPH as never)!;

/**
 * The graph AS IT WAS when the withheld analysis ran, before the user took this
 * guard's own advice and re-stated the limit.
 *
 * ⚠ THE CONSTRAINT IS THE ONLY DIFFERENCE, and that is the whole point:
 * `goal_constraints` sit inside the analysis-affecting hash
 * (`context/graph-hash.ts` — `goal_constraints: Array.isArray(...) ? ... : []`),
 * so editing one is by itself enough to make the prior run STALE. The stale-arm
 * fixture is therefore not contrived; it is the ordinary consequence of
 * following the repair step every voice in this answer offers.
 */
const PRE_EDIT_GRAPH = {
  ...READY_GRAPH,
  goal_constraints: [
    { ...RATIFIED_CONSTRAINT, threshold: 4000, label: 'Total Cost (first draft)' },
  ],
};

/**
 * DERIVED with the production hash function, never a hand-written sentinel: a
 * literal "stale" string would prove the guard declines on a value the product
 * cannot produce, which is a different and much weaker claim.
 */
const PRE_EDIT_GRAPH_HASH = computeAnalysisAffectingGraphHash(PRE_EDIT_GRAPH as never)!;

/**
 * The deflection, verbatim from `routing/fresh-analysis-followup-guard.ts`.
 *
 * Copied rather than imported ON PURPOSE, and this is the one place in the
 * change where a hand-copy is right: importing the constant would make this
 * assertion follow a reword of the deflection, and what must be pinned is that
 * THE USER DOES NOT RECEIVE THIS SENTENCE — the live bytes, not whatever the
 * catch-net happens to say next month.
 */
const LIVE_DEFLECTION =
  "Here's the latest analysis recap. Open the analysis view for the full breakdown, including the main drivers and trade-offs.";

/**
 * Sonnet's answer on the PERMITTED arm. Passes every pre-existing side-band
 * rule (>= 80 chars, no forbidden internal term, no mutation language, no raw
 * decimal), so the handler uses it verbatim and it becomes the control's
 * branch-only signature.
 */
const SONNET_PERMITTED_ANSWER =
  'Hire Marketing Manager comes out ahead here, and the gap over Hold is wide enough ' +
  'to act on. Capacity is the strongest computed driver, so firming up that number ' +
  'would sharpen the comparison further.';

const PRIOR_RUN_ANALYSIS_TURN = {
  id: 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2',
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

function priorRunAnalysisFact(
  verdict: {
    may_name_leading_option: boolean;
    constraint_verdict_state: string;
  },
  /** The graph the run was against. Defaults to the current one ⇒ `fresh`. */
  graphHashAtRun: string = READY_GRAPH_HASH,
): Record<string, unknown> {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_hire',
      summary: 'Prior analysis result',
      graph_hash_at_run: graphHashAtRun,
      computed_at: new Date(Date.now() - 60_000).toISOString(),
      constraint_verdict: verdict,
      enrichment: {
        analysis_status: 'completed',
        option_comparison: [
          {
            option_id: 'opt_hire',
            option_label: 'Hire Marketing Manager',
            win_probability: 0.72,
            outcome_mean: 0.5,
          },
          { option_id: 'opt_hold', option_label: 'Hold', win_probability: 0.28, outcome_mean: 0.3 },
        ],
        factor_sensitivity: [
          {
            factor_id: 'fac_capacity',
            factor_label: 'Capacity',
            sensitivity: 0.6,
            influence_score: 0.6,
            direction: 'positive',
          },
        ],
      },
      win_probabilities: { opt_hire: 0.72, opt_hold: 0.28 },
    },
  };
}

let priorTurns: Array<Record<string, unknown>> = [];
let priorFacts: Array<Record<string, unknown>> = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async () => priorTurns,
    readFactsFor: async () => priorFacts,
    loadGraph: async () => READY_GRAPH,
    loadGraphAndBriefText: async () => ({ graph: READY_GRAPH, briefText: null }),
    ensureScenarioExists: async (_id: string, userId: string | null) => ({ user_id: userId }),
    readMostRecentPendingActions: async () => [],
    storeDraftGraph: async () => undefined,
    invalidateScoped: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => undefined,
  SessionReadError: class SessionReadError extends Error {},
}));

const routeWithToolUseMock = vi.fn();
vi.mock('../routing/route-with-tool-use.js', async () => {
  const actual = await vi.importActual<typeof import('../routing/route-with-tool-use.js')>(
    '../routing/route-with-tool-use.js',
  );
  return { ...actual, routeWithToolUse: routeWithToolUseMock };
});

function routedExplainResults(answerText: string) {
  return {
    type: 'tool_call' as const,
    orientationText: '',
    llmCallCount: 1,
    droppedActions: [],
    rawResult: {
      content: [],
      stop_reason: 'tool_use',
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'mock',
      latencyMs: 0,
    },
    proposal: {
      intent_class: 'execute' as const,
      action: {
        handler_id: 'explain_results',
        entity: {
          id: 'goal_growth',
          kind: 'goal' as const,
          resolution_status: 'resolved' as const,
          resolution_method: 'context_inference' as const,
        },
        parameters: [],
        cited_context_fields: [],
        explanation: { answer_text: answerText },
      },
    },
  };
}

const { ceeOrchestratorRouteV2 } = await import('../../orchestrator/route-v2.js');

interface WireTurn {
  readonly status: number;
  readonly raw: string;
  readonly body: Record<string, any>;
  readonly assistantText: string;
}

async function askTurn(app: FastifyInstance, message: string): Promise<WireTurn> {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'message',
      turn_id: randomUUID(),
      scenario_id: SCENARIO_ID,
      stage: 'analyse',
      message,
      turn_class: 'decide',
      source: 'composer',
      graph_state: READY_GRAPH,
    },
  });
  const body = JSON.parse(res.body) as Record<string, any>;
  return {
    status: res.statusCode,
    raw: res.body,
    body,
    assistantText: typeof body.assistant_text === 'string' ? body.assistant_text : '',
  };
}

/** The question the live journey asked, verbatim from the ROADMAP 2.104 row. */
const THE_QUESTION = 'Why is there no option?';

describe('route-level: "Why is there no option?" on a WITHHELD run', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    routeWithToolUseMock.mockReset();
    // If the guard fails to fire, the turn reaches the router and gets prose —
    // which is exactly the shape that would let a broken fixture look green.
    // The call COUNTER below is what discriminates the two.
    routeWithToolUseMock.mockResolvedValue(routedExplainResults(SONNET_PERMITTED_ANSWER));
    priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
  });

  describe('evaluated_infeasible — the conditions were checked and the result did not stand up', () => {
    beforeEach(() => {
      priorFacts = [
        priorRunAnalysisFact({
          may_name_leading_option: false,
          constraint_verdict_state: 'evaluated_infeasible',
        }),
      ];
    });

    it('answers WHY, naming the ratified condition, and does not deflect to a recap', async () => {
      const turn = await askTurn(app, THE_QUESTION);

      expect(turn.status).toBe(200);
      // THE DEFECT, pinned on the live bytes.
      expect(turn.raw).not.toContain(LIVE_DEFLECTION);
      expect(turn.assistantText).not.toContain('recap');

      // THE FIX. The reason, in the user's own ratified vocabulary.
      expect(turn.assistantText).toContain('No single option is being put forward');
      expect(turn.assistantText).toContain('“Three-Year Total Cost of Ownership”');
      expect(turn.assistantText).toContain('was checked on this run');
      expect(turn.assistantText).toContain('run the analysis again');
    });

    it('BRANCH-ONLY: the LLM router is never reached, so this is the guard and not Sonnet', async () => {
      const turn = await askTurn(app, THE_QUESTION);
      expect(routeWithToolUseMock).not.toHaveBeenCalled();
      expect(turn.body.assistant_text).not.toContain('Hire Marketing Manager');
    });

    it('ships the composer’s bytes exactly — the wire is not a paraphrase of them', async () => {
      // Derived from the SAME production functions the guard calls, over the
      // SAME persisted graph the store serves, so this is a wire-equality
      // assertion rather than a second transcription of the copy.
      const expected = composeWithheldWhyAnswer(
        'evaluated_infeasible',
        readRatifiedConstraints(READY_GRAPH),
      );
      expect(expected).not.toBeNull();
      const turn = await askTurn(app, THE_QUESTION);
      expect(turn.assistantText).toBe(expected!.text);
    });

    it('the answer names no leading option anywhere in the response envelope', async () => {
      const turn = await askTurn(app, THE_QUESTION);
      expect(findLeaderClaims(turn.body as never)).toEqual([]);
    });
  });

  describe('unevaluated — the condition was applied and never scored', () => {
    beforeEach(() => {
      priorFacts = [
        priorRunAnalysisFact({
          may_name_leading_option: false,
          constraint_verdict_state: 'unevaluated',
        }),
      ];
    });

    it('answers with the NOT-CHECKED voice, never the infeasible one', async () => {
      const turn = await askTurn(app, THE_QUESTION);

      expect(turn.raw).not.toContain(LIVE_DEFLECTION);
      expect(turn.assistantText).toContain('was not checked');
      expect(turn.assistantText).toContain('“Three-Year Total Cost of Ownership”');
      // The two states must not borrow each other's sentence — the exact
      // conflation `constraint-gap-disclosure.ts` was rewritten twice to avoid.
      expect(turn.assistantText).not.toContain('does not stand up against');
      expect(routeWithToolUseMock).not.toHaveBeenCalled();
    });

    it('offers the repair step that matches THIS diagnosis, not the generic one', async () => {
      const turn = await askTurn(app, THE_QUESTION);
      expect(turn.assistantText).toContain('same units as the limit');
    });

    it('names no leading option anywhere in the response envelope', async () => {
      const turn = await askTurn(app, THE_QUESTION);
      expect(findLeaderClaims(turn.body as never)).toEqual([]);
    });
  });

  describe('THE CONTROL — a PERMITTED run is untouched', () => {
    beforeEach(() => {
      priorFacts = [
        priorRunAnalysisFact({
          may_name_leading_option: true,
          constraint_verdict_state: 'evaluated_feasible',
        }),
      ];
    });

    it('the same question on a permitting verdict still reaches the router, byte-for-byte', async () => {
      // ⚠ THE OVER-SUPPRESSION ARM, weighted equally with the leak. The guard
      // consults the PERMISSION before it consults the message, so a permitting
      // run takes the path it takes today. Sonnet's answer verbatim is the
      // branch-only signature: no template in this repo contains that string.
      const turn = await askTurn(app, THE_QUESTION);
      expect(routeWithToolUseMock).toHaveBeenCalled();
      // Asserted per SENTENCE, not on the joined string: compose inserts a
      // paragraph break between them, so a whole-string containment would fail
      // for a formatting reason and teach the next reader to weaken the check.
      // Each sentence is still branch-only — no template in this repo contains
      // either of them.
      for (const sentence of SONNET_PERMITTED_ANSWER.split(/(?<=\.)\s+/)) {
        expect(turn.assistantText, sentence).toContain(sentence);
      }
      expect(turn.assistantText).not.toContain('No single option is being put forward');
    });

    it('PERMITTED but state UNREADABLE — the wiring-site permission gate is what stops this', async () => {
      // ⚠ THIS TEST EXISTS BECAUSE A MUTANT DID NOT BITE, AND THAT IS RECORDED
      // RATHER THAN QUIETLY FIXED.
      //
      // Deleting `!mayNameLeadingOptionForRun` from the guard's wiring left all
      // 77 tests green. The composer's own decline on the two permitting states
      // was masking it — so the control that was supposed to prove the wiring-
      // site gate was actually proving the composer's switch, and the gate
      // itself had no coverage at all.
      //
      // The discriminating fixture is PERMITTED + UNREADABLE STATE, which the
      // two readers make reachable on one fact by design: a typed verdict whose
      // `constraint_verdict_state` is not a contract member reads as `true` on
      // the permission (`may_name_leading_option === true`) and `null` on the
      // state (`asVerdictState` rejects unknown strings against the enum's own
      // key set, so a sixth state added upstream lands here). The composer
      // answers `reason_unrecorded` for a null state — correctly, for a WITHHELD
      // turn — so without the wiring-site gate a PERMITTING run would be told no
      // option is being put forward.
      priorFacts = [
        priorRunAnalysisFact({
          may_name_leading_option: true,
          constraint_verdict_state: 'a_sixth_state_this_release_does_not_know',
        }),
      ];
      const turn = await askTurn(app, THE_QUESTION);
      expect(routeWithToolUseMock).toHaveBeenCalled();
      expect(turn.assistantText).not.toContain('No single option is being put forward');
      expect(turn.assistantText).not.toContain('The reason is not recorded on this result');
    });

    it('and a permitting run never receives a withheld explanation for any why-phrasing', async () => {
      for (const phrasing of [
        'Why is there no recommendation?',
        "Why can't you recommend one?",
        'Why was no option put forward?',
      ]) {
        routeWithToolUseMock.mockClear();
        const turn = await askTurn(app, phrasing);
        expect(routeWithToolUseMock, phrasing).toHaveBeenCalled();
        expect(turn.assistantText, phrasing).not.toContain('No single option is being put forward');
      }
    });
  });

  describe('the guard yields where it must', () => {
    beforeEach(() => {
      priorFacts = [
        priorRunAnalysisFact({
          may_name_leading_option: false,
          constraint_verdict_state: 'evaluated_infeasible',
        }),
      ];
    });

    it('a concrete edit wrapped in the question still reaches the edit path', async () => {
      // Mutation precedence, the rule every sibling guard applies. Without it a
      // user who typed an edit and a question in one message would get an
      // explanation and no edit.
      const turn = await askTurn(app, 'Set Capacity to 0.7 and tell me why is there no option?');
      expect(turn.assistantText).not.toContain('No single option is being put forward');
      expect(routeWithToolUseMock).toHaveBeenCalled();
    });

    it('a question the advice gate owns is left to the advice gate', async () => {
      // The recogniser is narrow ON PURPOSE. "What drove this result?" is not
      // this question, and stealing it would be a regression dressed as a fix.
      const turn = await askTurn(app, 'What drove this result?');
      expect(turn.assistantText).not.toContain('No single option is being put forward');
    });

    it('F1 — the adversarial attack phrasings reach the ROUTER, not this composer', async () => {
      // ⚠ THE OVER-CAPTURE ARM, on a WITHHELD run — the only place it can do
      // harm. Every phrasing below matched the first revision of the recogniser,
      // and on this fixture each would have been answered "No single option is
      // being put forward on this result, and here is why…" — a canned
      // non-sequitur to a question about a node, a UI limit, or the world.
      //
      // Asserting at the wire rather than at the recogniser is deliberate: the
      // unit test proves the pattern does not match, and this proves the TURN
      // still reaches the surface that can actually answer it.
      for (const attack of [
        'Why is there an option to do nothing?',
        'Why is there an option called Hold in my model?',
        'Why is there a clear winner?',
        'Why is there a choice between these two?',
        'Why is there a preference for hiring?',
        'Why do people not choose subscriptions?',
        "Why can't I pick more than one option?",
        "Why shouldn't I pick option A?",
      ]) {
        routeWithToolUseMock.mockClear();
        const turn = await askTurn(app, attack);
        expect(turn.assistantText, attack).not.toContain('No single option is being put forward');
        expect(routeWithToolUseMock, attack).toHaveBeenCalled();
      }
    });

    it('F2 — a constraint edited AFTER the withheld run makes it stale, and the guard stands down', async () => {
      // ⚠ THE FRESHNESS ARM. Without the gate this turn receives "The condition
      // you set was checked on this run: “Three-Year Total Cost of Ownership”"
      // — naming the CURRENT label for a verdict derived against the PREVIOUS
      // one. The label is read from the live graph; the verdict is read from the
      // old fact; nothing persisted reconciles them.
      //
      // The window is not exotic. `goal_constraints` are inside the
      // analysis-affecting hash, so this is what happens the moment a user
      // follows the repair step THIS ANSWER gives them.
      priorFacts = [
        priorRunAnalysisFact(
          {
            may_name_leading_option: false,
            constraint_verdict_state: 'evaluated_infeasible',
          },
          PRE_EDIT_GRAPH_HASH,
        ),
      ];
      // Non-vacuity: the two hashes must genuinely differ, or this fixture is
      // silently the fresh one and the assertion below passes for no reason.
      expect(PRE_EDIT_GRAPH_HASH).not.toBe(READY_GRAPH_HASH);

      const turn = await askTurn(app, THE_QUESTION);
      expect(turn.assistantText).not.toContain('No single option is being put forward');
      expect(turn.assistantText).not.toContain('was checked on this run');
      // Stale falls back to the behaviour it has today — it does not become a
      // new silence.
      expect(turn.status).toBe(200);
      expect(turn.assistantText.length).toBeGreaterThan(0);
    });

    it('⚠ RESIDUAL, RECORDED RATHER THAN LEFT TO BE FOUND: the OTHER deflection is still live', async () => {
      // This is not an assertion that the deflection is correct. It is a pin on
      // the boundary of THIS change, and it reproduces the second half of the
      // 2.104 defect at the wire so the next lane inherits evidence rather than
      // a description.
      //
      // On a withheld run, an explain-class question that is NOT the withheld-why
      // question still falls through: the advice gate's input is the null-leader
      // projection, `explain_results_free_text` declines
      // `data_unavailable_for_class`, and the class-blind catch-net recaps. That
      // question needs DRIVER data, not the verdict, so answering it is a
      // different piece of work with a different evidence source — deliberately
      // out of this change's scope.
      //
      // WHEN THAT IS FIXED, THIS TEST TURNS RED. That is the intended signal:
      // delete it then, in the PR that closes it.
      const turn = await askTurn(app, 'What does this mean?');
      expect(turn.assistantText).toContain(LIVE_DEFLECTION);
      expect(turn.assistantText).not.toContain('No single option is being put forward');
    });
  });
});
