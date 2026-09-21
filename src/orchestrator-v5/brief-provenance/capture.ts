/**
 * Brief + analysis-provenance (ROADMAP 2.1229, CEE half) — commit-seam capture.
 *
 * THE USER OUTCOME: a person who has run an analysis can send their model to
 * a colleague, and the colleague opens the link and sees it.
 *
 * WHY THIS EXISTS. `create_shared_brief` refuses with 'No brief to share -
 * generate a brief first' whenever `scenarios.brief IS NULL`, and it has
 * been NULL on 14,157 of 14,158 scenarios (the one exception is a hand-made
 * test stub). So every real share has failed, and the UI answers "Please try
 * again shortly" — a retry prompt for a permanently impossible operation.
 * The DB-side producers were always correct; they lost their CALLER when the
 * direct browser→PLoT `/v2/run` path was retired. CEE has been minting all
 * four required values on every run and writing them only to the telemetry
 * table `v5_handler_facts`. This hook forwards them to the row the share
 * path actually reads.
 *
 * Two layers, exactly as in decision-records/capture.ts:
 *   1. `buildBriefProvenanceWrite` — PURE projection of a successful
 *      run_analysis HandlerFact into the `store_brief_and_provenance`
 *      payload, or a typed skip. No I/O, no clock reads, fully
 *      unit-testable.
 *   2. `recordBriefProvenanceForCommit` — the fire-and-forget hook invoked
 *      from commit.ts AFTER the durable append succeeded, whenever the
 *      commit carries a successful (non-noop) run_analysis fact.
 *      Non-blocking contract (mirrors the decision-record hook verbatim):
 *      every failure — store construction (missing SUPABASE_* env), RPC
 *      error, telemetry fault — is caught and logged; NOTHING propagates to
 *      the turn result.
 *
 * ── THE FIELD PATHS, AND WHY THEY ARE SPELLED OUT HERE ────────────────────
 * Two of these were reported at `result.meta.*` by an earlier pass. That
 * path does not merely read empty — `meta` is ABSENT FROM
 * `RunAnalysisHandlerFactSchema.result` ENTIRELY, so it is a structural
 * absence, not an empty one, and no future producer change can populate it
 * without a contract change. Measured at the deployed `v5_handler_facts`,
 * non-noop run_analysis, 7 days, n=3,097:
 *
 *   brief         ← result.enrichment.decision_brief          3,078
 *   graph_hash    ← result.graph_hash_at_run                  3,097
 *   seed_used     ← result.enrichment.decision_brief.seed     3,078
 *   response_hash ← result.enrichment.response_hash           3,078
 *   negative control result.meta                                  0
 *   negative control result.enrichment.meta.response_hash         0
 *
 * All four are present on exactly the 3,078 facts whose
 * `enrichment.analysis_status` is 'computed'; the remaining 19 are
 * 'refused' and carry none of them. `isSuccessfulRunAnalysisFact` (the
 * estate's single success predicate) already excludes 'refused', so the
 * status is not re-tested here — re-deriving it would be a second authority
 * on one question.
 *
 * ⚠ `enrichment` is an UNTYPED PASSTHROUGH on the fact
 * (`z.record(z.string(), z.unknown())`), and `decision_brief` is an empty
 * PASSTHROUGH object in the contract. Nothing about these paths is
 * type-checked at any hop, so every value is validated structurally below.
 * The contract's own note records that `seed` and `graph_hash` are lineage
 * keys CEE's transport projection strips before the CEE→UI hop — the
 * persisted fact is upstream of that strip, which is why they are readable
 * here and not in the UI.
 *
 * ── ALL-FOUR-OR-NOTHING ───────────────────────────────────────────────────
 * This is a property of the CONSUMER, not a preference.
 * `create_shared_brief` null-checks `analysis_provenance` ONCE, then
 * dereferences three keys out of it into three NOT NULL columns
 * (`shared_briefs.graph_hash` text, `seed_used` bigint, `response_hash`
 * text). A partial envelope passes the null check and dies on a 23502 —
 * turning an honest, actionable 'run analysis first' into an opaque
 * constraint violation at SHARE time, one hop and possibly days away from
 * the turn that caused it. So the projection emits the envelope whole or
 * emits nothing, and the RPC enforces the same rule independently.
 *
 * ⚠ RESIDUAL, OUT OF SCOPE, DELIBERATELY NOT WORKED AROUND HERE:
 * `create_shared_brief` still casts `(analysis_provenance->>'seed_used')
 * ::integer` at the live database, even though `shared_briefs.seed_used`
 * was widened to `bigint`. Widening the COLUMN did not widen the CAST, so a
 * seed above 2,147,483,647 would raise 22003 inside that function. Observed
 * maximum is 2,146,549,360 and 0 of 3,078 exceed the ceiling, so it is
 * latent, not live. This hook writes what the RPC's `bigint` parameter
 * accepts and does NOT clamp to int32: silently refusing to store a
 * legitimate brief would reintroduce exactly the defect being fixed, and
 * encoding another function's bug as a producer-side filter would hide it.
 * Reported rather than patched.
 */

import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';
import { getBriefProvenanceStore } from './index.js';
import type { StoreBriefAndProvenanceWrite } from './store-adapter.js';

export type BriefProvenanceSkipReason =
  | 'no_brief'
  | 'no_graph_hash'
  | 'no_seed'
  | 'no_response_hash';

