/**
 * ⭐ GEN #3 — THE USER'S LEVEL FOR A GOAL WITH NO TARGET IS NEVER DROPPED SILENTLY (DL ruling 14 Oct 01:3xZ, option (b),
 * and 02:0xZ: the ledger keeps the raw value, unit and source quote; S3 T5 D6: "Our team currently completes about 80
 * features per week" drafted as today's level, explicit, with no target).
 *
 * A goal holds today's level only against its target's scale (the target's cap): with no target there is no scale, so
 * admission writes no level (`admit-model.ts`, the untargeted branch), and the user's figure vanished without a word. It is
 * still never written here as a model figure: a level with no scale would need renormalising, by a guess, once a target
 * arrives. Instead the drop is a ledger entry that keeps what the user said (value, unit, their sentence) and says ONE
 * fact quoting them, through the channel construction already asks from (`.magnitude_question`, routed to
 * `open_questions` by `build-model.ts`). Nothing is discarded; no cap or threshold is invented.
 *
 * ⭐ THE HOST CARRIES ONLY THE FACT (AIE packet 6807d4e3 `C_caller_scope.host_fact`, 14 Oct): "Your brief says “<complete
 * retained sentence>”. This draft does not yet hold that current level as a model input." No numeric target is required
 * and the purpose is not re-asked: the one useful reasoning activity is the AI's, from the current blocker and retained
 * purpose through the existing `next_step_blocker` / Q4 contract. With no retained sentence, the figure is said, never a
 * quote invented for it.
 *
 * Only a level the brief WRITES as today's level of this goal is the user's (`goalLevelStated`, the same attestation a
 * change goal's base uses, whose own span gives the sentence); a drafter's own figure is not, and its drop owes no question.
 */
import type { CandidateModel } from './admit-model.js';
import { sayFigureWithoutRounding } from './say-figure.js';
import { sentenceAround } from './unplaced-goal-level.js';

export interface UntargetedGoalLevel {
  readonly value: number;
  readonly unit: string | null;
  /** The brief's own sentence that states the level, verbatim (null only when the attestation gives no span). */
  readonly quote: string | null;
  readonly question: string;
}

export function untargetedGoalLevelAsk(
  goal: CandidateModel['goal'],
  goalLevelStated: ((value: number, unit: unknown) => boolean) & { readonly span?: (value: number, unit: unknown) => { start: number; end: number } | null },
  brief: string | null | undefined,
): UntargetedGoalLevel | null {
  const level = goal.baseline_value;
  const metric = typeof goal.metric === 'string' ? goal.metric.trim() : '';
  if (goal.baseline_known !== true || typeof level !== 'number' || !Number.isFinite(level) || metric === '' || /[\r\n]/.test(metric)) return null;
  if (!goalLevelStated(level, goal.unit)) return null;
  const unit = typeof goal.unit === 'string' && goal.unit.trim() !== '' ? goal.unit : null;
  const at = typeof brief === 'string' ? goalLevelStated.span?.(level, goal.unit) ?? null : null;
  const sentence = at === null ? '' : sentenceAround(brief as string, at.start, at.end);
  const quote = sentence !== '' && sentence.length <= 300 && !/[\r\n]/.test(sentence) ? sentence : null;
  const said = quote !== null ? `says “${quote}”` : `puts it at ${sayFigureWithoutRounding(level, unit ?? '')} today`;
  return {
    value: level, unit, quote,
    question: `Your brief ${said}. This draft does not yet hold that current level as a model input.`,
  };
}
