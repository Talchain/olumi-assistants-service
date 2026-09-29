/**
 * V5 clarify-entity bold guard (deterministic-copy / output-safety hardening,
 * Area C).
 *
 * The routing LLM can spontaneously emphasise a fragment of the user's
 * question with markdown bold, presenting an arbitrary phrase as if it were a
 * graph entity (observed on staging — clarify copy bolded invalid "entities").
 * This guard PRESERVES bold emphasis ONLY when the bolded span matches a real
 * graph node / edge / option label by exact normalised equality (trim +
 * case-fold); otherwise it strips the `**` markers, leaving the words as plain
 * (neutral) text so the clarification reads cleanly without promoting a
 * fragment to an entity.
 *
 * Deliberately bounded — NOT a general markdown sanitiser:
 *   - inspects ONLY `**…**` spans; every other markdown construct is left
 *     untouched;
 *   - exact normalised match only — NO fuzzy / substring / partial matching;
 *   - never deletes content (only the two `**` markers around an unmatched
 *     span);
 *   - never rewrites non-bold prose.
 *
 * Pure functions, no I/O. Applied to LLM-authored clarify prose at the
 * `composeClarifyResponse` call site in turn-executor.
 */

/**
 * Matches a single markdown bold span `**inner**`. `inner` excludes `*` and
 * newlines so the match stays within one well-formed span and never spans
 * across an unrelated `**` pair. Global so `String.prototype.replace` visits
 * every span.
 */
const BOLD_SPAN_RE = /\*\*([^*\n]+?)\*\*/g;

/** Normalise a label for exact comparison: trim + case-fold. No fuzzing. */
function normaliseLabel(s: string): string {
  return s.trim().toLowerCase();
}

export interface NeutraliseResult {
  readonly text: string;
  /**
   * Number of bold spans whose `**` markers were stripped because the inner
   * text did not exactly match a known entity label. Zero means the text was
   * returned unchanged.
   */
  readonly stripped_count: number;
}

/**
 * Strip markdown bold emphasis from any `**…**` span whose inner text is not an
 * exact (normalised) match for a real entity label. Bold around a genuine
 * label is preserved verbatim. Returns the original string untouched when it
 * contains no `**`.
 */
export function neutraliseUnvalidatedBoldEntities(
  text: string,
  validLabels: ReadonlySet<string>,
): NeutraliseResult {
  if (typeof text !== 'string' || text.indexOf('**') === -1) {
    return { text: typeof text === 'string' ? text : '', stripped_count: 0 };
  }
  let stripped = 0;
  const out = text.replace(BOLD_SPAN_RE, (match: string, inner: string) => {
    const normalised = normaliseLabel(inner);
    if (normalised.length > 0 && validLabels.has(normalised)) {
      // The bolded span IS a real entity label — keep the emphasis verbatim.
      return match;
    }
    // Not a known label — strip the `**` markers, keep the words as neutral
    // text. (Exact-match only: a fragment that merely contains a label, or
    // differs by punctuation, is intentionally treated as unmatched.)
    stripped += 1;
    return inner;
  });
  return { text: out, stripped_count: stripped };
}

export interface EntityLabelSources {
  /**
   * Raw graph nodes (ContextPack compact-graph nodes are loosely typed as
   * `unknown`). Each node may carry a `label` string; anything else is
   * ignored. This is the authoritative, most complete source — it covers
   * every factor / option / goal / outcome node label.
   */
  readonly graphNodes?: readonly unknown[];
  /**
   * Already-extracted label strings (e.g. analysis_ready option labels or
   * projected analysis labels). Supplements `graphNodes`; non-strings and
   * blanks are ignored.
   */
  readonly labels?: ReadonlyArray<string | null | undefined>;
}

/**
 * Build the normalised set of valid entity labels from the label-bearing
 * sources available at clarify-compose time. Defensive: tolerates loosely
 * typed graph nodes and skips anything that is not a non-empty string. When
 * no labels are available the result is empty — and the guard then strips ALL
 * bold (neutral wording), which is the intended safe default ("if no valid
 * graph label exists, do not bold arbitrary fragments").
 */
export function collectValidEntityLabels(sources: EntityLabelSources): Set<string> {
  const set = new Set<string>();
  const add = (label: unknown): void => {
    if (typeof label === 'string') {
      const n = normaliseLabel(label);
      if (n.length > 0) set.add(n);
    }
  };
  for (const node of sources.graphNodes ?? []) {
    if (node !== null && typeof node === 'object' && 'label' in node) {
      add((node as { label?: unknown }).label);
    }
  }
  for (const l of sources.labels ?? []) add(l);
  return set;
}
