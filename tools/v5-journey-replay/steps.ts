/**
 * V5 alpha hardening Phase 3 — canonical journey steps.
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
 * typed fatal. Covered by the handler-level unit test at
 * src/orchestrator-v5/tools/handlers/__tests__/run-analysis-permissive-status.test.ts
 * and cannot be exercised through the HTTP boundary without injecting a
 * mock PLoT response.
 *
 * Wave 1–3 extension: steps 1a (coaching + provenance via /assist/v1),
 * 7 (stale explanation + rerun chip), 8 (rerun via captured chip), and
 * 9 (what-would-flip) layer on top of the original six. The new
 * `endpoint` discriminator on `JourneyStep` selects between
 * /orchestrate/v2/turn (default) and /assist/v1/draft-graph.
 */

import { randomUUID } from 'node:crypto';

import type { TurnPayload } from './client.js';
import type { AssistDraftGraphPayload } from './assist-client.js';

/**
 * Tagged request descriptor returned by `JourneyStep.buildPayload`. The
 * runner inspects `kind` and dispatches to the right transport.
 */
export type StepRequest =
  | { readonly kind: 'turn'; readonly payload: TurnPayload }
  | { readonly kind: 'assist_draft_graph'; readonly payload: AssistDraftGraphPayload };

export interface JourneyStep {
  readonly name: string;
  readonly description: string;
  readonly buildPayload: (ctx: JourneyContext) => StepRequest;
  /** If set, step only makes sense after the named step has passed. */
  readonly depends_on?: string;
}

/**
 * Mutable journey context. The runner owns the only writable handle and
 * patches in captured outputs after each step (e.g. step-7 captures the
 * stale rerun chip into `staleRerunChip` for step 8 to replay). Steps and
 * assertions never mutate the context directly — assertions communicate
 * via their `captured` back-channel and the runner copies values across.
 */
export interface JourneyContext {
  readonly scenario_id: string;
  readonly turn_counter: { value: number };
  /** Option labels parsed from step 1's draft-graph block. Populated by the runner. */
  step1OptionLabels?: readonly string[];
  /**
   * Factor labels parsed from step 1's draft-graph block (kind='factor'
   * nodes). Used by step 6 to construct a deterministic edit message
   * naming the first available factor by its EXACT label, so the
   * orchestrator's "did you mean?" clarifier doesn't intercept the
   * edit. Captured priority: prefer a factor whose label or id contains
   * 'cost' or 'budget' (most natural for "increase the budget" intent),
   * fall back to the first factor available, fall back to a generic
   * vague message if no factors were parsed (in which case the step-6
   * mutation gate will fire and steps 7-9 will skipped_dependency).
   */
  step1FactorLabels?: readonly string[];
  /** Rerun chip captured from step 7. Read by step 8 to replay the click. */
  staleRerunChip?: {
    readonly id: string;
    readonly label: string;
    readonly message: string;
    readonly action_type: string;
  };
  /**
   * Whether step 6 produced a confirmed graph mutation. Set by the runner
   * after step 6's response is observed. If false, the brief's "edit
   * budget" message routed to a clarification (not an actual edit), so
   * staleness expectations on step 7 are invalid — the runner classifies
   * steps 7-9 as `skipped_dependency` rather than asserting staleness on
   * an unmutated graph. Capture criteria: any of (a) graph_patch block,
   * (b) graph_hash change vs step-1, (c) `analysis_ready.computed_at`
   * stamp moves with non-null `staleness_reason`.
   */
  step6GraphMutated?: boolean;
  /** Diagnostic — recorded for the evidence pack. */
  step6MutationEvidence?: string;
}

export function mkTurnId(): string {
  return randomUUID();
}

const DECISION_BRIEF =
  'We are a 15-person engineering team weighing three options for scaling ' +
  'delivery over the next six months: hire two senior engineers locally, ' +
  'engage an offshore partner, or introduce tiered pricing to hire more ' +
  'gradually. Decision matters for Q3 roadmap commitments.';

function turnRequest(payload: TurnPayload): StepRequest {
  return { kind: 'turn', payload };
}

