/**
 * ⭐⭐ WHICH VERSION DID THIS TURN PRODUCE?
 *
 * ⛔ THE GAP, MEASURED. The agent response told the UI `_agent.mutated: true`
 * and nothing else about the write. It carried `session_id`, `mode`,
 * `tool_calls`, `mutated`, `hops`, `stopped_reason`, `turn_id`, `durability` —
 * and **no version and no receipt**. So a surface could learn that the model
 * changed but never WHICH committed version it now holds, and could not
 * reconcile what it is showing against what was saved.
 *
 * Contrast control for that absence: `ReceiptSummary` already carries exactly
 * what is needed (`version`, `version_id`, `mutation_id`, `source_turn_id`), and
 * the agent lane builds them on ten sites — they were simply not hoisted out of
 * the tool result.
 *
 * ⭐ NO EXTRA IO, AND NOTHING NEW IS CLAIMED. `AgentTurnResult.tool_results`
 * already carries the FULL results — its own docblock says so: *"Full results,
 * so Olumi can decide what it owes the user this turn."* These receipts are what
 * the writes actually produced, read back from the tool that performed them.
 *
 * ⛔ IT MINTS NOTHING. A turn that wrote nothing reports an empty list, and a
 * turn whose writes produced no receipt reports an empty list — the two are
 * indistinguishable here ON PURPOSE, because this module cannot tell them apart
 * and guessing would be a claim about durability it has no basis for.
 * `_agent.mutated` and `durability` already answer those questions.
 *
 * ⚠ IDENTIFIERS ONLY. A `ReceiptSummary` is four ids and a number; no user
 * content, no labels, no graph. That is what makes it safe to put on a sidecar
 * the client reads.
 */

/** The four fields a receipt carries. Re-declared structurally rather than
 *  imported as a type-only dependency on the proposal module, so this stays a
 *  leaf with no cycle back into the capability layer. */
export interface TurnReceipt {
  readonly version: number;
  readonly version_id: string;
  readonly mutation_id: string;
  readonly source_turn_id: string | null;
}

function isReceipt(value: unknown): value is TurnReceipt {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  // Bound by the two IDENTITY fields a consumer needs. A partial object that
  // cannot identify a version is not a receipt, and shipping it would put a
  // half-answer on the wire where the UI expects a version to reconcile against.
  return typeof r.version === 'number' && typeof r.version_id === 'string';
}

/**
 * Collect every receipt this turn's tools reported, newest version last.
 *
 * ⚠ DE-DUPLICATED BY `version_id`, not by position. One authorisation can write
 * through several tool hops and a retry RECOVERS the original receipts rather
 * than minting new ones, so the same version legitimately appears more than
 * once. Reporting it twice would make a single saved version look like two.
 */
export function collectTurnReceipts(toolResults: readonly unknown[] | undefined): readonly TurnReceipt[] {
  if (!Array.isArray(toolResults)) return [];
  const byVersionId = new Map<string, TurnReceipt>();
  for (const result of toolResults) {
    if (result === null || typeof result !== 'object') continue;
    const raw = (result as Record<string, unknown>).receipts;
    if (!Array.isArray(raw)) continue;
    for (const candidate of raw) {
      if (!isReceipt(candidate)) continue;
      if (!byVersionId.has(candidate.version_id)) byVersionId.set(candidate.version_id, candidate);
    }
  }
  return [...byVersionId.values()].sort((a, b) => a.version - b.version);
}
