/**
 * Replacement conversation layer — shaping the turn into what the route expects.
 *
 * Needed whichever way the egress question lands, which is why it exists
 * before that answer does: both candidate branches have to produce a
 * `TurnExecutorRunResult`-shaped object, and the fields that decide the HTTP
 * status and the suppression layers are the same either way.
 *
 * THE THREE FIELDS THAT SILENTLY CHANGE BEHAVIOUR
 * -----------------------------------------------
 * Derived at `3f238b11`, and every one of them fails in the dangerous
 * direction if left to a default:
 *
 * · `telemetry.commit_performed` is read with a STRICT `=== false`. Omit it
 *   and the route ships a 200 for a turn that never persisted. So it is
 *   required here, with no default.
 * · `telemetry.failure_type` decides 409 vs 500 when the commit failed
 *   (`'GRAPH_DIVERGED'` → 409). `false` plus a null reason silently becomes
 *   INTERNAL_ERROR, which loses the recovery signal the client needs.
 * · `mayNameLeadingOptionProvenance === 'fail_closed_unavailable'` makes the
 *   egress wipe text, blocks, chips and insights together.
 *
 * WHY THE CLAIM PERMISSION IS HONEST HERE RATHER THAN OPTIMISTIC
 * --------------------------------------------------------------
 * In the retired path the permission is a verdict computed over a stored
 * analysis fact, because prose could name a leader from anywhere. In this
 * layer the model's ONLY route to a figure is `read_results`, which reports
 * what the analysis actually contains and says plainly when nothing has run.
 * So the permission tracks a simpler fact: does an analysis exist for this
 * turn to have read?
 *
 * ⚠ THE LIMIT OF THAT ARGUMENT, STATED RATHER THAN IMPLIED. It rests on
 * `read_results` being the only source of a figure, which is a property of
 * the tool set this layer assembles — not something enforced by the type
 * system. A future tool that returns a number without that discipline breaks
 * it silently. That is a review obligation on every new read tool, and it is
 * the reason `AgentTool.kind` exists at all.
 */

import type { OlumiResponse } from '@talchain/schemas/boundary';
import type { MayNameLeadingOptionProvenance } from '../context/claim-safety-read.js';
import type { ReplacementEntryResult } from './turn-entry.js';

export interface ShapeRunResultInput {
  readonly turn: ReplacementEntryResult;
  readonly stage: OlumiResponse['stage_indicator'];
  /**
   * Did the session turn persist? Required, never defaulted: the route reads
   * `=== false`, so an omission ships a success for an unsaved turn.
   */
  readonly commitPerformed: boolean;
  /** Set ONLY when `commitPerformed` is false. `'GRAPH_DIVERGED'` yields 409. */
  readonly failureType?: string | null;
  /** True when an analysis exists for this scenario — not whether the model
   *  read it. Absence is `no_analysis_exists`, which is the honest state and
   *  is NOT one of the wiping provenances. */
  readonly analysisExists: boolean;
  readonly wallClockMs: number;
}

export interface ShapedRunResult {
  readonly response: OlumiResponse;
  readonly mayNameLeadingOption: boolean;
  readonly mayNameLeadingOptionProvenance: MayNameLeadingOptionProvenance;
  readonly telemetry: {
    readonly stages_completed: string[];
    readonly response_emitted: true;
    readonly llm_calls_used: number;
    readonly commit_performed: boolean;
    readonly failure_type: string | null;
    readonly wall_clock_ms: number;
    readonly turn_class: 'direct_answer';
    readonly intent_class: null;
    readonly coaching_mode: null;
    readonly validation_error_code: null;
  };
}

/**
 * The stages this controller reports.
 *
 * Named for what happened rather than borrowed from the retired pipeline:
 * a log line claiming a stage that never ran is the same defect as a status
 * cell nobody re-derived, one layer down.
 */
export function stagesFor(turn: ReplacementEntryResult): string[] {
  const stages = ['replacement_controller'];
  if (turn.mustReconcile.length > 0) stages.push('reconciliation_required');
  if (turn.toolsCalled.length > 0) stages.push('tools_used');
  if (turn.applied.length > 0) stages.push('change_applied');
  if (turn.incomplete) stages.push('halted_at_ceiling');
  return stages;
}

export function shapeRunResult(input: ShapeRunResultInput): ShapedRunResult {
  const { turn } = input;

  const response: OlumiResponse = {
    response_version: 2,
    assistant_text: turn.assistantText,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: input.stage,
  };

  return {
    response,
    mayNameLeadingOption: input.analysisExists,
    mayNameLeadingOptionProvenance: input.analysisExists ? 'scenario_fact' : 'no_analysis_exists',
    telemetry: {
      stages_completed: stagesFor(turn),
      response_emitted: true,
      llm_calls_used: turn.iterations,
      commit_performed: input.commitPerformed,
      failure_type: input.commitPerformed ? null : (input.failureType ?? null),
      wall_clock_ms: input.wallClockMs,
      turn_class: 'direct_answer',
      intent_class: null,
      coaching_mode: null,
      validation_error_code: null,
    },
  };
}
