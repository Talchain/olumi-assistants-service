/**
 * ROADMAP 2.1085 (root 2.1041) / golden-journey EXT-2 — EVERY ANALYSE PATH EMITS A TYPED
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
import {
  computeStructuralReadiness,
  buildCanonicalAnalysisReadyFromGraph,
} from '../../../orchestrator/tools/analysis-ready-helper.js';
import { clampRefusalFreshness } from '../../compose/analysis-ready-emit.js';
import { deriveAnalysisFreshness, enforceInvariants } from '../../context/freshness.js';
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
 * witnessed T5_ADD_OPTION turn left behind. Canonical readiness over this
 * graph is `needs_user_input`: the new arm is connected but has no attested
 * effect value. This is the CONTROL: the refusal fix must not collapse the
 * ordinary typed readiness vocabulary into `blocked`.
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

/**
 * THE FRESH DRAFT — the same graph with NO option carrying an encoded value.
 *
 * This is the state a just-drafted model lands in, and `build-turn-context.ts`
 * says so in its own comment at :2427-2429. It differs from
 * `ADDED_OPTION_GRAPH` in EXACTLY one respect — how many options are valued —
 * and that single difference flips the run-admission verdict from TRUE to
 * FALSE while leaving canonical `status` at `needs_user_input` in BOTH cases.
 * That is the entire reason `status` cannot discriminate here and the admission
 * verdict can.
 */
