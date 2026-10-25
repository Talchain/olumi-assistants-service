/**
 * CANONICAL MODEL → compile → simulate (seed fixed per scenario) → present → the display graph. PURE: the same
 * model, person's words and seed give the same result byte for byte, which is what a cold reopen relies on.
 *
 *  · compile (S1 `compile.ts`) against the person's own words, so a quote not in them stays UNVERIFIED;
 *  · simulate (S2) the executable subset, on the scenario's seed;
 *  · present (S2 `present.ts`) to the `canonical_analysis_view.v1` fields. No tipping threshold is searched (alpha G10): a grid
 *    of sampled points cannot show the goal flips once, so "at least X" would be unsupported. Re-enable only as a sampled
 *    crossing stated with its interval and its probes, under the admission limit;
 *  · project (S1 `project.ts`) to the GraphV3 display graph, every record shown, the calculation the compiled subset.
 * When nothing calculates yet (every measured goal waits, or the draft does not compile) there is no executable model to
 * present: the view then carries each option's withheld cell with what it waits on. Every view
 * lists what the result waits on (`goal_chance.waits_on`, S1's typed blockers, by label); the code writes no question.
 */
import { createHash } from 'node:crypto';
import { isApproximate, normalise, compile, shadowLabel, type Blocker, type CompileResult } from '../model-program/compile.js';
import type { CanonicalModelT } from '../model-program/canonical.js';
import { project, type Projection } from '../model-program/project.js';
import type { ExecutableModel } from '../model-program/executable.js';
import { costOf, simulate } from '../model-program/simulate/simulate.js';
import type { SimResult } from '../model-program/simulate/result.js';
import {
  driverSweepEvaluations, needsAnswer, presentAnalysisView, waitsOnWords, type PresentAsk, type PresentBlocker, type PresentGoal, type PresentQuantity,
  type PresentedAnalysisView,
} from '../model-program/present/present.js';

export const RUN_DRAWS = 10_000;
/**
 * THE RUN'S ADMISSION LIMIT (alpha G11), headline and driver sweep together, checked before anything is allocated. Measured
 * 25 Oct on the Mac at 30 to 50 million evaluations a second (bakery and club, 52 and 260 weeks): about 2 s there, and about
 * 5 s on staging at a third of that speed. A Run over it is refused by name; a sweep that would pass it is not run.
 */
export const MAX_EVALUATIONS = 80_000_000;
export const MAX_BYTES = 64 * 1024 * 1024;

/** The scenario's seed: fixed per scenario (its id's sha256, first 32 bits), saved with the model. */
export function seedOf(scenarioId: string): number {
  return createHash('sha256').update(`model_program:${scenarioId}`, 'utf8').digest().readUInt32BE(0);
}

export type Evaluation = {
  readonly compiled: CompileResult;
  readonly sim: SimResult | null;
  readonly view: PresentedAnalysisView | WaitingView;
  readonly projection: Projection;
};
/** The view when no executable model exists yet: every option withheld with what it waits on. */
export type WaitingView = {
  readonly schema: 'canonical_analysis_view.v1';
  readonly source: 'stored_run_facts';
  readonly run: null;
  readonly staleness: { readonly stale: null; readonly revision: null; readonly run_revision: null; readonly basis: 'analysis_graph_hash_interim'; readonly reason: null;
    readonly limitation: 'Currentness is unknown because an analysis hash is unavailable.' };
  readonly leader_licence: 'withheld';
  readonly options: readonly { readonly option_id: string; readonly cell: { readonly kind: 'withheld'; readonly face: string; readonly why: string;
    readonly reasons: readonly { readonly code: string; readonly message: string | null }[] }; readonly main_driver: { readonly kind: 'not_recorded' } }[];
  readonly goal_chance: { readonly notes: readonly string[]; readonly waits_on?: readonly PresentBlocker[] };
};

