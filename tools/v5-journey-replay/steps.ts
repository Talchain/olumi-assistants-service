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
 */

import { randomUUID } from 'node:crypto';

import type { TurnPayload } from './client.js';

export interface JourneyStep {
  readonly name: string;
  readonly description: string;
  readonly buildPayload: (ctx: JourneyContext) => TurnPayload;
  /** If true, step only makes sense after a prior step has completed. */
  readonly depends_on?: string;
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

/**
 * Read the first option label parsed at Step 1, or throw a precondition
 * error. Used by the P0 `edit_option_intervention` step so the NL edit
 * targets a REAL drafted option (existing pre-add) rather than improvising
 * a label the graph may not contain.
 */
function requireFirstOptionLabel(ctx: JourneyContext): string {
  const labels = ctx.step1Capture?.optionLabels;
  if (!labels || labels.length === 0) {
    throw new JourneyPreconditionError(
      'no_option_label_available',
      'Step 1 did not produce a usable option label for the edit-option-intervention step.',
    );
  }
  return labels[0]!;
}

export function mkTurnId(): string {
  return randomUUID();
}

const DECISION_BRIEF =
  'We are a 15-person engineering team weighing three options for scaling ' +
  'delivery over the next six months: hire two senior engineers locally, ' +
  'engage an offshore partner, or introduce tiered pricing to hire more ' +
  'gradually. Decision matters for Q3 roadmap commitments.';

// ---------------------------------------------------------------------------
// V5 Golden Journey benchmark prep — P0 fixtures (NL message payloads).
//
// CAPPABLE_ADD carries a £ value that derives a model value via the canonical
// normaliser (value = raw/cap) → #278 Gate 1 (encode → rerun 200).
// UNCAPPABLE_ADD has no cappable value → #278 Gate 3 (safe defer, graph
// unchanged). EDIT_OPTION_INTERVENTION targets an EXISTING option (#278 Gate
// 2 / containment). STALE_TRIGGER_EDIT is the proven edit_graph mutation
// (reused from DL-7) that reliably drives freshness=stale for the flip-stale
// leg.
// ---------------------------------------------------------------------------

/** #278 Gate 1 — cappable add-option (encode → rerun 200). */
const CAPPABLE_ADD_MESSAGE = 'Add an in-house delivery option costing £120,000 per year.';

/** #278 Gate 3 — unencodable add-option (must safe-defer, graph unchanged). */
const UNCAPPABLE_ADD_MESSAGE = 'Add an In-House Capacity option.';

/** #278 Gate 2 — edit an existing option's intervention (containment-pass). */
function editOptionInterventionMessage(ctx: JourneyContext): string {
  return `Change the "${requireFirstOptionLabel(ctx)}" option's annual cost to £135,000.`;
}

/** Reliable post-analysis mutation to drive freshness=stale (flip-stale leg). */
function staleTriggerEditMessage(ctx: JourneyContext): string {
  return `Edit the model: make ${requireFactorLabel(ctx)} more important.`;
}

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

// ===========================================================================
// V5 Golden Journey benchmark prep — P0 journeys.
//
// Reusable step builders (kept inline per the existing file's convention of
// repeating the draft step). Step NAMES use unique suffixes that do NOT
// collide with any existing journey suffix, so `pickAssertion` routes them
// additively without changing canonical / DL-7 behaviour.
// ===========================================================================

function draftStep(): JourneyStep {
  return {
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
  };
}

function runAnalysisChip(name: string, dependsOn: string, description: string): JourneyStep {
  return {
    name,
    description,
    depends_on: dependsOn,
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
  };
}

function whatWouldFlipChipStep(name: string, dependsOn: string, description: string): JourneyStep {
  // The exact #277 failing UI envelope: chip_click + action_type
  // what_would_flip + turn_class frame.
  return {
    name,
    description,
    depends_on: dependsOn,
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'decide',
      message: 'What would flip this?',
      turn_class: 'frame',
      source: 'chip_click',
      chip: { action_type: 'what_would_flip' },
    }),
  };
}

