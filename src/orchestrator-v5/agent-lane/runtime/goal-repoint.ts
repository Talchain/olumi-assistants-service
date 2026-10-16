/** A changed governing outcome, on the existing complete-candidate card. No store or writer. */
import { isDeepStrictEqual } from 'node:util';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyStructuralDelete } from '../../system-events/structural-delete.js';
import type { AgentToolContext } from './agent-tools.js';
import { sayFigureWithoutRounding } from '../say-figure.js';
import { sayGoalChange } from '../limit-frame.js';
import { sayDate } from '../../goal-target/deadline-date.js';
import { LIMIT_OPERATOR_WORDS, statedOperatorOf } from '../limit-operator-words.js';
import { readGoalRecord } from '../../goal-target/goal-record.js';
import { prepareHorizonBasisForWrite } from '../../goal-target/horizon-basis-provenance.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Keep the earlier aim in the existing human-readable description, with the original words and recorded uncertainty.
 * No new carrier or numerical authority: the existing entity reader exposes description as full_label on cold read.
 * Structured target-row controls are explicitly left out; no silent claim that historical rows are still operative.
 */
export function priorAimDescription(before: Rec, oldId: string, laterAmbitionQuote?: string, historyKind: 'goal' | 'target' = 'goal'): string | undefined {
  const old = Array.isArray(before.nodes) ? before.nodes.find((n): n is Rec => rec(n) && n.id === oldId && n.kind === 'goal') : undefined;
  const held = readGoalRecord(before, oldId);
  if (!old || !held) return undefined;
  const rows = (Array.isArray(before.goal_constraints) ? before.goal_constraints : []).filter((r): r is Rec => rec(r) && r.node_id === oldId);
  const figure = (value: number, unit: unknown) => sayFigureWithoutRounding(value, typeof unit === 'string' ? unit : '');
  const earlierFigure = held.target?.raw === undefined ? '' : sayGoalChange(held.target.frame, held.target.raw, held.target.unit, figure, held.target.comparator)
    ?? `${held.target.comparator === undefined ? '' : LIMIT_OPERATOR_WORDS[held.target.comparator]} ${figure(held.target.raw, held.target.unit)}`;
  const lines = [`Earlier ${historyKind === 'target' ? 'target' : 'aim'} (history${laterAmbitionQuote === undefined ? '' : ', later ambition'}): ${earlierFigure || held.label}.`,
    typeof old.description === 'string' ? old.description : '',
    ...(historyKind === 'target' ? [] : [`This was the governing aim before the earlier revision: “${held.label}”.`]),
    ...(laterAmbitionQuote === undefined ? [] : [`Later ambition, as Olumi reads your words: “${laterAmbitionQuote}”. Your source stays yours; the later role is a modelling interpretation.`]),
    ...(held.target?.raw === undefined ? [] : [`Earlier model target: ${sayGoalChange(held.target.frame, held.target.raw, held.target.unit, figure, held.target.comparator)
      ?? `${held.target.comparator === undefined ? '' : LIMIT_OPERATOR_WORDS[held.target.comparator]} ${figure(held.target.raw, held.target.unit)}`}.`]),
    ...(historyKind === 'target' || held.horizon === null ? [] : [`Earlier timing: ${[held.horizon.as_stated, held.horizon.deadline === undefined ? undefined : sayDate(held.horizon.deadline),
      held.horizon.months === undefined ? undefined : `${held.horizon.months} months`].filter(Boolean).join('; ')}. This does not set the current goal’s deadline.`]),
    ...(historyKind === 'target' || held.period === undefined || held.period === 'none' ? [] : [`Earlier figures were per ${held.period}; this does not set the current goal’s period.`]),
    ...(historyKind === 'target' || held.horizon_basis === undefined ? [] : [`Earlier timing basis, recorded but not verified: ${held.horizon_basis.basis}. Earlier source: ${held.horizon_basis.source}; bound period: ${held.horizon_basis.bound_months} months. This earlier judgement does not validate the current goal.`]),
    ...rows.filter(row => historyKind === 'goal' || row.deadline_metadata == null).map(row => `Earlier saved bound: ${sayGoalChange(row.value_frame, Number(row.value), typeof row.unit === 'string' ? row.unit : undefined, figure, statedOperatorOf(row))
      ?? `${statedOperatorOf(row) === undefined ? String(row.operator) : LIMIT_OPERATOR_WORDS[statedOperatorOf(row)!]} ${figure(Number(row.value), row.unit)}`}.`
      + (typeof row.source_quote === 'string' ? ` Earlier saved source quote: “${row.source_quote}”.` : '')
      + (typeof row.provenance === 'string' ? ` Origin recorded by the earlier model: ${row.provenance}.` : '')
      + (typeof row.confidence === 'number' ? ` Earlier extraction confidence: ${row.confidence}; this is not a forecast chance.` : '')
      + (rec(row.retained_unresolved_limit) && typeof row.retained_unresolved_limit.question === 'string' ? ` Unresolved: ${row.retained_unresolved_limit.question}` : '')),
    'The earlier target and its quoted source remain here as history; they do not constrain the current goal.'];
  return lines.filter(Boolean).join('\n');
}

