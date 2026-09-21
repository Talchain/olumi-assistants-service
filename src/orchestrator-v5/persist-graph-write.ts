/**
 * THE SHARED PERSISTENCE FLOOR — one authority for HOW a graph is persisted,
 * two callers for WHAT is being persisted.
 *
 * ── WHY THIS MODULE EXISTS (C3 closure) ────────────────────────────────────
 * `scenarios.graph` has THREE production writers. ALL THREE now stand on the
 * INVARIANT CHECK; TWO of them also take the APPEND (C8, 27 Aug 2026). Saying
 * exactly which half each one uses is the point — an earlier draft of this
 * header said "TWO production writers, not one", which is the same
 * false-absolute defect this module exists to refute, one remove down, and the
 * draft after it said the third writer was simply "NOT ON THIS FLOOR" when what
 * was true is that it could not take the floor's APPEND. The floor has two
 * halves and they have different populations. Do not collapse them again.
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
 *     → `UPDATE public.scenarios SET graph = p_graph`.
 *                                      ✅ CHECK ONLY — its own atomic RPC appends
 *   · `store_draft_graph` — zero production callers; the absence is guarded by
 *     `context/__tests__/graph-identity-guards.test.ts`.                    n/a
 *
 * The third writer is LIVE and client-reachable, not dark: registered
 * unconditionally at `server.ts:1214` (`POST /assist/v1/scenarios/
 * :scenario_id/versions/restore`), `CEE_MODEL_VERSIONS_ENABLED` default ON
 * (`config/index.ts:1372`), and the RPC's only content guard is emptiness.
 * Restoring an older version carrying a duplicate node id into a currently-clean
 * scenario is an INTRODUCED violation by this floor's own delta definition. C3
 * left it silently written on that path; C8 refuses it, via
 * `assertNoIntroducedGraphViolations` — the CHECK half, called by the route
 * between its projection and its RPC. Its APPEND stays where it is, on purpose:
 * that RPC owns graph + undo + version + head + event in a single statement AND
 * its CAS is strictly stronger than the turn path's (see that function's JSDoc
 * for the measurement). Converging it would have cost a guarantee.
 *
 * ⭐ YOU NO LONGER HAVE TO RE-DERIVE THIS LIST BY HAND, AND YOU SHOULD NOT: it is
 * pinned by execution in `__tests__/graph-writer-population.guard.test.ts`,
 * which sweeps production TS **and** the migration SQL and REDs when a fourth
 * writer appears by either route. This paragraph has been wrong twice; the pin
 * is what stops there being a third time. If it goes red, read that file's
 * header before editing anything here.
 *
 * ⚠ HOW IT RE-DERIVES THE LIST (the pin does this; kept here for readers):
 * `appendCheckedGraphWrite` and `store.append(` over `src/`, AND a `.sql` sweep
 * for `SET graph = p_graph`. Scope the SQL half carefully: a
 * `UPDATE public.scenarios` sweep MISSES the unqualified `UPDATE scenarios`
 * form, which is how most of the `append_turn_atomic` family is written.
 * `append_turn_atomic_v5` does not write `scenarios.graph` itself — it delegates
 * to `_v4` — so the whole v2..v5 family reaches the column through this floor.
 *
 * THE FIRST TWO answer DIFFERENT QUESTIONS, so they are not merged (this is a
 * statement about those two callers only — the restore tier is not "unmerged",
 * it is simply NOT ON THIS FLOOR): `commitDirectAnswer`
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
 * Who is writing, for the log line only. `turn_id`/`turn_class` are OPTIONAL
 * because the third writer is not a turn: the restore tier replaces the working
 * graph outright and has no turn row to name (C8).
 */
export interface GraphWriteIdentity {
  readonly scenario_id: string;
  readonly turn_id?: string | null | undefined;
  readonly turn_class?: string | null | undefined;
}

