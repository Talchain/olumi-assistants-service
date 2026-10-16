import { resolveScenarioAnalysisSupersession } from '../context/scenario-analysis-supersession.js';
import { failedTurnReply } from '../commit-failure-boundary.js';
/** The retained named-card writer, extracted from TurnExecutor's GM resume.
 * No text routing: only the exact displayed words of a live stored card can apply.
 * The existing commit floor still owns CAS, atomic receipts and replay/readback.
 */
import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import { config } from '../../config/index.js';
import { GraphV3 } from '../../schemas/cee-v3.js';
import { PatchOperationsArraySchema } from '../../orchestrator/patch-validation.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../orchestrator/tools/analysis-ready-helper.js';
import { admitCurrentTurnFence } from '../../orchestrator/turn-fence-prehandler.js';
import { buildTurnContext, loadPersistedGraphStrict, markDraftGraphWriteFailed, GraphStaleWriteError } from '../build-turn-context.js';
import { commitDirectAnswer, computeRequestHash, type CommitMetadata } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { buildAppliedGraphWireField } from '../compose/applied-graph-emit.js';
import { computeExpectedGraphCasHashes } from '../context/graph-cas-conflict.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { deriveAnalysisFreshness } from '../context/freshness.js';
import { extractGraphOptionIds } from '../context/option-identity.js';
import { legacyEditFactsForFreshness, isScenarioAnalysisReasoningAuthority } from '../context/reconcile-scenario-analysis-facts.js';
import { readMayNameLeadingOptionVerdict } from '../context/claim-safety-read.js';
import { claimSafetyScopeFromContext } from '../context/claim-safety-read.js';
import { runWithPendingTurnFence, TurnFenceRejectedError } from '../session/turn-fence.js';
import { isPendingActionExpired } from '../session/pending-action.js';
import { resolveProposalRenderCopy } from '../compose/proposed-change.js';
import { productHoldRecord } from '../agent-lane/proposal-object/record.js';
import { amendHeldOperations, parseProposalEdits } from '../agent-lane/proposal-object/amend.js';
import { PLAIN_APPROVAL_SUPERSEDED } from '../agent-lane/proposal-object/reply.js';
import { PROPOSAL_SUPERSEDED_RESPONSE } from '../routing/proposed-change-synthesis.js';
import { buildFailureResponse } from '../failure-response.js';
import { ModelWriteOwnershipRefused, MODEL_WRITE_OWNERSHIP_REFUSAL_BODY } from '../ownership/door-ownership.js';
import { readRevisionConflictDetails } from '../graph-revision-conflict.js';
import type { GraphConflictFailureDetails } from '../graph-conflict-recovery-keys.js';
import { finaliseV5Response } from '../response-finaliser.js';
import { runAsAgentSubturn } from '../session/agent-subturn-context.js';
import { describeHeldOperationsSubject, GM_HELD_HANDLER_ID } from './edit-graph-referee-gate.js';
import { appendLapseNotice, threadHoldsThroughMutatingCommit } from './hold-thread-through.js';
import { buildGmHeldAppliedReceipt, GM_HELD_APPLY_FAILED_ASSISTANT_TEXT, buildGmHeldAppliedChips,
  deriveUnconfiguredOptionLabels, deriveBlockedConfiguredOptions, executeGmHeldResume, readGmHeldResume } from './gm-held-execute.js';
import type { InternalDispatch } from '../agent-lane/runtime/agent-capabilities.js';

type Reply = Awaited<ReturnType<InternalDispatch>>;
type Writer = (payload: MessageTurnPayload) => Promise<Reply>;
const heldApproval = Symbol('heldApproval');
type ApprovalDispatch = InternalDispatch & { [heldApproval]?: Writer };

/** Bind the existing Agent write accounting/cache wrapper; no route or new store. */
export function bindHeldApprovalWriter(dispatch: InternalDispatch, writer: Writer): InternalDispatch {
  return Object.assign(dispatch, { [heldApproval]: writer });
}

/** Agent capability call site: the route supplies its existing effects wrapper. */
export async function approveHeldProposal(dispatch: InternalDispatch, payload: MessageTurnPayload): Promise<Reply> {
  const writer = (dispatch as ApprovalDispatch)[heldApproval];
  if (writer === undefined) return { status: 503, json: { error: 'held_approval_unavailable' } };
  return writer(payload);
}

