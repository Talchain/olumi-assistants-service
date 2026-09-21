/**
 * Scenario-scoped binding to an existing run_analysis fact. Pure: no fact
 * selection, hashing, clock reads, policy derivation, persistence or telemetry.
 *
 * A tuple match does not establish a unique execution, request idempotency,
 * payload agreement, database durability or permission to present a claim.
 * Callers must resolve conflicting fact contents separately. Current-model
 * currency remains the responsibility of freshness.ts; never restamp a stored
 * binding from the current graph when restoring an interpretation.
 */

export interface AnalysisRunFactIdentity {
  readonly scenario_id: string;
  readonly graph_hash_at_run: string;
  readonly computed_at: string;
}

export interface AnalysisInterpretationPolicy {
  readonly contract_version: string;
  readonly policy_version: string;
}

/** Local comparison input, not a new wire or persistence schema. */
export interface AnalysisInterpretationBinding extends AnalysisInterpretationPolicy {
  readonly run_fact: AnalysisRunFactIdentity;
}

type IdentityField = keyof AnalysisRunFactIdentity;
type PolicyField = keyof AnalysisInterpretationPolicy;

type UnconfirmedIdentity = {
  readonly status: 'unconfirmed';
  readonly reason:
    | 'missing_identity'
    | 'missing_identity_field'
    | 'invalid_identity_field'
    | 'unsupported_hash_representation'
    | 'unsupported_timestamp_representation';
  readonly field?: IdentityField;
};

export type AnalysisRunFactIdentityValidation =
  | { readonly status: 'confirmed'; readonly identity: AnalysisRunFactIdentity }
  | UnconfirmedIdentity;

type UnconfirmedPolicy = {
  readonly status: 'unconfirmed';
  readonly reason: 'missing_policy_binding' | 'invalid_policy_binding' | 'unsupported_policy_binding';
  readonly field?: PolicyField;
};

type BindingMismatch = {
  readonly status: 'mismatch';
  readonly reason: 'scenario_id_conflict' | 'graph_hash_at_run_conflict' | 'computed_at_conflict';
};

type RunFactMatch = {
  readonly status: 'match';
  readonly reason: 'same_run_fact_binding';
  readonly identity: AnalysisRunFactIdentity;
  /** A retry and two executions can carry the same tuple; it cannot decide. */
  readonly execution_identity: 'unconfirmed';
};

export type AnalysisRunFactIdentityComparison =
  | RunFactMatch
  | BindingMismatch
  | (UnconfirmedIdentity & { readonly side: 'left' | 'right' });

export type AnalysisInterpretationBindingComparison =
  | (Omit<RunFactMatch, 'reason'> & {
      readonly reason: 'same_interpretation_binding';
      readonly policy: AnalysisInterpretationPolicy;
    })
  | BindingMismatch
  | { readonly status: 'mismatch'; readonly reason: 'contract_version_conflict' | 'policy_version_conflict' }
  | ((UnconfirmedIdentity | UnconfirmedPolicy) & { readonly side: 'left' | 'right' });

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

/**
 * Reads the existing run fact's result fields without repairing legacy data.
 * graph-hash.ts establishes a lowercase 16-hex token from the analysis-affecting
 * projection; freshness.ts compares these tokens literally. It does not expose
 * a converter for arbitrary admission/identity hashes. A 64-hex value here is
 * explicitly unsupported, even with a matching prefix. No graph is rehashed.
 *
 * run-analysis.ts stamps computed_at with Date.toISOString(). Accept only that
 * canonical UTC millisecond representation; do not round, translate an offset
 * or use a reload/retry timestamp to manufacture a binding.
 */
export function validateAnalysisRunFactIdentity(input: unknown): AnalysisRunFactIdentityValidation {
  const value = record(input);
  if (value === null) return { status: 'unconfirmed', reason: 'missing_identity' };
  const scenario_id = value.scenario_id;
  if (scenario_id == null || scenario_id === '') {
    return { status: 'unconfirmed', reason: 'missing_identity_field', field: 'scenario_id' };
  }
  if (!exactNonEmptyString(scenario_id)) {
    return { status: 'unconfirmed', reason: 'invalid_identity_field', field: 'scenario_id' };
  }
  const graph_hash_at_run = value.graph_hash_at_run;
  if (graph_hash_at_run == null || graph_hash_at_run === '') {
    return { status: 'unconfirmed', reason: 'missing_identity_field', field: 'graph_hash_at_run' };
  }
  if (!exactNonEmptyString(graph_hash_at_run)) {
    return { status: 'unconfirmed', reason: 'invalid_identity_field', field: 'graph_hash_at_run' };
  }
  const computed_at = value.computed_at;
  if (computed_at == null || computed_at === '') {
    return { status: 'unconfirmed', reason: 'missing_identity_field', field: 'computed_at' };
  }
  if (!exactNonEmptyString(computed_at)) {
    return { status: 'unconfirmed', reason: 'invalid_identity_field', field: 'computed_at' };
  }
  if (!/^[0-9a-f]{16}$/.test(graph_hash_at_run)) {
    return { status: 'unconfirmed', reason: 'unsupported_hash_representation', field: 'graph_hash_at_run' };
  }
  const timestamp = Date.parse(computed_at);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(computed_at)
    || !Number.isFinite(timestamp)
    || new Date(timestamp).toISOString() !== computed_at
  ) {
    return { status: 'unconfirmed', reason: 'unsupported_timestamp_representation', field: 'computed_at' };
  }
  return { status: 'confirmed', identity: { scenario_id, graph_hash_at_run, computed_at } };
}

