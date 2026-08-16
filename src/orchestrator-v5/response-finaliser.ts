/**
 * V5 response finaliser — single structurally-guaranteed stamping point for
 * envelope-level fields the product depends on, plus a *type-system* and
 * *runtime* contract that nothing else can produce a 200-OK V5 wire body.
 *
 * Background — three rounds of evolution
 * ---------------------------------------
 *
 * 1. Per-composer emission (claude/v5-analysis-ready-contract). Every
 *    compose function accepted an `analysisReady?` parameter. Failed because
 *    composers can forget the field; the next new path silently broke.
 *
 * 2. Single-site finaliser + grep gate (claude/v5-response-finaliser, first
 *    iteration). All 200-OK exits routed through `sendFinalised200`; grep
 *    blocked direct `analysis_ready` writes. Failed external review on two
 *    counts: (a) the gate didn't catch a future path that calls
 *    `reply.send(rawResponse)` without ever writing `analysis_ready`;
 *    (b) the egress-drift fallback shipped without finalisation.
 *
 * 3. Centralised helper + finalised fallback (this file's prior version,
 *    commit 4b3656a9). Closed the fallback hole; helper became the sole
 *    `reply.code(200).send`. Failed external review again: regex couldn't
 *    enumerate every Fastify send shape — `reply.send(raw)`,
 *    `reply.status(200).send(raw)`, `reply.code(200).type(...).send(raw)`,
 *    implicit `return rawObject` from an async handler. Each escalation
 *    of the regex caught one shape and missed another.
 *
 * 4. (CURRENT) Defence in depth via four independent mechanisms — the
 *    structural fix that stops the regex-vs-bypass arms race.
 *
 * The four mechanisms
 * -------------------
 *
 *   A. **Type brand**: `FinalisedV5Response` is `OlumiResponse` extended
 *      with a `unique symbol` brand. Only `finaliseV5Response` produces it.
 *      Fastify 5 supports status-code-keyed Reply types
 *      (`ReplyKeysToCodes` / `ResolveReplyTypeWithRouteGeneric`) so the
 *      route can declare `Reply: { 200: FinalisedV5Response, 422:
 *      BoundaryError, 500: BoundaryError }`. After this declaration,
 *      `reply.code(200).send(raw)` is a TYPE ERROR — `raw` is not branded.
 *      `reply.code(200).send(boundaryError)` is also a type error — body
 *      type doesn't match the 200 key. Catches every Fastify send shape
 *      (`code`, `status`, chained methods, implicit return) at compile
 *      time.
 *
 *   B. **Runtime WeakSet membership**: `finaliseV5Response` adds the
 *      branded response to a module-scoped WeakSet. The route's
 *      `preSerialization` hook reads the membership and asserts it on
 *      every 200-OK send. Catches casts that bypass the type system at
 *      runtime — Render logs a `v5.finaliser.bypass_detected` event and
 *      the wire ships the egress-violation fallback envelope instead of
 *      the bypassing body. Production-observable.
 *
 *   C. **Compile-time negative tests**: tests/types/v5-finaliser-brand.
 *      test-d.ts uses `// @ts-expect-error` to assert the brand actually
 *      rejects the bypass shapes. If the brand silently regresses (e.g.
 *      someone makes it structurally compatible with `OlumiResponse`),
 *      tsc fails the build.
 *
 *   D. **Narrow grep gate**: scripts/check-no-direct-analysis-ready.sh
 *      catches `analysis_ready` writes outside sanctioned files (existing)
 *      AND `FinalisedV5Response` references outside this file plus its
 *      sanctioned tests (new). Anyone introducing a cast-shape bypass
 *      (`as FinalisedV5Response`, `as unknown as FinalisedV5Response`,
 *      type aliasing, `satisfies FinalisedV5Response`) must mention the
 *      identifier and gets caught. The gate no longer enumerates Fastify
 *      send shapes — that's mechanism A's job.
 *
 * No single bypass slips through all four. The next-reviewer question
 * shifts from "have you considered Fastify shape X" to "explain how a
 * cast simultaneously evades the type, the runtime hook, the tests, and
 * the grep" — a much better contract.
 *
 * Skipped paths (legitimate). 500 / `BoundaryError` exits do NOT call this
 * finaliser. They're infrastructure failures with no canvas mutation; UI's
 * prior `ceeAnalysisReady` remains correct. The status-keyed Reply type
 * pairs them with `BoundaryError` directly, so the type system also
 * enforces that 500 paths don't accidentally ship a `FinalisedV5Response`.
 */

