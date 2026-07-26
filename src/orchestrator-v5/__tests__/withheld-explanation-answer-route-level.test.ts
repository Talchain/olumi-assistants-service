/**
 * G-CEE-1 — the RERUN NO-OP leak, at the real boundary.
 *
 * WHAT THIS FILE PINS. The POST-#711/#712 live walk (staging `820f3e8`) found
 * that a rerun turn on a CURRENT analysis takes a path neither prior walk had
 * ever reached, and that on that path `assistant_text` carried a full leader
 * claim on a withheld turn — 4/4 no-op bodies — while 3/4 also dropped the
 * withheld disclosure entirely. The structured fix (#711) applied correctly on
 * those very bodies; the prose was composed somewhere it does not reach.
 *
 * THE BRANCH THIS FILE MUST REACH, and how each fixture piece gets it there
 * (TESTING-DISCIPLINE rule 1 — "name the branch each fixture must reach, and
 * assert something ONLY that branch can produce"):
 *
 *   1. an EXPLANATION handler must be dispatched (`explain_results`), because
 *      the leak rides `action.explanation.answer_text`. A `run_analysis`
 *      proposal would take the receipt path and prove nothing.
 *   2. the FK-PARENT TURN ROW must be seeded alongside the fact.
 *      `buildTurnContext` loads `prior_facts` by FK from `priorTurns.map(t =>
 *      t.id)`, so a fact seeded alone yields an EMPTY `prior_facts` — and then
 *      `validateExplanationAnswer`'s precondition bypass fires, the handler
 *      renders its "no analysis yet" template, and every absence assertion
 *      below passes VACUOUSLY. This is the exact instance rule 1 was earned by.
 *   3. the fact's `graph_hash_at_run` must EQUAL the current graph hash, and
 *      the persisted graph must be the same object the request carries, so
 *      `deriveAnalysisFreshness` returns `fresh` and
 *      `decideExplanationPrecondition` returns `'execute'`. A stale verdict
 *      renders the "model has changed" template — again the wrong branch.
 *   4. Sonnet's `answer_text` must PASS every pre-existing side-band rule
 *      (>= 80 chars, no forbidden internal terms, no mutation language, no raw
 *      decimals) so the handler uses it VERBATIM. An answer that failed one of
 *      those would route to the deterministic fallback, and this file would be
 *      measuring the fallback rather than the live defect.
 *   5. `goal_constraints` must be on the persisted graph, because the
 *      disclosure names the condition from that array and from nothing else.
 *
 * THE BRANCH-ONLY ASSERTION (rule 1's second half). The POSITIVE CONTROL
 * asserts the permitted turn ships Sonnet's answer **byte-for-byte**. Only the
 * verbatim-answer branch can produce that string — no template in this repo
 * contains it — so a green control proves the fixture reached the branch, and
 * a fixture that silently fell into a template turns the control RED rather
 * than turning the withheld case falsely green.
 *
 * ASSERTIONS ARE ON THE SERIALISED HTTP BYTES (rule 3). `#703` shipped two of
 * three requirements inert while its tests were green, because they asserted on
 * `outcome.assistant_text` — upstream of the forwarder that discarded it. Every
 * assertion here reads `res.body`, past the real registry forwarder, the real
 * egress sanitiser and the real finaliser.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

import { setTestSink } from '../../utils/telemetry.js';
// The production guard's OWN scanner, imported so this acceptance test and the
// alarm cannot drift apart (the same tie `constraint-disclosure-route-level`
// establishes).
import { findLeaderClaims } from '../compose/leading-option-egress-guard.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

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
 * The freshness anchor. Computed with the SAME production function the turn
 * executor uses, over the SAME object both graph seams serve, so `fresh` is
 * derived rather than asserted.
 */
const READY_GRAPH_HASH = computeAnalysisAffectingGraphHash(READY_GRAPH as never)!;

/**
 * The LIVE LEAK, transcribed from `case1e.rerun.run.response.json`
 * (`acceptance-evidence/g-cee-1-constraint-verdict/raw-2026-07-26-post-71112/`),
 * with only the option labels remapped onto this file's graph.
 *
 * IT IS LOAD-BEARING THAT THIS STRING PASSES THE PRE-EXISTING SIDE-BAND RULES.
 * It carries no forbidden internal term ("fact", "node", "edge", "handler",
 * "projection"), no mutation language, and no raw decimal — so
 * `validateExplanationAnswer` marks it VALID and the handler uses it verbatim.
 * That is the live defect's shape: the answer was never invalid, it was
 * unlicensed.
 *
 * Note which sentence carries the claim. "comes out ahead, leading in" matched
 * NOTHING in the egress guard's vocabulary before this change — the live bodies
 * tripped it only incidentally, via "the lead" elsewhere in the same answer.
 * This fixture therefore keeps BOTH: the incidental phrase is dropped from the
 * withheld arm's expectations so the pin is on the leader sentence itself.
 */
