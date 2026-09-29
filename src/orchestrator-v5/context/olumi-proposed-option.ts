/**
 * ⛔ ONE PREDICATE FOR "OLUMI PROPOSED THIS OPTION" (DL 5887534233; Canonical 5887528088 / 5887875048; MG 5887738387).
 *
 * An option Olumi's drafter added, which the brief did not name, is a PROPOSAL until the user adopts it. It is never
 * compared as theirs (PTL root 2; AIQ 5887015488). MG's construction marks it `proposed_by: 'olumi'`: only when the
 * drafter tagged it and the brief names neither its label nor a level it sets. That is a typed field, never a Run-time
 * guess from text.
 *
 * Every reader decides with THIS function, so they cannot disagree:
 *   - the Run filter (Runtime), after `gateAnalysableOptions`: which options form the user's comparison;
 *   - `computeAnalysisAffectingGraphHash` (Canonical): adopting the option (removing the mark) moves the hash, so the
 *     earlier Run becomes stale and a fresh Run is needed;
 *   - MG's marker, which writes the field.
 *
 * A leaf module: it imports nothing, so `context/` never reaches into `agent-lane/`. It reads ONE typed field, exactly.
 * Anything else — absent, another value, a non-object — is the user's option (fail towards comparing, never towards
 * silently dropping an option the user may own).
 */

/** The value MG's construction writes on an Olumi-proposed option node. */
export const OLUMI_PROPOSED_BY = 'olumi' as const;

/** True exactly when the node carries MG's typed mark `proposed_by: 'olumi'`. */
export function isOlumiProposedOption(node: unknown): boolean {
  return typeof node === 'object' && node !== null && !Array.isArray(node)
    && (node as { proposed_by?: unknown }).proposed_by === OLUMI_PROPOSED_BY;
}