import type { OlumiResponse } from '@talchain/schemas/boundary';

import { config } from '../config/index.js';

import {
  attachComputedAt,
  FRESHNESS_ONLY_SYNTHESIS_REASONS,
  synthesiseFreshnessOnlyAnalysisReady,
  type AnalysisReadyPayload,
} from './compose/analysis-ready-emit.js';
import {
  composeAnalysisStateV1,
  readRawRobustnessFromResponseBody,
} from './compose/analysis-state-v1.js';
import { sanitiseEnrichment } from './compose/sanitise-enrichment.js';
import { canonicalStateFromFreshness } from './context/canonical-analysis-state.js';

// ─── Mechanism A: type brand ──────────────────────────────────────────────

/**
 * `unique symbol` brand. Cannot be reproduced outside this module — even if
 * the symbol's string description is leaked, the runtime symbol identity is
 * unique. The `as never` declaration means no value can carry this property
 * at runtime; the brand is a compile-time-only marker, type-narrowed in by
 * `finaliseV5Response`.
 */
declare const FINALISED_BRAND: unique symbol;

/**
 * The branded V5 wire body. Produced ONLY by `finaliseV5Response`. The
 * status-keyed Reply on the V5 route requires this brand for status 200,
 * making `reply.code(200).send(rawOlumiResponse)` a compile-time error.
 */
export type FinalisedV5Response = OlumiResponse & {
  readonly [FINALISED_BRAND]: never;
};

// ─── Mechanism B: runtime WeakSet ─────────────────────────────────────────

/**
 * Set of objects that have been processed by `finaliseV5Response`. The
 * route's `preSerialization` hook checks membership on every 200-OK send;
 * if a 200 body is not in the set, that's a cast-bypass attempt. WeakSet
 * uses object identity, so it works even if the response is later
 * structurally cloned or extended (we hold the post-finalise reference,
 * which is what reaches the wire).
 *
 * Exported for the route's hook to read; not exported beyond the
 * orchestrator-v5 surface.
 */
const FINALISED_RESPONSES: WeakSet<object> = new WeakSet();

export function isFinalisedV5Response(value: unknown): value is FinalisedV5Response {
  return typeof value === 'object' && value !== null && FINALISED_RESPONSES.has(value);
}

// ─── Context ──────────────────────────────────────────────────────────────

export interface FinaliserContext {
  /**
   * Pre-computed readiness from the dispatch path:
   *   - TurnExecutor      : structural readiness from the per-turn graph
   *                         (already computed at turn-executor.ts:368-378
   *                         for chip gating; surfaced on
   *                         `TurnExecutorRunResult.analysisReady`).
   *   - draft-graph       : the rich pipeline payload from
   *                         `DraftGraphResult.analysisReady`.
   *   - edit-graph        : structural readiness from the post-edit
   *                         `appliedGraph`.
   *   - chip-click        : structural readiness from the post-handler
   *                         graph state on the `ok` outcome (currently
   *                         undefined; documented in dispatch result type).
   *   - system-event      : currently undefined — graph-mutating kinds
   *                         (direct_graph_edit, patch_accepted) are UI-
   *                         invalidated for now; documented in dispatch
   *                         result type.
   *
   * Undefined ⇒ no analysis_ready stamped on the response, with ONE
   * exception (Mission 3 transport recovery): when `ctx.freshness`
   * carries an honest 'unknown' verdict for a legacy/unparseable-graph
   * reason (FRESHNESS_ONLY_SYNTHESIS_REASONS), the finaliser synthesises
   * a minimal freshness-only block so the already-computed verdict is not
   * dropped at the wire. All other undefined cases still omit the block —
   * the body still gets the brand and the WeakSet membership; those
   * signal "the helper ran", independent of whether readiness was set.
   * The UI's null-as-unknown handling treats absence as "no fresh
   * readiness this turn", not as a blocker.
   */
  readonly analysisReady?: AnalysisReadyPayload;
  /**
   * V5 state-trust freshness derivation. When provided, the finaliser
   * threads it into `attachComputedAt` so analysis_ready.computed_at
   * uses the selected fact's timestamp (not wire-emit time) and the
   * freshness wire fields are stamped on the response. Populated on
   * every primary CEE dispatch path that produces analysis_ready:
   * turn_executor, chip_click, draft_graph, edit_graph. system_event
   * may omit (most variants don't ship analysis_ready); the field stays
   * `optional` in the schema for forward-compat.
   */
  readonly freshness?: import('./context/freshness.js').FreshnessDerivation;
  /**
   * ANALYSIS-STATE AUTHORITY, STEP 3 — the turn's canonical analysis verdict,
   * threaded by a dispatch path that computed the FULL verdict (turn-executor,
   * with degraded detection). When absent, the finaliser composes the same
   * partial verdict from `freshness` + `analysisReady` via
   * `canonicalStateFromFreshness` — the SAME call the route already makes for
   * `_context_summary`, so the two surfaces cannot describe one turn
   * differently.
   *
   * This is the promotion the migration calls for: the canonical verdict stops
   * being a flag-gated diagnostic and becomes the producer of record for the
   * `analysis_state` wire field. The `_context_summary` path is unchanged and
   * still reads `ctx.canonicalState` under its own flag.
   */
  readonly canonicalState?: import('./context/canonical-analysis-state.js').CanonicalAnalysisState;
  /**
   * CEE's constraint entitlement for this turn — the CEE half of the
   * `leader_claim` conjunction. Already REQUIRED on every V5 exit's
   * `sendFinalised200` context and read there via the fail-closed canonical
   * reader, so the finaliser reads it rather than re-deriving it (trap 12).
   * Optional here only so the non-route callers of this function (tests, the
   * wire-capture script) need not supply it; absence is read as NOT entitled,
   * which is the fail-closed direction.
   */
  readonly mayNameLeadingOption?: boolean;
}

