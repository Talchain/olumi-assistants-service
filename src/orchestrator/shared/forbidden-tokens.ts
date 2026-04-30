/**
 * Forbidden tokens registry — neutral utility shared across the V5
 * recovery-chip enforcement layer and the enrichment-text scrubber.
 *
 * Two distinct token sets, one shared module so the regex / pattern source
 * is never duplicated:
 *
 *   - `FORBIDDEN_USER_TEXT_TERMS` (recovery-chip enforcement, pre-existing
 *     contract). Originally lived in
 *     `src/orchestrator-v5/compose/recovery-chips-forbidden-terms.ts`.
 *     Moved here so non-V5 modules (the enrichment scrubber lives in
 *     `compose/sanitise-enrichment.ts` but the underlying classifier reuses
 *     the same forbidden-token vocabulary) can import without a V5 edge.
 *     The V5 file re-exports for backward compatibility — every existing
 *     callsite keeps its import path.
 *
 *   - `INTERNAL_TEMPLATE_TOKENS` (new — enrichment user-facing prose
 *     scrub). Tokens that betray engine implementation detail and must
 *     never reach user-rendered text under the path-aware enrichment
 *     allowlist (see `Docs/v5/fix-brief-analysis-enrichment-critique-prose-safety.md`).
 *
 * The two sets have intentional overlap (`handler`, `zod`, `executor`,
 * `enricher`) — both module surfaces want them flagged. Keep tokens here
 * even when only one consumer reads them today; the goal is a single source
 * of truth for "internal vocabulary that must not reach end users".
 *
 * Path-scoped use: `INTERNAL_TEMPLATE_TOKENS` is checked ONLY in the
 * enrichment-allowlist user-facing prose paths (15 paths defined in the
 * fix brief). Tokens like `payloads` are legitimate keys on structural /
 * debug fields; the scrubber must never run against those subtrees.
 */

/**
 * Recovery-chip forbidden terms (pre-existing contract).
 *
 * Surface: V5 recovery-chip user-facing strings. Verified by
 * `FORBIDDEN_USER_TEXT_TERMS` regex in `src/orchestrator-v5/compose/__tests__/`.
 * Append-only — removing a term is a contract change requiring co-review of
 * the chip-generator and recovery-chips test suite.
 */
export const FORBIDDEN_USER_TEXT_TERMS: readonly string[] = [
  'error',
  'failed',
  'broken',
  'enricher',
  'handler',
  'zod',
  'parse',
  'executor',
  'finaliser',
  'finalizer',
  'ai service',
  'stack trace',
] as const;

/**
 * Internal-template tokens that must never appear in user-facing
 * enrichment prose. Used by the enrichment-text scrubber (Commit 4 —
 * `compose/sanitise-enrichment.ts`).
 *
 * Path-scoped: checked ONLY in the 15 user-facing prose paths defined by
 * the enrichment allowlist. Structural fields (`payloads`,
 * `feature_flags_snapshot`, etc.) legitimately contain some of these
 * tokens as object keys and are excluded from the scrub.
 *
 * Pattern notes:
 *   - `Node '` (capital N, space, single quote) — engine validation
 *     prefix from the captured ISL leak `"Node 'opt_X' has kind=..."`.
 *     Distinguished from bare `Node` (legitimate English in coaching
 *     prose like "the goal node").
 *   - `kind=` and `kind='` — engine vocabulary for graph node types.
 *   - `filtered before analysis` — engine preprocessing detail.
 *   - `option nodes` (case-insensitive) — engine internal taxonomy.
 *   - `_pipeline_outcome`, `payloads`, `ISL` — engine internals that
 *     leak when ISL Pydantic-serialises diagnostic data.
 *   - `intervention_target`, `interventions` — schema field names that
 *     surface in engine-coded critique templates.
 *   - `monte carlo`, `numerically valid samples`, `epsilon-guarded`,
 *     `e-value`, `bootstrap`, `causal path` — engine-statistics
 *     vocabulary that survived uncoded critiques.
 *
 * Detection is case-insensitive substring match. Tokens are listed
 * verbatim in the casing the captured leak emits; matching uses
 * `.toLowerCase()` on both sides.
 */
export const INTERNAL_TEMPLATE_TOKENS: readonly string[] = [
  // ── Engine validation prefixes ────────────────────────────────────────
  "Node '",
  'kind=',
  "kind='",
  'filtered before analysis',
  'option nodes',
  // ── Engine internals / payload shapes ─────────────────────────────────
  '_pipeline_outcome',
  'payloads',
  'ISL',
  'intervention_target',
  'interventions',
  // ── Engine-statistics vocabulary (uncoded critiques) ──────────────────
  'monte carlo',
  'numerically valid samples',
  'epsilon-guarded',
  'e-value',
  'bootstrap',
  'causal path',
] as const;
