/**
 * ⭐⭐ DID THE USER'S SENTENCE NAME MORE THAN ONE LEGITIMATE TARGET FOR THE
 * FIELD THIS WRITE IS ABOUT TO CHANGE?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WAS WITNESSED — fresh guest, deployed staging, SENDABLE failure 2:
 *
 *   "Key Account Renewal Risk AND Key Account Churn Exposure both look off to
 *    me — set it to 0.8."
 *
 * Two plausible referents, both named in the same sentence. The product wrote
 * to the first and issued an **"Applied"** receipt with no clarifying question.
 *
 * ⚠ THE RECEIPT WAS TRUTHFUL. It named what it actually changed and the
 * persisted state matched. This is the CLARIFY-VS-GUESS class, not the false-
 * receipt class, and it must not be fixed as a receipt defect.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ WHY A NEW MODULE, AND WHAT IT DELIBERATELY IS NOT (trap 21, and Paul's
 * standing directive "do not add another local entity-resolution predicate").
 *
 * There are already five authorities for *"which field does this ask target?"*
 * — `detectConfigureOptionIntent`, `deriveMissingEffectPairs`,
 * `impliesOptionInterventionEdit`, `resolveOptionEffectWrite`,
 * `findOutstandingEffectAskCollision`. **This module is not a sixth: it
 * resolves nothing and it targets nothing.** It answers a DIFFERENT question,
 * about a write whose target has ALREADY been resolved by one of those
 * authorities or by the LLM router:
 *
 *     *given the target this proposal picked, did the user's own sentence
 *      name a SECOND entity that the same field could equally have meant?*
 *
 * Trap 21's rule is to name the concepts apart rather than reconcile them, so
 * this file states its question in its first line and never answers the other
 * one. It cannot bind a write, cannot choose between candidates, and its only
 * output is "ambiguous, here are the entities the user named" or `null`.
 *
 * ⭐ AND IT SPELLS NO NEW MATCHING RULE. Both halves of "did the sentence name
 * this entity" are IMPORTED from `option-intervention-guard.ts`:
 *   · full-label naming  → `containsPhrase` (word-bounded, literal `indexOf`);
 *   · partial reference  → `deriveOptionDistinctiveTokens`, the estate's own
 *     derive-by-subtraction of "the words that identify THIS entity and
 *     nothing else in THIS graph".
 * That function is named for options because options were its first caller;
 * its implementation is generic over (target labels, every other label), and
 * this module calls it once per candidate target with the target's own label.
 * No second spelling is minted, so this guard cannot drift from the guard that
 * already decides whether a sentence names an entity.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ THE SUBTRACTION LIST'S SAFE DIRECTION IS **INVERTED** HERE, AND THAT IS
 * THE MOST IMPORTANT SENTENCE IN THIS FILE.
 *
 * `deriveOptionDistinctiveTokens` documents its own tolerance for an
 * incomplete `nonOptionLabels` list: *"fewer subtractions means MORE words
 * count as option cues, so the guard fires more often, never less"* — safe,
 * because ITS caller fires into a containment refusal.
 *
 * **For THIS caller, firing more often means ASKING more often, which is the
 * defect on the opposite side.** A product that stops to clarify when the user
 * was perfectly clear is its own failure, and this estate has burned four
 * consecutive rounds on exactly that axis (CLAUDE.md trap 22f). So
 * `otherEntityLabels` is REQUIRED and must be COMPLETE — every named entity in
 * the graph except the candidate whose cues are being derived. An incomplete
 * list does not degrade safely here; it manufactures ambiguity.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE CONJUNCTS, each load-bearing:
 *
 *  (a) **PLAUSIBLE TARGETS ONLY.** The caller supplies `candidateTargets` —
 *      the entities the PROPOSED HANDLER can legitimately write. Naming a
 *      factor and an option in one breath is not an ambiguous `set_factor_value`
 *      because only one of them is a target for that field. This conjunct is
 *      the whole of the brief's "naming two where only one is a plausible
 *      target for the stated field must NOT trigger a question".
 *
 *  (b) **THE PROPOSAL'S OWN TARGET MUST BE ONE OF THE NAMED ONES.** If the
 *      write is aimed at an entity the sentence never named, that is the
 *      WRONG-ENTITY class (#1034/#1035/#1067), owned elsewhere, and a clarify
 *      here would paper over it. This module stays silent and lets that class
 *      be seen.
 *
 *  (c) **A FULL LABEL DOMINATES A PARTIAL CUE.** When exactly one named
 *      candidate was named by its COMPLETE label and every rival only by a
 *      distinctive word, the user was clear and the write proceeds. This is
 *      the same dominance idea `AUTO_SELECT_DOMINANCE_MARGIN` encodes in
 *      `deterministic-value-update.ts`, one axis over: an exact hit is not
 *      defeated by a weaker echo. It is what keeps *"unlike Churn Exposure,
 *      set Key Account Renewal Risk to 0.8"* silent.
 *
 *  (d) **TWO OR MORE SURVIVING CANDIDATES.** One is not an ambiguity.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ WHY THE FACTOR PRE-ROUTE DOES NOT ALREADY COVER THIS — MEASURED AT
 * PRISTINE `53eb8d03`, NOT REASONED. `tryDeterministicValueUpdate` DOES return
 * `{dispatch: 'clarify', candidates: 2}` for the witnessed sentence when both
 * labels appear in FULL. The hole is the sentence a real user types:
 *
 *   "Key Account Renewal Risk and Key Account Churn Exposure … set it to 0.8"
 *                                        → clarify, 2 candidates ✅
 *   "Renewal Risk and Churn Exposure … set it to 0.8"
 *                                        → SKIP `no_candidate_match` → LLM ❌
 *   "… set it to 0.8, we were at 0.5."   → SKIP `ambiguous_quantity` → LLM ❌
 *
 * On both skip paths the LLM router resolves the partial reference perfectly
 * well, picks ONE, and the write lands under an "Applied" receipt. **The
 * pre-route's ambiguity verdict is computed only when the pre-route OWNS the
 * turn**; nothing re-asks the question on the LLM's proposal. This module is
 * placed at the execute chokepoint that both producers converge on, so the
 * question is asked once, for every dispatch path.
 */