const FRESH_DRAFT_GRAPH: GraphV3T = {
  nodes: ADDED_OPTION_GRAPH.nodes.map((n) => {
    const node = n as { kind?: string; interventions?: unknown };
    if (node.kind !== 'option') return n;
    const stripped = { ...node } as Record<string, unknown>;
    delete stripped.interventions;
    return stripped;
  }),
  edges: ADDED_OPTION_GRAPH.edges,
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

describe('EXT-2 / 2.1085 (root 2.1041) — the mixed-scale analyse arm emits a typed readiness state', () => {
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

  it('persists a structured refused run attempt so the next turn cannot forget it', async () => {
    handlerFnMock.mockRejectedValueOnce(mixedScaleRefusal());
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(snapshotFor(ADDED_OPTION_GRAPH));

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-ext2-refusal-continuity',
    });

    expect(out.outcome).toBe('handler_recovered');
    expect(out.commitPerformed).toBe(true);
    expect(commitDirectAnswerMock).toHaveBeenCalledTimes(1);
    const metadata = commitDirectAnswerMock.mock.calls[0]?.[1] as {
      handler_id?: unknown;
      handler_facts?: Array<{
        fact_type?: unknown;
        noop?: unknown;
        result?: { enrichment?: Record<string, unknown> };
      }>;
    };
    expect(metadata.handler_id).toBe('run_analysis');
    expect(metadata.handler_facts).toHaveLength(1);
    expect(metadata.handler_facts?.[0]).toMatchObject({
      fact_type: 'run_analysis',
      noop: false,
      result: {
        enrichment: {
          analysis_status: 'refused',
          refusal_reason_code: 'mixed_scale_unresolved',
        },
      },
    });
  });

  it('fails closed when the refusal marker cannot be committed', async () => {
    handlerFnMock.mockRejectedValueOnce(mixedScaleRefusal());
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(snapshotFor(ADDED_OPTION_GRAPH));
    commitDirectAnswerMock.mockRejectedValueOnce(new Error('append unavailable'));

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-ext2-refusal-commit-failed',
    });

    expect(out.outcome).toBe('commit_failed');
    expect(out.commitPerformed).toBe(false);
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
   * ROADMAP 2.1085 (root 2.1041) D2 — a refusal turn must not DEGRADE the freshness strip
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
    // Bound by IDENTITY to the honest verdict for this fixture, not merely
    // "some verdict is present". This fixture has no prior run_analysis fact,
    // so the raw derivation is `none` — which R2 forbids on a refusal turn
    // (it clears a previously-good fact). The clamp maps it to `unknown` while
    // PRESERVING the precise, true reason rather than replacing it with a
    // general one.
    expect(out.freshness!.freshness).toBe('unknown');
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
   * ⭐ R1 — THE REFUSAL MUST BE ANALYSE-SHAPED, AND THIS IS THE MOST SERIOUS
   * OF THE ROUND-3 FINDINGS.
   *
   * A deployed-UI trace measured that a turn which is `stage_indicator !==
   * 'analyse'` AND carries no `analysis_result` block takes the UI's
   * present-but-invalid path, CLEARING ten fields that otherwise survive such
   * a turn — including the user's `goalConstraints`, `draftCoaching` and
   * `preAnalysisSensitivity` — plus the sessionStorage keys.
   *
   * ⚠ THIS WAS LIVE-REACHABLE ON THE WITNESSED RUN, and worse than assumed.
   * In `20260813T190744Z-fresh-extended-7f2445`, BOTH T3 (a SUCCESSFUL
   * analysis) and T5B (the refusal) came back `stage_indicator: 'frame'`,
   * because the deployed Run-analysis chip sends `stage: 'frame'`. T3 was
   * harmless only because it carried an `analysis_result` block. A refusal
   * carries none — so shipping the honest readiness block on the request's
   * own stage would have DESTROYED USER STATE.
   */
  it('R1: the refusal response is ANALYSE-shaped even when the request stage is `frame`', async () => {
    handlerFnMock.mockRejectedValueOnce(mixedScaleRefusal());
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(snapshotFor(ADDED_OPTION_GRAPH));

    // The witnessed request shape: a run_analysis chip click at stage `frame`.
    const framePayload = makeMessagePayload({
      scenario_id: SCENARIO_ID,
      turn_id: TURN_ID,
      stage: 'frame',
      message: 'Run analysis',
      turn_class: 'frame',
      source: 'chip_click',
      chip: { action_type: 'run_analysis' },
    });
    // PRECONDITION PINNED IN-TEST (CLAUDE.md trap 13b): the request really is
    // frame-staged, so a passing assertion below is the code's doing and not
    // the fixture quietly already being 'analyse'.
    expect(framePayload.stage).toBe('frame');

    const out = await dispatchChipClickRunAnalysis({
      payload: framePayload,
      requestId: 'req-ext2-r1',
    });

    if (out.outcome !== 'handler_recovered') throw new Error(`expected handler_recovered, got ${out.outcome}`);
    expect(out.response.stage_indicator).toBe('analyse');
    // And the other half of the UI's condition is genuinely absent, which is
    // WHY the stage has to carry the weight.
    expect(out.response.blocks.some((b) => b.type === 'analysis_result')).toBe(false);
  });

  /**
   * ⭐ R2/R3 — the refusal carrier's freshness verdict, as a SPEC invariant
   * over every verdict the derivation can produce, not just the arm in hand.
   *
   *   · `none`  is forbidden — it clears a previously-good analysis fact,
   *     putting an orphaned-result banner over results that are still valid.
   *   · `fresh` is forbidden — it clears the local-edits dirty overlay, so the
   *     strip claims "reflects the current model" over edits CEE never saw.
   *
   * Both forbidden verdicts are MEASURED reachable from `deriveAnalysisFreshness`
   * below rather than assumed, and the clamp is asserted to convert each.
   */
  it('R2/R3: refusal-turn freshness is always in {stale, unknown} WITH a reason — never none, never fresh', async () => {
    handlerFnMock.mockRejectedValueOnce(mixedScaleRefusal());
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(snapshotFor(ADDED_OPTION_GRAPH));

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-ext2-r2',
    });

    if (out.outcome !== 'handler_recovered') throw new Error(`expected handler_recovered, got ${out.outcome}`);
    expect(out.freshness).toBeDefined();
    expect(['stale', 'unknown']).toContain(out.freshness!.freshness);
    expect(typeof out.freshness!.reason).toBe('string');
    expect(out.freshness!.reason.length).toBeGreaterThan(0);
  });

  /**
   * The clamp itself, over every input the derivation can produce. Written
   * against the SPEC (the permitted range) rather than against the one arm
   * this lane came in on — CLAUDE.md trap 13d.
   *
   * ⚠ The `fresh` case also proves the SUBTLE half: a verdict-only clamp is
   * not enough. `checkHardInvariants` invariant 2 ("identical-hash ⇒ fresh")
   * COERCES a non-fresh verdict back to `fresh` while both hashes are present
   * and equal, and invariant 3 forbids `unknown` whenever both are present. So
   * the clamp must also drop `graph_hash_at_run` — the carrier then asserts no
   * comparison, which is exactly the claim. Asserted here, and asserted to
   * SURVIVE a re-run of `enforceInvariants`.
   */
  it('R2/R3 CLAMP: every verdict the derivation can produce maps into {stale, unknown} and survives enforceInvariants', () => {
    const base = {
      selected_fact_index: 0,
      computed_at: '2026-08-13T19:07:44.000Z',
    };

    // MEASURED, not assumed: `fresh` really is producible.
    const freshIn = deriveAnalysisFreshness(
      [{ fact_type: 'run_analysis', fact_version: 1, noop: false,
         result: { scenario_id: SCENARIO_ID, graph_hash_at_run: 'HHHH', computed_at: base.computed_at,
                   leading_option_id: 'opt_hubspot', win_probabilities: {}, summary: '', enrichment: {} } },
      ] as never,
      'HHHH',
    );
    expect(freshIn.freshness).toBe('fresh');

    const freshOut = clampRefusalFreshness(freshIn);
    expect(freshOut.freshness).toBe('unknown');
    expect(freshOut.reason).toBe('analysis_refused_currency_unverified');
    expect(freshOut.graph_hash_at_run).toBeNull();
    expect(freshOut.current_graph_hash).toBe('HHHH');
    // The clamp is not silently reverted by the module's own invariants.
    expect(enforceInvariants(freshOut).freshness).toBe('unknown');

    // MEASURED: `none` really is producible (no prior fact).
    const noneIn = deriveAnalysisFreshness([], 'HHHH');
    expect(noneIn.freshness).toBe('none');
    const noneOut = clampRefusalFreshness(noneIn);
    expect(noneOut.freshness).toBe('unknown');
    // A precise true reason is preserved rather than replaced by a general one.
    expect(noneOut.reason).toBe('no_successful_run_analysis_fact');
    expect(enforceInvariants(noneOut).freshness).toBe('unknown');

    // `stale` passes through untouched — honest, permitted, and the signal the
    // rerun affordance is gated on.
    const staleIn = deriveAnalysisFreshness(
      [{ fact_type: 'run_analysis', fact_version: 1, noop: false,
         result: { scenario_id: SCENARIO_ID, graph_hash_at_run: 'AAAA', computed_at: base.computed_at,
                   leading_option_id: 'opt_hubspot', win_probabilities: {}, summary: '', enrichment: {} } },
      ] as never,
      'BBBB',
    );
    expect(staleIn.freshness).toBe('stale');
    // ⚠ THIS ASSERTION WAS `toEqual(staleIn)` AND IS DELIBERATELY NARROWED, NOT
    // WEAKENED — the original is quoted rather than deleted (CLAUDE.md trap 14).
    // What it was guarding is that the clamp does not TOUCH THE VERDICT on a
    // pass-through, and that property is asserted below, field by field,
    // including the two hashes the clamp drops on its other branch.
    //
    // What changed: the analysis-state authority (schemas 0.46.0) needs to know
    // that THIS TURN REFUSED, and the pass-through branch is exactly the case a
    // reason-string sniffer cannot see — a stale derivation keeps its own
    // reason, so nothing else on the object says "refused". `clampRefusalFreshness`
    // therefore stamps `refusal_declared: true` on BOTH branches. It is
    // wire-invisible: `attachComputedAt` and `emitFreshnessTelemetry` both read
    // NAMED members, and `analysis-state-emit.test.ts` asserts the finalised
    // body never contains the string.
    const stalePassThrough = clampRefusalFreshness(staleIn);
    const { refusal_declared: refusalMarker, ...verdictOnly } = stalePassThrough;
    expect(verdictOnly).toEqual(staleIn);
    expect(refusalMarker).toBe(true);
  });

  /**
   * ROADMAP 2.1085 (root 2.1041) D1 — the two arms must agree on WHEN a refusal is an
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

  it('CONTROL: an incomplete added option retains canonical needs_user_input, never blocked', async () => {
    handlerFnMock.mockResolvedValueOnce(handlerOk());
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(snapshotFor(ADDED_OPTION_GRAPH));

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-ext2-control',
    });

    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    const ar = out.analysisReady!;
    expect(ar.status).toBe('needs_user_input');
    expect((ar as { blocked_reason?: string }).blocked_reason).toBeUndefined();
  });

  /**
   * ⭐ WHAT RED-3 ACTUALLY RESTS ON, PINNED SO IT CANNOT ROT.
   *
   * RED-3 asserts the empty carrier for `ADDED_OPTION_GRAPH`. Since the chip
   * arm began passing its structural projection, that bare result is produced
   * by `buildAnalysisRefusalReadiness`'s `may_run === true` term — NOT by the
   * arm discarding the payload, which is what used to produce it. The two are
   * indistinguishable from RED-3's assertions alone, so if this graph's
   * admission verdict ever flipped to `false`, RED-3 would start failing with
   * no clue as to why.
   *
   * This is CLAUDE.md trap 13b's third face: a guard whose DISCRIMINATION
   * depends on a fixture that nothing pins. Here is the pin.
   */
  it('PRECONDITION FOR RED-3: `ADDED_OPTION_GRAPH` ADMITS — its bare carrier is the verdict\'s doing', () => {
    const canonical = buildCanonicalAnalysisReadyFromGraph(ADDED_OPTION_GRAPH);
    expect(canonical).toBeDefined();
    // The case #942 measured: mid-session, one un-encoded option. The run would
    // proceed by excluding it, so a refusal here is NOT about the model.
    expect(canonical!.may_run).toBe(true);
    expect(canonical!.status).toBe('needs_user_input');
    // ...and it genuinely holds an identity, so "bare" is a decision about a
    // payload that had something to lose, not an artefact of an empty fixture.
    expect(canonical!.goal_node_id).toBe('goal_revenue');
    expect(canonical!.options.length).toBe(3);
  });

  /**
   * ⭐⭐ THE DEFECT, END TO END THROUGH THE ARM — RED-3's OPPOSITE-DIRECTION TWIN.
   *
   * MEASURED on two authenticated runs at deployed CEE `c24bfe37`, identical
   * both times: a signed-in user clicks "Run analysis" on a freshly drafted
   * model and the turn comes back
   *
   *     analysis_ready = { options: [], goal_node_id: "", status: "blocked",
   *                        blocked_reason: "MISSING_OPTION_VALUE", computed_at }
   *     analysis_state.run_state = { kind: "blocked", reason_code, blockers: [] }
   *
   * — a refusal carrying NO model identity and NO blockers, so nothing
   * downstream can tell the user what to fix. It is the Core PoC journey's
   * first failing step. `blockers: []` is the SAME defect, not a second one:
   * `compose/analysis-state-v1.ts:486-493` calls
   * `mapWireBlockers(input.readiness?.blockers)`, and `mapWireBlockers(undefined)`
   * returns `[]`.
   *
   * This graph and `ADDED_OPTION_GRAPH` differ ONLY in how many options carry
   * an encoded value, and they take opposite branches — which is exactly why
   * `status` could never have separated them: BOTH are `needs_user_input`.
   */
  it('THE DEFECT: a FRESH-DRAFT refusal PRESERVES the model identity the user has to fix', async () => {
    // PRECONDITION PINNED IN-TEST, and it is the whole ruling in three lines:
    // same status as RED-3's graph, opposite admission verdict.
    const canonical = buildCanonicalAnalysisReadyFromGraph(FRESH_DRAFT_GRAPH);
    expect(canonical).toBeDefined();
    expect(canonical!.status).toBe('needs_user_input');
    expect(canonical!.status).toBe(buildCanonicalAnalysisReadyFromGraph(ADDED_OPTION_GRAPH)!.status);
    expect(canonical!.may_run).toBe(false);

    handlerFnMock.mockRejectedValueOnce(mixedScaleRefusal());
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(snapshotFor(FRESH_DRAFT_GRAPH));

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-ext2-fresh-draft',
    });

    if (out.outcome !== 'handler_recovered') throw new Error(`expected handler_recovered, got ${out.outcome}`);
    const ar = out.analysisReady;

    // THE FIX: the refusal names the model. Bound by IDENTITY, never by a count
    // (CLAUDE.md trap 19) — "three different options" is the fabrication class
    // the continuity check exists to catch.
    expect(ar.goal_node_id).toBe('goal_revenue');
    expect(
      ar.options.map((o) => (o as { option_id?: string; id?: string }).option_id
        ?? (o as { id?: string }).id),
    ).toEqual(['opt_hubspot', 'opt_stay', 'opt_migrate']);

    // THE VERDICT IS STILL WITHDRAWN. Preserving identity must not buy a pass,
    // or this fix re-opens the defect the carrier was introduced for.
    expect(ar.status).toBe('blocked');
    expect((ar as { blocked_reason?: string }).blocked_reason).toBe('mixed_scale_unresolved');

    // AND NO SCIENCE THE REFUSAL DECLINED TO PRODUCE.
    //
    // ⚠ THE ENUMERATION CHANGED; THE PROPERTY DID NOT. `blockers` now rides the
    // refusal — the producer's own authored option × factor repair rows, which
    // are not work this turn declined to do but THE REASON IT REFUSED. What the
    // line below was written to forbid is science the refusal did not compute,
    // and that is asserted BY NAME underneath rather than left to an
    // enumeration that only says "four keys".
    expect(Object.keys(ar).sort()).toEqual(
      ['blocked_reason', 'blockers', 'goal_node_id', 'options', 'status'].sort(),
    );
    for (const forbidden of [
      'bias_findings',
      'model_adjustments',
      'readiness_issues',
      'repair_proposal',
      'option_comparison',
      'leading_option_id',
    ]) {
      expect(forbidden in ar).toBe(false);
    }
    // The rows are the producer's, and they name the pairs — not a count.
    const carried = (ar as { blockers?: Array<{ option_id?: string; factor_id?: string }> }).blockers;
    expect(carried?.length).toBeGreaterThan(0);
    expect([...(carried ?? [])].map((b) => `${b.option_id}::${b.factor_id}`).sort()).toEqual(
      [...(buildCanonicalAnalysisReadyFromGraph(FRESH_DRAFT_GRAPH)!.blockers ?? [])]
        .map((b) => `${(b as { option_id?: string }).option_id}::${(b as { factor_id?: string }).factor_id}`)
        .sort(),
    );
  });

  /**
   * The arm-level discriminating pair, stated as one assertion so a future
   * reader cannot miss that these two results come from ONE code path fed two
   * graphs — not from two behaviours written down separately.
   */
  it('⭐ ARM-LEVEL DISCRIMINATION: one arm, two graphs, opposite answers, same status', async () => {
    const results: Record<string, { status: unknown; carries: boolean; mayRun: unknown }> = {};
    for (const [name, graph] of [
      ['admits', ADDED_OPTION_GRAPH],
      ['refuses', FRESH_DRAFT_GRAPH],
    ] as const) {
      handlerFnMock.mockRejectedValueOnce(mixedScaleRefusal());
      loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(snapshotFor(graph));
      const out = await dispatchChipClickRunAnalysis({
        payload: payload(),
        requestId: `req-ext2-pair-${name}`,
      });
      if (out.outcome !== 'handler_recovered') throw new Error(`expected handler_recovered, got ${out.outcome}`);
      results[name] = {
        status: buildCanonicalAnalysisReadyFromGraph(graph)!.status,
        mayRun: buildCanonicalAnalysisReadyFromGraph(graph)!.may_run,
        carries: out.analysisReady.goal_node_id !== '' && out.analysisReady.options.length > 0,
      };
    }
    // SAME structural status — so `status` cannot be what separated them.
    expect(results.admits.status).toBe(results.refuses.status);
    // DIFFERENT admission verdict — which is what did.
    expect(results.admits.mayRun).toBe(true);
    expect(results.refuses.mayRun).toBe(false);
    // OPPOSITE outcomes.
    expect(results.admits.carries).toBe(false);
    expect(results.refuses.carries).toBe(true);
  });
});

