/**
 * ⭐ TRACK 3: THE STRESS ADAPTER (`stress_test`; brief v1.0, DL acceptance 21 Oct). "Where does this fail, does that depend
 * on our explanation, and which options withstand the stated challenges?" — on the person's own saved model, read-only.
 *
 *  · STRESSES ARE ASSUMPTIONS, NOT ACTIONS. Each stress is an item already in the living model — a link's effect or a
 *    factor's level — set to values the person (or Olumi, said so) wants tested. Options stay the person's interventions.
 *    The grid is every combination of each item's saved value and its tested values: a numerical design, never a belief
 *    that its points are equally likely, so nothing is averaged or counted across settings as a chance. EACH CELL IS THAT
 *    VARIANT RUN'S OWN CHANCE of meeting the goal, exactly as its result would show it, or why it is not shown (DL ruling B,
 *    21 Oct: ST1 compared PLoT's untyped `outcome.mean` with the raw target, so every side was wrong). A tested value never
 *    relabels its item: the item's attribution is also its existence belief in the mapper (stated → 1, Olumi's → 0.8,
 *    `mapper.ts` `OLUMI_EXISTS`), so relabelling would change what is computed. Whose value it is: `coordinates[].values_source`.
 *  · ONE NAMED ALTERNATIVE EXPLANATION. At most one added link from a factor, labelled, with its author, and under H1 it
 *    HOLDS (exists with probability 1: the hypothesis is "suppose this is so"). No probability is placed on either
 *    explanation and they are never combined; where they disagree the disagreement is the finding.
 *  · THE ONE RUN PATH, NOTHING PERSISTED. Each variant is the saved living model with those values, mapped by the core
 *    mapper and computed by `deps.runStressVariant` (the `run_analysis` handler on an in-memory snapshot, discarded:
 *    `handlers/stress-variant-run.ts`). Its cells are what that Run's result would show (`stressChancesOf`). The saved model must
 *    remap to exactly the saved graph (every Run input, e.g. a goal's deadline; display refs carried as the register route
 *    carries them), or H0 would not be the saved model: refused. The one tolerance is a named allow-list of attestation and
 *    display fields that change no number (`ATTESTATION_ONLY`, DL ruling 21 Oct): never a general "additive" rule, which
 *    would let a meaning change through (a goal threshold today's mapper admits that an older save lacks).
 *  · HONEST LIMITS. At most 16 variants and 60 s, one deadline that aborts a variant in flight; what did not run is
 *    `not_run`. A model changed during the test is `unavailable`, with no rows.
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

/** One option's chance in one variant's Run, as its result would show it (`stressChancesOf`, stress-variant-run.ts). */
export interface StressChance {
  /** The shown figure or range ("about 40%"), or null when not shown. */
  readonly display: string | null;
  /** The licence's own figure where it shows one figure: orders the lowest and highest only, never sent (DL ruling C). */
  readonly pct: number | null;
  /** It rests on Olumi's estimates. */
  readonly provisional: boolean;
  /** Why it is not shown, in the result's own words. */
  readonly not_shown: string | null;
}
export type StressVariantRows =
  | { readonly kind: 'rows'; readonly rows: ReadonlyMap<string, StressChance> }
  | { readonly kind: 'refused'; readonly reason: string };
export interface StressDeps {
  readonly dispatch: InternalDispatch;
  readonly runStressVariant?: (v: { readonly variantGraph: Rec; readonly seed: number; readonly signal: AbortSignal }) => Promise<StressVariantRows>;
  readonly now?: () => number;
}

export interface Coordinate {
  readonly item_id: string; readonly kind: 'link_effect' | 'factor_level'; readonly label: string; readonly unit: string | null;
  readonly saved: number; readonly values: readonly number[]; readonly values_source: 'user' | 'olumi';
}
export interface Hypothesis { readonly id: 'H0' | 'H1'; readonly label: string; readonly source: 'saved' | 'user' | 'olumi' }
export interface Variant { readonly hypothesis: 'H0' | 'H1'; readonly setting: Readonly<Record<string, number>>; readonly living: LivingModelT }
export interface Cell extends Partial<StressChance> {
  readonly hypothesis: 'H0' | 'H1'; readonly setting: Readonly<Record<string, number>>; readonly option_id: string;
  /** Why this variant did not run (no chance either way); absent when it ran. */
  readonly not_run?: string;
}

const signed = (sign: '+' | '-' | null, value: number) => (sign === '-' ? -1 : 1) * Math.abs(value) + 0;

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

/** Per option and explanation: the lowest and highest single figure across the settings tested, never averaged or combined. */
function chanceRange(cells: readonly Cell[], optionIds: readonly string[], hypotheses: readonly Hypothesis[]) {
  return Object.fromEntries(optionIds.map((o) => [o, hypotheses.map((h) => {
    const mine = cells.filter((c) => c.option_id === o && c.hypothesis === h.id);
    const figures = mine.filter((c) => typeof c.pct === 'number').sort((a, b) => a.pct! - b.pct!);
    const at = (c: Cell | undefined) => (c === undefined ? null : { chance: c.display, setting: c.setting });
    return { hypothesis: h.id, tested: mine.length, shown: mine.filter((c) => c.display != null).length,
      lowest: at(figures[0]), highest: at(figures[figures.length - 1]) };
  })]));
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
  if (!remapped.graph.nodes.some((n) => n.kind === 'goal')) return refused('no_goal');
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
  let ran = 0;
  for (const { v, graph } of variants) {
    const blank = (reason: string) => optionIds.forEach((o) => cells.push({ hypothesis: v.hypothesis, setting: v.setting, option_id: o, not_run: reason }));
    const left = deadline - now();
    if (left <= 0) { blank('time_limit'); continue; }
    const result = await withinTime(left, (signal) => runVariant({ variantGraph: graph, seed, signal }));
    if (result.kind !== 'rows') { blank(result.reason === 'time_limit' ? 'time_limit' : `variant_${result.reason}`); continue; }
    // Rows that settled after the deadline (a late timer) are not run, never counted.
    if (now() > deadline) { blank('time_limit'); continue; }
    ran += 1;
    for (const o of optionIds) cells.push({ hypothesis: v.hypothesis, setting: v.setting, option_id: o, ...(result.rows.get(o) ?? { display: null, pct: null, provisional: false, not_shown: null }) });
  }
  const after = await readSaved(deps, ctx.scenario_id);
  if (!isSavedRead(after) || after.identity !== saved.identity) return unavailable('model_changed_during_stress');
  return ok({
    model_identity: saved.identity, seed, persisted: false,
    coordinates: plan.coordinates, hypotheses: plan.hypotheses,
    variants_requested: plan.variants.length,
    variants_run: ran,
    incomplete: ran < plan.variants.length,
    cells: cells.map(({ pct: _figure, ...shown }) => shown), chance_range: chanceRange(cells, optionIds, plan.hypotheses),
    reading_rule: 'Each cell is that tested setting\'s own chance of meeting the goal, in this model, as its result would show it, '
      + 'or why it is not shown. The lowest and highest are across the settings tested: never averaged, and never a chance '
      + 'across settings, which are a numerical design, not equally likely. The two explanations are never combined, no option '
      + 'is ranked, and nothing was saved. Whose tested values these are: coordinates.values_source.',
  });
}