/** Compute the retained work through the SAME deletion adapter, including option settings/links that go with a factor. */
export function repointRetainedBase(before: Rec, removals: unknown, ctx: AgentToolContext): Rec | undefined {
  if (removals === undefined) return before;
  if (!Array.isArray(removals) || removals.length > 6) return undefined;
  let graph = before;
  for (const raw of removals) {
    if (!rec(raw) || !Array.isArray(raw.removed_node_ids) || !Array.isArray(raw.removed_edges)
      || !raw.removed_node_ids.every(x => typeof x === 'string')
      || !raw.removed_edges.every(x => rec(x) && typeof x.from === 'string' && typeof x.to === 'string')) return undefined;
    const event = { kind: 'structural_delete' as const, removed_node_ids: raw.removed_node_ids as string[],
      removed_edges: raw.removed_edges as { from: string; to: string }[], base_graph_hash: computeAnalysisAffectingGraphHash(graph as never)! };
    const result = applyStructuralDelete({ payload: { kind: 'system_event', scenario_id: ctx.scenario_id,
      turn_id: ctx.turn_id ?? ctx.request_id, stage: 'frame', event }, event, requestId: ctx.request_id, persistedGraph: graph });
    if (result.kind !== 'mutated' || !rec(result.mutatedGraph)) return undefined;
    graph = result.mutatedGraph;
  }
  return graph;
}

