/**
 * PRESENT (spike S2): ExecutableModel + SimResult → the `canonical_analysis_view.v1` fields the DGAI reads on core
 * (DGAI `src/canvas/runView/canonicalAnalysisView.ts:2-69` types, `:106-158` parser, read at staging 18625f84). Pure.
 *
 * What it says, and what it never says:
 *   - Each option's CELL is its chance of meeting every goal together, within the limits, on the SAME draws (the
 *     simulator's `joint_within_limits`), shown with the screen's existing rounding (`displayRoundingFor`, `displayedPctAt`,
 *     `sayDisplayedPct`) at the simulation's own precision. The precision is said in `detail`, labelled as precision: how
 *     exactly the simulation measured the chance, never a range for the chance. No win share is computed or said.
 *   - Every chance's words restate its question: the quantity, the target with its unit, the horizon counted from the model's
 *     start, the aggregation, and what is left out. They end with the BASIS: "on your figures" only when every input the chance rests on
 *     is the person's and confirmed, no law was assumed and no premise applies (R8); otherwise "on Olumi's reading of …",
 *     and/or conditional, "if <the premises it rests on and Olumi's assumptions, listed>". Never a forecast.
 *   - Several goals: each goal's own chance per option (`per_target`), and the joint. A goal the compiler withheld (an ask
 *     or an unknown) is never folded into a partial joint: the joint is withheld with its reason, and only the goals the ask
 *     feeds wait (DL ruling d). No threshold is searched for (alpha G10): a sampled grid cannot
 *     prove a single crossing, so "at least X" could be false of the model itself.
 *   - main_driver (DL 24 Oct): for a computed chance, what it rests on most, by one figure at a time at its range's ends on
 *     the Run's own draws (`mainDriverOf`, DRIVER_MIN_SWING); a withheld chance says `{ kind: 'not_recorded' }`, the word
 *     DGAI's parser takes for "absent" (it refuses the WHOLE view when `main_driver` is missing).
 *   - Every range is named as Olumi's provisional conversion (`rangeSpread`, mapper.ts:104-110) of the person's range, or of
 *     Olumi's own: the person's bounds stay theirs and are never called their probability law (DL ruling 4).
 *   - A chance the simulator withheld for a nonfinite draw (`invalid_domain`, DL ruling 3) is a withheld cell with its count
 *     and quantities, never a figure and never a failure.
 *   - WHICH OPTION IS MOST LIKELY TO ACHIEVE THE GOAL (Paul 6 and 14 Oct; W6): with every option's chance worked out and at
 *     least two options, `leader` names the option with the highest chance (`goal_chance_leader`, `leader_licence: 'permitted'`)
 *     only when its simulation precision overlaps no other option's; otherwise it lists the options it overlaps as too close to
 *     call (`similar_option_ids`, withheld). Its `words` say both chances, the basis and what the leading chance is most
 *     sensitive to. A model-relative finding: never "best", a winner, a recommendation or a win share (`option_id` is null).
 *   - Fields with nothing true to say are absent: no `leader` with one option or a chance not shown, no `status_quo`, no
 *     `historical_figures`. `run` is null and currentness unknown unless the caller passes the Run's facts.
 */
import { sayFigureAsWritten } from '../../agent-lane/say-figure.js';
import { comparatorWords } from '../../goal-target/goal-target-basis.js';
import { displayRoundingFor } from '../../goal-target/goal-chance-driver.js';
import { displayedPctAt } from '../../goal-target/goal-chance-display.js';
import { sayDisplayedPct } from '../../goal-target/goal-targets-joint.js';
import type { Aggregation, Cmp, Domain, ExecutableModel, FixedAuthor, Goal, Limit, Quantity, Window } from '../executable.js';
import { rangeLaw, type RangeDist } from '../simulate/range-law.js';
import { isWithheld, type Chance, type ChanceOrWithheld, type OptionResult, type SimResult, type WithheldChance } from '../simulate/result.js';
import { costOf, readingOf, restsOn, simulate } from '../simulate/simulate.js';

/** Whose a figure is: unverified is said to be the person's but their words were not found (compile's `unverified`). */
type Author = 'person' | 'olumi' | 'structure' | 'unverified';
/** Recorded authors whose fixed values are no one's assumption: the person's own figure, a structural constant. */
const NOT_ASSUMPTIONS: ReadonlySet<string> = new Set<FixedAuthor>(['person', 'structure']);
const NOT_RECORDED = '(author not recorded)';
/** Said to be the person's, but their words for it were not found (compile's `unverified`): never "on your figures". */
const NOT_IN_THEIR_WORDS = '(not found in your words)';

/** The canonical model's label and author for a quantity (S1 `CanonicalQuantity`), and the author of the relation defining it. */
export interface PresentQuantity {
  readonly label: string;
  readonly author: Author;
  readonly relation_author?: Author;
  /** The person gave it as approximate ("about"): used for now until they give a range, said with their words. */
  readonly approximate?: { readonly quote: string };
  /** A figure the compiler converted (25 % → 0.25): said in the unit it was given in, never as the fraction. */
  readonly shown_in?: { readonly unit: string; readonly factor: number };
  /** R8, default deny: every record behind it (its figure, or its relation and links) is the person's, accepted and in their words. */
  readonly confirmed?: boolean;
  /** Every record behind it is accepted and in their words, whoever wrote it: only otherwise "(not yet confirmed)". */
  readonly accepted?: boolean;
}
/** A premise a goal's chance is worked out under (compile's `rests_on`): an applied assumption or a prerequisite, as written. */
export interface PresentPremise {
  readonly id: string;
  readonly text: string;
  readonly author: 'person' | 'olumi';
  /** Someone whose statement the person reports; acceptance does not make it the person's own premise. */
  readonly party?: string | null;
  readonly kind: 'assumption' | 'condition';
  /** The same rule as `PresentQuantity.confirmed`. */
  readonly confirmed: boolean;
}
/** S1's `GoalOutcome`, with the goal's label: every goal, calculable or not. */
export interface PresentGoal {
  readonly goal_id: string;
  readonly label: string;
  readonly status: 'calculable' | 'asks' | 'withheld';
  readonly reasons: readonly string[];
  readonly asks: readonly string[];
  /** The premises its chance rests on (R8), said in its basis. Absent: none. */
  readonly rests_on?: readonly PresentPremise[];
}
/** S1's `LimitOutcome`, with the limit's label: every limit, checked or not. */
export interface PresentLimit {
  readonly limit_id: string;
  readonly label: string;
  readonly status: 'calculable' | 'asks' | 'withheld';
  readonly reasons: readonly string[];
  readonly asks: readonly string[];
}
/** An asked quantity, by its label and unit (S1's `asked` blocker): never a question of the code's. */
export interface PresentAsk {
  readonly quantity_id: string;
  readonly label: string;
  readonly unit: string;
}
/**
 * One thing the result waits on (S1's typed `Blocker`), with its label: listed on the result as it is, in the model's order.
 * `answer` names the figure the card's answer box fills, where there is one (a quantity); null when it is answered in chat.
 */
