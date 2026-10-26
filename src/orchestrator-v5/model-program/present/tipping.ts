/**
 * THE TIPPING POINT (D2, after the alpha): for one figure a chance rests on, the value at which, in this model, the option
 * most likely to achieve the goal changes (W6's rule), or one option's chance crosses a stated level. Pure. The only
 * evidence is the simulator's own output at the probes: no structural or sign analysis of the model.
 *
 * It replaces present.ts `tippingThresholds` (deleted with alpha G10, #3761/#3765): an 11-point grid, then bisection, so a
 * second crossing between grid points was never excluded and "at least X" could be false of the model itself.
 *   - PROBES: TIPPING_PROBES evenly spaced values from the figure's low end to its high end (the caller's ends, as the driver
 *     sweep tests it). The figure is fixed at each value and every other input keeps the Run's own draws (the same seed, one
 *     stream per input: prng.ts), so the probes differ only by the figure. Each probe simulates every option.
 *   - EACH PROBE IS CLASSIFIED at a precision that holds for the whole search together: Wilson intervals at 95% Bonferroni-
 *     adjusted over every interval read (each option read, at each probe), so all cover their chances at once. Leader: the
 *     highest chance's interval clear of every other's (W6's rule, #3792), else too close. Level: the interval wholly above or
 *     below the level, else too close. An exact chance (no sampling) is its own point. A chance not worked out at any probe
 *     (a nonfinite draw) refuses the search, naming the values.
 *   - ONE CHANGE, OR NONE: runs of one state are collapsed, and a too-close run between two different definite states is a
 *     single change (where the simulation cannot tell them apart). No change: 'none'. One: 'crossing', between the last probe
 *     before it and the first after it. More: 'non_monotone', with every change's interval and no single value.
 *   - A CHANCE THAT TURNS BACK: on common draws an option's count of draws meeting the goal moves only when draws change
 *     outcome, so a count that rises and then falls across the probes (or falls and then rises) shows exactly, not as a
 *     test, that the chance is not monotone in the figure. A second crossing cannot then be ruled out: 'non_monotone'.
 *   - WORK BOUND (alpha G11): TIPPING_PROBES × `costOf` (the model with the figure fixed, at the probes' draws) must fit
 *     `maxOperations`, what the Run and the driver sweep leave of the admission limit. Otherwise it is refused by name,
 *     before anything is simulated.
 * What it supports: the state at each value tried, and that the change lies within the interval named. Never a value
 * between probes, never one past the ends, and two crossings closer together than one probe spacing are not excluded.
 */
import type { ExecutableModel } from '../executable.js';
import { PhiInv } from '../simulate/range-law.js';
import { isWithheld, type Chance, type ChanceOrWithheld, type SimResult } from '../simulate/result.js';
import { costOf, simulate, wilson } from '../simulate/simulate.js';

export const TIPPING_PROBES = 21;
/** The confidence that holds for every comparison of one search together. */
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
  | (Searched & { readonly kind: 'non_monotone'; readonly changes: readonly TippingChange[]; readonly turns_back: readonly string[] });

const key = (s: TippingState): string => (s.kind === 'leader' ? `leader:${s.option_id}` : s.kind);
const notSearchable = (why: string): TippingResult => ({ kind: 'refused', reason: 'not_searchable', why });

