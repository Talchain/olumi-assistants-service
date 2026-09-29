/**
 * ⛔ THE BRIEF'S LEVEL THAT NEVER REACHED A CHANGE GOAL (R3-B #72 5894575583; MG diagnosis 5894657102).
 *
 * Served `7c23be87` and 18 of 44 saved change goals (0 LLM): "Monthly spend is £45k; we want to cut costs by 20%" drafts
 * the goal as a change (`change_rel` −0.2) with NO current level (`goal.baseline_value` null) — the drafter names the
 * goal "costs" and puts the £45k nowhere (13 saves) or on a side factor (5). A change is measured from today's level,
 * so no chance of the cut is shown, and the build says the level "was not stated" while the user wrote it.
 *
 * This finds that figure, and only that: PURE, no model call, no write. The caller decides what happens (AIQ's ruling
 * on MG 5894657102): it is never admitted here, and nothing here makes it the user's level of the goal.
 *
 * A figure is returned only when ALL hold, else null:
 *  · the goal's target is a stated CHANGE (`change_rel` | `change_abs`) and construction admitted no base for it;
 *  · the goal's unit reads as ONE currency (`readCurrencyUnitWithQualifiers`); the figure is in that currency;
 *  · exactly ONE such amount in the brief is not the change itself (`change_abs`'s own figure) — two would be a guess;
 * `carried_by` names the factor already holding it, when one does (the side-factor shape); absent, no node carries it.
 */
import { findStatedAmounts, readCurrencyUnitWithQualifiers } from '../../cee/provenance/stated-amounts.js';
import type { CandidateModel } from './admit-model.js';

export interface UnplacedGoalLevel {
  /** The figure in the GOAL'S OWN unit (its scale applied: "£45k" is 45 on a "£k/month" goal). */
  readonly value: number;
  /** The amount exactly as the brief writes it ("£45k"). */
  readonly written: string;
  /** The factor whose level already holds it, when one does. */
  readonly carried_by?: string;
}

const same = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

export function unplacedGoalLevel(candidate: CandidateModel, brief: string | null | undefined, baseAdmitted: boolean): UnplacedGoalLevel | null {
  const goal = candidate.goal;
  if (baseAdmitted || typeof brief !== 'string' || (goal.frame !== 'change_rel' && goal.frame !== 'change_abs')) return null;
  const unit = readCurrencyUnitWithQualifiers(typeof goal.unit === 'string' ? goal.unit : '');
  if (unit.kind !== 'currency' || unit.currencyCode === undefined) return null;
  const scale = unit.multiplier ?? 1;
  const amounts = findStatedAmounts(brief).filter((a) => a.kind === 'currency' && a.currencyCode === unit.currencyCode
    // The change itself ("cut it by £5,000") is the target, never today's level.
    && !(goal.frame === 'change_abs' && typeof goal.value === 'number' && same(a.magnitude, Math.abs(goal.value) * scale)));
  const distinct = amounts.filter((a, i) => amounts.findIndex((b) => same(b.magnitude, a.magnitude)) === i);
  if (distinct.length !== 1) return null;
  const a = distinct[0]!;
  const carrier = candidate.factors.find((f) => {
    if (typeof f.baseline_value !== 'number' || !Number.isFinite(f.baseline_value)) return false;
    const fu = readCurrencyUnitWithQualifiers(typeof f.unit === 'string' ? f.unit : '');
    return fu.kind === 'currency' && fu.currencyCode === unit.currencyCode && same(f.baseline_value * (fu.multiplier ?? 1), a.magnitude);
  });
  return { value: a.magnitude / scale, written: a.matchedText, ...(carrier !== undefined ? { carried_by: carrier.label } : {}) };
}
