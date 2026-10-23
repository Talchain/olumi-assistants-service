/**
 * CANONICAL MODEL → compile → simulate (seed fixed per scenario) → present → the display graph. PURE: the same
 * model, person's words and seed give the same result byte for byte, which is what a cold reopen relies on.
 *
 *  · compile (S1 `compile.ts`) against the person's own words, so a quote not in them stays UNVERIFIED;
 *  · simulate (S2) the executable subset, on the scenario's seed;
 *  · present (S2 `present.ts`) to the `canonical_analysis_view.v1` fields; a goal waiting on one asked figure gets S2's
 *    tipping threshold, probed with S1's `fillQuantity` then `compile`;
 *  · project (S1 `project.ts`) to the GraphV3 display graph, every record shown, the calculation the compiled subset.
 * When nothing calculates yet (every measured goal waits, or the draft does not compile) there is no executable model to
 * present: the view then carries each option's withheld cell with the questions, and the thresholds alone.
 */
import { createHash } from 'node:crypto';
import { isApproximate, normalise, compile, type CompileResult } from '../model-program/compile.js';
import type { CanonicalModelT } from '../model-program/canonical.js';
import { fillQuantity } from '../model-program/answer.js';
import { project, type Projection } from '../model-program/project.js';
import type { ExecutableModel } from '../model-program/executable.js';
import { simulate } from '../model-program/simulate/simulate.js';
import type { SimResult } from '../model-program/simulate/result.js';
import {
  presentAnalysisView, tippingThresholds, type PresentAsk, type PresentGoal, type PresentQuantity, type PresentThreshold,
  type PresentedAnalysisView, type TippingProbe,
} from '../model-program/present/present.js';

export const RUN_DRAWS = 10_000;
const PROBE_QUOTE = 'threshold probe';

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
/** The view when no executable model exists yet: every option withheld with its questions, and the thresholds. */
export type WaitingView = {
  readonly schema: 'canonical_analysis_view.v1';
  readonly source: 'stored_run_facts';
  readonly run: null;
  readonly staleness: { readonly stale: null; readonly revision: null; readonly run_revision: null; readonly basis: 'analysis_graph_hash_interim'; readonly reason: null;
    readonly limitation: 'Currentness is unknown because an analysis hash is unavailable.' };
  readonly leader_licence: 'withheld';
  readonly options: readonly { readonly option_id: string; readonly cell: { readonly kind: 'withheld'; readonly face: string; readonly why: string;
    readonly reasons: readonly { readonly code: string; readonly message: string | null }[] }; readonly main_driver: { readonly kind: 'not_recorded' } }[];
  readonly goal_chance: { readonly notes: readonly string[]; readonly thresholds?: readonly PresentThreshold[] };
};

/** Labels and authors for every quantity the executable model reads, including the ids the compiler adds. */
function quantityMeta(model: CanonicalModelT, compiled: CompileResult, x: ExecutableModel): Record<string, PresentQuantity> {
  const m = normalise(model);
  const unverified = new Set(compiled.unverified.map((u) => u.id));
  // A quote not found in the person's words is never shown as theirs: S2 says "whose source is not confirmed" for it.
  const who = (author: 'person' | 'olumi' | 'structure', id: string) => (author === 'person' && unverified.has(id) ? 'unverified' : author) as PresentQuantity['author'];
  const rel = new Map(m.relations.map((r) => [r.defines, r] as const));
  const own = new Map(m.quantities.map((q) => {
    const r = rel.get(q.id);
    return [q.id, { label: q.label, author: who(q.author, q.id), ...(r !== undefined ? { relation_author: who(r.author, r.id) } : {}), ...(isApproximate(q) ? { approximate: { quote: q.quote ?? String(q.value) } } : {}) }] as const;
  }));
  const goals = new Map(m.goals.map((g) => [g.id, g] as const));
  const out: Record<string, PresentQuantity> = {};
  for (const q of x.quantities) {
    const mine = own.get(q.id);
    if (mine !== undefined) { out[q.id] = mine; continue; }
    const [root, suffix] = q.id.split(/__(?=[a-z_]+$)/);
    const g = goals.get(root ?? '');
    if (g !== undefined && (suffix === 'change' || suffix === 'change_rel')) {
      const of = own.get(g.measure?.quantity ?? '')?.label ?? g.label;
      out[q.id] = { label: suffix === 'change' ? `Change in ${of}` : `Relative change in ${of}`, author: who(g.author, g.id), relation_author: who(g.author, g.id) };
      continue;
    }
    const base = own.get(root ?? '');
    if (base !== undefined) {
      const label = suffix === 'today' ? `${base.label} today` : suffix === 'sq' ? `${base.label} if carrying on as now` : base.label;
      out[q.id] = { ...base, label };
    }
  }
  return out;
}

function probeFor(model: CanonicalModelT, goalId: string, askId: string, sourceText: string): TippingProbe {
  return {
    build: (value: number) => {
      const filled = fillQuantity(model, askId, { value }, PROBE_QUOTE);
      if (!filled.ok) return null;
      const x = compile(filled.model, { sourceText }).executable;
      return x !== null && x.goals.some((g) => g.id === goalId) ? x : null;
    },
  };
}