import {
  containsPhrase,
  deriveOptionDistinctiveTokens,
} from './option-intervention-guard.js';

/** A candidate the proposed handler could legitimately write. */
export interface NamedTargetCandidate {
  readonly id: string;
  readonly label: string;
}

/** How the sentence referred to a candidate. */
export type NamedTargetNaming = 'full_label' | 'distinctive_token';

export interface NamedTargetAmbiguity {
  /**
   * Every candidate the sentence named, in FIRST-MENTION ORDER, including the
   * one the proposal picked. Never fewer than two.
   *
   * Order is the message's, not the graph's, so the copy lists them the way
   * the user said them. It is presentation only — this module never treats
   * position as evidence of intent, because "the first one mentioned wins" is
   * precisely the silent guess being removed.
   */
  readonly candidates: readonly (NamedTargetCandidate & { readonly naming: NamedTargetNaming })[];
}

/**
 * Shapes this guard KNOWINGLY DOES NOT CLAIM, pinned as data so the suite REDs
 * if the claim widens OR narrows (CLAUDE.md trap 22f's honest-gap protocol).
 * Each falls through to today's behaviour unchanged.
 */
export const NAMED_TARGET_AMBIGUITY_KNOWN_DROPPED: readonly {
  readonly shape: string;
  readonly why: string;
}[] = Object.freeze([
  Object.freeze({
    shape:
      'two candidates named by PARTIAL cue only, one of them contrastively — '
      + '"unlike Churn Exposure, set Renewal Risk to 0.8"',
    why:
      'both are partial references, so conjunct (c)\'s full-label dominance cannot separate '
      + 'them and the guard asks. Separating them needs a contrastive-framing predicate over '
      + 'free prose, and four consecutive rounds of exactly that kind of tuning oscillated on a '
      + 'neighbouring seam (CLAUDE.md trap 22f) — the exit named there is to make the ambiguity '
      + 'the product rather than guess better. Cost of the residual: one clarify turn, with the '
      + 'user\'s own value carried forward in the chip so nothing is lost',
  }),
  Object.freeze({
    shape: 'a candidate named only by an INFLECTION of a distinctive word ("renewals", "churned")',
    why:
      'cue matching here is exact-token, deliberately: `tokensShareLexeme` is private to '
      + 'option-intervention-guard and re-spelling it would mint the second copy trap 12 exists '
      + 'to ban. Fails toward SILENCE — the guard does not fire, today\'s behaviour stands — '
      + 'which is the correct direction for a predicate whose false positive is an unwanted '
      + 'question. Exporting the lexeme rule is the honest fix when a witness demands it',
  }),
  Object.freeze({
    shape: 'two candidates whose labels share every distinctive word — a PARTIAL cue can then name neither',
    why:
      'subtraction leaves neither with a distinctive token, so a PARTIAL reference cues '
      + 'neither and the guard stays silent — fails toward silence. ⚠ NOT so for a FULL-label '
      + 'reference: two identically-labelled factors both match in full, conjunct (c) cannot '
      + 'separate them, and the guard DOES ask. Both halves are pinned in the companion spec '
      + 'because the prose alone reads as one behaviour and there are two',
  }),
  Object.freeze({
    shape: 'the proposal targets an entity the sentence never named',
    why:
      'conjunct (b). That is the WRONG-ENTITY class (#1034/#1035/#1067) and it has owners; '
      + 'raising a clarify here would hide it behind a question',
  }),
]);

