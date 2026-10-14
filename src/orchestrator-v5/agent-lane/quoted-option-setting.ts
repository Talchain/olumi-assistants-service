/**
 * ⭐ AN OPTION SETTING IS THE USER'S BY ITS OWN QUOTE (capacity authorship, DL 14 Oct, (B); judge capacity-post3017 row 7:
 * "Add one specialist adds one specialist." was saved as Olumi's estimate).
 *
 * The drafter quotes; the host verifies mechanically, with no word list:
 *   · the quote is a WHOLE statement of the brief (#3022 `wholeStatementIn`);
 *   · the option's own label stands inside that quote, verbatim (case and typography normalised, nothing else);
 *   · the figure stands at the drafter's `amount_start`, inside an occurrence of that quote, and reads as the setting's value.
 * WHICH quantity the figure sets stays the drafter's structured claim (`factor_label`): a disclosed residual, as for a link's
 * ends. `namesBothEnds` is not used here: it is a word match, and "Add one specialist adds one specialist." never says
 * "additional", so it could never bind "Additional specialists". A setting that fails is stamped UNKNOWN by the caller,
 * never Olumi's (`build-model.ts` `prepareProvisionalCandidate`).
 */
import { wholeStatementIn } from '../goal-target/input-claim-context.js';
import { parseCardinalAmount } from '../../utils/cardinal-words.js';

/** One spelling for a label and the quote it must stand in: typographic quotes plain, runs of space single, lower case. */
const plain = (text: string): string =>
  text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();

/** The figure written at `at` in `text`: digits (with thousands commas or a decimal point) or cardinal words; else null. */
function figureAt(text: string, at: number): number | null {
  if (at > 0 && /[\p{L}\p{N}]/u.test(text[at - 1]!)) return null;
  const token = (/^[\p{L}\p{N}][\p{L}\p{N}.,]*/u.exec(text.slice(at))?.[0] ?? '').replace(/[.,]+$/u, '');
  if (/^[0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?$|^[0-9]+(?:\.[0-9]+)?$/u.test(token)) return Number(token.replace(/,/gu, ''));
  return token === '' ? null : parseCardinalAmount(token);
}

export function quotedOptionSetting(
  option: { readonly label: string },
  intervention: { readonly value: number; readonly stated_evidence?: { readonly quote?: unknown; readonly amount_start?: unknown } | null },
  brief: string | undefined,
): boolean {
  const quote = intervention.stated_evidence?.quote;
  const at = intervention.stated_evidence?.amount_start;
  if (typeof brief !== 'string' || typeof quote !== 'string' || quote.trim() === '' || !wholeStatementIn(brief, quote)) return false;
  if (option.label.trim() === '' || !plain(quote).includes(plain(option.label))) return false;
  if (typeof at !== 'number' || !Number.isInteger(at)) return false;
  for (let i = brief.indexOf(quote); i !== -1; i = brief.indexOf(quote, i + 1)) {
    if (at >= i && at < i + quote.length) return figureAt(brief, at) === intervention.value;
  }
  return false;
}
