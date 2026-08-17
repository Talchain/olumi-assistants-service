/**
 * ⭐⭐ ROADMAP 2.1265 (D2) — NO REPLY MAY ASSERT THE MODEL ALREADY HOLDS A
 * VALUE IT DID NOT READ FROM THE PERSISTED GRAPH.
 *
 * THE DEFECT, wire-witnessed on deployed CEE `8be62df`
 * (`olumi-docs/witness-acceptance-2026-08-17/`, scenario
 * `289c2690-f605-4f3c-8e43-465b339fda1e`, J4 turn 2, turn_id
 * `2211b6b7-37a3-48c5-afa5-c508e3db3c99`, capture `j4-t2-event-final.json`):
 *
 *   REQUEST  "The subcontractor cost should be 12% of revenue on the affected
 *            routes."
 *   RESPONSE 200, `exit_path: "turn_executor"`, ONE `routing` LLM call
 *            (prompt 120, hash adcc5128d4e6e6bc) —
 *            **"Your model already reflects subcontractor cost at 12% of
 *            affected-route revenue, so no change is needed there."**
 *            plus two confident bullets anchored on it, and a closing
 *            "The subcontracting option's costs are modelled using this 12%
 *            figure already".
 *
 * And in the SAME payload, `analysis_state.readiness.blockers[0]`:
 *
 *   { code: "MISSING_OPTION_VALUE",
 *     option_label: "subcontracting inner-city deliveries to a green courier",
 *     factor_label: "Subcontractor cost as share of affected-route revenue",
 *     message: "Choose the missing effect value for …" }
 *
 * The persisted draft carried NO 0.12 and NO 12% anywhere (absence sweep with a
 * positive control on the 0.5 defaults); the factor sat at `0.5`, source
 * `cee_inference`; no edit fact preceded the turn. **A reply that contradicts
 * its own payload's blocker is unconditionally wrong.**
 *
 * ⚠ WHY THE IDENTITY BINDING IS ON THE VALUE, NOT THE LABEL — and this was
 * measured, not assumed. The obvious guard binds the claim to a blocker's
 * `factor_label` in the same sentence (trap 19's ordinary shape). Run against
 * the witnessed bytes it NEVER FIRES: the fabricating reply says "subcontractor
 * cost at 12% of affected-route revenue" and "as a share of affected-route
 * revenue" — the persisted label is "Subcontractor cost as share of
 * affected-route revenue", and neither paraphrase contains it. A guard bound
 * that way would be correct and pointed at the wrong bytes (CLAUDE.md trap 22,
 * the `£1.5 million` shape). What the claim genuinely asserts is a NUMBER the
 * model supposedly holds, and whether the model holds it is a server-side FACT.
 * So the decisive conjunct is the brief's own rule: *unless it read that value
 * from the persisted graph*.
 *
 * ⭐ THE PREDICATE, AND WHY IT CAN ONLY DECLINE (traps 22 / 22b / 22f — four
 * rounds of open-ended NL predicates oscillated on a neighbouring seam):
 *
 *   1. A live `MISSING_OPTION_VALUE` blocker on THIS payload. Absent ⇒ the
 *      product is not in the asking-for-a-value state and this guard has no
 *      opinion. Read off the SAME readiness payload that composes the blocker
 *      copy the user is looking at (trap 12 — derived, never mirrored).
 *   2. A closed "already holds" ANCHOR in one sentence: the word `already`,
 *      a holding verb from a closed list, and a NUMERIC token. All three are
 *      required — bare `already` is ordinary English ("you already told me"),
 *      a holding verb without `already` is an instruction, and a claim with no
 *      number asserts no value.
 *   3. THE GRAPH SWEEP: not one numeric token in that sentence occurs anywhere
 *      in the persisted graph, in value form or in display-string form, with
 *      percent/share equivalence (12 ≡ 12% ≡ 0.12). If ANY of them is found the
 *      guard stands down — the strongest available stand-down, and the same
 *      method the witness used, with the same positive control.
 *   4. AN OPPOSITE-DIRECTION ESCAPE (trap 22b — every case gets its twin): a
 *      sentence that ALSO says the value is not set is making the TRUE claim.
 *
 * ⚠ SENTENCE SPLITTING DOES NOT SPLIT ON A DECIMAL POINT, and that is not a
 * detail: CEE has already shipped a guard that was correct and pointed at the
 * wrong bytes because `[.!?]` cut `£1.5 million` down to `1`. A `.` between two
 * digits is never a sentence end here.
 *
 * SAFE DIRECTION, stated explicitly. A false positive costs one honest clarify
 * turn about a value the blocker says is missing anyway. A false negative is the
 * product asserting a figure the user never gave, about the user's own model —
 * the estate's worst defect class. Where they conflict, this module fires.
 */

