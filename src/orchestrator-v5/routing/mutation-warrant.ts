/**
 * ⭐⭐ MUTATION WARRANT — the predicate behind INV-1, the action-layer
 * guarantee "nothing is written to the user's model unless the user asked
 * for a change".
 *
 * WITNESSED (staging CEE `8687a31`, 6 Aug 2026, walk 2.634 §J7 —
 * `PHASE0-EVIDENCE-2026-07-28/walk-2634-findings-2026-08-07.md`): the user
 * typed a pure READ request,
 *
 *   "Open the analysis panel and show me the option comparison"
 *
 * and the assistant EDITED the model — "Added constraint: churn could rise
 * ceiling must be at most 3%.", marked "Applied", with NO confirm chip.
 *
 * ── WHY THE EXISTING CONSENT MACHINERY DID NOT CATCH IT ───────────────────
 * `mutation-consent.ts` detects WITHHELD consent — the user saying *do not
 * apply this yet*. On a read request the user says no such thing, so it
 * correctly stands down. Traced at `8687a311`, constraint writes were inside
 * NO consent regime at all:
 *   · Sonnet tool-use routing (`tool_choice:"auto"`) may emit an execute-class
 *     `add_constraint` on any utterance;
 *   · the D1 lifecycle validates then executes immediately — there is no hold;
 *   · the Graph-Management referee's op vocabulary structurally cannot hold
 *     `add_constraint`.
 * No guard anywhere asked the AFFIRMATIVE question: *did the user request a
 * change at all?* This module is that question.
 *
 * ── WHAT THIS MODULE IS AND IS NOT ────────────────────────────────────────
 * A PURE PREDICATE over the turn's own INGRESS — the user's message, the
 * chip they clicked, and whether the turn is resuming a proposal they already
 * confirmed. It has no opinion about routing, handlers or graphs. Its output
 * is consumed by the turn-executor at the ACTION layer, which is where the
 * guarantee lives: a warrantless mutating proposal is DEMOTED to the
 * propose-confirm channel (chip + pending) rather than executed, and the
 * graph commit chokepoint strips a handler mutation from such a turn as a
 * second, list-free backstop. **Response wording enforces nothing.**
 *
 * Deliberately evaluable BEFORE any model call, for the same reason
 * `detectWithheldConsent` is: the guarantee cannot depend on what the model
 * decides, because on the witnessed turn the model decided to mutate.
 *
 * ── FAIL-SAFE DIRECTION (⚠ INVERTED RELATIVE TO WITHHELD CONSENT) ─────────
 * Read this before adding a pattern. For `detectWithheldConsent` a false
 * POSITIVE is cheap, so its judgement calls resolve toward withholding. Here
 * the polarity flips:
 *
 *   false NEGATIVE (no warrant found, user did want the change)
 *       → the change is OFFERED as a chip. Costs one click.
 *   false POSITIVE (warrant found, user did not ask for a change)
 *       → the model is silently rewritten. This is the witnessed defect.
 *
 * So every judgement call below resolves toward NOT granting, and every
 * pattern demands BOTH a deontic frame ("keep", "must", "limit", "can't
 * exceed") AND a number. A merely DESCRIPTIVE sentence about a bound —
 * "there's about a 70% chance churn stays below 3%" — is a forecast, not an
 * instruction, and must not grant. That exact utterance is in the negative
 * corpus.
 *
 * ── WHY THERE IS A HAND-WRITTEN CORPUS (CLAUDE.md trap 12d) ───────────────
 * `MUTATION_SIGNAL_PATTERNS` in `analytical-intent.ts` is the canonical
 * mutation-shape list, and it was SHORT: it recognises "set X to N" and "add
 * a Y" but no constraint phrasing at all, so "Keep churn below 3%." carried
 * no signal. A guard derived from that list would have agreed with it
 * perfectly and still missed every constraint the product can write. The
 * corpus in `__tests__/mutation-warrant.test.ts` is hand-written, carries
 * both directions, and is what notices the list is short. The UNION
 * assertion there is the derived half: everything the canonical list
 * recognises must also grant a warrant, so the two can never fork.
 */

