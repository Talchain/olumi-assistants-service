/**
 * ⭐ THE SCALE ASK — "you typed 8 on a factor framed at 100,000; did you mean
 * 8, or 8 thousand?"
 *
 * ── THE QUESTION THIS MODULE ANSWERS, AND THE ONES IT DOES NOT ─────────────
 * Paul ruled this class on 2026-09-07: a bare value >= 1, no `raw_value`, no
 * `unit`, on a capless factor with a resolvable `scale_frame`. Two shipped
 * behaviours disagreed — #1280 (merged, deployed) accepted it as a raw amount
 * and divided by the frame; #1272 refused it as ambiguous. His answer was
 * NEITHER: **refuse and ask.** Guessing produces the harm he reported — a
 * number you set becoming something you did not mean — and blocking leaves no
 * route forward. Asking leaves the user holding their own number.
 *
 * ⚠ IT IS A DIFFERENT QUESTION FROM EVERY NEIGHBOURING ONE, AND THEY MUST NOT
 * BE MERGED (CLAUDE.md trap 21 — two questions under one name is this estate's
 * signature defect; the sibling seams below are cited as PRECEDENT, not as a
 * home):
 *   · `compound-goal/direction-gate.ts` → "which WAY does this limit point?"
 *     (floor or ceiling), asked of a BRIEF-extracted constraint at draft time.
 *   · `scale-frame.ts`'s `checkPairCoherence` → "do this factor's own two
 *     carriers CONTRADICT each other?" — an assertion about stored records.
 *   · the existing `scale_ambiguous` sub-1 guard → "is this number a
 *     model-scale PROPORTION or an amount?" — a question about BASIS.
 *   · this module → "WHICH MAGNITUDE of amount did you mean?" — the basis is
 *     settled (a value >= 1 cannot be a unit-interval proportion); only the
 *     multiplier is open.
 * The direction gate is the ratified precedent for the SHAPE of the answer —
 * it was adopted after a four-round oscillation proved no predicate-only rule
 * could settle an ambiguous case, and its ruling is the one applied here:
 * where the reading cannot be determined, ASK rather than guess.
 *
 * ── HOW THE ANSWER GETS BACK, AND WHY THERE IS NO PENDING ACTION ───────────
 * ⚠⚠ THE DETERMINISTIC RESUMER CANNOT CARRY THIS ASK, AND USING IT WOULD
 * REBUILD THE DEAD END THE RULING EXISTS TO REMOVE. `tryClarificationResume`
 * selects among live `set_factor_value` pendings BY FACTOR LABEL
 * (`routing/clarification-resume.ts` — exact, then substring, then fuzzy
 * bigram). Every option here is a different magnitude for THE SAME FACTOR, so
 * two pendings would carry ONE label, both would match any message naming it,
 * `pickFrom.length > 1` would return `recovery_label_ambiguous`, and the
 * product would answer the user's choice with another question. That resumer
 * answers "WHICH FACTOR did you mean?"; this ask is "which MAGNITUDE for this
 * factor?" — the same trap-21 distinction one layer down.
 *
 * So the answer rides the channel that is already deployed for exactly this
 * shape: the refusal's `suggested_actions` chips, whose `message` is replayed
 * as an ordinary turn and resolved by the ordinary edit path — where
 * `MAGNITUDE_MULTIPLIERS` is already the canonical authority on "8 thousand".
 * The chip states the amount in FULL DIGITS, so the replay is unambiguous
 * without depending on that parse at all.
 *
 * ⭐ AND THE NON-CLAIMABILITY IS A SAFETY PROPERTY, NOT AN ACCIDENT. Because
 * every message here contains a digit, `isClaimableByClarificationResume`
 * (whose `EDIT_VERB_OR_QUANTITY_PATTERN` includes `\d`) rejects all of them —
 * so an UNRELATED live `set_factor_value` pending on the same factor (a stale
 * "extend the scale" chip, say) can never claim this click and apply its own
 * value in place of the user's choice. That would be the exact harm the ruling
 * names. It is pinned by a test rather than left to the pattern's goodwill.
 *
 * Pure, total, no I/O.
 */

import { MAGNITUDE_WORD_LADDER } from '../../utils/magnitude-alphabet.js';
import { formatFactorValue, thousands } from '../compose/format-factor-value.js';
import type { SuggestedAction } from '../compose/types.js';

/**
 * The most readings offered at once.
 *
 * Three is the readable ceiling for a choice the user has to make about their
 * own number, and it matches `PENDING_ACTIONS_PER_TURN_CAP`'s judgement about
 * how many follow-ups one turn may carry. The literal reading always occupies
 * one of the slots (see {@link buildScaleAskOptions}), so at most two magnitude
 * rungs are ever shown.
 */
export const SCALE_ASK_MAX_OPTIONS = 3;

/** One candidate reading of the number the user typed. */
export interface ScaleAskOption {
  /** The multiplier applied to the typed value. `1` is the literal reading. */
  readonly multiplier: number;
  /** The magnitude word (`thousand`), or `null` for the literal reading. */
  readonly word: string | null;
  /** The number the user actually typed, before the multiplier. */
  readonly typedValue: number;
  /** The resulting amount: `value * multiplier`. */
  readonly amount: number;
  /** How the option reads to a person: `8` / `8 thousand`. */
  readonly optionText: string;
  /** The amount in full digits, comma-grouped: `8` / `8,000`. */
  readonly amountText: string;
}

/**
 * Render an amount for a person.
 *
 * ⚠ `thousands` IS INTEGER-ONLY BY CONTRACT — its own header records that it
 * groups the whole string, so `3.14159` becomes `3.14,159` (a comma inside the
 * FRACTION). Every existing caller passes an integer. A framed factor can
 * carry a non-integer amount, so the integer test is a precondition here, not
 * a nicety: without it this function would print a corrupted number back to the
 * user inside a question about a number being corrupted.
 */
