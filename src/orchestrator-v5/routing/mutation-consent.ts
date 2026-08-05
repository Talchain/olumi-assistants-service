/**
 * ⭐ WITHHELD-CONSENT DETECTION — the predicate behind the action-layer
 * guarantee "if the user said do not apply it yet, nothing is applied".
 *
 * WITNESSED (staging CEE `e82738b2`, 5 Aug 2026, independent
 * simulated-user review §2.1): the user wrote
 *
 *   "...Please set that estimate and show me the number you will use
 *    before applying it."
 *
 * and the turn applied a factor mutation anyway; the follow-up
 *
 *   "...Do not change the graph until I confirm."
 *
 * was answered with "The model is unchanged so far." — after the change
 * had already been written.
 *
 * ── WHAT THIS MODULE IS AND IS NOT ────────────────────────────────────
 * This is a PURE PREDICATE over the user's own words. It has no opinion
 * about routing, handlers, or graphs. Its output is consumed by the
 * turn-executor at the ACTION layer, which is where the guarantee lives:
 * a `withheld` turn does not reach any mutating handler, and the graph
 * commit chokepoint refuses a handler mutation on such a turn as a
 * second, list-free backstop. **Response wording enforces nothing.**
 *
 * ── FAIL-SAFE DIRECTION ───────────────────────────────────────────────
 * A false POSITIVE costs the user one extra confirmation on a change
 * they wanted. A false NEGATIVE silently rewrites the model they
 * believe they are reviewing, and then denies it. Every judgement call
 * below is resolved toward withholding.
 *
 * ── WHY IT IS NOT A "DOES IT SAY DON'T" REGEX ─────────────────────────
 * The corpus in `__tests__/mutation-consent.test.ts` is hand-written and
 * carries both directions, including the traps: "apply it" and "go
 * ahead and apply that" must NOT withhold, or a user could never
 * confirm anything (CLAUDE.md trap 12d — a derived guard proves
 * agreement, only a corpus notices the list is wrong).
 */

/**
 * The V5 handler ids that can move `scenarios.graph`.
 *
 * ⚠ THIS IS A LIST, AND A LIST IS THE ESTATE'S DOMINANT DEFECT (CLAUDE.md
 * trap 12). Two things stop it drifting:
 *
 *  1. `__tests__/graph-mutating-handler-ids.test.ts` DERIVES the true set by
 *     reading which handler modules import `applyAndValidateMutation` (the
 *     single in-memory mutation chokepoint) and asserts equality. A new
 *     mutating handler turns that test RED on the day it is written.
 *  2. The guarantee does not actually depend on this list being right — the
 *     commit-closure backstop in turn-executor strips the graph from ANY
 *     commit on a withheld turn, with no handler ids involved at all. This
 *     set exists so the RESPONSE is honest (we refuse before running the
 *     handler rather than silently discarding its work), not so the
 *     property holds.
 *
 * NOT included: `edit_graph`. It is a system-layer dispatch outside
 * `runTurnExecutor`'s STEP 3, and it already has a consent mechanism of its
 * own — the Graph-Management referee, which HOLDS every structural op and
 * demotes `would_apply` to `held` for user-protected entities
 * (`graph-management/protection-scope.ts`). Adding it here would collide
 * with that lane, not reinforce it.
 */
export const GRAPH_MUTATING_HANDLER_IDS: ReadonlySet<string> = new Set([
  'set_factor_value',
  'add_constraint',
  'adjust_edge_strength',
]);

export type ConsentRule =
  /** "show me ... before applying", "before you apply", "before it is applied" */
  | 'show_before_applying'
  /** "do not apply/change/set ... until I confirm" */
  | 'not_until_confirmed'
  /** "don't apply anything yet", "hold off applying" */
  | 'not_yet';

export type ConsentDirective =
  | { readonly withheld: false }
  | { readonly withheld: true; readonly rule: ConsentRule; readonly matched: string };

/**
 * ⚠ THERE IS DELIBERATELY NO "IT LOOKS LIKE A CONFIRMATION" OVERRIDE, and
 * the reason is a defect this module's own corpus caught during
 * development.
 *
 * The first version checked for an affirmative ("yes", "go ahead",
 * "apply it") BEFORE the withhold rules and returned `withheld: false` on
 * a hit. It then read
 *
 *   "Raise the budget to £50k, but tell me the number before you apply it."
 *
 * as a CONFIRMATION, because the trailing "apply it" matched — i.e. the
 * override inverted the very sentence the module exists to honour. The
 * corpus in `__tests__/mutation-consent.test.ts` turned RED on it; nothing
 * derived could have (CLAUDE.md trap 12d).
 *
 * The rules below are specific enough that a bare confirmation matches
 * none of them (proved by the corpus's negative direction), and a message
 * that BOTH confirms and holds must hold — that is the fail-safe
 * direction. So the override has no job left to do, and an override with
 * no job is the next false negative.
 */
