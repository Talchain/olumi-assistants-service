/**
 * ⭐ SYSTEM 1: ONE writer. A pressed door card is ONE `record_statement` operation, written through the existing atomic CAS level
 * door (`commitOptionLevels` → `executeOptionInterventionBatch`) as ONE revision, then read back by identity. Each field's adapter
 * maps the verified reading to the door member that already owns that carrier; no field gets its own store or writer.
 */
import type { DoorReading } from './read.js';
import { createProposal, type ProposalStore } from '../agent-lane/proposal.js';
import type { AgentToolContext, ToolResult } from '../agent-lane/runtime/agent-tools.js';
import { prepareStatementCorrection, statementCorrectionWords, type StatementCorrectionRequest } from './fields/correction.js';
import { applyStatementRecordEdit, approvedStatementRecordOf } from '../goal-target/cohort-forecast-write.js';
import { approvedGraphHeld } from '../agent-lane/runtime/draft-replacement.js';
import { computeGraphIdentityHash } from '../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { constructionOperationId } from '../agent-lane/runtime/build-model.js';
import type { StructuredProposal } from '../agent-lane/proposal.js';
import type { ReframeRead } from '../agent-lane/runtime/goal-repoint.js';

/** Prepare the existing set_statement_record card. The Founder adapter only supplies the canonical read and store. */
export function proposeStatementCorrection(ctx: AgentToolContext, graph: unknown, baseHash: string,
  request: StatementCorrectionRequest, proposals: ProposalStore): ToolResult {
  const prepared = prepareStatementCorrection(graph, request, { now: ctx.user_turn_text, conversation: ctx.user_text }, new Date().toISOString());
  if ('refused' in prepared) return { ok: false, mutated: false, refusal: prepared.refused,
    detail: prepared.refused === 'correction_attestation_protected'
      ? 'This record also holds an approval or other confirmation. A source correction cannot replace it safely yet. No card was created and the record is unchanged.'
      : 'No correction was prepared. Keep the source, intended subject and explicitly retained material together.' };
  const first = prepared.correction.edits[0]!;
  const proposal = createProposal({ scenario_id: ctx.scenario_id, user_id: ctx.authenticated_user_id,
    base_graph_identity_hash: baseHash,
    operations: [{ op: 'set_statement_record', path: first.subject.id,
      value: { expected_node: first.expected_node, user_statement: { subject: first.subject, record: first.record }, correction: prepared.correction } }],
    provenance: { authored_by: 'model_proposed', basis: prepared.correction.source.source },
    validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: prepared.words });
  proposals.put(proposal);
  return { ok: true, mutated: false, proposal_id: proposal.proposal_id, public_label: proposal.public_label,
    base_revision: baseHash, note: 'Show the complete correction card before its own approval. Source, interpretation and approval remain separate.' };
}

/** The existing statement operation's scoped correction is one complete native CAS registration. */
export async function applyCorrectedStatement(ctx: AgentToolContext, parent: StructuredProposal, before: ReframeRead,
  proposals: ProposalStore, dispatch: (path: string, body: unknown) => Promise<{ status: number; json: Record<string, unknown> }>,
  read: () => Promise<ReframeRead | null>): Promise<ToolResult> {
  const approved = parent.operations.length === 1 ? approvedStatementRecordOf(parent.operations[0]!) : undefined;
  const no = (refusal: string): ToolResult => ({ ok: false, mutated: false, applied: false, proposal_id: parent.proposal_id, refusal });
  if (ctx.typed_approval_of !== parent.proposal_id || approved?.correction === undefined) return no('not_applied');
  if (parent.public_label !== statementCorrectionWords(approved.correction)) return no('invalid_statement');
  const written = applyStatementRecordEdit(before.raw, approved);
  if (written.kind === 'refused') return no(written.reason === 'node_changed' ? 'superseded' : written.reason);
  if (written.kind === 'unchanged') return no('own_write_unverified');
  const operationId = constructionOperationId(ctx.scenario_id, `correct_statement:${parent.proposal_id}`);
  const registered = await dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, { graph: written.mutatedGraph,
    expected_graph_hash: before.graph_hash, expected_graph_identity_hash: before.graph_identity_hash, operation_id: operationId });
  if (registered.status >= 400 && registered.status < 500) return no(registered.status === 409 ? 'superseded' : 'not_applied');
  const after = await read();
  const hash = registered.json.graph_identity_hash;
  const acknowledged = hash !== null && typeof hash === 'object' && 'value' in hash ? hash.value : hash;
  if (after === null || typeof acknowledged !== 'string' || acknowledged !== after.graph_identity_hash
    || computeGraphIdentityHash(after.raw as never)?.value !== acknowledged
    || !approvedGraphHeld(written.mutatedGraph, after.raw)
    || applyStatementRecordEdit(after.raw, approved).kind !== 'unchanged') return {
      ok: false, mutated: true, applied: false, proposal_id: parent.proposal_id, refusal: 'not_confirmed' };
  proposals.markApplied(parent.proposal_id, []);
  return { ok: true, mutated: true, applied: true, proposal_id: parent.proposal_id, receipts: [], follow_up: written.confirmation,
    revision_after: computeAnalysisAffectingGraphHash(after.raw as never) };
}

export const RECORD_STATEMENT_OP = 'record_statement' as const;
/** The level door's members (`dispatch.ts` OptionLevelsCommitInput) a field may write through. */
export type DoorWriteMember = 'levels' | 'values' | 'link_effects' | 'risk_occurrence' | 'team_time' | 'cohort_forecast' | 'statement_record' | 'goal_reading'
  | 'identity_confirm' | 'hiring_times' | 'option_capacity';

/** What ONE press writes: the member and its payload, as JSON (the proposal is stored, and read back at the press). */
export interface DoorWrite {
  readonly member: DoorWriteMember;
  readonly payload: unknown;
  /** What the read-back must find beyond the payload (JSON), where the member's postimage is not the payload's alone. */
  readonly expected?: unknown;
}

/**
 * A row's adapter onto its carrier (`RoleRow.writer`, looked up with the row by `doorRowFor`). A reading the carrier cannot
 * represent is refused here, never written approximately. Its write's member is the row's carrier.
 */
export interface FieldWriter {
  readonly approve: (reading: DoorReading, graph: unknown) => DoorWrite | { readonly refused: string };
  /** True when `after` holds exactly this write (the read-back by identity, and the verified no-op on a retry). */
  readonly holds: (write: DoorWrite, after: unknown) => boolean;
}

/** The ONE record writer and reader of the user's words (`statements.ts`), called by a row's writer in the same commit. */
export { withUserStatement, userStatementFor, holdsUserStatement, userStatementRecord } from './statements.js';
