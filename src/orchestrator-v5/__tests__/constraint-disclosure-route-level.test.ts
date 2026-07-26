/**
 * T1 constraint disclosure — ACCEPTANCE AT THE REAL BOUNDARY.
 *
 * WHY THIS FILE EXISTS. #703 composed the disclosure into the run_analysis
 * summary and asserted on `outcome.assistant_text`. That is UPSTREAM of the
 * forwarder, so its tests could not see that the user received only "Ran
 * analysis on your current scenario." — the withheld-leader half of the fix
 * shipped, and the "which condition, and what to do about it" half was
 * replaced by a locked literal at the wire. Green-by-fixture, inside a fix for
 * green-by-fixture.
 *
 * The sibling file (coaching/__tests__/constraint-gap-disclosure-egress.test.ts)
 * closed that by calling the forwarder directly. THIS file closes the rest of
 * the distance: it drives the REAL Fastify route with `app.inject`, through the
 * REAL turn executor, the REAL `renderConfirmation` (turn-executor.ts), the
 * REAL registry forwarder AND the REAL egress sanitiser/finaliser, and asserts
 * on the SERIALISED HTTP RESPONSE BYTES. Nothing between the handler and the
 * socket is stubbed.
 *
 * Only two seams are mocked, and neither is on the disclosure's path:
 *   - the routing LLM (`routeWithToolUse`) — there is no network in CI;
 *   - the PLoT transport, so the enrichment envelope is a fixed, synthetic
 *     wire capture. Everything downstream of it is production code.
 *
 * THE NON-VACUITY CONTROL, and it is the load-bearing part of this file: the
 * same summary string ALSO travels on the `analysis_result` block, which does
 * NOT pass through the allowlist. So every test here asserts the sentence is
 * present in `blocks[].summary` (proving the handler really composed it) AND
 * present in `assistant_text` (proving it survived the forwarder). Under the
 * live defect the first passes and the second fails — which is exactly the
 * shape of #703's inertness, and a test that checked only one of them could
 * not tell the two apart.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

import { setTestSink } from '../../utils/telemetry.js';
import type { PLoTClient } from '../../orchestrator/plot-client.js';
import type { ScenarioReader } from '../tools/handlers/run-analysis.js';

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** The user's ratified condition, in CEE's own persisted vocabulary. */
const RATIFIED_CONSTRAINT = {
  constraint_id: 'constraint_out_total_cost_max',
  node_id: 'out_total_cost',
  operator: '<=',
  threshold: 2500,
  label: 'Total three-year cost',
};

