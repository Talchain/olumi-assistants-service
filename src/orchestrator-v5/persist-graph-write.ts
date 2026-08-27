/**
 * THE SHARED PERSISTENCE FLOOR — one authority for HOW a graph is persisted,
 * two callers for WHAT is being persisted.
 *
 * ── WHY THIS MODULE EXISTS (C3 closure) ────────────────────────────────────
 * `scenarios.graph` has THREE production writers. TWO of them go through this
 * floor; the third does not, and saying so is the point — an earlier draft of
 * this header said "TWO production writers, not one", which is the same
 * false-absolute defect this module exists to refute, one remove down.
 *
 * MANIFEST, measured at 87cb9f4f over every `.ts` file under `src/` plus all
 * 34 `.sql` files (written without a glob on purpose: the obvious spelling of
 * that glob contains the sequence that closes a block comment):
 *   · `commit.ts` → `commitDirectAnswer` — a TURN commit: a composed
 *     `OlumiResponse` plus its graph, under BI-01 exactly-one-response.  ✅ here
 *   · `routes/assist.v1.scenario-graph-register.ts` — a REGISTRATION: no LLM,
 *     no composed response, no referee, `response_emitted: false`.      ✅ here
 *   · `routes/assist.v1.scenario-versions.ts` — the RESTORE tier:
 *     `service.restoreVersionAtomic` → `restore_model_version_atomic_v1`
 *     → `UPDATE public.scenarios SET graph = p_graph`.       ❌ NOT ON THIS FLOOR
 *   · `store_draft_graph` — zero production callers; the absence is guarded by
 *     `context/__tests__/graph-identity-guards.test.ts`.                    n/a
 *
 * The third writer is LIVE and client-reachable, not dark: registered
 * unconditionally at `server.ts:1214` (`POST /assist/v1/scenarios/
 * :scenario_id/versions/restore`), `CEE_MODEL_VERSIONS_ENABLED` default ON
 * (`config/index.ts:1372`), and the RPC's only content guard is emptiness.
 * Restoring an older version carrying a duplicate node id into a currently-clean
 * scenario is an INTRODUCED violation by this floor's own delta definition —
 * refused on the two paths below, silently written on that one. Routing it here
 * is OUT OF SCOPE for C3 and materially larger: that RPC owns graph + undo +
 * version + head + event in a single statement.
 *
 * ⚠ HOW TO RE-DERIVE THIS LIST (do not trust the list — trust the sweep):
 * `appendCheckedGraphWrite` and `store.append(` over `src/`, AND a `.sql` sweep
 * for `SET graph = p_graph`. Scope the SQL half carefully: a
 * `UPDATE public.scenarios` sweep MISSES the unqualified `UPDATE scenarios`
 * form, which is how most of the `append_turn_atomic` family is written.
 * `append_turn_atomic_v5` does not write `scenarios.graph` itself — it delegates
 * to `_v4` — so the whole v2..v5 family reaches the column through this floor.
 *
 * Those answer DIFFERENT QUESTIONS, so they are not merged: `commitDirectAnswer`
 * requires an `OlumiResponse` and hardcodes `response_emitted: true`, and
 * manufacturing a synthetic response to satisfy it would persist exactly the
 * turn row BI-01 exists to forbid. Naming the two apart is the fix; aligning
 * them would give the turn-commit predicate a second master.
 *
 * What WAS genuinely duplicated is the persistence DISCIPLINE — project, hash,
 * then write — which the register route hand-copied while its own comment
 * admitted it was replicating "the exact ordering defect `commit.ts` was
 * restructured to close". A rule kept correct by hand in two places is the
 * hand-maintained mirror (CLAUDE.md trap 12) one level down from the lists that
 * trap is usually about.
 *
 * ── THE DEFECT THIS CLOSES, MEASURED ───────────────────────────────────────
 * `commit.ts` claimed the terminal invariant check "covers EVERY lane ... by
 * construction rather than by a hand-listed set of call sites", justified by
 * `store.append` being "the single `scenarios.graph` writer in the service".
 * At 75029f4f that justification was FALSE: two production `store.append` call
 * sites, and `checkPersistedGraphInvariants` had exactly ONE production caller
 * (`commit.ts`) with ZERO in the register route — the contrast symbol
 * `projectGraphForPersistence` returning four hits in that same file, so the
 * zero was a measured absence rather than a blind probe.
 *
 * Consequence: a registration could persist a structural violation the turn
 * path refuses fail-closed. Demonstrated RED before this module existed —
 * `append` was called once with a graph carrying an introduced duplicate node
 * id. Routing both writers through here is what makes the "by construction"
 * claim true instead of aspirational.
 *
 * ── WHY THE REPORT IS RECOMPUTED HERE AND NEVER PASSED IN ──────────────────
 * The check MUST describe the bytes that are about to be appended. Accepting a
 * caller-supplied report would let the two drift — a guard whose discrimination
 * depends on a fixture nothing pins — and the drift would be invisible, because
 * a stale report is still a well-formed report. Computing it here from
 * `write.graph`, the same object handed to `store.append` on the next line,
 * makes "the check validates the ACTUAL PERSISTED BYTES" structural rather than
 * a convention every future caller must remember. `commit.ts` computes its own
 * report earlier for a DIFFERENT purpose (the advertised analysis hash); that
 * is not this one and must not be reused as this one.
 *
 * ── WHAT THIS MODULE DELIBERATELY DOES NOT DO ──────────────────────────────
 * · It does not project. Projection must precede HASHING at each call site,
 *   and the hashes are call-site concerns (CAS base, advertised identity), so
 *   moving it here would put a mutation after a hash — the very ordering defect
 *   above. Callers project, then hash, then call this.
 * · It does not choose the RPC generation. `SupabaseSessionStore.append()`
 *   selects between `append_turn_atomic_v2/v3/v4/v5` on the write's shape and
 *   the fence plan. That selection is a SEPARATE closure and is deliberately
 *   untouched here — this module is one CALL-GRAPH authority, which is a
 *   narrower claim than one storage generation.
 */
