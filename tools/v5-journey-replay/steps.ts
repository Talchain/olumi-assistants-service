/**
 * V5 alpha hardening Phase 3 — journey step definitions.
 *
 * Each step defines a request payload + per-step assertion (via
 * `./assertions.ts`). The CLI threads outputs through the evidence writer.
 *
 * Step 3 ("Add another option") is product-shaped (correction 13): we do
 * NOT assert a specific internal classification — the request may route
 * to converse / clarify / a recoverable validation path. Only assertion:
 * HTTP 200, no BoundaryError, no internal terms.
 *
 * Step 4b (correction 14) — PLoT unknown status with unusable fields →
 * typed fatal. This is covered by the handler-level unit test at
 * src/orchestrator-v5/tools/handlers/__tests__/run-analysis-permissive-status.test.ts
 * and cannot be exercised through the HTTP boundary without injecting a
 * mock PLoT response. The evidence pack references that unit test as
 * authoritative coverage.
 *
 * DL-7 expansion — three additional journeys exercise the accepted-edit
 * fact path that edit_graph DL-7 PR B unlocks:
 *   - `dl7-set-factor`   — drives the existing V5 set_factor_value handler
 *                          so `recent_changes` is populated today, before
 *                          PR B exists.
 *   - `dl7-staleness`    — reorders the edit AFTER analysis to exercise
 *                          the freshness=stale signal.
 *   - `dl7-edit-graph`   — drives the generic edit_graph dispatcher.
 *                          Now a core V5 path: edit_graph DL-7 PR B is
 *                          live on staging (PR #159 docs merge pending).
 *                          The earlier `DL7_PR_B_LANDED` env gate has
 *                          been replaced with `DL7_PR_B_DISABLE` (an
 *                          emergency rollback switch, default off).
 *
 * QUARANTINE (task_9ff7378f): the dl7 frame-stage mutation probes are
 * triaged as an isolated issue, NOT a broad staging blocker. They do not
 * gate `canonical` or `branch-a-canonical` acceptance — `CANONICAL_STEPS`
 * has no mutation step, and the branch-a green path (steps 1-3) is
 * non-mutating (its only mutation, step 5 apply, is pending-scenario and
 * not live-exercised). Replay acceptance stays separate from this path.
 */

import { randomUUID } from 'node:crypto';

import type { FetchResult, TurnPayload } from './client.js';

export interface JourneyStep {
  readonly name: string;
  readonly description: string;
  readonly buildPayload: (ctx: JourneyContext) => TurnPayload;
  /** If true, step only makes sense after a prior step has completed. */
  readonly depends_on?: string;
  /**
   * Branch A (PR #236) dependency marker. When set, the harness records
   * this step as `skipped` (with `requires_branch_a`) unless
   * `BRANCH_A_ENFORCE=true` — the product emit/consume path that makes
   * the step pass does not exist until #236 lands. After #236 merges to
   * staging and this branch rebases, set the env flag to enforce.
   */
  readonly requires_branch_a?: boolean;
  /**
   * Assertion-only step: makes NO HTTP call. Asserts over state captured
   * from an earlier turn (e.g. the `what_would_flip` response stored in
   * `JourneyContext.branchAFlipResult`). Used for "the proposal chip
   * appeared on the prior turn" checks where re-POSTing would be wasteful
   * and non-deterministic (proposal idempotency).
   */
  readonly assert_only?: boolean;
  /**
   * DB read-back step: makes NO turn POST. Queries the staging Supabase
   * (gated behind `--db-readback`) to prove a mutation persisted. Skipped
   * with a clear reason when `--db-readback` is not supplied.
   */
  readonly db_readback?: boolean;
}

/**
 * Capture parsed out of the draft_graph response on Step 1. DL-7 journeys
 * use `factorLabels` (deterministic factor-label fallback) and
 * `graphHashAtDraft` (later compared against post-edit hash) downstream.
 *
 * Optional and additive — pre-DL-7 journeys do not populate or read it.
 */
