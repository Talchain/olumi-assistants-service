/**
 * ⭐ `option_status_edit` (`@talchain/schemas` 0.69.0, MG F1 T6) — ONE option's lifecycle: feasible | infeasible | removed.
 * The ONE op behind both the UI's option control and the Agent's `authorise_change` (F1 spec §3 + §7, programme-docs
 * `output/mg-0ebb952a/SEMANTIC-MODEL-SPEC.md`).
 *
 * ── WHAT IT CLOSES ──────────────────────────────────────────────────────────
 * Paul's 1 Oct sprint test: the UI showed 4 options while the engine analysed 3, and he could not take the baseline out
 * ("I can't remove it with the available tools"). `structural_delete` destroys the option and its wording; this keeps
 * it in the model, records WHY it is out, and takes it out of the analysis (F5 I1.3).
 *
 * ── WHAT IT WRITES, IN ONE COMMIT ───────────────────────────────────────────
 *   · `option_status` — the user's word for the option (NodeV3, 0.69.0);
 *   · `analysis_participation` — DERIVED here, never sent by the client: `infeasible` / `removed` → `retained_excluded`,
 *     `feasible` → `included`. It is the field the analysis reads (it is hashed, so the last Run reads stale), and the
 *     Run's option gate leaves a user-excluded option out and says so (`run-analysis.ts`, `userExcludedOptions`).
 *
 * ── WHAT IT REFUSES, WITH NOTHING WRITTEN ───────────────────────────────────
 *   · a stale base (409 via `baseHashConflict`, exactly as `structural_rename`);
 *   · a stale STATUS: the stored status (absent = `feasible`) is not the event's `expected_status` — the
 *     `expected_label` pattern, because `infeasible` ↔ `removed` moves no hash (CODEX #78 5930825929);
 *   · an id that names no node, two nodes, or a node that is not an option;
 *   · `feasible` on an Olumi suggestion the user has not adopted: putting it into the comparison IS adoption, which has
 *     its own door (`olumi_option_adoption`, levels shown as Olumi's) — this op never adopts by the back door;
 *   · a change that changes nothing (already that status).
 * The baseline is an option like any other (spec O2).
 */
