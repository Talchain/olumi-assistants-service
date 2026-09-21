/**
 * ⭐ THE OBJECT — a confirmed, provenance-stamped reference class.
 *
 * ROADMAP 2.688 slice 1. Design:
 * `parallel-briefs/BASE-RATE-ELICITED-DESIGN-2026-08-08.md` §2.1.
 *
 * ⭐⭐ CONFIRMATION IS EXISTENCE (I8). There is exactly ONE constructor,
 * {@link createConfirmedReferenceClass}, and it is reachable only from the
 * confirm branch of the pre-route. `provenance.confirmed: true` is therefore
 * STRUCTURAL, not a flag someone remembered to set: there is no path from an
 * unconfirmed parse to an instance of this type. A preview turn creates
 * nothing and says so.
 *
 * ⭐ NOTHING DERIVED IS STORED. `(K, N)` are the truth; the posterior, its
 * mean and its quantiles are computed at READ time by
 * `deriveReferenceClassPosterior`. Storing a derived value beside its inputs
 * is a hand-maintained mirror (CLAUDE.md trap 12) — and here it would be the
 * worst kind, because the derived value is the number a user acts on while
 * the constants that produce it (D1) are explicitly pending a ruling.
 */

import {
  REFERENCE_CLASS_METHOD_VERSION,
  type ReferenceClassPosterior,
  deriveReferenceClassPosterior,
} from './beta-posterior.js';
import type { ParsedReferenceClass } from './reference-class-grammar.js';

export { REFERENCE_CLASS_METHOD_VERSION };

/**
 * An identity-bound link to the element the class informs.
 *
 * Resolved by the calibration preview's EVIDENCE-ONLY standard
 * (`resolveFactorLabelForConsentPreview` — exactly-one-substring-match or
 * null), never fuzzy. Naming the wrong factor inside a sentence that says
 * "Nothing has been changed" would be its own trust defect.
 */
export interface ReferenceClassTargetRef {
  readonly id: string;
  readonly kind: 'factor' | 'goal' | 'option';
}

export interface ReferenceClassProvenance {
  /**
   * A CLOSED enum of ONE value in v1 (I7). Nothing else exists: shape (b),
   * curated external base-rate sources, is out by the 2.688 ruling. A CEE-
   * authored number can therefore never acquire user provenance, and a user
   * number can never lose it, because there is no other value to assign.
   */
  readonly source: 'user_stated';
  /** ISO timestamp of the CONFIRMING turn — not of the statement turn. */
  readonly stated_at: string;
  readonly session_id: string;
  /** Always `true`. See the module docstring: existence implies confirmation. */
  readonly confirmed: true;
}

export interface ReferenceClassElicitation {
  /** The honest constant, on every instance. */
  readonly method_version: typeof REFERENCE_CLASS_METHOD_VERSION;
  /** VERBATIM — byte-identical to the words the user confirmed (I3). */
  readonly class_description: string;
  /** VERBATIM. */
  readonly outcome_description: string;
  /** The user's count, as said. Integer, 0 <= K <= N. */
  readonly observed_k: number;
  /** The user's count, as said. Integer, N >= 1. */
  readonly observed_n: number;
  /** VERBATIM, when offered. Carried; never turned into a discount (design §3.3). */
  readonly comparability_caveats?: string;
  readonly provenance: ReferenceClassProvenance;
  readonly target_ref?: ReferenceClassTargetRef;
}

/**
 * ⭐ THE ONLY CONSTRUCTOR.
 *
 * I1 — NO INVENTED CLASS MEMBERS. Both counts arrive on `parsed`, which came
 * from ONE parsed user utterance, and this function has NO DEFAULT for
 * either. It cannot construct, increment, estimate, or fall back to a count:
 * it re-validates and refuses. (The guarding mutant is a constructor default
 * such as `observed_n = 10`; it REDs on the refusal suite.)
 *
 * Throws rather than returning null on bad counts — deliberately. A caller
 * that has reached this point has already been through the grammar's
 * refusal taxonomy, so an invalid pair here is a programming error, and a
 * silent null would let a future call site persist nothing while telling the
 * user something was recorded.
 */
export function createConfirmedReferenceClass(input: {
  readonly parsed: ParsedReferenceClass;
  readonly session_id: string;
  readonly stated_at: string;
  readonly target_ref?: ReferenceClassTargetRef;
}): ReferenceClassElicitation {
  const { parsed, session_id, stated_at, target_ref } = input;
  if (!Number.isInteger(parsed.observed_k) || !Number.isInteger(parsed.observed_n)) {
    throw new Error('createConfirmedReferenceClass: K and N must be integers');
  }
  if (parsed.observed_n < 1) {
    throw new Error('createConfirmedReferenceClass: N must be at least 1');
  }
  if (parsed.observed_k < 0 || parsed.observed_k > parsed.observed_n) {
    throw new Error('createConfirmedReferenceClass: K must satisfy 0 <= K <= N');
  }
  if (parsed.class_description.trim().length === 0) {
    throw new Error('createConfirmedReferenceClass: class_description must not be empty');
  }
  if (parsed.outcome_description.trim().length === 0) {
    throw new Error('createConfirmedReferenceClass: outcome_description must not be empty');
  }
  if (session_id.length === 0) {
    throw new Error('createConfirmedReferenceClass: session_id must not be empty');
  }
  return {
    method_version: REFERENCE_CLASS_METHOD_VERSION,
    class_description: parsed.class_description,
    outcome_description: parsed.outcome_description,
    observed_k: parsed.observed_k,
    observed_n: parsed.observed_n,
    ...(parsed.comparability_caveats !== undefined
      ? { comparability_caveats: parsed.comparability_caveats }
      : {}),
    provenance: {
      source: 'user_stated',
      stated_at,
      session_id,
      confirmed: true,
    },
    ...(target_ref !== undefined ? { target_ref } : {}),
  };
}

/** Recompute the posterior from the stored counts. Never memoised, never stored. */
export function posteriorFor(
  elicitation: Pick<ReferenceClassElicitation, 'observed_k' | 'observed_n'>,
): ReferenceClassPosterior {
  return deriveReferenceClassPosterior(elicitation);
}