export interface Step1Capture {
  readonly optionLabels: readonly string[];
  readonly factorLabels: readonly string[];
  /**
   * Factor node ids parsed from the draft graph. Optional and additive
   * (pre-Branch-A journeys neither populate nor read it). The Branch A
   * DB read-back uses this to assert the persisted `set_factor_value`
   * fact targeted a real factor from the drafted graph — the wire chip
   * does not surface the proposal's target id, so membership in this set
   * is the strongest target check the harness can make.
   */
  readonly factorIds?: readonly string[];
  readonly graphHashAtDraft: string | null;
  /**
   * Deterministic factor-label resolution result, computed once after
   * Step 1 succeeds. Threaded into Step 2's `buildPayload` so DL-7
   * journeys substitute a real label rather than improvising.
   */
  readonly resolvedFactorLabel: string | null;
  readonly factorLabelReason: 'budget_match' | 'first_label' | 'no_factor_labels';
}

export interface JourneyContext {
  readonly scenario_id: string;
  readonly turn_counter: { value: number };
  /** Populated by the harness after Step 1 succeeds. */
  step1Capture?: Step1Capture;
  /**
   * Branch A: the captured `what_would_flip` turn result. The assertion-
   * only "Test X at N proposal present" step inspects this for the
   * `set_factor_value` proposal chip, and the DB read-back derives the
   * proposed display value from the same chip. Populated only when the
   * Branch A journey runs the flip turn (i.e. `BRANCH_A_ENFORCE=true`).
   */
  branchAFlipResult?: FetchResult;
}

/**
 * Thrown by a step's `buildPayload` when the journey context lacks data
 * required to construct the request. The harness catches this, marks the
 * step `failed` with the carried `failingContract`, and continues.
 *
 * Used by DL-7 journeys when `step1Capture.resolvedFactorLabel` is null
 * (no factor labels parsed out of Step 1's draft_graph response).
 */
export class JourneyPreconditionError extends Error {
  public readonly failingContract: string;
  constructor(failingContract: string, message: string) {
    super(message);
    this.name = 'JourneyPreconditionError';
    this.failingContract = failingContract;
  }
}

/**
 * Deterministic factor-label fallback, per DL-7 audit §3:
 *   1. Any label containing case-insensitive substring "budget" → use it.
 *   2. Otherwise → first label in the array.
 *   3. Empty array → null + `no_factor_labels` reason (caller fails the
 *      step cleanly via JourneyPreconditionError).
 *
 * Pure function — exposed for unit-test access.
 */
export function selectFactorLabel(
  factorLabels: readonly string[] | undefined,
): { label: string | null; reason: 'budget_match' | 'first_label' | 'no_factor_labels' } {
  if (!factorLabels || factorLabels.length === 0) {
    return { label: null, reason: 'no_factor_labels' };
  }
  const budget = factorLabels.find((l) => l.toLowerCase().includes('budget'));
  if (budget !== undefined) return { label: budget, reason: 'budget_match' };
  return { label: factorLabels[0]!, reason: 'first_label' };
}

/**
 * Read the resolved factor label from Step 1 capture or throw a precondition
 * error. Used inside DL-7 journey `buildPayload` callbacks.
 */
function requireFactorLabel(ctx: JourneyContext): string {
  const label = ctx.step1Capture?.resolvedFactorLabel;
  if (label === null || label === undefined) {
    throw new JourneyPreconditionError(
      'no_factor_label_available',
      'Step 1 did not produce a usable factor label for downstream DL-7 steps.',
    );
  }
  return label;
}

export function mkTurnId(): string {
  return randomUUID();
}

const DECISION_BRIEF =
  'We are a 15-person engineering team weighing three options for scaling ' +
  'delivery over the next six months: hire two senior engineers locally, ' +
  'engage an offshore partner, or introduce tiered pricing to hire more ' +
  'gradually. Decision matters for Q3 roadmap commitments.';

