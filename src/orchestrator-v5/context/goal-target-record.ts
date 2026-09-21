/**
 * THE SUCCESS-TARGET RECORD — the model-facing answer to "is a success target
 * set, and to what?".
 *
 * ── WHY THIS MODULE EXISTS SEPARATELY FROM THE COMPACTION ADAPTER ──────────
 * It was first written inside `compact-graph-for-contextpack.ts`, riding the
 * compaction outcome. That was WRONG, and the wrongness was invisible because
 * the two things look like one thing:
 *
 *   · The compact GRAPH is legitimately built from `graphStateForTurn`, which
 *     is REQUEST-FIRST (`turn-executor.ts:2004` — `options.graphState ?? null`,
 *     with the persisted graph consulted only as a fallback at `:2123-2128`).
 *     That is correct for the graph: the model should reason over what the user
 *     is looking at.
 *   · The RECORD is a claim about what is SAVED. It must be persisted-FIRST,
 *     or a stale (or forged) client `graph_state` carrying `goal_threshold_raw`
 *     would be reported to the model as recorded state — under an instruction
 *     telling it the block is "read from the saved model itself".
 *
 * That is the witnessed defect's OWN class — unsaved state presented as
 * recorded — re-created by the fix for it, with the client payload rather than
 * the transcript as the contaminating source. Caught in review.
 *
 * ── THE PRECEDENT IS TWENTY LINES AWAY AND WAS PAID FOR ONCE ALREADY ───────
 * `interventionControlledFactorIds` (`turn-executor.ts:2732`) reads
 * `context.persistedGraph ?? options.graphState` and its comment records why:
 * *"A request-FIRST authority let a stale request graph (intervention not yet
 * echoed) read an empty controlled set and leak an option-pinned lever …
 * (P0b-2)."* This module takes the same authority order, deliberately.
 *
 * Living in its own file is the point: a reader here cannot mistake this for
 * "whatever graph the compactor happened to be given". The name says record;
 * the call site must pass the record.
 *
 * ── WHAT REACHES THE MODEL WITHOUT THIS (measured, and narrower than the
 *    first draft of this comment claimed) ────────────────────────────────────
 * `compactGraph` lists `goal_threshold` in its "Dropped per node" set
 * (orchestrator/context/graph-compact.ts:223) and `CompactNode` has no
 * threshold field. MEASURED through the full model-facing chain
 * (compactGraph → formatGraphForContext): a goal node carrying the complete
 * threshold trio and a BARE goal node arrive at the model BYTE-IDENTICAL —
 * `{id, kind, label}` plus provenance. The target value reaches the model
 * nowhere.
 *
 * ⚠ ONE NARROWING, because the honest claim is not "nothing at all". Where
 * `add-constraint.ts:905-920` has written `observed_state` on the goal node,
 * the compact projection keeps `unit` and a `display_value`, so the model does
 * see `{unit: "%", display_value: "80%"}`. That is the CURRENT BASELINE, not
 * the target — a DECOY rather than a set-ness signal, and a model reading it as
 * the target reports the wrong number with an air of real data. It is a further
 * reason to state the target explicitly rather than leave it inferable.
 */

import { extractPersistedGoalTarget } from '../compose/goal-target-receipt-guard.js';

/**
 * ── THE THREE STATES ARE DELIBERATE ────────────────────────────────────────
 *   · `{ status: 'set', value, unit? }` — the record HAS one; quote it.
 *   · `{ status: 'unset' }` — the graph WAS read and registers no target.
 *     A POSITIVE, checkable statement. Key-absence could not carry this: an
 *     absent key is indistinguishable from a projection that dropped it, which
 *     is precisely the ambiguity that caused the witnessed defect.
 *   · `undefined` → key ABSENT — no graph was read, so nothing is known.
 *     UNKNOWN REMAINS UNKNOWN; never downgraded to a reassuring "unset". Same
 *     discipline `readiness` already uses.
 */
export type ContextPackGoalTarget =
  | { readonly status: 'set'; readonly value: number; readonly unit?: string }
  | { readonly status: 'unset' };

/**
 * Project the success-target record for the ContextPack.
 *
 * @param recordGraph THE PERSISTED GRAPH. Callers MUST pass
 *   `context.persistedGraph ?? options.graphState` (the `:2732` order), never
 *   `graphStateForTurn` — see this module's header for what that costs.
 *
 * Reads through the SINGLE authority `extractPersistedGoalTarget`
 * (compose/goal-target-receipt-guard.ts) — the same predicate the receipt guard
 * polices assistant claims against. One contract, one reader.
 *
 * ⚠ TWO BOUNDED BEHAVIOURS, DISCLOSED RATHER THAN SILENTLY RELIED ON:
 *
 *  (a) PRE-COMMIT ASSEMBLY. The pack is assembled before this turn's commit, so
 *      a target registered THIS turn reads `unset` here. That is not a bug:
 *      `unset` was TRUE at assembly time, and the turn's own receipt — policed
 *      by `decideGoalTargetReceipt` against the COMMIT graph — is what tells
 *      the user it has just been set. The two answer different questions and
 *      must not be merged.
 *
 *  (b) MULTIPLE GOAL NODES. `extractPersistedGoalTarget` returns the first goal
 *      node carrying a FINITE threshold, whereas ~10 sibling call sites use
 *      `find(kind === 'goal')` — the first goal node, full stop. These differ
 *      only on a multi-goal graph, which `enforceSingleGoal` (default true)
 *      makes unreachable in practice, and the emitted block names no node id,
 *      so it cannot mis-attribute. Bounded, not fixed here.
 */
export function projectGoalTargetRecord(
  recordGraph: unknown,
): ContextPackGoalTarget | undefined {
  if (recordGraph === null || recordGraph === undefined) return undefined;
  const found = extractPersistedGoalTarget(recordGraph);
  if (found === null) return { status: 'unset' };
  return {
    status: 'set',
    value: found.value,
    ...(found.unit === undefined ? {} : { unit: found.unit }),
  };
}
