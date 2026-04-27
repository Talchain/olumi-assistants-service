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
  type AnalysisReadyPayload,
} from './compose/analysis-ready-emit.js';

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
   * Undefined ⇒ no analysis_ready stamped on the response. The body still
   * gets the brand and the WeakSet membership — those signal "the helper
   * ran", independent of whether readiness was set. The UI's null-as-
   * unknown handling treats absence as "no fresh readiness this turn",
   * not as a blocker.
   */
  readonly analysisReady?: AnalysisReadyPayload;
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
  const scrubbed = debugEnabled ? response : stripCeeTrace(response);
  const stamped: OlumiResponse = ctx.analysisReady
    ? { ...scrubbed, analysis_ready: attachComputedAt(ctx.analysisReady) }
    : { ...scrubbed };
  FINALISED_RESPONSES.add(stamped);
  return stamped as FinalisedV5Response;
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