const READY_GRAPH = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Customer growth', goal_threshold: 0.8 },
    { id: 'fac_capacity', kind: 'factor', label: 'Capacity' },
    { id: 'opt_hire', kind: 'option', label: 'Hire Marketing Manager', interventions: { fac_capacity: 1 } },
    { id: 'opt_hold', kind: 'option', label: 'Hold', is_baseline: true, interventions: { fac_capacity: 0 } },
  ],
  edges: [
    { from: 'opt_hire', to: 'fac_capacity', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'opt_hold', to: 'fac_capacity', strength: { mean: 0.01, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'fac_capacity', to: 'goal_growth', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
  ],
  goal_node_id: 'goal_growth',
  goal_constraints: [RATIFIED_CONSTRAINT],
};

/**
 * The PLoT wire, in the shapes the enrichment seam actually carries.
 * `constraintKey` is what PLoT used to key its per-option
 * `constraint_probabilities` map — the single variable that selects between the
 * verdict states this file exercises.
 */
function plotEnvelope(opts: {
  constraintKey?: string;
  /** Satisfaction probability written under `constraintKey`. 0 ⇒ the leader
   *  violates it, which selects `evaluated_infeasible`. */
  constraintProb?: number;
  constraintsStatus?: string;
  warningCodes?: readonly string[];
}): Record<string, unknown> {
  const withProbs = opts.constraintKey !== undefined;
  const option = (id: string, label: string, win: number, prob: number) => ({
    option_id: id,
    id,
    option_label: label,
    label,
    win_probability: win,
    outcome: { mean: 0.5, std: 0.2, p10: 0.3, p90: 0.7 },
    ...(withProbs
      ? {
          constraint_probabilities: { [opts.constraintKey!]: prob },
          probability_of_joint_goal: prob === 0 ? 0 : 0.9,
        }
      : {}),
  });
  return {
    meta: { seed_used: 1, n_samples: 1000, response_hash: 'sha256:fixture' },
    analysis_status: 'completed',
    constraints_status: opts.constraintsStatus ?? 'computed',
    ...(opts.warningCodes && opts.warningCodes.length > 0
      ? { inference_warnings: opts.warningCodes.map((code) => ({ code })) }
      : {}),
    option_comparison: [
      option('opt_hire', 'Hire Marketing Manager', 0.72, opts.constraintProb ?? 0.91),
      option('opt_hold', 'Hold', 0.28, opts.constraintProb ?? 0.88),
    ],
    response_hash: 'sha256:fixture-top',
  };
}

/** Swapped per test, before the inject. */
let plotResponse: Record<string, unknown> = plotEnvelope({});
/**
 * A prior successful run selects the RE-RUN coaching signal instead of the
 * first-run one. BOTH the turn row and the fact are required: `buildTurnContext`
 * loads `prior_facts` by FK from `priorTurns.map(t => t.id)`, so seeding facts
 * alone yields an empty `prior_facts` and the turn silently takes the FIRST-run
 * branch. (Found by mutation: a re-run-only revert changed nothing until this
 * was fixed.)
 */
let priorTurns: Array<Record<string, unknown>> = [];
let priorFacts: Array<Record<string, unknown>> = [];

const PRIOR_RUN_ANALYSIS_TURN = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
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

function priorRunAnalysisFact(): Record<string, unknown> {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_hire',
      summary: 'Prior analysis result',
      computed_at: new Date(Date.now() - 60_000).toISOString(),
      enrichment: {
        analysis_status: 'completed',
        option_comparison: [
          { option_id: 'opt_hire', option_label: 'Hire Marketing Manager', win_probability: 0.72, outcome_mean: 0.5 },
          { option_id: 'opt_hold', option_label: 'Hold', win_probability: 0.28, outcome_mean: 0.3 },
        ],
      },
      win_probabilities: { opt_hire: 0.72, opt_hold: 0.28 },
    },
  };
}

/** Seed a prior successful run: BOTH the turn row and its fact. */
function seedPriorRun(): void {
  priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
  priorFacts = [priorRunAnalysisFact()];
}

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
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
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

// The REAL run_analysis handler, with only the PLoT transport and the scenario
// reader injected. `createRegistry` is the production factory.
vi.mock('../tools/registry.js', async () => {
  const actual = await vi.importActual<typeof import('../tools/registry.js')>(
    '../tools/registry.js',
  );
  const plotClient = {
    run: async () => structuredClone(plotResponse),
    validatePatch: async () => ({}),
  } as unknown as PLoTClient;
  const scenarioReader: ScenarioReader = async () => ({
    graph: READY_GRAPH,
    options: [
      { id: 'opt_hire', option_id: 'opt_hire', label: 'Hire Marketing Manager', interventions: { fac_capacity: 1 } },
      { id: 'opt_hold', option_id: 'opt_hold', label: 'Hold', interventions: { fac_capacity: 0 } },
    ],
    goal_node_id: 'goal_growth',
    // The exact array the handler forwards to PLoT — the tightest statement of
    // "what we asked the engine to enforce".
    goal_constraints: [RATIFIED_CONSTRAINT],
    rawPersistedGraph: READY_GRAPH,
  });
  return {
    ...actual,
    getDefaultRegistry: () => actual.createRegistry({ plotClient, scenarioReader }),
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../orchestrator/route-v2.js');

function routedRunAnalysis() {
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
        handler_id: 'run_analysis',
        entity: {
          id: 'opt_hire',
          kind: 'option' as const,
          resolution_status: 'resolved' as const,
          resolution_method: 'id_match' as const,
        },
        parameters: [],
        cited_context_fields: ['graph.options'],
      },
    },
  };
}

