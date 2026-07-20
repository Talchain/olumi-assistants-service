/**
 * Track 3 — Graph Management Core: machine-readable reason-code vocabulary.
 *
 * ISOLATED CORE (off-path): nothing in live V5 imports this module. These codes
 * are the stable, redacted vocabulary the mutation referee attaches to every
 * non-`would_apply` verdict. They are diagnostic identifiers only — never raw
 * payload values (redaction contract, T4.0 §5) — so they are safe to log and to
 * surface to Track 4 (UI-visible mutation state) and Track 6 (safety register).
 *
 * Provenance of the vocabulary:
 *  - Envelope/schema, frame/stale, referential, field-safety, readiness, and
 *    add_option codes restate the T4.0 hand-off contract
 *    (Docs/t4/dual-model-typed-mutation-handoff-contract.md) + PR #300's proven
 *    add_option blocker split.
 *  - `STRUCTURAL_APPLY_HELD` encodes the propose-confirm posture for structural
 *    mutations. `TUNABLE_APPLY_HELD` is RETIRED as a referee outcome by the D-S
 *    ruling (ROADMAP §D, Paul 2026-07-12: tunables auto-apply via candidate-build
 *    + R6 parity) but stays REGISTERED — historical held pendings and the
 *    held_proposal wire enum (@talchain/schemas HeldProposalReasonCode) still
 *    carry it, and removing a wire-ratified code would be a breaking change.
 */

// --- R1 envelope / schema (fail-closed parse) --------------------------------
export const SCHEMA_INVALID = 'SCHEMA_INVALID' as const;
export const UNKNOWN_KIND = 'UNKNOWN_KIND' as const;
export const UNKNOWN_ENVELOPE_VERSION = 'UNKNOWN_ENVELOPE_VERSION' as const;
export const MISSING_PROVENANCE = 'MISSING_PROVENANCE' as const;
export const EVIDENCE_POINTER_MISSING = 'EVIDENCE_POINTER_MISSING' as const;
export const BASE_HASH_MISSING = 'BASE_HASH_MISSING' as const;
export const BATCH_CAP_EXCEEDED = 'BATCH_CAP_EXCEEDED' as const;

// --- R2 frame / stale gate (frame-provided authority; never re-derived) -------
export const FRAME_UNAVAILABLE = 'FRAME_UNAVAILABLE' as const;
export const BASE_HASH_DIVERGED = 'BASE_HASH_DIVERGED' as const;
export const ANALYSIS_NOT_FRESH = 'ANALYSIS_NOT_FRESH' as const;
export const CURRENT_GRAPH_UNREADABLE = 'CURRENT_GRAPH_UNREADABLE' as const;

// --- R3 referential integrity -------------------------------------------------
export const ENTITY_NOT_FOUND = 'ENTITY_NOT_FOUND' as const;
export const ENTITY_ID_COLLISION = 'ENTITY_ID_COLLISION' as const;
export const OPTION_ID_COLLISION = 'OPTION_ID_COLLISION' as const;
// NOTE: graph-cap enforcement (max node/edge counts, dual-draft G11) is a DEFERRED slice —
// no code is emitted for it yet, so no `GRAPH_CAP_EXCEEDED` is minted here (the implemented
// contract stays honest). Re-add when candidate-cap enforcement lands.

// --- R4 field-safety ----------------------------------------------------------
export const FIELD_NOT_ALLOWED = 'FIELD_NOT_ALLOWED' as const;
export const PIPELINE_OWNED_FIELD = 'PIPELINE_OWNED_FIELD' as const;
export const ENGINE_CLAIM_IN_TEXT = 'ENGINE_CLAIM_IN_TEXT' as const;

// --- R5 candidate build (via the V5-owned apply seam) -------------------------
export const GRAPH_INVARIANT_VIOLATED = 'GRAPH_INVARIANT_VIOLATED' as const;
export const CANDIDATE_BUILD_FAILED = 'CANDIDATE_BUILD_FAILED' as const;