import type { OlumiResponse, SystemEventTurnPayload } from '@talchain/schemas/boundary';
import { EditGraphHandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';

import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { log } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { BASE_HASH_DIVERGED } from '../graph-management/reason-codes.js';
import { projectGraphForPersistence } from '../persisted-graph-projection.js';
import { mergeAppliedGraphForPersistence } from '../handlers/edit-graph-dispatch.js';
import { applyPatchOperations, PatchApplyError } from '../../orchestrator/patch-applier.js';
import type { PatchOperation } from '../../orchestrator/types.js';

export type OptionStatusEditEvent = Extract<SystemEventTurnPayload['event'], { kind: 'option_status_edit' }>;
export type OptionStatusValue = OptionStatusEditEvent['status'];

/** The participation each status means to the analysis — the ONE map; nothing else derives it. */
export const PARTICIPATION_FOR_STATUS: Readonly<Record<OptionStatusValue, 'included' | 'retained_excluded'>> = {
  feasible: 'included',
  infeasible: 'retained_excluded',
  removed: 'retained_excluded',
};

export interface OptionStatusBaseHashConflict {
  readonly conflict_category: typeof BASE_HASH_DIVERGED;
  readonly recovery_action: 'refresh_and_reconfirm';
  readonly expected_base_graph_hash: string | null;
}

export type OptionStatusEditResult =
  | {
      readonly kind: 'mutated';
      readonly response: OlumiResponse;
      /** The projected graph to persist (full ingress shape). */
      readonly mutatedGraph: unknown;
      readonly appliedOperations: readonly PatchOperation[];
      readonly handlerFacts: readonly HandlerFact[];
      readonly graph: GraphV3T;
      /** The trusted server-read base, for the atomic CAS expected hashes. */
      readonly baseGraph: unknown;
      readonly optionId: string;
      readonly status: OptionStatusValue;
      readonly label: string;
    }
  | {
      readonly kind: 'refused';
      readonly response: OlumiResponse;
      readonly reason: string;
      /** Present ONLY for a stale base hash → 409, never a committed transcript. */
      readonly baseHashConflict?: OptionStatusBaseHashConflict;
    };

export interface ApplyOptionStatusEditParams {
  readonly payload: SystemEventTurnPayload;
  readonly event: OptionStatusEditEvent;
  readonly requestId: string;
  /** Raw graph from the STRICT server-side persisted-graph read. Never client-supplied. */
  readonly persistedGraph: unknown;
}

export class InvalidPersistedOptionStatusGraphError extends Error {
  constructor() {
    super('option_status_edit: the persisted graph is present but malformed');
    this.name = 'InvalidPersistedOptionStatusGraphError';
  }
}

function isDict(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function refuse(
  payload: SystemEventTurnPayload,
  reason: string,
  assistantText: string,
  baseHashConflict?: OptionStatusBaseHashConflict,
): OptionStatusEditResult {
  return {
    kind: 'refused',
    reason,
    ...(baseHashConflict !== undefined ? { baseHashConflict } : {}),
    response: { response_version: 2, assistant_text: assistantText, blocks: [], suggested_actions: [], insights: [], stage_indicator: payload.stage },
  };
}

/**
 * ⭐ THE READ-BACK (F1 spec §8 W4): the option holds EXACTLY the approved status AND the participation it means. One
 * predicate for the dispatch receipt check, the no-write replay check and the Agent's "recorded" — never a value
 * predicate another option could satisfy: bound to the option's id.
 */
export function optionStatusHolds(graph: unknown, optionId: string, status: OptionStatusValue): boolean {
  if (!isDict(graph) || !Array.isArray(graph.nodes)) return false;
  const matches = graph.nodes.filter((n) => isDict(n) && n.id === optionId);
  if (matches.length !== 1) return false;
  const node = matches[0] as Record<string, unknown>;
  return node.kind === 'option' && node.option_status === status && node.analysis_participation === PARTICIPATION_FOR_STATUS[status];
}

/** An Olumi suggestion the user has not adopted (origin kept for life; adoption records `included`). */
/**
 * ⛔ ADOPTION IS NOT CURRENT PARTICIPATION (CODEX overflow #2454 5934135126 P2). An Olumi suggestion is ADOPTED once the
 * user added it (`analysis_participation: 'included'`, `olumi-option-adoption.ts`). Taking an adopted option out of the
 * comparison sets `retained_excluded` beside its `option_status`, so participation alone then read it as never adopted and
 * "put it back" was refused. The rule: an Olumi option is UNADOPTED only when it is not included AND carries no user
 * exclusion; and a status edit on an unadopted suggestion is refused outright (it is not in the comparison to take out —
 * adding it is the adoption door), so an Olumi option holding `infeasible` / `removed` was necessarily adopted first.
 */
export function isUnadoptedOlumiSuggestion(node: Record<string, unknown>): boolean {
  const userExcluded = node.option_status === 'infeasible' || node.option_status === 'removed';
  return node.proposed_by === 'olumi' && node.analysis_participation !== 'included' && !userExcluded;
}

/** The user-facing sentence for a status that landed — said in the user's terms, never as a code. */
export function optionStatusConfirmationText(label: string, status: OptionStatusValue): string {
  switch (status) {
    case 'removed':
      return `Took "${label}" out of the comparison. It stays in your model, marked as removed. Run the analysis again to compare the rest.`;
    case 'infeasible':
      return `Marked "${label}" as not feasible and took it out of the comparison. It stays in your model. Run the analysis again to compare the rest.`;
    case 'feasible':
      return `Put "${label}" back into the comparison. Run the analysis again to include it.`;
  }
}

export function applyOptionStatusEdit(params: ApplyOptionStatusEditParams): OptionStatusEditResult {
  const { payload, event, requestId, persistedGraph } = params;
  const logBase = { request_id: requestId, scenario_id: payload.scenario_id };

  // ── 1. a base we can trust, or nothing ────────────────────────────────────
  if (persistedGraph === null || persistedGraph === undefined) {
    log.info({ ...logBase, event: 'v5.system_event.option_status_edit.no_persisted_graph' }, 'option_status_edit — no persisted model; refusing');
    return refuse(payload, 'no_persisted_graph', `There's no saved model I can safely change yet, so I haven't changed anything.`);
  }
  const graphParse = GraphV3.safeParse(persistedGraph);
  if (!graphParse.success) {
    log.error({ ...logBase, event: 'v5.system_event.option_status_edit.persisted_graph_invalid',
      first_issue_path: graphParse.error.issues[0]?.path.join('.') ?? '' }, 'option_status_edit — persisted graph malformed; failing closed');
    throw new InvalidPersistedOptionStatusGraphError();
  }
  const baseGraph = graphParse.data;

  // ── 2. the stale gate: `analysis_participation` is inside the analysis projection ──
  const currentBaseHash = computeAnalysisAffectingGraphHash(persistedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0]);
  if (currentBaseHash === null || currentBaseHash !== event.base_graph_hash) {
    log.info({ ...logBase, event: 'v5.system_event.option_status_edit.base_hash_diverged', client_base_graph_hash: event.base_graph_hash,
      server_base_graph_hash: currentBaseHash }, 'option_status_edit — client base hash diverged; refusing');
    return refuse(payload, BASE_HASH_DIVERGED,
      `The model has changed since you chose that, so I haven't changed the option. Reload it and choose again.`,
      { recovery_action: 'refresh_and_reconfirm', conflict_category: BASE_HASH_DIVERGED, expected_base_graph_hash: currentBaseHash });
  }

  // ── 3. exactly one OPTION with that id ────────────────────────────────────
  const matches = baseGraph.nodes.filter((n) => n.id === event.option_node_id);
  if (matches.length !== 1) {
    log.info({ ...logBase, event: 'v5.system_event.option_status_edit.option_not_resolved', match_count: matches.length },
      'option_status_edit — the id names no single node; refusing');
    return refuse(payload, matches.length === 0 ? 'node_target_not_found' : 'node_target_ambiguous',
      `I couldn't find that option in the saved model, so I haven't changed anything. Reload it and try again.`);
  }
  const target: Record<string, unknown> & { label: string; kind: string } = { ...matches[0]! };
  if (target.kind !== 'option') {
    log.info({ ...logBase, event: 'v5.system_event.option_status_edit.not_an_option', kind: target.kind },
      'option_status_edit — the id names a node that is not an option; refusing');
    return refuse(payload, 'not_an_option', `"${target.label}" isn't an option, so I haven't changed anything.`);
  }
  if (isUnadoptedOlumiSuggestion(target)) {
    return refuse(payload, 'olumi_suggestion_not_adopted',
      `"${target.label}" is Olumi's suggestion and isn't in your comparison yet. To compare it, add it to your options first; I haven't changed anything.`);
  }
  const participation = PARTICIPATION_FOR_STATUS[event.status];
  const currentStatus = target.option_status ?? 'feasible';
  // ⛔ The hash cannot see infeasible ↔ removed: the event asserts what it read, and a different stored status refuses.
  if (currentStatus !== event.expected_status) {
    log.info({ ...logBase, event: 'v5.system_event.option_status_edit.expected_status_mismatch', expected_status: event.expected_status,
      stored_status: currentStatus }, 'option_status_edit — the stored status moved since it was read; refusing');
    return refuse(payload, 'expected_status_mismatch',
      `"${target.label}" was changed while you were working (it is now ${currentStatus === 'feasible' ? 'in the comparison' : currentStatus === 'removed' ? 'removed' : 'marked not feasible'}), so I haven't changed it. Choose again from what you can see now.`);
  }
  if (currentStatus === event.status && (target.analysis_participation ?? 'included') === participation) {
    return refuse(payload, 'no_effect', `"${target.label}" is already ${event.status === 'feasible' ? 'in the comparison' : `marked ${event.status === 'removed' ? 'removed' : 'not feasible'}`}, so there was nothing to change.`);
  }

  // ── 4. the write: status + derived participation, through the canonical applier ──
  const operations: PatchOperation[] = [
    { op: 'update_node', path: event.option_node_id, value: { option_status: event.status, analysis_participation: participation } },
  ];
  let candidate: GraphV3T;
  try {
    candidate = applyPatchOperations(baseGraph, operations);
  } catch (err) {
    log.error({ ...logBase, event: 'v5.system_event.option_status_edit.apply_failed', code: err instanceof PatchApplyError ? err.code : 'unknown' },
      'option_status_edit — canonical applier refused; nothing written');
    return refuse(payload, err instanceof PatchApplyError ? err.code : 'apply_failed', `I couldn't change that option in the saved model, so I haven't changed anything.`);
  }
  const ingressParse = GraphStateIngressSchema.safeParse(persistedGraph);
  if (!ingressParse.success) {
    return refuse(payload, 'ingress_projection_failed', `I couldn't save that change safely, so I haven't changed anything.`);
  }
  const merged = structuredClone(mergeAppliedGraphForPersistence({
    appliedGraph: candidate, persistedBase: persistedGraph, ingressBase: ingressParse.data, requestId, scenarioId: payload.scenario_id,
  }));
  const projectedGraph = projectGraphForPersistence(merged, {
    scenarioId: payload.scenario_id, turnId: payload.turn_id, turnClass: 'handler', source: 'option_status_edit',
  });
  const projectedParse = GraphV3.safeParse(projectedGraph);
  // The projection must KEEP both fields (the strict mirror declares them): a write that would not hold is refused here.
  if (!projectedParse.success || !optionStatusHolds(projectedGraph, event.option_node_id, event.status)) {
    log.error({ ...logBase, event: 'v5.system_event.option_status_edit.projection_lost_status', parse_ok: projectedParse.success },
      'option_status_edit — the projected graph does not hold the status; refusing the write');
    return refuse(payload, 'projected_graph_invalid', `I couldn't save that change safely, so I haven't changed anything.`);
  }
  const afterHash = computeAnalysisAffectingGraphHash(projectedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0]);

  const fact = {
    fact_type: 'edit_graph' as const,
    fact_version: 1 as const,
    noop: false,
    result: {
      edit_kind: 'structural' as const,
      status: 'applied' as const,
      operations_count: operations.length,
      affected_entities: [{ kind: target.kind, label: target.label }],
      graph_hash_before: currentBaseHash,
      graph_hash_after: afterHash,
      safe_summary: event.status === 'feasible' ? `Put "${target.label}" back into the comparison`
        : `Took "${target.label}" out of the comparison (${event.status === 'removed' ? 'removed' : 'not feasible'})`,
      impact: 'moderate' as const,
      rerun_recommended: true,
    },
  };
  const factCheck = EditGraphHandlerFactSchema.safeParse(fact);
  if (!factCheck.success) {
    log.error({ ...logBase, event: 'v5.system_event.option_status_edit.fact_invalid', parse_error: factCheck.error.message },
      'option_status_edit — receipt failed its own contract; refusing the commit (fail closed)');
    return refuse(payload, 'fact_invalid', `I couldn't record that change properly, so I haven't changed the model.`);
  }
  return {
    kind: 'mutated',
    response: { response_version: 2, assistant_text: optionStatusConfirmationText(target.label, event.status), blocks: [], suggested_actions: [], insights: [], stage_indicator: payload.stage },
    mutatedGraph: projectedGraph,
    appliedOperations: operations,
    handlerFacts: [factCheck.data],
    graph: projectedParse.data,
    baseGraph: persistedGraph,
    optionId: event.option_node_id,
    status: event.status,
    label: target.label,
  };
}
