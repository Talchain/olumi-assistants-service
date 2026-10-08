/**
 * Include an existing Olumi suggestion in the user's next comparison.
 *
 * The option keeps its id, edges, Olumi origin and estimated levels. Only its
 * participation changes. This is an in-process door for a displayed Agent
 * approval, not a new client-write endpoint.
 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { EditGraphHandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import type { OlumiResponse } from '@talchain/schemas/boundary';

import {
  GraphStaleWriteError,
  loadMostRecentPendingActionsIntegrityStrict,
  loadPersistedGraphStrict,
  loadPersistedScenarioStateStrict,
} from '../build-turn-context.js';
import { commitDirectAnswer } from '../commit.js';
import { TurnFenceRejectedError } from '../session/turn-fence.js';
import { useAppendV6 } from '../session/supabase-store.js';
import { isRevisionConflict } from '../graph-revision-conflict.js';
import { computeExpectedGraphCasHashes } from '../context/graph-cas-conflict.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { normaliseAbsenceOnly, projectGraphForPersistence } from '../persisted-graph-projection.js';
import { GraphV3 } from '../../schemas/cee-v3.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface CommitOlumiOptionAdoptionInput {
  readonly scenario_id: string;
  readonly turn_id: string;
  readonly base_graph_hash: string;
  readonly expected_graph_identity_hash: string;
  readonly option_id: string;
  readonly expected_label: string;
  readonly expected_interventions: Readonly<Record<string, unknown>>;
}

export type CommitOlumiOptionAdoptionResult =
  | { readonly status: 'committed'; readonly graph_hash: string; readonly model_version_receipt?: unknown }
  | { readonly status: 'stale' }
  | { readonly status: 'refused'; readonly reason: string }
  | { readonly status: 'unconfirmed' };

export type ApplyOlumiOptionAdoptionResult =
  | { readonly kind: 'mutated'; readonly graph: Rec; readonly graph_hash: string; readonly fact: HandlerFact }
  | { readonly kind: 'stale' }
  | { readonly kind: 'refused'; readonly reason: string };

/** Pure, exact-postimage transform over the authoritative stored graph. */
export function applyOlumiOptionAdoption(
  before: unknown,
  input: Omit<CommitOlumiOptionAdoptionInput, 'scenario_id' | 'turn_id'>,
): ApplyOlumiOptionAdoptionResult {
  const parsed = GraphV3.safeParse(before);
  if (!parsed.success || !isRec(before) || !Array.isArray(before.nodes) || !Array.isArray(before.edges)) {
    return { kind: 'refused', reason: 'canonical_graph_unavailable' };
  }
  // The persistence projection may repair unrelated fields. An adoption must
  // never accidentally bundle that repair with a user's one-option approval.
  if (!isDeepStrictEqual(projectGraphForPersistence(before), normaliseAbsenceOnly(before))) {
    return { kind: 'refused', reason: 'canonical_graph_unavailable' };
  }
  const cas = computeExpectedGraphCasHashes(before);
  if (cas.expectedGraphAnalysisHash === null || cas.expectedGraphIdentityHash === null
    || cas.expectedGraphAnalysisHash !== input.base_graph_hash
    || cas.expectedGraphIdentityHash !== input.expected_graph_identity_hash) {
    return { kind: 'stale' };
  }
  const current = before.nodes.filter((n): n is Rec => isRec(n) && n.id === input.option_id);
  if (current.length !== 1 || current[0]!.kind !== 'option') return { kind: 'refused', reason: 'option_not_found' };
  const option = current[0]!;
  if (option.proposed_by !== 'olumi') return { kind: 'refused', reason: 'not_olumi_suggestion' };
  if (option.analysis_participation === 'included') return { kind: 'refused', reason: 'already_included' };
  if (option.analysis_participation === 'retained_excluded') return { kind: 'refused', reason: 'excluded_option' };
  if (option.label !== input.expected_label
    || !isDeepStrictEqual(option.interventions ?? {}, input.expected_interventions)) {
    return { kind: 'stale' };
  }
  const graph = structuredClone(before) as Rec & { nodes: unknown[]; edges: unknown[] };
  const adopted = graph.nodes.find((n): n is Rec => isRec(n) && n.id === input.option_id)!;
  adopted.analysis_participation = 'included';
  const post = GraphV3.safeParse(graph);
  if (!post.success || post.data.nodes.find((n) => n.id === input.option_id)?.analysis_participation !== 'included'
    || !isDeepStrictEqual(projectGraphForPersistence(graph), normaliseAbsenceOnly(graph))) {
    return { kind: 'refused', reason: 'canonical_postimage_invalid' };
  }
  // The single sanctioned delta is on the chosen option. Its Olumi authorship,
  // every intervention byte, all edges and all other graph data remain intact.
  const restored = structuredClone(graph);
  const restoredNode = (restored.nodes as unknown[]).find((n): n is Rec => isRec(n) && n.id === input.option_id)!;
  if (Object.hasOwn(option, 'analysis_participation')) restoredNode.analysis_participation = option.analysis_participation;
  else delete restoredNode.analysis_participation;
  if (!isDeepStrictEqual(restored, before)) return { kind: 'refused', reason: 'postimage_scope_mismatch' };
  const graphHash = computeAnalysisAffectingGraphHash(graph as never);
  if (graphHash === null || graphHash === input.base_graph_hash) {
    return { kind: 'refused', reason: 'participation_not_in_analysis_hash' };
  }
  const label = String(option.label);
  const fact = EditGraphHandlerFactSchema.parse({
    fact_type: 'edit_graph', fact_version: 1, noop: false,
    result: {
      edit_kind: 'structural', status: 'applied', operations_count: 1,
      affected_entities: [{ kind: 'option', label: label.slice(0, 120) }],
      graph_hash_before: input.base_graph_hash, graph_hash_after: graphHash,
      safe_summary: "Included Olumi's suggestion in the comparison",
      impact: 'high', rerun_recommended: true,
    },
  }) as HandlerFact;
  return { kind: 'mutated', graph, graph_hash: graphHash, fact };
}