const NEGATION = String.raw`(?:do\s*n(?:o|')t|don\s*'?\s*t|do\s+not|please\s+do\s+not|please\s+don\s*'?\s*t|never)`;
const MUTATE_VERB = String.raw`(?:apply|appl(?:y|ies)|change|changing|set|update|updating|modify|alter|touch|edit|write|commit|save)`;

/**
 * "show me the number you will use before applying it"
 * "show me before you apply it"
 * "tell me the value before it is applied"
 * "let me see it before applying"
 */
const SHOW_BEFORE_APPLYING =
  /\b(?:show|tell|give|let)\s+me\b[\s\S]{0,120}?\bbefore\b[\s\S]{0,40}?\b(?:appl(?:y|ying|ied)|chang(?:e|ing)|updat(?:e|ing)|set(?:ting)?\s+it|commit(?:ting)?)\b/i;

/** "before applying", "before you apply", "before it is applied" — anywhere. */
const BARE_BEFORE_APPLYING =
  /\bbefore\s+(?:you\s+|it\s+is\s+|they\s+are\s+|anything\s+is\s+)?appl(?:y|ying|ied)\b/i;

/**
 * "Do not change the graph until I confirm."
 * "Don't apply anything until I confirm."
 * "Do not apply until I say so."
 */
const NOT_UNTIL_CONFIRMED = new RegExp(
  `\\b${NEGATION}\\s+${MUTATE_VERB}\\b[\\s\\S]{0,80}?\\b(?:until|unless)\\b[\\s\\S]{0,40}?\\b(?:i\\s+(?:confirm|say|approve|agree|ok)|confirmed|you\\s+have\\s+my\\s+ok)\\b`,
  'i',
);

/** "Do not apply anything yet." / "Hold off applying." / "Don't apply it yet." */
const NOT_YET = new RegExp(
  `\\b${NEGATION}\\s+${MUTATE_VERB}\\b[\\s\\S]{0,60}?\\byet\\b|\\bhold\\s+off\\b[\\s\\S]{0,40}?\\b${MUTATE_VERB}`,
  'i',
);

const RULES: ReadonlyArray<readonly [ConsentRule, RegExp]> = [
  ['show_before_applying', SHOW_BEFORE_APPLYING],
  ['show_before_applying', BARE_BEFORE_APPLYING],
  ['not_until_confirmed', NOT_UNTIL_CONFIRMED],
  ['not_yet', NOT_YET],
];

/**
 * Did the user withhold consent to apply anything this turn?
 *
 * Deterministic and message-only by design: it must be evaluable BEFORE
 * any model call, because the guarantee cannot depend on what the model
 * decides — on the witnessed turn the model decided to route a mutation
 * and to describe its own reasoning to the user.
 */
export function detectWithheldConsent(message: string): ConsentDirective {
  if (typeof message !== 'string' || message.trim().length === 0) {
    return { withheld: false };
  }

  for (const [rule, pattern] of RULES) {
    const hit = pattern.exec(message);
    if (hit !== null) {
      return { withheld: true, rule, matched: hit[0] };
    }
  }
  return { withheld: false };
}

/**
 * The generic withheld-consent reply, for a mutating turn that carries no
 * recognised probability phrase (the calibration path composes its own,
 * richer copy in `calibration-semantics.ts`).
 *
 * Composed HERE rather than by the model, for the same reason the
 * calibration copy is: on the witnessed turn the model's own routing
 * deliberation was rendered into the reply. A string built from a template
 * cannot carry deliberation.
 *
 * It states the outcome in the FIRST clause. "Nothing has been changed" is
 * true by construction at this point — control has not reached a handler —
 * which is the difference between this sentence and the witnessed "The
 * model is unchanged so far."
 */
export function buildConsentWithheldText(targetLabel: string | null): string {
  const target = targetLabel === null ? 'anything' : targetLabel;
  return (
    `Nothing has been changed — you asked to see this before it is applied. ` +
    `Tell me to go ahead and I will make the change to ${target}, ` +
    `or give me a different value.`
  );
}
