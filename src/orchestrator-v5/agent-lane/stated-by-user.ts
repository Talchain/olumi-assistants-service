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
 *   strong as you think", "isnt", "cannot", "without", "I doubt", "anything but"), grounds nothing. Nor does a band set
 *   aside just before it ("strong rather than moderate", "instead of moderate", "more than moderate", "less than strong").
 * - NOT LEFT TO OLUMI (round-2 review of a2a46135, which stored "Connect price to churn, you decide how strong." + strong
 *   as the user's 0.825): a band names NOTHING when
 *   (i) "how", "whether" or "if" comes earlier in its clause — it asks about or supposes a band ("you decide how strong",
 *       "I wonder whether it is strong", "tell me if it is moderate");
 *   (ii) it is one of two or more band words offered as ALTERNATIVES in its sentence — "or" or a slash between them
 *       ("moderate or strong", "either weak or moderate", "strong/weak"), or a range ("moderate to strong",
 *       "moderate-to-strong", "between moderate and strong"). ", not" is a contrast, not an alternative: "It is strong,
 *       not moderate." names strong (and denies moderate);
 *   (iii) the turn ANYWHERE hands the choice to Olumi ("you decide", "up to you", "your call", "whatever you think",
 *       "use your judgement", "you know best", "I don't know how strong", …: `HANDS_THE_CHOICE_TO_OLUMI`).
 *   Those phrases are a closed list over open language, so it misses some ("dealer's choice"); every miss is a phrasing
 *   whose band would still be grounded, as before this rule, and every rule here errs toward the Agent asking.
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
/** (i) A band after one of these in its clause is asked about or supposed ("you decide how strong"), never named. */
const ASKS_OR_SUPPOSES = /\b(?:how|whether|if)\b/i;
/** A band set aside just before it: "strong rather than moderate", "instead of moderate", "more than moderate". */
const SET_ASIDE_BEFORE = /\b(?:(?:rather|more|less|other)\s+than|instead\s+of)\s+(?:(?:a|an|the|just|merely|only)\s+)?$/i;
/** (ii) Every band word, the longest reading first ("very strong" is one word here, never also "strong"). */
const ANY_BAND_WORD = /\b(?:very\s+strong(?:ly)?|strong(?:ly)?|moderate(?:ly)?|weak(?:ly)?|barely)\b/gi;
/** (ii) Between two band words, what offers them as alternatives: "or" or a slash anywhere, or a range joiner alone. */
const ALTERNATIVE_BETWEEN = /\bor\b|\/|^\s*(?:[-\u2013]|to|[-\u2013]\s*to\s*[-\u2013])\s*$/i;
/**
 * (iii) The user hands the choice of strength to Olumi, anywhere in the turn: every band word in it is then Olumi's pick.
 * A closed list over open language \u2014 see the rule's KNOWN LIMIT above; a phrase it misses still grounds as before.
 */
const HANDS_THE_CHOICE_TO_OLUMI = new RegExp([
  "\\b(?:you|olumi)\\s+(?:to\\s+|can\\s+|should\\s+)?(?:decide|pick|choose)\\b",
  "\\byou\\s+tell\\s+me\\b",
  "\\byou(?:['\\u2019]d)?\\s+know\\s+(?:best|better)\\b",
  "\\bup\\s+to\\s+you\\b",
  "\\byour\\s+(?:call|choice|pick)\\b",
  "\\b(?:whatever|whichever)\\s+you\\s+(?:think|want|prefer|like|feel|reckon|say|decide|pick|choose)\\b",
  "\\bleave\\s+(?:it|that|this|the\\s+\\w+)\\s+(?:up\\s+)?to\\s+you\\b",
  "\\buse\\s+your\\s+(?:own\\s+|best\\s+)?judge?ment\\b",
  "\\bas\\s+you\\s+see\\s+fit\\b",
  // "I don't know how strong", "not sure how strongly", "no idea how weak": the user says they have no band to give.
  "(?:\\bdo\\s+not\\s+know|\\bdon['\\u2019]?t\\s+know|\\bnot\\s+sure|\\bunsure|\\bno\\s+idea)\\s+how\\s+(?:very\\s+)?(?:strong|weak|moderate)",
].join('|'), 'i');

/**
 * Whether `band` is named in `turnText` \u2014 neither denied, asked about, offered among alternatives, nor left to Olumi.
 * No text (or none bound) proves nothing: false.
 */
export function bandTheUserWrote(band: string, turnText: string | null | undefined): boolean {
  const re = BAND_WORDS[band];
  if (re === undefined || typeof turnText !== 'string') return false;
  // (iii) The user left the choice to Olumi: no band word in this turn is theirs.
  if (HANDS_THE_CHOICE_TO_OLUMI.test(turnText)) return false;
  for (const m of turnText.matchAll(re)) {
    // The sentence the word sits in, and the part of its clause before it (a clause restarts after , ; : a dash, or "but").
    const start = Math.max(turnText.lastIndexOf('.', m.index), turnText.lastIndexOf('!', m.index), turnText.lastIndexOf('?', m.index), turnText.lastIndexOf('\n', m.index)) + 1;
    const endAt = turnText.slice(m.index).search(/[.!?\n]/);
    const sentenceEnd = endAt < 0 ? '' : turnText.charAt(m.index + endAt);
    const sentenceStop = endAt < 0 ? turnText.length : m.index + endAt;
    const sentenceBefore = turnText.slice(start, m.index);
    if ((sentenceEnd === '?' || AUXILIARY_FIRST.test(sentenceBefore)) && !REQUEST_FORM.test(sentenceBefore)) continue;
    // "anything but strong" denies it: read as a negator, never as a clause break.
    const clauseBefore = sentenceBefore.replace(/\banything\s+but\b/gi, 'not').split(/[,;:\u2013\u2014]|\s-\s|\bbut\b/i).pop() ?? '';
    if (NEGATOR.test(clauseBefore)) continue;
    if (SET_ASIDE_BEFORE.test(clauseBefore)) continue;
    if (band === 'strong' && /\bvery\s+$/i.test(clauseBefore)) continue;
    // (i) Asked about or supposed, not named.
    if (ASKS_OR_SUPPOSES.test(clauseBefore)) continue;
    // (ii) One of two or more band words offered as alternatives in this sentence.
    if (offeredAsAlternative(turnText, m.index, m.index + m[0].length, start, sentenceStop)) continue;
    return true;
  }
  return false;
}

/** Whether the band word at [from, to) sits among alternatives: another band word in [start, stop) joined to it by "or", "/", or a range. */
function offeredAsAlternative(text: string, from: number, to: number, start: number, stop: number): boolean {
  for (const o of text.slice(start, stop).matchAll(ANY_BAND_WORD)) {
    const oFrom = start + o.index;
    const oTo = oFrom + o[0].length;
    if (oTo > from && oFrom < to) continue; // the same word (or "very strong" around "strong")
    const between = text.slice(Math.min(to, oTo), Math.max(from, oFrom));
    if (ALTERNATIVE_BETWEEN.test(between)) return true;
    // "between moderate and strong": a range, named by "between" before the first of the two.
    if (/^\s+and\s+$/i.test(between) && /\bbetween\s+$/i.test(text.slice(start, Math.min(from, oFrom)))) return true;
  }
  return false;
}

/**
 * Whether this request is something the user TYPED: a composer message. A chip click is not — every chip's text is
 * Olumi's (an approval replaying the Agent's own labels, a suggestion, a coaching prompt) — and neither is a system
 * event such as a board edit.
 */
export function typedByUser(body: Record<string, unknown>): boolean {
  const kind = body['kind'];
  const chip = body['chip'];
  return (kind === undefined || kind === 'message') && (chip === null || chip === undefined) && body['source'] !== 'chip';
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