export const CANONICAL_STEPS: readonly JourneyStep[] = [
  {
    name: '1_draft_graph',
    description:
      'POST fresh scenario + decision brief → expect draft_graph response with post-draft chips.',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'frame',
      message: DECISION_BRIEF,
      turn_class: 'frame',
      source: 'composer',
    }),
  },
  {
    name: '2_weakest_option',
    description:
      '"Which option looks weakest?" → 200, response references actual option/factor labels from the draft.',
    depends_on: '1_draft_graph',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'analyse',
      message: 'Which option looks weakest?',
      turn_class: 'decide',
      source: 'composer',
    }),
  },
  {
    name: '3_add_option',
    description:
      '"Add another option" → product-shaped: 200, no BoundaryError, no internal terms. May route to converse/clarify/recoverable validation.',
    depends_on: '1_draft_graph',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'frame',
      message: 'Add another option to this decision.',
      turn_class: 'frame',
      source: 'composer',
    }),
  },
  {
    name: '4_run_analysis',
    description:
      'Emit chip_click payload for Run analysis → 200, PLoT completes, handler fact persisted.',
    depends_on: '1_draft_graph',
    // source: 'chip_click' + chip.action_type carries the UI chip-click
    // dispatch signal per talchain v0.7.0 boundary schema.
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'analyse',
      message: 'Run analysis.',
      turn_class: 'decide',
      source: 'chip_click',
      chip: { action_type: 'run_analysis' },
    }),
  },
  {
    name: '5_explain_leader',
    description:
      '"Why does the leading option win?" → 200, response names leading option, probability, a top driver, a caveat. Exercises analysis fallback on follow-up.',
    depends_on: '4_run_analysis',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'decide',
      message: 'Why does the leading option win?',
      turn_class: 'decide',
      source: 'composer',
    }),
  },
  {
    name: '6_edit_budget',
    description:
      '"Increase the budget factor" → 200, edit proposal or clarifying question. Recoverable validator path is acceptable.',
    depends_on: '1_draft_graph',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'frame',
      message: 'Increase the budget factor.',
      turn_class: 'frame',
      source: 'composer',
    }),
  },
];

// ---------------------------------------------------------------------------
// DL-7 Journey 1A — `dl7-set-factor`
//
// draft → set_factor_value → what-changed → analyse → explain → what-would-flip
//
// Step 2 deliberately drives the existing V5 `set_factor_value` mutation
// handler. This produces a `RecentMutation` entry in the Context Reliability
// path TODAY, before edit_graph DL-7 PR B exists, so Step 3 ("what changed?")
// can be asserted against `recent_changes` deterministically.
// ---------------------------------------------------------------------------

export const SET_FACTOR_STEPS: readonly JourneyStep[] = [
  {
    name: '1_draft_graph',
    description:
      'POST fresh scenario + decision brief → expect draft_graph response with post-draft chips.',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'frame',
      message: DECISION_BRIEF,
      turn_class: 'frame',
      source: 'composer',
    }),
  },
  {
    name: '2_set_factor_value',
    description:
      'Set the resolved factor to 20% — drives the V5 set_factor_value mutation handler so recent_changes populates.',
    depends_on: '1_draft_graph',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'frame',
      message: `Set ${requireFactorLabel(ctx)} to 20%.`,
      turn_class: 'frame',
      source: 'composer',
    }),
  },
  {
    name: '3_what_changed',
    description:
      '"What changed?" → state-query guard answers deterministically from recent_changes.',
    depends_on: '2_set_factor_value',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'frame',
      message: 'What changed?',
      turn_class: 'frame',
      source: 'composer',
    }),
  },
  {
    name: '4_run_analysis',
    description:
      'chip_click run_analysis on the post-edit graph → 200, PLoT completes, handler fact persisted.',
    depends_on: '2_set_factor_value',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'analyse',
      message: 'Run analysis.',
      turn_class: 'decide',
      source: 'chip_click',
      chip: { action_type: 'run_analysis' },
    }),
  },
  {
    name: '5_explain_leader',
    description:
      '"Why does the leading option win?" → 200, references option labels, freshness=fresh.',
    depends_on: '4_run_analysis',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'decide',
      message: 'Why does the leading option win?',
      turn_class: 'decide',
      source: 'composer',
    }),
  },
  {
    name: '6_what_would_flip',
    description:
      '"What would flip this?" → 200, what_would_flip handler with execute precondition.',
    depends_on: '4_run_analysis',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'decide',
      message: 'What would flip this?',
      turn_class: 'decide',
      source: 'composer',
    }),
  },
];

