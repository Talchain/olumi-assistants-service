/**
 * PRESENT (spike S2): ExecutableModel + SimResult → the `canonical_analysis_view.v1` fields the DGAI reads on core
 * (DGAI `src/canvas/runView/canonicalAnalysisView.ts:2-69` types, `:106-158` parser, read at staging 18625f84). Pure.
 *
 * What it says, and what it never says:
 *   - Each option's CELL is its chance of meeting every goal together, within the limits, on the SAME draws (the
 *     simulator's `joint_within_limits`), shown with the screen's existing rounding (`displayRoundingFor`, `displayedPctAt`,
 *     `sayDisplayedPct`) at the simulation's own precision. The precision is said in `detail`, labelled as precision: how
 *     exactly the simulation measured the chance, never a range for the chance. No win share is computed or said.
 *   - Every chance's words restate its question: the quantity, the target with its unit, the horizon counted from now, the
 *     aggregation, and what is left out. They end with the BASIS: "on your figures" only when every input the chance rests on
 *     is the person's and no law was assumed; otherwise conditional, "if <Olumi's assumptions, listed>". Never a forecast.
 *   - Several goals: each goal's own chance per option (`per_target`), and the joint. A goal the compiler withheld (an ask
 *     or an unknown) is never folded into a partial joint: the joint is withheld with its reason, and only the goals the ask
 *     feeds wait (DL ruling d). A goal waiting on exactly ONE asked quantity gets a THRESHOLD, found by bisection over that
 *     quantity in its natural domain, said as a threshold, never as a chance.
 *   - main_driver: the #87 reader `goalChanceDriverOf` needs ISL's driver block (its `resolved` / `below_resolution`
 *     status) and the Run's GraphV3 graph for authorship; this model has neither, so nothing is fed to it. The reader's own
 *     word for that is `{ kind: 'not_recorded' }`: DGAI's parser refuses the WHOLE view when `main_driver` is missing
 *     (canonicalAnalysisView.ts:128-129), so that, not a missing key, is how "absent" reaches the screen.
 *   - Every range is named as Olumi's provisional conversion (`rangeSpread`, mapper.ts:104-110) of the person's range, or of
 *     Olumi's own: the person's bounds stay theirs and are never called their probability law (DL ruling 4).
 *   - A chance the simulator withheld for a nonfinite draw (`invalid_domain`, DL ruling 3) is a withheld cell with its count
 *     and quantities, never a figure and never a failure.
 *   - Fields with nothing true to say are absent: no `leader` (no leader licence here; `leader_licence: 'withheld'`), no
 *     `status_quo`, no `historical_figures`. `run` is null and currentness unknown unless the caller passes the Run's facts.
 */