type ApprovalOptions = { graphState?: unknown; selectedElements?: Parameters<typeof buildTurnContext>[2] extends infer O ? O extends { selectedElements?: infer S } ? S : never : never };
async function applyHeldProposal(payload: MessageTurnPayload, requestId: string, options: ApprovalOptions) {
  const startedAt = Date.now();
  const context = await buildTurnContext(payload, requestId, { selectedElements: options.selectedElements });
  const heldPending = context.most_recent_pending_actions?.find(p =>
    p.scenario_id === payload.scenario_id && p.chip_id === payload.chip?.id &&
    p.action.kind === 'apply_proposed_change' && p.action.inline_patch?.handler_id === GM_HELD_HANDLER_ID &&
    !isPendingActionExpired(p, Date.now()) && resolveProposalRenderCopy(p.action).message === payload.message);
  if (heldPending === undefined || config.features.graphManagementMode !== 'live' ||
      (payload.source !== 'chip' && payload.source !== 'chip_click')) {
    throw new Error('held_card_not_available');
  }
  const baseGraph = context.persistedGraph ?? options.graphState ?? null;
  const parsedGraph = GraphV3.safeParse(baseGraph);
  const beforeGraph = parsedGraph.success ? parsedGraph.data : null;
  const verdict = readMayNameLeadingOptionVerdict(context.prior_facts, claimSafetyScopeFromContext(context));
  const common = {
    priorFacts: context.prior_facts,
    mayNameLeadingOption: verdict.may_name_leading_option,
    mayNameLeadingOptionConstraintVerdictState: verdict.constraint_verdict_state,
    mayNameLeadingOptionProvenance: verdict.provenance,
    leaderWithheldBecauseUnsizedPath: verdict.unsized_path_cause,
    leaderWithheldBecauseUnrequested: verdict.unsized_path_unrequested,
    answerKind: 'functional' as const,
  };
  // Keep the durable Run authority separate from the hot-window freshness, as in the old writer.
  const durable = context.persistedGraphRead?.status === 'ok_present' && isScenarioAnalysisReasoningAuthority(context.scenario_analysis_fact_set)
    ? context.scenario_analysis_fact_set : undefined;
  const scenarioFreshness = (graph: unknown, hash: string | null, revision?: number) => durable === undefined ? undefined
    : deriveAnalysisFreshness(durable.facts, hash,
      config.cee.optionIdentityFreshnessGuard ? extractGraphOptionIds(graph) : undefined,
      { currentGraph: graph, currentScenarioRevision: revision, priorFactsReadOk: durable.status === 'complete',
        analysisInvalidatedAt: context.analysis_invalidated_at, priorFactsWithTurn: context.prior_facts_with_turn,
        legacyEditFacts: legacyEditFactsForFreshness(context.scenario_analysis_fact_set) });
  const commit = async (response: Parameters<typeof commitDirectAnswer>[0], meta: Partial<CommitMetadata> = {}) => {
    let cas: ReturnType<typeof computeExpectedGraphCasHashes> | undefined;
    if (meta.graph !== undefined && config.features.graphCas.requiresExpectedHash) {
      // Preserve the executor floor: an unknown base cannot license a full-graph write.
      if (context.persistedGraphRead?.status === 'degraded') {
        const reread = await loadPersistedGraphStrict(context.session_id);
        cas = computeExpectedGraphCasHashes(reread);
        if (cas.expectedGraphIdentityHash !== null) throw new Error('held approval has no trusted merge base');
      } else cas = computeExpectedGraphCasHashes(context.persistedGraph);
    }
    return commitDirectAnswer(response, {
      ...cas,
      ...(meta.graph === undefined ? {} : context.persistedGraphRead?.status === 'ok_present'
        ? { refBaseGraph: context.persistedGraphRead.graph }
        : context.persistedGraphRead?.status === 'ok_absent' ? { refBaseGraph: null } : {}),
      scenario_id: context.session_id, turn_id: payload.turn_id || requestId,
      turn_class: 'direct_answer', handler_id: null, request_hash: computeRequestHash(payload),
      llm_calls_used: 0, duration_ms: Date.now() - startedAt, handler_facts: [],
      priorPendingActions: context.most_recent_pending_actions ?? [], ...meta,
      ...(context.persistedRevision !== undefined ? { expectedRevision: context.persistedRevision } : {}),
      coaching_state: context.coaching_state, userMessage: payload.message,
      contentGraph: meta.graph === undefined ? beforeGraph : GraphV3.parse(meta.graph),
    });
  };
  const recovery = async (text: string, consumedPendingRefs?: string[]) => {
    const committed = await commit(composeDirectAnswerResponse({ answerKind: 'functional', assistant_text: text,
      stage: context.stage, suggested_actions: [] }), { ...(consumedPendingRefs ? { consumedPendingRefs } : {}) });
    return { ...common, response: committed.response, effectiveGraph: beforeGraph,
      analysisReady: beforeGraph === null ? undefined : buildCanonicalAnalysisReadyFromGraph(baseGraph),
      freshness: context.persisted_analysis_freshness,
      scenarioFreshness: scenarioFreshness(baseGraph, context.persisted_analysis_freshness?.current_graph_hash ?? null, context.persistedRevision),
      telemetry: { commit_performed: committed.performed, failure_type: null, stages_completed: ['commit'] } };
  };
  const read = readGmHeldResume(heldPending);
  if (read.kind !== 'ok') return recovery('The offer I had open is no longer valid. Tell me what to explore next.');
  const proposalEdits = parseProposalEdits((payload.chip?.parameters as Record<string, unknown> | undefined)?.proposal_edits);
  const superseded = proposalEdits?.fields.length === 0 ? PLAIN_APPROVAL_SUPERSEDED : PROPOSAL_SUPERSEDED_RESPONSE;
  let baseHash: string | null = null;
  try { baseHash = computeAnalysisAffectingGraphHash(baseGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0]); } catch { baseHash = null; }
  const pinnedHash = heldPending.preconditions.graph_hash;
  if (baseHash === null || typeof pinnedHash !== 'string' || pinnedHash.length === 0 || baseHash !== pinnedHash) return recovery(superseded);
  let heldOperations = read.operations;
  if (proposalEdits !== undefined) {
    if (proposalEdits === null || proposalEdits.proposal_id !== heldPending.chip_id)
      return recovery('The offer I had open is no longer valid. Tell me what to explore next.');
    if (proposalEdits.revision !== heldPending.id || proposalEdits.graph_hash !== pinnedHash) return recovery(superseded);
    const record = productHoldRecord(heldPending, baseGraph);
    if (record !== undefined && record.digest !== proposalEdits.digest) return recovery(superseded);
    if (record === undefined) return recovery('The offer I had open is no longer valid. Tell me what to explore next.');
    if (proposalEdits.fields.length > 0) {
      const amended = amendHeldOperations(record, proposalEdits.fields);
      const reparsed = amended.ok ? PatchOperationsArraySchema.safeParse(amended.operations) : undefined;
      if (reparsed === undefined || !reparsed.success) return recovery('The offer I had open is no longer valid. Tell me what to explore next.');
      heldOperations = reparsed.data;
    }
  }
  const freshness = context.persisted_analysis_freshness;
  const outcome = executeGmHeldResume({
    operations: heldOperations, envelopeCap: read.envelopeCap, switchFactorIds: read.switchFactorIds,
    userStatedNodeIds: read.userStatedNodeIds, gradedToday: read.gradedToday, userToday: read.userToday, userEventRisk: read.userEventRisk,
    currentGraph: baseGraph, currentGraphHash: baseHash, freshness: freshness?.freshness ?? 'unknown',
    hasExistingAnalysis: freshness?.freshness === 'fresh' || freshness?.freshness === 'stale',
    scenarioId: context.session_id, turnId: context.request_id, requestId,
  });
  if (outcome.status !== 'executed') return recovery(outcome.userReason ?? GM_HELD_APPLY_FAILED_ASSISTANT_TEXT, [heldPending.chip_id]);
  const readiness = buildCanonicalAnalysisReadyFromGraph(outcome.appliedGraph);
  const subject = describeHeldOperationsSubject(read.operations, baseGraph, { switchFactorIds: read.switchFactorIds });
  const otherHolds = threadHoldsThroughMutatingCommit({
    priorPendingActions: (context.most_recent_pending_actions ?? []).filter(p => p.chip_id !== heldPending.chip_id),
    graphAfterCommit: outcome.mutatedGraph,
    graphHashAfterCommit: computeAnalysisAffectingGraphHash(outcome.mutatedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0]),
    appliedOperations: heldOperations, nowMs: Date.now(), scenarioId: context.session_id, turnId: context.request_id, requestId,
  });
  const receipt = buildGmHeldAppliedReceipt(subject !== null ? [subject] : [], deriveUnconfiguredOptionLabels(readiness), deriveBlockedConfiguredOptions(readiness));
  const committed = await commit(composeDirectAnswerResponse({ answerKind: 'functional',
    assistant_text: otherHolds.notice === null ? receipt : appendLapseNotice(receipt, otherHolds.notice),
    stage: context.stage, suggested_actions: buildGmHeldAppliedChips(readiness),
  }), { handler_facts: [outcome.fact], graph: outcome.mutatedGraph, priorPendingActions: [...otherHolds.threaded], consumedPendingRefs: [heldPending.chip_id] });
  const persisted = GraphV3.safeParse(committed.persistedGraph);
  const postHash = committed.persistedAnalysisGraphHash;
  return { ...common,
    response: { ...committed.response, ...(persisted.success ? { draft_graph: buildAppliedGraphWireField(persisted.data) } : {}) },
    effectiveGraph: persisted.success ? persisted.data : null,
    analysisReady: buildCanonicalAnalysisReadyFromGraph(committed.persistedGraph),
    scenarioFreshness: scenarioFreshness(committed.persistedGraph, postHash, committed.revision),
    freshness: deriveAnalysisFreshness(context.prior_facts, postHash,
      config.cee.optionIdentityFreshnessGuard ? extractGraphOptionIds(committed.persistedGraph) : undefined,
      { currentGraph: committed.persistedGraph, currentScenarioRevision: committed.persistedGraph != null ? committed.revision : undefined,
        analysisInvalidatedAt: context.analysis_invalidated_at, priorFactsWithTurn: context.prior_facts_with_turn,
        legacyEditFacts: legacyEditFactsForFreshness(context.scenario_analysis_fact_set), priorFactsReadOk: context.prior_facts_read_ok }),
    telemetry: { commit_performed: committed.performed, failure_type: null, stages_completed: ['commit'] },
  };
}