// ---------------------------------------------------------------------------
// DL-7 Journey 1B — `dl7-edit-graph`  (PR-B-gated, optional)
//
// Identical shape to 1A but Step 2 uses generic edit_graph phrasing so the
// request lands in the generic edit_graph dispatcher (not the narrow
// set_factor_value handler). Only enqueued when DL7_PR_B_LANDED === 'true'.
// ---------------------------------------------------------------------------

export const EDIT_GRAPH_STEPS: readonly JourneyStep[] = [
  {
    name: '1_draft_graph',
    description:
      'POST fresh scenario + decision brief → expect draft_graph response with post-draft chips.',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'frame',
      message: DECISION_BRIEF,
      turn_class: 'frame',
      source: 'composer',
    }),
  },
  {
    name: '2_edit_graph_generic',
    description:
      'Generic edit_graph mutation — drives the dispatcher path that PR B annotates with an accepted_edit fact.',
    depends_on: '1_draft_graph',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'frame',
      message: `Edit the model: make ${requireFactorLabel(ctx)} more important.`,
      turn_class: 'frame',
      source: 'composer',
    }),
  },
  {
    name: '3_what_changed',
    description:
      '"What changed?" → recent_changes surfaces the accepted-edit fact (PR B path).',
    depends_on: '2_edit_graph_generic',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'frame',
      message: 'What changed?',
      turn_class: 'frame',
      source: 'composer',
    }),
  },
  {
    name: '4_run_analysis',
    description:
      'chip_click run_analysis on the post-edit graph → 200, PLoT completes.',
    depends_on: '2_edit_graph_generic',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'analyse',
      message: 'Run analysis.',
      turn_class: 'decide',
      source: 'chip_click',
      chip: { action_type: 'run_analysis' },
    }),
  },
  {
    name: '5_explain_leader',
    description:
      '"Why does the leading option win?" → 200, references option labels, freshness=fresh.',
    depends_on: '4_run_analysis',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'decide',
      message: 'Why does the leading option win?',
      turn_class: 'decide',
      source: 'composer',
    }),
  },
  {
    name: '6_what_would_flip',
    description:
      '"What would flip this?" → 200, what_would_flip handler with execute precondition.',
    depends_on: '4_run_analysis',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'decide',
      message: 'What would flip this?',
      turn_class: 'decide',
      source: 'composer',
    }),
  },
];

// ---------------------------------------------------------------------------
// DL-7 Journey 1C — `dl7-staleness`
//
// draft → analyse → edit_graph_generic → explain
//
// Reorders the edit AFTER analysis, so the explain handler observes
// freshness=stale and surfaces the staleness caveat / rerun chip.
// Step 3 was switched from `set_factor_value` to the generic
// `edit_graph` dispatcher in Phase 2.6.4 — see the inline comment on
// the Step 3 message below for the rationale. Locks in DL-7
// acceptance criterion 5.
// ---------------------------------------------------------------------------