export interface PresentBlocker {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly scope: readonly string[];
  readonly answer: { readonly quantity_id: string } | null;
  /** For `unknown` only: the quantity's own basis (the AI's words on why no one can size it yet). */
  readonly basis?: string;
}
export interface PresentInput {
  readonly model: ExecutableModel;
  readonly result: SimResult;
  /** Labels (overriding the executable model's own) and the authors of relations, by quantity id. */
  readonly quantities?: Readonly<Record<string, PresentQuantity>>;
  /** Every goal (S1 `perGoal` with labels). Absent: the executable model's goals are all the goals. */
  readonly goals?: readonly PresentGoal[];
  /** Every limit (S1 `perLimit` with labels). A limit waiting on an ask is named as not yet checked, never dropped. */
  readonly limits?: readonly PresentLimit[];
  readonly asks?: readonly PresentAsk[];
  /** Everything the result waits on, typed (S1's `blockers`), listed on the result as `goal_chance.waits_on`. */
  readonly blockers?: readonly PresentBlocker[];
  /** Aims left out of the chance because they have no measure yet, by label (S1 `joint.leaves_out`). */
  readonly leaves_out?: readonly string[];
  /** The model's left-out records (what it does not represent), in their own words, with what each concerns. */
  readonly left_out?: readonly { readonly text: string; readonly concerns: readonly string[] }[];
  /** R8, by goal and limit id: its own record (and its window's figures) confirmed, and accepted. Absent: neither (default deny). */
  readonly aims?: Readonly<Record<string, { readonly confirmed: boolean; readonly accepted: boolean }>>;
  /** R8 (Codex on #3769): the premises each limit's check, and each option's own settings, rest on (compile's `rests_on`). */
  readonly limit_premises?: Readonly<Record<string, readonly PresentPremise[]>>;
  readonly option_premises?: Readonly<Record<string, readonly PresentPremise[]>>;
  /** The Run's own record. Absent: `run` is null. */
  readonly run?: { readonly run_id: string; readonly graph_hash_at_run: string; readonly computed_at: string };
  /** The caller's currentness check of this Run (graph hash equality). Absent: unknown. */
  readonly current?: boolean;
  readonly revision?: number;
  /** False when the driver sweep would pass the Run's admission limit (alpha G11): no driver is measured, and that is said. */
  readonly sweep?: boolean;
}

export type PresentCell =
  | { readonly kind: 'figure'; readonly display: string; readonly face: string;
      readonly detail: { readonly precision_95: readonly [number, number]; readonly draws: number; readonly precision_words: string } }
  | { readonly kind: 'withheld'; readonly face: string; readonly why: string; readonly reasons: readonly { readonly code: string; readonly message: string | null }[] };
export interface PresentedAnalysisView {
  readonly schema: 'canonical_analysis_view.v1';
  readonly source: 'stored_run_facts';
  readonly run: { readonly run_id: string; readonly graph_hash_at_run: string; readonly computed_at: string } | null;
  readonly staleness: {
    readonly stale: boolean | null;
    readonly revision: number | null;
    readonly run_revision: null;
    readonly basis: 'analysis_graph_hash_interim';
    readonly reason: null;
    readonly limitation: 'Hash equality cannot detect brief, framing or stage changes.' | 'Currentness is unknown because an analysis hash is unavailable.';
  };
  readonly leader_licence: 'permitted' | 'withheld';
  /** Which option is most likely to achieve the goal in this model, or which are too close to call (see the header). */
  readonly leader?: PresentedLeader;
  readonly options: readonly { readonly option_id: string; readonly cell: PresentCell; readonly main_driver: PresentMainDriver }[];
  readonly goal_chance?: {
    readonly chance_words?: string;
    readonly notes?: readonly string[];
    readonly targets?: {
      readonly joint: { readonly status: 'licensed'; readonly words: string } | { readonly status: 'withheld'; readonly line: string };
      readonly per_target: readonly { readonly constraint_id: string; readonly words: string;
        readonly options: readonly { readonly option_id: string; readonly display: string }[] }[];
    };
    readonly limits?: readonly { readonly constraint_id: string; readonly words: string;
      readonly options: readonly { readonly option_id: string; readonly display: string }[] }[];
    readonly unchecked_limits?: readonly { readonly limit_id: string; readonly words: string }[];
    /** Everything the result waits on, by label, with the figure its answer box fills where there is one. */
    readonly waits_on?: readonly PresentBlocker[];
  };
}

/**
 * The DGAI's `CanonicalRunLeader` shape (`canonicalAnalysisView.ts`), plus CEE's `words`. `option_id` is the comparative (win
 * share) leader, which this presenter never computes, so it is always null; `goal_chance_leader` is the option most likely to
 * achieve the goal, only where licensed.
 */
export interface PresentedLeader {
  readonly licence: 'permitted' | 'withheld';
  readonly option_id: null;
  readonly goal_chance_leader: string | null;
  readonly similar_option_ids: readonly string[];
  readonly words: string;
}

/**
 * ONE REASON (simplify v1 S4): what a chance not shown yet waits on, said once from the compiler's typed blockers, by label,
 * in their order: the blockers holding up any of `ids` (a no-goal blocker holds up every chance). Undefined when none does:
 * the caller then says the compiler's own reason for a figure no one can give, never a sentence of its own.
 */
export function waitsOnWords(blockers: readonly PresentBlocker[], ids: ReadonlySet<string>): string | undefined {
  const said = blockers.filter((b) => b.code === 'no_goal' || b.scope.some((s) => ids.has(s))).map((b) => {
    const name = q(b.label);
    switch (b.code) {
      case 'no_goal': return 'the result you want';
      case 'measure': return `a measure for ${name}`;
      case 'deadline': return `a deadline for ${name}`;
      case 'range_kind': return `how to read the range for ${name}`;
      case 'recount': return `${name} again`;
      case 'unknown': return `${name}, which no one can size yet${b.basis?.trim() ? ` (${inlineWords(b.basis).replace(/[.!]+$/, '')})` : ''}`;
      default: return name;
    }
  });
  return said.length === 0 ? undefined : `waits on ${listWords([...new Set(said)])}`;
}
/** The needs-your-answer face only when a blocker on these ids is the person's to answer: never for an `unknown` alone. */
export const needsAnswer = (blockers: readonly PresentBlocker[], ids: ReadonlySet<string>): boolean =>
  blockers.some((b) => b.code !== 'unknown' && (b.code === 'no_goal' || b.scope.some((s) => ids.has(s))));
const NEEDS_ANSWER_FACE = 'Not shown yet: needs your answer';
const NOT_SHOWN_FACE = 'Chance not shown yet';
const SWEEP_DRAWS = 4000;

/**
 * WHAT A COMPUTED CHANCE RESTS ON MOST (DL 24 Oct; the guiding principle: provisional means the person can change something
 * and see how much it matters). One figure at a time: each ranged input the option's chance rests on (never one an option
 * sets: a choice, not an uncertainty) is set to its range's low end, its middle and its high end (their stated ends for a
 * person's range), and the model is simulated again on the Run's seed. Every input has its own stream (prng.ts), so the
 * others keep the headline's draws; the sweep reads the first SWEEP_DRAWS of them. The swing is the highest chance less
 * the lowest of the three (buddy, #3728: a chance can peak in the middle, so the ends alone are no test). The largest swing
 * over DRIVER_MIN_SWING is the driver; otherwise none is licensed. A finding in this model, never advice.
 */
