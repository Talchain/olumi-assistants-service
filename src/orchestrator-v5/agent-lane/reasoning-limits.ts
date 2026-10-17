import { isDeepStrictEqual } from 'node:util';

// TODO(T1): replace this local carrier with a type-only FieldRef import from statement-door/subject.ts.
type FieldRefLike = { readonly subject: unknown; readonly field?: string };

/** Safeguard data for coaching; `what` is never authority for a reply check. */
export interface Limit {
  readonly owner: 'A' | 'F' | 'B' | 'R';
  readonly code: string;
  readonly effect: 'write_refused' | 'claim_withheld' | 'needs_input';
  readonly scenario_id: string;
  readonly graph_identity_hash: string;
  readonly run_key?: string;
  readonly turn_id?: string;
  readonly subjects: readonly FieldRefLike[];
  readonly withheld_claims: readonly string[];
  readonly what: string;
  readonly next: { readonly kind: 'ask' | 'card' | 'method' | 'none'; readonly ask_id?: string; readonly proposal_id?: string };
}

export type ReasoningLimitSnapshot = Pick<Limit, 'scenario_id' | 'graph_identity_hash' | 'run_key' | 'turn_id'>;

/**
 * The domain supplies the exact limits it has resolved, alongside its applied receipt.
 * Approval, a subject match or an unrelated save alone never establishes resolution.
 */
export interface AppliedLimitChange {
  readonly applied: boolean;
  readonly resolved_limits: readonly Limit[];
}

/** Keep unresolved entries in order, without changing either the entries or the receipts. */
export function supersedeResolvedLimits(
  limits: readonly Limit[],
  appliedChanges: readonly AppliedLimitChange[],
): readonly Limit[] {
  const resolved = appliedChanges.filter(change => change.applied === true).flatMap(change => change.resolved_limits);
  // Exact data comparison also supports copied receipts; no second subject resolver or prose parser.
  return limits.filter(limit => !resolved.some(entry => isDeepStrictEqual(entry, limit)));
}

/** A narrower Run/turn binding must be proved; absent snapshot identity never widens it. */
export function projectReasoningLimits(
  limits: readonly Limit[],
  snapshot: ReasoningLimitSnapshot,
): readonly Limit[] {
  if (snapshot.scenario_id.trim() === '' || snapshot.graph_identity_hash.trim() === '') return [];
  return limits.filter(limit => limit.scenario_id === snapshot.scenario_id
    && limit.graph_identity_hash === snapshot.graph_identity_hash
    && (limit.run_key === undefined || (limit.run_key.trim() !== '' && limit.run_key === snapshot.run_key))
    && (limit.turn_id === undefined || (limit.turn_id.trim() !== '' && limit.turn_id === snapshot.turn_id)));
}