interface WireTurn {
  status: number;
  /** The RAW serialised body — the bytes the user's browser receives. */
  raw: string;
  assistantText: string;
  /**
   * The CONFIRMATION segment of `assistant_text` — i.e. exactly what
   * `renderConfirmation` returned. `composeToolCallResponse` joins
   * [orientation?, confirmation, coaching?] with a blank line, so the
   * confirmation is the piece the egress allowlist governs and the only piece
   * the disclosure grammar has to match.
   */
  confirmation: string;
  /**
   * The `analysis_result` block's summary. Composed from the SAME handler
   * string but shipped WITHOUT passing the allowlist, so it is the control
   * that proves an `assistant_text` assertion is not vacuous.
   */
  blockSummary: string;
  /**
   * The COACHING segment — the last `\n\n`-delimited piece when one fired.
   * `composeToolCallResponse` joins [orientation?, confirmation, coaching?],
   * and the egress allowlist governs ONLY the confirmation, so the two slots
   * must be asserted separately.
   */
  coaching: string;
}

async function runAnalysisTurn(app: FastifyInstance): Promise<WireTurn> {
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
  const block = Array.isArray(body.blocks)
    ? body.blocks.find((b: Record<string, unknown>) => b.type === 'analysis_result')
    : undefined;
  const assistantText = typeof body.assistant_text === 'string' ? body.assistant_text : '';
  return {
    status: res.statusCode,
    raw: res.body,
    assistantText,
    confirmation: assistantText.split('\n\n')[0] ?? '',
    coaching: (() => {
      const segs = assistantText.split('\n\n');
      return segs.length > 1 ? segs[segs.length - 1]! : '';
    })(),
    blockSummary: typeof block?.summary === 'string' ? block.summary : '',
  };
}

const FALLBACK = 'Ran analysis on your current scenario.';

describe('route-level: the constraint disclosure in the serialised HTTP envelope', () => {
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
    routeWithToolUseMock.mockResolvedValue(routedRunAnalysis());
    plotResponse = plotEnvelope({});
    priorTurns = [];
    priorFacts = [];
  });
  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  it('POSITIVE CONTROL: a HEALTHY evaluated run keeps its recommendation on the wire', () => {
    // The false-positive direction, asserted at the boundary that matters. PLoT
    // scored the ratified constraint under CEE's own id, so the verdict is
    // `evaluated_feasible`, the leading option may be named, and NO disclosure
    // is appended. If this ever goes red, the fix below is costing users a
    // recommendation on healthy runs.
    plotResponse = plotEnvelope({ constraintKey: 'constraint_out_total_cost_max' });
    return runAnalysisTurn(app).then((turn) => {
      expect(turn.status).toBe(200);
      expect(turn.raw).not.toContain('conditions you set');
      expect(turn.raw).not.toContain('could not be matched');
      expect(turn.assistantText.length).toBeGreaterThan(0);
    });
  });

  it('UNEVALUATED: the condition and the repair step reach the SERIALISED bytes', async () => {
    // The live staging defect: the ratified constraint has no score anywhere,
    // and PLoT says the constraint block is unavailable. Requirements (b) and
    // (c) of #703 — name the condition, offer a repair step — are what never
    // reached the wire.
    plotResponse = plotEnvelope({
      constraintsStatus: 'unavailable',
      warningCodes: ['CONSTRAINT_OUT_OF_DOMAIN'],
    });
    const turn = await runAnalysisTurn(app);
    expect(turn.status).toBe(200);

    // CONTROL FIRST: the handler really composed it (this path bypasses the
    // allowlist), so the assertions below are about SURVIVAL, not composition.
    expect(turn.blockSummary).toContain('Total three-year cost');

    // (a) the leading-option claim is withheld
    expect(turn.assistantText).not.toContain('Hire Marketing Manager');
    // and the message is not the bland substitute
    expect(turn.assistantText).not.toBe(FALLBACK);
    // (b) the condition is NAMED — in the serialised bytes
    expect(turn.raw).toContain('Total three-year cost');
    expect(turn.assistantText).toContain('Total three-year cost');
    expect(turn.assistantText).toContain('was not checked');
    // (c) the repair step is present
    expect(turn.assistantText).toContain('Re-state that limit');
  });

  it('IDENTITY_UNRESOLVED: the honest wording reaches the wire, and says neither false thing', async () => {
    // PLoT scored a constraint, but keyed it by its `${node_id}_${operator}`
    // fallback, so nothing reconciles with `constraint_out_total_cost_max`.
    plotResponse = plotEnvelope({ constraintKey: 'out_total_cost_<=' });
    const turn = await runAnalysisTurn(app);
    expect(turn.status).toBe(200);

    expect(turn.blockSummary).toContain('could not be matched');

    // It survives the forwarder.
    expect(turn.assistantText).not.toBe(FALLBACK);
    expect(turn.raw).toContain('could not be matched to the condition you set');
    // It does NOT say the condition went unchecked (#703's false statement).
    expect(turn.assistantText).not.toContain('was not checked');
    // It does NOT certify safety — no leader is named (#707's false statement).
    expect(turn.assistantText).not.toContain('Hire Marketing Manager');
    expect(turn.assistantText).toContain('no option can be put forward yet');
    // And it offers ITS repair step, not the units one.
    expect(turn.assistantText).toContain('Re-state the condition and run the analysis again');
    expect(turn.assistantText).not.toContain('recorded in the same units');
  });

  it('the disclosure survives serialisation intact — whole confirmation, curly quotes and all', async () => {
    // The curly quotes around the label are the one non-ASCII part of the copy
    // and the likeliest thing to be mangled by an egress sanitiser or a JSON
    // escape. And the disclosure composes LAST, so the confirmation ending on
    // the repair step is what proves it was not truncated at the tail — the
    // failure mode a `toContain` on the subject sentence alone would miss.
    plotResponse = plotEnvelope({
      constraintsStatus: 'unavailable',
      warningCodes: ['CONSTRAINT_TARGET_UNRELIABLE'],
    });
    const turn = await runAnalysisTurn(app);
    expect(turn.confirmation).toContain('\u201cTotal three-year cost\u201d');
    expect(turn.confirmation.endsWith('then run the analysis again.')).toBe(true);
    // Single-line: the allowlist rejects any confirmation containing a newline,
    // so a multi-line disclosure would be silently replaced by the fallback.
    expect(turn.confirmation).not.toContain('\n');
  });

  it('the coaching tail is a SEPARATE piece — the confirmation the allowlist saw is intact', async () => {
    // `assistant_text` is [orientation?, confirmation, coaching?] joined by a
    // blank line. This pins WHICH piece carries the disclosure, so a future
    // change that moves the disclosure into the coaching slot (where no egress
    // allowlist governs it, and where it would not be part of the receipt)
    // fails here instead of passing a loose whole-string `toContain`.
    plotResponse = plotEnvelope({
      constraintsStatus: 'unavailable',
      warningCodes: ['CONSTRAINT_OUT_OF_DOMAIN'],
    });
    const turn = await runAnalysisTurn(app);
    expect(turn.confirmation).toContain('was not checked');
    expect(turn.confirmation).toContain('Re-state that limit');
    expect(turn.confirmation.startsWith(FALLBACK)).toBe(true);
    // The withheld headline is why the confirmation opens with the locked
    // template rather than "Hire Marketing Manager currently leads".
    expect(turn.assistantText).not.toContain('currently leads');
  });
});