export const DRIVER_MIN_SWING = 0.05;
/** The sweep's cost (alpha G11): three settings of every ranged input no option sets, each a run of SWEEP_DRAWS. */
export function driverSweepOperations(model: ExecutableModel, draws: number): number {
  const switches = new Set(model.options.flatMap((o) => o.sets.map((s) => s.quantity)));
  const inputs = model.quantities.filter((x) => x.dist?.kind === 'range' && x.dist.low < x.dist.high && !switches.has(x.id)).length;
  return 3 * inputs * costOf(model, Math.min(SWEEP_DRAWS, draws)).operations;
}
export const NO_DRIVER_REASON = 'Tested one at a time at each figure’s low end, middle and high end, no figure moved this chance by more than 5 points.';
export const NO_RANGE_REASON = 'No figure this chance rests on has a range to test.';
export const NOT_SWEPT_REASON = 'This model is too large to test each figure one at a time in one run, so what the chance rests on most is not measured.';
const whoseRange = (author: 'person' | 'olumi' | 'unverified'): string => (author === 'unverified' ? NOT_IN_THEIR_WORDS : author === 'person' ? '(your range)' : '(Olumi’s estimate)');
/** A setting tried: its value, and the chance there as displayed; null where it could not be worked out (a nonfinite draw). */
type End = { readonly value: number; readonly display: string | null };
export type PresentMainDriver =
  | { readonly kind: 'available'; readonly detail: string; readonly driver: { readonly quantity: string; readonly author: 'person' | 'olumi' | 'unverified';
      readonly low: End; readonly middle: End; readonly high: End; readonly swing_points: number; readonly draws: number;
      readonly untested: readonly { readonly quantity: string; readonly settings: readonly string[] }[] } }
  | { readonly kind: 'none_licensed'; readonly reason: string }
  | { readonly kind: 'not_recorded' };