/** Compares historical bindings only, without selecting a winner on conflict. */
export function compareAnalysisRunFactIdentity(
  left: unknown,
  right: unknown,
): AnalysisRunFactIdentityComparison {
  // A positively known foreign scope is already a conflict. Unsupported
  // graph/time fields must not downgrade it to legacy same-scenario output.
  // This checks only the existing exact-string scope rule; it confirms no
  // other component and never repairs or normalises an unsupported identity.
  const leftScenario = record(left)?.scenario_id;
  const rightScenario = record(right)?.scenario_id;
  if (
    exactNonEmptyString(leftScenario)
    && exactNonEmptyString(rightScenario)
    && leftScenario !== rightScenario
  ) {
    return { status: 'mismatch', reason: 'scenario_id_conflict' };
  }
  const a = validateAnalysisRunFactIdentity(left);
  if (a.status === 'unconfirmed') return { ...a, side: 'left' };
  const b = validateAnalysisRunFactIdentity(right);
  if (b.status === 'unconfirmed') return { ...b, side: 'right' };
  for (const field of ['scenario_id', 'graph_hash_at_run', 'computed_at'] as const) {
    if (a.identity[field] !== b.identity[field]) {
      return { status: 'mismatch', reason: `${field}_conflict` };
    }
  }
  return {
    status: 'match',
    reason: 'same_run_fact_binding',
    identity: a.identity,
    execution_identity: 'unconfirmed',
  };
}

function validatePolicy(
  value: Record<string, unknown> | null,
  supported: readonly AnalysisInterpretationPolicy[],
): { readonly status: 'confirmed'; readonly policy: AnalysisInterpretationPolicy } | UnconfirmedPolicy {
  const contract_version = value?.contract_version;
  if (contract_version == null || contract_version === '') {
    return { status: 'unconfirmed', reason: 'missing_policy_binding', field: 'contract_version' };
  }
  if (!exactNonEmptyString(contract_version)) {
    return { status: 'unconfirmed', reason: 'invalid_policy_binding', field: 'contract_version' };
  }
  const policy_version = value?.policy_version;
  if (policy_version == null || policy_version === '') {
    return { status: 'unconfirmed', reason: 'missing_policy_binding', field: 'policy_version' };
  }
  if (!exactNonEmptyString(policy_version)) {
    return { status: 'unconfirmed', reason: 'invalid_policy_binding', field: 'policy_version' };
  }
  if (!supported.some((p) => p.contract_version === contract_version && p.policy_version === policy_version)) {
    return { status: 'unconfirmed', reason: 'unsupported_policy_binding' };
  }
  return { status: 'confirmed', policy: { contract_version, policy_version } };
}

/**
 * Reuse requires the same run-fact tuple AND the same explicitly supported
 * contract/policy pair. No supported versions are invented here; the caller
 * supplies the pairs it can interpret. Empty support means unconfirmed.
 * Matching still makes no statement about the interpretation's content or
 * current presentation permission.
 */
export function compareAnalysisInterpretationBinding(
  left: unknown,
  right: unknown,
  supported: readonly AnalysisInterpretationPolicy[],
): AnalysisInterpretationBindingComparison {
  const a = record(left);
  const b = record(right);
  const run = compareAnalysisRunFactIdentity(a?.run_fact, b?.run_fact);
  if (run.status !== 'match') return run;
  const leftPolicy = validatePolicy(a, supported);
  if (leftPolicy.status === 'unconfirmed') return { ...leftPolicy, side: 'left' };
  const rightPolicy = validatePolicy(b, supported);
  if (rightPolicy.status === 'unconfirmed') return { ...rightPolicy, side: 'right' };
  for (const field of ['contract_version', 'policy_version'] as const) {
    if (leftPolicy.policy[field] !== rightPolicy.policy[field]) {
      return { status: 'mismatch', reason: `${field}_conflict` };
    }
  }
  return { ...run, reason: 'same_interpretation_binding', policy: leftPolicy.policy };
}