/**
 * Returns the ambiguity, or `null` when the write may proceed untouched.
 *
 * PURE — no I/O, no LLM, no graph read. The caller owns the graph and supplies
 * both label sets.
 */
export function findNamedTargetAmbiguity(params: {
  /** The user's own prose for this turn. */
  readonly message: string;
  /** `proposal.entity.id` — the target the write has already resolved to. */
  readonly proposedEntityId: string;
  /**
   * Entities the PROPOSED HANDLER can legitimately write — conjunct (a).
   * For `set_factor_value` this is the graph's factor-kind nodes.
   */
  readonly candidateTargets: readonly NamedTargetCandidate[];
  /**
   * EVERY OTHER named entity label in the graph — options, outcomes, risks,
   * the goal, and any candidate target other than the one being scored.
   *
   * ⚠ REQUIRED AND MUST BE COMPLETE. See the header: an incomplete list makes
   * MORE words count as cues, which for THIS caller manufactures ambiguity
   * rather than degrading safely.
   */
  readonly otherEntityLabels: readonly string[];
}): NamedTargetAmbiguity | null {
  if (typeof params.message !== 'string') return null;
  if (typeof params.proposedEntityId !== 'string' || params.proposedEntityId.length === 0) {
    return null;
  }
  if (params.candidateTargets.length < 2) return null;

  const padded = ` ${params.message.toLowerCase().replace(/\s+/g, ' ').trim()} `;
  const messageTokens = new Set(
    padded.split(/[^a-z0-9]+/).filter((t) => t.length > 0),
  );

  const named: {
    id: string;
    label: string;
    naming: NamedTargetNaming;
    at: number;
  }[] = [];

  for (const target of params.candidateTargets) {
    if (typeof target.label !== 'string') continue;
    const normLabel = target.label.toLowerCase().replace(/\s+/g, ' ').trim();
    if (normLabel.length === 0) continue;

    if (containsPhrase(padded, normLabel)) {
      named.push({
        id: target.id,
        label: target.label,
        naming: 'full_label',
        at: padded.indexOf(normLabel),
      });
      continue;
    }

    // The derive-by-subtraction owner, called with THIS target as the thing
    // being identified and every other named entity as the subtraction set.
    const { cues } = deriveOptionDistinctiveTokens(
      [target.label],
      [
        ...params.otherEntityLabels,
        ...params.candidateTargets
          .filter((other) => other.id !== target.id)
          .map((other) => other.label),
      ],
    );
    let earliest = -1;
    for (const cue of cues) {
      if (!messageTokens.has(cue)) continue;
      const at = padded.indexOf(cue);
      if (at !== -1 && (earliest === -1 || at < earliest)) earliest = at;
    }
    if (earliest !== -1) {
      named.push({ id: target.id, label: target.label, naming: 'distinctive_token', at: earliest });
    }
  }

  // (d) one named candidate is not an ambiguity.
  if (named.length < 2) return null;
  // (b) the write must be aimed at one of the entities the sentence named.
  if (!named.some((n) => n.id === params.proposedEntityId)) return null;
  // (c) an exact hit is not defeated by a weaker echo.
  const fullLabelHits = named.filter((n) => n.naming === 'full_label');
  if (fullLabelHits.length === 1) return null;

  named.sort((a, b) => a.at - b.at);
  return {
    candidates: named.map(({ id, label, naming }) => ({ id, label, naming })),
  };
}
