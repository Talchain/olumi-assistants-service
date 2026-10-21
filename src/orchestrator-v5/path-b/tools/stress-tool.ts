/**
 * ⭐ TRACK 3: THE STRESS ADAPTER (`stress_test`; brief v1.0, DL acceptance 21 Oct). "Where does this fail, does that depend
 * on our explanation, and which options withstand the stated challenges?" — on the person's own saved model, read-only.
 *
 *  · STRESSES ARE ASSUMPTIONS, NOT ACTIONS. Each stress is an item already in the living model — a link's effect or a
 *    factor's level — set to values the person (or Olumi, said so) wants tested. Options stay the person's interventions.
 *    The grid is every combination of each item's saved value and its tested values: a numerical design, never a belief
 *    that its points are equally likely, so a count is "the average clears the target at k of n tested settings", never a
 *    chance. EVERY SIDE IS THE AVERAGE (Science, 21 Oct): a cell compares the option's average level with the target, so
 *    "average clears the target" is never "meets the goal" (an option can clear on average with a modest goal chance). A tested value never
 *    relabels its item: the item's attribution is also its existence belief in the mapper (stated → 1, Olumi's → 0.8,
 *    `mapper.ts` `OLUMI_EXISTS`), so relabelling would change what is computed. Whose value it is: `coordinates[].values_source`.
 *  · ONE NAMED ALTERNATIVE EXPLANATION. At most one added link from a factor, labelled, with its author, and under H1 it
 *    HOLDS (exists with probability 1: the hypothesis is "suppose this is so"). No probability is placed on either
 *    explanation and they are never combined; where they disagree the disagreement is the finding.
 *  · THE ONE RUN PATH, NOTHING PERSISTED. Each variant is the saved living model with those values, mapped by the core
 *    mapper and computed by `deps.runStressVariant` (the `run_analysis` handler on an in-memory snapshot, discarded:
 *    `handlers/stress-variant-run.ts`). Its rows are the licensed rows the structural challenge reads. The saved model must
 *    remap to exactly the saved graph (every Run input, e.g. a goal's deadline; display refs carried as the register route
 *    carries them), or H0 would not be the saved model: refused. The one tolerance is a named allow-list of attestation and
 *    display fields that change no number (`ATTESTATION_ONLY`, DL ruling 21 Oct): never a general "additive" rule, which
 *    would let a meaning change through (a goal threshold today's mapper admits that an older save lacks).
 *  · HONEST LIMITS. At most 16 variants and 60 s, one deadline that aborts a variant in flight; what did not run is
 *    `not_run`, never counted. An average within 4 standard errors of the target, or a target this Run does not license,
 *    is `too_close_to_call`, never counted as clearing. A model changed during the test is `unavailable`, with no rows.
 *    Model-relative wording only: no best, winner or recommendation.
 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod-v4';
import type { AgentToolContext } from '../../agent-lane/runtime/agent-tools.js';
import type { InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { LivingModel, type LivingModelT } from '../../../schemas/living-model.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import { mapLivingModel, savedGoal } from '../living-model/mapper.js';
import { livingViewOf } from '../living-model/view.js';
import { isNoModelYet, isSavedRead, readSaved } from './context-tool.js';
import { ok, refused, unavailable, type ToolOutcome } from './outcome.js';

export const STRESS_TEST = 'stress_test';
export const STRESS_MAX_VARIANTS = 16;
export const STRESS_MAX_WALL_MS = 60_000;
/** Standard errors an average must clear the target by before its side is stated. Fixed before any run. */
export const STRESS_Z = 4;

