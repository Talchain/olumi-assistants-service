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
 *  · any definitional link into the goal is not `validatedDefinition`-held (the d5 causal negative and the zero-baseline
 *    pure-delta lookalike stay as drafted: a drafter's flag or a ±1 alone never makes a definition);
 *  · the goal's level today is not the person's own figure (`isPersonsOwnValue`): no Olumi-estimated or provisional baseline;
 *  · a part is not a lever only the options move, 0 today (the conditions under which the Run's result is the stated level today
 *    plus each option's change: PLoT holds such a lever exact where the status quo keeps it at 0);
 *  · the goal is not a level goal, already carries an identity, or the drafter declared one on it.
 * ⚠ d5 binds the goal's quantity by the model's labels and units, never reference or timing from the user's words: a label it
 * cannot bind ("Net effect" → "Widget output") is left exactly as today, and that boundary is the AIE's (2500d66f), not this slice's.
 * The today part is the goal's OWN level today (its `observed_state`, copied: the same figure, frame and stamp, never a new
 * one). The parts' levels today enter only the reconciliation; the Run's result is the stated level today plus each option's
 * change of the parts. Pure.
 */
import { endsOfGraph, validatedDefinition } from '../goal-target/held-user-links.js';
import { isPersonsOwnValue } from '../../cee/provenance/provenance-of.js';
import { nodeUnitOf } from '../../orchestrator/context/placeholder-parts.js';
import { LLM_STRENGTH_STD_FLOOR } from '../../cee/constants.js';
import { canonicalLabel } from './model-primitives.js';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { encodeOptionInterventionsForEdit } from '../../orchestrator/tools/encode-option-interventions.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

interface NodeIn {
  readonly id: string; readonly kind: string; readonly label: string; readonly category?: unknown;
  readonly observed_state?: Rec; readonly nonlinear_identity?: unknown; readonly goal_threshold_frame?: unknown; readonly interventions?: unknown;
}
interface EdgeIn { readonly from: string; readonly to: string; readonly provenance?: unknown }

/** The words a part is named in: the goal's level today, as a quantity of its own. */
const todayPartLabel = (goalLabel: string): string => `${goalLabel} today`;

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
  if (!into.every((e) => validatedDefinition(e, ends(e)) !== undefined)) return null;
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
 * it at the goal's own level today (`withTodayPartsAtGoalLevel`). `undefined` when there is none.
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
 * Every goal's compiled today part at that goal's level today, exactly: the part IS that level, so whatever a writer left on it,
 * the goal's own `observed_state` is carried there (the goal stays the one authority). What the one persistence route writes,
 * for every writer. The same graph when nothing differs. Pure.
 */
export function withTodayPartsAtGoalLevel<G>(graph: G): G {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? (graph.nodes as NodeIn[]) : [];
  const levelOf = new Map(nodes.filter((n) => n.kind === 'goal').flatMap((goal) => {
    const part = goalSumTodayPart(nodes, goal.id);
    return part !== undefined && stableStringify(part.observed_state) !== stableStringify(goal.observed_state)
      ? [[part.id, goal.observed_state] as const] : [];
  }));
  // A goal with no level today leaves its part with none (Codex R3): the existing missing-baseline refusal answers it.
  const at = ({ observed_state: _old, ...n }: NodeIn, level: unknown): NodeIn => (isRec(level) ? { ...n, observed_state: { ...level } } : n);
  return levelOf.size === 0 ? graph
    : { ...graph, nodes: nodes.map((n) => (levelOf.has(n.id) ? at(n, levelOf.get(n.id)) : n)) } as G;
}

/**
 * The today part IS its goal's level today and has no setter of its own: the ids of every compiled today part that is not at its
 * goal's level today, that an option sets, or that a link leads into (Codex reviews of #3421: today 41 beside a goal of 40, an
 * option's override of 50). The one shared persistence assertion refuses any write holding one (`persist-graph-write.ts`).
 */
export function todayPartsApartFromGoal(graph: unknown): string[] {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? (graph.nodes as NodeIn[]) : [];
  const edges = isRec(graph) && Array.isArray(graph.edges) ? (graph.edges as EdgeIn[]) : [];
  const parts = nodes.filter((n) => n.kind === 'goal').flatMap((goal) => { const part = goalSumTodayPart(nodes, goal.id); return part === undefined ? [] : [{ goal, part }]; });
  const options = parts.length === 0 ? [] : canonicalOptions(graph);
  return parts.filter(({ goal, part }) => stableStringify(part.observed_state) !== stableStringify(goal.observed_state)
    || options.some((o) => isRec(o.interventions) && part.id in o.interventions)
    || edges.some((e) => e.to === part.id)).map(({ part }) => part.id);
}

/**
 * Each node of the graph with every option's setters read where the engine reads them: the Run candidate's own carrier
 * canonicalisation (`encodeOptionInterventionsForEdit`, what `canonicaliseForAnalysis` runs) promotes `data.interventions`
 * and slash- or dot-keyed setters to `interventions` (Codex R3 of #3421: a nested setter of the today part reached the engine).
 * Index-aligned with `graph.nodes`; options only (other kinds are `{}`).
 */
function canonicalOptions(graph: unknown): NodeIn[] {
  const canonical = encodeOptionInterventionsForEdit(graph).graph;
  const nodes = isRec(canonical) && Array.isArray(canonical.nodes) ? (canonical.nodes as NodeIn[]) : [];
  return nodes.map((n) => (isRec(n) && n.kind === 'option' ? n : ({} as NodeIn)));
}

/**
 * ⭐ THE NUMBER'S SAFETY AT THE REVISION → REQUEST BOUNDARY (DL-3 ruling on Codex R2 of #3421): whatever is stored — an Undo to a
 * legacy row, a canvas save straight to the database — each compiled today part is DERIVED from its goal's current level, an
 * option's setting of it is dropped and a link into it is dropped, on a copy: the Run's compute snapshot and its analysis
 * identity (`graph_hash_at_run`, freshness) attest these DERIVED inputs. The stored bytes, their edit (CAS) hash and historical
 * Run facts are untouched; the scenario read returns the stored bytes and says each invalid saved value in `notes`. The same
 * graph and no notes when nothing differs. Pure.
 */
export function deriveTodayParts<G>(graph: G): { readonly graph: G; readonly notes: readonly string[] } {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? (graph.nodes as NodeIn[]) : [];
  const edges = isRec(graph) && Array.isArray(graph.edges) ? (graph.edges as EdgeIn[]) : [];
  const owned = nodes.filter((n) => n.kind === 'goal').flatMap((goal) => { const part = goalSumTodayPart(nodes, goal.id); return part === undefined ? [] : [{ goal, part }]; });
  if (owned.length === 0) return { graph, notes: [] };
  const parts = new Set(owned.map(({ part }) => part.id));
  const options = canonicalOptions(graph);
  const setsPart = (o: NodeIn | undefined): boolean => o !== undefined && isRec(o.interventions) && Object.keys(o.interventions).some((id) => parts.has(id));
  const said = (os: unknown): string => (isRec(os) && finite(os.raw_value) ? `${os.raw_value}${typeof os.unit === 'string' ? ` ${os.unit}` : ''}` : 'no figure');
  const notes: string[] = [];
  for (const { goal, part } of owned) {
    if (stableStringify(part.observed_state) !== stableStringify(goal.observed_state)) {
      notes.push(isRec(goal.observed_state)
        ? `"${part.label}" is the current level of "${goal.label}": the ${said(part.observed_state)} saved on it is not valid, and every Run uses ${said(goal.observed_state)}.`
        : `"${part.label}" is the current level of "${goal.label}", which has no figure yet: the ${said(part.observed_state)} saved on it is not valid and no Run uses it.`);
    }
    for (const o of options.filter((x) => isRec(x.interventions) && part.id in x.interventions)) {
      notes.push(`"${o.label}" sets "${part.label}" to ${said((o.interventions as Rec)[part.id])} in the saved model; that is not valid and no Run uses it: "${part.label}" changes only with the current level of "${goal.label}".`);
    }
    for (const e of edges.filter((x) => x.to === part.id)) {
      notes.push(`The saved link from "${nodes.find((n) => n.id === e.from)?.label ?? e.from}" into "${part.label}" is not valid and no Run uses it: "${part.label}" changes only with the current level of "${goal.label}".`);
    }
  }
  if (notes.length === 0) return { graph, notes };
  const levelled = withTodayPartsAtGoalLevel(graph) as Rec;
  return {
    graph: {
      ...levelled,
      // An option that sets a part leaves in its canonical form without that setter, so no later canonicalisation restores it.
      nodes: (levelled.nodes as NodeIn[]).map((n, i) => (setsPart(options[i])
        ? { ...options[i]!, interventions: Object.fromEntries(Object.entries(options[i]!.interventions as Rec).filter(([id]) => !parts.has(id))) } : n)),
      edges: edges.filter((e) => !parts.has(e.to)),
    } as G,
    notes,
  };
}
