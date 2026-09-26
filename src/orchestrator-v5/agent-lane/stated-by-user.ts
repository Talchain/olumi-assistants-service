/**
 * ⛔ A FIGURE IS RECORDED AS THE USER'S ONLY WHEN THE USER WROTE IT.
 *
 * Served on CEE fbb12b8 (guest witness, scenario fb2e5613; #70 5843805457): "Add an option: keep the price at £49
 * and run a win-back offer for churned customers. It reduces Monthly churn." The Agent passed `level: {value: 0}`
 * for Monthly churn to mean "not set", and one approval stored `{value: 0, unit: "percent per month", source:
 * "user_specified"}` — a 0% churn level recorded as the user's, who stated none. The tool text already said "a
 * level ONLY for a figure the user stated"; nothing enforced it, and the unit check (#1966) cannot see it (% on %).
 *
 * THE RULE: a figure the Agent attributes to the user must be PRESENT in the user's own words (`user_text`, bound
 * by the route from the conversation's user messages, never from model output), read by the repo's one scanner
 * (`findStatedAmounts`). It is a NECESSARY condition, never attestation (see that module): not present ⇒ the
 * user's claim is withdrawn; present ⇒ there are no grounds to withdraw it.
 *
 * KIND: a written amount grounds a figure only in a compatible kind of unit, read by the family classifier #1966
 * uses (`unitPhraseFamily` — `readUnit` reads "£ per month" and "GBP/month" as plain, so it would disown every
 * price level). A bare number ("59", "7 engineers") grounds any kind; "£49" grounds only a money figure (never a
 * churn level); "4%" only a percentage. A unit nobody can classify accepts any written kind.
 *
 * A written percentage also grounds its fraction ("40%" → 0.4, a share kept as 0–1), unlike the brief-extraction
 * claim `stated-amounts.ts` refuses it for: here the Agent is told to pass the factor's own units, and a share factor's
 * own units are 0–1.
 *
 * Every miss fails toward UNDER-claiming (the figure is left unset or recorded as Olumi's, and said): word-form
 * numerals ("four percent"), a figure the Agent derived ("down a point" → 4), and a magnitude written with a suffix
 * the Agent dropped (£54k vs 54).
 */
import { findStatedAmounts } from '../../cee/provenance/stated-amounts.js';
import { unitPhraseFamily } from './unit-conflict.js';

const same = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** Whether `value`, in `unit`, is a figure written in `userText`. No text (or none bound) proves nothing: false. */
export function figureTheUserWrote(value: number, unit: unknown, userText: string | null | undefined): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const family = unitPhraseFamily(unit);
  return findStatedAmounts(userText).some((a) => {
    if (a.kind === 'currency') return (family === null || family === 'currency') && same(a.magnitude, value);
    // "40%" is 40 on a percentage, or 0.4 on a share kept as 0–1: the Agent passes the factor's own units.
    if (a.kind === 'percent') return (family === null || family === 'percent') && (same(a.magnitude, value) || same(a.magnitude / 100, value));
    return same(a.magnitude, value);
  });
}

/**
 * Whether Olumi's own figure contradicts the option's NAME ("Test £54 at release" carrying an estimate of 64; #1982
 * review N2). Only money and percentages count: a bare number in a name ("Hire 2 developers") is usually about
 * something else. The name must state at least one figure of that kind, and the estimate must match none of them.
 */
export function contradictsItsName(value: number, unit: unknown, name: string): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const family = unitPhraseFamily(unit);
  const typed = findStatedAmounts(name).filter((a) =>
    (a.kind === 'currency' && (family === null || family === 'currency')) || (a.kind === 'percent' && (family === null || family === 'percent')));
  if (typed.length === 0) return false;
  return !typed.some((a) => same(a.magnitude, value) || (a.kind === 'percent' && same(a.magnitude / 100, value)));
}

