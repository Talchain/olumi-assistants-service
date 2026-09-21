/**
 * ROADMAP 2.692 slice 2 — the two judgement-lens offers' TEXT and their
 * COMPOSABILITY tests, extracted to a PURE LEAF exactly as
 * `fragile-edge-offer-text.ts` prescribes: one function, two callers (the
 * selector's 2.1024 eligibility stage and the block mint), so the eligibility
 * test and the composition cannot disagree about what is composable.
 *
 * COPY LICENCE: the sentences are design 2.692 §4's evidence sentences (the
 * licensed claims — OQ-3's copy deck), restructured only so the NAMING clause
 * leads the body: the body is truncated at {@link COACHING_BLOCK_BODY_MAX} and
 * a naming sentence placed last is the first thing truncation eats (measured on
 * the fragile-edge card — it silently lost the second endpoint label).
 *   T1: licensed by the `edge_adjudication` fact + its closed verdict enum.
 *   T2: licensed by `validation.status === 'contested'` + the empty
 *       adjudication join.
 * No verdict language, no magnitudes, no "recommended option" — the target is
 * always an ISSUE (2.692 §4.3). `dsk_provenance` is deliberately ABSENT: neither
 * trigger is a bundle trigger, and claiming provenance these rules do not have
 * would be a false label (trap 14; the three core lenses set the precedent).
 *
 * CARD COMPOSABILITY: endpoint labels are user/producer-authored and unbounded,
 * so each offer's gate is that its naming sentence alone survives the body cap.
 * That predicate is the lens's ELIGIBILITY question (ROADMAP 2.1024) and is
 * asked at two sites — `lens-selector.ts` and the block mint — so it must stay
 * the same function.
 *
 * ── PR2 COMPLETE LOOP (L1): THE ACTION, AND WHY IT IS A SECOND PREDICATE ─────
 * v1 shipped no action on these lenses and this module said so. That is now
 * superseded: `phase3-blocks.ts` minted the composite edge id "should a later
 * slice add an action chip", and this is that slice.
 *
 * The action gets its OWN predicate rather than a conjunct on the card gate,
 * because they answer DIFFERENT QUESTIONS (CLAUDE.md trap 21):
 *   · `is{Override,Disagreement}OfferComposable` — *can this run's labels be
 *     phrased into the CARD?* If no, the lens is ineligible and the slot passes.
 *   · `is{Override,Disagreement}ActionComposable` — *can they be phrased into a
 *     turn that REACHES the handler that fulfils it?* If no, the card ships
 *     WITHOUT action fields — exactly the surface #907 shipped.
 * Folding the second into the first would make an unphrasable ACTION drop a
 * CARD that ships today (measured: five of the eight adversarial label pairs in
 * `__tests__/judgement-offer-action.test.ts` trip the mutation veto), trading a
 * missing button for a missing finding. The fragile-edge lens is the opposite
 * case and correctly keeps ONE predicate: its body has no meaning without the
 * offer ("Change IT and…"), so there the card and the action stand or fall
 * together. The ACTION predicates therefore have exactly ONE production caller
 * each — the block mint — and no second derivation to disagree with.
 *
 * ── THE TWO ROUTES ARE DELIBERATELY OPPOSITE (design §2.1) ───────────────────
 * T1 says *a human set this value and nobody stress-tested it*; the honest
 * follow-through is a PROBE, which changes nothing. Binding T1 to a mutation
 * prompt would invite the user to overwrite the very judgement the card exists
 * to examine. T2 says *two drafting passes disagreed*; the honest
 * follow-through is a CHANGE. So T1's prompt must NOT dispatch `edit_graph` and
 * MUST be claimed by the free-text `what_would_flip` class, while T2's must
 * dispatch — the same corpus is run through both expectations.
 *
 * ⚠ WHY THE `→` SPELLING, AND NOT THE DESIGN'S `from {from} to {to}` — measured,
 * and NARROWER than this lane first wrote. The two phrasings are IDENTICAL at
 * the real gate on all 22 live-capture label pairs
 * (`/\bfrom\s+\S+\s+to\s+\S+/i` admits exactly one token between `from` and
 * `to`, and real endpoint labels are multi-word). They diverge when a PRODUCER
 * LABEL carries an edit verb: "Set Up Cost" or "Change Rate" plus the phrasing's
 * own `to` forms a `<verb> … to <X>` span, which is an independent mutation
 * signal, which denies the gate's narrow `what_would_flip_free_text` exception —
 * a button that terminates in the generic router. The `→` spelling removes that
 * class at no cost and is the spelling `target_refs[].label` already uses.
 */

