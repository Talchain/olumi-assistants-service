/**
 * ⭐ STEP 8 ROUTE A (DL-3 18 Oct; AIE 2500d66f `step8_science`; PL 17:35 / 17:42): A VALIDATED DEFINITION INTO THE GOAL IS
 * WORKED OUT EXACTLY, AS A SUM, NEVER DRAWN.
 *
 * A link the model already holds as a DEFINITION of the goal's own quantity (Science d5's `validatedDefinition`, the ONE shared
 * definition authority the Run's hold, the licence census, provenance and the canvas already read: a current ±1-per-1 carrier,
 * one unit at both ends, the source label holding the goal's quantity words) was sent to the engine as a causal link with a
 * spread. PLoT floors that spread (min 0.05, |β|/2), so an option whose stated change lands exactly on the target read 50%, not
 * 100% (STEP8-STATE, reproduced). The existing exact mechanism is the goal's `sum` identity (ISL `_identity_value`: the parts
 * are added in user units and their links' strengths are never drawn), admitted only by `checkDeclaredSums`.
 *
 * This compiles that shape into ONE Olumi-read declaration for `checkDeclaredSums`: the goal = its level today + every validated
 * definitional part. Nothing here admits anything: it proposes; `checkDeclaredSums` checks it whole (one +1 definition per part,
 * no undeclared definitional input, frames, levels today within ISL's reconciliation). Fail-closed, nothing is compiled when:
 *  · any definitional link into the goal is not `validatedDefinition`-held, its label clause read from the model's label or,
 *    where that label names no quantity ("Option A net effect"), from the user's own words: every option's setting of the part
 *    is the person's and the brief writes it as a figure of the goal (`settingsStateGoalQuantity`). The d5 causal negative and
 *    the zero-baseline pure-delta lookalike stay as drafted: a drafter's flag, basis or ±1 alone never makes a definition;
 *  · the goal's level today is not the person's own figure (`isPersonsOwnValue`): no Olumi-estimated or provisional baseline;
 *  · a part is not a lever only the options move, 0 today (the conditions under which the Run's result is the stated level today
 *    plus each option's change: PLoT holds such a lever exact where the status quo keeps it at 0);
 *  · the goal is not a level goal, already carries an identity, or the drafter declared one on it.
 * ⚠ Quantity is bound by the model's label or the user's figure words; reference (the goal's level today) and timing (the goal's
 * own) are Olumi's disclosed reading, never verified from the user's words. A goal the user's words never name ("Widget output"
 * beside "widgets per hour") is left exactly as today; that boundary is the AIE's (2500d66f) to rule on.
 * The today part is the goal's OWN level today (its `observed_state`, copied: the same figure, frame and stamp, never a new
 * one). The parts' levels today enter only the reconciliation; the Run's result is the stated level today plus each option's
 * change of the parts. Pure.
 */
import { endsOfGraph, validatedDefinition } from '../goal-target/held-user-links.js';
import { isPersonsOwnSetting, isPersonsOwnValue } from '../../cee/provenance/provenance-of.js';
import { nodeUnitOf } from '../../orchestrator/context/placeholder-parts.js';
import { LLM_STRENGTH_STD_FLOOR } from '../../cee/constants.js';
import { canonicalLabel } from './model-primitives.js';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { figureTheUserWroteForSpan } from './stated-by-user.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

interface NodeIn {
  readonly id: string; readonly kind: string; readonly label: string; readonly category?: unknown;
  readonly observed_state?: Rec; readonly nonlinear_identity?: unknown; readonly goal_threshold_frame?: unknown; readonly interventions?: unknown;
}
interface EdgeIn { readonly from: string; readonly to: string; readonly provenance?: unknown }

/** The words a part is named in: the goal's level today, as a quantity of its own. */
export const todayPartLabel = (goalLabel: string): string => `${goalLabel} today`;

export interface GoalDefinitionSum<S> {
  readonly part: { id: string; kind: 'factor'; label: string; category: 'observable'; observed_state: S; scale_frame?: number };
  readonly link: {
    from: string; to: string; strength: { mean: number; std: number }; exists_probability: number; effect_direction: 'positive';
    provenance: { source: string; magnitude: 'olumi_estimate'; natural_effect: { amount: number; amount_unit: string; per_source_change: number;
      per_source_change_unit: string; strength_mean: number; strength_mean_frame: 'edge_strength' }; definitional: true };
  };
  readonly declaration: { outcome: string; operation: 'sum'; factors: string[]; provenance: 'inferred'; evidence: null };
}

