/**
 * V5 debug-fields opt-in gate.
 *
 * Two-gate model:
 *
 *   gate 1 — server permission: `config.cee.timingDebugEnabled` (env
 *            `V5_TIMING_DEBUG=true`). Deployment-wide operator opt-in;
 *            unchanged from PR #181 and earlier.
 *
 *   gate 2 — per-request opt-in: `X-Olumi-Debug: <token>` header. Caller
 *            explicitly asks for a specific debug surface by token name.
 *            Multiple tokens may be comma-separated. Whitespace and case
 *            are tolerated.
 *
 * Both gates must pass for a debug field to be attached to the response.
 * Normal browser traffic does NOT set the header and therefore never
 * receives debug fields, even when the server permission is on.
 *
 * Why a token-set rather than a single boolean: future additive debug
 * surfaces (e.g. `_diagnostics`, `_cache_stats`) can be opted into
 * independently by extending the token vocabulary — `X-Olumi-Debug:
 * timings,diagnostics` — without per-surface header sprawl.
 *
 * Why the header name is `X-Olumi-Debug` not `Authorization`-style: it's
 * an additive observability hint, not an auth claim. The server
 * permission flag is the gate that prevents abuse; this header is the
 * client-side convenience that says "I want the debug payload".
 */

import type { IncomingHttpHeaders } from 'node:http';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import type { TurnTimingsBlock } from '../orchestrator-v5/telemetry/turn-timings.js';
import type { V5DiagnosticTrace } from '../orchestrator-v5/diagnostics/v5-diagnostic-trace.js';

const DEBUG_HEADER_NAME = 'x-olumi-debug';

/**
 * Wire envelope that may carry one or more debug surfaces post-validation.
 *
 * The boundary `OlumiResponse` is currently `.strict()` — unknown
 * top-level keys fail `safeParse`. We strip every debug field BEFORE
 * validation, then re-attach the ones the two-gate model approves of
 * (env permission + per-request `X-Olumi-Debug` token) AFTER validation.
 * Expressing the augmented shape as an intersection here lets the route
 * site augment without an `unknown` cast: TypeScript sees the wider
 * type as structurally compatible with `OlumiResponse` for the
 * sanitiser / finaliser, while keeping `_timings` typed and
 * discoverable.
 *
 * **Boundary-contract contract for future debug surfaces**
 * (see also `project_dgai_schema_additive_companion.md`):
 *
 * Two separate concerns:
 *   1. Top-level additive tolerance — the SHARED top-level
 *      `OlumiResponseSchema` in `@talchain/schemas` should be
 *      additive-safe (`.passthrough()`) so unknown top-level fields
 *      from any consumer (CEE today, a future service tomorrow) do
 *      not crash strict parsers like DGAI. Nested product / domain
 *      schemas remain `.strict()`. This is the companion workstream
 *      to PR #182 and is required for durable boundary hardening.
 *   2. Named debug surfaces (`_timings`, future `_diagnostics`,
 *      `_cache_stats`, …) STAY OUT of the product schema as
 *      required/documented fields. They live HERE on this
 *      intersection as the gated optional wire surface. The two
 *      gates (env permission + per-request opt-in) decide whether
 *      they are attached; the schema's additive tolerance is what
 *      lets them ride alongside the product fields without DGAI
 *      crashing if a new one ever leaks past the gate.
 *
 * Adding a new debug surface: extend this intersection AND add a
 * token to `DebugFieldToken`. Do NOT add it to the boundary's product
 * schema — the boundary's role is to validate product fields strictly,
 * not to enumerate debug surfaces.
 */
export type OlumiResponseWithDebugFields = OlumiResponse & {
  /**
   * Typed by `TurnTimingsBlock` from the orchestrator-v5 telemetry
   * module — the canonical writer type for upstream capture sites.
   * Using the writer's type here keeps the wire surface in lockstep
   * with the source of truth: any field change to `TurnTimingsBlock`
   * surfaces immediately at this consumer, and the route's runtime
   * guard (`coerceTurnTimingsBlock`) drops malformed shapes rather
   * than wrapping a non-object into a typed-valid surface.
   */
  readonly _timings?: TurnTimingsBlock;
  /**
   * V5 diagnostic trace (additive observability). Populated only when
   * `config.features.diagnosticTraceEnabled` (env
   * `CEE_DIAGNOSTIC_TRACE_ENABLED=true`) is set. Carries per-stage
   * latency breakdown, LLM call records, pipeline outcome, correlation
   * IDs. Stripped before strict `OlumiResponseSchema` validation,
   * re-attached after — same mechanic as `_timings`. The route's
   * runtime guard (`coerceV5DiagnosticTrace`) drops malformed shapes
   * before re-attach.
   *
   * Gating: flag-only in Phase A (no `X-Olumi-Debug: diagnostics`
   * token requirement). The `'diagnostics'` token below is reserved
   * for forward-compatibility; no caller reads it today.
   */
  readonly _diagnostic_trace?: V5DiagnosticTrace;
};

/**
 * Token vocabulary for `X-Olumi-Debug`. Add a new entry here when a new
 * debug surface ships; the gate predicate is the only place that needs
 * the literal string. Keeping the union tight catches typos at the
 * caller site (`debugFieldRequested(headers, 'timins')` is a tsc error).
 */
export type DebugFieldToken = 'timings' | 'diagnostics';

/**
 * Returns true when the request's `X-Olumi-Debug` header includes the
 * named token. Tolerant of:
 *   - case (header value lowercased before comparison)
 *   - surrounding whitespace
 *   - comma-separated lists (`timings,diagnostics`)
 *   - the header being absent or array-valued (Node's `IncomingHttpHeaders`
 *     allows arrays for set-cookie-style headers; we walk the entries and
 *     coalesce on the FIRST NON-EMPTY string, so a leading empty entry
 *     does not suppress the gate).
 *
 * Does NOT inspect the server permission flag — that's the caller's
 * responsibility. Both gates must pass independently.
 */
export function debugFieldRequested(
  headers: IncomingHttpHeaders,
  token: DebugFieldToken,
): boolean {
  const raw = headers[DEBUG_HEADER_NAME];
  if (raw === undefined || raw === null) return false;
  const value = pickFirstNonEmptyString(raw);
  if (value === null) return false;
  const requested = value
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return requested.includes(token);
}

/**
 * Coalesce a possibly-array header value to its first non-empty string
 * entry. Returns null when no entry qualifies (empty array, all-empty
 * entries, non-string element, empty string scalar).
 */
function pickFirstNonEmptyString(raw: string | readonly string[]): string | null {
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry === 'string' && entry.length > 0) return entry;
    }
    return null;
  }
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return null;
}
