/**
 * THE TIPPING POINT (D2, after the alpha): for one figure a chance rests on, where, AT THE VALUES TRIED, the option most
 * likely to achieve the goal changes (W6's rule), or one option's chance crosses a stated level. Pure. The only evidence
 * is the simulator's own output at the probes: no structural or sign analysis of the model.
 *
 * It replaces present.ts `tippingThresholds` (deleted with alpha G10, #3761/#3765): an 11-point grid, then bisection, so a
 * second crossing between grid points was never excluded and "at least X" could be false of the model itself.
 *   - PROBES: TIPPING_PROBES evenly spaced values from the figure's low end to its high end (the caller's ends, as the driver
 *     sweep tests it). The figure is fixed at each value and every other input keeps the Run's own draws (the same seed, one
 *     stream per input: prng.ts), so the probes differ only by the figure. Each probe simulates every option.
 *   - EACH PROBE IS CLASSIFIED with exact (Clopper–Pearson) intervals, Bonferroni-adjusted over every interval read (each
 *     option read, at each probe), so with at least 95% every interval covers its chance at once. Leader: the highest
 *     interval clear of every other's (W6's rule, #3792); for an exact model (nothing sampled: no ranged figure, no risk)
 *     equal top chances are a TIE. Level: the interval wholly above or below the level. Otherwise TOO CLOSE: unresolved,
 *     never evidence of a change or of none. A chance not worked out at any probe (a nonfinite draw) refuses the search.
 *   - DEFINITE STATES ONLY: 'none' when every probe is the same definite state; 'crossing' when one definite state gives way
 *     to another once, stated as the interval from the last probe of the one to the first of the other; 'non_monotone' when
 *     the definite states change more than once. A too-close probe, or an exact tie inside the run of probes, is the zone of
 *     a change. One anywhere but between two different definite states, or
 *     an option whose count of met draws rises and then falls across the probes (on common draws, some draws then do not
 *     move one way as the figure rises, so a single change cannot be established), is 'unresolved'.
 *   - WORK BOUND (alpha G11): TIPPING_PROBES × `costOf` (the model with the figure fixed, at the probes' draws) must fit
 *     `maxOperations`, what the Run and the driver sweep leave of the admission limit. Otherwise it is refused by name,
 *     before anything is simulated.
 * What it supports, at 95% for every probe together: the state at each value tried, and that a change lies within the
 * interval named. Nothing between probes: a change narrower than one probe spacing is not seen, so the words say "at the
 * values tried" (ruling out such a change needs a structural check of the model, which this search does not make).
 */
import type { ExecutableModel } from '../executable.js';
import { isWithheld, type Chance, type ChanceOrWithheld, type SimResult } from '../simulate/result.js';
import { costOf, simulate } from '../simulate/simulate.js';

export const TIPPING_PROBES = 21;
/** The confidence that holds for every interval of one search together. */
export const TIPPING_CONFIDENCE = 0.95;

/** Leader: the option most likely to achieve the goal changes. Level: this option's chance crosses `level` (0 to 1, exclusive). */
export type TippingQuestion = { readonly kind: 'leader' } | { readonly kind: 'level'; readonly option_id: string; readonly level: number };
export interface TippingInput {
  readonly model: ExecutableModel;
  /** The Run's seed: the probes keep its draws. */
  readonly seed: number;
  /** Draws per probe (the driver sweep's). */
  readonly draws: number;
  /** The figure searched over: a ranged input no option sets. */
  readonly quantity: string;
  /** Its low end and high end, within what it is drawn within (the driver sweep's settings). */
  readonly ends: readonly [number, number];
  readonly question: TippingQuestion;
  /** What the Run and the driver sweep leave of the admission limit, in `costOf` operations. */
  readonly maxOperations: number;
}
export type TippingState =
  | { readonly kind: 'leader'; readonly option_id: string }
  | { readonly kind: 'tie' }
  | { readonly kind: 'above' }
  | { readonly kind: 'below' }
  | { readonly kind: 'too_close' };
export interface TippingProbe {
  readonly value: number;
  readonly state: TippingState;
  /** Each option's chance there (joint, within the limits) and the interval it was classified with. */
  readonly chances: readonly { readonly option_id: string; readonly chance: number; readonly interval: readonly [number, number] }[];
}
export interface TippingChange { readonly from: TippingState; readonly to: TippingState; readonly between: readonly [number, number] }
/** What every searched result carries: the probes it rests on and the precision they were read at. */
interface Searched { readonly quantity: string; readonly probes: readonly TippingProbe[]; readonly spacing: number; readonly draws: number; readonly confidence: number }
export type TippingResult =
  | { readonly kind: 'refused'; readonly reason: 'work_bound'; readonly operations: number; readonly limit: number }
  | { readonly kind: 'refused'; readonly reason: 'not_searchable'; readonly why: string }
  | { readonly kind: 'refused'; readonly reason: 'not_worked_out'; readonly values: readonly number[] }
  | (Searched & { readonly kind: 'none'; readonly state: TippingState })
  | (Searched & { readonly kind: 'crossing' } & TippingChange)
  | (Searched & { readonly kind: 'non_monotone'; readonly changes: readonly TippingChange[] })
  | (Searched & { readonly kind: 'unresolved'; readonly reason: 'too_close'; readonly values: readonly number[] })
  | (Searched & { readonly kind: 'unresolved'; readonly reason: 'turns_back'; readonly options: readonly string[] });