export function goalDefinitionSum<N extends NodeIn>(
  nodes: readonly N[],
  edges: readonly EdgeIn[],
  goalId: string,
  declared: readonly { readonly outcome?: unknown }[],
  frameOf: (id: string) => number | undefined,
  /** The user's own words state each option's setting of this part as a figure of the goal's quantity (`settingsStateGoalQuantity`). */
  statedAsGoalQuantity: (partId: string) => boolean = () => false,
): GoalDefinitionSum<NonNullable<N['observed_state']>> | null {
  const goal = nodes.find((n) => n.id === goalId && n.kind === 'goal');
  if (goal === undefined || goal.nonlinear_identity !== undefined || goal.goal_threshold_frame !== 'level') return null;
  if (declared.some((d) => typeof d?.outcome === 'string' && canonicalLabel(d.outcome) === canonicalLabel(goal.label))) return null;
  const today = goal.observed_state;
  if (today === undefined || !finite(today.raw_value) || !isPersonsOwnValue(today)) return null;
  const frame = frameOf(goal.id);
  const unit = nodeUnitOf(nodes)(goal.id);
  if (!finite(frame) || !(frame > 0) || unit === undefined) return null;
  const into = edges.filter((e) => e.to === goal.id && isRec(e.provenance) && e.provenance.definitional === true);
  if (into.length === 0) return null;
  const ends = endsOfGraph({ nodes, edges });
  // d5 whole, its label clause read from the model's label OR, where the AI's label names no quantity ("Option A net effect"),
  // from the user's own verified words for every option's setting of the part (the quantity bound from the explicit source).
  // Its current-carrier and same-unit clauses always apply. A drafter's flag or a ±1 alone never makes a definition.
  if (!into.every((e) => validatedDefinition(e, ends(e)) !== undefined
    || (statedAsGoalQuantity(e.from) && validatedDefinition(e, { ...ends(e), fromLabel: goal.label }) !== undefined))) return null;
  // The conditions under which "today + the option's change" IS the engine's arithmetic (Codex PAIR3 3; never semantic proof):
  // each part is a lever nothing but the options moves, 0 today, so the status quo holds it exact (PLoT `pinnedLeverIds`).
  const kindOf = new Map(nodes.map((n) => [n.id, n.kind] as const));
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  if (!into.every((e) => {
    const part = byId.get(e.from);
    return part?.kind === 'factor' && part.category === 'controllable' && isRec(part.observed_state) && part.observed_state.raw_value === 0
      && edges.every((p) => p.to !== part.id || kindOf.get(p.from) === 'option');
  })) return null;
  const label = todayPartLabel(goal.label);
  if (nodes.some((n) => canonicalLabel(n.label) === canonicalLabel(label))) return null;
  let id = `${goal.id}_today`;
  for (let i = 2; nodes.some((n) => n.id === id); i++) id = `${goal.id}_today_${i}`;
  const labelOf = (nodeId: string): string => nodes.find((n) => n.id === nodeId)?.label ?? nodeId;
  return {
    part: { id, kind: 'factor', label, category: 'observable', observed_state: { ...today }, ...(today.cap === frame ? {} : { scale_frame: frame }) },
    link: {
      from: id, to: goal.id, strength: { mean: 1, std: LLM_STRENGTH_STD_FLOOR }, exists_probability: 1, effect_direction: 'positive',
      provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', definitional: true, natural_effect: {
        amount: 1, amount_unit: unit, per_source_change: 1, per_source_change_unit: unit, strength_mean: 1, strength_mean_frame: 'edge_strength' } },
    },
    declaration: { outcome: goal.label, operation: 'sum', factors: [label, ...into.map((e) => labelOf(e.from))], provenance: 'inferred', evidence: null },
  };
}

