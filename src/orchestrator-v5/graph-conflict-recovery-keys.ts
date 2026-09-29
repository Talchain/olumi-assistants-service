/**
 * A-2 — THE graph-conflict recovery-metadata manifest (one place).
 *
 * The GRAPH_WRITE_CONFLICT failure path has two producers
 * (`turn-executor.ts`: the turn-fence refusal and the graph-CAS refusal) and
 * one consumer (`route-v2.ts` `extractGraphConflictRecovery`, which forwards
 * the recovery subset onto the 409 BoundaryError envelope for the UI's
 * refresh/reconfirm leg). The consumer used to be a hand-typed allowlist that
 * FAILED SILENT: a key added at a producer simply never reached the wire —
 * `fence_verdict` had to be hand-added when the fence landed, and the next
 * key would have been dropped without a trace.
 *
 * Now:
 *  - the consumer DERIVES its copy loop from `GRAPH_CONFLICT_RECOVERY_KEYS`;
 *  - each producer literal is compile-bound with
 *    `satisfies GraphConflictFailureDetails`, so a NEW recovery key that is
 *    not in this manifest is a TYPE ERROR at the producer (excess-property
 *    check), never a silently-dropped field. Add the key here and both ends
 *    move together.
 *
 * `phase` is deliberately NOT a recovery key: it is failure-envelope
 * bookkeeping, and the extractor has never forwarded it.
 */

export const GRAPH_CONFLICT_RECOVERY_KEYS = [
  'recovery_action',
  'conflict_category',
  'fence_verdict',
  'expected_base_graph_hash',
] as const;

export type GraphConflictRecoveryKey = (typeof GRAPH_CONFLICT_RECOVERY_KEYS)[number];

/**
 * Per-key copy semantics at the 409 envelope, preserved byte-for-byte from
 * the pre-manifest extractor:
 *  - 'string'   — forwarded only when the value is a string (shape guard);
 *  - 'presence' — forwarded whenever the key is present
 *    (`expected_base_graph_hash` is legitimately `null` when the producer
 *    could not compute it, and the UI distinguishes null from absent).
 */
export const GRAPH_CONFLICT_RECOVERY_COPY_MODE: Record<
  GraphConflictRecoveryKey,
  'string' | 'presence'
> = {
  recovery_action: 'string',
  conflict_category: 'string',
  fence_verdict: 'string',
  expected_base_graph_hash: 'presence',
};

/**
 * The compile-time producer binding. A failure-details literal written as
 * `{...} satisfies GraphConflictFailureDetails` cannot carry a key this
 * manifest does not know (excess-property check) — which is the FAIL-LOUD
 * half of the derived copy. Every GRAPH_WRITE_CONFLICT details producer must
 * bind with this type.
 */
export type GraphConflictFailureDetails = { phase: 'commit' } & Partial<
  Record<GraphConflictRecoveryKey, unknown>
>;