/** Preserve the old executor's typed failure/409 mapping at both callers. */
export async function runHeldProposalApproval(payload: MessageTurnPayload, requestId: string, options: ApprovalOptions = {}) {
  try { return await applyHeldProposal(payload, requestId, options); }
  catch (error) {
    if (error instanceof ModelWriteOwnershipRefused) throw error;
    const conflict = error instanceof TurnFenceRejectedError || error instanceof GraphStaleWriteError;
    const details: GraphConflictFailureDetails = error instanceof TurnFenceRejectedError
      ? { phase: 'commit', fence_verdict: error.verdict, conflict_category: `turn_fence_${error.verdict}`,
        recovery_action: error.verdict === 'stopped' ? 'start_new_draft' : error.verdict === 'superseded' ? 'refresh_and_reconfirm' : 'retry_later' }
      : error instanceof GraphStaleWriteError
        ? { phase: 'commit', recovery_action: 'refresh_and_reconfirm', conflict_category: error.conflict_category,
          expected_base_graph_hash: error.expected_base_graph_hash ?? null, ...readRevisionConflictDetails(error) }
        : { phase: 'commit' };
    return { response: buildFailureResponse(conflict ? 'GRAPH_WRITE_CONFLICT' : 'STATE_COMMIT_FAILED', payload.stage, details, { previousUserMessage: payload.message, analysisReady: false, scenarioId: payload.scenario_id, turnId: payload.turn_id, isRetry: payload.source === 'retry', handlerId: null }),
      effectiveGraph: null, analysisReady: undefined, freshness: undefined, scenarioFreshness: undefined, priorFacts: undefined, answerKind: 'functional' as const,
      mayNameLeadingOption: false, mayNameLeadingOptionConstraintVerdictState: null,
      mayNameLeadingOptionProvenance: 'fail_closed_no_turn_context' as const,
      leaderWithheldBecauseUnsizedPath: undefined, leaderWithheldBecauseUnrequested: undefined,
      telemetry: { commit_performed: false, failure_type: conflict ? 'GRAPH_DIVERGED' as const : 'INTERNAL_ERROR' as const, stages_completed: [] as string[] } };
  }
}