/**
 * THE COACHING TAIL — the second producer of claims about the same state.
 *
 * The confirmation above says "no option can be put forward yet". The composer
 * then appends the STEP-5 coaching piece to the SAME `assistant_text`, and that
 * copy presumes the very leader the confirmation declined to name — on a re-run
 * it names the option outright. Observed verbatim before the fix:
 *
 *   [0] "Ran analysis on your current scenario. One of the conditions you set
 *        was not checked: “Total three-year cost”. … so no option can be put
 *        forward yet. Re-state that limit … then run the analysis again."
 *   [1] "Your first analysis is ready. Take a moment to explore the leading
 *        option and the factors shaping it before acting on the result."
 *
 * WHY NO EXISTING DEFENCE CAUGHT IT: `isAllowedRunAnalysisAssistantText`
 * governs only the CONFIRMATION segment. The coaching piece is a separate
 * compose slot that never passes through it, so every defence built for the
 * headline is bypassed one line underneath.
 *
 * The gate is `mayNameLeadingOption === false`, NOT a list of state names, so a
 * future withholding state is covered without touching this code. All three
 * current withholding states are exercised below for the same reason the enum
 * exists: they reach this slot by one path.
 */
const LEADING_OPTION_LANGUAGE: readonly RegExp[] = [
  /explore the leading option/i,
  /\bstill leads\b/i,
  /\bnow leads\b/i,
  /\bled before\b/i,
  /its lead has (?:widened|narrowed)/i,
  /the result is unchanged/i,
];

