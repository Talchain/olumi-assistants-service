/**
 * ⭐ THE RUN'S OWN GOAL CERTAINTY — written ONCE, by `run_analysis`, beside `graph_hash_at_run` (schemas 0.63.0;
 * DL ACK 5883197828; Runtime amendment 5883189956).
 *
 * MG's producer (`goalCertaintyOfStoredResult`) decides, per option whose P(goal) is exactly 0 or 1, whether that
 * certainty is earned. This records its answer on the Run fact, from the STORED graph the Run's hash binds and the Run's
 * own PLoT body, so every consumer (the cold read's `analysis_goal_certainty`, the Agent turn) reads one persisted
 * array and none recomputes it against a graph edited since.
 *
 * `[]` = recorded, and no option claims a certainty. NOT RECORDED (absent) when the Run has no hash to bind it to, no
 * `option_comparison` to read, the producer throws, or its output fails the published contract. A producer defect
 * therefore costs the field, never the Run, and absent is read as "not recorded", never as earned.
 */
import { z } from 'zod';
import { GoalCertaintyDecisionSchema } from '@talchain/schemas/orchestrator';

import { goalCertaintyOfStoredResult } from '../../agent-lane/goal-certainty.js';

const RecordedGoalCertaintySchema = z.array(GoalCertaintyDecisionSchema);
export type RecordedGoalCertainty = z.infer<typeof RecordedGoalCertaintySchema>;

export type GoalCertaintyRecord =
  | { readonly recorded: true; readonly decisions: RecordedGoalCertainty }
  | {
      readonly recorded: false;
      readonly reason: 'no_run_hash' | 'no_option_comparison' | 'producer_threw' | 'contract_refused';
      readonly detail?: string;
    };

export function recordGoalCertainty(
  storedGraph: unknown,
  runBody: unknown,
  graphHashAtRun: string | null,
): GoalCertaintyRecord {
  if (graphHashAtRun === null || storedGraph === undefined || storedGraph === null) {
    return { recorded: false, reason: 'no_run_hash' };
  }
  const body = runBody as { option_comparison?: unknown } | null | undefined;
  if (!Array.isArray(body?.option_comparison)) return { recorded: false, reason: 'no_option_comparison' };
  let decisions: unknown;
  try {
    decisions = goalCertaintyOfStoredResult(storedGraph, { enrichment: runBody });
  } catch (err) {
    return { recorded: false, reason: 'producer_threw', detail: err instanceof Error ? err.message : String(err) };
  }
  const parsed = RecordedGoalCertaintySchema.safeParse(decisions);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { recorded: false, reason: 'contract_refused', detail: issue ? `${issue.path.join('.')}: ${issue.message}` : undefined };
  }
  return { recorded: true, decisions: parsed.data };
}
