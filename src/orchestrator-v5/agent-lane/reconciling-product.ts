/**
 * ⛔ A GOAL WHOSE STATED LEVEL IS THE PRODUCT OF ITS TWO STATED PARTS IS WORKED OUT AS ONE (R3 #72 5886596030).
 *
 * Sums are minted from a goal's parents (`findSumTallies`); products came ONLY from the drafter (`identities`). On
 * Paul's own brief ("£49 … 1,500 paying subscribers and £75k MRR") 3 of 5 served drafts declared none, so MRR was two
 * default-strength links: £59 reached a median £77.3k where 1,500 × £59 is £88.5k, and the reply said the target "is
 * not met under any current option".
 *
 * When the drafter declares no identity for the goal, this declares `goal = A × B` as OLUMI's reading
 * (`provenance: 'inferred'`, so `stated_in_brief: false`) only when every figure is the user's and they reconcile:
 *  · the goal's current level o is stated (explicit, written in the brief, and not the target written once);
 *  · the goal has EXACTLY TWO non-option parents, both factors whose levels a, b the user wrote (non-zero);
 *  · |o − a·b| ≤ 5% of |o| — ISL's own reconciliation tolerance (`IDENTITY_RECONCILIATION_TOLERANCE`).
 * Anything else returns the candidate untouched. Admission then judges it like any declaration (`markProductIdentities`),
 * and PLoT/ISL frame-check it (a zero operand is withdrawn; ISL's k-scale absorbs the ≤ 5% gap).
 */
import type { CandidateModel } from './admit-model.js';
import { readCurrencyUnitWithQualifiers } from '../../cee/provenance/stated-amounts.js';
import { figureTheUserWrote, levelWrittenApartFromTarget } from './stated-by-user.js';

/** ISL `robustness_analyzer_v2.py` `IDENTITY_RECONCILIATION_TOLERANCE`: the same share, never a looser one. */
const RECONCILIATION_TOLERANCE = 0.05;

const stated = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v !== 0;

type Period = 'month' | 'year' | null;
const MONTH = new Set(['month', 'months', 'mo', 'monthly', 'pcm', 'mrr']);
const YEAR = new Set(['year', 'years', 'yr', 'annum', 'annual', 'annually', 'pa', 'arr']);
const words = (s: string): string[] => s.toLowerCase().replace(/[()]/g, ' ').replace(/\//g, ' / ').split(/[\s-]+/).filter((w) => w !== '');
const singular = (w: string): string => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

function periodOf(ws: readonly string[]): Period | 'both' {
  const m = ws.some((w) => MONTH.has(w));
  const y = ws.some((w) => YEAR.has(w));
  return m && y ? 'both' : m ? 'month' : y ? 'year' : null;
}

/** Money in ONE unscaled currency, its period, and its per-unit denominator ("£/subscriber/month" → subscriber). */
function readMoney(unit: unknown, label: string): { code: string; period: Period; per: string | null } | null {
  if (typeof unit !== 'string') return null;
  const r = readCurrencyUnitWithQualifiers(unit);
  if (r.kind !== 'currency' || r.currencyCode === undefined || (r.multiplier ?? 1) !== 1) return null;
  const ws = words(unit);
  // The goal's own name can carry its period ("MRR", "Monthly recurring revenue") when its unit does not.
  const own = periodOf(ws);
  const period = own !== null ? own : periodOf(words(label));
  if (period === 'both') return null;
  const perAt = ws.findIndex((w, i) => i > 0 && (ws[i - 1] === '/' || ws[i - 1] === 'per') && /^[a-z]+$/.test(w)
    && !MONTH.has(w) && !YEAR.has(w) && readCurrencyUnitWithQualifiers(w).kind !== 'currency');
  return { code: r.currencyCode, period, per: perAt === -1 ? null : singular(ws[perAt]!) };
}

/** A COUNT: words only ("subscribers", "paying customers") — no currency, no %, no period, no "per" (a rate). */
function readCount(unit: unknown): string[] | null {
  if (typeof unit !== 'string' || !/^[a-z][a-z\s-]*$/i.test(unit.trim())) return null;
  const ws = words(unit);
  if (ws.length === 0 || ws.includes('per') || periodOf(ws) !== null || readCurrencyUnitWithQualifiers(unit).kind === 'currency') return null;
  return ws.map(singular);
}

/**
 * ⛔ AIQ 5886846493 + 5886967509 (HARD): (money per <unit> per period) × (count of that <unit>) = money per period, in the
 * goal's OWN currency and period. The rate's per-unit denominator MUST name the count ("£/subscriber/month" ×
 * "subscribers"): it is what makes a product the only dimensionally valid reading. No denominator ("GBP/month"),
 * another count, anything unknown or scaled (£k) → no mint. "3 engineers × £25k budget ≈ £75k MRR" fails on the period.
 */
function unitsCompose(goalUnit: unknown, goalLabel: string, a: { unit: unknown; label: string }, b: { unit: unknown; label: string }): boolean {
  const goal = readMoney(goalUnit, goalLabel);
  if (goal === null) return false;
  for (const [m, c] of [[a, b], [b, a]] as const) {
    const money = readMoney(m.unit, '');
    const count = readCount(c.unit);
    if (money === null || count === null) continue;
    if (money.code !== goal.code || money.period !== goal.period) continue;
    // AIQ 5886967509: the DENOMINATOR is the dimensional proof. A rate with none ("GBP/month") could be summed as easily
    // as multiplied, so it is a CONFIRMATION for the user, never a silent mint.
    if (money.per === null || !count.includes(money.per)) continue;
    return true;
  }
  return false;
}

export function withReconcilingProductIdentity(candidate: CandidateModel, brief: string): CandidateModel {
  const goal = candidate.goal;
  const metric = goal.metric;
  const o = goal.baseline_value;
  if (goal.baseline_known !== true || goal.baseline_provenance !== 'explicit' || !stated(o)) return candidate;
  if (!figureTheUserWrote(o, goal.unit, brief) || !levelWrittenApartFromTarget(o, goal.unit, goal.value, brief)) return candidate;
  if ((candidate.identities ?? []).some((i) => i.outcome === metric)) return candidate;
  const options = new Set(candidate.options.map((opt) => opt.label));
  const sources = [...new Set(candidate.links.filter((l) => l.to === metric).map((l) => l.from))].filter((s) => !options.has(s));
  if (sources.length !== 2) return candidate;
  const parts = sources.map((s) => candidate.factors.find((f) => f.label === s));
  const levels: number[] = [];
  for (const f of parts) {
    if (f === undefined || f.baseline_known !== true || f.provenance !== 'explicit' || !stated(f.baseline_value)) return candidate;
    if (!figureTheUserWrote(f.baseline_value, f.unit, brief)) return candidate;
    levels.push(f.baseline_value);
  }
  if (Math.abs(o - levels[0]! * levels[1]!) > RECONCILIATION_TOLERANCE * Math.abs(o)) return candidate;
  if (!unitsCompose(goal.unit, metric, parts[0]!, parts[1]!)) return candidate;
  return {
    ...candidate,
    identities: [...(candidate.identities ?? []), { outcome: metric, operation: 'product', factors: [parts[0]!.label, parts[1]!.label], provenance: 'inferred' }],
  };
}