// --- R6 readiness parity (EP2) ------------------------------------------------
export const READINESS_DOWNGRADE = 'READINESS_DOWNGRADE' as const;
export const OPTION_SURFACE_CHANGED = 'OPTION_SURFACE_CHANGED' as const;

// --- R7 kind posture ----------------------------------------------------------
// add_option held-split (PR #300 proven; verified live in Agent 2 authority table)
export const ADD_OPTION_APPLY_UNWIRED = 'ADD_OPTION_APPLY_UNWIRED' as const;
export const OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE =
  'OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE' as const;
export const GRAPH_OPTIONS_MALFORMED = 'GRAPH_OPTIONS_MALFORMED' as const;
// structural propose-confirm posture (unchanged by D-S)
export const STRUCTURAL_APPLY_HELD = 'STRUCTURAL_APPLY_HELD' as const;
// RETIRED as a referee outcome (D-S, ROADMAP §D Paul 2026-07-12) — kept
// registered for historical pendings + the ratified held_proposal wire enum.
export const TUNABLE_APPLY_HELD = 'TUNABLE_APPLY_HELD' as const;
export const REMOVE_UNCONFIRMED = 'REMOVE_UNCONFIRMED' as const;
// F-3 negation guard (S-AUDIT-2026-07-20 probe P8/P9): the user's message
// carried protection/negation context naming this op's target entity, so a
// would_apply verdict is DEMOTED to held (propose-confirm) at the referee
// gate. Internal-vocabulary code; the held_proposal wire card maps it to the
// ratified TUNABLE_APPLY_HELD (see edit-graph-referee-gate.ts) because the
// @talchain/schemas HeldProposalReasonCode enum is a wire contract this
// service cannot extend unilaterally.
export const USER_PROTECTED_ENTITY = 'USER_PROTECTED_ENTITY' as const;

// --- Slice 4 idempotency ------------------------------------------------------
export const PROPOSAL_ALREADY_APPLIED = 'PROPOSAL_ALREADY_APPLIED' as const;

// --- Totality (fail-closed fallback; never escapes unclassified) --------------
export const CLASSIFY_FAILED = 'CLASSIFY_FAILED' as const;

/**
 * The complete closed set — frozen so a stray code is caught by
 * `isMutationReasonCode` and the vocabulary test, never invented ad hoc.
 */
export const MUTATION_REASON_CODES = Object.freeze([
  SCHEMA_INVALID,
  UNKNOWN_KIND,
  UNKNOWN_ENVELOPE_VERSION,
  MISSING_PROVENANCE,
  EVIDENCE_POINTER_MISSING,
  BASE_HASH_MISSING,
  BATCH_CAP_EXCEEDED,
  FRAME_UNAVAILABLE,
  BASE_HASH_DIVERGED,
  ANALYSIS_NOT_FRESH,
  CURRENT_GRAPH_UNREADABLE,
  ENTITY_NOT_FOUND,
  ENTITY_ID_COLLISION,
  OPTION_ID_COLLISION,
  FIELD_NOT_ALLOWED,
  PIPELINE_OWNED_FIELD,
  ENGINE_CLAIM_IN_TEXT,
  GRAPH_INVARIANT_VIOLATED,
  CANDIDATE_BUILD_FAILED,
  READINESS_DOWNGRADE,
  OPTION_SURFACE_CHANGED,
  ADD_OPTION_APPLY_UNWIRED,
  OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE,
  GRAPH_OPTIONS_MALFORMED,
  STRUCTURAL_APPLY_HELD,
  TUNABLE_APPLY_HELD,
  REMOVE_UNCONFIRMED,
  USER_PROTECTED_ENTITY,
  PROPOSAL_ALREADY_APPLIED,
  CLASSIFY_FAILED,
] as const);

export type MutationReasonCode = (typeof MUTATION_REASON_CODES)[number];

const REASON_CODE_SET: ReadonlySet<string> = new Set(MUTATION_REASON_CODES);

export function isMutationReasonCode(value: unknown): value is MutationReasonCode {
  return typeof value === 'string' && REASON_CODE_SET.has(value);
}
