/**
 * ROADMAP 2.1091 / golden-journey EXT-2 — EVERY ANALYSE PATH EMITS A TYPED
 * READINESS STATE.
 *
 * WITNESSED DEFECT (staging, 2026-08-13, golden-journey run
 * `20260813T190744Z-fresh-extended-7f2445`, step `T5B_REANALYSE`): after
 * adding an option, the `run_analysis` chip-click returned HTTP 200 with the
 * honest mixed-scale refusal prose and `blocks: []` — and NO `analysis_ready`
 * key at all. The run was neither ADMITTED (`status: ready`) nor
 * TYPED-BLOCKED. Nothing machine-readable shipped, so no UI surface and no
 * witness could act on the state; EXT-2 could only be scored by reading prose.
 *
 * ROOT CAUSE: `dispatchChipClickRunAnalysis` composes the graceful
 * `handler_recovered` outcome for every RECOVERABLE_HANDLER_CAUSE (the
 * mixed-scale gate throws `analysis_not_ready` with
 * `details.reason_code: 'mixed_scale_unresolved'`), and that outcome carried
 * `analysisReady?: undefined` BY CONSTRUCTION. route-v2's `handler_recovered`
 * exit therefore hands the finaliser no payload, and the finaliser omits the
 * field.
 *
 * THE INVARIANT PINNED HERE IS THE SPEC, NOT THE ARM: every recoverable
 * analyse outcome emits a typed readiness state with a SPECIFIC reason.
 * A suite that only pinned `mixed_scale_unresolved` would be blind the next
 * time a different cause takes the same exit (CLAUDE.md trap 22b — a corpus
 * that tests one direction is a guard watching one door).
 *
 * ⚠ WHAT THIS SUITE DELIBERATELY DOES **NOT** ASSERT (ROADMAP 2.1134(a), and
 * the reconciliation the #940 lane refused): the PER-OPTION
 * `analysis_ready.options[].status` and the PAYLOAD-LEVEL
 * `analysis_ready.status` answer DIFFERENT QUESTIONS —
 *   · per-option  : "do we have user-warranted values for this option?"
 *   · payload      : "did this turn's analyse attempt proceed?"
 * Forcing them to agree trades a wrong-value defect for a missing-leader one.
 * The per-option statuses are asserted UNCHANGED below, on purpose.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import type { RunAnalysisScenarioSnapshot } from '../../tools/handlers/run-analysis.js';

import { OlumiResponseSchema } from '@talchain/schemas/boundary';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { RECOVERABLE_HANDLER_CAUSES } from '../../compose/recoverable-handler-causes.js';
import { computeStructuralReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { ANALYSE_HANDLER_ID } from '../../tools/handler-errors.js';
import { DETERMINISTIC_CHIP_ACTION_TYPES } from '../chip-click-dispatch.js';
import {
  HandlerInvocationFailedError,
  type HandlerInvocationFailedCause,
} from '../../tools/handler-errors.js';

const {
  loadScenarioSnapshotForRunAnalysisMock,
  commitDirectAnswerMock,
  enrichRunAnalysisMock,
  handlerFnMock,
  createRegistryMock,
} = vi.hoisted(() => ({
  loadScenarioSnapshotForRunAnalysisMock: vi.fn(),
  commitDirectAnswerMock: vi.fn(),
  enrichRunAnalysisMock: vi.fn(),
  handlerFnMock: vi.fn(),
  createRegistryMock: vi.fn(),
}));

vi.mock('../../build-turn-context.js', async () => {
  const actual = await vi.importActual<typeof import('../../build-turn-context.js')>(
    '../../build-turn-context.js',
  );
  return {
    ...actual,
    loadScenarioSnapshotForRunAnalysis: loadScenarioSnapshotForRunAnalysisMock,
    buildTurnContext: vi.fn(async () => ({
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {
        can_run_analysis: false,
        can_edit_graph: false,
        can_run_decision_review: false,
        can_generate_coaching: false,
        can_invoke_tools: false,
        can_commit_session_state: false,
      },
      messages: [{ role: 'user', content: 'Run the analysis' }],
      session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      request_id: 'req-test',
      budgets: {
        turn_ms: 30000,
        handler_ms: 20000,
        plot_ms: 15000,
        anthropic_ms: 15000,
        openai_ms: 15000,
      },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    })),
  };
});

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: commitDirectAnswerMock,
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../coaching/decision-review-enricher.js', () => ({
  enrichRunAnalysisWithDecisionReview: enrichRunAnalysisMock,
}));

vi.mock('../../tools/registry.js', async () => {
  const actual = await vi.importActual<typeof import('../../tools/registry.js')>(
    '../../tools/registry.js',
  );
  return {
    ...actual,
    createRegistry: createRegistryMock,
    getDefaultRegistry: () => new Map([['run_analysis', handlerFnMock]]),
    resolveHandler: (_registry: unknown, id: string) =>
      id === 'run_analysis' ? handlerFnMock : undefined,
  };
});

import { dispatchChipClickRunAnalysis } from '../chip-click-dispatch.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function payload() {
  return makeMessagePayload({
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse',
    message: 'Run the analysis.',
    turn_class: 'decide',
    source: 'chip_click',
    chip: { action_type: 'run_analysis' },
  });
}

/**
 * A schema-valid GraphV3T carrying THREE options, one of which (the
 * just-added `opt_migrate`) has no encoded interventions — the shape the
 * witnessed T5_ADD_OPTION turn left behind. Structural readiness over this
 * graph is `needs_encoding`, which is the CONTROL: the fix must not collapse
 * the ordinary structural vocabulary into `blocked`.
 */
