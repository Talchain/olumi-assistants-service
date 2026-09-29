/**
 * ⭐ AN AGENT TURN STATES ITS RUN'S FRESHNESS ON `analysis_ready`, the field the
 * UI actually gates on.
 *
 * THE USER PROBLEM (Panel witness, programme-docs #63 5800618648, UI
 * `3f031d01`, scenario `64ec870a-…`, `?ai=openai`): the user pressed "Use as
 * starting assumptions"; ONE agent turn saved the values and then ran the
 * analysis on them. The Reasoning tab immediately said "The model has changed
 * since this analysis ran. Re-run to be sure" — false: the store's
 * `lastServerGraphHash` equalled the turn's `graph_hash`, and this very payload
 * said `analysis_state.run_state.kind: "complete_current"`.
 *
 * THE MECHANISM. The UI clears its local "an edit happened" overlay only when
 * the turn carries an explicit `analysis_ready.freshness` verdict
 * (DecisionGuideAI `src/v5/applyV5State.ts`, results hydration). The agent route
 * copies `analysis_ready` from the graph read route, which never stamps
 * `freshness` — only the Conventional finaliser does. The Conventional path
 * never mutates and runs in one turn; the agent lane does, so the in-turn write
 * left the overlay dirty over the run that followed it.
 *
 * ⭐ WHY THIS IS NOT A GUESS. `run_state` is derived from CEE's canonical
 * freshness (`compose/analysis-state-v1.ts`): `complete_current` ⇔
 * `freshness === 'fresh'`, `complete_stale` ⇔ `freshness === 'stale'`. Both
 * come from the SAME readback dispatch as `analysis_ready`, so they cannot
 * describe different states. This restates CEE's own verdict on the field the
 * client reads; it derives nothing new.
 *
 * ⛔ WHAT IT NEVER DOES
 *   · overwrite a `freshness` the producer already set;
 *   · say `fresh` for any other run_state (`running`, `never_run`,
 *     `unknown_*`) — an absent verdict is honest, a wrong one is not;
 *   · touch anything but `freshness` / `freshness_reason`.
 */
export const AGENT_READBACK_FRESHNESS_REASON = {
  current: 'agent_readback_run_state_current',
  stale: 'agent_readback_run_state_stale',
} as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * ⭐ THE ATTESTATION A RELOAD NEEDS (Panel, #63, after #1766). The UI's boot
 * restore upgrades its "cannot confirm" hedge to current ONLY when the stored
 * `analysis_ready` says `fresh` AND carries `graph_hash_at_run ===
 * current_graph_hash` (DGAI `deriveRestoredFreshnessAttestation`). #1766 stated
 * `fresh` without the hashes, so every reload on the OpenAI path said "We
 * cannot confirm whether this analysis reflects the current model".
 *
 * Both hashes come from the SAME readback, and neither is manufactured:
 *   · `graph_hash_at_run` ← the run's OWN `analysis_result.computed_against_hash`
 *     (the hash its fact recorded when it ran);
 *   · `current_graph_hash` ← the readback's `graph_hash`.
 * Stamped only when they are EQUAL; a mismatch or an absent hash stamps none,
 * so the UI stays at cannot-confirm rather than receive a false attestation.
 */
export interface ReadbackAttestation {
  readonly graphHash?: unknown;
  readonly analysisResult?: unknown;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function withRunStateFreshness(
  analysisReady: unknown,
  analysisState: unknown,
  readback: ReadbackAttestation = {},
): unknown {
  if (!isPlainRecord(analysisReady)) return analysisReady;
  if (typeof analysisReady.freshness === 'string') return analysisReady;
  const runState = isPlainRecord(analysisState) ? analysisState.run_state : undefined;
  const kind = isPlainRecord(runState) ? runState.kind : undefined;
  if (kind === 'complete_current') {
    const atRun = nonEmpty(isPlainRecord(readback.analysisResult) ? readback.analysisResult.computed_against_hash : undefined);
    const current = nonEmpty(readback.graphHash);
    const computedAt = nonEmpty(isPlainRecord(runState) ? runState.computed_at : undefined);
    const attestation =
      atRun !== null && atRun === current
        ? { graph_hash_at_run: atRun, current_graph_hash: current, ...(computedAt !== null ? { computed_at: computedAt } : {}) }
        : {};
    return { ...analysisReady, freshness: 'fresh', freshness_reason: AGENT_READBACK_FRESHNESS_REASON.current, ...attestation };
  }
  if (kind === 'complete_stale') {
    return { ...analysisReady, freshness: 'stale', freshness_reason: AGENT_READBACK_FRESHNESS_REASON.stale };
  }
  return analysisReady;
}