/**
 * The same rule for a link's strength band: the user must NAME the band, in THIS turn's own typed words, before it is
 * recorded as theirs (AI Quality on #1978, 5844682410; #1984 review 5844756344). The link writer stamps every approved
 * strength as the user's, so a band the Agent picked and the user only approved would read as the user's estimate.
 *
 * - THIS TURN ONLY (review B1): "strong", "weak" and "moderate" are ordinary words in a brief ("strong retention"), so
 *   the whole conversation cannot ground a band; the caller passes the current typed message (`user_turn_text`).
 * - Band-exact, on word boundaries: "stronger" is not "strong"; "very strong" never grounds "strong"; "barely" is weak,
 *   the prompt's own example ("price barely affects churn").
 * - NOT A DENIAL OR A QUESTION (review B2, N1): a band in a question ("Is it strong or weak?", or a sentence opened by an
 *   auxiliary: "is it strong"), or with a negator anywhere earlier in its clause ("doesn't have a strong effect", "not as
 *   strong as you think", "isnt", "cannot", "without", "I doubt", "anything but"), grounds nothing.
 * - KNOWN LIMIT: the word is not tied to the link. One message naming a band for a DIFFERENT link ("Marketing strongly
 *   drives signups; the price link looks wrong") still grounds it. Every miss makes the Agent ask which band.
 */
const BAND_WORDS: Record<string, RegExp> = {
  'very strong': /\bvery\s+strong(?:ly)?\b/gi,
  strong: /\bstrong(?:ly)?\b/gi,
  moderate: /\bmoderate(?:ly)?\b/gi,
  weak: /\b(?:weak(?:ly)?|barely)\b/gi,
};
const NEGATOR = new RegExp(
  "(?:^|[^\\w'\\u2019])(?:not|never|no|nor|neither|hardly|cannot|without|doubts?|doubtful|\\w+n['\\u2019]t"
  // A contraction typed without its apostrophe ("isnt", "doesnt") — listed, never \\w+nt ("important", "significant").
  + "|isnt|arent|wasnt|werent|doesnt|dont|didnt|cant|couldnt|wont|wouldnt|shouldnt|hasnt|havent|hadnt|aint)(?![\\w'\\u2019])",
  'i',
);
/** A sentence opened by an auxiliary ("is it strong", "does price strongly affect churn") asks, even without a "?". */
const AUXILIARY_FIRST = /^\s*(?:is|are|was|were|am|do|does|did|can|could|would|should|will|shall|has|have|had|might|must)\b/i;
/**
 * "Can you record it as strong?" is a REQUEST to act on the model, and it names the band. Only an ACTION verb counts
 * (#1984 review B-RF): "Would you say it's strong?", "Could you tell me whether…", "Can you check if…" ask for
 * Olumi's opinion, and stay questions.
 */
const REQUEST_FORM = /^\s*(?:please\s+)?(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:record|set|make|mark|change|put|update|use|save|keep|treat)\b/i;

/**
 * How the words at `index` are said: ASKED about (a question, or a sentence opened by an auxiliary, unless it is a
 * request to act), DENIED (a negator earlier in their clause), or AFFIRMED \u2014 with the part of their clause before them.
 * The one reading both `bandTheUserWrote` and `comparatorTheUserWrote` apply, so the two cannot drift.
 */
type Reading = { readonly said: 'asked' } | { readonly said: 'denied' } | { readonly said: 'affirmed'; readonly clauseBefore: string };
function readingAt(turnText: string, index: number): Reading {
  // The sentence the words sit in, and the part of their clause before them (a clause restarts after , ; : a dash, or "but").
  const start = Math.max(turnText.lastIndexOf('.', index), turnText.lastIndexOf('!', index), turnText.lastIndexOf('?', index), turnText.lastIndexOf('\n', index)) + 1;
  const endAt = turnText.slice(index).search(/[.!?\n]/);
  const sentenceEnd = endAt < 0 ? '' : turnText.charAt(index + endAt);
  const sentenceBefore = turnText.slice(start, index);
  if ((sentenceEnd === '?' || AUXILIARY_FIRST.test(sentenceBefore)) && !REQUEST_FORM.test(sentenceBefore)) return { said: 'asked' };
  // "anything but strong" denies it: read as a negator, never as a clause break.
  const clauseBefore = sentenceBefore.replace(/\banything\s+but\b/gi, 'not').split(/[,;:\u2013\u2014]|\s-\s|\bbut\b/i).pop() ?? '';
  if (NEGATOR.test(clauseBefore)) return { said: 'denied' };
  return { said: 'affirmed', clauseBefore };
}

/** Whether `band` is named in `turnText`, neither denied nor asked about. No text (or none bound) proves nothing: false. */
export function bandTheUserWrote(band: string, turnText: string | null | undefined): boolean {
  const re = BAND_WORDS[band];
  if (re === undefined || typeof turnText !== 'string') return false;
  for (const m of turnText.matchAll(re)) {
    const reading = readingAt(turnText, m.index);
    if (reading.said !== 'affirmed') continue;
    if (band === 'strong' && /\bvery\s+$/i.test(reading.clauseBefore)) continue;
    return true;
  }
  return false;
}