const SONNET_LEADER_ANSWER =
  'Your latest run is current, so there is no need to rerun it yet. ' +
  'Hire Marketing Manager comes out ahead, leading in 72% of simulations, ' +
  'with Hold close behind at 28%. Capacity is the strongest computed driver ' +
  'here, so firming up that number would sharpen the comparison.';

/**
 * A prior successful run. BOTH the turn row and the fact are required — see the
 * file header, item 2.
 */
const PRIOR_RUN_ANALYSIS_TURN = {
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
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

/**
 * The persisted analysis the rerun turn narrates.
 *
 * `constraint_verdict` is the #712 TYPED field (schemas 0.25.0) — the one the
 * readers consult first. `may_name_leading_option: false` is the whole premise
 * of the withheld arm; the permitted arm flips exactly this one member and
 * nothing else, so any behavioural difference between the two arms is
 * attributable to the verdict and to nothing in the fixture.
 */
function priorRunAnalysisFact(verdict: {
  may_name_leading_option: boolean;
  constraint_verdict_state: string;
}): Record<string, unknown> {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_hire',
      summary: 'Prior analysis result',
      graph_hash_at_run: READY_GRAPH_HASH,
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

/**
 * The router's proposal: an EXPLANATION handler carrying Sonnet's prose in
 * `action.explanation.answer_text`. This is the shape the live no-op turns
 * took — established from the captured bodies, not assumed: they show
 * `total_handler_duration_ms: 0` (no PLoT, no ISL, no math), a single routing
 * LLM call at 675-859 output tokens (the prose was authored INSIDE it), and
 * `chip_action_explain_results` absent from `suggested_actions` exactly on
 * those bodies.
 */
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
  readonly assistantText: string;
  readonly blocks: Array<Record<string, any>>;
}

async function rerunTurn(app: FastifyInstance): Promise<WireTurn> {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'message',
      turn_id: randomUUID(),
      scenario_id: SCENARIO_ID,
      stage: 'analyse',
      message: 'Run the analysis',
      turn_class: 'decide',
      source: 'composer',
      graph_state: READY_GRAPH,
    },
  });
  const body = JSON.parse(res.body) as Record<string, any>;
  return {
    status: res.statusCode,
    raw: res.body,
    assistantText: typeof body.assistant_text === 'string' ? body.assistant_text : '',
    blocks: Array.isArray(body.blocks) ? body.blocks : [],
  };
}

