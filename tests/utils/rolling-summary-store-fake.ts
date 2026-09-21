/**
 * Shared rolling-summary store double + composite ordering predicate.
 *
 * WHY THIS EXISTS — the hand-maintained-mirror trap, same class as
 * `mock-session-store.ts` next door. This fake and its comparator were private
 * to `src/orchestrator-v5/rolling-summary/__tests__/maintainer.test.ts`, and the
 * memory-retention eval (`tools/conversation-harness/scorer/memory-retention.ts`)
 * grew its own in-memory store that compared `updated_turn_created_at` ALONE. So
 * the eval pinned a STRICTLY WEAKER write-ordering guarantee than the unit tests
 * did: a same-timestamp sibling that the units prove must be absorbed would have
 * been silently no-op'd in the eval, and the divergence read as green in both
 * places. One definition, two consumers, drift impossible.
 *
 * ── THE PREDICATE ───────────────────────────────────────────────────────────
 *
 * A JS APPROXIMATION of the SQL monotonic WHERE clause — COMPOSITE
 * (created_at, turn_id, version), mirroring the amended DRAFT migration
 * (Codex r2 fix 3): the store permits same-timestamp turns and totally orders
 * them (created_at, turn_id), so a timestamp-only guard would no-op the write
 * that absorbs a same-timestamp sibling, stranding that turn's content
 * forever. `version` breaks the tie when the watermark turn itself is
 * unchanged (a later pass that absorbed a smaller-id sibling under the same
 * watermark).
 *
 * FIDELITY / KNOWN DIVERGENCES (MINOR-2 — do not overclaim): this is a
 * behavioural approximation valid for the domain the session store actually
 * emits, NOT a byte-identical port of Postgres semantics. Specifically:
 *   - Timestamps compare as RAW ISO STRINGS, which equals the SQL timestamptz
 *     ordering ONLY for same-precision, normalized-ISO-UTC values (the store's
 *     `created_at` column). It does NOT reproduce timestamptz µs precision
 *     across mixed-precision strings; the earlier Date.parse form was strictly
 *     worse (it truncated µs to ms, turning a µs-ordered pair into a false tie
 *     that fell through to the turn_id branch).
 *   - turn_id compares by JS code unit, which equals C-collation byte order
 *     for the ASCII (uuid-style) turn ids in use — but NOT an arbitrary DB
 *     collation.
 *   - It models ONLY the monotonic no-op ({applied:false, regressed:true}).
 *     It does NOT model the RS001 shape guard or the 22007 bad-cast surface
 *     the live function raises on a malformed p_summary.
 * The live guard is verified only once Paul executes the migration.
 */

import type {
  RollingSummaryStorePort,
  UpsertRollingSummaryOutcome,
} from '../../src/orchestrator-v5/rolling-summary/store-adapter.js';
import type { RollingSummary } from '../../src/orchestrator-v5/rolling-summary/summary-types.js';

/** Strict lexicographic tuple compare (created_at, turn_id, version) mirroring
 *  the SQL composite guard's "strictly greater" predicate. See the fidelity note
 *  above for the domain in which raw-string timestamp compare equals the live
 *  timestamptz ordering. */
export function isStrictlyGreaterComposite(a: RollingSummary, b: RollingSummary): boolean {
  if (a.updated_turn_created_at !== b.updated_turn_created_at) {
    return a.updated_turn_created_at > b.updated_turn_created_at;
  }
  if (a.updated_turn_id !== b.updated_turn_id) {
    return a.updated_turn_id > b.updated_turn_id;
  }
  return a.version > b.version;
}

/**
 * In-memory `RollingSummaryStorePort` enforcing the composite monotonic guard.
 *
 * `loadCalls` is counted because several callers assert the injector performs NO
 * store read below the verbatim window (the O-2 byte-identity property).
 */
export class MonotonicRollingSummaryStoreFake implements RollingSummaryStorePort {
  stored: RollingSummary | null = null;
  loadCalls = 0;

  async loadSummary(): Promise<RollingSummary | null> {
    this.loadCalls += 1;
    return this.stored;
  }

  async upsertSummary(_id: string, s: RollingSummary): Promise<UpsertRollingSummaryOutcome> {
    const applied = this.stored === null || isStrictlyGreaterComposite(s, this.stored);
    if (applied) {
      this.stored = s;
      return { applied: true, regressed: false, current_watermark: s.updated_turn_created_at };
    }
    return {
      applied: false,
      regressed: true,
      current_watermark: this.stored!.updated_turn_created_at,
    };
  }
}
