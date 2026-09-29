/**
 * Agent lane — a write is confirmed by authoritative state, never by a status code.
 *
 * ⛔ THE DEFECT THIS EXISTS TO PREVENT, observed end to end on 22 Sep.
 *
 * The Agent proposed a link, the user said "Yes, add it", the write tool
 * returned `ok: true` because the HTTP status was 200 — and the Agent told the
 * user **"Added: Existing-customer migration and grandfathering policy →
 * Monthly churn rate."**
 *
 * Nothing had been written. CEE had refused, honestly and in the user's own
 * words: *"I couldn't record that properly, so I haven't changed the model."*
 * It committed the turn and wrote no graph (`refusal_reason: "fact_invalid"`).
 * The 200 was a truthful transport result about an untruthful claim.
 *
 * So the Agent reported a mutation that never happened — the exact failure the
 * banked prompt was written to prevent ("Never claim a model mutation happened
 * unless authoritative state says it did"). It was not the model's fault: it
 * relayed what the tool told it.
 *
 * ⭐ THE RULE. A capability that mutates must confirm from the authoritative
 * record afterwards — the graph changed, the receipt exists — and report THAT.
 * A 2xx means the request was processed, not that the intent was honoured.
 */

export interface WriteConfirmation {
  /** True only when authoritative state shows the intended change. */
  readonly applied: boolean;
  /** The revision before and after, so a caller can see movement or its absence. */
  readonly revision_before: string;
  readonly revision_after: string;
  /** Olumi's own words about what happened, when it gave them. */
  readonly system_message?: string;
  readonly reason?: 'unchanged' | 'not_present' | 'confirmed';
}

/**
 * Confirm an edge write by re-reading authoritative state.
 *
 * `edgeExistsAfter` must come from a FRESH read of the persisted graph, not from
 * the write's own response body — a response can describe an intent the store
 * never accepted.
 */
export function confirmEdgeWrite(input: {
  readonly revision_before: string;
  readonly revision_after: string;
  readonly edgeExistsAfter: boolean;
  readonly system_message?: string;
}): WriteConfirmation {
  const moved = input.revision_before !== input.revision_after;
  if (!input.edgeExistsAfter) {
    return {
      applied: false,
      revision_before: input.revision_before,
      revision_after: input.revision_after,
      system_message: input.system_message,
      reason: moved ? 'not_present' : 'unchanged',
    };
  }
  return {
    applied: true,
    revision_before: input.revision_before,
    revision_after: input.revision_after,
    system_message: input.system_message,
    reason: 'confirmed',
  };
}

/**
 * What the Agent may say. Deliberately returns the refusal text Olumi itself
 * produced when there is one, rather than composing a new sentence about it.
 */
export function describeOutcome(c: WriteConfirmation): string {
  if (c.applied) return 'The change was applied to the model.';
  return c.system_message !== undefined && c.system_message.length > 0
    ? c.system_message
    : 'The model was not changed.';
}