import {
  COACHING_ACTION_PROMPT_MAX,
  FRAGILE_EDGE_ACTION_LABEL,
  composeFragileEdgeActionPrompt,
  composeOfferBody,
  isEditGraphDispatchable,
  namingFitsBodyCap,
} from './fragile-edge-offer-text.js';
import {
  classifyAnalyticalIntent,
  hasIndependentMutationSignal,
} from '../routing/analytical-intent.js';
import { isAnalyticalQuestion } from '../routing/analytical-question-guard.js';

// ── T1: override_stress_test ("Stress-test the value you set") ───────────────

export function composeOverrideNaming(fromLabel: string, toLabel: string): string {
  return `You overrode the estimate for the link from ${fromLabel} to ${toLabel}.`;
}

/** Naming sentence first, the lens's licensed tail second. */
export function composeOverrideBody(base: string, fromLabel: string, toLabel: string): string {
  return composeOfferBody(composeOverrideNaming(fromLabel, toLabel), base);
}

export function isOverrideOfferComposable(fromLabel: string, toLabel: string): boolean {
  return namingFitsBodyCap(composeOverrideNaming(fromLabel, toLabel));
}

/** The caption on T1's button. A PROBE, and the word choice says so. */
export const OVERRIDE_STRESS_TEST_ACTION_LABEL = 'Test this value';

/**
 * T1's acceptance turn — the EXACT string the block ships.
 *
 * Names the edge with the `→` spelling so the card, its `target_refs[].label`
 * and the message the user sends all name the relationship identically; and
 * because the obvious alternative (`from {from} to {to}`) is a mutation signal
 * that kills the route (see the module header).
 */
export function composeOverrideActionPrompt(fromLabel: string, toLabel: string): string {
  return `Show me what would flip the result if the ${fromLabel} → ${toLabel} link were different.`;
}

/**
 * Can T1's PROBE be composed AND routed from this run's producer labels?
 *
 * Four gates, all evaluated on the ACTUAL composed string at composition time —
 * never merely asserted in a test, because the labels are PRODUCER data and a
 * corpus from this lane's head cannot see the class it did not imagine
 * (CLAUDE.md trap 22). Measured against every endpoint-label pair in the two
 * committed live captures plus an adversarial set.
 *
 *   1. the prompt must fit `COACHING_ACTION_PROMPT_MAX` UNTRUNCATED. T1's naming
 *      sentence is short enough to admit label pairs whose prompt would overflow,
 *      and a truncation can re-cut a word into or out of a routing token;
 *   2. it must NOT be dispatchable as an edit (`isEditGraphDispatchable`) — the
 *      OPPOSITE polarity to the fragile-edge/T2 gate. A probe that mutated the
 *      graph would overwrite the very judgement the card exists to examine;
 *   3. `isAnalyticalQuestion` must hold. This is the conjunct of `route-v2`'s
 *      `editVerbCandidate` that actually suppresses edit dispatch for a question,
 *      and it is what keeps gate 2 true when a PRODUCER LABEL supplies the edit
 *      verb — measured: 11 of 30 corpus prompts match the positive edit regex
 *      purely through labels such as "Add £2M Net New ARR Within 12 Months", so
 *      a bare `!EDIT_GRAPH_POSITIVE_REGEX` gate would drop the action on 5 real
 *      live-capture pairs for no safety gain;
 *   4. it must be claimed by the free-text flip class, and NOT carry an
 *      independent mutation signal — which is exactly the condition
 *      `tryPostAnalysisAdviceGate` applies before granting its narrow
 *      `what_would_flip_free_text` mutation exception. Asserted end-to-end
 *      against the REAL gate in the spec; enforced cheaply here at runtime.
 *
 * Deliberately NOT included, and disclosed rather than hidden: `scanProse`,
 * which lives on the whole composed block and is the block mint's own gate —
 * the same residual window `fragile-edge-offer-text.ts` names.
 */
export function isOverrideActionComposable(fromLabel: string, toLabel: string): boolean {
  const prompt = composeOverrideActionPrompt(fromLabel, toLabel);
  if (prompt.length > COACHING_ACTION_PROMPT_MAX) return false;
  if (isEditGraphDispatchable(prompt)) return false;
  if (!isAnalyticalQuestion(prompt)) return false;
  if (classifyAnalyticalIntent(prompt) !== 'what_would_flip') return false;
  if (hasIndependentMutationSignal(prompt)) return false;
  return true;
}

