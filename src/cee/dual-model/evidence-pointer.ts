/**
 * Evidence-pointer structural validation (quarantined scaffold — not imported
 * by any live path).
 *
 * The live ProposalEnvelope only enforces `min(1)` on evidence_pointer, so a
 * whitespace-only or zero-width-only pointer passes today (pinned as a
 * FINDING in __tests__/evidence-pointer.test.ts). This predicate closes that
 * structurally: after stripping Unicode format characters (Cf: zero-width
 * spaces/joiners, BOM, soft hyphen, bidi controls), a meaningful pointer must
 * contain at least one letter or digit in ANY script.
 *
 * Deliberately NO semantic rules: no 'brief:'-prefix requirement, no length
 * minimum, no denylist of values like 'n/a' — pointer SEMANTICS (quote or
 * locate real brief/graph evidence) are owned by the M2 prompt, and encoding
 * prompt assumptions in code would false-positive on legitimate briefs. A
 * rejection here costs one proposal (the merge's existing malformed_proposal
 * bucket), never the turn.
 *
 * WIRING NOTE: attaching this to the live ProposalEnvelope via `.refine()` is
 * a separate, explicitly-approved commit (it changes flag-ON MVP behaviour)
 * and additionally requires its own Codex re-review before it can ever merge.
 */

export type EvidencePointerRejection =
  | 'not_a_string'
  | 'empty'
  | 'whitespace_or_invisible_only'
  | 'no_substantive_character';

// Unicode format characters (category Cf): zero-width space family, joiners,
// word joiner, BOM, soft hyphen, bidi controls. Stripped before assessment so
// "invisible ink" pointers cannot pass as content.
const FORMAT_CHARS = /\p{Cf}/gu;
// At least one letter or digit, any script.
const SUBSTANTIVE_CHAR = /[\p{L}\p{N}]/u;

/**
 * Returns the coded rejection cause, or null when the pointer is acceptable.
 */
export function explainEvidencePointerRejection(pointer: unknown): EvidencePointerRejection | null {
  if (typeof pointer !== 'string') return 'not_a_string';
  if (pointer.length === 0) return 'empty';
  const stripped = pointer.replace(FORMAT_CHARS, '');
  if (stripped.trim().length === 0) return 'whitespace_or_invisible_only';
  if (!SUBSTANTIVE_CHAR.test(stripped)) return 'no_substantive_character';
  return null;
}

/**
 * True iff the pointer carries at least one substantive character once
 * invisible/format characters are removed. Equivalent to
 * `explainEvidencePointerRejection(pointer) === null` (property-tested).
 */
export function isMeaningfulEvidencePointer(pointer: string): boolean {
  return explainEvidencePointerRejection(pointer) === null;
}
