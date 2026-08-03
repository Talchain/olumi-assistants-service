/**
 * ROADMAP 2.380 (FIX 3) — product language for handler parameters, so a
 * validation refusal never shows the user our internal field names or the
 * validator's own numeric vocabulary.
 *
 * THE DEFECT THIS RETIRES (live capture, L52 diagnosis 2026-08-04, walk `w3`):
 *
 *     'strength' needs to be a number between -1 and 1.
 *
 * `strength` is a Zod field name. "a number between -1 and 1" is
 * `describeSchema` reading `_def.checks`. Neither is a thing the user has been
 * shown; the product's own word is "the strength of the link", and the scale's
 * MEANING (sign = direction, size = magnitude) is what makes the range
 * actionable. The accompanying chip said "Use a different value for strength."
 *
 * The repo already knew: `configure-option-clarify-response.ts:50` quotes this
 * exact sentence as "a real validator-jargon leak" that new copy must not
 * repeat. The copy elsewhere was fixed and this emission site was not — so the
 * guard for it is DERIVED over `HANDLER_VALIDATION_REGISTRY` rather than
 * written against the one parameter we happened to catch. A handler that adds
 * a parameter without adding phrasing turns that guard RED
 * (`__tests__/parameter-invalid-no-validator-jargon.test.ts`).
 *
 * COPY CONSTRAINTS (enforced by `assertStyle` in the compose tests): at most
 * three sentences, no em/en dashes, and none of the banned decision words.
 */

export interface ParameterPhrasing {
  /** What we could not use, in the product's words. One sentence. */
  readonly problem: string;
  /**
   * What to say instead — and, where a range is involved, what the scale
   * MEANS rather than what its bounds are. One or two sentences.
   */
  readonly guidance: string;
  /**
   * Whether to echo the rejected value back as "You gave X." between the two.
   *
   * This is a PER-PARAMETER decision, not a blanket one, because the echo is
   * only honest when the value came from the user. On the edge-strength path
   * it does not: the user says "very strong" and the ROUTING MODEL proposes a
   * number, so "You gave 30." attributes to the user something they never
   * typed, on a scale they have never been shown. On `set_factor_value` the
   * user really did type 1.5, and echoing it is the most useful part of the
   * reply.
   *
   * The echo's discriminating behaviour for non-scalar values (objects,
   * arrays, absent) is owned by the caller and is unchanged — it took several
   * rounds of sentinel leaks ('unknown', '[complex value]') to get right.
   */
  readonly echo_actual: boolean;
  /**
   * The retry chip's `message`. This becomes a USER TURN when clicked, so it
   * is product language too — the live one ("Use a different value for
   * strength.") put a schema field name in the user's own mouth.
   */
  readonly chip_message: string;
}

/** Assemble the rendered text. `actual` is already sanitised by the caller and
 *  is appended only when the caller's scalar gate AND the parameter's own
 *  `echo_actual` both allow it. */
export function renderParameterPhrasing(
  phrasing: ParameterPhrasing,
  actual: string | null,
): string {
  const echo = phrasing.echo_actual && actual !== null ? ` You gave ${actual}.` : '';
  return `${phrasing.problem}${echo} ${phrasing.guidance}`;
}

/**
 * Keyed by the parameter name as declared in `HANDLER_VALIDATION_REGISTRY`'s
 * `parameter_schemas`. Shared names (`value` is declared by both
 * `set_factor_value` and `add_constraint`) deliberately carry copy that reads
 * correctly for either.
 */
export const PARAMETER_USER_PHRASING: Readonly<Record<string, ParameterPhrasing>> =
  Object.freeze({
    strength: {
      problem: "I couldn't use that as the strength of that link.",
      // ⚠ NUMERIC-ONLY, DELIBERATELY. DO NOT SUGGEST WORDS HERE UNTIL 2.384 LANDS.
      //
      // An earlier draft advised "try 'strong', 'moderate' or 'weak'". Those are
      // the words the product SHOWS, so they read as the natural thing to
      // recommend — but the adjective→number path DOES NOT EXIST YET (ROADMAP
      // 2.384: there is no inverse of `bandFromMagnitude`, and CEE's band table
      // and the UI's `getStrengthLabel` do not even agree on the boundaries or
      // on the lowest band's name). A user who followed that advice would fail
      // again on the very next turn.
      //
      // That is the point: recovery copy must only recommend an input the
      // system can CURRENTLY accept. Recommending one it cannot would have
      // MANUFACTURED a dead-end loop out of a refusal that is otherwise
      // recoverable in a single step — turning this fix into the very defect
      // class it was written to remove.
      //
      // Restore the word suggestions as part of 2.384, once the band vocabulary
      // is unified and the words actually resolve.
      guidance:
        'Strength runs from minus one to plus one, where the sign sets the direction and the ' +
        'size sets how much it matters. Try a number in that range, like 0.7.',
      // See `echo_actual` — the number here is the routing model's, not the user's.
      echo_actual: false,
      chip_message: 'Use a different strength for that link.',
    },
    std: {
      problem: "I couldn't use that as the uncertainty on that link.",
      guidance: 'It needs to be a small positive amount, and it cannot be zero. Try something like 0.1.',
      echo_actual: false,
      chip_message: 'Use a different uncertainty for that link.',
    },
    value: {
      problem: "I couldn't use that as the value.",
      guidance: "Tell me the number you want and I'll set it.",
      echo_actual: true,
      chip_message: 'Use a different value for that factor.',
    },
    constraint_type: {
      problem: "I couldn't tell what kind of limit you meant.",
      guidance: "Tell me whether it is a maximum, a minimum or a target and I'll add it.",
      echo_actual: true,
      chip_message: 'Use a different kind of limit.',
    },
    label: {
      problem: "I couldn't use that as the name.",
      guidance: "Give me a short name and I'll use it.",
      echo_actual: true,
      chip_message: 'Use a different name.',
    },
    unit: {
      problem: "I couldn't use that as the unit.",
      guidance: 'Tell me the unit you want, for example pounds, percent or months.',
      echo_actual: true,
      chip_message: 'Use a different unit.',
    },
  });

/**
 * The copy used when the parameter is not one the registry declares (a
 * PARAMETER_INVALID raised outside `parameter_schemas` — graph predicates,
 * invalid_operator, and similar). It must be safe by construction: it echoes
 * NOTHING from the error, so no future emission site can leak through it.
 */
export const GENERIC_PARAMETER_PHRASING: ParameterPhrasing = Object.freeze({
  problem: "I couldn't use that value here, so nothing has changed.",
  guidance: "Tell me what you'd like instead and I'll apply it.",
  // Undeclared parameters keep the pre-existing echo behaviour, so the
  // discriminating scalar gate (and its controls) is not weakened by this fix.
  echo_actual: true,
  chip_message: 'Use a different value.',
});

/** Product phrasing for `parameter`, or the safe generic copy. Total. */
export function phrasingForParameter(parameter: string | undefined): ParameterPhrasing {
  if (parameter === undefined) return GENERIC_PARAMETER_PHRASING;
  return PARAMETER_USER_PHRASING[parameter] ?? GENERIC_PARAMETER_PHRASING;
}
