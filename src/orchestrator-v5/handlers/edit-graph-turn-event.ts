/**
 * R7 — one structured event per edit_graph turn (`v5.edit_graph.turn`).
 *
 * Exactly one event is emitted per `dispatchEditGraph` invocation, covering
 * every outcome: success, rejection, parse / validation / repair-exhausted,
 * no-op, the deterministic clarify/proposal shapes, and a thrown handler error.
 *
 * Content-free by contract: `scenario_id` + `turn_id` plus closed-enum / numeric
 * diagnostics only. No user text, graph contents, or labels. The event is
 * emitted to pino (Datadog-log-queryable) and registered debug-only in the
 * telemetry freeze-gate (no StatsD metric). A slim DB-column persistence is a
 * named, deployment-ordered follow-up — this tranche is pino/Datadog only.
 *
 * The pure helpers here are unit-tested directly so the failure-code mapping
 * and field derivation are locked independently of the dispatcher.
 */
import type { EditGraphResult } from '../../orchestrator/tools/edit-graph.js';

export type EditTurnOutcome =
  | 'success'
  | 'rejected'
  | 'no_op'
  | 'clarify'
  | 'proposal'
  | 'error';

/**
 * Content-free per-turn event shape. A `type` alias (not an `interface`) so it
 * carries an implicit string index signature and is assignable to the telemetry
 * `emit()` `Event` (`Record<string, unknown>`) parameter without a cast.
 */
export type EditTurnEventFields = {
  scenario_id: string;
  turn_id: string;
  outcome: EditTurnOutcome;
  failure_code: string | null;
  branch: string | null;
  prompt_source: string | null;
  prompt_key: string | null;
  prompt_task_id: string | null;
  prompt_version: number | null;
  prompt_hash: string | null;
  prompt_fallback_used: boolean;
  model: string | null;
  /** Input tokens summed across all repair attempts (= total turn cost). */
  input_tokens_est: number;
  /** Output tokens summed across all repair attempts (= total turn cost). */
  output_tokens: number;
  /** Final decisive attempt's provider stop reason; 'unknown' when absent. */
  stop_reason: string;
  graph_nodes_before: number;
  graph_nodes_after: number;
  graph_edges_before: number;
  graph_edges_after: number;
  operations_count: number;
  plot_outcome: string;
  repair_attempts: number;
  latency_ms: number;
};

/**
 * Mutable accumulator the dispatcher populates as each branch runs. The four
 * seed fields are always known at function entry; everything else is filled in
 * by the branch that resolves it and defaulted by {@link finaliseEditTurnEvent}.
 */
export type EditTurnEventAccumulator = Partial<EditTurnEventFields> &
  Pick<
    EditTurnEventFields,
    'scenario_id' | 'turn_id' | 'graph_nodes_before' | 'graph_edges_before'
  >;

/**
 * Classify a thrown handler error into a stable `failure_code` WITHOUT parsing
 * the message string. `handleEditGraph` attaches a structured
 * `editTurnFailureCode` discriminator at its parse / LLM-call throw sites; this
 * reads it and falls back to the structured `orchestratorError.code` for
 * anything else. Narrow by design — only the codes the event needs; this does
 * not introduce a broad error taxonomy.
 */
export function classifyThrownFailureCode(err: unknown): string {
  const e = err as {
    editTurnFailureCode?: unknown;
    orchestratorError?: { code?: unknown };
  };
  const disc = e?.editTurnFailureCode;
  if (disc === 'parse_fail' || disc === 'llm_call_failed') return disc;
  const code = e?.orchestratorError?.code;
  if (typeof code === 'string' && code.length > 0) return code.toLowerCase();
  return 'tool_execution_failed';
}