export const STALENESS_STEPS: readonly JourneyStep[] = [
  {
    name: '1_draft_graph',
    description:
      'POST fresh scenario + decision brief → expect draft_graph response with post-draft chips.',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'frame',
      message: DECISION_BRIEF,
      turn_class: 'frame',
      source: 'composer',
    }),
  },
  {
    name: '2_run_analysis',
    description:
      'chip_click run_analysis on fresh draft graph → 200, PLoT completes, handler fact persisted.',
    depends_on: '1_draft_graph',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'analyse',
      message: 'Run analysis.',
      turn_class: 'decide',
      source: 'chip_click',
      chip: { action_type: 'run_analysis' },
    }),
  },
  {
    // Phase 2.6.4 (post-Codex feedback) — switched from `set_factor_value`
    // to `edit_graph_generic`. The set_factor_value path is label-fragile:
    // when the deterministic value-update gate can't resolve the factor
    // unambiguously (which happens when the LLM-drafted graph uses a
    // factor name the gate doesn't recognise), V5 returns a clarification
    // request and no mutation happens. The edit_graph path is the proven
    // determinstic mutation route per the dl7-edit-graph journey, so
    // using it here makes the staleness loop reliable. The strict-mode
    // `assertEditGraphGeneric` (clarification-back + mutation-ack checks)
    // fails Step 3 attributively if the mutation still doesn't fire,
    // so Step 4 cascade-skips with a clear cause.
    name: '3_edit_graph_generic',
    description:
      'Mutate the graph AFTER analysis via edit_graph (the proven path) — should set freshness=stale on subsequent explain turns.',
    depends_on: '2_run_analysis',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'frame',
      message: `Edit the model: make ${requireFactorLabel(ctx)} more important.`,
      turn_class: 'frame',
      source: 'composer',
    }),
  },
  {
    name: '4_explain_leader_stale',
    description:
      '"Why does the leading option win?" — explain after a post-analysis edit. Expect stale caveat or rerun chip.',
    depends_on: '3_edit_graph_generic',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'decide',
      message: 'Why does the leading option win?',
      turn_class: 'decide',
      source: 'composer',
    }),
  },
];

// ---------------------------------------------------------------------------
// Branch A canonical journey — `branch-a-canonical`
//
// The full proposal loop the Branch A product lane (PR #236,
// `feat/v5-p0-2-continuity`, merged to staging as `b8d5bcce`) unlocks:
//
//   draft → run_analysis → what_would_flip → [Test X at N proposal] →
//   "make that update" → set_factor_value applied → DB read-back →
//   stale → what_changed
//
// PR #236 is live on staging, so steps 4-8 are ENFORCED by default
// (`requires_branch_a`); `BRANCH_A_DISABLE=true` re-gates them to pending
// as an emergency rollback.
//
// Per #236: on a `what_would_flip` turn the orchestrator emits a
// provenance-safe "Test X at N" `set_factor_value` proposal from
// `enrichment.flip_thresholds[]` (skip-not-round, exact WHOLE user-scale
// numeric — `compose/format-factor-value.ts` skips non-integers). The
// proposal is resumed by a bare confirm — "do it" (SHORT_CONFIRM) or
// "make that update" (PROPOSAL_CONFIRM, added by #236 Option A).
//
// `BRANCH_A_BRIEF` is this journey's OWN brief (a copy of the shared
// DECISION_BRIEF), kept separate so it can be iterated to find a
// flip-capable scenario (a non-null flip that renders as a whole
// user-scale value) WITHOUT touching the briefs of existing journeys.
// ---------------------------------------------------------------------------

// FLIP-CAPABLE SCENARIO SEARCH — historical: 5/5 NL-brief attempts all
// returned `flip_value: null` ("no_effect_within_bounds") (2026-06-06,
// staging b8d5bcc; team-scaling / subscription-price / launch-probability /
// supplier-knife-edge / buy-vs-rent). The journey needs a `what_would_flip`
// turn whose enrichment carries a non-null `flip_value` that #236's producer
// renders as a WHOLE user-scale value, else `buildFlipProposalEmit` returns
// `no_proposal` and no "Test X at N" chip is emitted.
//
// ROOT CAUSE (superseded — task_f6573ff1, read-only, ACCEPTED): the universal
// null is NOT "robust decisions" and NOT a CEE/harness bug. #236 reads the
// authoritative field `enrichment.flip_thresholds[].flip_value`. The null was
// PREDOMINANTLY a PLoT flip-threshold SELECTION inversion (it probed factors
// every option overrides — which structurally can't move a background value,
// max_probe_delta=0 — while omitting the non-overridden material-elasticity
// background factors that are the real flip candidates), plus a residual
// valued-factor probe-mechanics subset. The selection inversion was found and
// fixed on the PLoT side; the residual probe-mechanics belongs to the PLoT
// workstream, NOT this harness. Do NOT re-run that discriminator here.
//
// FOLLOW-UP (separate, PLoT-owned): validate a flip-capable brief once PLoT
// emits a usable non-null flip. Target fixture (per review) = a `delivery_gap`
// near-tie that yields a flip of ~6.055 story_points rendering as a whole
// `6.1 story points` proposal — which must then enforce the FULL chain:
// proposal chip -> apply ("make that update") -> set_factor_value DB
// read-back -> explain-leader-stale -> what-changed. The harness needs NO
// change for this: the pending-scenario split + flip-candidate auto-detection
// flip steps 4-8 to enforced the moment a non-null flip appears (and flag that
// the pending scenario should be removed). The whole-value assertion in
// `assertFlipProposalPresent` was NOT weakened. See the run report / evidence
// pack. `delivery_gap`/`6.055` do not exist in this repo today — they name the
// PLoT-side target, not an existing harness fixture.
const BRANCH_A_BRIEF =
  'We are a 15-person engineering team weighing three options for scaling ' +
  'delivery over the next six months: hire two senior engineers locally, ' +
  'engage an offshore partner, or introduce tiered pricing to hire more ' +
  'gradually. Decision matters for Q3 roadmap commitments.';