// ─── The finaliser ────────────────────────────────────────────────────────

/**
 * Stamp envelope-level fields, brand the response, register WeakSet
 * membership. The route's `sendFinalised200` and `preSerialization` hook
 * are the only consumers; tests and the helper itself are the only
 * sanctioned producers.
 *
 * Idempotency: calling the finaliser twice with the same context returns a
 * fresh branded object each time (different WeakSet entries; latest
 * `computed_at`). The structure (modulo timestamp) is stable.
 *
 * The cast `as FinalisedV5Response` here is the SOLE production-code use of
 * the type identifier. The grep gate exempts this file; any other file
 * mentioning `FinalisedV5Response` triggers the gate.
 */
export function finaliseV5Response(
  response: OlumiResponse,
  ctx: FinaliserContext,
): FinalisedV5Response {
  // Defensive ceeTrace scrub: V5 source code on this branch does not write
  // `ceeTrace` (verified by exhaustive grep), but the V5 golden-path replay
  // observed `ceeTrace.reason: "CEE"` on a Step 4 wire response from an
  // earlier deploy. Strip-on-egress is a permanent guard against any
  // upstream (legacy CEE pipeline, Fastify hook, future regression) that
  // could attach the field. When CEE_TURN_DEBUG_ENABLED is true the field
  // is preserved for operator inspection; otherwise it is removed before
  // analysis_ready stamping so internal trace shapes never reach the wire.
  const debugEnabled = config.cee?.turnDebugEnabled === true;
  const ceeTraceClean = debugEnabled ? response : stripCeeTrace(response);
  // Phase 1 / Commit 6 — analysis-enrichment-critique-prose-safety:
  // Defensive second-pass sanitisation over every block's enrichment.
  // The decision-review enricher (decision-review-enricher.ts) is the
  // primary scrub site; this backstop catches any future enrichment
  // producer that bypasses the enricher (cached blocks, fallback
  // composers, future analysis_result variants). Same CEE_TURN_DEBUG_ENABLED
  // gating as the ceeTrace scrub: when debug is on, enrichment passes
  // through verbatim; otherwise the enrichment is sanitised and bucket-D
  // critiques are removed from the wire.
  //
  // analysisReady is threaded into the resolver's priority-2 lookup so
  // option_id → label resolution works even when graph is unavailable
  // (the finaliser doesn't carry the V3 graph; analysis_ready.options
  // covers most enrichment-prose label needs in practice).
  const scrubbed = debugEnabled
    ? ceeTraceClean
    : sanitiseEnrichmentBlocks(ceeTraceClean, ctx.analysisReady ?? null);
  // Mission 3 transport recovery: a legacy/unparseable graph reload derives
  // an honest 'unknown' freshness verdict but builds no structural readiness
  // payload, and freshness can only ride the wire inside analysis_ready.
  // Synthesise a minimal science-free carrier for exactly those reasons;
  // every other no-readiness case (none/fresh/stale, other unknown reasons)
  // keeps the omit behaviour.
  const payloadForStamp: AnalysisReadyPayload | undefined =
    ctx.analysisReady ??
    (ctx.freshness?.freshness === 'unknown' &&
    FRESHNESS_ONLY_SYNTHESIS_REASONS.has(ctx.freshness.reason)
      ? synthesiseFreshnessOnlyAnalysisReady()
      : undefined);
  const stamped: OlumiResponse = payloadForStamp
    ? { ...scrubbed, analysis_ready: attachComputedAt(payloadForStamp, ctx.freshness) }
    : { ...scrubbed };
  // ROADMAP 1.192 leg κ(a) — AUTHORITATIVE top-level graph_hash. The egress
  // sanitiser sets graph_hash from the GraphV3-parsed per-turn graph as a
  // FALLBACK, but that projection can diverge from the RAW analysis-affecting
  // hash after the commit-time options normalisation
  // (normaliseOptionInterventionContract) — which would make graph_hash
  // disagree with an analysis block's `computed_against_hash` on a FRESH
  // analysis (a FALSE GRAPH_DIVERGED, live-proven: effectiveGraph
  // 7367714928030768 vs persisted b3ebb23cfb03df1d). `freshness.current_graph_hash`
  // is the SAME canonical hash run_analysis stamps as `graph_hash_at_run` /
  // `computed_against_hash` (both `computeAnalysisAffectingGraphHash` over the
  // raw persisted/authoritative graph), so when present it is the authoritative
  // value — prefer it over the sanitiser fallback. On a STALE turn it is the
  // CURRENT graph's hash (≠ the analysed hash) — the honest divergence signal
  // the handshake exists to carry. Turns with no freshness keep the sanitiser
  // fallback (coverage), where there is no analysis block to mismatch.
  const withGraphHash: OlumiResponse =
    ctx.freshness?.current_graph_hash != null
      ? { ...stamped, graph_hash: ctx.freshness.current_graph_hash }
      : stamped;
  // ANALYSIS-STATE AUTHORITY, STEP 3 — ONE composed verdict per turn, beside
  // `analysis_ready`. ADDITIVE BY CONSTRUCTION: it adds exactly one top-level
  // key and rewrites none, so a consumer that ignores it sees byte-identical
  // behaviour (asserted against a capture taken on the PR base, not against a
  // fixture this lane wrote). Composed from values this turn already computed
  // — no engine call, no model call, no store read.
  const withAnalysisState = attachAnalysisState(withGraphHash, ctx);
  FINALISED_RESPONSES.add(withAnalysisState);
  return withAnalysisState as FinalisedV5Response;
}