import { hasMutationSignal } from './analytical-intent.js';
import { isAnalyticalQuestion } from './analytical-question-guard.js';
import { isStateQueryQuestionShape } from './state-query-guard.js';
import {
  EDIT_GRAPH_POSITIVE_REGEX,
  EDIT_GRAPH_NEGATIVE_REGEX,
} from '../../orchestrator/routing/edit-graph-intent-regex.js';

/**
 * Constraint-shaped mutation phrasings the canonical
 * `MUTATION_SIGNAL_PATTERNS` does not carry.
 *
 * ⚠ EVERY PATTERN REQUIRES A DEONTIC FRAME **AND** A DIGIT. Dropping either
 * requirement flips this module's fail-safe direction (see the header): a
 * bare `stays below` would grant a warrant on "there's a 70% chance churn
 * stays below 3%", which is the calibration forecast #831 and ROADMAP 2.627
 * exist to keep OUT of the write path.
 *
 * Kept as a separate export rather than appended to
 * `MUTATION_SIGNAL_PATTERNS` deliberately: that list has six read-side
 * consumers (run-comparison, stale-rerun, vague-edit, post-analysis-label,
 * no-analysis, post-analysis-advice) whose short-circuit behaviour inverts on
 * a mutation hit, and widening it would change all six at once for reasons
 * none of them asked for. The union assertion in the spec keeps this list a
 * strict SUPERSET, which is the only relationship the warrant needs.
 */