export const StressTestParams = z.object({
  /** Why the person asked, in a few words. */
  reason: z.string(),
  stresses: z.array(z.object({
    item_id: z.string().describe('The id of one link (its effect is tested) or one factor (its level is tested), from read_canonical_context.'),
    values: z.array(z.number()).describe("The values to test, in that item's own unit; a link's value is its signed effect per +1 of its source."),
    values_source: z.enum(['user', 'olumi']).describe('user when the person gave these values; olumi when Olumi proposed them.'),
  }).strict()).describe('One to three assumptions already in the model, each with the values to test together.'),
  alternative: z.object({
    label: z.string().describe('The alternative explanation in a few plain words, e.g. "growth-first loses repeat customers".'),
    from: z.string().describe('A factor id (an option acts through the factors it sets).'),
    to: z.string().describe("A factor id, or the goal aim's id."),
    value: z.number().describe("The proposed effect per +1 of `from`, in `to`'s unit."),
    sign: z.enum(['+', '-']),
    source: z.enum(['user', 'olumi']),
  }).strict().nullable().describe('At most one named alternative link, tested beside the saved explanation; null for none.'),
}).strict();
export type StressTestArgs = z.infer<typeof StressTestParams>;

type Rec = Record<string, unknown>;
/** The AVERAGE level against the target (never the goal chance): clears it, short of it, too close to call, or not run. */
type Side = 'average_clears' | 'average_short' | 'too_close_to_call' | 'not_run';
type Comparator = '>=' | '>' | '<=' | '<';

/** One option's licensed row from one variant, as `licensedOptionRows` reads it (structural-challenge-compare.ts). */
export interface StressRow { readonly goal: number | null; readonly mean: number | null; readonly sd: number | null; readonly n: number | null }
export type StressVariantRows =
  | { readonly kind: 'rows'; readonly rows: ReadonlyMap<string, StressRow>; readonly targetLicensed: boolean }
  | { readonly kind: 'refused'; readonly reason: string };
export interface StressDeps {
  readonly dispatch: InternalDispatch;
  readonly runStressVariant?: (v: { readonly variantGraph: Rec; readonly seed: number; readonly goalNodeId: string;
    readonly goalLevelTarget: number | null; readonly signal: AbortSignal }) => Promise<StressVariantRows>;
  readonly now?: () => number;
}

export interface Coordinate {
  readonly item_id: string; readonly kind: 'link_effect' | 'factor_level'; readonly label: string; readonly unit: string | null;
  readonly saved: number; readonly values: readonly number[]; readonly values_source: 'user' | 'olumi';
}
export interface Hypothesis { readonly id: 'H0' | 'H1'; readonly label: string; readonly source: 'saved' | 'user' | 'olumi' }
export interface Variant { readonly hypothesis: 'H0' | 'H1'; readonly setting: Readonly<Record<string, number>>; readonly living: LivingModelT }
export interface Cell {
  readonly hypothesis: 'H0' | 'H1'; readonly setting: Readonly<Record<string, number>>; readonly option_id: string;
  readonly average_level: number | null; readonly sd: number | null; readonly n: number | null;
  readonly side: Side; readonly margin: number | null; readonly reason: string | null;
}

const signed = (sign: '+' | '-' | null, value: number) => (sign === '-' ? -1 : 1) * Math.abs(value);

