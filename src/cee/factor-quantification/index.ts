import { selectFactorQuantity } from '@talchain/schemas';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import { getDraftLlmRetryBudgetMs, LLM_POST_PROCESSING_HEADROOM_MS } from '../../config/timeouts.js';
import { getTurnExecutorBudgets } from '../../orchestrator-v5/budgets.js';
import { callFactorQuantification } from './model-call.js';
import { adoptFactorEstimates, markUnresolved, type BasisReference } from './adopt.js';
import { comparisonFactorRequirements, selectQuantificationGaps } from './select.js';

/** Deadline derives from the existing request, adapter and outer-turn controls.
 * Both existing reserves protect canonical commit/completion; none resets here.
 */
export function factorEstimationDeadline(requestStartMs: number, now = Date.now()): number {
  const requestRemaining = getDraftLlmRetryBudgetMs(Math.max(0, now - requestStartMs));
  const turnDeadline = requestStartMs + getTurnExecutorBudgets().turn_ms - LLM_POST_PROCESSING_HEADROOM_MS;
  return Math.min(now + requestRemaining, turnDeadline);
}

export async function quantifyDraftFactors(input: {
  graph: GraphV3T; brief: string; requestId: string; requestStartMs: number;
  options: readonly Record<string, unknown>[]; targetId?: string;
  basis?: readonly BasisReference[]; importantIds?: readonly string[];
}) {
  const requirements = comparisonFactorRequirements(input.graph, input.options, input.targetId);
  const selection = selectQuantificationGaps(input.graph, requirements, { importantIds: input.importantIds });
  // Full brief is labelled context, never evidence. Scoped reference callers may
  // supply validated exact quotes instead; no model citation creates provenance.
  const basis: readonly BasisReference[] = input.basis ?? [{ id: 'brief', text: input.brief,
    factor_ids: selection.gaps.map(g => g.factor_id), kind: 'brief_context' }];
  const result = await callFactorQuantification({ brief: input.brief, gaps: selection.gaps,
    context: { basis, nodes: input.graph.nodes, relationships: input.graph.edges },
    requestId: input.requestId, deadlineMs: factorEstimationDeadline(input.requestStartMs) });
  const adoption = adoptFactorEstimates(input.graph, selection.gaps, result.kind === 'ok' ? result.estimates : [], basis);
  const resolved = new Set([...adoption.estimated, ...adoption.unknown]);
  // Even queue overflow is explicit unknown; no generic value becomes knowledge.
  const graph = markUnresolved(adoption.graph, selection.eligible, resolved, input.graph);
  const requiredStates = requirements.map(req => selectFactorQuantity(graph.nodes.find(n => n.id === req.factor_id)));
  const fallback = requiredStates.filter(s => s.kind === 'fallback').length;
  const protectedChanges = input.graph.nodes.filter(node => selectFactorQuantity(node).protected).filter(before => {
    const after = graph.nodes.find(n => n.id === before.id);
    return JSON.stringify([before?.observed_state, before?.prior]) !== JSON.stringify([after?.observed_state, after?.prior]);
  }).length;
  return { graph, model: result, metrics: {
    required_inputs: requirements.length,
    materiality: 'required_input_impact_unassessed' as const,
    gaps_entering: selection.eligible.length,
    fallback_entering: requirements.filter(req => selectFactorQuantity(input.graph.nodes.find(n => n.id === req.factor_id)).kind === 'fallback').length,
    gaps_requested: selection.gaps.length,
    estimated: adoption.estimated.length,
    model_unknown: adoption.unknown.length,
    explicit_unknown: requiredStates.filter(s => s.kind === 'unknown').length,
    operational_unresolved: selection.gaps.filter(g => !resolved.has(g.factor_id)).length,
    skipped_gaps: selection.eligible.length - selection.gaps.length
      + (result.kind === 'skipped' ? selection.gaps.length : 0),
    rejected: adoption.rejected,
    fallback,
    strict_evaluation_pass: fallback === 0 && resolved.size === selection.eligible.length && protectedChanges === 0,
    unresolved_origin: selection.unresolved_origin,
    protected_values_changed: protectedChanges,
    call: result.metadata,
  } };
}
