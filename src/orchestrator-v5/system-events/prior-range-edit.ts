import { randomUUID } from 'node:crypto';
import { OrchestratorTurnPayloadSchema, type SystemEventTurnPayload } from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { refereeMutationBatch } from '../graph-management/referee.js';
import type { FactorValueEditResult } from './factor-value-edit.js';

type RangeEvent = Extract<SystemEventTurnPayload['event'], { kind: 'prior_range_edit' }>;
export type PriorRangeEditResult = FactorValueEditResult | {
  readonly kind: 'unchanged';
  readonly graph: GraphV3T;
  readonly baseGraph: unknown;
};

/** Typed manual intent → the existing field referee and candidate applier. No persistence here. */
export function applyPriorRangeEdit(params: {
  readonly payload: SystemEventTurnPayload;
  readonly event: RangeEvent;
  readonly persistedGraph: unknown;
  /** Raw persisted-base hash supplied by the dispatcher's existing CAS authority. */
  readonly baseGraphHash: string | null;
  readonly handlerFacts: readonly HandlerFact[];
}): PriorRangeEditResult {
  const { payload, event, persistedGraph, handlerFacts, baseGraphHash: baseHash } = params;
  const refuse = (reason: string): FactorValueEditResult => ({
    kind: 'refused', reason, pendingActions: [],
    response: {
      response_version: 2,
      assistant_text: "I couldn't save that range. Reload the model and check the factor and bounds.",
      blocks: [], suggested_actions: [], insights: [], stage_indicator: payload.stage,
    },
  });
  // Reuse the strict wire contract even for an in-process caller. It checks finite
  // ordered numeric bounds and rejects invented unit/permission fields.
  if (!OrchestratorTurnPayloadSchema.safeParse(payload).success) return refuse('invalid_range_event');
  const parsed = GraphV3.safeParse(persistedGraph);
  if (!parsed.success) return refuse('no_persisted_graph');
  const graph = parsed.data;
  // Do not trim into somebody else's identity, or choose the first duplicate.
  const matches = graph.nodes.filter(node => node.id.trim() === event.target_id.trim());
  if (event.target_id.trim() !== event.target_id || matches.length !== 1
    || matches[0]!.id !== event.target_id) return refuse('target_not_unique');
  const target = matches[0]!;
  if (target.kind !== 'factor') return refuse('target_not_factor');
  // Absence is "unspecified", never a licence to invent uniform uncertainty.
  const distribution = event.distribution ?? target.prior?.distribution;
  if (distribution === undefined) return refuse('distribution_required');
  if (target.prior?.range_min === event.range_min && target.prior.range_max === event.range_max
    && target.prior.distribution === distribution) {
    return { kind: 'unchanged', graph, baseGraph: persistedGraph };
  }
  // A likely range brackets the factor's own point estimate: a range that excludes it is a contradiction, not an edit.
  const point = (target as { observed_state?: { value?: unknown } }).observed_state?.value;
  if (typeof point === 'number' && Number.isFinite(point) && (point < event.range_min || point > event.range_max)) {
    return refuse('value_outside_range');
  }
  if (baseHash === null) return refuse('no_persisted_graph');
  // Leaf candidates preserve existing prior metadata, including server-owned
  // stamps: none is resubmitted as user-authored input. A missing prior needs a
  // complete object because the canonical schema requires all three members.
  const fields = target.prior === undefined
    ? [{ field: 'prior', from: null, to: { distribution, range_min: event.range_min, range_max: event.range_max } }]
    : [
      { field: 'prior.range_min', from: target.prior.range_min, to: event.range_min },
      { field: 'prior.range_max', from: target.prior.range_max, to: event.range_max },
      { field: 'prior.distribution', from: target.prior.distribution, to: distribution },
    ];
  const verdicts = refereeMutationBatch(fields.map(field => ({
    envelope_version: 1, candidate_id: randomUUID(), kind: 'update_node_field',
    base_graph_hash: baseHash, payload: { node_id: event.target_id, ...field },
    provenance: { source: 'user_direct', evidence_pointer: `system_event:${payload.turn_id}` },
    identity: { scenario_id: payload.scenario_id, turn_id: payload.turn_id },
  })), persistedGraph, {
    currentGraphHash: baseHash, graphReadable: true,
    // This is already a consented manual edit, not an unconfirmed AI proposal.
    // Neutralise the analysis-only hold, as held-payload assessment does, without
    // changing any field permission, graph/readiness invariant or CAS gate.
    // Actual Run freshness is observational and is derived by dispatch from the
    // bounded evidence read; its failure must never lose the user's edit.
    freshness: 'none',
  });
  const blocked = verdicts.find(verdict => verdict.verdict !== 'would_apply');
  if (blocked !== undefined) return refuse(blocked.blocker?.code ?? 'range_not_permitted');
  const candidate = verdicts.at(-1)?.candidate;
  const candidateParse = GraphV3.safeParse(candidate);
  if (candidate === undefined || !candidateParse.success) return refuse('range_not_permitted');
  return {
    kind: 'mutated', baseGraph: persistedGraph, mutatedGraph: candidate,
    graph: candidateParse.data, handlerFacts,
    response: {
      response_version: 2, assistant_text: '', blocks: [], suggested_actions: [],
      insights: [], stage_indicator: payload.stage,
    },
  };
}