import { log } from '../utils/telemetry.js';

import {
  checkPersistedGraphInvariants,
  formatViolations,
  PersistedGraphInvariantError,
} from './persisted-graph-invariants.js';
import type { SessionAppendOutcome, SessionStore, SessionTurnWrite } from './session/store.js';

export interface CheckedGraphAppendParams {
  /** The write, already projected and hashed by the caller. */
  readonly write: SessionTurnWrite;
  /** The store to append through. Callers resolve their own. */
  readonly store: SessionStore;
  /**
   * Whether this write carries a graph. Gates the NON-FATAL reporting only —
   * the fatal refusal below is deliberately NOT gated on it, preserving
   * `commit.ts`'s original behaviour verbatim.
   */
  readonly writesGraph: boolean;
  /**
   * The graph as it stood BEFORE this write. Violations already present in it
   * are ABSORBED, never refused — only what this write INTRODUCES can fail it.
   *
   * ⚠ THREE STATES, NOT TWO — and `null` is NOT the observe-only one. The
   * degrade key in `checkPersistedGraphInvariants` is a STRICT
   * `options.baseGraph === undefined` (`persisted-graph-invariants.ts:222`):
   *
   *   · `undefined` — NO BASELINE. Every violation is booked as inherited, so
   *     the check is OBSERVE-ONLY and can never refuse. This is the DEGRADE,
   *     reached when a caller cannot read the base at all (the register route's
   *     base-read catch leaves its variable at the declared `undefined`).
   *   · a stored graph — DELTA-SCOPED. Inherited violations absorbed by count,
   *     only the surplus refuses. This keeps a legacy-corrupt scenario editable.
   *   · `null` — ABSOLUTE, NOT delta-scoped. `null !== undefined`, so it takes
   *     the delta branch, and `rawViolations(null)` is `[]`, so the baseline is
   *     EMPTY and EVERY violation counts as introduced.
   *
   * The third state is not an edge case: `SupabaseSessionStore.loadGraph`
   * returns `null` — never `undefined` — both for an absent scenario row and
   * for a row whose `graph` column is NULL (`supabase-store.ts:1960`, `:1971`).
   * A FIRST IMPORT INTO AN EMPTY SCENARIO IS THEREFORE FULLY FAIL-CLOSED, and
   * that is the dominant import journey.
   *
   * THIS IS A DECISION, NOT AN ACCIDENT (C3 closure). A graph carrying a
   * duplicate node id is structurally invalid; persisting it creates corruption
   * every downstream reader must then tolerate, and the turn path has always
   * refused exactly this. Prefer visible failure over confident wrongness. It is
   * recorded here because it previously rested on an undocumented
   * `null`/`undefined` distinction that no test could see — a `?? undefined` at
   * either call site would silently convert the dominant import journey from
   * fail-closed to write-anything, and the merged suite stayed green under it.
   * Pinned by identity in
   * `routes/__tests__/assist.v1.scenario-graph-register.test.ts`
   * ("a FRESH scenario ... is ABSOLUTE" + its degrade twin).
   */
  readonly baseGraphForInvariants?: unknown;
  /** Free-form origin label for logs (`handler_id`, or a route name). */
  readonly source?: string | undefined;
}

