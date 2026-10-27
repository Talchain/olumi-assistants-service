/**
 * WHAT IS MOST WORTH FINDING OUT, IN THIS MODEL (SC4, the science page's S2, in its band form). For each uncertain figure the
 * options' aims rest on (never one an option sets: a choice, not an uncertainty): if the team knew which third of its draws
 * it falls in before choosing, and took in each third the option most likely to meet the goal there, how much more often
 * would the goal be met than by the option most likely overall? That is the value of knowing the band: the value of partial
 * perfect information on the goal chance, with the figure's draws binned (Sadatsafavi et al. 2013, "Need for speed", bin
 * them the same way, in more bins), so at most the value of knowing the figure exactly, never more. It weighs no cost of finding out.
 *
 * Cross-fitted, so noise in picking an option cannot pass for value (the binned estimator's upward bias: +0.5 points on a
 * figure that cannot matter, the science page's null case): each third's option, and the overall one, is picked on one half
 * of the draws (even or odd) and scored on the other. The gain is then a paired difference on the same draws (`paired.ts`,
 * Newcombe's method 10): met with the band's option against met with the overall one. It is said only where its two-sided
 * interval, family-wise at 5% over the figures tested (Bonferroni), is clear of 0, and it is at least WORTH_MIN. Two-sided,
 * not one-sided: cross-fitted draws are not quite independent, and on a figure that cannot matter a one-sided 5% bound
 * named it in 6.8% of 600 seeds, the two-sided one in 4.5% (science session, 27 Oct).
 *
 * A finding in this model for the team to weigh, never advice: which figures could change which option is most likely.
 */
import { pairedDifference, type PairedDifference } from './paired.js';
import { PhiInv } from './range-law.js';

/** A gain under 1 point in 100 is not worth saying. */
export const WORTH_MIN = 0.01;
/** The chance, over every figure tested, of naming one whose band cannot change the result. */
export const WORTH_ALPHA = 0.05;

export type Third = 'low' | 'middle' | 'high';
export interface WorthKnowing {
  /** How many figures were tested (the Bonferroni count); 0 where no test can be made (one option, a draw outside the domain). */
  readonly tested: number;
  /** The figures whose band is worth knowing, largest gain first. */
  readonly figures: readonly {
    readonly quantity: string;
    /** Per third of the figure's draws: how many draws, each option's met count there (model order), and the option most likely there. */
    readonly bands: readonly { readonly third: Third; readonly draws: number; readonly met: readonly { readonly option_id: string; readonly met: number }[]; readonly most_likely: string }[];
    /** The option most likely to meet the goal over all draws. */
    readonly overall: string;
    /** Met with each band's option less met with the overall one, per draw, cross-fitted: its paired 95%-family precision. */
    readonly gain: PairedDifference;
  }[];
}

export interface WorthInput {
  readonly draws: number;
  readonly options: readonly string[];
  /** Each option's headline per draw (1 met, 0 not, −1 outside the domain), in model order. */
  readonly headlines: readonly Int8Array[];
  /** Each figure to test, with the draws in its lowest and highest third (the rest is its middle third). */
  readonly figures: readonly { readonly quantity: string; readonly low: Int32Array; readonly high: Int32Array }[];
}

const NONE: WorthKnowing = { tested: 0, figures: [] };
const THIRDS: readonly Third[] = ['low', 'middle', 'high'];

/** The option with the most met draws, the first in model order on a tie. */
function most(met: readonly number[]): number {
  let best = 0;
  for (let o = 1; o < met.length; o++) if (met[o]! > met[best]!) best = o;
  return best;
}

/** Every option's met draws per band of one figure (0 low, 1 middle, 2 high), and the cross-fitted gain of knowing its band. */
export function bandGain(x: WorthInput, fig: WorthInput['figures'][number], z: number): { readonly gain: PairedDifference; readonly n: readonly number[]; readonly met: readonly (readonly number[])[] } {
  const { draws, headlines } = x, k = headlines.length;
  const band = new Int8Array(draws).fill(1);
  for (const d of fig.low) band[d] = 0;
  for (const d of fig.high) band[d] = 2;
  // half[f][b][o]: option o's met draws in band b on half f (even d: 0, odd d: 1); n[b]: band b's draws.
  const half = [0, 1].map(() => THIRDS.map(() => new Array<number>(k).fill(0)));
  const n = [0, 0, 0];
  for (let d = 0; d < draws; d++) {
    const b = band[d]!, f = d & 1;
    n[b]!++;
    for (let o = 0; o < k; o++) half[f]![b]![o]! += headlines[o]![d]!;
  }
  // Cross-fitted: a draw on half f is scored with the choices picked on the other half, per band and overall.
  const pickBand = [0, 1].map((f) => THIRDS.map((_, b) => most(half[1 - f]![b]!)));
  const pickOverall = [0, 1].map((f) => most(headlines.map((_, o) => half[1 - f]!.reduce((s, m) => s + m[o]!, 0))));
  const withBand = new Int8Array(draws), withOverall = new Int8Array(draws);
  for (let d = 0; d < draws; d++) {
    const f = d & 1;
    withBand[d] = headlines[pickBand[f]![band[d]!]!]![d]!;
    withOverall[d] = headlines[pickOverall[f]!]![d]!;
  }
  return { gain: pairedDifference(withBand, withOverall, false, z), n, met: THIRDS.map((_, b) => half[0]![b]!.map((m, o) => m + half[1]![b]![o]!)) };
}

export function worthKnowing(x: WorthInput): WorthKnowing {
  const { draws, headlines } = x;
  if (headlines.length < 2 || draws < 6 || x.figures.length === 0 || headlines.some((h) => h.some((v) => v < 0))) return NONE;
  const z = PhiInv(1 - WORTH_ALPHA / (2 * x.figures.length));
  const figures = x.figures.flatMap((fig) => {
    const { gain, n, met } = bandGain(x, fig, z);
    if (gain.kind !== 'sampled' || gain.difference < WORTH_MIN || gain.precision_95[0] <= 0) return [];
    // What is said comes from all the draws: each band's met counts and its most likely option.
    const total = headlines.map((_, o) => met.reduce((s, m) => s + m[o]!, 0));
    return [{ quantity: fig.quantity, overall: x.options[most(total)]!, gain,
      bands: THIRDS.map((third, b) => ({ third, draws: n[b]!, met: x.options.map((option_id, o) => ({ option_id, met: met[b]![o]! })), most_likely: x.options[most(met[b]!)]! })) }];
  }).sort((a, b) => (b.gain.kind === 'sampled' ? b.gain.difference : 0) - (a.gain.kind === 'sampled' ? a.gain.difference : 0));
  return { tested: x.figures.length, figures };
}