const key = (s: TippingState): string => (s.kind === 'leader' ? `leader:${s.option_id}` : s.kind);
const notSearchable = (why: string): TippingResult => ({ kind: 'refused', reason: 'not_searchable', why });

export function tippingPoint(input: TippingInput): TippingResult {
  const { model, quantity, question, draws } = input;
  const [low, high] = input.ends;
  const x = model.quantities.find((q) => q.id === quantity);
  if (x?.dist?.kind !== 'range') return notSearchable('it is not a figure with a range');
  if (model.options.some((o) => o.sets.some((s) => s.quantity === quantity))) return notSearchable('an option sets it');
  if (!(Number.isFinite(low) && Number.isFinite(high) && Number.isFinite(high - low) && low < high)) return notSearchable('its ends are not a low end below a high end');
  if (question.kind === 'leader' ? model.options.length < 2 : !model.options.some((o) => o.id === question.option_id) || !(question.level > 0 && question.level < 1)) {
    return notSearchable(question.kind === 'leader' ? 'there are fewer than two options' : 'the option or the level is not one the model has');
  }

  const at = (value: number): ExecutableModel => ({ ...model, quantities: model.quantities
    .map((q) => (q.id === quantity ? { ...q, dist: { kind: 'fixed' as const, value, author: 'olumi' as const } } : q)) });
  // Admission first: nothing is simulated or allocated for a search over its bound.
  const operations = TIPPING_PROBES * costOf(at(low), draws).operations;
  if (operations > input.maxOperations) return { kind: 'refused', reason: 'work_bound', operations, limit: input.maxOperations };

  const last = TIPPING_PROBES - 1, spacing = (high - low) / last;
  const values = Array.from({ length: TIPPING_PROBES }, (_, j) => (j === last ? high : low + spacing * j));
  const runs: SimResult[] = values.map((v) => simulate(at(v), { seed: input.seed, draws }));
  const read = (r: SimResult): readonly { readonly option_id: string; readonly c: ChanceOrWithheld }[] =>
    r.options.filter((o) => question.kind === 'leader' || o.option_id === question.option_id).map((o) => ({ option_id: o.option_id, c: o.joint_within_limits }));
  const missing = values.filter((_, j) => read(runs[j]!).some((o) => isWithheld(o.c)));
  if (missing.length > 0) return { kind: 'refused', reason: 'not_worked_out', values: missing };

  // Exact only when nothing is sampled once the figure is fixed (no ranged figure, no risk): the simulator's own "exact"
  // reads its draws, so one draw, or draws that happen to agree, would pass for no sampling.
  const exact = model.risks.length === 0 && !at(low).quantities.some((q) => q.dist?.kind === 'range' && q.dist.low < q.dist.high);
  const alpha = (1 - TIPPING_CONFIDENCE) / (TIPPING_PROBES * (question.kind === 'leader' ? model.options.length : 1));
  const probes: TippingProbe[] = runs.map((r, j) => {
    // Every chance here was worked out (checked above). A chance is k of `draws` exactly (simulate.ts `chanceOf`).
    const chances = read(r).map(({ option_id, c: given }) => {
      const c = given as Chance;
      return { option_id, chance: c.chance, interval: exact ? [c.chance, c.chance] as const : clopperPearson(Math.round(c.chance * draws), draws, alpha) };
    });
    return { value: values[j]!, chances, state: stateOf(chances, question, exact) };
  });

  const spans = probes.reduce<{ state: TippingState; first: number; last: number }[]>((acc, p, j) => {
    const prev = acc[acc.length - 1];
    if (prev !== undefined && key(prev.state) === key(p.state)) prev.last = j; else acc.push({ state: p.state, first: j, last: j });
    return acc;
  }, []);
  const searched: Searched = { quantity, probes, spacing, draws, confidence: TIPPING_CONFIDENCE };
  // A ZONE: too close anywhere, or an exact tie between two other states (Codex r2: the probe where A and B are exactly
  // equal is the change itself, never two). A tie at either end is a state of its own ("neither is more likely").
  const zone = spans.map((s, i) => s.state.kind === 'too_close' || (s.state.kind === 'tie' && i > 0 && i < spans.length - 1));
  const definite = spans.filter((_, i) => !zone[i]);
  const changes: TippingChange[] = definite.slice(1).flatMap((b, i) => {
    const a = definite[i]!;
    return key(a.state) === key(b.state) ? [] : [{ from: a.state, to: b.state, between: [values[a.last]!, values[b.first]!] as const }];
  });
  if (changes.length >= 2) return { ...searched, kind: 'non_monotone', changes };
  // A zone is never a state of its own: only between two different definite states is it the zone of one change.
  const before = (i: number) => spans.slice(0, i).filter((_, j) => !zone[j]).pop(), after = (i: number) => spans.slice(i + 1).find((_, j) => !zone[i + 1 + j]);
  const unclear = spans.filter((_, i) => {
    const a = before(i), b = after(i);
    return zone[i] && (a === undefined || b === undefined || key(a.state) === key(b.state));
  });
  if (unclear.length > 0) return { ...searched, kind: 'unresolved', reason: 'too_close', values: unclear.flatMap((s) => values.slice(s.first, s.last + 1)) };
  const turnsBack = probes[0]!.chances.map((o) => o.option_id).filter((id) => {
    let direction = 0;
    for (let j = 1; j < probes.length; j++) {
      const step = Math.sign(countOf(probes[j]!, id, draws) - countOf(probes[j - 1]!, id, draws));
      if (step !== 0 && direction !== 0 && step !== direction) return true;
      if (step !== 0) direction = step;
    }
    return false;
  });
  if (turnsBack.length > 0) return { ...searched, kind: 'unresolved', reason: 'turns_back', options: turnsBack };
  if (changes.length === 0) return { ...searched, kind: 'none', state: definite[0]!.state };
  return { ...searched, kind: 'crossing', ...changes[0]! };
}