/** The Agent already passed scenario ownership; retain the sub-turn and fence identities. */
export async function commitHeldProposalInProcess(payload: MessageTurnPayload, requestId: string): Promise<Reply> {
  return runAsAgentSubturn(payload.scenario_id, () => runWithPendingTurnFence(payload.scenario_id, payload.turn_id, async () => {
    await admitCurrentTurnFence();
    let run: Awaited<ReturnType<typeof runHeldProposalApproval>>;
    try { run = await runHeldProposalApproval(payload, requestId); }
    catch (error) {
      if (!(error instanceof ModelWriteOwnershipRefused)) throw error;
      await markDraftGraphWriteFailed(payload.scenario_id, payload.turn_id, error.code, requestId, 'turn_dead_only');
      return { status: 403, json: MODEL_WRITE_OWNERSHIP_REFUSAL_BODY[error.reason] };
    }
    if (!run.telemetry.commit_performed) { const failure = failedTurnReply(run, payload.stage, requestId); return { status: failure.status, json: { ...failure.json } }; }
    const supersession = resolveScenarioAnalysisSupersession({ windowFreshness: run.freshness, scenarioFreshness: run.scenarioFreshness,
      ...(run.analysisReady ? { readiness: run.analysisReady } : {}) });
    return { status: 200, json: finaliseV5Response(run.response, { analysisReady: run.analysisReady, freshness: run.freshness,
      graph: run.effectiveGraph, priorFacts: run.priorFacts,
      ...(supersession ? { analysisStateFreshness: supersession.freshness, analysisStateCanonical: supersession.canonicalState } : {}) }) as unknown as Record<string, unknown> };
  }));
}
