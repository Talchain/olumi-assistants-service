/**
 * V5 alpha hardening Phase 3 — six canonical journey steps from Paul's brief.
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

export interface JourneyContext {
  readonly scenario_id: string;
  readonly turn_counter: { value: number };
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
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      message: DECISION_BRIEF,
      turn_class: 'frame',
      stage: 'frame',
    }),
  },
  {
    name: '2_weakest_option',
    description:
      '"Which option looks weakest?" → 200, response references actual option/factor labels from the draft.',
    depends_on: '1_draft_graph',
    buildPayload: (ctx) => ({
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      message: 'Which option looks weakest?',
      turn_class: 'decide',
      stage: 'analyse',
    }),
  },
  {
    name: '3_add_option',
    description:
      '"Add another option" → product-shaped: 200, no BoundaryError, no internal terms. May route to converse/clarify/recoverable validation.',
    depends_on: '1_draft_graph',
    buildPayload: (ctx) => ({
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      message: 'Add another option to this decision.',
      turn_class: 'frame',
      stage: 'frame',
    }),
  },
  {
    name: '4_run_analysis',
    description:
      'Emit chip_click payload for Run analysis → 200, PLoT completes, handler fact persisted.',
    depends_on: '1_draft_graph',
    buildPayload: (ctx) => ({
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      message: 'Run analysis.',
      turn_class: 'decide',
      stage: 'analyse',
    }),
  },
  {
    name: '5_explain_leader',
    description:
      '"Why does the leading option win?" → 200, response names leading option, probability, a top driver, a caveat. Exercises analysis fallback on follow-up.',
    depends_on: '4_run_analysis',
    buildPayload: (ctx) => ({
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      message: 'Why does the leading option win?',
      turn_class: 'decide',
      stage: 'decide',
    }),
  },
  {
    name: '6_edit_budget',
    description:
      '"Increase the budget factor" → 200, edit proposal or clarifying question. Recoverable validator path is acceptable.',
    depends_on: '1_draft_graph',
    buildPayload: (ctx) => ({
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      message: 'Increase the budget factor.',
      turn_class: 'frame',
      stage: 'frame',
    }),
  },
];
