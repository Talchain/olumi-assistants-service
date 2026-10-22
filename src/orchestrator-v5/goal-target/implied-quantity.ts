/**
 * ⭐ ITEM 2 (DL 22 Oct; Paul's 80a77832): AN AIM WITH NO TARGET FIGURE STILL GETS WHAT THE MODEL IMPLIES. With no target there
 * is no chance of meeting one to show (`GOAL_FIGURES_NO_STATED_TARGET`), and a goal with no unit and no level cannot be sized
 * either, so the Run reads the sized quantity nearest the goal that every changing option moves, and says per option its
 * p10/p50/p90 in that quantity's own unit: what the model implies, as the model stands. Never a chance, a target or a rank.
 *  · The quantity: sized (the mapper's frame, with a unit), on EVERY changing option's path to the goal, and resting on no
 *    link nobody sized (`isPlaceholderLink`, anywhere upstream of it); the nearest such to the goal. None, or two equally
 *    near, gives nothing, with the reason. A goal the mapper can size is its own nearest quantity.
 *  · Bound to the SAME Run: one more engine read of the request this Run dispatched (its graph, options and seed) with that
 *    quantity as the analysis target, stored in this Run's own enrichment (`IMPLIED_QUANTITY_KEY`); never a second Run.
 *  · Units: the engine reads a level as `raw / cap` (`mapper.ts` frames). PLoT converts the target's figures back itself
 *    ONLY when some option's setting lies outside [0, 1] (`needsNormalisation`, PLoT staging b60fe4fb `routes/v2/run.ts`
 *    Phase 4a/5a), on the target's own cap (`deriveRange` rung 0); otherwise each figure is converted here with that cap.
 *    So the quantity must hold today's level on its own cap in the engine graph (Codex r1 on #3660: one rule, never twice).
 *  · Every option of the Run is read, or none is said; an unknown currency is never a range (DL constraint 1).
 */
import { isPlaceholderLink } from '../../cee/magnitude/link-sizing.js';
import { isUnnamedCurrencyUnit } from '../agent-lane/unnamed-currency.js';
import { actualMoveSeeds } from '../agent-lane/goal-certainty.js';
import { goalChanceEstimateCounts } from '../agent-lane/goal-chance-estimate-attribution.js';
import { mapLivingModel, savedGoal, type Frame } from '../path-b/living-model/mapper.js';
import { LivingModel } from '../../schemas/living-model.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Internal persisted enrichment (never on the UI transport keep-list): the scenario read serves it on its own key. */
export const IMPLIED_QUANTITY_KEY = '__cee_implied_quantity';

export type ImpliedQuantityWithheld =
  | 'no_changing_option' | 'no_sized_quantity_on_every_path' | 'nearest_quantity_tied' | 'engine_read_failed'
  | 'engine_read_incomplete' | 'estimates_unread';

export interface ImpliedRange { readonly p10: number; readonly p50: number; readonly p90: number }

export type ImpliedQuantity =
  | {
    readonly version: 1; readonly status: 'computed'; readonly node_id: string; readonly quantity: string; readonly unit: string;
    /** In the Run's option order, never sorted by value. */
    readonly by_option: Readonly<Record<string, ImpliedRange>>;
    readonly rests_on_olumi_estimates: boolean;
    /** The goal's declared deadline as the person wrote it; null when no time scope is declared. */
    readonly by_when: string | null;
  }
  | { readonly version: 1; readonly status: 'withheld'; readonly reason: ImpliedQuantityWithheld };

export interface ImpliedQuantityTarget { readonly node_id: string; readonly label: string; readonly unit: string; readonly cap: number }

const STRUCTURAL = new Set(['option', 'decision']);

/**
 * Each sized item's frame, and the aim's own stated deadline ("within 3 weeks"), from the stored graph's own living model;
 * undefined for a scenario with none (a legacy one). The deadline is read from the aim itself: with no target figure the
 * engine graph's goal carries none (DL 22 Oct: 80a77832 saved by_when with period_months null, and M4 must use it).
 */