/** The three states in which the verdict forbids naming a leading option. */
const WITHHOLDING_STATES = [
  {
    state: 'unevaluated',
    envelope: () =>
      plotEnvelope({ constraintsStatus: 'unavailable', warningCodes: ['CONSTRAINT_OUT_OF_DOMAIN'] }),
  },
  {
    state: 'identity_unresolved',
    envelope: () => plotEnvelope({ constraintKey: 'out_total_cost_<=' }),
  },
  {
    state: 'evaluated_infeasible',
    envelope: () =>
      plotEnvelope({ constraintKey: 'constraint_out_total_cost_max', constraintProb: 0 }),
  },
] as const;

describe('withhold paths: the coaching tail must not presume a leading option', () => {
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
    routeWithToolUseMock.mockResolvedValue(routedRunAnalysis());
    plotResponse = plotEnvelope({});
    priorTurns = [];
    priorFacts = [];
  });
  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  describe('POSITIVE CONTROLS — the test can fail in BOTH directions', () => {
    // Without these, every `not.toMatch` below would pass on a turn that
    // emitted no coaching at all. These assert the copy IS present on
    // `evaluated_feasible`, so a fix that simply deleted all coaching fails.

    it('evaluated_feasible, FIRST run: the coaching copy IS still present', () => {
      plotResponse = plotEnvelope({ constraintKey: 'constraint_out_total_cost_max' });
      return runAnalysisTurn(app).then((turn) => {
        expect(turn.status).toBe(200);
        expect(turn.coaching).toMatch(/explore the leading option/i);
      });
    });

    it('evaluated_feasible, RE-RUN: the coaching copy names the option', () => {
      // Also proves the re-run branch is genuinely reached — the first-run copy
      // is asserted ABSENT, so a fixture that silently fell back to the
      // first-run signal fails here instead of passing the withhold assertions
      // below for the wrong reason.
      plotResponse = plotEnvelope({ constraintKey: 'constraint_out_total_cost_max' });
      seedPriorRun();
      return runAnalysisTurn(app).then((turn) => {
        expect(turn.status).toBe(200);
        expect(turn.coaching).not.toMatch(/your first analysis is ready/i);
        expect(turn.coaching).toContain('Hire Marketing Manager');
      });
    });
  });

  for (const { state, envelope } of WITHHOLDING_STATES) {
    describe(`${state}`, () => {
      it('FIRST analysis: no leading-option language in the serialised bytes', async () => {
        plotResponse = envelope();
        const turn = await runAnalysisTurn(app);
        expect(turn.status).toBe(200);
        for (const pattern of LEADING_OPTION_LANGUAGE) {
          expect(turn.assistantText).not.toMatch(pattern);
        }
        expect(turn.assistantText).not.toContain('Hire Marketing Manager');
      });

      it('RE-RUN: no leading-option language in the serialised bytes', async () => {
        // The worse case: `composeRerunText` NAMES the option in four of its
        // five branches, on a turn whose claim-safety machinery just withheld
        // exactly that claim.
        plotResponse = envelope();
        seedPriorRun();
        const turn = await runAnalysisTurn(app);
        expect(turn.status).toBe(200);
        for (const pattern of LEADING_OPTION_LANGUAGE) {
          expect(turn.assistantText).not.toMatch(pattern);
        }
        expect(turn.assistantText).not.toContain('Hire Marketing Manager');
      });

      it('FIRST analysis: the coaching slot is SUPPRESSED, not reworded', async () => {
        // The confirmation already names the condition and gives the repair
        // step. A replacement sentence would be a second, competing
        // call-to-action on the same screen.
        plotResponse = envelope();
        const turn = await runAnalysisTurn(app);
        expect(turn.coaching).toBe('');
        // …and the confirmation is still there, so the screen is not empty.
        expect(turn.confirmation.length).toBeGreaterThan(0);
      });

      it('RE-RUN: the comparison-free acknowledgement survives', async () => {
        // This one is KEPT rather than suppressed: "your earlier result has
        // been replaced" is information the confirmation does not carry, and it
        // presumes no leader. It is `composeRerunText`'s own existing degrade,
        // reused rather than written.
        plotResponse = envelope();
        seedPriorRun();
        const turn = await runAnalysisTurn(app);
        expect(turn.coaching).toBe(
          'This was a re-run. It replaces the earlier result as the current analysis.',
        );
      });
    });
  }
});