export type BriefProvenanceProjection =
  | { readonly kind: 'write'; readonly write: StoreBriefAndProvenanceWrite }
  | { readonly kind: 'skip'; readonly reason: BriefProvenanceSkipReason };

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function nonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0;
}

/**
 * PURE projection: a successful run_analysis fact → the whole envelope, or a
 * typed skip naming the FIRST missing member.
 *
 * `scenarioId` comes from the COMMIT metadata, never from
 * `fact.result.scenario_id`: the row being updated must be the scenario the
 * turn committed against, and those two could in principle disagree.
 */
export function buildBriefProvenanceWrite(
  fact: RunAnalysisHandlerFact,
  scenarioId: string,
): BriefProvenanceProjection {
  const enrichment = fact.result.enrichment;
  const brief = isPlainObject(enrichment) ? enrichment.decision_brief : undefined;
  if (!isPlainObject(brief)) return { kind: 'skip', reason: 'no_brief' };

  const graphHash = fact.result.graph_hash_at_run;
  if (!nonEmptyString(graphHash)) return { kind: 'skip', reason: 'no_graph_hash' };

  // `seed_used` lands in a bigint column and is LINEAGE — the number a rerun
  // must reproduce. A non-integer, or an integer past 2^53-1 where JS has
  // already lost precision, is not the seed PLoT used; persisting it would
  // be a fabricated provenance value, which is worse than none.
  const seed = brief.seed;
  if (typeof seed !== 'number' || !Number.isSafeInteger(seed)) {
    return { kind: 'skip', reason: 'no_seed' };
  }

  const responseHash = isPlainObject(enrichment) ? enrichment.response_hash : undefined;
  if (!nonEmptyString(responseHash)) return { kind: 'skip', reason: 'no_response_hash' };

  return {
    kind: 'write',
    write: {
      scenario_id: scenarioId,
      brief,
      graph_hash: graphHash,
      seed_used: seed,
      response_hash: responseHash,
    },
  };
}

export interface RecordBriefProvenanceArgs {
  readonly scenarioId: string;
  readonly turnId: string;
  readonly persistedRowId: string | null;
  readonly fact: RunAnalysisHandlerFact;
}

/**
 * Fire-and-forget commit-seam hook. Never throws, never returns anything the
 * turn depends on.
 */
export async function recordBriefProvenanceForCommit(
  args: RecordBriefProvenanceArgs,
): Promise<void> {
  try {
    const built = buildBriefProvenanceWrite(args.fact, args.scenarioId);
    if (built.kind === 'skip') {
      log.debug(
        { scenario_id: args.scenarioId, turn_id: args.turnId, skip_reason: built.reason },
        'BriefProvenance — skipped (the fact carries no complete brief envelope; designed skip, not a fault)',
      );
      emitStoredEvent(args, { status: 'skipped', skip_reason: built.reason });
      return;
    }

    // Store construction happens HERE and nowhere earlier: a commit that
    // produces no write must perform no env read and build no client.
    const store = getBriefProvenanceStore();
    const stored = await store.storeBriefAndProvenance(built.write);
    if (!stored) {
      // The RPC returned false: it wrote nothing. Either its own
      // all-or-nothing guard fired (impossible on this path — the envelope
      // above is complete — which makes it a signal worth seeing) or no
      // scenario row matched the id. Disclosed as its own status so a silent
      // no-write can never be read as a success.
      log.warn(
        { scenario_id: args.scenarioId, turn_id: args.turnId },
        'BriefProvenance — store_brief_and_provenance wrote no row (no matching scenario, or a null reached the RPC); the share path will still refuse for this scenario',
      );
      emitStoredEvent(args, { status: 'not_stored' });
      return;
    }
    emitStoredEvent(args, { status: 'ok' });
  } catch (err) {
    log.warn(
      {
        scenario_id: args.scenarioId,
        turn_id: args.turnId,
        err: err instanceof Error ? err.message : String(err),
      },
      'BriefProvenance — capture hook failed (turn result unaffected)',
    );
    emitStoredEvent(args, {
      status: 'error',
      error_name: err instanceof Error ? err.name : 'unknown',
    });
  }
}

/**
 * Content-free capture telemetry (frozen-registry member
 * `v5.brief_provenance.stored`). Correlation ids, a closed-enum status and a
 * closed-enum skip reason ONLY — never brief text, hashes or seeds. A
 * telemetry fault inside the error path must not escape the fire-and-forget
 * contract, so emit failures degrade to a debug log.
 */
function emitStoredEvent(
  args: RecordBriefProvenanceArgs,
  fields: {
    readonly status: 'ok' | 'not_stored' | 'skipped' | 'error';
    readonly skip_reason?: BriefProvenanceSkipReason;
    readonly error_name?: string;
  },
): void {
  try {
    emit(TelemetryEvents.V5BriefProvenanceStored, {
      scenario_id: args.scenarioId,
      turn_id: args.turnId,
      turn_row_id: args.persistedRowId,
      status: fields.status,
      skip_reason: fields.skip_reason ?? null,
      error_name: fields.error_name ?? null,
    });
  } catch (emitErr) {
    log.debug(
      {
        scenario_id: args.scenarioId,
        turn_id: args.turnId,
        err: emitErr instanceof Error ? emitErr.message : String(emitErr),
      },
      'BriefProvenance — capture telemetry emit failed (swallowed)',
    );
  }
}