/** Labels and authors for every quantity the executable model reads, including the ids the compiler adds. */
function quantityMeta(model: CanonicalModelT, compiled: CompileResult, x: ExecutableModel): Record<string, PresentQuantity> {
  const m = normalise(model);
  const unverified = new Set(compiled.unverified.map((u) => u.id));
  // A quote not found in the person's words is never shown as theirs: S2 says "whose source is not confirmed" for it.
  const who = (author: 'person' | 'olumi' | 'structure', id: string): PresentQuantity['author'] => (author === 'person' && unverified.has(id) ? 'unverified' : author);
  const rel = new Map(m.relations.map((r) => [r.defines, r] as const));
  const own = new Map(m.quantities.map((q) => {
    const r = rel.get(q.id);
    return [q.id, { label: q.label, author: who(q.author, q.id), ...(r !== undefined ? { relation_author: who(r.author, r.id) } : {}), ...(isApproximate(q) ? { approximate: { quote: q.quote ?? String(q.value) } } : {}) }] as const;
  }));
  const goals = new Map(m.goals.map((g) => [g.id, g] as const));
  const out: Record<string, PresentQuantity> = {};
  for (const q of x.quantities) {
    const mine = own.get(q.id);
    // A figure the compiler converted (25 % → 0.25) is said in the unit it was given in.
    const percent = compiled.conversions.find((c) => c.kind === 'percent' && c.quantity === q.id);
    if (mine !== undefined) { out[q.id] = percent?.kind === 'percent' ? { ...mine, shown_in: { unit: percent.from, factor: percent.factor } } : mine; continue; }
    const [root, suffix] = q.id.split(/__(?=[a-z_]+$)/);
    const g = goals.get(root ?? '');
    if (g !== undefined && (suffix === 'change' || suffix === 'change_rel')) {
      const of = own.get(g.measure?.quantity ?? '')?.label ?? g.label;
      out[q.id] = { label: suffix === 'change' ? `Change in ${of}` : `Relative change in ${of}`, author: who(g.author, g.id), relation_author: who(g.author, g.id) };
      continue;
    }
    const base = own.get(root ?? '');
    if (base !== undefined) {
      const label = suffix === 'today' || suffix === 'sq' ? shadowLabel(base.label, suffix) : base.label;
      out[q.id] = { ...base, label };
    }
  }
  return out;
}

/** `brief`: the person's first words, so the display tells their brief's figures from the ones they gave later. */
export function evaluateCanonical(model: CanonicalModelT, opts: { readonly sourceText: string; readonly seed: number; readonly draws?: number; readonly brief?: string }): Evaluation {
  const compiled = compile(model, { sourceText: opts.sourceText });
  const projection = project(model, compiled, opts.brief !== undefined ? { brief: opts.brief } : {});
  const labelOf = new Map(normalise(model).goals.map((g) => [g.id, g.label] as const));
  // Aims with no measure yet are left out of the chance (said in `leaves_out`), never a goal that waits.
  const goals: PresentGoal[] = compiled.perGoal.filter((p) => !p.needs_measure)
    .map((p) => ({ goal_id: p.goal_id, label: labelOf.get(p.goal_id) ?? p.goal_id, status: p.status, reasons: p.reasons, asks: p.asks }));
  const blockers = blockersOf(model, compiled.blockers);
  const asks: PresentAsk[] = normalise(model).quantities.filter((q) => blockers.some((b) => b.answer?.quantity_id === q.id))
    .map((q) => ({ quantity_id: q.id, label: q.label, unit: q.unit }));
  const leaves_out = compiled.joint.leaves_out.map((id) => labelOf.get(id) ?? id);

  const x = compiled.executable;
  if (x === null) {
    return { compiled, sim: null, projection, view: waitingView(model, compiled, goals, blockers) };
  }
  const draws = opts.draws ?? RUN_DRAWS, cost = costOf(x, draws);
  if (cost.evaluations > MAX_EVALUATIONS || cost.bytes > MAX_BYTES) {
    return { compiled, sim: null, projection, view: waitingView(model, compiled, goals, blockers, tooLarge(model, x)) };
  }
  const sim = simulate(x, { seed: opts.seed, draws });
  // A limit, option or risk left out of this run is said by S2's present itself (S1's `executable.withheld`, r3).
  const view = presentAnalysisView({ model: x, result: sim, quantities: quantityMeta(model, compiled, x), goals, asks, blockers, leaves_out,
    left_out: model.left_out.map((r) => ({ text: r.text, concerns: r.concerns })), sweep: cost.evaluations + driverSweepEvaluations(x, draws) <= MAX_EVALUATIONS });
  return { compiled, sim, projection, view };
}

/**
 * The compiler's blockers with their labels, in its order: a quantity's answer box fills that quantity; a measure, a deadline or
 * an aim is answered in the chat (null). Labels only: what to ask, and how, is the AI's.
 */