function renderAmount(amount: number): string {
  return Number.isInteger(amount) ? thousands(amount) : String(amount);
}

/**
 * ⭐ THE CANDIDATE READINGS OF A BARE NUMBER ON A FRAMED FACTOR.
 *
 * The literal reading is ALWAYS offered and always leads. It is what #1280
 * ships today, and removing it would take away the user's ability to mean the
 * thing the deployed product currently assumes they meant — a ruling that says
 * "ask" must not quietly become a different guess.
 *
 * ⚠ THE FILTER IS THE FACTOR'S OWN FRAME, NOT A JUDGEMENT ABOUT THE USER'S
 * NUMBER. A rung is offered only when `|value| * multiplier <= frame`, i.e.
 * when the resulting amount is one the factor can actually hold. This is
 * deliberately NOT the "threshold based on the size of the user's number" that
 * #1272's scope limits ruled out: it reads the factor's persisted `scale_frame`
 * and nothing else, and its purpose is to avoid offering a control that the
 * downstream write would refuse — a dead chip is worse than a shorter question,
 * because it teaches the user the ask does not work.
 *
 * Ascending, so the question reads "8, or 8 thousand?" — smallest first, which
 * is the order the literal-then-magnified reading is naturally spoken in.
 */
export function buildScaleAskOptions(input: {
  readonly value: number;
  readonly frame: number;
}): readonly ScaleAskOption[] {
  const { value, frame } = input;
  if (!Number.isFinite(value) || !Number.isFinite(frame)) return [];
  const magnitude = Math.abs(value);
  if (!(magnitude >= 1)) return [];

  const literal: ScaleAskOption = {
    multiplier: 1,
    word: null,
    typedValue: value,
    amount: value,
    optionText: renderAmount(value),
    amountText: renderAmount(value),
  };

  // Ascending rungs (the ladder is descending), keeping only amounts the
  // factor's own frame can hold.
  const rungs: ScaleAskOption[] = [];
  for (let i = MAGNITUDE_WORD_LADDER.length - 1; i >= 0; i -= 1) {
    const [multiplier, word] = MAGNITUDE_WORD_LADDER[i]!;
    if (magnitude * multiplier > frame) continue;
    const amount = value * multiplier;
    rungs.push({
      multiplier,
      word,
      typedValue: value,
      amount,
      optionText: `${renderAmount(value)} ${word}`,
      amountText: renderAmount(amount),
    });
  }

  return [literal, ...rungs].slice(0, SCALE_ASK_MAX_OPTIONS);
}

/**
 * THE question, phrased ONCE and surface-agnostic — the same discipline
 * `direction-gate.ts` applies to `composeDirectionChoiceQuestion`, and for the
 * same reason: two call sites (the assistant text and any later elicitation
 * projection) must never drift into asking one thing two ways.
 *
 * ⚠ IT NEVER SAYS THE VALUE WAS KEPT, because it was not — the edit is refused
 * and the graph is untouched. "I haven't changed anything" is the true
 * statement, and it is the sentence the neighbouring refusals on this seam
 * already use.
 */
export function composeScaleAskQuestion(options: readonly ScaleAskOption[]): string {
  const texts = options.map((o) => o.optionText);
  if (texts.length < 2) return '';
  const last = texts[texts.length - 1]!;
  const head = texts.slice(0, -1).join(', ');
  return `Did you mean ${head} or ${last}?`;
}

/**
 * The chip id for one reading. Stable and derived from the magnitude WORD, so
 * the id set is a pure function of the alphabet — a rung added upstream cannot
 * collide with an existing chip, and no id list is maintained by hand.
 */
export function scaleAskChipId(option: ScaleAskOption): string {
  const discriminator = option.word ?? 'as_typed';
  return `chip_prompt_scale_ask_${discriminator}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

/**
 * The chips that carry the readings back.
 *
 * ⚠ THE MESSAGE STATES THE AMOUNT IN FULL DIGITS (`8,000`), NOT THE SPOKEN
 * FORM (`8 thousand`). The spoken form is the LABEL — what the user reads —
 * and the digits are the MESSAGE — what the product re-reads. Both are honest
 * renderings of one option, but only the digits are independent of the
 * magnitude parse succeeding on the replay, and the whole point of this ask is
 * that a magnitude reading was in doubt.
 *
 * ⚠ AND THE MESSAGE NAMES THE FACTOR because the replay is an ordinary turn
 * with no memory of which factor was being edited. The label is the caller's
 * (the node's own display label), never an id.
 */
export function buildScaleAskChips(input: {
  readonly options: readonly ScaleAskOption[];
  readonly factorLabel: string;
  readonly unit?: string | undefined;
}): readonly SuggestedAction[] {
  const { options, factorLabel, unit } = input;
  // ⭐ UNIT PLACEMENT IS THE ESTATE'S, NOT THIS MODULE'S. `formatFactorValue`
  // already knows that currency PREFIXES (`£8,000`), percent SUFFIXES (`12%`),
  // and time units pluralise — a private `${amount} ${unit}` here would render
  // the ruled example as "8,000 £", which is not how anyone writes money. It
  // returns null for a non-integer or a sub-1 amount, so the unitless digits
  // remain the honest fallback rather than a rounded lie.
  const render = (amount: number): string =>
    formatFactorValue(amount, unit)?.display ?? renderAmount(amount);
  return options.map((option) => {
    const spoken = option.word === null
      ? render(option.typedValue)
      : `${render(option.typedValue)} ${option.word}`;
    return {
      id: scaleAskChipId(option),
      label: spoken,
      message: `Set ${factorLabel} to ${render(option.amount)}.`,
    };
  });
}