/** Minimal placeholder payload for steps the harness never POSTs
 *  (assert-only and DB read-back). buildPayload is required by the
 *  interface but the loop branches before calling it for these kinds. */
function nonDispatchPayload(ctx: JourneyContext, message: string): TurnPayload {
  return {
    kind: 'message',
    turn_id: mkTurnId(),
    scenario_id: ctx.scenario_id,
    stage: 'decide',
    message,
    turn_class: 'decide',
    source: 'composer',
  };
}

export const BRANCH_A_CANONICAL_STEPS: readonly JourneyStep[] = [
  {
    name: '1_draft_graph',
    description:
      'POST fresh scenario + Branch A brief → expect draft_graph response with post-draft chips.',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'frame',
      message: BRANCH_A_BRIEF,
      turn_class: 'frame',
      source: 'composer',
    }),
  },
  {
    name: '2_run_analysis',
    description:
      'chip_click run_analysis on the fresh draft graph → 200, PLoT completes, analysis_ready=ready.',
    depends_on: '1_draft_graph',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'analyse',
      message: 'Run analysis.',
      turn_class: 'decide',
      source: 'chip_click',
      chip: { action_type: 'run_analysis' },
    }),
  },
  {
    name: '3_what_would_flip',
    description:
      'chip_click what_would_flip — resumes the post-run_analysis what_would_flip pending action, ' +
      'running the handler via the execute-intent path #236 emits the "Test X at N" proposal on ' +
      '(asserted at step 4). NOTE: a composer flip question is intercepted by the deterministic ' +
      'post-analysis advice gate (llm_calls=0) and never reaches the emit block, so chip_click is ' +
      'required. The proposal only emits when PLoT returns a non-null flip that renders whole.',
    depends_on: '2_run_analysis',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'decide',
      message: 'What could change the result?',
      turn_class: 'decide',
      source: 'chip_click',
      chip: { action_type: 'what_would_flip' },
    }),
  },
  {
    // assert-only: inspects the captured step-3 response for the proposal
    // chip; makes no HTTP call. Pending #236 (the chip does not exist yet).
    name: '4_flip_proposal_present',
    description:
      'assert the what_would_flip response carried a "Test X at N" set_factor_value ' +
      'proposal chip whose N is an exact whole user-scale value. ' +
      'Pending-scenario split (BRANCH_A_PENDING_SCENARIO, default on): if the chip is ' +
      'absent (branch_a_flip_proposal_chip_absent) AND a --db-readback confirms the ' +
      "scenario's most-recent run_analysis fact carried flip_thresholds[].flip_value ALL " +
      'null, this step is a pending-scenario SKIP (staging produced no live flip-capable ' +
      'result — not a regression; emit reachability is enforced deterministically by ' +
      'branch-a-emit-through-executor.test.ts) and steps 5-8 cascade as pending-scenario. ' +
      'A chip-absent failure where the DB read-back shows a NON-null flip_value (emit ' +
      'regression), an inconclusive read-back (no_facts/empty/error), no --db-readback, ' +
      'or any other step-4 failure (no value / non-whole value) stays RED.',
    depends_on: '3_what_would_flip',
    requires_branch_a: true,
    assert_only: true,
    buildPayload: (ctx) => nonDispatchPayload(ctx, '(assert-only: flip proposal present)'),
  },
  {
    name: '5_accept_proposal',
    description:
      'User confirms with "make that update" (the #236 PROPOSAL_CONFIRM variant; "do it" via ' +
      'SHORT_CONFIRM is the equivalent). The most-recent-wins resume applies set_factor_value. ' +
      'Assert a mutation acknowledgement / "Applying:" echo (no clarification-back).',
    depends_on: '4_flip_proposal_present',
    requires_branch_a: true,
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'decide',
      message: 'make that update',
      turn_class: 'decide',
      source: 'composer',
    }),
  },
  {
    // DB read-back: no turn POST. Skipped unless --db-readback.
    name: '6_db_readback',
    description:
      'DB read-back: prove a set_factor_value fact persisted (status=applied, ' +
      'target is a real factor, before≠after, after value = proposed N). Requires --db-readback.',
    depends_on: '5_accept_proposal',
    requires_branch_a: true,
    db_readback: true,
    buildPayload: (ctx) => nonDispatchPayload(ctx, '(db read-back: set_factor_value persisted)'),
  },
  {
    name: '7_explain_leader_stale',
    description:
      '"Why does the leading option win?" after the mutation → expect a staleness ' +
      'caveat or a rerun chip (the applied change invalidated the prior analysis).',
    depends_on: '5_accept_proposal',
    requires_branch_a: true,
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'decide',
      message: 'Why does the leading option win?',
      turn_class: 'decide',
      source: 'composer',
    }),
  },
  {
    name: '8_what_changed',
    description:
      '"What changed?" → the deterministic state-query answer reports the accepted ' +
      'set_factor_value change (references the factor, no internal terms).',
    depends_on: '5_accept_proposal',
    requires_branch_a: true,
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'frame',
      message: 'What changed?',
      turn_class: 'frame',
      source: 'composer',
    }),
  },
];