/**
 * ⭐⭐ THE PROSE HALF OF THE SAME REFUSAL — UNGUARDED ON THIS ARM UNTIL NOW.
 *
 * Every test above pins the TYPED payload (`out.analysisReady`). Not one pins
 * that the refusal REACHES THE USER as words. That gap was found on 2026-08-29
 * while re-diagnosing this exact seam: a reader inspecting the golden-journey
 * capture `20260829T143150Z-fresh-extended-3fef3e` step `T5B_REANALYSE` saw
 * `blocks: []` and concluded the refusal shipped in silence. It had not — the
 * turn carried 543 characters of the handler's own refusal in top-level
 * `body.assistant_text` (`blocks: []` is the ordinary shape for a prose turn;
 * `T2_FOLLOWUP` and `T5C_CONFIRM` in the same capture carry zero blocks too).
 *
 * The premise was wrong. The absence of a guard was not:
 *
 *   · `chip-click-dispatch-recoverable.test.ts:220` asserts
 *     `assistant_text.length > 0` — a VALUE PREDICATE any string satisfies
 *     (CLAUDE.md trap 19). If the composer stopped reading `details.next_step`
 *     and fell back to its generic `'This scenario needs a quick fix before it
 *     can be analysed.'`, that assertion stays GREEN, every other test on this
 *     arm stays GREEN, and the user loses the whole specific refusal.
 *   · `analysis-not-ready-carry-through.spec.ts` pins the carry-through at the
 *     COMPOSER. This arm has been fixed one-arm-only TWICE already (see
 *     `chip-click-dispatch.ts:701-706` and `buildAnalysisRefusalReadiness`'s
 *     "THE CHIP ARM IS NO LONGER ONE OF THEM"). A composer guard is not a guard
 *     about the arm the deployed "Run analysis" chip actually takes.
 *
 * So this block asks the arm's own question — *what does the user read?* — and
 * asks it in BOTH directions (CLAUDE.md trap 22b): a refusal that HAS a reason
 * must say it verbatim, and a refusal that has NONE must refuse gracefully and
 * INVENT nothing.
 */
