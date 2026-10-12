import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { readCommittedMutationTurnRef } from '../types/recent-mutation-transition.js';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { HandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import { computeAnalysisAffectingGraphHash } from './graph-hash.js';
import type { IdentifiedHandlerFact } from '../types/handler-fact.js';
import type { InterventionHumanAuthority } from '../../orchestrator/tools/encode-option-interventions.js';

const Id = z.string().min(1);
const Approval = z.object({
  operation_id: Id, scenario_id: Id, approving_user: Id,
  base_revision: z.number().int().nonnegative(), revision: z.number().int().nonnegative(),
  graph_hash: Id, analysis_hash: Id,
  cells: z.array(z.object({
    option_id: Id, factor_id: Id, role: z.literal('option_setting'),
    cell: z.record(z.unknown()), factor_frame: z.record(z.unknown()),
  }).strict()).min(1).max(32),
}).strict().superRefine((r, ctx) => {
  if (r.revision !== r.base_revision + 1 || new Set(r.cells.map(c => `${c.option_id}::${c.factor_id}`)).size !== r.cells.length
    || r.cells.some(c => typeof c.cell.value !== 'number' || !Number.isFinite(c.cell.value) || c.cell.source !== 'user_specified'))
    ctx.addIssue({ code: 'custom', message: 'Invalid checked approval binding' });
});
export type AppliedHumanApproval = z.infer<typeof Approval>;

/** The authorised extension lives in the existing applied fact JSONB, not graph bytes. */
export const DurableHandlerFactSchema = z.unknown().transform((input, ctx): HandlerFact => {
  const row = record(input), result = record(row?.result);
  const receipt = result?.human_approval;
  const base = HandlerFactSchema.safeParse(receipt === undefined ? input : { ...row, result: withoutApproval(result!) });
  if (!base.success) {
    for (const issue of base.error.issues) ctx.addIssue(issue);
    return z.NEVER;
  }
  if (receipt === undefined) return base.data;
  const checked = Approval.safeParse(receipt);
  if (!checked.success || base.data.fact_type !== 'edit_graph' || base.data.noop !== false
    || base.data.result.status !== 'applied' || base.data.result.graph_hash_after !== checked.data.graph_hash) {
    ctx.addIssue({ code: 'custom', message: 'Invalid applied human receipt' });
    return z.NEVER;
  }
  Object.assign(base.data.result, { human_approval: checked.data });
  return base.data;
});
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}
function withoutApproval(result: Record<string, unknown>): Record<string, unknown> {
  const { human_approval: _receipt, ...base } = result;
  return base;
}
export function attachAppliedHumanApproval(fact: HandlerFact, approval: AppliedHumanApproval): HandlerFact {
  return DurableHandlerFactSchema.parse({ ...fact, result: { ...fact.result, human_approval: approval } });
}

/** Only the checked writer supplies pairs; the postimage records what that operation actually committed. */
export function attachCheckedCellApproval(fact: HandlerFact, graph: unknown, authority: InterventionHumanAuthority,
  operation: { scenarioId: string; turnId: string; userId: string; revision: number }): HandlerFact {
  const g = GraphStateIngressSchema.safeParse(graph);
  if (!g.success || fact.fact_type !== 'edit_graph' || fact.result.status !== 'applied'
    || fact.result.graph_hash_after === null) return fact;
  const analysisHash = computeAnalysisAffectingGraphHash(g.data);
  if (!analysisHash) return fact;
  const cells = authority.flatMap(pair => {
    const option = g.data.nodes.find(n => n.id === pair.optionId && n.kind === 'option');
    const factor = g.data.nodes.find(n => n.id === pair.factorId && n.kind === 'factor');
    const cell = record(record(option?.interventions)?.[pair.factorId]);
    return cell?.source === 'user_specified' && factor ? [{ option_id: pair.optionId, factor_id: pair.factorId,
      role: 'option_setting' as const, cell: structuredClone(cell), factor_frame: structuredClone(factor) }] : [];
  });
  if (cells.length === 0) return fact;
  return attachAppliedHumanApproval(fact, { operation_id: operation.turnId, scenario_id: operation.scenarioId,
    approving_user: operation.userId, base_revision: operation.revision, revision: operation.revision + 1,
    graph_hash: fact.result.graph_hash_after, analysis_hash: analysisHash, cells });
}

/** Extend the existing exact-cell pair inlet with committed, revision-bound approval evidence. */
export function resolveDurableHumanAuthority(graph: unknown, scenarioId: string, revision: number | undefined,
  facts: readonly IdentifiedHandlerFact[], complete: boolean): InterventionHumanAuthority {
  if (!complete || revision === undefined) return [];
  const parsedGraph = GraphStateIngressSchema.safeParse(graph);
  if (!parsedGraph.success) return [];
  const graphRow = record(graph), nodes = graphRow?.nodes;
  if (!Array.isArray(nodes) || nodes.some(n => !record(n) || typeof n.id !== 'string')
    || new Set(nodes.map(n => n.id)).size !== nodes.length) return [];
  const authority: { optionId: string; factorId: string }[] = [];
  for (const entry of facts) {
    const fact = DurableHandlerFactSchema.safeParse(entry.fact), ref = readCommittedMutationTurnRef(entry.committed_turn_ref);
    if (!entry.fact_row_id || !Number.isFinite(Date.parse(entry.fact_created_at))) return [];
    if (!fact.success) return [];
    if (fact.data.fact_type !== 'edit_graph') continue;
    const approval = Approval.safeParse(record(fact.data.result)?.human_approval);
    if (!approval.success) continue; // Historical mutations prove no approval.
    const r = approval.data;
    if (ref?.scenario_id !== scenarioId || ref.source_turn_id !== r.operation_id || ref.owner_user_id !== r.approving_user
      || r.scenario_id !== scenarioId || r.revision !== revision || r.analysis_hash !== computeAnalysisAffectingGraphHash(parsedGraph.data)) continue;
    for (const c of r.cells) {
      const option = nodes.find(n => n.id === c.option_id && n.kind === 'option');
      const factor = nodes.find(n => n.id === c.factor_id && n.kind === 'factor');
      const cell = record(option?.interventions)?.[c.factor_id];
      if (isDeepStrictEqual(cell, c.cell) && isDeepStrictEqual(factor, c.factor_frame))
        authority.push({ optionId: c.option_id, factorId: c.factor_id });
    }
  }
  return authority;
}
export interface DurableHumanAuthorityReads {
  readRecentAppliedMutationFactsFor?(scenarioId: string, limit: number): Promise<readonly IdentifiedHandlerFact[]>;
}
export const HUMAN_APPROVAL_READ_LIMIT = 21;
export async function readDurableHumanAuthority(store: DurableHumanAuthorityReads | undefined, graph: unknown,
  scenarioId: string, revision: number | undefined): Promise<InterventionHumanAuthority> {
  try {
    if (!store?.readRecentAppliedMutationFactsFor) return [];
    const facts = await store.readRecentAppliedMutationFactsFor(scenarioId, HUMAN_APPROVAL_READ_LIMIT);
    return resolveDurableHumanAuthority(graph, scenarioId, revision, facts, facts.length < HUMAN_APPROVAL_READ_LIMIT);
  } catch { return []; }
}