const countOf = (p: TippingProbe, id: string, draws: number): number => Math.round(p.chances.find((o) => o.option_id === id)!.chance * draws);

function stateOf(chances: readonly { readonly option_id: string; readonly chance: number; readonly interval: readonly [number, number] }[], question: TippingQuestion, exact: boolean): TippingState {
  if (question.kind === 'level') {
    const [lo, hi] = chances[0]!.interval;
    return lo > question.level ? { kind: 'above' } : hi < question.level ? { kind: 'below' } : { kind: 'too_close' };
  }
  // W6's rule (#3792): rank by chance, model order on a tie; the top is most likely only when its interval is clear of every other's.
  const ranked = chances.map((o, at) => ({ ...o, at })).sort((a, b) => b.chance - a.chance || a.at - b.at);
  const top = ranked[0]!;
  if (ranked.slice(1).every((o) => top.interval[0] > o.interval[1])) return { kind: 'leader', option_id: top.option_id };
  return exact && ranked[1]!.chance === top.chance ? { kind: 'tie' } : { kind: 'too_close' };
}

/**
 * The Clopper–Pearson interval for k successes in n draws at level 1 − alpha: exact, so it covers the chance with at least
 * 1 − alpha whatever the chance (a Wilson interval can fall short near 0 or 1). Its ends are Beta quantiles.
 */
export function clopperPearson(k: number, n: number, alpha: number): [number, number] {
  return [k === 0 ? 0 : betaQuantile(alpha / 2, k, n - k + 1), k === n ? 1 : betaQuantile(1 - alpha / 2, k + 1, n - k)];
}
/** The x with I_x(a, b) = p, by bisection (I_x rises in x). */
function betaQuantile(p: number, a: number, b: number): number {
  let lo = 0, hi = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (betaRegularised(mid, a, b) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
/** The regularised incomplete Beta function I_x(a, b): its continued fraction (Lentz), on the side where it converges fast. */
function betaRegularised(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  return x < (a + 1) / (a + b + 2) ? (front * betaFraction(x, a, b)) / a : 1 - (front * betaFraction(1 - x, b, a)) / b;
}
function betaFraction(x: number, a: number, b: number): number {
  const TINY = 1e-300;
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  d = 1 / (Math.abs(d) < TINY ? TINY : d);
  let h = d;
  for (let m = 1; m <= 10_000; m++) {
    const m2 = 2 * m;
    for (const coefficient of [(m * (b - m) * x) / ((a + m2 - 1) * (a + m2)), (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1))]) {
      d = 1 + coefficient * d;
      d = 1 / (Math.abs(d) < TINY ? TINY : d);
      c = 1 + coefficient / c;
      if (Math.abs(c) < TINY) c = TINY;
      h *= d * c;
    }
    if (Math.abs(d * c - 1) < 1e-15) return h;
  }
  return h;
}
/** ln Γ(x) for x > 0 (Lanczos, g = 7, nine terms; relative error about 1e-15). */
function lnGamma(x: number): number {
  const g = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  const z = x - 1;
  let s = g[0]!;
  for (let i = 1; i < 9; i++) s += g[i]! / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(s);
}