// ---------------------------------------------------------------------------
// Journey registry — keys are the values accepted by the `--journey` CLI
// flag. The default is `canonical` so existing invocations stay
// backwards-compatible. The harness skips `dl7-edit-graph` when
// `DL7_PR_B_LANDED !== 'true'` (gating logic lives in index.ts).
// ---------------------------------------------------------------------------

export type JourneyId =
  | 'canonical'
  | 'dl7-set-factor'
  | 'dl7-edit-graph'
  | 'dl7-staleness'
  | 'branch-a-canonical';

export const JOURNEY_IDS: readonly JourneyId[] = [
  'canonical',
  'dl7-set-factor',
  'dl7-edit-graph',
  'dl7-staleness',
  'branch-a-canonical',
];

export const JOURNEY_REGISTRY: Readonly<Record<JourneyId, readonly JourneyStep[]>> = {
  canonical: CANONICAL_STEPS,
  'dl7-set-factor': SET_FACTOR_STEPS,
  'dl7-edit-graph': EDIT_GRAPH_STEPS,
  'dl7-staleness': STALENESS_STEPS,
  'branch-a-canonical': BRANCH_A_CANONICAL_STEPS,
};

/**
 * Journeys whose execution is gated until edit_graph DL-7 PR B is
 * accepted. PR B is now live on staging (PR #159 docs merge pending),
 * so this set is empty by default — `dl7-edit-graph` runs as a core
 * V5 path. The env flag `DL7_PR_B_DISABLE` (note: inverted from the
 * pre-merge `DL7_PR_B_LANDED`) is preserved as an emergency disable
 * switch: setting it to `true` re-gates the journey if PR B regresses
 * on staging. Most operators should never need it.
 */
export const PR_B_GATED_JOURNEYS: ReadonlySet<JourneyId> = new Set();