/**
 * One atomic graph/version write with the store's identity+analysis CAS. A
 * successful return also requires the committed bytes and a strict readback.
 */
export async function commitOlumiOptionAdoptionInProcess(
  input: CommitOlumiOptionAdoptionInput,
  requestId: string,
): Promise<CommitOlumiOptionAdoptionResult> {
  let before: unknown;
  let expectedRevision: number | undefined;
  let priorPendingActions: Awaited<ReturnType<typeof loadMostRecentPendingActionsIntegrityStrict>>;
  try {
    if (useAppendV6()) {
      [{ graph: before, revision: expectedRevision }, priorPendingActions] = await Promise.all([
        loadPersistedScenarioStateStrict(input.scenario_id),
        loadMostRecentPendingActionsIntegrityStrict(input.scenario_id, requestId),
      ]);
    } else {
      [before, priorPendingActions] = await Promise.all([
        loadPersistedGraphStrict(input.scenario_id),
        loadMostRecentPendingActionsIntegrityStrict(input.scenario_id, requestId),
      ]);
    }
  } catch {
    return { status: 'refused', reason: 'canonical_read_failed' };
  }
  const applied = applyOlumiOptionAdoption(before, input);
  if (applied.kind === 'stale') return { status: 'stale' };
  if (applied.kind === 'refused') return { status: 'refused', reason: applied.reason };

  const response: OlumiResponse = {
    response_version: 2, assistant_text: '', blocks: [], suggested_actions: [], insights: [],
    stage_indicator: 'frame', graph_hash: applied.graph_hash,
  };
  const requestHash = `sha256:${createHash('sha256').update(JSON.stringify({
    kind: 'agent_olumi_option_adoption', scenario_id: input.scenario_id, option_id: input.option_id,
    turn_id: input.turn_id, base_graph_hash: input.base_graph_hash,
    expected_graph_identity_hash: input.expected_graph_identity_hash,
  })).digest('hex').slice(0, 32)}`;
  try {
    const committed = await commitDirectAnswer(response, {
      scenario_id: input.scenario_id,
      turn_id: input.turn_id,
      turn_class: 'direct_answer',
      handler_id: null,
      request_hash: requestHash,
      llm_calls_used: 0,
      duration_ms: 0,
      handler_facts: [applied.fact],
      graph: applied.graph,
      baseGraphForInvariants: before,
      pending_actions: [],
      priorPendingActions,
      contentGraph: applied.graph,
      ...computeExpectedGraphCasHashes(before),
      coaching_state: null,
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    });
    if (!committed.graphPersisted || !committed.thisAttemptWrote
      || committed.persistedAnalysisGraphHash !== applied.graph_hash) {
      return { status: 'unconfirmed' };
    }
    const readback = await loadPersistedGraphStrict(input.scenario_id);
    const node = isRec(readback) && Array.isArray(readback.nodes)
      ? readback.nodes.find((n): n is Rec => isRec(n) && n.id === input.option_id) : undefined;
    if (!isRec(node) || node.proposed_by !== 'olumi' || node.analysis_participation !== 'included'
      || node.label !== input.expected_label
      || !isDeepStrictEqual(node.interventions ?? {}, input.expected_interventions)
      || computeAnalysisAffectingGraphHash(readback as never) !== applied.graph_hash) {
      return { status: 'unconfirmed' };
    }
    return {
      status: 'committed',
      graph_hash: applied.graph_hash,
      // The atomic store carrier has `version_number`; Agent consumers parse the
      // public receipt's `sequence`. Use the committed response's attached
      // receipt, and leave it absent if attachment could not be verified.
      ...(committed.response.model_version_receipt !== undefined
        ? { model_version_receipt: committed.response.model_version_receipt } : {}),
    };
  } catch (err) {
    if (isRevisionConflict(err)) throw err;
    if (err instanceof GraphStaleWriteError) return { status: 'stale' };
    // ⛔ B8 (CODEX CR 5934133792): a turn-fence verdict means the store wrote NOTHING. It is never "unconfirmed" (the
    // Agent would say "may have been saved"); it reaches the fence wrapper, which maps it to `stale` / `refused`.
    if (err instanceof TurnFenceRejectedError) throw err;
    return { status: 'unconfirmed' };
  }
}