const ADDED_OPTION_GRAPH: GraphV3T = {
  nodes: [
    { id: 'dec_crm', kind: 'decision', label: 'CRM decision' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue', goal_threshold: 0.8 },
    { id: 'fac_licence', kind: 'factor', label: 'Annual CRM Licence Cost' },
    { id: 'opt_hubspot', kind: 'option', label: 'Move to HubSpot', interventions: { fac_licence: 0.7 } },
    { id: 'opt_stay', kind: 'option', label: 'Stay as we are', interventions: { fac_licence: 0.3 } },
    { id: 'opt_migrate', kind: 'option', label: 'Migrate to Salesforce' },
  ],
  edges: [
    { from: 'dec_crm', to: 'opt_hubspot', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_crm', to: 'opt_stay', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_crm', to: 'opt_migrate', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_hubspot', to: 'fac_licence', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'opt_stay', to: 'fac_licence', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'opt_migrate', to: 'fac_licence', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'fac_licence', to: 'goal_revenue', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
} as unknown as GraphV3T;

/** Same graph with the goal node removed — structural readiness is undefined. */
const NO_GOAL_GRAPH: GraphV3T = {
  nodes: ADDED_OPTION_GRAPH.nodes.filter((n) => (n as { kind?: string }).kind !== 'goal'),
  edges: [],
} as unknown as GraphV3T;

function snapshotFor(graph: GraphV3T): RunAnalysisScenarioSnapshot {
  return {
    graph,
    options: [],
    goal_node_id: 'goal_revenue',
    rawPersistedGraph: graph,
  } as unknown as RunAnalysisScenarioSnapshot;
}

/**
 * The EXACT throw the mixed-scale gate performs at
 * `src/orchestrator-v5/tools/handlers/run-analysis.ts:533` — derived from the
 * producer's own bytes, not from this lane's model of it (CLAUDE.md trap 13c).
 */
function mixedScaleRefusal(): HandlerInvocationFailedError {
  return new HandlerInvocationFailedError(
    'Outbound analysis payload carries value scales CEE cannot safely resolve',
    {
      cause_kind: 'analysis_not_ready',
      retryable: false,
      details: {
        handler_id: 'run_analysis',
        scenario_id: SCENARIO_ID,
        reason_code: 'mixed_scale_unresolved',
        next_step: "I can't run this analysis safely.",
      },
    },
  );
}

function throwingCause(cause: HandlerInvocationFailedCause): HandlerInvocationFailedError {
  return new HandlerInvocationFailedError(`forced ${cause}`, {
    cause_kind: cause,
    retryable: false,
    details: {
      handler_id: 'run_analysis',
      specific_issue: 'simulated',
      first_option_label: 'Move to HubSpot',
    },
  });
}

function handlerOk() {
  return {
    assistant_text: 'Ran analysis on your current scenario.',
    handler_facts: [
      {
        fact_type: 'run_analysis' as const,
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: SCENARIO_ID,
          leading_option_id: 'opt_hubspot',
          win_probabilities: { opt_hubspot: 0.62, opt_stay: 0.38 },
          summary: 'Ran analysis on your current scenario.',
          enrichment: {},
        },
      },
    ],
    llm_calls_used: 0,
  };
}

describe('EXT-2 / 2.1091 — the mixed-scale analyse arm emits a typed readiness state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enrichRunAnalysisMock.mockImplementation(
      async ({ handlerFacts }: { handlerFacts: unknown[] }) => handlerFacts,
    );
    commitDirectAnswerMock.mockResolvedValue({
      response: {},
      performed: true,
      persisted_row_id: 'row-1',
      graphPersisted: true,
    });
    createRegistryMock.mockImplementation(() => new Map([['run_analysis', handlerFnMock]]));
  });

  it('RED-1: the mixed_scale_unresolved refusal carries a readiness payload at all (witnessed: NOTHING)', async () => {
    handlerFnMock.mockRejectedValueOnce(mixedScaleRefusal());
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(snapshotFor(ADDED_OPTION_GRAPH));

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-ext2-red1',
    });

    expect(out.outcome).toBe('handler_recovered');
    // THE WITNESSED DEFECT: undefined here ⇒ route-v2 stamps nothing ⇒ the
    // wire body has no `analysis_ready` key.
    expect(out.analysisReady).toBeDefined();
  });

  it('RED-2: the refusal is typed as BLOCKED and names a SPECIFIC reason, never a generic one', async () => {
    handlerFnMock.mockRejectedValueOnce(mixedScaleRefusal());
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(snapshotFor(ADDED_OPTION_GRAPH));

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-ext2-red2',
    });

    if (out.outcome !== 'handler_recovered') throw new Error(`expected handler_recovered, got ${out.outcome}`);
    const ar = out.analysisReady;
    expect(ar.status).toBe('blocked');
    // Bound by IDENTITY to the producer's own reason_code, not by a value
    // predicate another reason could satisfy (CLAUDE.md trap 19).
    expect((ar as { blocked_reason?: string }).blocked_reason).toBe('mixed_scale_unresolved');
  });

  /**
   * ⚠ THIS TEST WAS INVERTED BY AN ADVERSARIAL REVIEW, AND THE INVERSION IS
   * THE POINT. It used to assert the refusal CARRIED the real options. The
   * review measured what that does on the DEPLOYED UI: real options flip
   * `DecisionOverviewCard` from `unassessed` to `needs_input`, auto-expanding
   * "Olumi needs a little more from you" with no `user_questions` — a SCALE
   * refusal mis-described as a framing gap, then echoed back to CEE and
   * persisted to sessionStorage. Shipping a new false surface in order to
   * deliver an honest wire field is the wrong trade.
   *
   * ROADMAP 2.1134(a), read at the REGISTER BYTES rather than paraphrased,
   * does NOT require options on a refusal turn. It withdraws a claimed defect
   * between CEE's `analysis_ready.options[].status` and PLoT/ISL's
   * `enrichment.option_comparison[].status` and rules "name them apart; do not
   * reconcile". A refusal turn produces no `option_comparison` and names no
   * leader, so `isRecommendableOption` has nothing to read. The row's genuine
   * requirement survives as the STRONGER property asserted here: the refusal
   * writes no per-option status at all, because it carries no option rows.
   */
  it('RED-3: the refusal is a PRESENT-but-empty carrier — it invents no option rows and writes no per-option status', async () => {
    handlerFnMock.mockRejectedValueOnce(mixedScaleRefusal());
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(snapshotFor(ADDED_OPTION_GRAPH));

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-ext2-red3',
    });

    if (out.outcome !== 'handler_recovered') throw new Error(`expected handler_recovered, got ${out.outcome}`);
    const ar = out.analysisReady;

    // PRESENT, not dropped — both are REQUIRED at the boundary, and omitting
    // either fails egress validation and destroys the whole turn.
    expect(Object.keys(ar)).toContain('options');
    expect(Object.keys(ar)).toContain('goal_node_id');
    expect(ar.options).toEqual([]);
    expect(ar.goal_node_id).toBe('');

    // PRECONDITION PINNED IN-TEST (CLAUDE.md trap 13b): the snapshot graph
    // really does have three options and a goal node, so the empty carrier is
    // a deliberate choice and not an artefact of an empty fixture.
    expect(computeStructuralReadiness(ADDED_OPTION_GRAPH)!.options).toHaveLength(3);

    // The dispatcher never stamps computed_at — that is the finaliser's job.
    expect((ar as { computed_at?: string }).computed_at).toBeUndefined();
  });

  /**
   * The keys are PRESENT-but-empty for a hard reason, and this test is that
   * reason. `@talchain/schemas`' `OlumiResponseSchema` declares
   * `analysis_ready` with REQUIRED `options` and `goal_node_id`; dropping
   * either fails `safeParse` and takes the whole turn down. Asserted against
   * the REAL boundary schema, with positive controls proving the probe can
   * see a failure at all.
   */
  it('BOUNDARY: the refusal payload validates against the real OlumiResponseSchema — and dropping either key does NOT', async () => {
    handlerFnMock.mockRejectedValueOnce(mixedScaleRefusal());
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(snapshotFor(ADDED_OPTION_GRAPH));

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-ext2-boundary',
    });
    if (out.outcome !== 'handler_recovered') throw new Error(`expected handler_recovered, got ${out.outcome}`);

    const envelope = {
      response_version: 2 as const,
      assistant_text: 'x',
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: 'analyse' as const,
      analysis_ready: out.analysisReady as Record<string, unknown>,
    };
    expect(OlumiResponseSchema.safeParse(envelope).success).toBe(true);

    // POSITIVE CONTROLS — the probe can see a failure.
    const bare = out.analysisReady as Record<string, unknown>;
    const noOptions = { ...bare }; delete noOptions.options;
    const noGoal = { ...bare }; delete noGoal.goal_node_id;
    expect(OlumiResponseSchema.safeParse({ ...envelope, analysis_ready: noOptions }).success).toBe(false);
    expect(OlumiResponseSchema.safeParse({ ...envelope, analysis_ready: noGoal }).success).toBe(false);
  });

  /**
   * ROADMAP 2.1091 D2 — a refusal turn must not DEGRADE the freshness strip
   * as a side effect of reporting readiness honestly.
   *
   * `attachComputedAt` stamps the freshness wire fields only when the
   * finaliser is handed a derivation. Without one the block ships
   * freshness-free, and the deployed UI reads that as "cannot confirm whether
   * this analysis is current" — replacing a correct verdict on exactly the
   * witnessed refusal.
   */
  it('D2: the refusal carries a REAL freshness derivation for the prior analysis against the current graph', async () => {
    handlerFnMock.mockRejectedValueOnce(mixedScaleRefusal());
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(snapshotFor(ADDED_OPTION_GRAPH));

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-ext2-d2',
    });

    if (out.outcome !== 'handler_recovered') throw new Error(`expected handler_recovered, got ${out.outcome}`);
    expect(out.freshness).toBeDefined();
    // Bound by IDENTITY to the honest verdict for this fixture (no prior
    // run_analysis fact), not merely "some verdict is present".
    expect(out.freshness!.freshness).toBe('none');
    expect(out.freshness!.reason).toBe('no_successful_run_analysis_fact');
    // And it is a REAL derivation against the snapshot, not a stub: the
    // current graph hash is populated from the raw persisted graph.
    expect(typeof out.freshness!.current_graph_hash).toBe('string');
    expect((out.freshness!.current_graph_hash ?? '').length).toBeGreaterThan(0);
  });

  it('RED-4 (SPEC, not the arm): EVERY recoverable handler cause emits a typed readiness state with a specific reason', async () => {
    const causes = [...RECOVERABLE_HANDLER_CAUSES];
    expect(causes.length).toBeGreaterThan(0);

    for (const cause of causes) {
      handlerFnMock.mockRejectedValueOnce(throwingCause(cause));
      loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(snapshotFor(ADDED_OPTION_GRAPH));

      const out = await dispatchChipClickRunAnalysis({
        payload: payload(),
        requestId: `req-ext2-red4-${cause}`,
      });

      expect(out.outcome, `cause ${cause} must recover`).toBe('handler_recovered');
      if (out.outcome !== 'handler_recovered') continue;
      expect(out.analysisReady, `cause ${cause} must emit a readiness payload`).toBeDefined();
      expect(out.analysisReady!.status, `cause ${cause} must be typed blocked`).toBe('blocked');
      // No `details.reason_code` on these, so the reason falls back to the
      // typed cause_kind — still specific, never generic.
      expect(
        (out.analysisReady as { blocked_reason?: string }).blocked_reason,
        `cause ${cause} must name a specific reason`,
      ).toBe(cause);
    }
  });

  it('RED-5: with no goal node the refusal STILL emits a typed readiness state (never absent)', async () => {
    handlerFnMock.mockRejectedValueOnce(mixedScaleRefusal());
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(snapshotFor(NO_GOAL_GRAPH));

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-ext2-red5',
    });

    if (out.outcome !== 'handler_recovered') throw new Error(`expected handler_recovered, got ${out.outcome}`);
    const ar = out.analysisReady;
    expect(ar.status).toBe('blocked');
    expect((ar as { blocked_reason?: string }).blocked_reason).toBe('mixed_scale_unresolved');
    expect(ar.options).toEqual([]);
    expect(ar.goal_node_id).toBe('');
  });

  /**
   * ROADMAP 2.1091 D1 — the two arms must agree on WHEN a refusal is an
   * ANALYSIS refusal, not merely on how to describe one.
   *
   * DERIVED, not mirrored (CLAUDE.md trap 12): the routed arm gates on
   * `ANALYSE_HANDLER_ID` and the chip arm's scope is its whitelist. If the
   * whitelist ever grows, this REDs and forces a decision about whether the
   * new action's failure really means the analysis is blocked — rather than
   * the two arms drifting silently.
   */
  it('D1 SCOPE: the chip whitelist and the routed arm\'s analyse-handler gate are the SAME scope', () => {
    expect([...DETERMINISTIC_CHIP_ACTION_TYPES]).toEqual([ANALYSE_HANDLER_ID]);
  });

  it('CONTROL: the ordinary admitted path is unchanged — structural readiness still reports needs_encoding, never blocked', async () => {
    handlerFnMock.mockResolvedValueOnce(handlerOk());
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(snapshotFor(ADDED_OPTION_GRAPH));

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-ext2-control',
    });

    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    const ar = out.analysisReady!;
    expect(ar.status).toBe('needs_encoding');
    expect((ar as { blocked_reason?: string }).blocked_reason).toBeUndefined();
  });
});
