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
import type { ExecutableModel, Goal, Limit, Quantity, Window } from '../executable.js';
import { rangeLaw } from '../simulate/range-law.js';
import { isWithheld, type ChanceOrWithheld, type OptionResult, type SimResult, type Withheld } from '../simulate/result.js';
import { readingOf, simulate, type AggregationX } from '../simulate/simulate.js';

type Author = 'person' | 'olumi';

/** The canonical model's label and author for a quantity (S1 `CanonicalQuantity`), and the author of the relation defining it. */
export interface PresentQuantity {
  readonly label: string;
  readonly author: Author;
  readonly relation_author?: Author;
}
/** S1's `GoalOutcome`, with the goal's label: every goal, calculable or not. */
export interface PresentGoal {
  readonly goal_id: string;
  readonly label: string;
  readonly status: 'calculable' | 'asks' | 'withheld';
  readonly reasons: readonly string[];
  readonly asks: readonly string[];
}
/** S1's `Ask`. */
export interface PresentAsk {
  readonly quantity_id: string;
  readonly label: string;
  readonly unit: string;
  readonly question: string;
}
/** How to try a value for a goal's one asked quantity: the model compiled with it filled (S1 `fillQuantity` then `compile`). */
export interface TippingProbe {
  readonly build: (value: number) => ExecutableModel | null;
  /** The asked quantity's natural domain, in its unit. Default from 0 upward, with no upper end. */
  readonly domain?: readonly [number, number];
}
export interface PresentInput {
  readonly model: ExecutableModel;
  readonly result: SimResult;
  readonly quantities: Readonly<Record<string, PresentQuantity>>;
  /** Every goal (S1 `perGoal` with labels). Absent: the executable model's goals are all the goals. */
  readonly goals?: readonly PresentGoal[];
  readonly asks?: readonly PresentAsk[];
  /** Aims left out of the chance because they have no measure yet, by label (S1 `joint.leaves_out`). */
  readonly leaves_out?: readonly string[];
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
  };
}

const NEEDS_ANSWER_FACE = 'Not shown yet: needs your answer';
const NOT_SHOWN_FACE = 'Chance not shown yet';
const TIPPING_DRAWS = 4000;

