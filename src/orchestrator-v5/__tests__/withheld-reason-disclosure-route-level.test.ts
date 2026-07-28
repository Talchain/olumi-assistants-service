/**
 * ROADMAP 2.104 — the withheld REASON reaches the user, at the real boundary.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT CHANGED, AND WHY THIS FILE NO LONGER TESTS A QUESTION.
 *
 * Live, 28 Jul (Codex journey): on a WITHHELD run the user asked why no option
 * had been put forward and the turn answered "open the latest recap". Three
 * revisions tried to RECOGNISE that question and short-circuit it; three
 * adversarial rounds found three independent over-capture axes, the last of
 * which showed the approach has a ceiling rather than a hole — "no X is being
 * put forward" and "no X exists in my graph" have the same surface form.
 *
 * The recogniser is deleted. The reason is now appended at the FINALISER to
 * every withheld turn that displays the analysis, whatever was asked. This file
 * therefore tests COVERAGE and OVER-SUPPRESSION, not classification:
 *
 *   COVERAGE        the reason reaches exits that never carried it — including
 *                   the recap deflection itself, which is the live defect.
 *   NO DUPLICATES   a turn that already carries the tail is byte-identical,
 *                   with a POSITIVE CONTROL so that assertion cannot pass
 *                   vacuously (trap 13 — an absence assertion must first prove
 *                   it can see a presence).
 *   NO OVER-REACH   a PERMITTED turn is byte-identical; a `run_analysis`
 *                   receipt is not double-disclosed; a stale run stands down.
 *
 * Every assertion reads `res.body` — past the real router, the real forwarder,
 * the real egress sanitiser and the real finaliser.
 *
 * ⚠ THE FK-PARENT TURN ROW IS LOAD-BEARING: `buildTurnContext` loads
 * `prior_facts` by FK from the prior-turn ids, so a fact seeded without its turn
 * row yields an EMPTY `prior_facts` and every assertion here would pass or fail
 * for the wrong reason.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

// The production alarm's OWN scanner, so this acceptance test and the guard
// cannot drift apart.
import { findLeaderClaims } from '../compose/leading-option-egress-guard.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { composeWithheldReasonTail } from '../compose/withheld-reason-tail.js';
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

/**
 * A LEADER-FREE Sonnet answer, and it is what exercises the branch this change
 * is about.
 *
 * `projectExplanationAnswerForWithheldClaim` REPLACES an answer that trips the
 * leader vocabulary and APPENDS to one that does not. The answer above trips it,
 * so a file that used only that string would test the replace branch twice and
 * the append branch never — and APPEND is the branch the finaliser must be
 * idempotent against.
 */
const SONNET_CLEAN_ANSWER =
  'The model is driven mainly by Capacity, and the spread across the simulations is ' +
  'wide enough that the ordering is not settled. Firming up that number is the ' +
  'single most useful thing you could do next.';

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

/**
 * The message that reaches the RECAP DEFLECTION. Measured, not assumed: on a
 * withheld run the advice gate's input is the null-leader projection, so
 * `explain_results_free_text` declines `data_unavailable_for_class` and the
 * class-blind catch-net answers with `RECAP_TEXT`.
 *
 * This is the live 2.104 defect's actual surface, and it is now a COVERAGE case
 * rather than a recorded residual: the recap still ships, but it no longer ships
 * without the reason.
 */
const DEFLECTED_MESSAGE = 'What does this mean?';

/** Occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

/** The tail this fixture's verdict + persisted graph must produce. Derived. */
function expectedTail(state: string): string {
  const tail = composeWithheldReasonTail(
    state as never,
    readRatifiedConstraints(READY_GRAPH),
  );
  expect(tail, `fixture must produce a tail for ${state}`).not.toBeNull();
  return tail!.text.trim();
}