// P0 Partial spine baseline — draft → run → explain → add → rerun → edit-option
// → what-changed → reload-rerun. Flip legs EXCLUDED (#277 not deployed).
export const P0_PARTIAL_SPINE_STEPS: readonly JourneyStep[] = [
  draftStep(),
  runAnalysisChip(
    '2_run_analysis_dgai',
    '1_draft_graph',
    'chip_click run_analysis on fresh draft → 200, analysis_ready, DGAI analysis_result block populated.',
  ),
  {
    name: '3_explain_leader',
    description: '"Why does the leading option win?" → 200, names leading option + driver + caveat.',
    depends_on: '2_run_analysis_dgai',
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
    name: '4_add_option_encode',
    description: '#278 Gate 1 — add a cappable option → encode (no defer); rerun proves it.',
    depends_on: '1_draft_graph',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'frame',
      message: CAPPABLE_ADD_MESSAGE,
      turn_class: 'frame',
      source: 'composer',
    }),
  },
  runAnalysisChip(
    '5_rerun_after_add',
    '4_add_option_encode',
    '#278 Gate 1 — rerun analysis after the add → 200 (no options_not_configured), DGAI populated.',
  ),
  {
    name: '6_edit_option_intervention',
    description: '#278 Gate 2 — edit an existing option\'s intervention (CONTAINMENT-PASS).',
    depends_on: '5_rerun_after_add',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'frame',
      message: editOptionInterventionMessage(ctx),
      turn_class: 'frame',
      source: 'composer',
    }),
  },
  {
    name: '7_what_changed',
    description: '"What changed?" → recent_changes surfaced in plain product terms, no leak.',
    depends_on: '6_edit_option_intervention',
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
  runAnalysisChip(
    '8_persist_reload_rerun',
    '6_edit_option_intervention',
    'persist → reload → run_analysis (no client graph echo) → 200, DGAI populated.',
  ),
];

// P0 Full golden baseline — partial spine + what_would_flip fresh chip-click +
// stale follow-up. Runs only after #277 is merged + deployed.
export const P0_FULL_GOLDEN_STEPS: readonly JourneyStep[] = [
  draftStep(),
  runAnalysisChip(
    '2_run_analysis_dgai',
    '1_draft_graph',
    'chip_click run_analysis on fresh draft → 200, analysis_ready, DGAI populated.',
  ),
  {
    name: '3_explain_leader',
    description: '"Why does the leading option win?" → 200, names leading option + driver + caveat.',
    depends_on: '2_run_analysis_dgai',
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
  whatWouldFlipChipStep(
    '4_what_would_flip_chip',
    '2_run_analysis_dgai',
    '#277 — fresh what_would_flip chip-click → deterministic dispatch, honest copy, non-empty blocks/actions.',
  ),
  {
    name: '5_add_option_encode',
    description: '#278 Gate 1 — add a cappable option → encode (no defer); rerun proves it.',
    depends_on: '1_draft_graph',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'frame',
      message: CAPPABLE_ADD_MESSAGE,
      turn_class: 'frame',
      source: 'composer',
    }),
  },
  runAnalysisChip(
    '6_rerun_after_add',
    '5_add_option_encode',
    '#278 Gate 1 — rerun analysis after the add → 200 (no options_not_configured), DGAI populated.',
  ),
  {
    name: '7_edit_option_intervention',
    description: '#278 Gate 2 — edit an existing option\'s intervention (CONTAINMENT-PASS).',
    depends_on: '6_rerun_after_add',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'frame',
      message: editOptionInterventionMessage(ctx),
      turn_class: 'frame',
      source: 'composer',
    }),
  },
  {
    name: '8_what_changed',
    description: '"What changed?" → recent_changes surfaced in plain product terms, no leak.',
    depends_on: '7_edit_option_intervention',
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
  runAnalysisChip(
    '9_persist_reload_rerun',
    '7_edit_option_intervention',
    'persist → reload → run_analysis (no client graph echo) → 200, DGAI populated.',
  ),
  {
    name: '10_stale_trigger_edit',
    description: 'Post-analysis edit_graph mutation → drives freshness=stale for the flip-stale leg.',
    depends_on: '9_persist_reload_rerun',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'frame',
      message: staleTriggerEditMessage(ctx),
      turn_class: 'frame',
      source: 'composer',
    }),
  },
  whatWouldFlipChipStep(
    '11_what_would_flip_stale',
    '10_stale_trigger_edit',
    '#277 — stale what_would_flip follow-up → steers to RERUN, no executable stale flip chip.',
  ),
];