import { sayFigureAsWritten } from '../../agent-lane/say-figure.js';
import { comparatorWords } from '../../goal-target/goal-target-basis.js';
import { displayRoundingFor } from '../../goal-target/goal-chance-driver.js';
import { displayedPctAt } from '../../goal-target/goal-chance-display.js';
import { sayDisplayedPct } from '../../goal-target/goal-targets-joint.js';
import type { Aggregation, Cmp, ExecutableModel, FixedAuthor, Goal, Limit, Window } from '../executable.js';
import { rangeLaw, type RangeDist } from '../simulate/range-law.js';
import { isWithheld, type ChanceOrWithheld, type OptionResult, type SimResult, type WithheldChance } from '../simulate/result.js';
import { readingOf, simulate } from '../simulate/simulate.js';

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
}
/** S1's `GoalOutcome`, with the goal's label: every goal, calculable or not. */
export interface PresentGoal {
  readonly goal_id: string;
  readonly label: string;
  readonly status: 'calculable' | 'asks' | 'withheld';
  readonly reasons: readonly string[];
  readonly asks: readonly string[];
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
/** How to try a value for a goal's one asked quantity: the model compiled with it set to the value tried. */
export interface TippingProbe {
  readonly build: (value: number) => ExecutableModel | null;
  /** The asked quantity's natural domain, in its unit. Default from 0 upward, with no upper end. */
  readonly domain?: readonly [number, number];
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
  /** Per withheld goal id: how to probe its one asked quantity. */
  readonly tipping?: Readonly<Record<string, TippingProbe>>;
  /** The Run's own record. Absent: `run` is null. */
  readonly run?: { readonly run_id: string; readonly graph_hash_at_run: string; readonly computed_at: string };
  /** The caller's currentness check of this Run (graph hash equality). Absent: unknown. */
  readonly current?: boolean;
  readonly revision?: number;
}

export type PresentCell =
  | { readonly kind: 'figure'; readonly display: string; readonly face: string;
      readonly detail: { readonly precision_95: readonly [number, number]; readonly draws: number; readonly precision_words: string } }
  | { readonly kind: 'withheld'; readonly face: string; readonly why: string; readonly reasons: readonly { readonly code: string; readonly message: string | null }[] };
export interface PresentThreshold {
  readonly kind: 'threshold';
  readonly goal_id: string;
  readonly option_id: string;
  readonly quantity: string;
  readonly cmp: '>=' | '<=';
  readonly value: number;
  readonly words: string;
}
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
  readonly leader_licence: 'withheld';
  readonly options: readonly { readonly option_id: string; readonly cell: PresentCell; readonly main_driver: { readonly kind: 'not_recorded' } }[];
  readonly goal_chance?: {
    readonly chance_words?: string;
    readonly notes?: readonly string[];
    readonly targets?: {
      readonly joint: { readonly status: 'licensed'; readonly words: string } | { readonly status: 'withheld'; readonly line: string };
      readonly per_target: readonly { readonly constraint_id: string; readonly words: string;
        readonly options: readonly { readonly option_id: string; readonly display: string }[] }[];
    };
    readonly thresholds?: readonly PresentThreshold[];
    readonly limits?: readonly { readonly constraint_id: string; readonly words: string;
      readonly options: readonly { readonly option_id: string; readonly display: string }[] }[];
    readonly unchecked_limits?: readonly { readonly limit_id: string; readonly words: string }[];
    /** Everything the result waits on, by label, with the figure its answer box fills where there is one. */
    readonly waits_on?: readonly PresentBlocker[];
  };
}

/**
 * ONE REASON (simplify v1 S4): what a chance not shown yet waits on, said once from the compiler's typed blockers, by label,
 * in their order: the blockers holding up any of `ids` (a no-goal blocker holds up every chance). Undefined when none does:
 * the caller then says the compiler's own reason for a figure no one can give, never a sentence of its own.
 */