describe('route-level: the withheld REASON reaches every exit that displays the analysis', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    routeWithToolUseMock.mockReset();
    routeWithToolUseMock.mockResolvedValue(routedExplainResults(SONNET_CLEAN_ANSWER));
    priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
  });

  describe('COVERAGE — evaluated_infeasible, the state that had NO read-back copy at all', () => {
    beforeEach(() => {
      priorFacts = [
        priorRunAnalysisFact({
          may_name_leading_option: false,
          constraint_verdict_state: 'evaluated_infeasible',
        }),
      ];
    });

    it('the RECAP DEFLECTION now carries the reason — the live 2.104 defect, closed', async () => {
      // ⚠ THE DEFECT ITSELF. Before this change the user received the recap and
      // nothing else. The recap still ships — closing that is separate work —
      // but it no longer ships without the reason, which is the whole of the
      // differentiator's credibility.
      const turn = await askTurn(app, DEFLECTED_MESSAGE);
      expect(turn.status).toBe(200);
      // Per sentence: compose inserts a paragraph break inside the recap, so a
      // whole-string containment would fail for a formatting reason.
      for (const sentence of LIVE_DEFLECTION.split(/(?<=\.)\s+/)) {
        expect(turn.assistantText, sentence).toContain(sentence);
      }
      expect(turn.assistantText).toContain(expectedTail('evaluated_infeasible'));
      expect(turn.assistantText).toContain('“Three-Year Total Cost of Ownership”');
    });

    it('the ROADMAP question gets it too — and via a DIFFERENT exit, which is the point', async () => {
      // No recogniser is involved. This message reaches the router and an
      // explanation handler; the deflected one above never leaves the
      // deterministic catch-net. Two different exits, one reason, because the
      // hook is at the finaliser rather than on a matched question.
      const turn = await askTurn(app, THE_QUESTION);
      expect(turn.assistantText).toContain(expectedTail('evaluated_infeasible'));
    });

    it('ships the composer’s bytes exactly — the wire is not a paraphrase', async () => {
      // The tail must be the composer's bytes VERBATIM and must sit at the very
      // end — appended, never woven in or re-worded by anything downstream.
      const tail = composeWithheldReasonTail(
        'evaluated_infeasible' as never,
        readRatifiedConstraints(READY_GRAPH),
      )!.text;
      const turn = await askTurn(app, DEFLECTED_MESSAGE);
      expect(turn.assistantText.endsWith(tail)).toBe(true);
    });

    it('names no leading option anywhere in the response envelope', async () => {
      for (const message of [DEFLECTED_MESSAGE, THE_QUESTION]) {
        const turn = await askTurn(app, message);
        expect(findLeaderClaims(turn.body as never), message).toEqual([]);
      }
    });
  });

  describe('COVERAGE — unevaluated keeps its own voice', () => {
    beforeEach(() => {
      priorFacts = [
        priorRunAnalysisFact({
          may_name_leading_option: false,
          constraint_verdict_state: 'unevaluated',
        }),
      ];
    });

    it('uses the NOT-CHECKED voice and the repair step that matches THIS diagnosis', async () => {
      const turn = await askTurn(app, DEFLECTED_MESSAGE);
      expect(turn.assistantText).toContain('was not checked');
      expect(turn.assistantText).toContain('same units as the limit');
      // The two states must not borrow each other's sentence — the conflation
      // `constraint-gap-disclosure.ts` was rewritten twice to avoid.
      expect(turn.assistantText).not.toContain('does not stand up against');
      expect(findLeaderClaims(turn.body as never)).toEqual([]);
    });
  });

  describe('OVER-SUPPRESSION — no duplicates, with a control that can see one', () => {
    beforeEach(() => {
      priorFacts = [
        priorRunAnalysisFact({
          may_name_leading_option: false,
          constraint_verdict_state: 'unevaluated',
        }),
      ];
    });

    it('the explanation-handler path is disclosed EXACTLY ONCE, not twice', async () => {
      // ⚠ THE SHARPEST OVER-SUPPRESSION CASE, and the reason the widening needed
      // its own controls. Two gates now see this turn: the per-handler gate at
      // the tool-call compose site (which still runs — it feeds `blocks[].summary`
      // and the `_answer_shape` sidecar, which a finaliser cannot), and the new
      // finaliser hook. Both call the SAME composer, so the second sees its own
      // bytes already present and stands down.
      const turn = await askTurn(app, THE_QUESTION);
      const tail = expectedTail('unevaluated');
      expect(countOccurrences(turn.assistantText, tail)).toBe(1);
    });

    it('POSITIVE CONTROL — the counter can SEE a duplicate, so the assertion is not vacuous', () => {
      // Trap 13. An idempotence assertion that has never observed a duplicate
      // proves nothing; this drives the same counter over a string that has one.
      const tail = expectedTail('unevaluated');
      expect(countOccurrences(`prefix ${tail} middle ${tail} suffix`, tail)).toBe(2);
      expect(countOccurrences(`prefix ${tail} suffix`, tail)).toBe(1);
      expect(countOccurrences('nothing here', tail)).toBe(0);
    });

    it('a SECOND turn on the same fact is disclosed once, not compounded', async () => {
      // Guards against a tail that accumulates across turns via the rolling
      // summary or any other carried text.
      await askTurn(app, DEFLECTED_MESSAGE);
      const turn = await askTurn(app, DEFLECTED_MESSAGE);
      expect(countOccurrences(turn.assistantText, expectedTail('unevaluated'))).toBe(1);
    });
  });

  describe('OVER-SUPPRESSION — the turns that must be untouched', () => {
    it('a PERMITTED run is byte-identical: no tail, and the router still answers', async () => {
      priorFacts = [
        priorRunAnalysisFact({
          may_name_leading_option: true,
          constraint_verdict_state: 'evaluated_feasible',
        }),
      ];
      routeWithToolUseMock.mockResolvedValue(routedExplainResults(SONNET_PERMITTED_ANSWER));
      const turn = await askTurn(app, THE_QUESTION);
      expect(routeWithToolUseMock).toHaveBeenCalled();
      // Per SENTENCE — compose inserts a paragraph break, and a whole-string
      // containment would fail for a formatting reason and teach the next reader
      // to weaken the check. Each sentence is branch-only: no template in this
      // repo contains either.
      for (const sentence of SONNET_PERMITTED_ANSWER.split(/(?<=\.)\s+/)) {
        expect(turn.assistantText, sentence).toContain(sentence);
      }
      expect(turn.assistantText).not.toContain('no option can be put forward');
      expect(turn.assistantText).not.toContain('conditions you set');
    });

    it('PERMITTED but state UNREADABLE — the PERMISSION is what stops this, not the state', async () => {
      // ⚠ THIS TEST EXISTS BECAUSE A MUTANT DID NOT BITE, AND THAT IS RECORDED
      // RATHER THAN QUIETLY FIXED. Deleting the permission check once left every
      // test green, because the composer's own decline on the two permitting
      // states was masking it — so the control was proving the composer's switch
      // and the gate itself had no coverage.
      //
      // The discriminating fixture is PERMITTED + UNREADABLE STATE, reachable on
      // one fact by design: a typed verdict whose `constraint_verdict_state` is
      // not a contract member reads `true` on the permission and `null` on the
      // state (`asVerdictState` rejects unknown strings against the enum's own
      // key set). The composer answers `reason_unrecorded` for a null state —
      // correct for a WITHHELD turn — so without the permission check a
      // PERMITTING run would be told no option can be put forward.
      priorFacts = [
        priorRunAnalysisFact({
          may_name_leading_option: true,
          constraint_verdict_state: 'a_sixth_state_this_release_does_not_know',
        }),
      ];
      const turn = await askTurn(app, THE_QUESTION);
      expect(turn.assistantText).not.toContain('the reason is not recorded on it');
      expect(turn.assistantText).not.toContain('no option can be put forward');
    });

    it('a STALE run stands down — the labels and the verdict would describe different graphs', async () => {
      // ⚠ THE F2 PREDICATE, moved here unchanged when the recogniser it used to
      // sit on was deleted. `goal_constraints` are inside the analysis-affecting
      // hash, so editing one is by itself enough to make the prior run stale —
      // which is exactly what happens when a user follows the repair step this
      // very tail gives them. The verdict would then come from the OLD fact
      // while the labels come from the CURRENT graph.
      priorFacts = [
        priorRunAnalysisFact(
          {
            may_name_leading_option: false,
            constraint_verdict_state: 'evaluated_infeasible',
          },
          PRE_EDIT_GRAPH_HASH,
        ),
      ];
      // Non-vacuity: the hashes must genuinely differ, or this is silently the
      // fresh fixture and the assertion passes for no reason.
      expect(PRE_EDIT_GRAPH_HASH).not.toBe(READY_GRAPH_HASH);
      const turn = await askTurn(app, THE_QUESTION);
      expect(turn.assistantText).not.toContain('was checked on this run');
      expect(turn.assistantText).not.toContain('“Three-Year Total Cost of Ownership”');
      // Stale falls back to prior behaviour — it does not become a new silence.
      expect(turn.status).toBe(200);
      expect(turn.assistantText.length).toBeGreaterThan(0);
    });
  });
});