/**
 * Compose and stamp `analysis_state`, or return the body untouched when there
 * is no verdict to supply.
 *
 * Absence is a first-class state in the contract — "no verdict was supplied" —
 * and it is what a dispatch path with no analysis context must emit. Stamping
 * a fabricated default (an invented readiness status over an invented run
 * state) would make every no-analysis turn indistinguishable from a turn whose
 * producer genuinely assessed one.
 */
function attachAnalysisState(
  response: OlumiResponse,
  ctx: FinaliserContext,
): OlumiResponse {
  const canonical =
    ctx.canonicalState ??
    (ctx.freshness !== undefined
      ? canonicalStateFromFreshness(
          ctx.freshness,
          ctx.analysisReady ? { readiness: ctx.analysisReady } : {},
        )
      : null);
  const analysisState = composeAnalysisStateV1({
    canonical,
    freshness: ctx.freshness,
    readiness: ctx.analysisReady,
    mayNameLeadingOption: ctx.mayNameLeadingOption,
    // Read from the body as it will ship, not from the fact: when the
    // withheld-claim projection has redacted `near_tie`, the separation half
    // is genuinely unknown to the consumer and `leader_claim` must say so.
    rawRobustness: readRawRobustnessFromResponseBody(response),
  });
  if (analysisState === undefined) return response;
  return { ...response, analysis_state: analysisState };
}

