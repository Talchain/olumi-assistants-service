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

/**
 * ⭐ C8: a save that minted NO version (a guest's), as its own registration row carries it (`registration-identity.ts`,
 * `unversionedSaveOf`). The UI reads it as proof of the person's own save, never as an Undo point, and refuses a receipt that
 * carries any version key (DGAI #3037), so `version`, `version_id` and `mutation_id` are ABSENT, never null.
 */
export interface UnversionedTurnReceipt {
  readonly kind: 'unversioned';
  readonly scenario_revision: string;
  readonly run_id: string | null;
  readonly source_turn_id: string;
}

const UNVERSIONED_KEYS = ['kind', 'scenario_revision', 'run_id', 'source_turn_id'];

/** Exactly the four keys, well formed; anything else (a version key included) is not an unversioned receipt. */
export function unversionedReceiptOf(value: unknown): UnversionedTurnReceipt | null {
  const r = asMaybeRecord(value);
  if (r === null || Object.keys(r).length !== UNVERSIONED_KEYS.length || !UNVERSIONED_KEYS.every((k) => k in r)) return null;
  if (r.kind !== 'unversioned' || typeof r.scenario_revision !== 'string' || !/^[0-9a-f]{64}$/.test(r.scenario_revision)) return null;
  if (r.run_id !== null && (typeof r.run_id !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(r.run_id))) return null;
  if (typeof r.source_turn_id !== 'string' || !r.source_turn_id.startsWith('graph_registration:')) return null;
  return { kind: 'unversioned', scenario_revision: r.scenario_revision, run_id: r.run_id, source_turn_id: r.source_turn_id };
}

/**
 * Every save this turn's tools reported: each version's receipt (`collectTurnReceipts`, newest last), then each unversioned
 * save's, once per registration row (`source_turn_id`), read from the same two places a version's is.
 */
export function collectSaveReceipts(toolResults: readonly unknown[] | undefined): readonly (TurnReceipt | UnversionedTurnReceipt)[] {
  if (!Array.isArray(toolResults)) return [];
  const unversioned = new Map<string, UnversionedTurnReceipt>();
  for (const result of toolResults) {
    const rec = asMaybeRecord(result);
    if (rec === null) continue;
    for (const candidate of [rec.model_version, ...(Array.isArray(rec.receipts) ? rec.receipts : [])]) {
      const r = unversionedReceiptOf(candidate);
      if (r !== null && !unversioned.has(r.source_turn_id)) unversioned.set(r.source_turn_id, r);
    }
  }
  return [...collectTurnReceipts(toolResults), ...unversioned.values()];
}

function asMaybeRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isReceipt(value: unknown): value is TurnReceipt {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  // Bound by the two IDENTITY fields a consumer needs. A partial object that
  // cannot identify a version is not a receipt, and shipping it would put a
  // half-answer on the wire where the UI expects a version to reconcile against.
  // ⛔ FINITE, not merely `typeof number`. `Number(undefined)` is `NaN` and
  // `typeof NaN === 'number'`, so a `model_version` arriving without its
  // `version_number` normalised to `{ version: NaN }` and passed this guard —
  // putting `NaN` on the wire where a consumer expects a version to reconcile
  // against. Second time this exact trap has bitten today.
  return typeof r.version === 'number' && Number.isFinite(r.version)
    && typeof r.version_id === 'string' && r.version_id.length > 0;
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
    const rec = result as Record<string, unknown>;

    /**
     * ⛔⛔ THE MODEL-CREATING TURN SPELLS IT `model_version`, SINGULAR.
     *
     * `build_model_from_brief` — the lane's primary write, the one that mints
     * version 1 — returns `{ model_version }` (`build-model.ts:441`, and `:423`
     * on the replay path), not `{ receipts: [...] }`. Reading only the plural key
     * left `_agent.receipts` EMPTY on exactly the turn where "said `mutated: true`
     * without saying which version it became" bites hardest.
     *
     * ⚠ The shape differs too: it arrives from the register route as
     * `{ version_number, version_id, mutation_id }` (`agent-capabilities.ts:381`),
     * so `version_number` is normalised to `version` here. Reading the other key
     * without normalising would still have dropped it for want of `version`.
     */
    const mv = asMaybeRecord(rec.model_version);
    if (mv !== null) {
      const normalised = {
        version: Number(mv.version_number),
        version_id: mv.version_id,
        mutation_id: mv.mutation_id,
        source_turn_id: mv.source_turn_id ?? null,
      };
      if (isReceipt(normalised) && !byVersionId.has(normalised.version_id)) {
        byVersionId.set(normalised.version_id, normalised);
      }
    }

    const raw = rec.receipts;
    if (!Array.isArray(raw)) continue;
    for (const candidate of raw) {
      if (!isReceipt(candidate)) continue;
      if (!byVersionId.has(candidate.version_id)) byVersionId.set(candidate.version_id, candidate);
    }
  }
  return [...byVersionId.values()].sort((a, b) => a.version - b.version);
}
