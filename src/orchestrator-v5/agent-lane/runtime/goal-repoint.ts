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
import { reachableNodeIds } from '../../../orchestrator/graph-structure-validator.js';
import { mergeInterventionSourceObjects } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { createHash } from 'node:crypto';
import { createProposal, type ProposalStore, type StructuredProposal } from '../proposal.js';
import type { ToolResult } from './agent-tools.js';
import { verifyStatements } from '../user-statements.js';
import { wholeStatementIn } from '../../goal-target/input-claim-context.js';
import { statementBoundTo } from '../../statement-door/read.js';
import { userStatementRecord, withUserStatement } from '../../statement-door/statements.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { approvedGraphHeld } from './draft-replacement.js';
import { constructionOperationId } from './build-model.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

export interface QualitativeReframeRequest {
  readonly goal_id: string;
  readonly quote: string;
  /** A proposed label, visibly Olumi's reading rather than a verified quotation. */
  readonly label: string;
}
export interface ReframeRead {
  readonly raw: Rec; readonly graph_hash: string; readonly graph_identity_hash: string; readonly brief_text?: string;
}
const identityOf = (g: unknown): string => computeGraphIdentityHash(g as never)?.value ?? '';

/** A qualitative repoint uses the same old-goal node for history, and introduces no operative number or new store. */
export function prepareQualitativeReframe(ctx: AgentToolContext, before: ReframeRead, request: QualitativeReframeRequest,
  at: string): { refused: string } | { candidate: Rec; new_id: string; words: string; source_line: string } {
  const nodes = Array.isArray(before.raw.nodes) ? before.raw.nodes.filter(rec) : [];
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
  const rows = Array.isArray(before.raw.goal_constraints) ? before.raw.goal_constraints.filter(rec) : [];
  const oldRows = rows.filter(r => r.node_id === old.id);
  const description = priorDescription;
  const newId = `aim_${createHash('sha256').update(JSON.stringify([ctx.scenario_id, before.graph_identity_hash, request])).digest('hex').slice(0, 24)}`;
  if (nodes.some(n => n.id === newId || String(n.label).trim() === request.label.trim())) return { refused: 'goal_not_resolved' };
  const earlier = { ...structuredClone(old), kind: 'outcome', description, analysis_participation: 'retained_excluded' };
  const candidate = structuredClone(before.raw);
  candidate.nodes = nodes.map(n => n.id === old.id ? earlier : structuredClone(n));
  (candidate.nodes as Rec[]).push({ id: newId, kind: 'goal', label: request.label.trim(), provenance: 'ai_inferred' });
  if (Object.hasOwn(candidate, 'goal_node_id')) candidate.goal_node_id = newId;
  if (Object.hasOwn(candidate, 'goal_constraints')) candidate.goal_constraints = rows.filter(r => r.node_id !== old.id);
  // The existing server-owned timing preparation demotes proof on the earlier outcome; it never creates a new date.
  prepareHorizonBasisForWrite(candidate, before.raw, ctx.scenario_id);
  const newSubject = { kind: 'goal' as const, id: newId, field: 'measure' as const };
  const record = userStatementRecord(newSubject, [{ ...verified.statements[0]!, subject: { quantity: 'qualitative_aim', node_id: newId },
    qualifier: request.label.trim(), qualifier_in_quote: request.quote.includes(request.label.trim()) }], at);
  const recorded = withUserStatement(candidate as Rec & { nodes: unknown[] }, record, newSubject);
  if (recorded === undefined) return { refused: 'goal_not_prepared' };
  const retired = oldRows.length ? ['Earlier limits no longer apply to the new aim. The limits described below stay as earlier context.'] : [];
  const words = [`From your message: “${request.quote}”.`, `Olumi proposes the qualitative aim “${request.label.trim()}”.`,
    `“${String(old.label)}” becomes an earlier outcome, excluded from analysis, with its complete original source, figures and uncertainty retained.`,
    ...retired, `Earlier aim in the saved model: ${description}`,
    'The new aim has no numeric target, baseline, unit, date, distribution or causal relationships. How the options affect this aim remains unknown.',
    'Options, settings, links, other limits and disagreement are unchanged. No requested change is omitted. Your quote stays yours; the reading remains Olumi’s after approval.',
  ].join('\n');
  return { candidate: recorded, new_id: newId, words, source_line: verified.statements[0]!.source };
}