export function tippingPoint(input: TippingInput): TippingResult {
  const { model, quantity, question, draws } = input;
  const [low, high] = input.ends;
  const x = model.quantities.find((q) => q.id === quantity);
  if (x?.dist?.kind !== 'range') return notSearchable('it is not a figure with a range');
  if (model.options.some((o) => o.sets.some((s) => s.quantity === quantity))) return notSearchable('an option sets it');
  if (!(Number.isFinite(low) && Number.isFinite(high) && low < high)) return notSearchable('its ends are not a low end below a high end');
  if (question.kind === 'leader' ? model.options.length < 2 : !model.options.some((o) => o.id === question.option_id) || !(question.level > 0 && question.level < 1)) {
    return notSearchable(question.kind === 'leader' ? 'there are fewer than two options' : 'the option or the level is not one the model has');
  }

  const at = (value: number): ExecutableModel => ({ ...model, quantities: model.quantities
    .map((q) => (q.id === quantity ? { ...q, dist: { kind: 'fixed' as const, value, author: 'olumi' as const } } : q)) });
  // Admission first: nothing is simulated or allocated for a search over its bound.
  const operations = TIPPING_PROBES * costOf(at(low), draws).operations;
  if (operations > input.maxOperations) return { kind: 'refused', reason: 'work_bound', operations, limit: input.maxOperations };

  const last = TIPPING_PROBES - 1;
  const values = Array.from({ length: TIPPING_PROBES }, (_, j) => (j === last ? high : low + ((high - low) * j) / last));
  const runs: SimResult[] = values.map((v) => simulate(at(v), { seed: input.seed, draws }));
  const read = (r: SimResult): readonly { readonly option_id: string; readonly c: ChanceOrWithheld }[] =>
    r.options.filter((o) => question.kind === 'leader' || o.option_id === question.option_id).map((o) => ({ option_id: o.option_id, c: o.joint_within_limits }));
  const missing = values.filter((_, j) => read(runs[j]!).some((o) => isWithheld(o.c)));
  if (missing.length > 0) return { kind: 'refused', reason: 'not_worked_out', values: missing };

  // Every interval the search reads (each option it reads, at each probe) covers its chance at once at 95% (Bonferroni), so
  // every definite state below holds together, never one probe at a time.
  const intervals = TIPPING_PROBES * (question.kind === 'leader' ? model.options.length : 1);
  const z = PhiInv(1 - (1 - TIPPING_CONFIDENCE) / (2 * intervals));
  const probes: TippingProbe[] = runs.map((r, j) => {
    // Every chance here was worked out (checked above).
    const chances = read(r).map(({ option_id, c: given }) => {
      const c = given as Chance, exact = c.precision_95[0] === c.precision_95[1];
      return { option_id, chance: c.chance, interval: exact ? [c.chance, c.chance] as const : wilson(Math.round(c.chance * draws), draws, z) };
    });
    return { value: values[j]!, chances, state: stateOf(chances, question) };
  });

  const spans = probes.reduce<{ state: TippingState; first: number; last: number }[]>((acc, p, j) => {
    const prev = acc[acc.length - 1];
    if (prev !== undefined && key(prev.state) === key(p.state)) prev.last = j; else acc.push({ state: p.state, first: j, last: j });
    return acc;
  }, []);
  const changes: TippingChange[] = [];
  for (let i = 0; i + 1 < spans.length; i++) {
    const a = spans[i]!, b = spans[i + 1]!, c = spans[i + 2];
    // A too-close run between two different definite states is one change, across it.
    const across = b.state.kind === 'too_close' && a.state.kind !== 'too_close' && c !== undefined && key(c.state) !== key(a.state);
    const to = across ? c : b;
    changes.push({ from: a.state, to: to.state, between: [values[a.last]!, values[to.first]!] });
    if (across) i++;
  }
  const turns_back = probes[0]!.chances.map((o) => o.option_id).filter((id) => {
    let direction = 0;
    for (let j = 1; j < probes.length; j++) {
      const step = Math.sign(countOf(probes[j]!, id, draws) - countOf(probes[j - 1]!, id, draws));
      if (step !== 0 && direction !== 0 && step !== direction) return true;
      if (step !== 0) direction = step;
    }
    return false;
  });

  const searched: Searched = { quantity, probes, spacing: (high - low) / last, draws, confidence: TIPPING_CONFIDENCE };
  if (changes.length >= 2 || turns_back.length > 0) return { ...searched, kind: 'non_monotone', changes, turns_back };
  if (changes.length === 0) return { ...searched, kind: 'none', state: probes[0]!.state };
  return { ...searched, kind: 'crossing', ...changes[0]! };
}

/** A chance is k of `draws` exactly (simulate.ts `chanceOf`): its count of draws meeting the goal. */
const countOf = (p: TippingProbe, id: string, draws: number): number => Math.round(p.chances.find((o) => o.option_id === id)!.chance * draws);

function stateOf(chances: readonly { readonly option_id: string; readonly chance: number; readonly interval: readonly [number, number] }[], question: TippingQuestion): TippingState {
  if (question.kind === 'level') {
    const [lo, hi] = chances[0]!.interval;
    return lo > question.level ? { kind: 'above' } : hi < question.level ? { kind: 'below' } : { kind: 'too_close' };
  }
  // W6's rule (#3792): rank by chance, model order on a tie; the top is most likely only when its interval is clear of every other's.
  const ranked = chances.map((o, at) => ({ ...o, at })).sort((a, b) => b.chance - a.chance || a.at - b.at);
  const top = ranked[0]!;
  return ranked.slice(1).every((o) => top.interval[0] > o.interval[1]) ? { kind: 'leader', option_id: top.option_id } : { kind: 'too_close' };
}
