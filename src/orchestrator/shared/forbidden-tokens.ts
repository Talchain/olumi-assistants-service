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
 *     scrub). Flat catalogue of engine-implementation tokens the
 *     enrichment scrubber knows about. **Tier matters**: this flat
 *     array is the union of two regex sets (`HARD_BAN_PATTERNS` —
 *     suppression; `WARNING_PATTERNS` — log-only, never blocks).
 *     Membership in the flat array does NOT by itself guarantee
 *     suppression. Callers that need the "must never reach the wire"
 *     contract must consume `HARD_BAN_PATTERNS` directly — those are
 *     the precise template patterns the sanitiser fail-shuts on.
 *     `WARNING_PATTERNS` covers ambiguous tokens (e.g. `interventions`,
 *     `payloads`, `ISL`) that may legitimately appear in coaching prose
 *     and are tracked as evidence rather than blocked. See
 *     `Docs/v5/fix-brief-analysis-enrichment-critique-prose-safety.md`.
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
 * Catalogue of engine-implementation tokens the enrichment scrubber
 * (Commit 4 — `compose/sanitise-enrichment.ts`) knows about. This flat
 * array is documentation + a coverage anchor for the regex tiers
 * defined immediately below — it is NOT itself the enforcement surface.
 *
 * **Enforcement is tiered. Tier matters.**
 *   - Entries reachable via `HARD_BAN_PATTERNS` are SUPPRESSED — a
 *     match in user-facing prose is a sanitiser failure and the leaf
 *     is dropped.
 *   - Entries reachable only via `WARNING_PATTERNS` are LOG-ONLY —
 *     the sanitiser records the path and continues; the user still
 *     sees the prose. Used for ambiguous tokens that might be
 *     legitimate coaching copy (`interventions`, `payloads`, `ISL`,
 *     `e-value`, `causal path`, plain `bootstrap`).
 *
 * The unit test `HARD_BAN_PATTERNS — flat-token coverage` enforces
 * that every entry in this array is reachable via at least one tier;
 * adding a token without a matching pattern fails CI.
 *
 * Path-scoped: every check runs ONLY in the 15 user-facing prose
 * paths defined by the enrichment allowlist. Structural fields
 * (`payloads`, `feature_flags_snapshot`, etc.) legitimately contain
 * some of these tokens as object keys and are excluded from the scrub.
 *
 * Pattern notes:
 *   - `Node '` (capital N, space, single quote) — engine validation
 *     prefix from the captured ISL leak `"Node 'opt_X' has kind=..."`.
 *     Distinguished from bare `Node` (legitimate English in coaching
 *     prose like "the goal node").
 *   - `kind=` — engine vocabulary for graph node types; `HARD_BAN`
 *     pattern catches both `kind=option` and `kind='option'`.
 *   - `filtered before analysis` — engine preprocessing detail
 *     (`HARD_BAN`).
 *   - `option nodes` — engine internal taxonomy; `HARD_BAN` pattern
 *     is case-insensitive and matches `option node` too.
 *   - `_pipeline_outcome` — wire-shape internal field (`HARD_BAN`).
 *   - `monte carlo`, `epsilon-guarded`, `bootstrap_sampling` — engine
 *     algorithm vocabulary (`HARD_BAN`).
 *   - `payloads`, `ISL`, `intervention_target`, `interventions`,
 *     `numerically valid samples`, `e-value`, `bootstrap`,
 *     `causal path` — ambiguous: sometimes legitimate coaching prose,
 *     so `WARNING` only. The sanitiser logs evidence but does not
 *     suppress.
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

// ----------------------------------------------------------------------------
// Tiered patterns (used by the enrichment scrubber)
// ----------------------------------------------------------------------------
//
// Tier A: hard-ban — match → fail the sanitiser test, fail egress
// Tier B: warning  — match → log, do not fail
//
// Two distinct exports so callers (the V5 enrichment scrubber) can route
// matches differently. The `INTERNAL_TEMPLATE_TOKENS` array above stays
// for callers that just want a flat list. Token coverage is a SUPERSET of
// the flat array: Tier A + Tier B together include every token from the
// flat array, plus a few additional precise patterns
// (`bootstrap_sampling`, `ParameterUncertainty`, `point_mass`) that the
// flat array doesn't enumerate because they're substrings of broader
// terms it already covers.

/**
 * HARD-BAN — precise template patterns from engine code with no
 * legitimate user-facing use. A match in user-facing prose is a
 * sanitiser failure.
 *
 * Coverage rule: every entry in `INTERNAL_TEMPLATE_TOKENS` (the flat
 * registry above) must be reachable via at least one pattern below.
 * The contract test
 * `src/orchestrator-v5/compose/__tests__/sanitise-enrichment.test.ts`
 * pins this — adding a token to the flat list without a matching
 * pattern fails CI.
 *
 * Casing notes:
 *   - `Node '` (capital N + space + quote) only catches the captured
 *     ISL leak shape. Bare `Node` is legitimate English ("the goal
 *     node"); we do NOT flag it.
 *   - `kind\s*=` (without requiring an apostrophe) catches both
 *     `kind='option'` and the unquoted `kind=option` variant.
 *   - `option\s+nodes?` (case-insensitive, allowing singular/plural)
 *     catches `option nodes`, `Option Nodes`, and `option node` —
 *     which is the engine taxonomy regardless of casing.
 */
export const HARD_BAN_PATTERNS: readonly RegExp[] = [
  /\bNode '/,                              // captured-leak prefix (capital N + apostrophe)
  /\bkind\s*=/,                            // kind=option / kind='option' / kind = "option"
  /filtered before analysis/i,             // captured-leak suffix
  /\boption\s+nodes?\b/i,                  // engine taxonomy, all casings, sing/plural
  /_pipeline_outcome/,                     // wire-shape internal field name
  /\bmonte\s+carlo\b/i,                    // engine algorithm name
  /\bepsilon-guarded\b/i,                  // engine numerical-stability term
  /\bbootstrap_sampling\b/i,               // confidence_source enum value
  /\bParameterUncertainty\b/,              // ISL class name
  /\bpoint_mass\b/,                        // distribution enum value
];

/**
 * WARNING — broader terms that *might* be jargon but appear in
 * legitimate prose. Tracked in evidence/warnings, never block.
 */
export const WARNING_PATTERNS: readonly RegExp[] = [
  /\bISL\b/,                                // could appear in docs / coaching refs
  /\binterventions?\b/i,                    // already used in some coaching templates
  /\bintervention[_\s]targets?\b/i,
  /\bnumerically\s+valid\s+samples?\b/i,
  /\be-value\b/i,
  /\bcausal\s+paths?\b/i,
  /\bbootstrap\b/i,                         // without _sampling — could be unrelated
  /\bpayloads?\b/i,                         // ambiguous — could be legitimate user copy
];
