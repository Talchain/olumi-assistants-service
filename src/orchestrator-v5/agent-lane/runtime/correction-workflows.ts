/** Existing approved-change workflows; the capability owner supplies identity/readback functions as ports. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { AgentToolContext, ToolResult } from './agent-tools.js';
import { createProposal, type ProposalStore, type StructuredProposal } from '../proposal.js';
import { prepareStatementCorrection, statementCorrectionWords, statementBoundTo, userStatementRecord, withUserStatement,
  type StatementCorrectionRequest } from '../../statement-door/statements.js';
import { applyStatementRecordEdit, approvedStatementRecordOf } from '../../goal-target/cohort-forecast-write.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { verifyStatements } from '../user-statements.js';
import { wholeStatementIn } from '../../goal-target/input-claim-context.js';
import { prepareHorizonBasisForWrite } from '../../goal-target/horizon-basis-provenance.js';
import { priorAimDescription } from './goal-repoint.js';

interface WorkflowRead {
  readonly raw: Record<string, unknown>; readonly graph_hash: string; readonly graph_identity_hash: string; readonly brief_text?: string | null;
}
interface WorkflowDependencies {
  readonly constructionOperationId: (scenarioId: string, source: string) => string;
  readonly approvedGraphHeld: (candidate: unknown, stored: unknown) => boolean;
}
const isPlainRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Prepare the existing set_statement_record card. The Founder adapter only supplies the canonical read and store. */
export function proposeStatementCorrection(ctx: AgentToolContext, graph: unknown, baseHash: string,
  request: StatementCorrectionRequest, proposals: ProposalStore, diagnostic?: { failed_check?: string }): ToolResult {
  const prepared = prepareStatementCorrection(graph, request, { now: ctx.user_turn_text, conversation: ctx.user_text }, new Date().toISOString(), diagnostic);
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
export async function applyCorrectedStatement(ctx: AgentToolContext, parent: StructuredProposal, before: WorkflowRead,
  proposals: ProposalStore, dispatch: (path: string, body: unknown) => Promise<{ status: number; json: Record<string, unknown> }>,
  read: () => Promise<WorkflowRead | null>, dependencies: WorkflowDependencies): Promise<ToolResult> {
  const { constructionOperationId, approvedGraphHeld } = dependencies;
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

interface QualitativeReframeRequest {
  readonly goal_id: string;
  readonly quote: string;
  /** A proposed label, visibly Olumi's reading rather than a verified quotation. */
  readonly label: string;
}
const identityOf = (g: unknown): string => computeGraphIdentityHash(g as never)?.value ?? '';

/** A qualitative repoint uses the same old-goal node for history, and introduces no operative number or new store. */
function prepareQualitativeReframe(ctx: AgentToolContext, before: WorkflowRead, request: Partial<Record<keyof QualitativeReframeRequest, unknown>>,
  at: string): { refused: string } | { candidate: Record<string, unknown>; new_id: string; words: string; source_line: string } {
  const nodes = Array.isArray(before.raw.nodes) ? before.raw.nodes.filter(isPlainRecord) : [];
  const old = nodes.find(n => n.id === request?.goal_id && n.kind === 'goal');
  if (!old || nodes.filter(n => n.kind === 'goal').length !== 1 || typeof request.quote !== 'string'
    || !wholeStatementIn(ctx.user_turn_text ?? '', request.quote)
    || typeof request.label !== 'string' || request.label.trim() === '' || request.label.length > 120
    || Object.keys(request).some(k => !['goal_id', 'quote', 'label'].includes(k))) return { refused: 'qualitative_goal_not_stated' };
  const subject = { kind: 'goal' as const, id: String(old.id), field: 'measure' as const };
  if (statementBoundTo(before.raw, subject, request.quote) !== 'bound') return { refused: 'not_this_subject' };
  const verified = verifyStatements([{ quote: request.quote, form: 'describes' }], { now: ctx.user_turn_text, conversation: ctx.user_text },
    { subject: { quantity: 'qualitative_aim', node_id: String(old.id) }, unit: '', forms: ['describes'], figuresIn: () => [] });
  if (verified.kind === 'refused') return { refused: verified.refusal };
  const priorDescription = priorAimDescription(before.raw, String(old.id));
  if (priorDescription === undefined) return { refused: 'goal_not_readable' };
  const rows = Array.isArray(before.raw.goal_constraints) ? before.raw.goal_constraints.filter(isPlainRecord) : [];
  const oldRows = rows.filter(r => r.node_id === old.id);
  const description = priorDescription;
  const newId = `aim_${createHash('sha256').update(JSON.stringify([ctx.scenario_id, before.graph_identity_hash, request])).digest('hex').slice(0, 24)}`;
  const label = request.label.trim();
  if (nodes.some(n => n.id === newId || String(n.label).trim() === label)) return { refused: 'goal_not_resolved' };
  const earlier = { ...structuredClone(old), kind: 'outcome', description, analysis_participation: 'retained_excluded' };
  const candidate = structuredClone(before.raw);
  candidate.nodes = nodes.map(n => n.id === old.id ? earlier : structuredClone(n));
  (candidate.nodes as Record<string, unknown>[]).push({ id: newId, kind: 'goal', label, provenance: 'ai_inferred' });
  if (Object.hasOwn(candidate, 'goal_node_id')) candidate.goal_node_id = newId;
  if (Object.hasOwn(candidate, 'goal_constraints')) candidate.goal_constraints = rows.filter(r => r.node_id !== old.id);
  // The existing server-owned timing preparation demotes proof on the earlier outcome; it never creates a new date.
  prepareHorizonBasisForWrite(candidate, before.raw, ctx.scenario_id);
  const newSubject = { kind: 'goal' as const, id: newId, field: 'measure' as const };
  const record = userStatementRecord(newSubject, [{ ...verified.statements[0]!, subject: { quantity: 'qualitative_aim', node_id: newId },
    qualifier: request.label.trim(), qualifier_in_quote: request.quote.includes(request.label.trim()) }], at);
  const recorded = withUserStatement(candidate as Record<string, unknown> & { nodes: unknown[] }, record, newSubject);
  if (recorded === undefined) return { refused: 'goal_not_prepared' };
  const retired = oldRows.length ? ['Earlier limits no longer apply to the new aim. The limits described below stay as earlier context.'] : [];
  const words = [`From your message: “${request.quote}”.`, `Olumi proposes the qualitative aim “${request.label.trim()}”.`,
    `“${String(old.label)}” becomes an earlier outcome, excluded from analysis, with its complete original source, figures and uncertainty retained.`,
    ...retired, `Earlier aim in the saved model: ${description}`,
    'The new aim has no numeric target, baseline, unit, date, distribution or causal relationships. How the options affect this aim remains unknown.',
    'Options, settings, links, other limits and disagreement are unchanged. This card records only the aim change shown. Other changes need their own supported card. Your quote stays yours; the reading remains Olumi’s after approval.',
  ].join('\n');
  return { candidate: recorded, new_id: newId, words, source_line: verified.statements[0]!.source };
}

/** Mint the existing repoint_goal operation, with the complete reviewed candidate frozen in its content identity. */
export function proposeQualitativeReframe(ctx: AgentToolContext, before: WorkflowRead, request: QualitativeReframeRequest,
  proposals: ProposalStore, dependencies: WorkflowDependencies): ToolResult {
  const { constructionOperationId } = dependencies;
  const at = new Date().toISOString(), prepared = prepareQualitativeReframe(ctx, before, request, at);
  if ('refused' in prepared) return { ok: false, mutated: false, refusal: prepared.refused };
  const operationId = constructionOperationId(ctx.scenario_id, `qualitative_reframe:${before.graph_identity_hash}:${identityOf(prepared.candidate)}`);
  const proposal = createProposal({ scenario_id: ctx.scenario_id, user_id: ctx.authenticated_user_id, base_graph_identity_hash: before.graph_hash,
    operations: [{ op: 'repoint_goal', path: prepared.new_id, value: { qualitative_reframe: { request, at, source_line: prepared.source_line }, candidate: prepared.candidate,
      base_identity: before.graph_identity_hash, brief_text: before.brief_text, operation_id: operationId } }],
    provenance: { authored_by: 'model_proposed', basis: request.quote }, validation: { admitted: true, loss_count: 0, refusals: [] },
    public_label: prepared.words });
  proposals.put(proposal);
  return { ok: true, mutated: false, proposal_id: proposal.proposal_id, public_label: proposal.public_label, base_revision: before.graph_hash,
    note: 'Show the complete qualitative goal card and every retired target before its own approval. No number or date is introduced.' };
}

/** Apply only this frozen qualitative repoint through the existing complete-candidate CAS register and readback. */
export async function applyQualitativeReframe(ctx: AgentToolContext, parent: StructuredProposal, before: WorkflowRead,
  proposals: ProposalStore, dispatch: (path: string, body: unknown) => Promise<{ status: number; json: Record<string, unknown> }>,
  read: () => Promise<WorkflowRead | null>, dependencies: WorkflowDependencies): Promise<ToolResult> {
  const { approvedGraphHeld } = dependencies;
  const op = parent.operations[0], v = isPlainRecord(op?.value) ? op.value : {};
  const bound = isPlainRecord(v.qualitative_reframe) ? v.qualitative_reframe : {};
  const no = (refusal: string): ToolResult => ({ ok: false, mutated: false, applied: false, proposal_id: parent.proposal_id, refusal });
  if (ctx.typed_approval_of !== parent.proposal_id || op?.op !== 'repoint_goal' || !isPlainRecord(bound.request) || typeof bound.at !== 'string'
    || typeof bound.source_line !== 'string'
    || before.graph_identity_hash !== v.base_identity || before.brief_text !== v.brief_text) return no('superseded');
  // Recreate only the deterministic native projection from the card's frozen source, never a new AI reading.
  const sourceContext = { ...ctx, user_turn_text: bound.source_line, user_text: bound.source_line };
  const prepared = prepareQualitativeReframe(sourceContext, before, bound.request, bound.at);
  if ('refused' in prepared || !isDeepStrictEqual(prepared.candidate, v.candidate) || op.path !== prepared.new_id
    || parent.public_label !== prepared.words) return no('incomplete_goal_postimage');
  const registered = await dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, { graph: v.candidate,
    expected_graph_hash: before.graph_hash, expected_graph_identity_hash: before.graph_identity_hash, operation_id: v.operation_id });
  if (registered.status >= 400 && registered.status < 500) return no(registered.status === 409 ? 'superseded' : 'not_applied');
  const after = await read();
  const acknowledged = isPlainRecord(registered.json.graph_identity_hash) ? registered.json.graph_identity_hash.value : registered.json.graph_identity_hash;
  if (after === null || typeof acknowledged !== 'string' || acknowledged !== after.graph_identity_hash
    || identityOf(after.raw) !== acknowledged || !approvedGraphHeld(v.candidate, after.raw)) return {
      ok: false, mutated: true, applied: false, proposal_id: parent.proposal_id, refusal: 'not_confirmed' };
  proposals.markApplied(parent.proposal_id, []);
  return { ok: true, mutated: true, applied: true, proposal_id: parent.proposal_id, receipts: [],
    follow_up: 'Recorded the qualitative aim shown on your card. The earlier aim remains historical; the new aim has no numerical target or analysis result.' };
}

