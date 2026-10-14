/**
 * ⭐ GEN #3 — THE USER'S LEVEL FOR A GOAL WITH NO TARGET IS NEVER DROPPED SILENTLY (DL ruling 14 Oct 01:3xZ, option (b);
 * S3 T5 D6: "Our team currently completes about 80 features per week" drafted as today's level, explicit, with no target).
 *
 * A goal holds today's level only against its target's scale (`goal_threshold_cap`): with no target there is no scale, so
 * admission writes no level (`admit-model.ts`, the untargeted branch), and the user's figure vanished without a word. It is
 * still never written here as a figure: a level with no scale would need renormalising, by a guess, once a target arrives.
 * Instead the drop is said, as ONE question that quotes the user's level, through the ledger channel construction already
 * asks from (`.magnitude_question`, routed to `open_questions` by `build-model.ts`).
 *
 * Only a level the brief WRITES as today's level of this goal is quoted as the user's (`goalLevelStated`, the same
 * attestation a change goal's base uses); a drafter's own figure is not the user's, and its drop owes no question. PURE.
 */
import type { CandidateModel } from './admit-model.js';
import { sayFigureWithoutRounding } from './say-figure.js';

export function untargetedGoalLevelAsk(
  goal: CandidateModel['goal'],
  goalLevelStated: (value: number, unit: unknown) => boolean,
): { readonly level: number; readonly question: string } | null {
  const level = goal.baseline_value;
  const metric = typeof goal.metric === 'string' ? goal.metric.trim() : '';
  if (goal.baseline_known !== true || typeof level !== 'number' || !Number.isFinite(level) || metric === '' || /[\r\n]/.test(metric)) return null;
  if (!goalLevelStated(level, goal.unit)) return null;
  const said = sayFigureWithoutRounding(level, typeof goal.unit === 'string' ? goal.unit : '');
  return {
    level,
    question: `Your brief puts ‘${metric}’ at ${said} today, but with no target the model holds no level for it. `
      + 'What level would count as success, and by when?',
  };
}