/**
 * Derive the content-free per-turn fields from a completed `EditGraphResult`.
 *
 * `successfulAppliedMutation` is the dispatcher's single mutation predicate.
 * `proposalEarlyEmitted` flags the deterministic Stage 1/2 proposal shape, and
 * `deterministicClarify` the deterministic add-risk clarification shape — both
 * of which would otherwise read as a plain no-op. (`wasRejected` is checked
 * before `deterministicClarify`, so the add-risk preflight *rejection* — which
 * also sets the clarify flag — is still classified `rejected`.) Tokens /
 * stop_reason / model / repair_attempts / plot_outcome come straight from the
 * tool's threaded diagnostics (null/0/'unknown'/'skipped' on no-LLM returns).
 */
export function deriveEditTurnFieldsFromResult(
  editResult: EditGraphResult,
  opts: {
    successfulAppliedMutation: boolean;
    graphNodesBefore: number;
    graphEdgesBefore: number;
    proposalEarlyEmitted?: boolean;
    deterministicClarify?: boolean;
  },
): Partial<EditTurnEventFields> {
  const d = editResult.diagnostics;
  const operationsCount =
    editResult.operations?.length ?? d?.operations_proposed_count ?? 0;

  let outcome: EditTurnOutcome;
  if (opts.proposalEarlyEmitted) outcome = 'proposal';
  else if (opts.successfulAppliedMutation) outcome = 'success';
  else if (editResult.wasRejected) outcome = 'rejected';
  else if (opts.deterministicClarify && operationsCount === 0) outcome = 'clarify';
  else if (operationsCount === 0) outcome = 'no_op';
  else outcome = 'success';

  const nodesAfter = opts.successfulAppliedMutation
    ? editResult.appliedGraph?.nodes?.length ?? opts.graphNodesBefore
    : opts.graphNodesBefore;
  const edgesAfter = opts.successfulAppliedMutation
    ? editResult.appliedGraph?.edges?.length ?? opts.graphEdgesBefore
    : opts.graphEdgesBefore;

  return {
    outcome,
    failure_code: d?.failure_code ?? null,
    // Default branch from the tool's own classification; the no-op recovery
    // layer overrides this with its recovery branch name when it runs.
    branch: d?.branch_taken ?? null,
    model: d?.model ?? null,
    input_tokens_est: d?.input_tokens_est ?? 0,
    output_tokens: d?.output_tokens ?? 0,
    stop_reason: d?.stop_reason ?? 'unknown',
    graph_nodes_after: nodesAfter,
    graph_edges_after: edgesAfter,
    operations_count: operationsCount,
    plot_outcome: d?.plot_outcome ?? 'skipped',
    repair_attempts: d?.repair_attempts ?? 0,
  };
}

/**
 * Fill defaults for any field a branch did not set, producing the final
 * content-free event payload. Never throws.
 */
export function finaliseEditTurnEvent(
  ev: EditTurnEventAccumulator,
): EditTurnEventFields {
  return {
    scenario_id: ev.scenario_id,
    turn_id: ev.turn_id,
    outcome: ev.outcome ?? 'error',
    failure_code: ev.failure_code ?? null,
    branch: ev.branch ?? null,
    prompt_source: ev.prompt_source ?? null,
    prompt_key: ev.prompt_key ?? null,
    prompt_task_id: ev.prompt_task_id ?? null,
    prompt_version: ev.prompt_version ?? null,
    prompt_hash: ev.prompt_hash ?? null,
    prompt_fallback_used: ev.prompt_fallback_used ?? false,
    model: ev.model ?? null,
    input_tokens_est: ev.input_tokens_est ?? 0,
    output_tokens: ev.output_tokens ?? 0,
    stop_reason: ev.stop_reason ?? 'unknown',
    graph_nodes_before: ev.graph_nodes_before,
    graph_nodes_after: ev.graph_nodes_after ?? ev.graph_nodes_before,
    graph_edges_before: ev.graph_edges_before,
    graph_edges_after: ev.graph_edges_after ?? ev.graph_edges_before,
    operations_count: ev.operations_count ?? 0,
    plot_outcome: ev.plot_outcome ?? 'skipped',
    repair_attempts: ev.repair_attempts ?? 0,
    latency_ms: ev.latency_ms ?? 0,
  };
}