// Gate-probe: #278 acceptance (Gate 1 add→rerun 200, Gate 3 unencodable→defer).
// Gate 4a/b/c (top-level-raw-uncapped / missing-factor / unit-mismatch) are
// not reachable via NL over HTTP — they are unit-test proven (see
// src/orchestrator/tools/__tests__/encode-option-interventions.test.ts) and
// referenced in the runbook.
export const GATE_278_STEPS: readonly JourneyStep[] = [
  draftStep(),
  {
    name: '2_add_option_encode',
    description: '#278 Gate 1 — add a cappable option → encode (no defer).',
    depends_on: '1_draft_graph',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'frame',
      message: CAPPABLE_ADD_MESSAGE,
      turn_class: 'frame',
      source: 'composer',
    }),
  },
  runAnalysisChip(
    '3_rerun_after_add',
    '2_add_option_encode',
    '#278 Gate 1 — rerun analysis after the cappable add → 200, no options_not_configured.',
  ),
  {
    name: '4_add_option_defer',
    description: '#278 Gate 3 — add an unencodable option → safe defer, graph unchanged, no false success.',
    depends_on: '1_draft_graph',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'frame',
      message: UNCAPPABLE_ADD_MESSAGE,
      turn_class: 'frame',
      source: 'composer',
    }),
  },
];

// Gate-probe: #277 live acceptance (fresh flip chip-click + stale follow-up).
export const GATE_277_STEPS: readonly JourneyStep[] = [
  draftStep(),
  runAnalysisChip(
    '2_run_analysis_dgai',
    '1_draft_graph',
    'chip_click run_analysis on fresh draft → 200, analysis_ready, DGAI populated.',
  ),
  whatWouldFlipChipStep(
    '3_what_would_flip_chip',
    '2_run_analysis_dgai',
    '#277 — fresh what_would_flip chip-click → deterministic dispatch, honest copy, non-empty blocks/actions, enrichment leak-clean.',
  ),
  {
    name: '4_stale_trigger_edit',
    description: 'Post-analysis edit_graph mutation → drives freshness=stale for the flip-stale leg.',
    depends_on: '2_run_analysis_dgai',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'frame',
      message: staleTriggerEditMessage(ctx),
      turn_class: 'frame',
      source: 'composer',
    }),
  },
  whatWouldFlipChipStep(
    '5_what_would_flip_stale',
    '4_stale_trigger_edit',
    '#277 — stale what_would_flip follow-up → steers to RERUN, no executable stale flip chip.',
  ),
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
  | 'gate-278'
  | 'gate-277'
  | 'p0-partial-spine'
  | 'p0-full-golden';

export const JOURNEY_IDS: readonly JourneyId[] = [
  'canonical',
  'dl7-set-factor',
  'dl7-edit-graph',
  'dl7-staleness',
  'gate-278',
  'gate-277',
  'p0-partial-spine',
  'p0-full-golden',
];

export const JOURNEY_REGISTRY: Readonly<Record<JourneyId, readonly JourneyStep[]>> = {
  canonical: CANONICAL_STEPS,
  'dl7-set-factor': SET_FACTOR_STEPS,
  'dl7-edit-graph': EDIT_GRAPH_STEPS,
  'dl7-staleness': STALENESS_STEPS,
  'gate-278': GATE_278_STEPS,
  'gate-277': GATE_277_STEPS,
  'p0-partial-spine': P0_PARTIAL_SPINE_STEPS,
  'p0-full-golden': P0_FULL_GOLDEN_STEPS,
};

/**
 * Journeys whose flip legs require #277 to be live. Used by the evidence
 * writer to render the "what_would_flip EXCLUDED" banner on the partial
 * spine and to enable the public-enrichment leak scan on the flip modes.
 */
export const FLIP_MODE_JOURNEYS: ReadonlySet<JourneyId> = new Set<JourneyId>([
  'gate-277',
  'p0-full-golden',
]);

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