/** The coordinates, hypotheses and every variant, or the reason the request cannot be tested as asked. */
export function planStress(living: LivingModelT, args: StressTestArgs):
  { readonly coordinates: Coordinate[]; readonly hypotheses: Hypothesis[]; readonly variants: Variant[]; readonly alternativeLinkId: string | null }
  | { readonly refusal: string; readonly data?: Rec } {
  if (args.stresses.length < 1 || args.stresses.length > 3) return { refusal: 'stress_count_unsupported', data: { allowed: '1 to 3' } };
  const labelOf = (id: string) => living.factors.find((f) => f.id === id)?.label ?? living.options.find((o) => o.id === id)?.label
    ?? living.aims.find((a) => a.id === id)?.text ?? id;
  const coordinates: Coordinate[] = [];
  for (const s of args.stresses) {
    if (coordinates.some((c) => c.item_id === s.item_id)) return { refusal: 'stress_item_repeated', data: { item_id: s.item_id } };
    const link = living.links.find((l) => l.id === s.item_id);
    const factor = living.factors.find((f) => f.id === s.item_id);
    const saved = link !== undefined ? (link.effect.value === null ? null : signed(link.effect.sign, link.effect.value))
      : factor !== undefined ? factor.value : undefined;
    if (saved === undefined) return { refusal: 'stress_item_unknown', data: { item_id: s.item_id } };
    if (saved === null) return { refusal: 'stress_item_not_sized', data: { item_id: s.item_id } };
    const values = [...new Set(s.values)].filter((v) => Number.isFinite(v) && v !== saved);
    if (values.length < 1 || values.length > 4) return { refusal: 'stress_values_unsupported', data: { item_id: s.item_id, allowed: '1 to 4 values other than the saved one' } };
    coordinates.push(link !== undefined
      ? { item_id: s.item_id, kind: 'link_effect', label: `${labelOf(link.from)} → ${labelOf(link.to)}`, unit: link.effect.unit, saved, values, values_source: s.values_source }
      : { item_id: s.item_id, kind: 'factor_level', label: factor!.label, unit: factor!.unit, saved, values, values_source: s.values_source });
  }
  const hypotheses: Hypothesis[] = [{ id: 'H0', label: 'The saved model', source: 'saved' }];
  const alt = args.alternative;
  if (alt !== null) {
    // From a factor only: the mapper lowers an option's own link onto a switch factor (`<option>__on`, `mapper.ts`), which
    // this grid does not track, so that is refused rather than guessed.
    const fromOk = living.factors.some((f) => f.id === alt.from);
    const toFactor = living.factors.find((f) => f.id === alt.to);
    const toAim = living.aims.find((a) => a.id === alt.to && a.target !== null);
    if (!fromOk || (toFactor === undefined && toAim === undefined)) return { refusal: 'alternative_endpoint_unknown', data: { from: alt.from, to: alt.to } };
    if (living.links.some((l) => l.from === alt.from && l.to === alt.to)) return { refusal: 'alternative_duplicates_link', data: { from: alt.from, to: alt.to } };
    hypotheses.push({ id: 'H1', label: alt.label, source: alt.source });
  }
  // A temporary id no saved link has, so H1's "it holds" touches only the added link.
  const ids = new Set(living.links.map((l) => l.id));
  let alternativeLinkId: string | null = null;
  if (alt !== null) for (let i = 0; alternativeLinkId === null || ids.has(alternativeLinkId); i += 1) alternativeLinkId = `stress_alternative_${i}`;
  let grid: Record<string, number>[] = [{}];
  for (const c of coordinates) grid = grid.flatMap((g) => [c.saved, ...c.values].map((v) => ({ ...g, [c.item_id]: v })));
  if (grid.length * hypotheses.length > STRESS_MAX_VARIANTS) {
    return { refusal: 'stress_budget_exceeded', data: { requested: grid.length * hypotheses.length, allowed: STRESS_MAX_VARIANTS } };
  }
  const variants: Variant[] = [];
  for (const h of hypotheses) {
    for (const setting of grid) {
      const v = structuredClone(living);
      for (const c of coordinates) {
        const value = setting[c.item_id];
        if (value === c.saved) continue;
        // Attribution kept (it is the existence belief); the quote stated the saved figure, so it no longer applies.
        if (c.kind === 'link_effect') {
          v.links = v.links.map((l) => (l.id !== c.item_id ? l : { ...l, quote: null,
            // A tested value is a point: a range link is tested at each value as a point (Olumi's illustrative spread, said).
            effect: { ...l.effect, form: l.effect.form === 'range' ? 'point' : l.effect.form, value: Math.abs(value),
              sign: value < 0 ? '-' : value > 0 ? '+' : l.effect.sign, low: null, high: null } }));
        } else {
          v.factors = v.factors.map((f) => (f.id !== c.item_id ? f : { ...f, quote: null, value, low: null, high: null }));
        }
      }
      if (h.id === 'H1' && alt !== null) {
        const unit = living.factors.find((f) => f.id === alt.to)?.unit ?? living.aims.find((a) => a.id === alt.to)?.target?.unit ?? null;
        v.links = [...v.links, { id: alternativeLinkId!, from: alt.from, to: alt.to, source: alt.source, party: null, quote: null,
          effect: { form: 'point', value: Math.abs(alt.value), low: null, high: null, unit, sd: null, sign: alt.sign } }];
      }
      const parsed = LivingModel.safeParse(v);
      if (!parsed.success) return { refusal: 'variant_invalid', data: { hypothesis: h.id } };
      variants.push({ hypothesis: h.id, setting, living: parsed.data });
    }
  }
  return { coordinates, hypotheses, variants, alternativeLinkId };
}