export function listWords(parts: readonly string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
/** Display words stay on one line; the authored model and its quoted source are never rewritten. */
export const inlineWords = (text: string): string => text.trim().replace(/\s+/g, ' ');
const q = (label: string): string => `‘${inlineWords(label)}’`;
/** A sentence's full stop, unless it already ends in one (a question keeps its "?"). */
const stop = (x: string): string => (/[.?!]$/.test(x) ? x : `${x}.`);
/** A figure in its unit; a pure number (unit "1") is said alone. */
const say = (value: number, unit: string): string => (unit.trim() === '' || unit.trim() === '1' ? sayFigureAsWritten(value, '') : sayFigureAsWritten(value, unit));
const plural = (unit: string, n: number): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

/**
 * The horizon counts from the model's period 0, not the day it is read, with the aggregation (DL ruling 1). Interval k is
 * "month k+1"; boundary k is "the end of month k". A flow reads months start+1 … start+periods, and a state reads their ends.
 */
function horizonWords(aggregation: Aggregation, w: Window, unit: string, reading: 'state' | 'flow'): string {
  const first = w.start_period + 1, last = w.start_period + w.periods;
  const state = reading === 'state';
  const origin = 'from the start of this model';
  if (aggregation === 'end' || first === last) return state ? `at ${plural(unit, last)} ${origin}` : `in ${unit} ${last} ${origin}`;
  const months = `${unit}s ${first} to ${last} ${origin}`;
  if (aggregation === 'sum') return state ? `added up over ${months}, taking its level at the start of each ${unit}` : `in total over ${months}`;
  if (aggregation === 'mean') return state ? `on average at the ends of ${months}` : `on average per ${unit} over ${months}`;
  if (aggregation === 'max') return state ? `at its highest at the ends of ${months}` : `in its highest ${unit} of ${months}`;
  if (aggregation === 'min') return state ? `at its lowest at the ends of ${months}` : `in its lowest ${unit} of ${months}`;
  return state ? `at the end of every ${unit} from ${unit} ${first} to ${unit} ${last} ${origin}` : `in every ${unit} from ${unit} ${first} to ${unit} ${last} ${origin}`;
}

/** The labelled result for an option's chance: display at the simulation's own precision, and the precision's words. */
function shown(c: ChanceOrWithheld, draws: number): { display: string; precision_words: string } | undefined {
  if (isWithheld(c)) return undefined;
  const [lo, hi] = c.precision_95;
  // S3 smoke fix 2: a chance from fixed inputs only (exact: no interval) is said exactly, 100% or 0%, never "more than 99%".
  const display = lo === hi && (c.chance === 1 || c.chance === 0) ? `${c.chance * 100}%`
    : sayDisplayedPct(displayedPctAt(c.chance, displayRoundingFor(((hi - lo) / 2) * 100)));
  const pct = (x: number): string => `${Number((x * 100).toFixed(1))}%`;
  const precision_words = lo === hi
    ? 'Simulation precision: exact. Every simulated draw gives the same result for this option, so no sampling is involved.'
    : `Simulation precision: ${pct(lo)} to ${pct(hi)}, from ${draws.toLocaleString('en-GB')} simulated draws. This is how exactly the simulation measured the chance, not a range the chance could take.`;
  return { display, precision_words };
}

export function presentAnalysisView(input: PresentInput): PresentedAnalysisView {
  const { model, result } = input;
  const byId = new Map(model.quantities.map((x) => [x.id, x] as const));
  const meta = (id: string): PresentQuantity | undefined => input.quantities?.[id];
  /** A figure in the unit the person gave it in (a % stays a %), else in the executable's unit. */
  const sayOf = (id: string, value: number, unit: string): string => {
    const s = meta(id)?.shown_in;
    return s === undefined ? say(value, unit) : say(value / s.factor, s.unit);
  };
  /**
   * When it is read. An aim with no window is read once with every option's change in effect (the compiler's own reading,
   * compile.ts); one that changes over time without a deadline waits on a `deadline` blocker and is never said here (S4).
   */
  const whenWords = (c: Goal | Limit): string => (c.no_deadline === true ? 'with each option in effect' : horizonWords(c.aggregation, c.window, unit, readingOf(byId.get(c.quantity)!)));
  const label = (id: string): string | undefined => meta(id)?.label ?? byId.get(id)?.label;
  const optionLabel = new Map(model.options.map((o) => [o.id, o.label] as const));
  const unit = model.period_unit;

  // ── What each condition rests on: its upstream quantities, through every relation, flow, set and risk ──────────────────
  /** `optionId`: through that option's sets; null: through no option's (the model every option shares). The simulator's own
   * dependency authority (`restsOn`), timings included, so a basis and a driver never miss what the chance rests on. */
  const upstream = (roots: readonly string[], optionId: string | null): Set<string> => restsOn(model, roots, optionId);

  /** A range's law as the simulator draws it, and what it is kept to: its declared domain, a chance's within 0 to 1 (spec §3.7). */
  const lawOf = (id: string, d: RangeDist): { domain: Domain | undefined; reading: ReturnType<typeof rangeLaw> } => {
    const domain = model.risks.some((r) => r.occurrence === id) ? { min: Math.max(0, d.domain?.min ?? 0), max: Math.min(1, d.domain?.max ?? 1) } : d.domain;
    return { domain, reading: rangeLaw(d, domain === undefined ? {} : { domain }) };
  };
  /** A domain's ends in plain words (alpha G2): "never below 0 member", "0 to 1". */
  const canBe = (id: string, unit: string, d: Domain | undefined): string => {
    const min = d?.min !== undefined && Number.isFinite(d.min) ? sayOf(id, d.min, unit) : null, max = d?.max !== undefined && Number.isFinite(d.max) ? sayOf(id, d.max, unit) : null;
    return min !== null && max !== null ? `${min} to ${max}` : min !== null ? `never below ${min}` : max !== null ? `never above ${max}` : 'the values it can take';
  };
  /** Olumi's assumptions among these quantities, in plain words, model order, each said once (a shadow named as its quantity,
   * compile.ts `shadowLabel`, says the same words). Empty = every input is the person's. */
  const assumptions = (ids: ReadonlySet<string>): string[] => [...new Set(model.quantities.filter((x) => ids.has(x.id)).flatMap((x): string[] => {
    const name = q(label(x.id) ?? x.id), m = meta(x.id);
    if (x.dist?.kind === 'range') {
      // DL ruling 4: every range's law is Olumi's provisional conversion (`rangeSpread`, mapper.ts:104-110), never the person's
      // probability law; the person's bounds stay theirs and are named as such.
      // The PL's range law (AMEND): conditioned on the person's bounds, or on a domain, as the simulator draws it.
      const d: RangeDist = x.dist;
      const { domain, reading } = lawOf(x.id, d);
      const ends = `${sayOf(x.id, d.low, x.unit)} to ${sayOf(x.id, d.high, x.unit)}`;
      // DL ruling (author not recorded): a range whose basis is neither the person's nor Olumi's is listed as such, never
      // passed as the person's; `rangeLaw` draws it unbounded (only a person's stated bounds condition the draw).
      const unverified = m?.author === 'unverified';
      const whose = unverified ? `a range ${NOT_IN_THEIR_WORDS}` : d.basis === 'person_range' ? 'your range' : d.basis === 'olumi_estimate' ? 'Olumi’s own estimated range' : `a range ${NOT_RECORDED}`;
      if (reading.kind === 'point') {
        return d.basis === 'person_range' && !unverified ? [] : [`${name} is ${sayOf(x.id, reading.value, x.unit)}${unverified ? ` ${NOT_IN_THEIR_WORDS}` : d.basis === 'olumi_estimate' ? ', Olumi’s estimate' : ` ${NOT_RECORDED}`}`];
      }
      const held = reading.lower === d.low && reading.upper === d.high ? ', held within those bounds'
        : Number.isFinite(reading.lower) || Number.isFinite(reading.upper) ? `, kept to Olumi’s reading of what it can be (${canBe(x.id, x.unit, domain)})` : '';
      return [`${name} follows Olumi’s provisional conversion of ${whose}, ${ends}, into a bell-shaped spread${held}`];
    }
    if (x.dist?.kind === 'fixed') {
      // executable.ts r3: the author of every fixed value. A structural constant (a conversion, a switch, a count) and a
      // placeholder that cancels out of every result are no one's assumption.
      // DL ruling (author not recorded): a value with no recorded author is listed as an assumption, never read as the person's.
      // Codex r1 #3709: words said to be the person's but not found in what they wrote outrank the figure's recorded author.
      if (m?.author === 'unverified') return [`${name} is ${sayOf(x.id, x.dist.value, x.unit)} ${NOT_IN_THEIR_WORDS}`];
      const author: string | undefined = x.dist.author ?? m?.author;
      if (author === 'olumi') return [`${name} is ${sayOf(x.id, x.dist.value, x.unit)}, Olumi’s figure`];
      if (m?.approximate !== undefined) return [`using ${sayOf(x.id, x.dist.value, x.unit)} for ${name} for now — you said ${q(m.approximate.quote)}`];
      return author !== undefined && NOT_ASSUMPTIONS.has(author) ? [] : [`${name} is ${sayOf(x.id, x.dist.value, x.unit)} ${NOT_RECORDED}`];
    }
    // S3 smoke fix 1: only an Olumi-authored EFFECT relation is an assumed relationship. A definition (an identity: a
    // product, a sum, a difference such as x − x for a zero start) and a stock's accumulation are never assumptions,
    // whoever wrote them; a unit conversion is a structural constant (above).
    // DL ruling (author not recorded): an effect relation with no recorded author is listed, never read as the person's.
    if (x.equation?.form !== 'effect' || m?.relation_author === 'person') return [];
    return [m?.relation_author === 'olumi' ? `${name} follows Olumi’s assumed relationship` : `${name} follows a relationship ${NOT_RECORDED}`];
  }))];
  /** R8: a reported premise keeps its speaker; "your" only when it is the person's own and confirmed. */
  const premiseWords = (p: PresentPremise): string => {
    const text = q(p.text.trim().replace(/[.!]+$/, '')), party = p.party == null ? '' : inlineWords(p.party);
    const whose = p.author === 'olumi' ? 'Olumi’s' : party !== '' ? `${party}’s` : p.confirmed ? 'your' : 'the';
    return `${whose} ${p.kind === 'condition' ? `condition ${text} is met` : `assumption ${text} holds`}${p.author === 'person' && !p.confirmed ? ' (not yet confirmed)' : ''}`;
  };
  /** R8 (default deny): what it reads (its goals and limits, each quantity) not `confirmed` is Olumi's reading (a structural constant is nobody's), named
   * unless the "if" list already says it is not the person's; "(not yet confirmed)" only while not accepted (DL). */
  const unconfirmed = (ids: ReadonlySet<string>, aimIds: readonly string[]): string | undefined => {
    const read = model.quantities.filter((x) => ids.has(x.id) && (x.dist?.kind === 'fixed' ? x.dist.author ?? meta(x.id)?.author : meta(x.id)?.author) !== 'structure');
    const owner = (x: Quantity) => (x.dist === undefined ? meta(x.id)?.relation_author : meta(x.id)?.author), aim = (id: string) => input.aims?.[id];
    const aimLabel = (id: string) => q([...model.goals, ...model.limits].find((c) => c.id === id)?.label ?? id);
    const open = [...aimIds.filter((id) => aim(id)?.confirmed !== true).map((id) => ({ name: aimLabel(id), pending: aim(id)?.accepted !== true })),
      ...read.filter((x) => meta(x.id)?.confirmed !== true && (owner(x) === 'person' || assumptions(new Set([x.id])).length === 0))
        .map((x) => ({ name: q(label(x.id) ?? x.id), pending: meta(x.id)?.accepted !== true }))];
    if (open.length === 0) return undefined;
    const some = read.some((x) => meta(x.id)?.confirmed === true) || aimIds.some((id) => aim(id)?.confirmed === true);
    if (open.every((i) => i.pending)) return `on Olumi’s reading of ${some ? listWords(open.map((i) => i.name)) : 'your figures'} (not yet confirmed)`;
    return `on Olumi’s reading of ${listWords(open.map((i) => (i.pending ? `${i.name} (not yet confirmed)` : i.name)))}`;
  };
  /** What the chance is conditional on: the premises, then Olumi's assumptions. */
  const conditions = (ids: ReadonlySet<string>, premises: readonly PresentPremise[]): string[] => [...premises.map(premiseWords), ...assumptions(ids)];
  /** "on your figures" only when every record is confirmed and nothing is conditional; otherwise the reading and/or "if …". */
  const basisWords = (ids: ReadonlySet<string>, premises: readonly PresentPremise[], aimIds: readonly string[], readings: ReadonlySet<string> = ids): string => {
    const lead = unconfirmed(readings, aimIds), a = conditions(ids, premises);
    const iff = a.length === 0 ? undefined : `if ${listWords(a)}`;
    return [lead, iff].filter((x): x is string => x !== undefined).join(', ') || 'on your figures';
  };
  /**
   * A target's basis covers every option: the shared model's basis, then each option's own assumptions, named by option
   * ("on your figures; with ‘Raise’, if ‘New price’ is £59, Olumi’s figure").
   */
  const sharedBasisWords = (r: readonly string[], premises: readonly PresentPremise[], aimIds: readonly string[]): string => {
    const shared = upstream(r, null), conditional = conditions(shared, premises).length > 0;
    const lead = basisWords(shared, premises, aimIds, new Set([...shared, ...model.options.flatMap((o) => [...upstream(r, o.id)])]));
    const own = model.options.flatMap((o) => {
      const extra = [...(input.option_premises?.[o.id] ?? []).filter((p) => !premises.some((x) => x.id === p.id)).map(premiseWords),
        ...assumptions(new Set([...upstream(r, o.id)].filter((id) => !shared.has(id))))];
      return extra.length === 0 ? [] : [`with ${q(optionLabel.get(o.id) ?? o.id)}, ${conditional ? 'also ' : ''}if ${listWords(extra)}`];
    });
    // Codex on #3769: a bare "on your figures" beside an option's own conditions would read as covering every option; the
    // options named say what is conditional, and the rest rest on the person's figures alone.
    return (lead === 'on your figures' && own.length > 0 ? own : [lead, ...own]).join('; ');
  };

  // ── The question each chance answers ────────────────────────────────────────────────────────────────────────────────────
  /** A target or bound in words: its figure, unless an option sets it to another (a second oven's smaller budget), when the
   * base figure is not this option's: then its name, as for a figure that is not fixed (Codex r2 #3719 case). */
  const boundWords = (against: string): string | undefined => {
    const target = byId.get(against);
    if (target?.dist?.kind === 'fixed' && !model.options.some((o) => o.sets.some((s) => s.quantity === against))) return sayOf(against, target.dist.value, target.unit);
    return label(against) === undefined ? undefined : q(label(against)!);
  };
  const conditionWords = (c: Goal | Limit, against: string, role: 'goal' | 'limit'): string | undefined => {
    const subject = label(c.quantity), bound = comparatorWords(c.cmp), target = byId.get(against);
    if (subject === undefined || bound === undefined || target === undefined) return undefined;
    // The level template of `targetChanceWords` (goal-target-basis.ts): ‘X’ being at least T; a limit's subject "is".
    const figure = boundWords(against);
    if (figure === undefined) return undefined;
    // A ratio (executable.ts r3 `per`) names both quantities: "‘Sign-ups’ per ‘Visitors’ being at least 0.05 …".
    const of = c.per === undefined ? q(subject) : label(c.per) === undefined ? undefined : `${q(subject)} per ${q(label(c.per)!)}`;
    if (of === undefined) return undefined;
    return `${of} ${role === 'goal' ? 'being' : 'is'} ${bound} ${figure} ${whenWords(c)}`;
  };
  const goalWords = new Map(model.goals.map((g) => [g.id, conditionWords(g, g.target, 'goal')] as const));
  const limitWords = model.limits.map((l) => conditionWords(l, l.bound, 'limit'));
  // Every goal: the caller's (with its asks), else the run's own; a goal the compiler left out of this run (executable.ts r3
  // `withheld[]`) waits too, so the joint is never a partial one.
  const given: readonly PresentGoal[] = input.goals ?? model.goals.map((g) => ({ goal_id: g.id, label: g.label, status: 'calculable', reasons: [], asks: [] }));
  const leftOutGoals: PresentGoal[] = (model.withheld ?? []).filter((w) => w.kind === 'goal' && !given.some((g) => g.goal_id === w.id))
    .map((w) => ({ goal_id: w.id, label: w.label, status: 'withheld', reasons: [w.reason], asks: [] }));
  const allGoals: readonly PresentGoal[] = [...given, ...leftOutGoals];
  /** The premises these goals' chance rests on, each once, in the goals' order. */
  const premisesOf = (goalIds: readonly string[]): PresentPremise[] =>
    [...new Map(goalIds.flatMap((id) => allGoals.find((g) => g.goal_id === id)?.rests_on ?? []).map((p) => [p.id, p] as const)).values()];
  /** An option's whole chance (every goal, within every limit): its goals', its limits' and its own premises, each once. */
  const optionPremises = (optionId: string): PresentPremise[] => [...new Map([...premisesOf(model.goals.map((g) => g.id)),
    ...model.limits.flatMap((l) => input.limit_premises?.[l.id] ?? []), ...(input.option_premises?.[optionId] ?? [])].map((p) => [p.id, p] as const)).values()];
  const waiting = allGoals.filter((g) => g.status !== 'calculable');
  /** Options and risks the compiler left out: said in the words of every chance, with their reasons in the notes. */
  const notInRun = (model.withheld ?? []).filter((w) => w.kind === 'option' || w.kind === 'risk');
  const sayable = [...goalWords.values(), ...limitWords].every((w) => w !== undefined);
  const leftOut = ((input.leaves_out ?? []).length > 0 ? `, leaving out ${listWords(input.leaves_out!.map(q))}, which ${input.leaves_out!.length === 1 ? 'has' : 'have'} no measure yet` : '')
    + (notInRun.length > 0 ? `, without ${listWords(notInRun.map((w) => `the ${w.kind} ${q(w.label)}`))}, which ${notInRun.length === 1 ? 'is' : 'are'} not in this run` : '');
  const covered = model.goals.flatMap((g) => (goalWords.get(g.id) !== undefined ? [goalWords.get(g.id)!] : []));
  const notCovered = [...(input.leaves_out ?? []), ...(input.left_out ?? []).map((r) => r.text)];
  // No aim in this run: there is no chance to name, so no "chance of …" sentence (DoD-G marketing r2/r5 said "chance of , while …").
  const jointWords = sayable && model.goals.length > 0
    ? `${listWords(model.goals.map((g) => goalWords.get(g.id)!))}${limitWords.length > 0 ? `, while ${listWords(limitWords as string[])}` : ''}${leftOut}`
    : undefined;
  const roots = [...model.goals.flatMap((g) => [g.quantity, g.target, ...(g.per !== undefined ? [g.per] : [])]),
    ...model.limits.flatMap((l) => [l.quantity, l.bound, ...(l.per !== undefined ? [l.per] : [])])];

  const askOf = new Map((input.asks ?? []).map((a) => [a.quantity_id, a] as const));

  // ── Limits (S3 smoke fix 3): each limit's own outcome is said, and a limit not yet checked is named with what it needs ─
  const givenLimits: readonly PresentLimit[] = input.limits ?? [];
  const unchecked: PresentLimit[] = [...givenLimits.filter((l) => l.status !== 'calculable'),
    ...(model.withheld ?? []).filter((w) => w.kind === 'limit' && !givenLimits.some((l) => l.limit_id === w.id))
      .map((w) => ({ limit_id: w.id, label: w.label, status: 'withheld' as const, reasons: [w.reason], asks: [] }))];
  const uncheckedWords = unchecked.map((l) => {
    const waits = l.asks.map((id) => askOf.get(id)?.label).filter((x): x is string => x !== undefined);
    return `${q(l.label)} — ${waits.length > 0 ? `waits on ${listWords(waits.map(q))}` : l.reasons.join(' ')}`;
  });
  const uncheckedLine = uncheckedWords.length > 0 ? `Not yet checked: ${uncheckedWords.join('; ')}` : undefined;
  /** "‘Customer cost’ is at most £1,100 at 1 month from the start of this model: about 81%", one per limit, for one option. */
  const limitShown = (o: OptionResult, l: Limit): string => {
    const pl = o.per_limit.find((x) => x.limit_id === l.id)!;
    return shown(pl, result.draws)?.display ?? `not shown, as ${isWithheld(pl) ? pl.withheld.count.toLocaleString('en-GB') : 0} simulated draws could not be worked out`;
  };
  const limitLines = (o: OptionResult): string[] => model.limits.map((l, i) => `${limitWords[i] ?? q(l.label)}: ${limitShown(o, l)}`);
  /** A limit by what it measures, never its bound: an option can move the bound (Codex r2 #3719), and a label can hold one. */
  const measuredBy = (l: Limit): string => {
    const subject = label(l.quantity), per = l.per === undefined ? undefined : label(l.per);
    return subject === undefined ? q(l.label) : `${q(subject)}${per === undefined ? '' : ` per ${q(per)}`}`;
  };

  // ── Cells ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const blockers = input.blockers ?? [];
  const limitIds = new Set([...model.limits.map((l) => l.id), ...givenLimits.map((l) => l.limit_id), ...unchecked.map((l) => l.limit_id)]);
  /** A goal's own reason, from the blockers; for a figure no one can give (no blocker), the compiler's own words for it. */
  const goalWaits = (g: PresentGoal): string => waitsOnWords(blockers, new Set([g.goal_id])) ?? `is not in the chance yet: ${g.reasons.join(' ')}`;
  const waitingWords = waitsOnWords(blockers, new Set(waiting.map((g) => g.goal_id)));
  const withheldCell = (): Extract<PresentCell, { kind: 'withheld' }> => ({
    kind: 'withheld', face: waitingWords !== undefined && needsAnswer(blockers, new Set(waiting.map((g) => g.goal_id))) ? NEEDS_ANSWER_FACE : NOT_SHOWN_FACE,
    why: waiting.length > 0
      ? waitingWords !== undefined ? `${listWords(waiting.map((g) => q(g.label)))} ${waiting.length === 1 ? waitingWords : waitingWords.replace(/^waits/, 'wait')}.`
        : stop(waiting.map((g) => `${q(g.label)} ${goalWaits(g)}`).join(' '))
      : 'The words for this chance cannot be said exactly, so it is not shown.',
    reasons: waiting.length > 0 ? waiting.map((g) => ({ code: g.status === 'asks' ? 'goal_asks' : 'goal_withheld', message: g.reasons.join(' ') || null }))
      : [{ code: 'words_not_sayable', message: null }],
  });
  /** DL ruling 3: a chance a nonfinite draw touched is withheld, typed, with its count and quantities; never a figure. */
  const outsideCell = (w: WithheldChance): PresentCell => ({
    kind: 'withheld', face: NOT_SHOWN_FACE,
    why: `In ${w.withheld.count.toLocaleString('en-GB')} of ${result.draws.toLocaleString('en-GB')} simulated draws ${listWords(w.withheld.quantities.map((id) => q(label(id) ?? id)))} could not be worked out (for example a division by zero), so this model cannot give the chance yet.`,
    reasons: [{ code: 'invalid_domain', message: `${w.withheld.count} draws; ${w.withheld.quantities.join(', ')}` }],
  });
  /**
   * WHY AN EXACT CHANCE IS EXACT (Lenses fit 2, DL 23 Oct): 0% or 100% is said only where the outcome is FIXED in the model
   * (every draw reads the same value against the same target, no risk in play: simulate's `exact`), and then with the value
   * that fixes it: "in every simulated draw ‘Weekly capacity’ is 80 ticket / week at 1 week from the start of this model, below 100 ticket / week".
   * A sampled 0 of N stays "less than 1%" (`shown`). Each goal or limit that decides it is named: the ones missed for 0%,
   * every one for 100%.
   */
  const MISSED: Record<Cmp, string> = { '>=': 'below', '>': 'not above', '<=': 'above', '<': 'not below' };
  const fixedLine = (c: Goal | Limit, against: string, value: number, met: boolean): string | undefined => {
    const subject = label(c.quantity), target = byId.get(against), said = boundWords(against);
    if (subject === undefined || target?.dist?.kind !== 'fixed' || said === undefined) return undefined;
    const of = c.per === undefined ? q(subject) : label(c.per) === undefined ? undefined : `${q(subject)} per ${q(label(c.per)!)}`;
    if (of === undefined) return undefined;
    const bound = met ? comparatorWords(c.cmp) : MISSED[c.cmp];
    return `${of} is ${sayOf(against, value, target.unit)}${c.no_deadline === true ? '' : ` ${whenWords(c)}`}, ${bound} ${said}`;
  };
  const fixedWhy = (o: OptionResult, met: boolean): string | undefined => {
    const lines = [
      ...model.goals.map((g, i) => ({ c: g as Goal | Limit, against: g.target, chance: o.per_goal[i], out: o.outcomes[i] })),
      ...model.limits.map((l, i) => ({ c: l as Goal | Limit, against: l.bound, chance: o.per_limit[i], out: o.limit_outcomes[i] })),
    ].flatMap(({ c, against, chance, out }) => {
      if (chance === undefined || isWithheld(chance) || out === undefined || 'withheld' in out) return [];
      if (chance.chance !== (met ? 1 : 0) || chance.precision_95[0] !== chance.precision_95[1]) return [];
      const line = fixedLine(c, against, out.p50, met);
      return line === undefined ? [] : [line];
    });
    return lines.length === 0 ? undefined : `in every simulated draw ${listWords(lines)}`;
  };
  // ── What each computed chance rests on most (DRIVER_MIN_SWING): each input at its low end, middle and high end, cached ──
  const switches = new Set(model.options.flatMap((o) => o.sets.map((s) => s.quantity)));
  const SETTINGS = ['low end', 'middle', 'high end'];
  const sweepDraws = Math.min(SWEEP_DRAWS, result.draws);
  const atEnds = new Map<string, { readonly values: readonly number[]; readonly results: readonly SimResult[] }>();
  const endsOf = (x: Quantity & { dist: RangeDist }) => {
    if (!atEnds.has(x.id)) {
      // Test the stated ends within the Run's domain, and the middle of that interval. The simulator has already refused
      // an occurrence range outside [0, 1]. Cache settings with results so the words name exactly what was tested.
      const reading = lawOf(x.id, x.dist).reading;
      const within = (value: number) => reading.kind === 'point' ? reading.value : Math.min(reading.upper, Math.max(reading.lower, value));
      const low = within(x.dist.low), high = within(x.dist.high);
      const values = [low, (low + high) / 2, high];
      const results = values.map((value) => simulate({ ...model, quantities: model.quantities
        .map((z) => (z.id === x.id ? { ...z, dist: { kind: 'fixed' as const, value, author: 'olumi' as const } } : z)) }, { seed: result.seed, draws: sweepDraws }));
      atEnds.set(x.id, { values, results });
    }
    return atEnds.get(x.id)!;
  };
  const mainDriverOf = (o: OptionResult): PresentMainDriver => {
    const rests = upstream(roots, o.option_id);
    const inputs = model.quantities.filter((x): x is Quantity & { dist: RangeDist } => x.dist?.kind === 'range' && x.dist.low < x.dist.high && rests.has(x.id) && !switches.has(x.id));
    if (inputs.length === 0) return { kind: 'none_licensed', reason: NO_RANGE_REASON };
    if (input.sweep === false) return { kind: 'none_licensed', reason: NOT_SWEPT_REASON };
    // Codex r1 #3728: a setting that cannot be worked out (a nonfinite draw) is never dropped: the swing counts only the
    // settings that computed, the input is named as not tested there, and nothing is concluded about a setting not tested.
    const tested = inputs.map((x) => {
      const at = endsOf(x).results.map((r) => r.options.find((p) => p.option_id === o.option_id)!.joint_within_limits);
      const chances = at.flatMap((c) => (isWithheld(c) ? [] : [c.chance]));
      return { x, at, swing: chances.length === 0 ? 0 : Math.max(...chances) - Math.min(...chances), missing: SETTINGS.filter((_, i) => isWithheld(at[i]!)) };
    });
    const untested = tested.filter((t) => t.missing.length > 0);
    const notTested = (ts: typeof tested): string => stop(listWords(ts.map((t) => `${q(label(t.x.id) ?? t.x.id)} could not be tested at its ${listWords(t.missing)}`)));
    const best = tested.reduce((b, t) => (t.swing > b.swing ? t : b));
    if (best.swing <= DRIVER_MIN_SWING) {
      if (untested.length === 0) return { kind: 'none_licensed', reason: NO_DRIVER_REASON };
      return { kind: 'none_licensed', reason: `${notTested(untested)}${tested.some((t) => t.missing.length < SETTINGS.length)
        ? ' Of the settings that could be tested, none moved this chance by more than 5 points.' : ''}` };
    }
    const { x, at } = best;
    const author = meta(x.id)?.author === 'unverified' ? 'unverified' as const : x.dist.basis === 'person_range' ? 'person' as const : 'olumi' as const;
    const whose = whoseRange(author);
    const [low, middle, high] = endsOf(x).values.map((value, i) => ({ value, display: shown(at[i]!, sweepDraws)?.display ?? null }));
    const said = (e: End) => `(${sayOf(x.id, e.value, x.unit)}) ${e.display ?? 'could not be tested'}`;
    const others = untested.filter((t) => t.x.id !== x.id);
    return { kind: 'available', driver: { quantity: x.id, author, low: low!, middle: middle!, high: high!, swing_points: Number((best.swing * 100).toFixed(1)), draws: sweepDraws,
      untested: untested.map((t) => ({ quantity: t.x.id, settings: t.missing })) },
      detail: `In this model, of the figures tested one at a time, the chance is most sensitive to ${q(label(x.id) ?? x.id)} ${whose}: `
        + `at the low end ${said(low!)}, at the middle ${said(middle!)}, at the high end ${said(high!)}.${others.length > 0 ? ` ${notTested(others)}` : ''}` };
  };
  const options = result.options.map((o: OptionResult) => {
    const name = optionLabel.get(o.option_id) ?? o.option_id;
    const notRecorded = { kind: 'not_recorded' as const };
    // No aim is in this run: what the chance waits on is the blockers' (an aim's measure, a figure, or the result they want),
    // as the waiting view says it; an aim held up by a figure no one can give says the compiler's reason. What the run DID
    // check is its own result, said apart from that reason: each limit on its own (Codex r1 #3719: no reader shows them).
    if (model.goals.length === 0) {
      const noAimIds = new Set(blockers.flatMap((b) => b.scope).filter((id) => !limitIds.has(id)));
      const waits = waitsOnWords(blockers, noAimIds);
      const cell = waits === undefined && waiting.length > 0 ? withheldCell() : { kind: 'withheld' as const, face: waits !== undefined && needsAnswer(blockers, noAimIds) ? NEEDS_ANSWER_FACE : NOT_SHOWN_FACE,
        why: waits !== undefined ? `The chance ${waits}.` : 'No aim is in this run, so there is no chance to show.', reasons: [{ code: 'no_goals', message: null }] };
      const checks = model.limits.length > 0
        ? ` This run checks only the limits, each on its own: ${model.limits.map((l) => `${measuredBy(l)} within its limit: ${limitShown(o, l)}`).join('; ')}.` : '';
      return { option_id: o.option_id, main_driver: notRecorded, cell: { ...cell, why: `${cell.why}${checks}` } };
    }
    if (waiting.length > 0 || jointWords === undefined) return { option_id: o.option_id, cell: withheldCell(), main_driver: notRecorded };
    const headline = o.joint_within_limits;
    if (isWithheld(headline)) return { option_id: o.option_id, cell: outsideCell(headline), main_driver: notRecorded };
    const s = shown(headline, result.draws)!;
    const why = headline.precision_95[0] === headline.precision_95[1] ? fixedWhy(o, headline.chance === 1) : undefined;
    const cell: PresentCell = { kind: 'figure', display: s.display,
      face: `${q(name)}: ${s.display} chance of ${jointWords}, in this model, ${basisWords(upstream(roots, o.option_id), optionPremises(o.option_id), [...model.goals, ...model.limits].map((c) => c.id))}${why !== undefined ? `: ${why}` : ''}.`
        + (model.limits.length > 0 ? ` Each limit on its own: ${limitLines(o).join('; ')}.` : '')
        + (uncheckedLine !== undefined ? ` ${stop(uncheckedLine)}` : ''),
      detail: { precision_95: headline.precision_95, draws: result.draws, precision_words: s.precision_words } };
    return { option_id: o.option_id, cell, main_driver: mainDriverOf(o) };
  });

  // ── The detail said once beside the chances ───────────────────────────────────────────────────────────────────────────
  const notes: string[] = [
    ...result.options.flatMap((o) => o.per_goal.flatMap((g) => (isWithheld(g)
      ? [`${q(allGoals.find((x) => x.goal_id === g.goal_id)?.label ?? g.goal_id)} with ${q(optionLabel.get(o.option_id) ?? o.option_id)} is not shown: in ${g.withheld.count.toLocaleString('en-GB')} of ${result.draws.toLocaleString('en-GB')} simulated draws ${listWords(g.withheld.quantities.map((id) => q(label(id) ?? id)))} could not be worked out.`]
      : []))),
    ...waiting.map((g) => stop(`${q(g.label)} ${goalWaits(g)}`)),
    // The 11 Oct decision (:74): what the chance covers (the measured aims it uses) and what it leaves out (aims with no
    // measure, the model's left-out records); never a claim that it covers everything.
    ...(covered.length > 0 && notCovered.length > 0 ? [`Covers: ${listWords(covered)} · Leaves out: ${listWords(notCovered.map(q))}`] : []),
    ...notInRun.map((w) => `The ${w.kind} ${q(w.label)} is not in this run: ${w.reason}`),
    ...(uncheckedLine !== undefined ? [stop(uncheckedLine)] : []),
  ];
  const several = allGoals.length >= 2;
  const perTarget = !several ? [] : model.goals.flatMap((g) => {
    const words = goalWords.get(g.id);
    if (words === undefined) return [];
    return [{ constraint_id: g.id, words: `${words}, in this model, ${sharedBasisWords([g.quantity, g.target, ...(g.per !== undefined ? [g.per] : [])], premisesOf([g.id]), [g.id])}`,
      options: result.options.flatMap((o) => {
        const s = shown(o.per_goal.find((x) => x.goal_id === g.id)!, result.draws);
        return s === undefined ? [] : [{ option_id: o.option_id, display: s.display }];
      }) }];
  });
  const goal_chance = {
    ...(jointWords !== undefined && waiting.length === 0 ? { chance_words: `chance of ${jointWords}` } : {}),
    ...(notes.length > 0 ? { notes } : {}),
    ...(several ? { targets: {
      joint: waiting.length === 0 && jointWords !== undefined ? { status: 'licensed' as const, words: jointWords }
        : { status: 'withheld' as const, line: `The chance of meeting all ${allGoals.length} goals together waits for ${listWords(waiting.map((g) => q(g.label)))}; each goal that can be worked out is shown on its own.` },
      per_target: perTarget,
    } } : {}),
    // Each limit's own chance per option (additive; the DGAI reads the words in the cell and the notes).
    ...(model.limits.length > 0 ? { limits: model.limits.flatMap((l, i) => limitWords[i] === undefined ? [] : [{ constraint_id: l.id, words: limitWords[i]!,
      options: result.options.flatMap((o) => {
        const s = shown(o.per_limit.find((x) => x.limit_id === l.id)!, result.draws);
        return s === undefined ? [] : [{ option_id: o.option_id, display: s.display }];
      }) }]) } : {}),
    ...(unchecked.length > 0 ? { unchecked_limits: unchecked.map((l, i) => ({ limit_id: l.limit_id, words: uncheckedWords[i]! })) } : {}),
    ...((input.blockers ?? []).length > 0 ? { waits_on: input.blockers!.map((b) => ({ ...b, label: inlineWords(b.label) })) } : {}),
  };
  // ── Which option is most likely to achieve the goal, in this model (Paul 6 and 14 Oct: say it; never choose for them) ──
  const leader = ((): PresentedLeader | undefined => {
    if (waiting.length > 0 || jointWords === undefined || options.length < 2) return undefined;
    const said = options.flatMap((o, at) => {
      const c = result.options[at]!.joint_within_limits;
      return o.cell.kind === 'figure' && !isWithheld(c) ? [{ id: o.option_id, at, c: c as Chance, display: o.cell.display, driver: o.main_driver }] : [];
    });
    if (said.length < options.length) return undefined;
    const ranked = [...said].sort((a, b) => b.c.chance - a.c.chance || a.at - b.at), top = ranked[0]!, rest = ranked.slice(1);
    const name = (id: string): string => q(optionLabel.get(id) ?? id);
    const basis = sharedBasisWords(roots, [...new Map([...premisesOf(model.goals.map((g) => g.id)), ...model.limits.flatMap((l) => input.limit_premises?.[l.id] ?? [])]
      .map((p) => [p.id, p] as const)).values()], [...model.goals, ...model.limits].map((c) => c.id));
    // A limit the Run could not check stays beside the finding, as it does beside each chance.
    const unsaid = uncheckedLine !== undefined ? ` ${stop(uncheckedLine)}` : '';
    // Too close to call: an option whose simulation precision reaches the highest chance's (every chance is on the same draws).
    const close = new Set(rest.filter((x) => top.c.precision_95[0] <= x.c.precision_95[1]).map((x) => x.id));
    if (close.size > 0) {
      const tied = said.filter((x) => x.id === top.id || close.has(x.id));
      return { licence: 'withheld', option_id: null, goal_chance_leader: null, similar_option_ids: tied.map((x) => x.id),
        words: `In this model, ${listWords(tied.map((x) => `${name(x.id)} (${x.display})`))} are too close to call: the simulation cannot tell apart their chances of ${jointWords}, ${basis}.${unsaid}` };
    }
    const next = rest[0]!, aim = model.goals.length === 1 ? 'the goal' : 'every goal together', d = top.driver;
    const there = (e: End): string => e.display ?? 'could not be tested';
    const rests = d.kind === 'available'
      ? ` Its chance is most sensitive to ${q(label(d.driver.quantity) ?? d.driver.quantity)} ${whoseRange(d.driver.author)}: ${there(d.driver.low)} at its low end, ${there(d.driver.middle)} at its middle and ${there(d.driver.high)} at its high end.`
      : d.kind === 'none_licensed' ? ` ${d.reason}` : '';
    return { licence: 'permitted', option_id: null, goal_chance_leader: top.id, similar_option_ids: [],
      words: `In this model, ${name(top.id)} is the option most likely to achieve ${aim}: ${top.display} chance of ${jointWords}, against ${next.display} for ${name(next.id)}, the next most likely, ${basis}.`
        + (top.c.precision_95[1] < 0.5 ? ` Even so, in this model it is more likely to miss ${aim} than to meet it.` : '') + rests + unsaid };
  })();
  const known = input.current !== undefined && input.run !== undefined;
  return {
    schema: 'canonical_analysis_view.v1', source: 'stored_run_facts',
    run: input.run ?? null,
    staleness: {
      stale: known ? !input.current : null,
      revision: typeof input.revision === 'number' && Number.isSafeInteger(input.revision) && input.revision >= 0 ? input.revision : null,
      run_revision: null, basis: 'analysis_graph_hash_interim', reason: null,
      limitation: known ? 'Hash equality cannot detect brief, framing or stage changes.' : 'Currentness is unknown because an analysis hash is unavailable.',
    },
    leader_licence: leader?.licence ?? 'withheld',
    ...(leader !== undefined ? { leader } : {}),
    options,
    ...(Object.keys(goal_chance).length > 0 ? { goal_chance } : {}),
  };
}