function blockersOf(model: CanonicalModelT, list: readonly Blocker[]): PresentBlocker[] {
  const m = normalise(model);
  const labelOf = new Map<string, string>([...m.quantities, ...m.goals, ...m.limits].map((r) => [r.id, r.label] as const));
  const isQuantity = new Set(m.quantities.map((q) => q.id));
  const basisOf = new Map(m.quantities.map((q) => [q.id, q.basis] as const));
  // An `unknown` is no one's to answer yet: no answer box (so no ask), and its own basis says why.
  return list.map((b) => ({ id: b.id, code: b.code, label: b.code === 'no_goal' ? 'The result you want' : labelOf.get(b.id) ?? b.id, scope: b.scope,
    answer: isQuantity.has(b.id) && b.code !== 'unknown' ? { quantity_id: b.id } : null,
    ...(b.code === 'unknown' && typeof basisOf.get(b.id) === 'string' && basisOf.get(b.id)!.trim() !== '' ? { basis: basisOf.get(b.id)! } : {}) }));
}

const sentence = (x: string): string => (/[.?!]$/.test(x) ? x : `${x}.`);
const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
/** Why a Run over the admission limit is not worked out, and what brings it within reach. */
const tooLarge = (m: CanonicalModelT, x: ExecutableModel): string => `This model is too large to work out in one run: ${count(x.periods, m.period)} ahead for `
  + `${count(x.options.length, 'option')}. Counting in longer periods, looking less far ahead or comparing fewer options brings it within reach.`;

function waitingView(model: CanonicalModelT, compiled: CompileResult, goals: readonly PresentGoal[], blockers: readonly PresentBlocker[], refused?: string): WaitingView {
  const m = normalise(model);
  const live = m.options.filter((o) => o.status === 'live');
  const failing = compiled.errors.length > 0;
  const limitIds = new Set(m.limits.map((l) => l.id));
  // What the chance waits on, from the compiler's typed blockers only (S4): the measured aims' and THIS option's own (its
  // setting or timing, batch 4 hiring-r1); with no measured aim, every blocker not a limit's alone (an aim's measure, or the
  // result they want). A figure no one can give has no blocker: the compiler's own reason for it is said.
  const cellOf = (optionId: string) => {
    const own = compiled.perOption.find((p) => p.option_id === optionId);
    const ids = goals.length > 0 ? new Set([...goals.map((g) => g.goal_id), optionId])
      : new Set(blockers.flatMap((b) => b.scope).filter((id) => !limitIds.has(id)));
    const waits = waitsOnWords(blockers, ids);
    const withheldWhy = [...goals.filter((g) => g.status === 'withheld').flatMap((g) => g.reasons), ...(own?.reasons ?? [])].join(' ');
    const why = refused !== undefined ? refused : failing ? 'The model does not compile yet, so no chance can be worked out.'
      : waits !== undefined ? `The chance ${waits}.` : withheldWhy || 'The chance cannot be worked out yet.';
    return { kind: 'withheld' as const, face: refused === undefined && waits !== undefined && !failing && needsAnswer(blockers, ids) ? 'Not shown yet: needs your answer' : 'Chance not shown yet', why,
      reasons: refused !== undefined ? [{ code: 'too_large', message: refused }] : failing ? [{ code: 'does_not_compile', message: compiled.errors.slice(0, 5).map((e) => e.message).join(' ') }]
        : goals.filter((g) => g.status !== 'calculable').map((g) => ({ code: g.status === 'asks' ? 'goal_asks' : 'goal_withheld', message: g.reasons.join(' ') || null })) };
  };
  const ids = live.length > 0 ? live.map((o) => o.id) : ['as_stated'];
  return {
    schema: 'canonical_analysis_view.v1', source: 'stored_run_facts', run: null,
    staleness: { stale: null, revision: null, run_revision: null, basis: 'analysis_graph_hash_interim', reason: null, limitation: 'Currentness is unknown because an analysis hash is unavailable.' },
    leader_licence: 'withheld',
    options: ids.map((option_id) => ({ option_id, cell: cellOf(option_id), main_driver: { kind: 'not_recorded' as const } })),
    goal_chance: { notes: [...(refused !== undefined ? [refused] : []), ...goals.filter((g) => g.status !== 'calculable').map((g) => sentence(`‘${g.label}’ ${waitsOnWords(blockers, new Set([g.goal_id])) ?? `is not in the chance yet: ${g.reasons.join(' ')}`}`)),
    ], ...(blockers.length > 0 ? { waits_on: blockers } : {}) },
  };
}

/** Per option, the numbers behind the view: each goal's chance, the joint, within the limits, both together. */
export function chancesOf(sim: SimResult | null): unknown {
  return sim === null ? null : sim.options.map((o) => ({ option_id: o.option_id, per_goal: o.per_goal, joint: o.joint, within_limits: o.within_limits,
    joint_within_limits: o.joint_within_limits, outcomes: o.outcomes }));
}