/** Params for the CHECK alone — no store, no append. */
export interface GraphInvariantAssertionParams {
  /**
   * The exact bytes about to be persisted. Callers pass the SAME object they
   * hand to their writer on the next line — see the module header on why the
   * report is recomputed here and never passed in.
   */
  readonly graph: unknown;
  readonly identity: GraphWriteIdentity;
  readonly writesGraph: boolean;
  /** Same three-state semantics as `CheckedGraphAppendParams`. Read its JSDoc. */
  readonly baseGraphForInvariants?: unknown;
  readonly source?: string | undefined;
}

/**
 * THE CHECK, WITHOUT THE APPEND — the half of this floor that a writer owning
 * its own atomic statement can still stand on.
 *
 * ── WHY THIS IS SPLIT OUT (C8 closure) ─────────────────────────────────────
 * The module header above records that the restore tier
 * (`routes/assist.v1.scenario-versions.ts` → `service.restoreVersionAtomic` →
 * `restore_model_version_atomic_v1`) was NOT on this floor, and that routing it
 * here was "materially larger: that RPC owns graph + undo + version + head +
 * event in a single statement". That remains true, and it is why the fix is
 * this split rather than a third `appendCheckedGraphWrite` caller.
 *
 * ⭐ THE DECISIVE MEASUREMENT, AND IT POINTS THE OTHER WAY FROM THE OBVIOUS FIX:
 * the restore RPC's CAS is **STRICTLY STRONGER** than the turn path's, so
 * converging it onto `store.append` would have COST a guarantee, not gained one.
 *   · restore (`20260824200000:327-333`): an UNCONDITIONAL three-way compare
 *     (stored hash, caller-supplied hash, and the full stored graph body), with
 *     no flag and no bypass.
 *   · the `append_turn_atomic_*` family reached through `store.append`:
 *     `p_cas_enforce BOOLEAN DEFAULT FALSE` — the compare block is skipped
 *     entirely unless a caller opts in (`20260717120000:133`/`:198`,
 *     `20260731130000:143`/`:243`, `20260802120000:101`/`:206`,
 *     `20260806120000:165`/`:308`).
 * So the honest closure is: THE INVARIANT CHECK BELONGS ON THAT PATH, THE
 * APPEND DOES NOT. Refusing more than needed is safe; a silent write is not.
 * Nothing about either CAS is touched by this function.
 *
 * ⚠ SCOPE OF THE EVIDENCE FOR THE PARAGRAPH ABOVE: it rests on READING the
 * migration SQL at this tip. No PL/pgSQL was executed to establish it, and every
 * atomicity claim on that migration has rested on reading — stated so the claim
 * is not read as stronger than it is.
 *
 * Throws `PersistedGraphInvariantError` when this write INTRODUCES a structural
 * violation — fail-closed, never a silent repair. Returns `void` on pass: the
 * caller then performs its own write, and NOTHING may mutate the graph in
 * between (the same obligation `appendCheckedGraphWrite` discharges structurally
 * by appending on its own next line).
 */
export function assertNoIntroducedGraphViolations(
  params: GraphInvariantAssertionParams,
): void {
  const { graph, identity, writesGraph, source } = params;

  const persistedInvariants = checkPersistedGraphInvariants(graph, {
    baseGraph: params.baseGraphForInvariants,
  });

  const logBase = {
    scenario_id: identity.scenario_id,
    turn_id: identity.turn_id,
    turn_class: identity.turn_class,
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
}

/**
 * Enforce the terminal persisted-graph invariants on the bytes about to be
 * written, then append them. THE SINGLE CALL-GRAPH AUTHORITY for a
 * `scenarios.graph` write THAT GOES THROUGH `store.append` — which, measured at
 * this tip, is every such write except the restore tier, whose own atomic RPC
 * takes the check alone via `assertNoIntroducedGraphViolations` above.
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

  // The check runs on `write.graph` — the same object handed to `store.append`
  // on the last line of this function, with nothing between them.
  assertNoIntroducedGraphViolations({
    graph: write.graph,
    identity: {
      scenario_id: write.scenario_id,
      turn_id: write.turn_id,
      turn_class: write.turn_class,
    },
    writesGraph,
    baseGraphForInvariants: params.baseGraphForInvariants,
    source,
  });

  // Nothing mutates the graph between the check above and this line.
  return await store.append(write);
}