describe('EXT-2 / 2.1085 — the refusal reaches the USER, not only the payload', () => {
  /**
   * THE SENTENCE A USER ACTUALLY RECEIVED, copied byte-for-byte out of
   * `20260829T143150Z-fresh-extended-3fef3e-raw/step-T5B_REANALYSE.json`
   * `body.assistant_text` (deployed CEE `d6aa2f9`, signed-in fresh witness).
   * Produced by `run-analysis.ts:666` with `named = 'Annual CRM Licence Cost'`.
   *
   * ⚠ A CAPTURED SENTENCE, NOT A FIXTURE OF MY OWN (CLAUDE.md trap 16-inverse:
   * a fixture you wrote yourself is not evidence about the wire). It is not
   * edited to keep it current either — it is a record of what the product said
   * on a dated build (trap 14b).
   */
  const WITNESSED_BASELINE_NEXT_STEP =
    "I can't run this analysis safely. Annual CRM Licence Cost is recorded as a bare "
    + "amount with no range for me to measure it against, so I can't tell the analysis "
    + 'engine what it means next to everything else, and the numbers would not be the '
    + "ones your model states — I've stopped rather than show you a confident wrong "
    + 'answer. Nothing in your model has changed, and this is a limit in how I record '
    + 'and prepare values, not a verdict on your model. Telling me the same amount '
    + "again won't clear it; ask me to run it again after any change and I'll re-check.";

  /**
   * The composer's own fallback when a refusal carries no `next_step`
   * (`handler-failure-responses.ts`, `analysis_not_ready` branch). Named here
   * so the two directions below can be told apart by IDENTITY rather than by
   * "is it non-empty".
   */
  const GENERIC_FALLBACK = 'This scenario needs a quick fix before it can be analysed.';

  /** The baseline-scale gate's throw, `run-analysis.ts:617-668`. */
  function baselineScaleRefusal(): HandlerInvocationFailedError {
    return new HandlerInvocationFailedError(
      'Outbound analysis payload carries value scales CEE cannot safely resolve',
      {
        cause_kind: 'analysis_not_ready',
        retryable: false,
        details: {
          handler_id: 'run_analysis',
          scenario_id: SCENARIO_ID,
          reason_code: 'baseline_scale_unresolved',
          next_step: WITNESSED_BASELINE_NEXT_STEP,
        },
      },
    );
  }

  /**
   * A recoverable analyse refusal that carries NEITHER a reason code NOR a next
   * step. Constructible today: `run-analysis.ts:336-337` omits both keys when
   * the read-boundary verdict supplies neither, so the composer's fallback arm
   * is a real arm and not a hypothetical.
   */
  function reasonlessRefusal(): HandlerInvocationFailedError {
    return new HandlerInvocationFailedError('Persisted graph is not analysis-ready', {
      cause_kind: 'analysis_not_ready',
      retryable: false,
      details: { handler_id: 'run_analysis', scenario_id: SCENARIO_ID },
    });
  }

  it('⭐ CARRY-THROUGH: the handler\'s own next_step is what the user reads, verbatim', async () => {
    const refusal = baselineScaleRefusal();
    handlerFnMock.mockRejectedValueOnce(refusal);
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(snapshotFor(ADDED_OPTION_GRAPH));

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-ext2-prose-carry',
    });

    if (out.outcome !== 'handler_recovered') throw new Error(`expected handler_recovered, got ${out.outcome}`);

    // PRECONDITION PINNED IN-TEST (CLAUDE.md trap 13b): this refusal carries NO
    // `readiness_questions`, so the composer's list branch is not what produced
    // the text. The equality below is therefore testing the plain carry-through
    // and nothing else.
    expect(refusal.details.readiness_questions).toBeUndefined();

    // ⭐ BOUND BY IDENTITY to the producer's own string — not "contains a
    // keyword", which a different sentence could satisfy (CLAUDE.md trap 19).
    expect(out.response.assistant_text).toBe(refusal.details.next_step);
    // And, stated separately so a mutant's failure is legible: what the user
    // reads is NOT the composer's generic stand-in.
    expect(out.response.assistant_text).not.toBe(GENERIC_FALLBACK);

    // The typed payload and the prose must name the SAME refusal. One arm
    // telling the truth while the other says something else is the two-arms
    // defect this seam has already shipped twice (CLAUDE.md trap 21).
    expect((out.analysisReady as { blocked_reason?: string }).blocked_reason).toBe(
      'baseline_scale_unresolved',
    );
    // A route out, still typed so the election gate cannot demote it.
    expect(out.response.suggested_actions.map((a) => a.action_type)).toContain(
      'analysis_readiness',
    );
  });

  it('⚠ OPPOSITE DIRECTION — a refusal with NO reason refuses gracefully and FABRICATES NOTHING', async () => {
    handlerFnMock.mockRejectedValueOnce(reasonlessRefusal());
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(snapshotFor(ADDED_OPTION_GRAPH));

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-ext2-prose-reasonless',
    });

    if (out.outcome !== 'handler_recovered') throw new Error(`expected handler_recovered, got ${out.outcome}`);

    // Still a graceful 200-shaped recovery with a route, never silence.
    expect(out.response.assistant_text).toBe(GENERIC_FALLBACK);
    expect(out.response.suggested_actions.map((a) => a.action_type)).toContain(
      'analysis_readiness',
    );

    // ⭐ AND IT INVENTS NOTHING. No borrowed specificity from the refusal that
    // DOES have a reason — bound to that sentence's own distinguishing tokens,
    // which nothing else in the generic arm can supply.
    expect(out.response.assistant_text).not.toContain('Annual CRM Licence Cost');
    expect(out.response.assistant_text).not.toContain('bare amount');
    expect(out.response.assistant_text).not.toContain('baseline_scale_unresolved');

    // Honest rather than empty: with no declared reason the payload falls back
    // to the cause kind, which names the class and claims nothing more.
    expect(out.analysisReady.status).toBe('blocked');
    expect((out.analysisReady as { blocked_reason?: string }).blocked_reason).toBe(
      'analysis_not_ready',
    );
  });

  it('⭐ DISCRIMINATION: two different refusals on ONE arm produce two different sentences', async () => {
    // Neither test above can catch an arm that has learned ONE canned refusal:
    // each asserts a single sentence in isolation. This one runs both through
    // the same arm and requires them to differ — so a mutant that always
    // returns the same prose is caught even when that prose happens to be one
    // of the two correct ones.
    const seen: string[] = [];
    for (const [name, refusal] of [
      ['baseline', baselineScaleRefusal()],
      ['mixed', mixedScaleRefusal()],
    ] as const) {
      handlerFnMock.mockRejectedValueOnce(refusal);
      loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(snapshotFor(ADDED_OPTION_GRAPH));
      const out = await dispatchChipClickRunAnalysis({
        payload: payload(),
        requestId: `req-ext2-prose-${name}`,
      });
      if (out.outcome !== 'handler_recovered') throw new Error(`expected handler_recovered, got ${out.outcome}`);
      seen.push(out.response.assistant_text);
    }
    // PRECONDITION: the two producers really do author different sentences, so
    // a failure below is the ARM collapsing them and not the fixtures agreeing
    // (CLAUDE.md trap 13b — a discriminator must pin its own precondition).
    expect(baselineScaleRefusal().details.next_step).not.toBe(
      mixedScaleRefusal().details.next_step,
    );
    expect(seen[0]).toBe(baselineScaleRefusal().details.next_step);
    expect(seen[1]).toBe(mixedScaleRefusal().details.next_step);
    expect(seen[0]).not.toBe(seen[1]);
  });
});
