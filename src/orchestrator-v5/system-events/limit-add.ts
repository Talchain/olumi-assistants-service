/** S-E S4: an append-only adapter to the ONE add_constraint writer. */
import { GraphV3 } from '../../schemas/cee-v3.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { BASE_HASH_DIVERGED } from '../graph-management/reason-codes.js';
import { limitQuantityUnit } from '../agent-lane/stated-limit.js';
import { isDeepStrictEqual } from 'node:util';
import { applyConstraintEditThroughAddConstraint, InvalidPersistedGoalTargetGraphError, type GoalTargetEditResult } from './goal-target-edit.js';
import type { ApplyLimitEditParams } from './limit-edit.js';

export type LimitAddRequest = Omit<ApplyLimitEditParams['request'], 'operator' | 'stated_operator'> & {
  readonly operator: '<=';
  readonly unit: string;
  readonly source_quote: string;
  readonly value_frame?: import('@talchain/schemas').GoalThresholdFrameType;
};
const rowsOf = (g: unknown): Record<string, unknown>[] => {
  const rows = (g as { goal_constraints?: unknown } | null)?.goal_constraints;
  return Array.isArray(rows) ? rows : [];
};
export async function applyLimitAdd(params: Omit<ApplyLimitEditParams, 'request'> & { request: LimitAddRequest }): Promise<GoalTargetEditResult> {
  const { persistedGraph, request, payload, priorFacts, requestId } = params;
  const refused = (reason: string): GoalTargetEditResult => ({ kind: 'refused', reason });
  if (persistedGraph == null) return refused('no_persisted_graph');
  const parsed = GraphV3.safeParse(persistedGraph);
  if (!parsed.success) throw new InvalidPersistedGoalTargetGraphError();
  const current = computeAnalysisAffectingGraphHash(persistedGraph as never);
  if (current === null || current !== request.base_graph_hash) return { kind: 'base_hash_diverged', conflict: {
    recovery_action: 'refresh_and_reconfirm', conflict_category: BASE_HASH_DIVERGED, expected_base_graph_hash: current } };
  const matches = parsed.data.nodes.filter(n => n.id === request.node_id);
  const node = matches.length === 1 ? matches[0] : undefined;
  if (node === undefined || !['factor', 'outcome'].includes(node.kind)) return refused('target_not_quantity');
  const rows = rowsOf(persistedGraph);
  if (rows.some(c => c.node_id === request.node_id)) return refused('existing_limit');
  if (!Number.isFinite(request.raw_value) || request.raw_value < 0 || request.operator !== '<='
    || request.source_quote.length === 0 || request.source_quote.length > 200
    || limitQuantityUnit(persistedGraph, node) !== request.unit) return refused('invalid_limit');
  const frame = node.quantity_frame ?? 'level';
  if (frame !== request.value_frame || frame !== 'level') return refused('quantity_frame_changed');
  const result = await applyConstraintEditThroughAddConstraint({ payload, requestId, persistedGraph, graph: parsed.data, priorFacts,
    targetId: request.node_id, constraintType: 'at_most', rawValue: request.raw_value, unit: request.unit, label: node.label,
    confirmedConstraintSourceQuote: request.source_quote,
    ...(request.value_frame !== undefined ? { confirmedConstraintValueFrame: request.value_frame } : {}),
    statedConstraintOperator: '<=', eventName: 'limit_add', logBase: { request_id: requestId, node_id: request.node_id } });
  if (result.kind !== 'mutated') return result;
  const after = rowsOf(result.mutatedGraph);
  const written = after.filter(c => c.node_id === request.node_id);
  const row = written[0];
  if (after.length !== rows.length + 1 || written.length !== 1 || row?.operator !== '<=' || row.value !== request.raw_value
    || row.unit !== request.unit || row.source_quote !== request.source_quote || row.value_frame !== request.value_frame
    || row.provenance !== 'explicit' || !rows.every(c => after.some(w => isDeepStrictEqual(c, w)))) return refused('row_not_kept');
  return result;
}