/** The average's side of the target, stated only beyond STRESS_Z standard errors; an exact level (sd 0) is compared exactly. */
export function sideOf(row: StressRow | undefined, target: number | null, comparator: Comparator, targetLicensed: boolean):
  Pick<Cell, 'side' | 'margin' | 'reason'> {
  if (row === undefined || row.mean === null || row.sd === null || row.n === null || row.n <= 0) return { side: 'too_close_to_call', margin: null, reason: 'not_computed' };
  if (target === null || !targetLicensed) return { side: 'too_close_to_call', margin: null, reason: 'target_not_licensed' };
  const higher = comparator === '>=' || comparator === '>';
  const margin = higher ? row.mean - target : target - row.mean;
  const se = row.sd / Math.sqrt(row.n);
  if (se === 0) return { side: (comparator === '>' || comparator === '<' ? margin > 0 : margin >= 0) ? 'average_clears' : 'average_short', margin, reason: null };
  if (Math.abs(margin) <= STRESS_Z * se) return { side: 'too_close_to_call', margin, reason: 'within_precision' };
  return { side: margin > 0 ? 'average_clears' : 'average_short', margin, reason: null };
}

const key = (h: string, s: Readonly<Record<string, number>>) => `${h}|${JSON.stringify(Object.entries(s).sort())}`;