/**
 * Enforce the terminal persisted-graph invariants on the bytes about to be
 * written, then append them. THE SINGLE CALL-GRAPH AUTHORITY for a
 * `scenarios.graph` write.
 *
 * Throws `PersistedGraphInvariantError` when this write INTRODUCES a structural
 * violation — fail-closed, never a silent repair. Repairing here would put a
 * mutation AFTER the caller's hash was computed and recreate the ordering
 * defect this floor exists to close.
 */
export async function appendCheckedGraphWrite(
  params: CheckedGraphAppendParams,
): Promise<SessionAppendOutcome> {
  const { write, store, writesGraph, source } = params;

  const persistedInvariants = checkPersistedGraphInvariants(write.graph, {
    baseGraph: params.baseGraphForInvariants,
  });

  const logBase = {
    scenario_id: write.scenario_id,
    turn_id: write.turn_id,
    turn_class: write.turn_class,
    source,
  };

  // ── FAIL-CLOSED, NEVER A SILENT REPAIR ───────────────────────────────────
  // A violation refuses the write and names what was wrong. The refusal is a
  // throw: each caller's existing failure ladder maps it to its own typed
  // response — a typed commit failure on the turn path, a 422 naming the
  // violated invariant on the registration path.
  if (persistedInvariants.status === 'violated') {
    log.error(
      {
        event: 'v5.graph_persist.invariant_violation',
        ...logBase,
        introduced: persistedInvariants.violations.map((v) => ({
          code: v.code,
          count: v.count,
          entity_ids: v.entity_ids,
        })),
        inherited_count: persistedInvariants.inheritedViolations.length,
      },
      '[persist] REFUSING the write — this write INTRODUCED a structural violation into the graph',
    );
    throw new PersistedGraphInvariantError(persistedInvariants.violations);
  }

  // Inherited corruption is absorbed, NOT refused (a legacy/migration-era graph
  // must stay editable — `edit-graph.ts:2750-2755`), but it is still surfaced:
  // a violation nobody can see is one nobody will ever fix.
  if (writesGraph && persistedInvariants.inheritedViolations.length > 0) {
    log.warn(
      {
        event: 'v5.graph_persist.invariant_inherited',
        ...logBase,
        had_baseline: params.baseGraphForInvariants !== undefined,
        inherited: persistedInvariants.inheritedViolations.map((v) => ({
          code: v.code,
          count: v.count,
          entity_ids: v.entity_ids,
        })),
      },
      '[persist] pre-existing structural violation carried through this write (absorbed, not refused) — ' +
        formatViolations(persistedInvariants.inheritedViolations),
    );
  }

  // Non-fatal findings are surfaced rather than swallowed. These are the
  // invariants NOT yet demonstrated to hold on real traffic, so they are
  // reported and the write proceeds — an honest "we saw this and did not
  // enforce it", never a silent pass.
  if (writesGraph && persistedInvariants.observations.length > 0) {
    log.warn(
      {
        event: 'v5.graph_persist.invariant_observation',
        ...logBase,
        observations: persistedInvariants.observations.map((v) => ({
          code: v.code,
          count: v.count,
          entity_ids: v.entity_ids,
        })),
      },
      '[persist] persisted-graph invariant OBSERVED but not enforced — ' +
        formatViolations(persistedInvariants.observations),
    );
  }

  // A graph whose top-level shape the structural invariants are undefined for
  // is recorded as UNCHECKED rather than counted as a pass — an absence claim
  // about this check must not be read wider than the graphs it can evaluate.
  if (writesGraph && persistedInvariants.status === 'unshaped') {
    log.warn(
      { event: 'v5.graph_persist.invariant_unchecked', ...logBase },
      '[persist] persisted-graph invariants NOT evaluated — the graph has no nodes/edges arrays',
    );
  }

  // Nothing mutates the graph between the check above and this line.
  return await store.append(write);
}