export const CANONICAL_STEPS: readonly JourneyStep[] = [
  {
    name: '1_draft_graph',
    description:
      'POST fresh scenario + decision brief → expect draft_graph response with post-draft chips.',
    buildPayload: (ctx) =>
      turnRequest({
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
    name: '1a_assist_draft_graph',
    description:
      'POST same brief to /assist/v1/draft-graph → assert coaching shape + per-node/edge provenance enums.',
    depends_on: '1_draft_graph',
    buildPayload: () => ({
      kind: 'assist_draft_graph',
      payload: { brief: DECISION_BRIEF },
    }),
  },
  {
    name: '2_weakest_option',
    description:
      '"Which option looks weakest?" → 200, response references actual option/factor labels from the draft.',
    depends_on: '1_draft_graph',
    buildPayload: (ctx) =>
      turnRequest({
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
    buildPayload: (ctx) =>
      turnRequest({
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
    buildPayload: (ctx) =>
      turnRequest({
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
      '"Why does the leading option win?" → 200, response names leading option, probability, a top driver, a caveat. Exercises analysis fallback on follow-up. Recovery + retry on LLM_TIMEOUT/LLM_UNAVAILABLE.',
    depends_on: '4_run_analysis',
    buildPayload: (ctx) =>
      turnRequest({
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
      'Deterministic edit using a factor label parsed from step 1 (e.g. "Set the Hiring and Staffing Cost factor to 0.7"). Falls back to a generic message if no factors were parsed; the step-6 mutation gate then skips steps 7-9 with skipped_dependency.',
    depends_on: '1_draft_graph',
    buildPayload: (ctx) => {
      // Phase 1 of the staleness-after-edit fix brief: replace the
      // non-deterministic "Increase the budget factor" message with a
      // deterministic edit naming the EXACT factor label parsed from
      // step 1's draft graph. This bypasses the "did you mean?"
      // clarifier and produces a real graph mutation, which is required
      // for steps 7-9's staleness assertions to be meaningful.
      const factors = ctx.step1FactorLabels ?? [];
      // Prefer a factor whose label hints at cost / budget / price /
      // hiring (the original brief intent — "increase the budget"). Fall
      // back to the first factor we have. The hinting list is broad so
      // we tolerate variations like "Hiring and Staffing Cost",
      // "Incremental Hiring Cost", "Hiring Cost", etc.
      const HINTS = /(cost|budget|price|hiring|staffing|spend|invest)/i;
      const targetLabel =
        factors.find((l) => HINTS.test(l)) ?? factors[0] ?? null;
      const message = targetLabel
        ? `Set the ${targetLabel} factor to 0.7.`
        : 'Increase the budget factor.';
      return turnRequest({
        kind: 'message',
        turn_id: mkTurnId(),
        scenario_id: ctx.scenario_id,
        stage: 'frame',
        message,
        turn_class: 'frame',
        source: 'composer',
      });
    },
  },
  {
    name: '7_stale_explanation',
    description:
      'Post-edit explanation question → analysis is now stale. Assert canonical staleness prefix and exactly one rerun chip with action_type=run_analysis.',
    depends_on: '6_edit_budget',
    buildPayload: (ctx) =>
      turnRequest({
        kind: 'message',
        turn_id: mkTurnId(),
        scenario_id: ctx.scenario_id,
        stage: 'decide',
        message: 'Which option is currently leading?',
        turn_class: 'decide',
        source: 'composer',
      }),
  },
  {
    name: '8_rerun_via_chip',
    description:
      "Click step 7's captured rerun chip — exact message + action_type=run_analysis. Assert fresh analysis (no staleness prefix) or recovery shape.",
    depends_on: '7_stale_explanation',
    // chip-click payload mirrors src/orchestrator/route-v2.ts:466–473 — keep
    // in sync if the dispatch contract changes.
    buildPayload: (ctx) => {
      const chip = ctx.staleRerunChip;
      if (!chip) {
        throw new Error(
          'step 8 buildPayload called without ctx.staleRerunChip — did step 7 fail to capture the rerun chip?',
        );
      }
      return turnRequest({
        kind: 'message',
        turn_id: mkTurnId(),
        scenario_id: ctx.scenario_id,
        stage: 'analyse',
        message: chip.message,
        turn_class: 'decide',
        source: 'chip_click',
        chip: { action_type: 'run_analysis' },
      });
    },
  },
  {
    name: '9_what_would_flip',
    description:
      '"What would need to change for the runner-up to perform best?" → references factors / options by label, substantive narrative, no entity-id leaks.',
    depends_on: '8_rerun_via_chip',
    buildPayload: (ctx) =>
      turnRequest({
        kind: 'message',
        turn_id: mkTurnId(),
        scenario_id: ctx.scenario_id,
        stage: 'decide',
        message: 'What would need to change for the runner-up to perform best?',
        turn_class: 'decide',
        source: 'composer',
      }),
  },
];