import { CONFIGURE_OPTION_EXAMPLE_VALUE } from './configure-option-clarify-response.js';
import { buildConfigureOptionAdvisedFormat } from '../configure-option-chip-text.js';
import {
  extractAssertedNumbers,
  groundModelValueClaim,
  type AuthoritativeModelRead,
  type ClaimRefusalReason,
  type MissingValuePair,
} from './model-contents-claim.js';

export type { MissingValuePair } from './model-contents-claim.js';
export {
  extractAssertedNumbers,
  readAuthoritativeModelState,
  projectMissingValuePairs,
  collectModelValueNumbers,
} from './model-contents-claim.js';

/**
 * The closed holding-verb set. A member, together with `already` and a number,
 * asserts that the model CARRIES that number now.
 *
 * Deliberately ABSENT: `knows`, `mentions`, `names`, `lists`, `shows` — those
 * describe the model containing the FACTOR, which is true (the factor exists).
 * The defect is the claim that its effect value is already set.
 */
export const ALREADY_HOLDS_VERBS: readonly string[] = [
  'reflect',
  'reflects',
  'reflected',
  'reflecting',
  'set',
  'sets',
  'carries',
  'carry',
  'carried',
  'holds',
  'hold',
  'held',
  'has',
  'have',
  'uses',
  'use',
  'using',
  'used',
  'models',
  'modelled',
  'modeled',
  'modelling',
  'captures',
  'captured',
  'records',
  'recorded',
  'includes',
  'include',
  'included',
  'contains',
  'contain',
  'at',
];

/**
 * The opposite-direction escape. A sentence naming a value AND saying it is
 * absent is the HONEST shape — the blocker copy itself reads this way — and
 * must never be swapped.
 */
export const VALUE_ABSENT_MARKERS: readonly string[] = [
  'not set',
  'not yet set',
  "isn't set",
  'is not set',
  'unset',
  'no value',
  'no values',
  'no effect value',
  'missing',
  'without a value',
  'needs a value',
  'not carrying',
  'blank',
  'empty',
];

/**
 * ⭐ Trap 22f's honest-gap protocol — claim shapes carrying the SAME harm that
 * are KNOWINGLY NOT CLAIMED, pinned as data so the suite REDs if the predicate
 * silently widens to claim one OR narrows past a claimed form. Each keeps
 * today's behaviour. A gap recorded in the suite is honest; a gap invisible to
 * it is how four rounds happen.
 */
export const MODEL_CONTENTS_CLAIM_KNOWN_DROPPED: readonly string[] = [
  // The claim carries NO number — it asserts the factor is represented, which
  // is true; only a value assertion is a value fabrication.
  'Your model already reflects subcontractor cost, so no change is needed there.',
  // The number and the `already` anchor sit in DIFFERENT sentences. Joining
  // them needs coreference, not a predicate.
  'Your model is already correct here. The figure is 12%.',
  // Present-tense assertion with no `already` anchor.
  'Your model reflects subcontractor cost at 12% of affected-route revenue.',
  // Future/conditional framing asserts nothing about the current model.
  'Setting subcontractor cost to 12% would already match your brief.',
];

export type MissingValueClaimStandDownReason =
  | 'no_text'
  | 'no_already_holds_claim'
  /** Every asserted value IS held by the authoritative read — the claim is TRUE. */
  | 'claim_is_grounded';

export type MissingValueClaimDecision =
  | { readonly verdict: 'stand_down'; readonly reason: MissingValueClaimStandDownReason }
  | {
      readonly verdict: 'swap';
      /** Why the claim was refused — the seam's own verdict, not re-derived. */
      readonly reason: ClaimRefusalReason;
      /** The blocked slots, in payload order. `[0]` supplies the worked example. */
      readonly pairs: readonly MissingValuePair[];
      /** The asserted numbers the graph does not hold, as written. */
      readonly assertedValues: readonly string[];
      /** The offending sentence, for telemetry only — never re-emitted. */
      readonly sentence: string;
      /** The honest replacement, composed from blocker facts only. */
      readonly text: string;
    };

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Word-only projection, space-padded — the coordinate space for every
 * whole-word and phrase test here.
 *
 * ⚠ IT MUST BE APPLIED TO BOTH SIDES. The first version padded the raw
 * normalised text and matched `" not set "`, which the sentence *"…the effect
 * value is not set."* fails on, because the marker is followed by the full stop.
 * The honest negation twin therefore SWAPPED — over-suppression, caught by its
 * own opposite-direction test rather than by inspection. Punctuation and
 * apostrophes collapse to spaces on the haystack AND on the needle, so
 * `isn't set` and `is not set.` both land.
 */