/**
 * The compiled sum's today part on a stored goal: the one part of the goal's Olumi-read `sum` (`stated_in_brief: false`)
 * whose id construction minted from the goal's own (`<goal id>_today`, `_2`…, never renamed by an edit). It is bound by that
 * identity, never by its figure (Codex review of 04c63519: a part edited away from the goal's level must stay bound), so the
 * goal-level writer writes it with the goal (`goal-current-level.ts`) and every write through the one persistence route carries
 * it at the goal's own level today (`withEveryTodayPartAtGoalLevel`). `undefined` when there is none.
 */
export function goalSumTodayPart<N extends NodeIn>(nodes: readonly N[], goalId: string): N | undefined {
  const goal = nodes.find((n) => n.id === goalId && n.kind === 'goal');
  const identity = isRec(goal?.nonlinear_identity) ? goal!.nonlinear_identity : undefined;
  if (identity === undefined || identity.operation !== 'sum' || identity.stated_in_brief !== false || !Array.isArray(identity.factor_ids)) return undefined;
  const minted = (id: unknown): boolean => typeof id === 'string' && (id === `${goalId}_today` || (id.startsWith(`${goalId}_today_`) && /^[0-9]+$/.test(id.slice(goalId.length + 7))));
  const ids = identity.factor_ids.filter(minted);
  return ids.length === 1 ? nodes.find((n) => n.id === ids[0] && n.kind === 'factor') : undefined;
}

/**
 * The goal's level today, on the compiled today part, exactly: the part IS that level, so whatever a writer left on it, the
 * goal's own `observed_state` is carried there. The goal stays the one authority for its level today. The same graph when
 * there is no part or nothing differs. Pure.
 */
export function withTodayPartAtGoalLevel<G>(graph: G, goalId: string): G {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? (graph.nodes as NodeIn[]) : undefined;
  const part = nodes === undefined ? undefined : goalSumTodayPart(nodes, goalId);
  const level = nodes?.find((n) => n.id === goalId)?.observed_state;
  if (part === undefined || !isRec(level) || stableStringify(part.observed_state) === stableStringify(level)) return graph;
  return { ...graph, nodes: nodes!.map((n) => (n.id === part.id ? { ...n, observed_state: { ...level } } : n)) } as G;
}

/** Every goal's compiled today part at that goal's level today: what the one persistence route writes, for every writer. */
export function withEveryTodayPartAtGoalLevel<G>(graph: G): G {
  const goals = isRec(graph) && Array.isArray(graph.nodes) ? (graph.nodes as NodeIn[]).filter((n) => n.kind === 'goal') : [];
  return goals.reduce((g, goal) => withTodayPartAtGoalLevel(g, goal.id), graph);
}

/**
 * The quantity of a definitional part, bound from the user's own words rather than the AI's label (d5's label clause reads
 * nothing in "Option A net effect"): EVERY option's non-zero setting of the part is the person's own (`isPersonsOwnSetting`,
 * as admission's one authorship owner stamped it), and the user's brief writes that very figure as a quantity of the goal
 * (`figureTheUserWroteForSpan`, the estate's entity-scoped figure reader, scoped to the goal: its words named at the figure, no
 * other modelled quantity's). "Option A adds exactly 20 widgets per hour" binds "Widgets per hour"; "Option A adds exactly
 * £50,000 of pipeline" never binds "Monthly revenue". Which option the figure belongs to stays the AI's reading, as for every
 * setting; reference (the goal's level today) and timing (the goal's own) are Olumi's disclosed reading (`declaredSumSentence`).
 */
export function settingsStateGoalQuantity<N extends NodeIn>(nodes: readonly N[], brief: string | undefined, goalId: string, goalUnit: string, partId: string): boolean {
  const goal = nodes.find((n) => n.id === goalId);
  if (typeof brief !== 'string' || goal === undefined) return false;
  const cells = nodes.filter((n) => n.kind === 'option').flatMap((o) => {
    const c = isRec(o.interventions) ? o.interventions[partId] : undefined;
    return isRec(c) && c.raw_value !== 0 ? [c] : [];
  });
  const others = nodes.filter((n) => n.id !== goalId && n.id !== partId && n.kind !== 'option' && n.kind !== 'decision').map((n) => n.label);
  return cells.length > 0 && cells.every((c) => isPersonsOwnSetting(c) && finite(c.raw_value)
    && figureTheUserWroteForSpan(c.raw_value, goalUnit, brief, { target: [goal.label], others, requireNamed: true }) !== null);
}