function listWords(parts: readonly string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
const q = (label: string): string => `‘${label.trim()}’`;
/** A figure in its unit; a pure number (unit "1") is said alone. */
const say = (value: number, unit: string): string => (unit.trim() === '' || unit.trim() === '1' ? sayFigureAsWritten(value, '') : sayFigureAsWritten(value, unit));
const plural = (unit: string, n: number): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

/**
 * The horizon, counted from now, with the aggregation (DL ruling 1). Interval k is "month k+1"; boundary k is "the end of
 * month k". So a flow over {start, periods} reads months start+1 … start+periods, and a state reads their ends.
 */
function horizonWords(aggregation: AggregationX, w: Window, unit: string, reading: 'state' | 'flow'): string {
  const first = w.start_period + 1, last = w.start_period + w.periods;
  const state = reading === 'state';
  if (aggregation === 'end' || first === last) return state ? `at ${plural(unit, last)} from now` : `in ${unit} ${last} from now`;
  const months = `${unit}s ${first} to ${last} from now`;
  if (aggregation === 'sum') return state ? `added up at the ends of ${months}` : `in total over ${months}`;
  if (aggregation === 'mean') return state ? `on average at the ends of ${months}` : `on average per ${unit} over ${months}`;
  if (aggregation === 'max') return state ? `at its highest at the ends of ${months}` : `in its highest ${unit} of ${months}`;
  if (aggregation === 'min') return state ? `at its lowest at the ends of ${months}` : `in its lowest ${unit} of ${months}`;
  return state ? `at the end of every ${unit} from ${unit} ${first} to ${unit} ${last} from now` : `in every ${unit} from ${unit} ${first} to ${unit} ${last} from now`;
}

/** The labelled result for an option's chance: display at the simulation's own precision, and the precision's words. */
function shown(c: ChanceOrWithheld, draws: number): { display: string; precision_words: string } | undefined {
  if (isWithheld(c)) return undefined;
  const [lo, hi] = c.precision_95;
  const display = sayDisplayedPct(displayedPctAt(c.chance, displayRoundingFor(((hi - lo) / 2) * 100)));
  const pct = (x: number): string => `${Number((x * 100).toFixed(1))}%`;
  const precision_words = lo === hi
    ? 'Simulation precision: exact. Every simulated draw gives the same result for this option, so no sampling is involved.'
    : `Simulation precision: ${pct(lo)} to ${pct(hi)}, from ${draws.toLocaleString('en-GB')} simulated draws. This is how exactly the simulation measured the chance, not a range the chance could take.`;
  return { display, precision_words };
}

export function presentAnalysisView(input: PresentInput): PresentedAnalysisView {
  const { model, result } = input;
  const byId = new Map(model.quantities.map((x) => [x.id, x] as const));
  const meta = (id: string): PresentQuantity | undefined => input.quantities[id];
  const label = (id: string): string | undefined => meta(id)?.label;
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
      const reading = rangeLaw(x.dist, { chance: model.risks.some((r) => r.occurrence === x.id) });
      const ends = `${say(x.dist.low, x.unit)} to ${say(x.dist.high, x.unit)}`;
      const whose = x.dist.basis === 'person_range' ? 'your range' : 'Olumi’s own estimated range';
      if (reading.kind === 'normal') return [`${name} follows Olumi’s provisional conversion of ${whose}, ${ends}, into a bell-shaped spread`];
      return reading.kind === 'point' && x.dist.basis !== 'person_range' ? [`${name} is ${say(reading.value, x.unit)}, Olumi’s estimate`] : [];
    }
    if (x.dist?.kind === 'fixed') {
      return m?.author === 'person' ? [] : [`${name} is ${say(x.dist.value, x.unit)}${m?.author === 'olumi' ? ', Olumi’s figure' : ', whose source is not confirmed'}`];
    }
    return m?.relation_author === 'person' ? [] : [`${name} follows ${m?.relation_author === 'olumi' ? 'Olumi’s assumed relationship' : 'a relationship whose source is not confirmed'}`];
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
    const figure = target.dist?.kind === 'fixed' ? say(target.dist.value, target.unit) : label(against) === undefined ? undefined : q(label(against)!);
    if (figure === undefined) return undefined;
    const aggregation = (c as { aggregation: AggregationX }).aggregation;
    return `${q(subject)} ${role === 'goal' ? 'being' : 'is'} ${bound} ${figure} ${horizonWords(aggregation, c.window, unit, readingOf(byId.get(c.quantity)!))}`;
  };
  const goalWords = new Map(model.goals.map((g) => [g.id, conditionWords(g, g.target, 'goal')] as const));
  const limitWords = model.limits.map((l) => conditionWords(l, l.bound, 'limit'));
  const allGoals: readonly PresentGoal[] = input.goals ?? model.goals.map((g) => ({ goal_id: g.id, label: label(g.quantity) ?? g.id, status: 'calculable', reasons: [], asks: [] }));
  const waiting = allGoals.filter((g) => g.status !== 'calculable');
  const sayable = [...goalWords.values(), ...limitWords].every((w) => w !== undefined);
  const leftOut = (input.leaves_out ?? []).length > 0 ? `, leaving out ${listWords(input.leaves_out!.map(q))}, which ${input.leaves_out!.length === 1 ? 'has' : 'have'} no measure yet` : '';
  const jointWords = sayable
    ? `${listWords(model.goals.map((g) => goalWords.get(g.id)!))}${limitWords.length > 0 ? `, while ${listWords(limitWords as string[])}` : ''}${leftOut}`
    : undefined;
  const roots = [...model.goals.flatMap((g) => [g.quantity, g.target]), ...model.limits.flatMap((l) => [l.quantity, l.bound])];

  // ── The thresholds: a goal waiting on exactly one asked quantity ─────────────────────────────────────────────────────────
  const askOf = new Map((input.asks ?? []).map((a) => [a.quantity_id, a] as const));
  const thresholds: PresentThreshold[] = waiting.flatMap((g) => {
    const probe = input.tipping?.[g.goal_id], ask = g.asks.length === 1 ? askOf.get(g.asks[0]!) : undefined;
    return probe === undefined || ask === undefined ? [] : tippingThresholds(g, ask, probe, result.seed, optionLabel);
  });

  // ── Cells ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const questions = waiting.flatMap((g) => g.asks.map((id) => askOf.get(id)?.question).filter((x): x is string => x !== undefined));
  const withheldCell = (): PresentCell => ({
    kind: 'withheld', face: questions.length > 0 ? NEEDS_ANSWER_FACE : NOT_SHOWN_FACE,
    why: waiting.length > 0
      ? `${listWords(waiting.map((g) => q(g.label)))} ${waiting.length === 1 ? 'waits' : 'wait'} for ${questions.length > 0 ? `your answer: ${questions.join(' ')}` : `${listWords(waiting.flatMap((g) => g.reasons))}`}`
      : 'The words for this chance cannot be said exactly, so it is not shown.',
    reasons: waiting.length > 0 ? waiting.map((g) => ({ code: g.status === 'asks' ? 'goal_asks' : 'goal_withheld', message: g.reasons.join(' ') || null }))
      : [{ code: 'words_not_sayable', message: null }],
  });
  /** DL ruling 3: a chance a nonfinite draw touched is withheld, typed, with its count and quantities; never a figure. */
  const outsideCell = (w: Withheld): PresentCell => ({
    kind: 'withheld', face: NOT_SHOWN_FACE,
    why: `In ${w.withheld.count.toLocaleString('en-GB')} of ${result.draws.toLocaleString('en-GB')} simulated draws ${listWords(w.withheld.quantities.map((id) => q(label(id) ?? id)))} could not be worked out (for example a division by zero), so this model cannot give the chance yet.`,
    reasons: [{ code: 'invalid_domain', message: `${w.withheld.count} draws; ${w.withheld.quantities.join(', ')}` }],
  });
  const options = result.options.map((o: OptionResult) => {
    const name = optionLabel.get(o.option_id) ?? o.option_id;
    const notRecorded = { kind: 'not_recorded' as const };
    if (waiting.length > 0 || jointWords === undefined) return { option_id: o.option_id, cell: withheldCell(), main_driver: notRecorded };
    const headline = o.joint_within_limits;
    if (isWithheld(headline)) return { option_id: o.option_id, cell: outsideCell(headline), main_driver: notRecorded };
    const s = shown(headline, result.draws)!;
    const cell: PresentCell = { kind: 'figure', display: s.display,
      face: `${q(name)}: ${s.display} chance of ${jointWords}, in this model, ${basisWords(upstream(roots, o.option_id))}.`,
      detail: { precision_95: headline.precision_95, draws: result.draws, precision_words: s.precision_words } };
    return { option_id: o.option_id, cell, main_driver: notRecorded };
  });

  // ── The detail said once beside the chances ───────────────────────────────────────────────────────────────────────────
  const notes: string[] = [
    // A range whose spread would draw across zero keeps its figure; the range stays with the model (mapper.ts:578's words).
    ...model.quantities.filter((x) => x.dist?.kind === 'range' && model.options.some((o) => upstream(roots, o.id).has(x.id))).flatMap((x) => {
      const d = x.dist as Extract<Quantity['dist'], { kind: 'range' }>;
      const reading = rangeLaw(d, { chance: model.risks.some((r) => r.occurrence === x.id) });
      return reading.kind === 'point' ? [`The calculation uses ${say(reading.value, x.unit)} for ${q(label(x.id) ?? x.id)}. The range, ${say(d.low, x.unit)} to ${say(d.high, x.unit)}, is kept with the model but is not used as a spread.`] : [];
    }),
    ...result.options.flatMap((o) => o.per_goal.flatMap((g) => (isWithheld(g)
      ? [`${q(allGoals.find((x) => x.goal_id === g.goal_id)?.label ?? g.goal_id)} with ${q(optionLabel.get(o.option_id) ?? o.option_id)} is not shown: in ${g.withheld.count.toLocaleString('en-GB')} of ${result.draws.toLocaleString('en-GB')} simulated draws ${listWords(g.withheld.quantities.map((id) => q(label(id) ?? id)))} could not be worked out.`]
      : []))),
    ...waiting.map((g) => `${q(g.label)} is not in the chance yet: ${g.asks.length > 0 ? listWords(g.asks.map((id) => askOf.get(id)?.question ?? q(id))) : g.reasons.join(' ')}`),
    ...thresholds.map((t) => t.words),
  ];
  const several = allGoals.length >= 2;
  const perTarget = !several ? [] : model.goals.flatMap((g) => {
    const words = goalWords.get(g.id);
    if (words === undefined) return [];
    return [{ constraint_id: g.id, words: `${words}, in this model, ${sharedBasisWords([g.quantity, g.target])}`,
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