export function livingFramesOf(graph: unknown):
  (ReadonlyMap<string, Frame> & { readonly byWhen?: string | null; readonly aimStatesFigure?: boolean }) | undefined {
  const living = LivingModel.safeParse(isRec(graph) ? graph.living_model : undefined);
  if (!living.success) return undefined;
  const goal = savedGoal(graph);
  const frames = mapLivingModel(living.data, goal).frames;
  const aim = living.data.aims.find((a) => a.id === goal.goal) ?? living.data.aims.find((a) => a.status === 'current');
  const byWhen = aim?.target?.by_when?.trim();
  // A target figure the person stated ("= £250,000") is a target, whatever the engine graph could project of it (Codex r1).
  const t = aim?.target;
  const aimStatesFigure = t != null && (t.value !== null || t.low !== null || t.high !== null);
  return Object.assign(new Map(frames), { byWhen: byWhen === undefined || byWhen === '' ? null : byWhen, aimStatesFigure });
}

/** The time scope the person declared, said as they wrote it: "within 3 weeks" as is, "March 2027" as "by March 2027". */
export function sayTimeScope(byWhen: string | null): string | null {
  if (byWhen === null) return null;
  return /^(by|within|in|before|over|during|at|until|on)\b/i.test(byWhen) ? byWhen : `by ${byWhen}`;
}

/** The quantity the Run reads (see the header), or why there is none. Pure. */
export function impliedQuantityTarget(graph: unknown, goalId: string, frames: ReadonlyMap<string, Frame>, optionIds: readonly string[],
  scoredInterventions?: ReadonlyMap<string, Record<string, unknown>>): ImpliedQuantityTarget | ImpliedQuantityWithheld {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const causal = (isRec(graph) && Array.isArray(graph.edges) ? graph.edges.filter(isRec) : []).filter((e) =>
    typeof e.from === 'string' && typeof e.to === 'string' && byId.has(e.from) && byId.has(e.to)
    && !STRUCTURAL.has(String(byId.get(e.from)!.kind)) && !STRUCTURAL.has(String(byId.get(e.to)!.kind)));
  const walk = (start: readonly string[], forward: boolean): Map<string, number> => {
    const seen = new Map<string, number>(start.map((id) => [id, 0]));
    for (let frontier = [...start], d = 1; frontier.length > 0; d++) {
      frontier = causal.filter((e) => frontier.includes(String(forward ? e.from : e.to))).map((e) => String(forward ? e.to : e.from))
        .filter((id) => !seen.has(id));
      for (const id of frontier) seen.set(id, d);
    }
    return seen;
  };
  const moved = [...actualMoveSeeds(graph, optionIds, scoredInterventions).values()].filter((seeds) => seeds.length > 0);
  if (moved.length === 0) return 'no_changing_option';
  const toGoal = walk([goalId], false);
  const reached = moved.map((seeds) => walk(seeds, true));
  // Sized: a named unit (never an unknown currency) and today's level held on its own cap, which is what PLoT scales by.
  const sized = (id: string) => {
    const f = frames.get(id);
    const level = byId.get(id)?.observed_state;
    return f !== undefined && f.cap > 0 && (f.unit ?? '').trim() !== '' && !isUnnamedCurrencyUnit(f.unit)
      && isRec(level) && level.cap === f.cap && finite(level.value);
  };
  const clean = (id: string) => { const cone = walk([id], false); return !causal.some((e) => cone.has(String(e.to)) && isPlaceholderLink(e)); };
  const candidates = [...toGoal.keys()].filter((id) => sized(id) && reached.every((r) => r.has(id)) && clean(id));
  if (candidates.length === 0) return 'no_sized_quantity_on_every_path';
  const nearest = Math.min(...candidates.map((id) => toGoal.get(id)!));
  const at = candidates.filter((id) => toGoal.get(id) === nearest);
  if (at.length > 1) return 'nearest_quantity_tied';
  const node = byId.get(at[0]!)!;
  const frame = frames.get(at[0]!)!;
  return { node_id: at[0]!, label: typeof node.label === 'string' && node.label.trim() !== '' ? node.label : at[0]!, unit: frame.unit!, cap: frame.cap };
}

/**
 * The implied quantity for one Run: the target, then ONE engine read of the dispatched request with that target (the same
 * graph, options and seed, so the same draws), converted back to the quantity's unit. A failed read is said, never thrown.
 */