describe('route-level: the rerun no-op explanation answer on a WITHHELD turn', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    setTestSink(() => {});
    routeWithToolUseMock.mockReset();
    routeWithToolUseMock.mockResolvedValue(routedExplainResults(SONNET_LEADER_ANSWER));
    priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
    priorFacts = [];
  });
  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  describe('unevaluated (the walk\'s P0 state)', () => {
    beforeEach(() => {
      priorFacts = [
        priorRunAnalysisFact({
          may_name_leading_option: false,
          constraint_verdict_state: 'unevaluated',
        }),
      ];
    });

    it('(d) NO leader claim survives to assistant_text — the 4/4 live failure', async () => {
      const turn = await rerunTurn(app);
      expect(turn.status).toBe(200);
      expect(routeWithToolUseMock).toHaveBeenCalled();

      // The live leaking sentence, verbatim. Under the defect this is present.
      expect(turn.assistantText).not.toContain('comes out ahead');
      expect(turn.assistantText).not.toContain('leading in 72%');

      // And the guard's own scanner finds nothing in the chat slot.
      const hits = findLeaderClaims(JSON.parse(turn.raw)).filter(
        (h) => h.path === 'assistant_text',
      );
      expect(
        hits.map((h) => `${h.path} (${h.code})`),
        'a leading-option claim survived to assistant_text on a withheld rerun',
      ).toEqual([]);
    });

    it('(b)+(c) the DISCLOSURE is present — condition named AND repair step — the 3/4 drop', async () => {
      const turn = await rerunTurn(app);
      // (b) which condition
      expect(turn.assistantText).toContain('Three-Year Total Cost of Ownership');
      expect(turn.assistantText).toContain('was not checked');
      // the consequence, in the estate's own wording ("put forward", never
      // "recommended" — the forbidden-vocabulary ban is blunt by design)
      expect(turn.assistantText).toContain('no option can be put forward yet');
      // (c) a repair step the user can act on
      expect(turn.assistantText).toContain(
        'Re-state that limit against a measure recorded in the same units as the limit',
      );
    });

    it('the `_answer_shape` SIDECAR is clean too — it is derived from the projected text', async () => {
      const turn = await rerunTurn(app);
      const shape = (JSON.parse(turn.raw) as Record<string, any>)._answer_shape;

      // Non-vacuity first: the sidecar must actually be on this response, or
      // the absence assertion below is testing nothing. An explanation answer
      // is classified `substantive`, so the route egress synthesises it.
      expect(shape, '_answer_shape absent — the assertion below would be vacuous').toBeDefined();

      // It matters that this is checked SEPARATELY from assistant_text. The
      // sidecar is a distinct rendered surface (the walk's §3.3 read the leak
      // off `_answer_shape.headline` and `.bullets`), and it is built by
      // re-splitting the final text — so it is clean here only because the gate
      // runs UPSTREAM of compose. A gate placed after compose would leave this
      // carrying the claim the chat slot had just dropped.
      const shapeJson = JSON.stringify(shape);
      expect(shapeJson).not.toContain('comes out ahead');
      expect(shapeJson).not.toContain('leading in 72%');
    });

    it('NON-VACUITY: the turn really reached the explanation branch', async () => {
      const turn = await rerunTurn(app);
      // Blocks rebuilt from the prior fact are the fingerprint of the lifecycle
      // rebuild — the branch that only runs when the current turn produced no
      // run_analysis fact. If the fixture had fallen into the "no analysis yet"
      // precondition template, there would be no analysis_result block at all
      // and every absence assertion above would be vacuous.
      expect(turn.blocks.some((b) => b.type === 'analysis_result')).toBe(true);
    });
  });

  describe('evaluated_infeasible (the state the walk could NOT induce on this branch)', () => {
    beforeEach(() => {
      priorFacts = [
        priorRunAnalysisFact({
          may_name_leading_option: false,
          constraint_verdict_state: 'evaluated_infeasible',
        }),
      ];
    });

    it('withholds the leader, and says so without inventing a condition diagnosis', async () => {
      const turn = await rerunTurn(app);
      expect(turn.assistantText).not.toContain('comes out ahead');
      // `buildConstraintDisclosureFromState` returns '' for this state by
      // design (its copy lives in the coach's compact-summary note), so the
      // honest tail is the no-disclosure one — and it must NOT claim the
      // condition went unchecked, which would be false here.
      expect(turn.assistantText).toContain('No single option can be put forward on this result yet');
      expect(turn.assistantText).not.toContain('was not checked');
    });
  });

  describe('POSITIVE CONTROLS — the test can fail in BOTH directions', () => {
    it('evaluated_feasible: Sonnet\'s answer ships BYTE-FOR-BYTE, unprojected', async () => {
      priorFacts = [
        priorRunAnalysisFact({
          may_name_leading_option: true,
          constraint_verdict_state: 'evaluated_feasible',
        }),
      ];
      const turn = await rerunTurn(app);

      // THE BRANCH-ONLY ASSERTION (see the file header). No template in this
      // repo contains this string, so its presence proves the fixture reached
      // the verbatim-answer branch — and its absence would turn this control
      // RED rather than turning the withheld cases falsely green.
      //
      // Whitespace is collapsed before comparison because the egress
      // answer-shape synthesiser reflows a substantive answer into paragraphs
      // (it inserts `\n\n` at the headline break). That reflow is orthogonal to
      // this gate — asserting on raw bytes here would pin the SYNTHESISER's
      // formatting, not the claim-safety behaviour under test, and would go red
      // the next time paragraphing changed.
      const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();
      expect(collapse(turn.assistantText)).toContain(collapse(SONNET_LEADER_ANSWER));
      // Over-suppression control: the leader summary is untouched.
      expect(turn.assistantText).toContain('comes out ahead');
      expect(turn.assistantText).toContain('leading in 72%');
      // And no withheld copy leaked onto a permitted turn.
      expect(turn.assistantText).not.toContain('no option can be put forward yet');
      expect(turn.assistantText).not.toContain('No single option can be put forward');
    });

    it('UNSTAMPED fact FAILS CLOSED — an unreadable verdict withholds', async () => {
      // A fact persisted before #710 carries neither the typed field nor the
      // interim stamp. "Unknown" and "verified feasible" are different claims
      // and only the second licenses a leader.
      const fact = priorRunAnalysisFact({
        may_name_leading_option: true,
        constraint_verdict_state: 'evaluated_feasible',
      });
      delete (fact.result as Record<string, unknown>).constraint_verdict;
      priorFacts = [fact];

      const turn = await rerunTurn(app);
      expect(turn.assistantText).not.toContain('comes out ahead');
      // State unreadable ⇒ leader-free copy with NO named condition. It must
      // not guess a voice.
      expect(turn.assistantText).toContain('No single option can be put forward on this result yet');
      expect(turn.assistantText).not.toContain('Three-Year Total Cost of Ownership');
    });
  });
});
