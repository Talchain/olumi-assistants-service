/**
 * ⭐ S2 FOR A HIRING START (DL slice-3 ruling 22:14Z 14 Oct). E5 quotes a FRAGMENT per start ("within 2 months", "another a month
 * or so later": two starts from ONE sentence of Paul's). On S2's contract the user's statement is the WHOLE verified sentence
 * holding it (`verifyStatements`); which fragment is which start, for which option, is Olumi's reading, kept beside it:
 *  - the sentence is a whole statement of the user's own verified typed words, this message or an earlier one;
 *  - the fragment's OWN clause, or the nearest clause before it in that sentence that names an option, names the option it is
 *    for. Where the user's sentence names BOTH this option and another, and the fragment's clause gives it to the other, the
 *    binding is swapped and refused: their own words assign it ("The tech lead could start in 3 months, and the developers
 *    within 2 months" never gives the tech lead 2 months);
 *  - a sentence that does not name this option leaves E5's AIE-approved pairing rule exactly as it is (A2i4 NB-c: their words,
 *    with Olumi's labelled proposal to use them for this option, `quoteStatedFor`).
 * Pure.
 */
import { factorTheUserNamed } from '../agent-lane/stated-by-user.js';
import { verifyStatements, type StatementTexts, type UserStatement } from '../agent-lane/user-statements.js';
import { quoteSpansIn } from '../agent-lane/stated-by-user.js';
import { plainWords } from './hiring-times.js';

export const HIRING_START_QUANTITY = 'hire_start' as const;
export type StartBinding =
  | { readonly kind: 'own' | 'unnamed'; readonly statement: UserStatement }
  | { readonly kind: 'another'; readonly option_label: string; readonly sentence: string };

const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?])\s+|\n+/u).map((s) => s.trim()).filter((s) => s !== '');
/** The clauses of a sentence: at semicolons and colons, and where a new clause is coordinated (", and", ", but", "while"). */
const clausesOf = (sentence: string): string[] => sentence.split(/[;:]+|,\s*(?:and|but)\s|\s(?:while|whereas)\s/u).map((c) => c.trim()).filter((c) => c !== '');

/**
 * The start's binding: the user's whole verified sentence holding `fragment`, and which option its clause names; `undefined`
 * when no verified sentence holds the fragment (E5's own origin rule then decides, as before).
 */
export function hiringStartBinding(texts: StatementTexts, fragment: string, option: { readonly id: string; readonly label: string },
  options: readonly { readonly id: string; readonly label: string }[]): StartBinding | undefined {
  const frag = plainWords(fragment);
  if (frag === '') return undefined;
  for (const text of [texts.now, texts.conversation]) {
    if (typeof text !== 'string') continue;
    const sentence = sentencesOf(text).find((s) => quoteSpansIn(plainWords(s), frag).length > 0);
    if (sentence === undefined) continue;
    const v = verifyStatements([{ quote: sentence, form: 'describes' }], texts,
      { subject: { quantity: HIRING_START_QUANTITY, option_id: option.id }, unit: 'months', forms: ['describes'], figuresIn: () => [] });
    if (v.kind !== 'verified') return undefined;
    const labels = options.map((o) => o.label);
    const named = (clause: string) => options.filter((o) => factorTheUserNamed(o.label, clause, { options: labels.filter((l) => l !== o.label), others: [] }));
    const clauses = clausesOf(sentence);
    const at = clauses.findIndex((c) => quoteSpansIn(plainWords(c), frag).length > 0);
    // The fragment's own clause, else the nearest clause before it that names an option ("…, and then another a month later").
    const naming = (at < 0 ? [] : clauses.slice(0, at + 1).reverse()).map(named).find((n) => n.length > 0) ?? [];
    if (naming.length > 0 && !naming.some((o) => o.id === option.id) && named(sentence).some((o) => o.id === option.id)) {
      return { kind: 'another', option_label: naming[0]!.label, sentence };
    }
    return { kind: naming.length > 0 ? 'own' : 'unnamed', statement: v.statements[0]! };
  }
  return undefined;
}