/** The repoint card must retain the whole old aim and all options, before the one native registration. */
export function repointRetainsSavedWork(before: Rec, candidate: unknown, oldId: string, newId: string, expectedDescription: string, scenarioId: string): boolean {
  if (!rec(candidate) || !Array.isArray(before.nodes) || !Array.isArray(candidate.nodes)) return false;
  const old = before.nodes.find((n): n is Rec => rec(n) && n.id === oldId && n.kind === 'goal');
  const kept = candidate.nodes.find((n): n is Rec => rec(n) && n.id === oldId);
  const goals = candidate.nodes.filter(n => rec(n) && n.kind === 'goal');
  if (!old || !kept || kept.analysis_participation !== 'retained_excluded' || kept.kind !== 'outcome' || goals.length !== 1 || !rec(goals[0]) || goals[0].id !== newId) return false;
  // Match the native writer: demotion retires old server proof, never transfers it to the new goal.
  const prepared = structuredClone(candidate);
  prepareHorizonBasisForWrite(prepared, before, scenarioId);
  if (!isDeepStrictEqual(prepared, candidate)) return false;
  const earlier: { nodes: Rec[] } = { nodes: [{ ...old, kind: 'outcome', analysis_participation: 'retained_excluded' }] };
  prepareHorizonBasisForWrite(earlier, before, scenarioId);
  const { kind: _oldKind, ref: _oldRef, description: _oldDescription, ...oldFields } = earlier.nodes[0]!;
  const { kind: _newKind, ref: _newRef, description, ...keptFields } = kept;
  if (!isDeepStrictEqual(oldFields, keptFields) || description !== expectedDescription) return false;
  // The prior aim is informational: leaving its target in the active array would turn it into a second goal/limit.
  if ((Array.isArray(candidate.goal_constraints) ? candidate.goal_constraints : []).some(r => rec(r) && r.node_id === oldId)) return false;
  // Every untouched node, edge, non-goal constraint and top-level member must survive, not only the option roster.
  const formerlyOutcome = before.nodes.find((n): n is Rec => rec(n) && n.id === newId);
  if (formerlyOutcome !== undefined && goals[0].description !== promotedOutcome(formerlyOutcome).description) return false;
  const otherNodes = (nodes: unknown[]) => nodes.filter(n => rec(n) && n.id !== oldId && n.id !== newId);
  if (!isDeepStrictEqual(otherNodes(before.nodes), otherNodes(candidate.nodes))) return false;
  const rest = (graph: Rec) => Object.fromEntries(Object.entries(graph).filter(([k]) =>
    !['nodes', 'goal_constraints', 'goal_node_id', 'ref_high_water'].includes(k)));
  if (!isDeepStrictEqual(rest(before), rest(candidate))) return false;
  const otherRows = (graph: Rec) => (Array.isArray(graph.goal_constraints) ? graph.goal_constraints : [])
    .filter(r => rec(r) && r.node_id !== oldId && r.node_id !== newId);
  return isDeepStrictEqual(otherRows(before), otherRows(candidate));
}

/** Promotion never silently reactivates an earlier goal's timing or exclusion. Its recorded words stay historical. */
export function promotedOutcome(node: Rec): Rec {
  const goal: Rec = { ...node, kind: 'goal', analysis_participation: 'included' };
  const held = readGoalRecord({ nodes: [goal] }, String(node.id));
  const timing = held?.horizon;
  const history = [
    ...(timing === null || timing === undefined ? [] : [`Earlier recorded timing: ${[timing.as_stated,
      timing.deadline === undefined ? undefined : sayDate(timing.deadline), timing.months === undefined ? undefined : `${timing.months} months`].filter(Boolean).join('; ')}.`]),
    ...(typeof node.goal_horizon_reference_date === 'string' ? [`Earlier timing reference: ${sayDate(node.goal_horizon_reference_date)}.`] : []),
    ...(typeof node.goal_horizon_stated_months === 'number' ? [`Earlier stated duration: ${node.goal_horizon_stated_months} months.`] : []),
    ...(held?.period === undefined || held.period === 'none' ? [] : [`Earlier figures were per ${held.period}.`])];
  const lines = [typeof node.description === 'string' ? node.description : '',
    ...(history.length ? ['Earlier timing was set aside.', ...history] : [])].filter(Boolean);
  if (lines.length) goal.description = lines.join('\n');
  for (const key of ['goal_horizon', 'goal_horizon_months', 'goal_deadline_as_stated', 'horizon_basis',
    'goal_horizon_reference_date', 'goal_horizon_stated_months', 'goal_period']) delete goal[key];
  return goal;
}

/** User copy is derived from native refusal codes; the complete native detail remains AI-facing. */
export function omittedGoalChangeWords(part: string, refusal: string): string {
  const reasons: Readonly<Record<string, string>> = {
    figure_not_in_users_words: "Olumi couldn't verify it as a current figure from your words",
    unit_mismatch: 'its measurement needs checking',
    unit_unstated: 'its measurement needs checking',
    unit_unrecognised: 'its measurement needs checking',
    not_current_removal: 'the quoted source is from an earlier message; ask here to include it',
    not_asked: "the quoted words don't identify this change clearly enough",
    subject_not_found: "Olumi couldn't identify the relevant part in this model",
  };
  return `${part.charAt(0).toUpperCase()}${part.slice(1)} isn't included: ${reasons[refusal] ?? "Olumi couldn't safely include this change"}.`;
}
