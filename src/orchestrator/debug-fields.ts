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
import type { V5ContextSummary } from '../orchestrator-v5/context/build-context-summary.js';

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
  /**
   * V5 canonical context summary (additive observability). Populated only
   * when `config.cee.contextSummaryEnabled` (env
   * `CEE_CONTEXT_SUMMARY_ENABLED=true`) is set. Redacted — statuses /
   * predicates / counts / hashes only, NO raw user text or graph content.
   * Stripped before strict `OlumiResponseSchema` validation, re-attached
   * after — same mechanic as `_diagnostic_trace`. Diagnostic-only: the
   * Golden-Journey Harness A1/A2 reads it; UI / prose / chip / coaching
   * paths MUST NOT (enforced by a static guard test). Unlike `_timings` /
   * `_diagnostic_trace` (which may arrive body-attached upstream and are
   * coerced), this value is BUILT FRESH at the route gate from the canonical
   * state (`buildV5ContextSummary`); any body-attached copy is dropped by
   * the strip step, so the attached value is well-formed by construction and
   * needs no runtime coercion.
   */
  readonly _context_summary?: V5ContextSummary;
  /**
   * ROADMAP 1.42 — flag-gated PRODUCT sidecar (NOT a debug/diagnostic
   * surface like its siblings above): VERBATIM Sonnet-5 extended-thinking
   * reasoning text, for progressive disclosure in the UI (collapsed by
   * default, explicitly labelled — Paul ruling). Populated only when
   * `config.features.reasoningCaptureEnabled` (env
   * `CEE_REASONING_CAPTURE_ENABLED=true`) is set AND the model emitted
   * thinking blocks. Stripped before strict `OlumiResponseSchema`
   * validation, re-attached after — same mechanic as `_context_summary`.
   * Never contains `signature` or `redacted_thinking` content (see
   * `ChatWithToolsResult.reasoning` jsdoc in `adapters/llm/types.ts`).
   *
   * Pending formalisation as a named field on the shared
   * `@talchain/schemas` contract (0.15.0) once the UI progressive-
   * disclosure surface lands; lives here as an underscore-prefixed
   * sidecar in the meantime, consistent with the other debug fields'
   * additive-tolerance contract described above. UNLIKE the debug
   * surfaces above, this field IS intended to reach the client UI (it is
   * flag-gated product content, not an operator-only diagnostic) — the
   * two-gate `X-Olumi-Debug` header model does NOT apply to it.
   */
  readonly _reasoning?: string;
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