/** `brief`: the person's first words, so the display tells their brief's figures from the ones they gave later. */
export function evaluateCanonical(model: CanonicalModelT, opts: { readonly sourceText: string; readonly seed: number; readonly draws?: number; readonly brief?: string }): Evaluation {
  const compiled = compile(model, { sourceText: opts.sourceText });
  const projection = project(model, compiled, opts.brief !== undefined ? { brief: opts.brief } : {});
  const labelOf = new Map(normalise(model).goals.map((g) => [g.id, g.label] as const));
  // Aims with no measure yet are left out of the chance (said in `leaves_out`), never a goal that waits.
  const goals: PresentGoal[] = compiled.perGoal.filter((p) => !p.needs_measure)
    .map((p) => ({ goal_id: p.goal_id, label: labelOf.get(p.goal_id) ?? p.goal_id, status: p.status, reasons: p.reasons, asks: p.asks }));
  const asks: PresentAsk[] = compiled.asks.map((a) => ({ quantity_id: a.quantity_id, label: a.label, unit: a.unit, question: a.question }));
  const tipping: Record<string, TippingProbe> = Object.fromEntries(goals.filter((g) => g.status === 'asks' && g.asks.length === 1)
    .map((g) => [g.goal_id, probeFor(model, g.goal_id, g.asks[0]!, opts.sourceText)] as const));
  const leaves_out = compiled.joint.leaves_out.map((id) => labelOf.get(id) ?? id);

  const x = compiled.executable;
  if (x === null) {
    return { compiled, sim: null, projection, view: waitingView(model, compiled, goals, asks, tipping, opts.seed) };
  }
  const sim = simulate(x, { seed: opts.seed, draws: opts.draws ?? RUN_DRAWS });
  // A limit, option or risk left out of this run is said by S2's present itself (S1's `executable.withheld`, r3).
  const view = presentAnalysisView({ model: x, result: sim, quantities: quantityMeta(model, compiled, x), goals, asks, leaves_out, tipping });
  return { compiled, sim, projection, view };
}

function waitingView(model: CanonicalModelT, compiled: CompileResult, goals: readonly PresentGoal[], asks: readonly PresentAsk[],
  tipping: Readonly<Record<string, TippingProbe>>, seed: number): WaitingView {
  const m = normalise(model);
  const live = m.options.filter((o) => o.status === 'live');
  const optionLabel = new Map(m.options.map((o) => [o.id, o.label] as const));
  const askOf = new Map(asks.map((a) => [a.quantity_id, a] as const));
  const failing = compiled.errors.length > 0;
  const questions = [...new Set(goals.flatMap((g) => g.asks.map((id) => askOf.get(id)?.question).filter((q): q is string => q !== undefined)))];
  const why = failing ? 'The model does not compile yet, so no chance can be worked out.'
    : questions.length > 0 ? `The chance waits for your answer: ${questions.join(' ')}` : goals.flatMap((g) => g.reasons).join(' ') || 'No aim has a measure yet.';
  const cell = { kind: 'withheld' as const, face: questions.length > 0 && !failing ? 'Not shown yet: needs your answer' : 'Chance not shown yet', why,
    reasons: failing ? [{ code: 'does_not_compile', message: compiled.errors.slice(0, 5).map((e) => e.message).join(' ') }]
      : goals.filter((g) => g.status !== 'calculable').map((g) => ({ code: g.status === 'asks' ? 'goal_asks' : 'goal_withheld', message: g.reasons.join(' ') || null })) };
  const thresholds = failing ? [] : goals.flatMap((g) => {
    const probe = tipping[g.goal_id];
    const ask = g.asks.length === 1 ? askOf.get(g.asks[0]!) : undefined;
    return probe === undefined || ask === undefined ? [] : tippingThresholds(g, ask, probe, seed, optionLabel);
  });
  const ids = live.length > 0 ? live.map((o) => o.id) : ['as_stated'];
  return {
    schema: 'canonical_analysis_view.v1', source: 'stored_run_facts', run: null,
    staleness: { stale: null, revision: null, run_revision: null, basis: 'analysis_graph_hash_interim', reason: null, limitation: 'Currentness is unknown because an analysis hash is unavailable.' },
    leader_licence: 'withheld',
    options: ids.map((option_id) => ({ option_id, cell, main_driver: { kind: 'not_recorded' as const } })),
    goal_chance: { notes: [...goals.filter((g) => g.status !== 'calculable').map((g) => `‘${g.label}’ is not in the chance yet: ${g.reasons.join(' ')}`),
      ...thresholds.map((t) => t.words)], ...(thresholds.length > 0 ? { thresholds } : {}) },
  };
}

/** Per option, the numbers behind the view: each goal's chance, the joint, within the limits, both together. */
export function chancesOf(sim: SimResult | null): unknown {
  return sim === null ? null : sim.options.map((o) => ({ option_id: o.option_id, per_goal: o.per_goal, joint: o.joint, within_limits: o.within_limits,
    joint_within_limits: o.joint_within_limits, outcomes: o.outcomes }));
}