/**
 * The same rule for a goal's success target: WHICH WAY it binds \u2014 at least, or at most \u2014 is recorded as the user's
 * only when the user SAID it, in THIS turn's own typed words (`user_turn_text`). The goal-target writer stamps the
 * target as the user's (`threshold_source: 'user'`), so a direction the Agent picked and the user only approved would
 * read as the user's own.
 *
 * - The phrases, whole words only: "at least", "minimum", "no less than", "more than", "over", "above" \u2192 at least;
 *   "at most", "no more than", "under", "below", "less than", "maximum", "cap" \u2192 at most. "no less than" and
 *   "no more than" are read whole, never as a negated "less than" / "more than".
 * - ASKED ("Is at least \u00a360k realistic?") says nothing; DENIED anywhere in the turn ("not at least", "must not fall
 *   below") or BOTH directions in one turn \u2192 null. Every miss makes the Agent ask which the user means.
 * - KNOWN LIMIT, as for bands: the words are not tied to the figure. "At least \u00a360k, over the next year" reads once as
 *   at least; "under" beside "over" reads as both, and the Agent asks.
 */
const COMPARATOR_WORDS = /\b(no\s+less\s+than|no\s+more\s+than|at\s+least|at\s+most|more\s+than|less\s+than|minimum|maximum|over|above|under|below|cap)\b/gi;
const AT_MOST_WORDS: ReadonlySet<string> = new Set(['no more than', 'at most', 'less than', 'maximum', 'under', 'below', 'cap']);

/** At least / at most, as the user said it in `turnText`; null when not said, asked, denied, or said both ways. */
export function comparatorTheUserWrote(turnText: string | null | undefined): 'at_least' | 'at_most' | null {
  if (typeof turnText !== 'string') return null;
  const said = new Set<'at_least' | 'at_most'>();
  for (const m of turnText.matchAll(COMPARATOR_WORDS)) {
    const reading = readingAt(turnText, m.index);
    if (reading.said === 'asked') continue;
    if (reading.said === 'denied') return null;
    said.add(AT_MOST_WORDS.has(m[1]!.toLowerCase().replace(/\s+/g, ' ')) ? 'at_most' : 'at_least');
  }
  return said.size === 1 ? [...said][0]! : null;
}

/**
 * Whether this request is something the user TYPED: a composer message. A chip click is not — every chip's text is
 * Olumi's (an approval replaying the Agent's own labels, a suggestion, a coaching prompt) — and neither is a system
 * event such as a board edit.
 *
 * An ALLOWLIST of sources (#1978 review 5845079924 N1): the UI sends `composer`, `chip`, `chip_click` or `retry`
 * (`buildPayload.ts` `normaliseMessageSource`), and a `chip_click` can arrive without a `chip` object. Only `composer`
 * — or no source at all, an API caller — is typed. A `retry` re-sends an earlier message whose words were recorded
 * when it was first sent, if they were typed; any other source fails toward under-claiming.
 */
export function typedByUser(body: Record<string, unknown>): boolean {
  const kind = body['kind'];
  const chip = body['chip'];
  const source = body['source'];
  return (kind === undefined || kind === 'message') && (chip === null || chip === undefined)
    && (source === undefined || source === 'composer');
}

/**
 * The user's own words in this conversation: what they TYPED earlier in this session (`HistoryStore.typedWords`), then
 * this turn's message when they typed it. A figure the user gave two turns ago ("test £54 vs £59", then "add those") is
 * still theirs.
 *
 * ⛔ PROVENANCE, NEVER TEXT SHAPE (#1978 reviews 5844589340 B1, 5844805634 B2/B3). The Agent's history carries text
 * that is not the user's in `role: 'user'` items: Olumi's narration of a board edit, a chip's replay of the Agent's
 * own labels, and — after a restart, when history is reseeded from the durable conversation — rows Olumi itself
 * dispatched ("Add the option \u201cTest \u00a354 at release\u201d.", a run's reason). Stripping by punctuation lost
 * the user's own "Yes, but it's closer to 4%". So the words are recorded as they are typed, by the route, and nothing
 * else is ever read as the user's. After a restart the earlier words are gone: a figure is then left unset and asked
 * for — under-claiming, never over.
 */
export function userWordsOf(typedEarlier: readonly string[], typedNow: string | null): string {
  return [...typedEarlier, ...(typedNow !== null ? [typedNow] : [])].join('\n');
}