export function waitsOnWords(blockers: readonly PresentBlocker[], ids: ReadonlySet<string>): string | undefined {
  const said = blockers.filter((b) => b.code === 'no_goal' || b.scope.some((s) => ids.has(s))).map((b) => {
    const name = `‘${b.label.trim()}’`;
    switch (b.code) {
      case 'no_goal': return 'the result you want';
      case 'measure': return `a measure for ${name}`;
      case 'deadline': return `a deadline for ${name}`;
      case 'range_kind': return `how to read the range for ${name}`;
      case 'recount': return `${name} again`;
      case 'unknown': return `${name}, which no one can size yet${b.basis?.trim() ? ` (${b.basis.trim().replace(/[.!]+$/, '')})` : ''}`;
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
const TIPPING_DRAWS = 4000;

export function listWords(parts: readonly string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
const q = (label: string): string => `‘${label.trim()}’`;
/** A sentence's full stop, unless it already ends in one (a question keeps its "?"). */
const stop = (x: string): string => (/[.?!]$/.test(x) ? x : `${x}.`);
/** A figure in its unit; a pure number (unit "1") is said alone. */
const say = (value: number, unit: string): string => (unit.trim() === '' || unit.trim() === '1' ? sayFigureAsWritten(value, '') : sayFigureAsWritten(value, unit));
const plural = (unit: string, n: number): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

/**
 * The horizon, counted from now, with the aggregation (DL ruling 1). Interval k is "month k+1"; boundary k is "the end of
 * month k". So a flow over {start, periods} reads months start+1 … start+periods, and a state reads their ends.
 */
function horizonWords(aggregation: Aggregation, w: Window, unit: string, reading: 'state' | 'flow'): string {
  const first = w.start_period + 1, last = w.start_period + w.periods;
  const state = reading === 'state';
  if (aggregation === 'end' || first === last) return state ? `at ${plural(unit, last)} from now` : `in ${unit} ${last} from now`;
  const months = `${unit}s ${first} to ${last} from now`;
  if (aggregation === 'sum') return state ? `added up over ${months}, taking its level at the start of each ${unit}` : `in total over ${months}`;
  if (aggregation === 'mean') return state ? `on average at the ends of ${months}` : `on average per ${unit} over ${months}`;
  if (aggregation === 'max') return state ? `at its highest at the ends of ${months}` : `in its highest ${unit} of ${months}`;
  if (aggregation === 'min') return state ? `at its lowest at the ends of ${months}` : `in its lowest ${unit} of ${months}`;
  return state ? `at the end of every ${unit} from ${unit} ${first} to ${unit} ${last} from now` : `in every ${unit} from ${unit} ${first} to ${unit} ${last} from now`;
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
  /** `optionId`: through that option's sets; null: through no option's (the model every option shares). */
  const upstream = (roots: readonly string[], optionId: string | null): Set<string> => {
    const seen = new Set<string>();
    const todo = [...roots];
    while (todo.length > 0) {
      const id = todo.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const x = byId.get(id);
      if (x?.equation?.form === 'definition') todo.push(...x.equation.parts);
      if (x?.equation?.form === 'effect') todo.push(x.equation.base, ...x.equation.terms.flatMap((t) => [t.coefficient, t.driver]));
      if (x?.stock !== undefined) todo.push(x.stock.start, ...x.stock.inflows, ...x.stock.outflows);
      for (const o of model.options) if (o.id === optionId) for (const s of o.sets) if (s.quantity === id) todo.push(s.to);
      for (const r of model.risks) if (r.effect_on === id) todo.push(r.occurrence, r.severity);
    }
    return seen;
  };

  /** Olumi's assumptions among these quantities, in plain words, model order. Empty = every input is the person's. */
  const assumptions = (ids: ReadonlySet<string>): string[] => model.quantities.filter((x) => ids.has(x.id)).flatMap((x): string[] => {
    const name = q(label(x.id) ?? x.id), m = meta(x.id);
    if (x.dist?.kind === 'range') {
      // DL ruling 4: every range's law is Olumi's provisional conversion (`rangeSpread`, mapper.ts:104-110), never the person's
      // probability law; the person's bounds stay theirs and are named as such.
      // The PL's range law (AMEND): conditioned on the person's bounds, or on a domain, as the simulator draws it.
      const d: RangeDist = x.dist;
      const reading = rangeLaw(d, model.risks.some((r) => r.occurrence === x.id) ? { domain: { min: 0, max: 1 } } : {});
      const ends = `${sayOf(x.id, d.low, x.unit)} to ${sayOf(x.id, d.high, x.unit)}`;
      // DL ruling (author not recorded): a range whose basis is neither the person's nor Olumi's is listed as such, never
      // passed as the person's; `rangeLaw` draws it unbounded (only a person's stated bounds condition the draw).
      const unverified = m?.author === 'unverified';
      const whose = unverified ? `a range ${NOT_IN_THEIR_WORDS}` : d.basis === 'person_range' ? 'your range' : d.basis === 'olumi_estimate' ? 'Olumi’s own estimated range' : `a range ${NOT_RECORDED}`;
      if (reading.kind === 'point') {
        return d.basis === 'person_range' && !unverified ? [] : [`${name} is ${sayOf(x.id, reading.value, x.unit)}${unverified ? ` ${NOT_IN_THEIR_WORDS}` : d.basis === 'olumi_estimate' ? ', Olumi’s estimate' : ` ${NOT_RECORDED}`}`];
      }
      const held = reading.lower === d.low && reading.upper === d.high ? ', held within those bounds'
        : Number.isFinite(reading.lower) || Number.isFinite(reading.upper) ? ', kept to the values it can take' : '';
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
      if (m?.approximate !== undefined) return [`using ${sayOf(x.id, x.dist.value, x.unit)} for ${name} for now — you said ‘${m.approximate.quote}’`];
      return author !== undefined && NOT_ASSUMPTIONS.has(author) ? [] : [`${name} is ${sayOf(x.id, x.dist.value, x.unit)} ${NOT_RECORDED}`];
    }
    // S3 smoke fix 1: only an Olumi-authored EFFECT relation is an assumed relationship. A definition (an identity: a
    // product, a sum, a difference such as x − x for a zero start) and a stock's accumulation are never assumptions,
    // whoever wrote them; a unit conversion is a structural constant (above).
    // DL ruling (author not recorded): an effect relation with no recorded author is listed, never read as the person's.
    if (x.equation?.form !== 'effect' || m?.relation_author === 'person') return [];
    return [m?.relation_author === 'olumi' ? `${name} follows Olumi’s assumed relationship` : `${name} follows a relationship ${NOT_RECORDED}`];
  });
  const basisWords = (ids: ReadonlySet<string>): string => {
    const a = assumptions(ids);
    return a.length === 0 ? 'on your figures' : `if ${listWords(a)}`;
  };
  /**
   * A target's basis covers every option: the shared model's basis, then each option's own assumptions, named by option
   * ("on your figures; with ‘Raise’, if ‘New price’ is £59, Olumi’s figure").
   */
  const sharedBasisWords = (r: readonly string[]): string => {
    const shared = upstream(r, null), base = assumptions(shared);
    const own = model.options.flatMap((o) => {
      const extra = assumptions(new Set([...upstream(r, o.id)].filter((id) => !shared.has(id))));
      return extra.length === 0 ? [] : [`with ${q(optionLabel.get(o.id) ?? o.id)}, ${base.length > 0 ? 'also ' : ''}if ${listWords(extra)}`];
    });
    return [basisWords(shared), ...own].join('; ');
  };

  // ── The question each chance answers ────────────────────────────────────────────────────────────────────────────────────
  const conditionWords = (c: Goal | Limit, against: string, role: 'goal' | 'limit'): string | undefined => {
    const subject = label(c.quantity), bound = comparatorWords(c.cmp), target = byId.get(against);
    if (subject === undefined || bound === undefined || target === undefined) return undefined;
    // The level template of `targetChanceWords` (goal-target-basis.ts): ‘X’ being at least T; a limit's subject "is".
    const figure = target.dist?.kind === 'fixed' ? sayOf(against, target.dist.value, target.unit) : label(against) === undefined ? undefined : q(label(against)!);
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
  const waiting = allGoals.filter((g) => g.status !== 'calculable');
  /** Options and risks the compiler left out: said in the words of every chance, with their reasons in the notes. */
  const notInRun = (model.withheld ?? []).filter((w) => w.kind === 'option' || w.kind === 'risk');
  const sayable = [...goalWords.values(), ...limitWords].every((w) => w !== undefined);
  const leftOut = ((input.leaves_out ?? []).length > 0 ? `, leaving out ${listWords(input.leaves_out!.map(q))}, which ${input.leaves_out!.length === 1 ? 'has' : 'have'} no measure yet` : '')
    + (notInRun.length > 0 ? `, without ${listWords(notInRun.map((w) => `the ${w.kind} ${q(w.label)}`))}, which ${notInRun.length === 1 ? 'is' : 'are'} not in this run` : '');
  const covered = model.goals.flatMap((g) => (goalWords.get(g.id) !== undefined ? [goalWords.get(g.id)!] : []));
  const notCovered = [...(input.leaves_out ?? []), ...(input.left_out ?? []).map((r) => r.text)];
  const jointWords = sayable
    ? `${listWords(model.goals.map((g) => goalWords.get(g.id)!))}${limitWords.length > 0 ? `, while ${listWords(limitWords as string[])}` : ''}${leftOut}`
    : undefined;
  const roots = [...model.goals.flatMap((g) => [g.quantity, g.target, ...(g.per !== undefined ? [g.per] : [])]),
    ...model.limits.flatMap((l) => [l.quantity, l.bound, ...(l.per !== undefined ? [l.per] : [])])];

  // ── The thresholds: a goal waiting on exactly one asked quantity ─────────────────────────────────────────────────────────
  const askOf = new Map((input.asks ?? []).map((a) => [a.quantity_id, a] as const));
  const thresholds: PresentThreshold[] = waiting.flatMap((g) => {
    const probe = input.tipping?.[g.goal_id], ask = g.asks.length === 1 ? askOf.get(g.asks[0]!) : undefined;
    return probe === undefined || ask === undefined ? [] : tippingThresholds(g, ask, probe, result.seed, optionLabel);
  });

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
  /** "‘Customer cost’ is at most £1,100 at 1 month from now: about 81%", one per limit, for one option. */
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
   * that fixes it: "in every simulated draw ‘Weekly capacity’ is 80 ticket / week at 1 week from now, below 100 ticket / week".
   * A sampled 0 of N stays "less than 1%" (`shown`). Each goal or limit that decides it is named: the ones missed for 0%,
   * every one for 100%.
   */
  const MISSED: Record<Cmp, string> = { '>=': 'below', '>': 'not above', '<=': 'above', '<': 'not below' };
  const fixedLine = (c: Goal | Limit, against: string, value: number, met: boolean): string | undefined => {
    const subject = label(c.quantity), target = byId.get(against);
    if (subject === undefined || target?.dist?.kind !== 'fixed') return undefined;
    const of = c.per === undefined ? q(subject) : label(c.per) === undefined ? undefined : `${q(subject)} per ${q(label(c.per)!)}`;
    if (of === undefined) return undefined;
    const bound = met ? comparatorWords(c.cmp) : MISSED[c.cmp];
    return `${of} is ${sayOf(against, value, target.unit)}${c.no_deadline === true ? '' : ` ${whenWords(c)}`}, ${bound} ${sayOf(against, target.dist.value, target.unit)}`;
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
      face: `${q(name)}: ${s.display} chance of ${jointWords}, in this model, ${basisWords(upstream(roots, o.option_id))}${why !== undefined ? `: ${why}` : ''}.`
        + (model.limits.length > 0 ? ` Each limit on its own: ${limitLines(o).join('; ')}.` : '')
        + (uncheckedLine !== undefined ? ` ${stop(uncheckedLine)}` : ''),
      detail: { precision_95: headline.precision_95, draws: result.draws, precision_words: s.precision_words } };
    return { option_id: o.option_id, cell, main_driver: notRecorded };
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
    ...thresholds.map((t) => t.words),
  ];
  const several = allGoals.length >= 2;
  const perTarget = !several ? [] : model.goals.flatMap((g) => {
    const words = goalWords.get(g.id);
    if (words === undefined) return [];
    return [{ constraint_id: g.id, words: `${words}, in this model, ${sharedBasisWords([g.quantity, g.target, ...(g.per !== undefined ? [g.per] : [])])}`,
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
    ...(thresholds.length > 0 ? { thresholds } : {}),
    // Each limit's own chance per option (additive; the DGAI reads the words in the cell and the notes).
    ...(model.limits.length > 0 ? { limits: model.limits.flatMap((l, i) => limitWords[i] === undefined ? [] : [{ constraint_id: l.id, words: limitWords[i]!,
      options: result.options.flatMap((o) => {
        const s = shown(o.per_limit.find((x) => x.limit_id === l.id)!, result.draws);
        return s === undefined ? [] : [{ option_id: o.option_id, display: s.display }];
      }) }]) } : {}),
    ...(unchecked.length > 0 ? { unchecked_limits: unchecked.map((l, i) => ({ limit_id: l.limit_id, words: uncheckedWords[i]! })) } : {}),
    ...((input.blockers ?? []).length > 0 ? { waits_on: input.blockers } : {}),
  };
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
    leader_licence: 'withheld',
    options,
    ...(Object.keys(goal_chance).length > 0 ? { goal_chance } : {}),
  };
}

/**
 * The value of a goal's one asked quantity at which, in this model, the goal tips from not met to met, per option. Bisection
 * over the quantity's natural domain, on the Run's own seed (the same draws at every probe). Met = every draw meets it when
 * the rest of the model is fixed, else more draws meet it than not (said so). None where the goal does not tip exactly once
 * in the domain, or where a probe does not compile. A threshold is a value of the quantity, never a chance.
 */
export function tippingThresholds(goal: PresentGoal, ask: PresentAsk, probe: TippingProbe, seed: number,
  optionLabel: ReadonlyMap<string, string>): PresentThreshold[] {
  const [lo0, hi0] = probe.domain ?? [0, Infinity];
  const cache = new Map<number, { readonly result: SimResult; readonly exact: boolean } | null>();
  const probed = (v: number): { readonly result: SimResult; readonly exact: boolean } | null => {
    if (!cache.has(v)) {
      const m = probe.build(v);
      cache.set(v, m === null ? null : { result: simulate(m, { seed, draws: TIPPING_DRAWS }),
        exact: !m.quantities.some((x) => x.dist?.kind === 'range') && m.risks.length === 0 });
    }
    return cache.get(v)!;
  };
  const run = (v: number): SimResult | null => probed(v)?.result ?? null;
  const exact = (v: number): boolean => probed(v)?.exact === true;
  const metAt = (v: number, optionId: string): boolean | undefined => {
    const r = run(v);
    const g = r?.options.find((o) => o.option_id === optionId)?.per_goal.find((x) => x.goal_id === goal.goal_id);
    // A probe whose goal is withheld (a nonfinite draw) says nothing about the threshold.
    if (g === undefined || isWithheld(g)) return undefined;
    return exact(v) ? g.chance === 1 : g.chance >= 0.5;
  };
  const first = run(Number.isFinite(lo0) ? lo0 : 0);
  if (first === null) return [];
  return first.options.flatMap((o): PresentThreshold[] => {
    const met = (v: number) => metAt(v, o.option_id);
    let lo = lo0, hi = hi0;
    if (!Number.isFinite(hi)) {
      hi = Math.max(1, Math.abs(lo) * 2);
      while (met(hi) === met(lo) && hi < 1e15) hi *= 2;
    }
    const mLo = met(lo), mHi = met(hi);
    if (mLo === undefined || mHi === undefined || mLo === mHi) return [];
    // Exactly one crossing: a second change of state on a grid means no single threshold can be said.
    const grid = Array.from({ length: 11 }, (_, i) => lo + ((hi - lo) * i) / 10).map(met);
    if (grid.some((x) => x === undefined) || grid.slice(1).filter((x, i) => x !== grid[i]).length !== 1) return [];
    for (let i = 0; i < 200 && hi - lo > 1e-9 * Math.max(1, Math.abs(hi)); i++) {
      const mid = (lo + hi) / 2;
      if (met(mid) === mLo) lo = mid; else hi = mid;
    }
    // "At least" rounds up and "at most" rounds down, to three significant figures, so the threshold stays true.
    const up = mHi === true;
    let value = round3(up ? hi : lo, up);
    // A strict goal is not met AT its crossing: one more step on the met side.
    if (met(value) !== true) value = round3(value + (up ? 1 : -1) * stepOf(value), up);
    if (met(value) !== true) return [];
    const opt = q(optionLabel.get(o.option_id) ?? o.option_id);
    const verb = exact(value) ? 'is met' : 'is more likely met than not';
    return [{ kind: 'threshold', goal_id: goal.goal_id, option_id: o.option_id, quantity: ask.quantity_id, cmp: up ? '>=' : '<=', value,
      words: `Threshold: in this model, ${q(goal.label)} ${verb} with ${opt} if ${q(ask.label)} is ${up ? 'at least' : 'at most'} ${say(value, ask.unit)}.` }];
  });
}

const stepOf = (x: number): number => (x === 0 ? 1e-3 : 10 ** (Math.floor(Math.log10(Math.abs(x))) - 2));
function round3(x: number, up: boolean): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  const step = stepOf(x);
  // The bisection stops within 1e-9 of the crossing; a 1e-6 step tolerance keeps a crossing ON a step from rounding past it.
  const r = (up ? Math.ceil(x / step - 1e-6) : Math.floor(x / step + 1e-6)) * step;
  return Number(r.toPrecision(12));
}

