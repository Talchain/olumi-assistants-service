/**
 * Replacement conversation layer — removing identifiers the user must not see,
 * WITHOUT rewriting their English.
 *
 * WHY THIS EXISTS RATHER THAN REUSING THE SHARED SCRUB
 * -----------------------------------------------------
 * The shared egress scrub (`sanitiseOlumiResponseForEgress`) matches a
 * PATTERN: roughly, any token beginning with one of twelve common words
 * followed by a separator and more characters. It is unconditional — no flag,
 * no branch, no way to opt a controller out.
 *
 * It was measured on 20 Sep by extracting its regexes from source and
 * EXECUTING them. Nine of seventeen ordinary business sentences were rewritten:
 *
 *   "Improve the decision-making-process across teams."
 *       → "Improve the the relevant decision across teams."
 *   "Compare risk-adjusted-returns for each fund."
 *       → "Compare the relevant risk for each fund."
 *
 * Ungrammatical, and the capitalisation is gone. Any three-part hyphenated
 * compound starting with one of those twelve words trips it. That is a live
 * defect on every turn today and it is reported separately — this module does
 * not fix it, and must not be read as having done so.
 *
 * THE DIFFERENCE: BIND BY IDENTITY, NOT BY A PREDICATE
 * -----------------------------------------------------
 * This replaces only identifiers that ACTUALLY EXIST in the graph this turn.
 * "decision-making-process" is not a node id, so it cannot match. The set of
 * things replaced is derived from the model in front of the user, so it
 * cannot drift, cannot be too wide, and shrinks to nothing when there is no
 * graph — which is the correct behaviour, because with no graph there are no
 * ids to leak.
 *
 * This is the estate's own rule about assertions applied to a transform: bind
 * to the object by identity, never by a value predicate another object could
 * satisfy.
 *
 * WHAT IT DOES NOT CLAIM
 * ----------------------
 * It cannot catch an identifier the model invented that happens not to be in
 * the graph — but an invented id is not a leak of real internal state, and
 * the honest fix for that is the prompt instruction against showing
 * identifiers at all, plus the fact that ids only ever enter the model's
 * context through `read_workspace`.
 */

/** The minimum shape needed: things with an id and, ideally, a label. */
export interface IdentifiedNode {
  readonly id?: unknown;
  readonly label?: unknown;
}

export interface ScrubbableGraph {
  readonly nodes?: readonly IdentifiedNode[];
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace every graph identifier appearing in the text with its label.
 *
 * Longest id first, so `opt-1` cannot partially consume `opt-12`. Bounded by
 * non-word characters on both sides so an id never matches inside a longer
 * token. An id with no usable label is replaced with a neutral phrase rather
 * than left on screen.
 */
export function scrubKnownIdentifiers(text: string, graph: ScrubbableGraph | null | undefined): string {
  if (text.length === 0) return text;
  const nodes = graph?.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) return text;

  const replacements: { id: string; label: string }[] = [];
  for (const n of nodes) {
    const id = typeof n.id === 'string' ? n.id.trim() : '';
    if (id.length === 0) continue;
    const label = typeof n.label === 'string' && n.label.trim().length > 0 ? n.label.trim() : '';
    replacements.push({ id, label: label.length > 0 ? label : 'that item' });
  }
  if (replacements.length === 0) return text;

  replacements.sort((a, b) => b.id.length - a.id.length);

  let out = text;
  for (const { id, label } of replacements) {
    // `(^|[^\w-])` / `([^\w-]|$)` rather than `\b`: `\b` treats a hyphen as a
    // boundary, so an id of `opt` would match inside `opt-1`, and an id of
    // `f1` inside `f1-draft`. The measured failure of the shared scrub is
    // exactly this class of over-reach.
    const re = new RegExp(`(^|[^\\w-])${escapeForRegex(id)}([^\\w-]|$)`, 'g');
    out = out.replace(re, (_m, before: string, after: string) => `${before}${label}${after}`);
  }
  return out;
}