export async function readImpliedQuantity(input: {
  readonly graph: unknown; readonly goalId: string; readonly frames: ReadonlyMap<string, Frame>; readonly optionIds: readonly string[];
  readonly scoredInterventions?: ReadonlyMap<string, Record<string, unknown>>;
  /** The request this Run dispatched, and the seed its draws used. */
  readonly dispatched: Readonly<Rec>; readonly seed: unknown;
  readonly run: (payload: Rec) => Promise<unknown>;
}): Promise<ImpliedQuantity> {
  const withheld = (reason: ImpliedQuantityWithheld): ImpliedQuantity => ({ version: 1, status: 'withheld', reason });
  const target = impliedQuantityTarget(input.graph, input.goalId, input.frames, input.optionIds, input.scoredInterventions);
  if (typeof target === 'string') return withheld(target);
  const d = input.dispatched;
  // The Run's own graph, options and draws; nothing about the goal (it has no target to score).
  const payload: Rec = { graph: d.graph, options: d.options, goal_node_id: target.node_id,
    ...(typeof d.request_id === 'string' ? { request_id: `${d.request_id}-implied` } : {}),
    ...(input.seed !== undefined ? { seed: input.seed } : {}), ...(d.n_samples !== undefined ? { n_samples: d.n_samples } : {}) };
  let envelope: unknown;
  try { envelope = await input.run(payload); } catch { return withheld('engine_read_failed'); }
  const rows = isRec(envelope) && Array.isArray(envelope.option_comparison) ? envelope.option_comparison.filter(isRec) : [];
  if (rows.length === 0) return withheld('engine_read_failed');
  // PLoT's own gate (see the header): already in the quantity's unit when it converted, else on its frame.
  const scale = plotConvertsOutcomes(d.options) ? 1 : target.cap;
  const by_option: Record<string, ImpliedRange> = {};
  for (const id of input.optionIds) {
    const o = rows.find((r) => r.option_id === id)?.outcome;
    if (!isRec(o) || !finite(o.p10) || !finite(o.p50) || !finite(o.p90)) return withheld('engine_read_incomplete');
    by_option[id] = { p10: o.p10 * scale, p50: o.p50 * scale, p90: o.p90 * scale };
  }
  // The census of the quantity's OWN inputs (its event alone, never the goal's), accepted estimates still Olumi's.
  const counts = goalChanceEstimateCounts(input.graph, input.optionIds, input.goalId, [target.node_id], { scoredInEvent: false });
  if (counts.unread) return withheld('estimates_unread');
  const frames = input.frames as { readonly byWhen?: string | null };
  return { version: 1, status: 'computed', node_id: target.node_id, quantity: target.label, unit: target.unit, by_option,
    rests_on_olumi_estimates: counts.links + counts.values + counts.acceptedLinks + counts.acceptedValues > 0
      || Object.values(counts.settingsByOption).some((n) => n > 0),
    by_when: frames.byWhen ?? null };
}

/** PLoT's `needsNormalisation`: does any option's setting lie outside [0, 1], so PLoT converts the outcomes back itself? */
export function plotConvertsOutcomes(options: unknown): boolean {
  return Array.isArray(options) && options.filter(isRec).some((o) => isRec(o.interventions) && Object.values(o.interventions)
    .some((cell) => { const v = isRec(cell) ? cell.value : cell; return finite(v) && (v < 0 || v > 1); }));
}

/** The stored record, read back strictly: anything else is absent. */
export function readStoredImpliedQuantity(enrichment: unknown): ImpliedQuantity | undefined {
  const r = isRec(enrichment) ? enrichment[IMPLIED_QUANTITY_KEY] : undefined;
  if (!isRec(r) || r.version !== 1) return undefined;
  if (r.status === 'withheld') return typeof r.reason === 'string' ? { version: 1, status: 'withheld', reason: r.reason as ImpliedQuantityWithheld } : undefined;
  if (r.status !== 'computed' || typeof r.node_id !== 'string' || typeof r.quantity !== 'string' || typeof r.unit !== 'string'
    || !isRec(r.by_option) || typeof r.rests_on_olumi_estimates !== 'boolean') return undefined;
  const by_option = Object.fromEntries(Object.entries(r.by_option).flatMap(([id, v]) =>
    isRec(v) && finite(v.p10) && finite(v.p50) && finite(v.p90) ? [[id, { p10: v.p10, p50: v.p50, p90: v.p90 }]] : []));
  return { version: 1, status: 'computed', node_id: r.node_id, quantity: r.quantity, unit: r.unit, by_option,
    rests_on_olumi_estimates: r.rests_on_olumi_estimates, by_when: typeof r.by_when === 'string' ? r.by_when : null };
}