export const CONSTRAINT_MUTATION_SIGNAL_PATTERNS: readonly RegExp[] = [
  // "Keep churn below 3%." · "Hold spend under 50k." · "Maintain uptime above 99%."
  /\b(?:keep|hold|maintain)\b[^.?!\n]{0,60}\b(?:below|under|above|over|beneath|beyond|at\s+or\s+(?:below|above)|within)\b[^.?!\n]{0,24}\d/i,
  // "Churn must be at most 3%." · "It has to be at least 1%." · "must stay under 3%"
  /\b(?:must|should|needs?\s+to|has\s+to|have\s+to)\b[^.?!\n]{0,40}\b(?:at\s+most|at\s+least|no\s+more\s+than|no\s+less\s+than|no\s+higher\s+than|no\s+lower\s+than|below|under|above|over|beneath)\b[^.?!\n]{0,24}\d/i,
  // "Churn can't exceed 3%." · "must not go above 3%" · "shouldn't rise above 3%"
  /\b(?:can(?:'|’)?t|cannot|can\s+not|must\s+not|mustn(?:'|’)?t|should\s+not|shouldn(?:'|’)?t|won(?:'|’)?t|may\s+not)\b[^.?!\n]{0,24}\b(?:exceed|surpass|go\s+(?:above|below|over|under|past)|rise\s+(?:above|over|past)|fall\s+below|drop\s+below|climb\s+(?:above|over))\b[^.?!\n]{0,24}\d/i,
  // "Limit churn to 3%." · "Cap spend at 50k." · "Constrain churn to 3%."
  /\b(?:limit|cap|restrict|constrain|bound|ceiling|floor)\b[^.?!\n]{0,60}\b(?:to|at|of)\b[^.?!\n]{0,24}\d/i,
  // "Make sure churn stays below 3%." · "Ensure uptime remains above 99%."
  /\b(?:make\s+sure|ensure|guarantee)\b[^.?!\n]{0,60}\b(?:stays?|remains?|sits?|is|are)\b[^.?!\n]{0,40}\b(?:below|under|above|over|beneath|at\s+or\s+(?:below|above))\b[^.?!\n]{0,24}\d/i,
  // "Don't let churn rise above 3%." · "Never let spend exceed 50k."
  /\b(?:do\s*n(?:o|')?t|don\s*'?\s*t|do\s+not|never)\s+(?:let|allow)\b[^.?!\n]{0,60}\b(?:exceed|surpass|go\s+(?:above|below|over|under)|rise\s+(?:above|over)|fall\s+below|drop\s+below|get\s+(?:above|below))\b[^.?!\n]{0,24}\d/i,
  // Bare imperative constraint: "No more than 3% churn." · "At most 3% churn."
  /^\s*(?:no\s+(?:more|less|higher|lower)\s+than|at\s+most|at\s+least|up\s+to)\b[^.?!\n]{0,40}\d/im,
  // ⭐ THE CONVERSATIONAL CONSTRAINT — how users actually state a bound in
  // chat, and the shape the repo's OWN journey fixtures use:
  //   "We can't spend more than £50,000 on marketing."
  //   "Yes, we don't want to spend more than £50k on this."
  // A negated capability/desire plus a comparative bound plus a number. It is
  // an instruction, not a report, because of the negation — "we spent more than
  // £50k" carries no negation and does not match.
  /\b(?:do\s*n(?:o|')?t|don\s*'?\s*t|do\s+not|never|can(?:'|’)?t|cannot|can\s+not|won(?:'|’)?t|will\s+not|must\s+not|mustn(?:'|’)?t)\b[^.?!\n]{0,60}\b(?:more|less|higher|lower|greater|bigger|smaller)\s+than\b[^.?!\n]{0,24}[£$€]?\s?\d/i,
];

/**
 * Does the message carry a CONSTRAINT-shaped mutation instruction? Narrow by
 * construction — see the fail-safe note above.
 */
export function hasConstraintMutationSignal(message: string): boolean {
  if (typeof message !== 'string') return false;
  for (const re of CONSTRAINT_MUTATION_SIGNAL_PATTERNS) {
    if (re.test(message)) return true;
  }
  return false;
}

/**
 * Edit verbs the V5 mutating handlers serve that `EDIT_GRAPH_POSITIVE_REGEX`
 * does not carry — because that regex gates the STRUCTURAL edit_graph lane,
 * whose vocabulary is add/remove/rename, while these three handlers also serve
 * strength and intervention edits.
 *
 * ⚠ MEASURED, not guessed. Each entry is here because a real request in the
 * repo's own behavioural suite carries it and would otherwise cost the user a
 * chip click on a change they plainly asked for:
 *   strengthen/weaken  ← "strengthen the link from marketing budget to revenue"
 *   make X strong(er)  ← "Make the marketing budget effect on revenue strong"
 *   revise / configure ← "revise the Launch now option so its churn ... is lower",
 *                         "Help me configure Launch now."
 *   reduces / raises … ← "Launching reduces Customer churn to 2%" (the third-person
 *                         inflections `\breduce\b` misses)
 *   "X is now N"       ← "Customer churn is now 2%" — the DECLARATIVE value answer,
 *                         which is the affordance this product explicitly asks for
 *                         ("where does churn currently sit?"). Kept narrow: it
 *                         requires a copula, a nowness marker AND a number, so a
 *                         forecast ("a 70% chance churn stays below 3%") does not
 *                         match — that sentence is in the negative corpus.
 */
const WARRANT_EXTRA_EDIT_VERB_PATTERNS: readonly RegExp[] = [
  /\b(?:strengthen|strengthens|weaken|weakens|rename|renames|relabel|revise|revises|configure|configures)\b/i,
  /\bmake\b[^.?!\n]{0,80}\b(?:strong|stronger|strongest|weak|weaker|higher|lower|bigger|smaller|negative|positive)\b/i,
  /\b(?:reduces|increases|decreases|raises|lowers|changes|updates|adjusts|sets|removes|deletes|adds)\b/i,
  /\b(?:is|are|sits|sat|stands|runs)\s+(?:now|currently|at|about|around|roughly|approximately)\s+[-+]?[£$€]?\s?\d/i,
];

/**
 * The message half of the warrant: does the user's own text ask for a change?
 *
 * ⭐ THE UNION IS THE POINT, AND THE THIRD TERM IS WHERE THE PARITY LIVES.
 *
 *  1. `hasMutationSignal` — the canonical concrete-edit list ("set X to N",
 *     "add a Y"). Included wholesale so the two predicates cannot fork.
 *  2. `hasConstraintMutationSignal` — the constraint phrasings above, which
 *     term 1 carries none of.
 *  3. THE PRODUCT'S OWN EDIT-INTENT DOOR: the exact predicate
 *     `orchestrator/route-v2.ts` uses to decide whether a message is an edit
 *     request at all (`EDIT_GRAPH_POSITIVE_REGEX && !EDIT_GRAPH_NEGATIVE_REGEX`,
 *     minus the analytical-question and state-query suppressors it also
 *     applies), plus the verb extension above.
 *
 * ⚠ WHY TERM 3 RATHER THAN A LONGER BESPOKE LIST — this IS the consent parity
 * the fix is named for. The Graph-Management channel has always asked this
 * question at its door; the executor asked nothing, which is why the walk's
 * read request could reach a write there and not there. Reusing the same
 * predicate makes the two doors ask the same question by construction instead
 * of by a second list somebody has to remember to sync (CLAUDE.md trap 12), and
 * it inherits that regex's hardening against read markers — `EDIT_GRAPH_NEGATIVE_REGEX`
 * already excludes "show me", "explain", "compare", "tell me", "describe",
 * "why", "how does", "what would", which is the entire read vocabulary the walk
 * exercised.
 *
 * ⚠ WHAT TERM 3 DELIBERATELY DOES NOT SUBTRACT: route-v2 also suppresses on
 * `shouldSuppressEditDispatchForValueUpdate`. That is a ROUTING suppressor — it
 * sends "set X to N" down the deterministic D1 path INSTEAD of edit_graph — not
 * a judgement that the message is not an edit. Subtracting it here would strip
 * the warrant from the most unambiguous edit requests the product accepts.
 *
 * The result is a strict superset of `hasMutationSignal`; the union assertion
 * in the spec pins that, so the canonical list can never recognise an edit this
 * predicate refuses.
 */
export function hasMutationWarrantSignal(message: string): boolean {
  if (typeof message !== 'string' || message.trim().length === 0) return false;
  if (hasMutationSignal(message)) return true;
  if (hasConstraintMutationSignal(message)) return true;
  return isEditRequestShape(message);
}

/**
 * Term 3 of the warrant union — the product's own edit-intent door.
 * Exported so the spec can assert it against the SAME regexes route-v2 uses
 * rather than against a copy of them.
 */
export function isEditRequestShape(message: string): boolean {
  if (typeof message !== 'string' || message.trim().length === 0) return false;
  const carriesEditVerb =
    EDIT_GRAPH_POSITIVE_REGEX.test(message) ||
    WARRANT_EXTRA_EDIT_VERB_PATTERNS.some((re) => re.test(message));
  if (!carriesEditVerb) return false;
  // The read-marker guard and the two question-shape suppressors, in the same
  // combination route-v2 applies at the edit_graph door.
  if (EDIT_GRAPH_NEGATIVE_REGEX.test(message)) return false;
  if (isAnalyticalQuestion(message)) return false;
  if (isStateQueryQuestionShape(message)) return false;
  return true;
}

/**
 * Which of the three ratified sources authorised this turn to mutate.
 *
 *  - `message_signal`      — the user's own words carry a mutation instruction.
 *  - `typed_mutation_chip` — the user clicked a chip whose WIRE TYPE is a
 *                            mutation (`chip.action_type` ∈ the mutation
 *                            action types). A click on a typed mutation chip
 *                            IS the request; there is no text to read.
 *  - `confirm_resume`      — the turn is resuming a proposal or held op the
 *                            user already confirmed. The warrant was given on
 *                            the turn that emitted it.
 *
 * A plain-message chip (no `action_type`) is NOT a source in its own right:
 * it replays a MESSAGE through the ordinary pipeline, so it is judged by
 * `message_signal` like anything else. That is deliberate and load-bearing —
 * the calibration confirm chip ("Use 70%") replays "Set <factor> to 70%.",
 * which carries a mutation signal, so the calibration flow keeps working
 * through the message half rather than through a blanket chip exemption.
 */
export type MutationWarrantSource =
  | 'message_signal'
  | 'typed_mutation_chip'
  | 'confirm_resume';

export type MutationWarrant =
  | { readonly granted: false }
  | { readonly granted: true; readonly source: MutationWarrantSource };

/**
 * The turn ingress the warrant is derived from. Everything here is known
 * before the model is consulted.
 */
export interface MutationWarrantInput {
  /** The user's message text. */
  readonly message: string;
  /** `payload.source` — 'composer' | 'chip' | 'chip_click' | 'retry'. */
  readonly turnSource: string | undefined;
  /** `payload.chip?.action_type` — the chip's WIRE TYPE, not its copy. */
  readonly chipActionType: string | undefined;
  /**
   * True when this turn resumed a pending action / held proposal the user
   * confirmed. Derived by the caller from the executor's own
   * `consumedPendingAction`, never guessed from text.
   */
  readonly isConfirmResume: boolean;
}

/**
 * The V5 chip `action_type` values that are themselves mutations. Imported
 * shape rather than re-listed: `typed-chip-mutation-proposal.ts` is the
 * CEE-side authority for which typed chips carry an edit spec, and the
 * manifest spec asserts this set and `GRAPH_MUTATING_HANDLER_IDS` agree.
 */
export function isMutationChipActionType(
  actionType: string | undefined,
  mutationActionTypes: ReadonlySet<string>,
): boolean {
  return actionType !== undefined && mutationActionTypes.has(actionType);
}

/**
 * Did this turn carry an affirmative warrant to mutate the graph?
 *
 * Order is evidential, not preferential: a confirm-resume is the strongest
 * claim (the user clicked confirm on a change we showed them), then a typed
 * mutation chip (the click IS the instruction), then the message text.
 */
export function detectMutationWarrant(
  input: MutationWarrantInput,
  mutationActionTypes: ReadonlySet<string>,
): MutationWarrant {
  if (input.isConfirmResume) {
    return { granted: true, source: 'confirm_resume' };
  }
  const isChipTurn = input.turnSource === 'chip_click' || input.turnSource === 'chip';
  if (isChipTurn && isMutationChipActionType(input.chipActionType, mutationActionTypes)) {
    return { granted: true, source: 'typed_mutation_chip' };
  }
  if (hasMutationWarrantSignal(input.message)) {
    return { granted: true, source: 'message_signal' };
  }
  return { granted: false };
}

/**
 * The demotion reply: a mutating proposal arrived on a turn the user never
 * asked to change anything, so it is OFFERED rather than applied.
 *
 * Composed HERE rather than by the model, for the same reason the
 * withheld-consent copy is: on the witnessed turn the model narrated an
 * "Applied" receipt for a change the user had not requested. A string built
 * from a template cannot narrate.
 *
 * It states the outcome in the FIRST clause. "Nothing has been changed" is
 * true by construction at this point — control has not reached a handler.
 *
 * ── INV-2 (ROADMAP 2.659 rider) ───────────────────────────────────────────
 * `residualDisclosure` carries the second sentence for the REPAIR shape: the
 * `add_constraint` idempotency key is `(node_id, operator)`, so a proposal
 * whose operator differs from an existing constraint on the same node CANNOT
 * update it — it can only append, leaving the defective row in place. The
 * walk witnessed exactly that (one unevaluable constraint became two, both
 * blamed on "conditions you set"). Where the product cannot repair, it must
 * SAY SO rather than let the user believe the old row is gone. The
 * remove/replace capability itself is ROADMAP 2.659, not this fix.
 */
export function buildMutationWarrantDemotionText(
  changeDescription: string,
  residualDisclosure: string | null,
): string {
  const opening =
    `Nothing has been changed. You did not ask me to edit the model, ` +
    `so I have not — but ${changeDescription} looks like it would help. ` +
    `Say the word and I will make it.`;
  return residualDisclosure === null ? opening : `${opening} ${residualDisclosure}`;
}

/**
 * The INV-2 residual sentence, when a proposed constraint cannot replace the
 * one already on the same node.
 *
 * Deliberately names what SURVIVES, not what is added: the user's complaint
 * in the walk was not that a constraint appeared, it was that the broken one
 * stayed and nothing said so.
 */
export function buildResidualConstraintDisclosure(existingLabel: string | null): string {
  const subject =
    existingLabel === null || existingLabel.trim().length === 0
      ? 'the limit already on that factor'
      : `"${existingLabel.trim()}"`;
  return (
    `Note that this would be a second limit: I cannot yet change or remove ` +
    `${subject}, so it would stay in place alongside the new one.`
  );
}