/** Per option over the REQUESTED variants; the most favourable average per setting; joint shortfalls; where explanations differ. */
export function summariseStress(coordinates: readonly Coordinate[], hypotheses: readonly Hypothesis[], optionIds: readonly string[],
  cells: readonly Cell[], comparator: Comparator) {
  const higher = comparator === '>=' || comparator === '>';
  const better = (a: number, b: number) => (higher ? a > b : a < b);
  const byVariant = new Map<string, Cell[]>();
  for (const c of cells) byVariant.set(key(c.hypothesis, c.setting), [...(byVariant.get(key(c.hypothesis, c.setting)) ?? []), c]);
  const regret = new Map<string, number[]>(optionIds.map((o) => [o, []]));
  const leading: { hypothesis: string; setting: Readonly<Record<string, number>>; options: string[] }[] = [];
  for (const row of byVariant.values()) {
    const complete = optionIds.every((o) => row.some((c) => c.option_id === o && c.average_level !== null && c.sd !== null && c.n !== null));
    if (!complete) continue;
    const lv = (o: string) => row.find((c) => c.option_id === o)!;
    const top = optionIds.reduce((a, b) => (better(lv(b).average_level!, lv(a).average_level!) ? b : a));
    const seOf = (c: Cell) => c.sd! / Math.sqrt(c.n!);
    leading.push({ hypothesis: row[0].hypothesis, setting: row[0].setting,
      options: optionIds.filter((o) => Math.abs(lv(o).average_level! - lv(top).average_level!) <= STRESS_Z * Math.hypot(seOf(lv(o)), seOf(lv(top)))) });
    for (const o of optionIds) regret.get(o)!.push(Math.abs(lv(top).average_level! - lv(o).average_level!));
  }
  const options = Object.fromEntries(optionIds.map((o) => {
    const mine = cells.filter((c) => c.option_id === o);
    const levels = mine.flatMap((c) => (c.average_level === null ? [] : [c.average_level]));
    return [o, {
      requested: mine.length,
      average_clears: mine.filter((c) => c.side === 'average_clears').length,
      average_short: mine.filter((c) => c.side === 'average_short').length,
      too_close_to_call: mine.filter((c) => c.side === 'too_close_to_call').length,
      not_run: mine.filter((c) => c.side === 'not_run').length,
      worst_tested_average: levels.length === 0 ? null : higher ? Math.min(...levels) : Math.max(...levels),
      max_tested_average_regret: regret.get(o)!.length === byVariant.size && byVariant.size > 0 ? Math.max(...regret.get(o)!) : null,
    }];
  }));
  const saved = Object.fromEntries(coordinates.map((c) => [c.item_id, c.saved]));
  const witnesses: { hypothesis: string; option_id: string }[] = [];
  if (coordinates.length >= 2) {
    const first = Object.fromEntries(coordinates.map((c) => [c.item_id, c.values[0]]));
    const single = coordinates.map((c) => ({ ...saved, [c.item_id]: c.values[0] }));
    for (const h of hypotheses) {
      for (const o of optionIds) {
        const at = (s: Record<string, number>) => byVariant.get(key(h.id, s))?.find((c) => c.option_id === o)?.side;
        // The average clears the target at the saved setting and under each stress alone, and falls short when all hit.
        if (at(saved) === 'average_clears' && single.every((s) => at(s) === 'average_clears') && at(first) === 'average_short') witnesses.push({ hypothesis: h.id, option_id: o });
      }
    }
  }
  const disagreements = hypotheses.length < 2 ? [] : cells.filter((c) => c.hypothesis === 'H0').flatMap((c0) => {
    const c1 = byVariant.get(key('H1', c0.setting))?.find((c) => c.option_id === c0.option_id);
    const determinate = (s: Side | undefined) => s === 'average_clears' || s === 'average_short';
    return c1 !== undefined && determinate(c0.side) && determinate(c1.side) && c0.side !== c1.side
      ? [{ option_id: c0.option_id, setting: c0.setting, saved_model: c0.side, alternative: c1.side }] : [];
  });
  return { options, most_favourable_average_per_setting: leading, joint_shortfall_witnesses: witnesses, explanation_disagreements: disagreements };
}

function goalOf(graph: unknown): { id: string; target: number | null; comparator: Comparator } | undefined {
  const nodes = (graph as { nodes?: unknown })?.nodes;
  const goal = Array.isArray(nodes) ? nodes.find((n) => (n as Rec)?.kind === 'goal') as Rec | undefined : undefined;
  if (goal === undefined || typeof goal.id !== 'string') return undefined;
  const target = typeof goal.goal_threshold_raw === 'number' && Number.isFinite(goal.goal_threshold_raw) ? goal.goal_threshold_raw : null;
  const comparator = (['>=', '>', '<=', '<'] as const).find((c) => c === goal.goal_direction) ?? '>=';
  return { id: goal.id, target, comparator };
}

/** The mapped variant as a core save would store it (display refs carried from the saved graph, as the register route
 *  does: `assist.v1.scenario-graph-register.ts` withEntityRefs); under H1 the added alternative HOLDS (the mapper gives
 *  Olumi's own link 0.8). `withheld`: what the mapper holds back; `drawn`: edges it carries as stated, never its placeholder. */
function variantGraph(v: Variant, saved: unknown, alternativeLinkId: string | null): { graph: Rec; withheld: ReadonlySet<string>; drawn: ReadonlySet<string> } {
  const mapped = mapLivingModel(v.living, savedGoal(saved));
  const edges = mapped.graph.edges.map((e) => (v.hypothesis === 'H1' && e.id === alternativeLinkId ? { ...e, exists_probability: 1 } : e));
  return { graph: asStored({ ...mapped.graph, edges, living_model: v.living }, saved), withheld: new Set(mapped.withheld.map((w) => w.id)),
    drawn: new Set(mapped.graph.edges.filter((e) => e.defaulted !== true).map((e) => String(e.id))) };
}