function wordsOnly(text: string): string {
  return ` ${normalise(text).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

/**
 * Split into sentences WITHOUT cutting a decimal.
 *
 * A terminator counts only when it is not sitting between two digits, so
 * `0.12`, `£1.5 million` and `12.5%` survive intact — the exact failure that
 * made a sibling guard read `1` where the message said `£1.5 million`.
 */
export function splitSentencesPreservingDecimals(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '\n') continue;
    if (ch === '.') {
      const prev = text[i - 1];
      const next = text[i + 1];
      if (
        prev !== undefined &&
        next !== undefined &&
        prev >= '0' &&
        prev <= '9' &&
        next >= '0' &&
        next <= '9'
      ) {
        continue;
      }
    }
    const piece = text.slice(start, i + 1).trim();
    if (piece.length > 0) out.push(piece);
    start = i + 1;
  }
  const tail = text.slice(start).trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

/** Whole-word membership over a space-padded, lower-cased haystack. */
function containsWord(paddedHaystack: string, word: string): boolean {
  return paddedHaystack.includes(` ${word} `);
}

/**
 * The honest replacement, composed from BLOCKER FACTS ONLY.
 *
 * ⚠ It does NOT echo the asserted number. The blocker says the effect value is
 * missing and the graph sweep says the model does not hold it, so this turn
 * holds no evidence about what the number should be — and repeating it beside
 * "I have not set it" is how a correction turns back into a claim. The routable
 * next step is the product's OWN advised format
 * (`buildConfigureOptionAdvisedFormat` = probe P1), so the sentence this reply
 * suggests returns to the lane that suggested it.
 */
export function composeModelContentsRefusal(
  pairs: readonly MissingValuePair[],
  reason: ClaimRefusalReason,
): string {
  // No blocked slot ⇒ the claim is merely UNGROUNDED, not contradicted. Say the
  // narrower true thing: the model does not carry it. Naming a pair here would
  // be an invention (P5's own rule applied to the correction copy).
  if (pairs.length === 0 || reason === 'not_in_persisted_state') {
    return 'I cannot say your model already carries that figure — I checked the saved model and it is not there. Tell me the value you want and I will set it.';
  }
  const primary = pairs[0]!;
  const example = buildConfigureOptionAdvisedFormat(
    primary.optionLabel,
    primary.factorLabel,
    CONFIGURE_OPTION_EXAMPLE_VALUE,
  );
  const head =
    pairs.length === 1
      ? `Your model does not carry that figure — "${primary.optionLabel}" still has no effect value on ${primary.factorLabel}, which is exactly what this turn is asking you for.`
      : `Your model does not carry that figure anywhere yet, and ${pairs.length} effect values are still unset — so I cannot tell you it is reflected there.`;
  return [
    head,
    `Tell me what it changes, like this: ${example}`,
    `Use a number from 0 (this option does nothing to it) to 1 (this option drives it fully).`,
  ].join(' ');
}

/**
 * Classify an assistant reply against its OWN payload's missing-value blockers
 * and the persisted graph.
 *
 * Pure: no I/O, no LLM, no telemetry. The caller owns emission and the swap.
 */
export function classifyModelContentsClaim(params: {
  readonly assistantText: string;
  /**
   * ⭐ THE STRUCTURAL GATE. Branded, and obtainable ONLY from
   * `readAuthoritativeModelState`, so this function cannot be asked for a
   * permission decision by a caller holding nothing but a sentence. Passing a
   * bare graph or readiness object is a COMPILE error, not a runtime check —
   * that is the difference between this and the advisory version it replaces.
   */
  readonly read: AuthoritativeModelRead;
}): MissingValueClaimDecision {
  const { assistantText, read } = params;
  if (typeof assistantText !== 'string' || assistantText.trim().length === 0) {
    return { verdict: 'stand_down', reason: 'no_text' };
  }

  let sawGroundedClaim = false;
  for (const sentence of splitSentencesPreservingDecimals(assistantText)) {
    const padded = wordsOnly(sentence);
    // ── The RECOGNISER: is this sentence a claim about model CONTENTS? Its
    // honest gaps are pinned in MODEL_CONTENTS_CLAIM_KNOWN_DROPPED. Every gap is
    // a MISSED claim; widening it can never create a permission.
    if (!containsWord(padded, 'already')) continue;
    if (!ALREADY_HOLDS_VERBS.some((verb) => containsWord(padded, verb))) continue;
    // Opposite-direction escape: a sentence that also says the value is absent
    // is making the TRUE claim (trap 22b — every case gets its twin).
    if (VALUE_ABSENT_MARKERS.some((marker) => padded.includes(wordsOnly(marker)))) continue;
    const asserted = extractAssertedNumbers(sentence);
    if (asserted.length === 0) continue;

    // ── The PERMISSION, delegated to the seam. Default-deny; no override.
    const verdict = groundModelValueClaim({ read, assertedValues: asserted });
    if (verdict.grounded) {
      sawGroundedClaim = true;
      continue;
    }
    return {
      verdict: 'swap',
      reason: verdict.reason,
      pairs: read.blockedSlots,
      assertedValues: asserted.map((n) => n.asWritten),
      sentence,
      text: composeModelContentsRefusal(read.blockedSlots, verdict.reason),
    };
  }
  return {
    verdict: 'stand_down',
    reason: sawGroundedClaim ? 'claim_is_grounded' : 'no_already_holds_claim',
  };
}