/** Mint the existing repoint_goal operation, with the complete reviewed candidate frozen in its content identity. */
export function proposeQualitativeReframe(ctx: AgentToolContext, before: ReframeRead, request: QualitativeReframeRequest,
  proposals: ProposalStore): ToolResult {
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
export async function applyQualitativeReframe(ctx: AgentToolContext, parent: StructuredProposal, before: ReframeRead,
  proposals: ProposalStore, dispatch: (path: string, body: unknown) => Promise<{ status: number; json: Rec }>,
  read: () => Promise<ReframeRead | null>): Promise<ToolResult> {
  const op = parent.operations[0], v = rec(op?.value) ? op.value : {};
  const bound = rec(v.qualitative_reframe) ? v.qualitative_reframe : {};
  const no = (refusal: string): ToolResult => ({ ok: false, mutated: false, applied: false, proposal_id: parent.proposal_id, refusal });
  if (ctx.typed_approval_of !== parent.proposal_id || op?.op !== 'repoint_goal' || !rec(bound.request) || typeof bound.at !== 'string'
    || typeof bound.source_line !== 'string'
    || before.graph_identity_hash !== v.base_identity || before.brief_text !== v.brief_text) return no('superseded');
  // Recreate only the deterministic native projection from the card's frozen source, never a new AI reading.
  const sourceContext = { ...ctx, user_turn_text: bound.source_line, user_text: bound.source_line };
  const prepared = prepareQualitativeReframe(sourceContext, before, bound.request as unknown as QualitativeReframeRequest, bound.at);
  if ('refused' in prepared || !isDeepStrictEqual(prepared.candidate, v.candidate) || op.path !== prepared.new_id
    || parent.public_label !== prepared.words) return no('incomplete_goal_postimage');
  const registered = await dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, { graph: v.candidate,
    expected_graph_hash: before.graph_hash, expected_graph_identity_hash: before.graph_identity_hash, operation_id: v.operation_id });
  if (registered.status >= 400 && registered.status < 500) return no(registered.status === 409 ? 'superseded' : 'not_applied');
  const after = await read();
  const acknowledged = rec(registered.json.graph_identity_hash) ? registered.json.graph_identity_hash.value : registered.json.graph_identity_hash;
  if (after === null || typeof acknowledged !== 'string' || acknowledged !== after.graph_identity_hash
    || identityOf(after.raw) !== acknowledged || !approvedGraphHeld(v.candidate, after.raw)) return {
      ok: false, mutated: true, applied: false, proposal_id: parent.proposal_id, refusal: 'not_confirmed' };
  proposals.markApplied(parent.proposal_id, []);
  return { ok: true, mutated: true, applied: true, proposal_id: parent.proposal_id, receipts: [],
    follow_up: 'Recorded the qualitative aim shown on your card. The earlier aim remains historical; the new aim has no numerical target or analysis result.' };
}

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

/** The final card's topology, with original participation: never infer a new causal link or discard a branch.
 * A protected part blocks the ENTIRE optional branch exclusion, not recording the changed goal.
 * The same empty exclusion set is checked at approval; Run still owns causal readiness.
 */
export function laterAimOnlyBranch(candidate: Rec, oldId: string, newId: string, before: Rec): { excluded: string[]; blocked: string[] } {
  const nodes = (Array.isArray(candidate.nodes) ? candidate.nodes : []).filter(rec);
  const prior = (Array.isArray(before.nodes) ? before.nodes : []).filter(rec);
  const edges = (Array.isArray(candidate.edges) ? candidate.edges : []).filter(rec)
    .filter((e): e is Rec & { from: string; to: string } => typeof e.from === 'string' && typeof e.to === 'string')
    .map(e => ({ from: e.from, to: e.to, ...(typeof e.edge_type === 'string' ? { edge_type: e.edge_type } : {}) }));
  const reachesOld = reachableNodeIds(edges, [oldId], true), reachesNew = reachableNodeIds(edges, [newId], true);
  const options = [...nodes, ...prior, ...(Array.isArray(candidate.options) ? candidate.options : []).filter(rec)]
    .filter(n => n.kind === 'option' || Object.hasOwn(n, 'interventions'));
  const protectedIds = new Set(options.flatMap(n => Object.keys(mergeInterventionSourceObjects(n as never))));
  for (const n of [...nodes, ...prior]) if (n.kind === 'option') protectedIds.add(String(n.id));
  for (const row of (Array.isArray(candidate.goal_constraints) ? candidate.goal_constraints : []).filter(rec)) protectedIds.add(String(row.node_id));
  const branch = nodes.filter(n => typeof n.id === 'string' && n.id !== oldId && n.id !== newId
    && prior.find(p => p.id === n.id)?.analysis_participation !== 'retained_excluded'
    && reachesOld.has(n.id) && !reachesNew.has(n.id));
  const blocked = branch.filter(n => protectedIds.has(String(n.id))).map(n => String(n.id)).sort();
  return {
    excluded: blocked.length ? [] : branch.filter(n => ['factor', 'risk', 'outcome'].includes(String(n.kind))).map(n => String(n.id)).sort(),
    blocked,
  };
}

/** The repoint card retains all work; only its explicitly listed later-only branch changes participation. */
export function repointRetainsSavedWork(before: Rec, candidate: unknown, oldId: string, newId: string, expectedDescription: string, scenarioId: string, scopeExcluded?: unknown): boolean {
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
  const scope = laterAimOnlyBranch(candidate, oldId, newId, before);
  if (!isDeepStrictEqual(scopeExcluded ?? [], scope.excluded)) return false;
  const otherNodes = (nodes: unknown[]) => nodes.filter(n => rec(n) && n.id !== oldId && n.id !== newId);
  const scopedBefore = otherNodes(before.nodes).map(n => rec(n) && scope.excluded.includes(String(n.id))
    ? { ...n, analysis_participation: 'retained_excluded' } : n);
  if (!isDeepStrictEqual(scopedBefore, otherNodes(candidate.nodes))) return false;
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