/** A write as the register route stores it: the saved graph's display refs carried (`entity-refs.ts`: identity only). */
const asStored = (graph: Rec, saved: unknown): Rec => assignEntityRefs(graph, saved).graph;

/**
 * Attestation and display fields that change no number (DL ruling 21 Oct): a save that differs from today's reading of
 * its model ONLY in these still runs (e.g. a save from before #3544 labelled the person's settings `extractionType`).
 * Named paths only; any other added, missing or different field refuses.
 */
const ATTESTATION_ONLY = { graph: ['ref_high_water'], node: ['ref'], observedState: ['extractionType'], intervention: ['extractionType'] } as const;

function withoutAttestation(inputs: Rec): Rec {
  const drop = (o: Rec, keys: readonly string[]): Rec => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
  const isRec = (x: unknown): x is Rec => x !== null && typeof x === 'object' && !Array.isArray(x);
  const out = drop(inputs, ATTESTATION_ONLY.graph);
  if (!Array.isArray(out.nodes)) return out;
  return { ...out, nodes: (out.nodes as unknown[]).map((n) => {
    if (!isRec(n)) return n;
    const node = drop(n, ATTESTATION_ONLY.node);
    if (isRec(node.observed_state)) node.observed_state = drop(node.observed_state, ATTESTATION_ONLY.observedState);
    if (isRec(node.interventions)) {
      node.interventions = Object.fromEntries(Object.entries(node.interventions).map(([id, x]) => [id, isRec(x) ? drop(x, ATTESTATION_ONLY.intervention) : x]));
    }
    return node;
  }) };
}

/** Every Run input of a saved graph, the living model aside (it is compared through its own mapping). */
function runInputs(graph: unknown): Rec {
  const inputs: Rec = { ...(graph as Rec) };
  delete inputs.living_model;
  return inputs;
}

/** One variant inside the time left: past it the variant is aborted (PLoT through the handler's turn signal) and not run. */
async function withinTime(ms: number, run: (signal: AbortSignal) => Promise<StressVariantRows>): Promise<StressVariantRows> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<StressVariantRows>((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve({ kind: 'refused', reason: 'time_limit' }); }, ms);
  });
  try {
    return await Promise.race([run(controller.signal).catch((): StressVariantRows => ({ kind: 'refused', reason: 'failed' })), late]);
  } finally {
    clearTimeout(timer);
  }
}