// ── T2: disagreement_resolution ("Resolve this disagreement") ────────────────

export function composeDisagreementNaming(fromLabel: string, toLabel: string): string {
  return `The two drafting passes disagreed about the link from ${fromLabel} to ${toLabel}, and it hasn't been settled.`;
}

export function composeDisagreementBody(
  base: string,
  fromLabel: string,
  toLabel: string,
): string {
  return composeOfferBody(composeDisagreementNaming(fromLabel, toLabel), base);
}

export function isDisagreementOfferComposable(fromLabel: string, toLabel: string): boolean {
  return namingFitsBodyCap(composeDisagreementNaming(fromLabel, toLabel));
}

/**
 * The caption on T2's button. A CHANGE — the honest follow-through when two
 * parties disagree about a relationship.
 *
 * ⚠ THE FRAGILE-EDGE LABEL, BY DELEGATION RATHER THAN BY RE-TYPING, on exactly
 * the grounds this file already gives for delegating the action PROMPT below:
 * T2 and the fragile-edge lens offer the SAME action on the SAME object, so a
 * second spelling of the caption is a hand-maintained mirror (CLAUDE.md trap 12)
 * — and a divergence would put two different captions on one action with
 * nothing red. Byte-identical to the literal it replaces.
 */
export const DISAGREEMENT_ACTION_LABEL = FRAGILE_EDGE_ACTION_LABEL;

/**
 * T2's acceptance turn. This IS the fragile-edge sentence, by DELEGATION rather
 * than by re-typing: ROADMAP 2.1004 measured that exact string accepting the
 * named edge 3/3 in plain language (and a bare `{action_type:…}` chip 0/3), so
 * a second spelling of it would be a hand-maintained mirror of the one string in
 * this estate with a measured dispatch rate. Byte equality over the whole
 * corpus is pinned by test.
 */
export function composeDisagreementActionPrompt(fromLabel: string, toLabel: string): string {
  return composeFragileEdgeActionPrompt(fromLabel, toLabel);
}

/**
 * Can T2's CHANGE be composed AND dispatched from this run's producer labels?
 *
 * The same two gates the fragile-edge offer applies to the same string — the
 * prompt must MATCH `EDIT_GRAPH_POSITIVE_REGEX` and must NOT match the
 * `EDIT_GRAPH_NEGATIVE_REGEX` meta-question veto — plus the untruncated-length
 * gate. The veto set is ordinary strategic vocabulary (`flip`, `why`, `compare`,
 * `describe`, `explain`, `show me`, `set up`), so a perfectly reasonable label
 * ("Why Customers Churn", "Set Up Cost") makes the composed prompt un-dispatchable
 * and the action is refused rather than shipped inert (2.770: no inert chips).
 * The CARD still ships — see the module header for why that is a different
 * question with a different answer.
 *
 * ⚠ SCOPE, STATED HONESTLY BECAUSE THE OPPOSITE WAS ONCE WRITTEN HERE'S SIBLING:
 * this covers **2 of `route-v2`'s 5 `editVerbCandidate` conjuncts**. Measured by
 * rebuilding that predicate from the route's own imports over the committed live
 * captures: **2 of 22 capture label pairs** clear this gate and are still refused
 * by the route, via `valueUpdatePhrasingHit` (the label *"Raise Group Operating
 * Profit by 8% Within 18 Months"* is itself value-update phrasing). Those turns
 * fall to the generic LLM router — non-deterministic, not a dead button and not a
 * wrong mutation — and the divergence is **INHERITED, not introduced**: the
 * already-shipped fragile-edge lens composes the identical prompt from the same
 * labels and diverges on exactly the same two pairs. Pinned as an exact set in
 * `compose/__tests__/judgement-offer-action.test.ts` §6. Closing the three
 * uncovered conjuncts, and the fragile-edge lens's own mis-route, are rowed
 * separately and are NOT this lane's.
 */
export function isDisagreementActionComposable(fromLabel: string, toLabel: string): boolean {
  const prompt = composeDisagreementActionPrompt(fromLabel, toLabel);
  if (prompt.length > COACHING_ACTION_PROMPT_MAX) return false;
  return isEditGraphDispatchable(prompt);
}
