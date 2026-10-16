/** A changed governing outcome, on the existing complete-candidate card. No store or writer. */
import { isDeepStrictEqual } from 'node:util';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyStructuralDelete } from '../../system-events/structural-delete.js';
import type { AgentToolContext } from './agent-tools.js';
import { readGoalRecord } from '../../goal-target/goal-record.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Earlier target rows are history on their original node, never active constraints in the next Run.
 * NodeV3 declares the historical carrier explicitly. The original node fields, sources and statements stay verbatim.
 * This projection is also exposed to the reasoning input on warm reads and cold reopen.
 */
export function retainedAimOf(node: unknown): Rec | undefined {
  if (!rec(node) || !rec(node.retained_aim) || !Array.isArray(node.retained_aim.constraints)
    || typeof node.retained_aim.change_quote !== 'string') return undefined;
  const held = node.retained_aim;
  return { id: node.id, label: node.label, role: typeof held.later_ambition_quote === 'string' ? 'later ambition (Olumi’s reading)' : 'earlier aim, retained as history',
    goal: readGoalRecord({ nodes: [{ ...node, kind: 'goal' }], goal_constraints: held.constraints }, String(node.id)),
    constraints: held.constraints, change_quote: held.change_quote,
    ...(typeof held.later_ambition_quote === 'string' ? { later_ambition_quote: held.later_ambition_quote } : {}),
    user_statements: node.user_statements ?? [],
    ...(held.previous !== undefined ? { previous: held.previous } : {}),
    use: 'Historical aim, not a current goal or limit. Original provenance and uncertainty remain; approval does not reauthor them.' };
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
export function repointRetainsSavedWork(before: Rec, candidate: unknown, oldId: string, newId: string): boolean {
  if (!rec(candidate) || !Array.isArray(before.nodes) || !Array.isArray(candidate.nodes)) return false;
  const old = before.nodes.find((n): n is Rec => rec(n) && n.id === oldId && n.kind === 'goal');
  const kept = candidate.nodes.find((n): n is Rec => rec(n) && n.id === oldId);
  const goals = candidate.nodes.filter(n => rec(n) && n.kind === 'goal');
  if (!old || !kept || kept.kind !== 'outcome' || goals.length !== 1 || !rec(goals[0]) || goals[0].id !== newId) return false;
  const { kind: _oldKind, ref: _oldRef, retained_aim: _oldHistory, ...oldFields } = old;
  const { kind: _newKind, ref: _newRef, retained_aim: history, ...keptFields } = kept;
  const oldRows = (Array.isArray(before.goal_constraints) ? before.goal_constraints : []).filter(r => rec(r) && r.node_id === oldId);
  if (!isDeepStrictEqual(oldFields, keptFields) || !rec(history) || !isDeepStrictEqual(history.constraints, oldRows)
    || !isDeepStrictEqual(history.previous, old.retained_aim) || retainedAimOf(kept) === undefined) return false;
  // The prior aim is informational: leaving its target in the active array would turn it into a second goal/limit.
  if ((Array.isArray(candidate.goal_constraints) ? candidate.goal_constraints : []).some(r => rec(r) && r.node_id === oldId)) return false;
  // Every untouched node, edge, non-goal constraint and top-level member must survive, not only the option roster.
  const otherNodes = (nodes: unknown[]) => nodes.filter(n => rec(n) && n.id !== oldId && n.id !== newId);
  if (!isDeepStrictEqual(otherNodes(before.nodes), otherNodes(candidate.nodes))) return false;
  const rest = (graph: Rec) => Object.fromEntries(Object.entries(graph).filter(([k]) =>
    !['nodes', 'goal_constraints', 'goal_node_id', 'ref_high_water'].includes(k)));
  if (!isDeepStrictEqual(rest(before), rest(candidate))) return false;
  const otherRows = (graph: Rec) => (Array.isArray(graph.goal_constraints) ? graph.goal_constraints : [])
    .filter(r => rec(r) && r.node_id !== oldId && r.node_id !== newId);
  return isDeepStrictEqual(otherRows(before), otherRows(candidate));
}
