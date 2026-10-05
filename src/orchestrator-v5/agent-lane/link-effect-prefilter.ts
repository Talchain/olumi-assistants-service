/**
 * ⭐ THE RECORDER BY CARD (RT-6, red team #87 5992627435; HARNESS INTEGRATION lease 5992873873; MC's PR-D design,
 * parked #2559, conditions 5 Oct): a user's plain answer to Olumi's own question about a link was refused, 2/2 on
 * staging a4977d9, because a closed list of verbs decides whether the words "state" the effect:
 *   "When footfall lost from price rise goes up by 5%, gross margin falls by about 2 percentage points." → direction_not_stated
 *   "A 5% fall in footfall would cost us about 2 percentage points of gross margin." → direction_contradicts
 * The same rule also PASSES the sign-inverted reading of the second sentence. Words cannot settle which way a link runs.
 *
 * THE CONSENT IS THE CARD (AIQ 5884881500, "proposer, not stamper"; DL ruling on #2235, "Human Control is the provenance
 * gate"): the approval card shows the reading exactly as it will be written (both ends by name, signed figures with
 * units, the user's own sentence), and the writer refuses any other (`reading_token`) or the wrong way round
 * (`sign_conflict`). Words the rule reads are prepared exactly as before. A DIRECTION miss goes to the card only when
 * the estate's existing validators, and no new parser, show the two figures are the user's and that they are stating:
 *   · `statedEffectQuoteMatches`: both typed figures, each with its unit, written exactly once in the quote;
 *   · `figuresWrittenIn`: no more than those two (a second or corrected figure, "8%, no, 6%", is never picked from);
 *   · `linkEffectTheUserStated`'s `question` / `denied` stay refusals: a question or a negation states nothing.
 *   · its binding and source-change checks still run when direction goes to the card: both figures must size THIS effect.
 * ⛔ ONLY THE DIRECTION goes to the card: `direction_not_stated` / `direction_contradicts` (RT-6's two misses). Which way
 * a link runs is what the signed card shows and the writer's sign guard checks against the stored link. Every other miss
 * stays a refusal exactly as before (#2275's five review rounds): an unnamed end, a figure that sizes something else (a
 * budget, today's level), or the effect spread over several sentences means the numbers are not the user's statement of
 * THIS effect, and a card would fabricate their authorship (PL 5992936112 item 5).
 */
import { statedEffectQuoteMatches } from '../../cee/provenance/stated-effect.js';
import { figuresWrittenIn, linkEffectTheUserStated, statingSentenceOf, type LinkEffectStatementMiss } from './stated-by-user.js';

/** The misses the card settles: which way the link runs. */
type CardMiss = 'direction_not_stated' | 'direction_contradicts';
const CARD_MISSES: ReadonlySet<string> = new Set<CardMiss>(['direction_not_stated', 'direction_contradicts']);
type RefusedMiss = Exclude<LinkEffectStatementMiss, 'figures_not_in_statement'>;

type Effect = { readonly amount: number; readonly amount_unit: string; readonly per_source_change: number; readonly per_source_change_unit: string };
type Ends = { readonly source: string; readonly target: string };
type Scope = { readonly quantities: readonly string[] };

export type LinkEffectPrefilter =
  | { readonly kind: 'refused'; readonly refusal: 'not_the_users_figure' | 'not_the_users_statement';
      readonly why: 'figures_not_written' | RefusedMiss; readonly detail: string }
  /** `read_by_rule`: the word rule read the same reading. When false, Olumi read the words and the user must check it. */
  | { readonly kind: 'prepared'; readonly said: string; readonly read_by_rule: boolean };

export function linkEffectPrefilter(quote: string, effect: Effect, ends: Ends, scope: Scope): LinkEffectPrefilter {
  let miss = linkEffectTheUserStated(quote, effect, ends, scope);
  const said = (): string => statingSentenceOf(quote, effect, ends, scope) ?? quote;
  // The word rule read it: prepared exactly as before (nothing served changes).
  if (miss === null) return { kind: 'prepared', said: said(), read_by_rule: true };
  if (miss === 'figures_not_in_statement') {
    return { kind: 'refused', refusal: 'not_the_users_figure', why: 'figures_not_written',
      detail: 'Nothing was prepared: the statement quoted does not write both figures. Ask the user how much the one moves the '
        + 'other, in numbers.' };
  }
  if (miss === 'question') {
    return { kind: 'refused', refusal: 'not_the_users_statement', why: 'question',
      detail: 'Nothing was prepared: the user asked this rather than stated it. Answer their question; a figure is recorded as '
        + 'theirs only when they state it.' };
  }
  if (miss === 'denied') {
    return { kind: 'refused', refusal: 'not_the_users_statement', why: 'denied',
      detail: 'Nothing was prepared: the words quoted deny or correct the effect rather than state it. Ask the user what the '
        + 'effect is, in numbers.' };
  }
  // ⭐ ONLY a DIRECTION miss can go to the card: binding and source-change checks still run, and the shared validator
  // must find both typed figures, each with its unit, written exactly once, and no third figure.
  if (CARD_MISSES.has(miss)) {
    const cardMiss = linkEffectTheUserStated(quote, effect, ends, scope, { directionOnCard: true });
    if (cardMiss === null && statedEffectQuoteMatches(quote, effect) && figuresWrittenIn(quote) <= 2) {
      return { kind: 'prepared', said: quote, read_by_rule: false };
    }
    miss = cardMiss ?? miss;
  }
  return { kind: 'refused', refusal: 'not_the_users_statement', why: miss as RefusedMiss,
    detail: 'Nothing was prepared: the words quoted do not state, as one statement of the user\u2019s, how much the one moves '
      + `the other (${miss.replace(/_/g, ' ')}). A figure is recorded as theirs only when they say it: ask them to say it as `
      + 'one statement naming both, which way, and both figures. Never fill in a figure or a direction for them.' };
}

/** What the Agent is told when Olumi, not the word rule, read the user's words: the card is theirs to check. */
export const READ_BY_OLUMI_NOTE = 'Olumi read the user’s words as the signed change on the card. Say it back to them in '
  + 'plain words, including which way each one moves, and ask them to approve it or correct it. ';