function sanitiseEnrichmentBlocks(
  response: OlumiResponse,
  analysisReady: AnalysisReadyPayload | null,
): OlumiResponse {
  // Cheap-gate intentionally OMITTED: a previous version of this function
  // skipped the walker when `critiques` was empty AND none of the four flat
  // string leaves (`summary`, `narrative`, `rationale`, `robustness_synthesis`)
  // were present. That gate created a hole — enrichment shaped only with
  // `review_cards`, `factor_sensitivity.interpretation`, `gaps.description`,
  // `robustness.caveat`, `m1_review`, `m1_coaching`, or `improvement_guidance`
  // bypassed the backstop entirely (Codex review 2026-04-30, finding #2).
  // The walker's per-leaf checks are already O(1) when fields are absent;
  // running it unconditionally on every block with non-null enrichment is
  // the safe contract.
  //
  // We DO still skip blocks without an enrichment object — those are the
  // common case for non-analysis_result block types (`text`, `error`,
  // `graph_patch`, etc.) and the walker has nothing to do.
  const asRecord = response as Record<string, unknown>;
  const blocks = Array.isArray(asRecord.blocks) ? (asRecord.blocks as Array<Record<string, unknown>>) : null;
  if (!blocks || blocks.length === 0) return response;
  let mutated = false;
  const newBlocks = blocks.map((b) => {
    if (b == null || typeof b !== 'object') return b;
    const enrichment = b.enrichment as Record<string, unknown> | undefined;
    if (enrichment == null || typeof enrichment !== 'object') return b;
    // Always run the walker — see comment on the function header above.
    // Per-leaf checks inside `sanitiseEnrichment` are O(1) when fields
    // are absent, and the walker is the only path that covers
    // review_cards / factor_sensitivity / gaps / robustness /
    // m1_review / m1_coaching / improvement_guidance.
    // WIRE BACKSTOP (Tier-3 cage): this is the LAST seam before the
    // response ships, so transport-banned Tier-3 subtrees are DELETED
    // here (dropTier3TransportBanned) — an unknown prose field inside
    // them must not reach users. The enricher/fact path deliberately
    // does NOT set this option (the m1 adapter reads m1_coaching's
    // structured enums for the v11 prompt).
    const result = sanitiseEnrichment(enrichment, null, analysisReady, {
      dropTier3TransportBanned: true,
    });
    mutated = true;
    return { ...b, enrichment: result.enrichment };
  });
  if (!mutated) return response;
  return { ...asRecord, blocks: newBlocks } as OlumiResponse;
}

function stripCeeTrace(response: OlumiResponse): OlumiResponse {
  // The defensive scrub walks two known leak surfaces:
  //   1. top-level `response.ceeTrace` (legacy CEE pipeline emitter)
  //   2. nested `response.blocks[i].enrichment.ceeTrace` (decision-review
  //      enricher passthrough — observed on staging f588320 inside
  //      `blocks[0].enrichment.ceeTrace.reason: "Legacy CEE calls
  //      skipped (M2 decision-review enabled)"`). Stripped only when
  //      `CEE_TURN_DEBUG_ENABLED=false`; the caller's `debugEnabled`
  //      gate at line 187 short-circuits this whole function when debug
  //      is on, so no per-surface flag is needed here.
  const asRecord = response as Record<string, unknown>;
  const hasTopLevel = 'ceeTrace' in asRecord;
  const blocks = Array.isArray(asRecord.blocks) ? (asRecord.blocks as unknown[]) : null;
  const blockHasTrace = blocks
    ? blocks.some((b) => {
        const enrichment = (b as { enrichment?: Record<string, unknown> })?.enrichment;
        return enrichment != null && 'ceeTrace' in enrichment;
      })
    : false;

  if (!hasTopLevel && !blockHasTrace) return response;

  const clone: Record<string, unknown> = { ...asRecord };
  if (hasTopLevel) delete clone.ceeTrace;
  if (blockHasTrace && blocks) {
    clone.blocks = blocks.map((b) => {
      const blockRec = b as Record<string, unknown>;
      const enrichment = blockRec.enrichment as Record<string, unknown> | undefined;
      if (enrichment && 'ceeTrace' in enrichment) {
        const { ceeTrace: _drop, ...rest } = enrichment;
        return { ...blockRec, enrichment: rest };
      }
      return b;
    });
  }
  return clone as OlumiResponse;
}