export async function stressTest(deps: StressDeps, ctx: Pick<AgentToolContext, 'scenario_id'>, args: StressTestArgs): Promise<ToolOutcome> {
  const runVariant = deps.runStressVariant;
  if (runVariant === undefined) return unavailable('stress_unavailable');
  const now = deps.now ?? (() => Date.now());
  const deadline = now() + STRESS_MAX_WALL_MS;
  const saved = await readSaved(deps, ctx.scenario_id);
  if (!isSavedRead(saved)) return isNoModelYet(saved) ? refused('no_model_yet') : saved;
  if (saved.identity === null) return unavailable('read_malformed');
  const view = livingViewOf(saved.graph);
  if (view === undefined || !('withheld' in view)) return refused('not_a_core_scenario');
  const living = view.living_model as LivingModelT;
  const plan = planStress(living, args);
  if ('refusal' in plan) return refused(plan.refusal, undefined, plan.data);
  // Every variant is remapped by today's mapper, so the saved model must remap to what is saved: else H0 is not it.
  const remapped = mapLivingModel(living, savedGoal(saved.graph));
  const todays = withoutAttestation(runInputs(asStored(remapped.graph, saved.graph)));
  if (!isDeepStrictEqual(withoutAttestation(runInputs(saved.graph)), todays)) return refused('saved_graph_not_reproducible');
  const goal = goalOf(remapped.graph);
  if (goal === undefined) return refused('no_goal');
  const variants = plan.variants.map((v) => ({ v, ...variantGraph(v, saved.graph, plan.alternativeLinkId) }));
  // Each tested item must REACH the Run, never a silent no-op: the mapper withholds it in no variant, and the variant that
  // changes it alone differs from the saved graph (an option's own link reaches it as that option's setting, e.g. the
  // exact sum's `<goal>__change`; a held link or a placeholder ignores the value). The alternative must be drawn as stated.
  // Compared with TODAY's reading of the saved model, so an older save's missing labels never pass for a change.
  const alone = (c: Coordinate) => variants.find(({ v }) => v.hypothesis === 'H0'
    && plan.coordinates.every((d) => (d.item_id === c.item_id ? v.setting[d.item_id] !== d.saved : v.setting[d.item_id] === d.saved)));
  const notMapped = [
    ...plan.coordinates.filter((c) => {
      const only = alone(c);
      return only === undefined || variants.some(({ withheld }) => withheld.has(c.item_id)) || isDeepStrictEqual(withoutAttestation(runInputs(only.graph)), todays);
    }).map((c) => c.item_id),
    ...(variants.some(({ v, withheld, drawn }) => v.hypothesis === 'H1' && plan.alternativeLinkId !== null
      && (withheld.has(plan.alternativeLinkId) || !drawn.has(plan.alternativeLinkId))) ? ['alternative'] : []),
  ];
  if (notMapped.length > 0) return refused('stress_item_not_mapped', undefined, { item_ids: [...new Set(notMapped)] });
  const seed = parseInt(createHash('sha256').update(saved.identity).digest('hex').slice(0, 7), 16);
  const optionIds = living.options.map((o) => o.id);
  const cells: Cell[] = [];
  for (const { v, graph } of variants) {
    const blank = (side: Side, reason: string) => optionIds.forEach((o) => cells.push({ hypothesis: v.hypothesis, setting: v.setting,
      option_id: o, average_level: null, sd: null, n: null, side, margin: null, reason }));
    const left = deadline - now();
    if (left <= 0) { blank('not_run', 'time_limit'); continue; }
    const target = goalOf(graph)?.target ?? null;
    const result = await withinTime(left, (signal) => runVariant({ variantGraph: graph, seed, goalNodeId: goal.id, goalLevelTarget: target, signal }));
    if (result.kind !== 'rows') { blank('not_run', result.reason === 'time_limit' ? 'time_limit' : `variant_${result.reason}`); continue; }
    // Rows that settled after the deadline (a late timer) are not run, never counted.
    if (now() > deadline) { blank('not_run', 'time_limit'); continue; }
    for (const o of optionIds) {
      const row = result.rows.get(o);
      cells.push({ hypothesis: v.hypothesis, setting: v.setting, option_id: o, average_level: row?.mean ?? null, sd: row?.sd ?? null, n: row?.n ?? null,
        ...sideOf(row, target, goal.comparator, result.targetLicensed) });
    }
  }
  const after = await readSaved(deps, ctx.scenario_id);
  if (!isSavedRead(after) || after.identity !== saved.identity) return unavailable('model_changed_during_stress');
  const summary = summariseStress(plan.coordinates, plan.hypotheses, optionIds, cells, goal.comparator);
  return ok({
    model_identity: saved.identity, seed, persisted: false,
    goal: { id: goal.id, target: goal.target, comparator: goal.comparator },
    coordinates: plan.coordinates, hypotheses: plan.hypotheses,
    variants_requested: plan.variants.length,
    variants_run: new Set(cells.filter((c) => c.side !== 'not_run').map((c) => key(c.hypothesis, c.setting))).size,
    incomplete: cells.some((c) => c.side === 'not_run'),
    cells, ...summary,
    reading_rule: 'Every side compares the option\'s AVERAGE level with the target: "average clears the target" never means '
      + '"meets the goal" (an option can clear on average with a modest chance of meeting it). Each count is tested settings, '
      + 'never a chance. Too close to call is never counted as clearing. No option is ranked across settings, the two '
      + 'explanations are never combined, and nothing was saved. Whose tested values these are: coordinates.values_source.',
  });
}
