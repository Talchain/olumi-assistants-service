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
 * money and percentages ("four percent"; a plain COUNT in words IS read by `figureTheUserWroteFor`), a figure the Agent derived ("down a point" → 4), and a magnitude written with a suffix
 * the Agent dropped (£54k vs 54).
 *
 * SCALE: a MONEY unit's own magnitude letter is the scale its figure is in, so 100 in "£k/month" is the "£100k" the
 * user wrote (DL #72 5862282849: journey A's goal lost its brief source on every turn). Read by
 * `readCurrencyUnitWithQualifiers`, the reading `isAmountStatedInBrief` gives the same unit; a unit with no letter, or
 * one that is not money, is ×1 as before. So a scaled unit never reads the UNSCALED figure: 49 in £k is never "£49".
 */
import { findStatedAmounts, findStatedRanges, readCurrencyUnitWithQualifiers, type StatedAmount } from '../../cee/provenance/stated-amounts.js';
import { findLinkEffectAmounts, hasLinkEffectRange, linkEffectSourceLevels } from './link-effect-figures.js';
import { NodeV3 } from '../../schemas/cee-v3.js';
import { CARDINAL_AMOUNT_SOURCE, CARDINAL_FRACTION_CONTINUATION, parseCardinalAmount } from '../../utils/cardinal-words.js';
import type { CandidateModel } from './admit-model.js';
import { canonicalLabel, TODAY_LEVEL, TODAY_UNIT } from './model-primitives.js';
import { attestHorizon, type HorizonAttestation } from './horizon-attestation.js';
import { unitPhraseFamily } from './unit-conflict.js';
import { unitFamilyOf } from '../routing/value-unit-resolution.js';
import { countedNoun } from './counted-nouns.js';
import { labelMatchesBaseline } from '../../cee/transforms/analysis-ready.js';

const same = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** Whether `value`, in `unit`, is a figure written in `userText`. No text (or none bound) proves nothing: false. */
export function figureTheUserWroteSpan(value: number, unit: unknown, userText: string | null | undefined): { start: number; end: number } | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const family = unitPhraseFamily(unit);
  const a = findStatedAmounts(userText).find(a => amountIs(a, value, unit, family, userText ?? undefined));
  return a === undefined ? null : { start: a.index, end: a.index + a.matchedText.length };
}
export function figureTheUserWrote(value: number, unit: unknown, userText: string | null | undefined): boolean {
  return figureTheUserWroteSpan(value, unit, userText) !== null;
}

/**
 * How many times `value`, in `unit`, is WRITTEN in `userText`: one per written amount (`findStatedAmounts` reads each
 * writing once), under the unit rules of `figureTheUserWrote` (which is this count ≥ 1).
 */
export function timesTheUserWrote(value: number, unit: unknown, userText: string | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const family = unitPhraseFamily(unit);
  return findStatedAmounts(userText).filter((a) => amountIs(a, value, unit, family, userText ?? undefined)).length;
}

/**
 * ⛔ RT-10 (Codex buddy P1 on #2585, rounds 1-2; Science 5 Oct (1): the comparator must be the USER'S, "never a drafter
 * default"). Whether `userText` writes `value`, in `unit`, as a CEILING ON A LEVEL of the goal: a ceiling phrase right
 * before that very figure ("below 2%", "at most £36k", "under the 2% target", "below or equal to 2%") or right after it
 * ("2% or less", "£36k max"). The drafter must type a comparator (the schema's enum is required), so "Monthly churn
 * target 2%" carries one the user never wrote.
 *
 * Read in the figure's own clause (ends at . ! ? ; , : a dash or a new line, as `figureTheUserWroteFor`), and NOT the
 * user's ceiling on a level when, before the figure in that clause:
 *   - "by" is written: a change ("reduce costs by at most 10%", "by a maximum of 2%", "by 2% or less"; R1 S1);
 *   - a denial is written (not / never / cannot / -n't), or a verb that keeps the quantity above it (avoid / prevent /
 *     stop / without): often a FLOOR ("must not go below 2%", "cannot fall below £36k");
 *   - the phrase is "no less / lower / fewer than": a FLOOR.
 * With `scope`, the clause's left side must not name ANOTHER quantity of the model instead of the goal
 * (`leftNamesAnotherQuantity`): "Keep the GCP unit-cost saving below 4%" never lends that saving's ceiling to downtime.
 * And a figure written more than once is a ceiling only when EVERY writing reads as one ("Monthly spend target £36k; tax
 * below £36k": tax is not in the model, so scope cannot see it, but the target's own writing carries no ceiling).
 * Every miss under-claims: no comparator is held and the goal reads as base.
 */
const CEILING_BEFORE_FIGURE = /(?<!\bno\s+)\b(?:(?:below|under|less\s+than)\s+or\s+equal\s+to|below|under|beneath|less\s+than|lower\s+than|fewer\s+than|at\s+most|no\s+more\s+than|no\s+higher\s+than|up\s+to|(?:a\s+)?maximum\s+of|max(?:imum)?|down\s+to|capped\s+at)\s+(?:(?:the|about|around|roughly|approximately|just)\s+)?$/i;
const CEILING_AFTER_FIGURE = /^[^\S\n]*(?:or\s+(?:less|lower|below|under|fewer)|at\s+most|max(?:imum)?)\b/i;
/**
 * Before the figure in its clause: a change ("by") or a denial — not / never / cannot / -n't, or a verb that keeps the
 * quantity ABOVE the figure (avoid, prevent, stop, without: "avoid falling below 2%" is a FLOOR). Never the user's
 * ceiling on a level.
 */
const CHANGE_OR_DENIAL_BEFORE = /\bby\b|\bnot\b|\bnever\b|\bcannot\b|n['\u2019]t\b|\bavoid(?:s|ing)?\b|\bprevent(?:s|ing)?\b|\bstop(?:s|ping)?\b|\bwithout\b/i;

/**
 * RT-10 round 3 (Codex buddy on dee7bbc6): the ceiling's own clause, on the figure's LEFT, names ANOTHER quantity of the
 * model and not the goal ("keep the GCP unit-cost saving below 4%"). The left side only: a right-hand label is the
 * clause's next subject, not the ceiling's ("cut it to at most £36k a month without … migration downtime risk"), and an
 * anaphor ("it") names nothing. Words shared by the goal's and another label name neither (`figureTheUserWroteFor`'s rule).
 */
/**
 * A word of the goal's own label on the ceiling's left, or a PRONOUN pointing back to it ("keep it to at most …").
 * Only "it" / "them": "this" / "that" / "these" / "those" are as often determiners ("keep THIS year's tax below £36k",
 * Codex buddy round 6), and a miss here only under-claims.
 */
const ANAPHOR = /\b(?:it|them)\b/i;
function tiedToTheGoal(clauseBefore: string, scope: EntityScope | undefined): boolean {
  if (ANAPHOR.test(clauseBefore)) return true;
  if (scope === undefined) return false;
  const said = wordsOf(clauseBefore);
  return scope.target.flatMap(wordsOf).some((t) => said.some((w) => sameWord(w, t)));
}

function leftNamesAnotherQuantity(clauseBefore: string, scope: EntityScope): boolean {
  const target = [...new Set(scope.target.flatMap(wordsOf))];
  const others = [...new Set(scope.others.flatMap(wordsOf))];
  const decisiveTarget = target.filter((t) => !others.some((o) => sameWord(t, o)));
  const decisiveOther = others.filter((o) => !target.some((t) => sameWord(t, o)));
  const said = wordsOf(clauseBefore);
  const names = (pool: readonly string[]): boolean => said.some((w) => pool.some((p) => sameWord(w, p)));
  return names(decisiveOther) && !names(decisiveTarget);
}

export function ceilingTheUserWroteFor(
  value: number,
  unit: unknown,
  userText: string | null | undefined,
  scope?: EntityScope,
  /** The goal's current level is this same figure (the drafter's `baseline_value`): ONE plain writing of it is today's. */
  todayIsTheSameFigure = false,
): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value) || typeof userText !== 'string') return false;
  const family = unitPhraseFamily(unit);
  const writings = findStatedAmounts(userText).filter((a) => amountIs(a, value, unit, family, userText));
  // ⛔ Round 4 (Codex buddy on a351e007): EVERY writing of the figure must be accounted for — as the ceiling, or (once)
  // as today's level when the goal's current level is that same figure ("Monthly spend is £36k; keep it to at most
  // £36k"). "Monthly spend target £36k; tax below £36k" writes the target once with no ceiling and once as an
  // unmodelled quantity's: which writing is the goal's is unknown, so nothing is held.
  const ceilings = writings.filter((a) => {
    const before = userText.slice(0, a.index);
    const clauseStart = Math.max(...['.', '!', '?', ';', ',', ':', '\n', '\u2013', '\u2014'].map((c) => before.lastIndexOf(c))) + 1;
    const clauseBefore = before.slice(clauseStart);
    if (CHANGE_OR_DENIAL_BEFORE.test(clauseBefore)) return false;
    const end = a.index + a.matchedText.length;
    const ceiling = CEILING_BEFORE_FIGURE.test(clauseBefore) || CEILING_AFTER_FIGURE.test(userText.slice(end, end + 24));
    if (!ceiling || (scope !== undefined && leftNamesAnotherQuantity(clauseBefore, scope))) return false;
    // ⛔ Round 5 (Codex buddy on 101ab77a): with the figure written MORE than once, a ceiling writing counts only when its
    // clause ties it to the goal — a word of the goal's label, or an anaphor ("keep IT to at most £36k"). "Monthly spend
    // is at its £36k target; tax below £36k": the tax writing names neither, so it is not the goal's ceiling.
    return writings.length === 1 || tiedToTheGoal(clauseBefore, scope);
  });
  return ceilings.length > 0 && writings.length - ceilings.length <= (todayIsTheSameFigure ? 1 : 0);
}

/**
 * ⛔ A FIGURE WRITTEN ONLY AS THE GOAL'S TARGET IS NOT ALSO ITS CURRENT LEVEL (R3 #72 5885498117; DL 5885526452 (3);
 * AIQ 5885651301). A current level EQUAL to the goal's own target is the user's only when the brief writes that figure
 * AGAIN, beyond the target's own writing (≥ 2): "£85k MRR … above £85k" is; "aiming for £20,000" is not. Any other
 * level is untouched. Interim rule: the typed quote (today / target / change) is the close (AIQ).
 */
export function levelWrittenApartFromTarget(value: number, unit: unknown, target: unknown, userText: string | null | undefined): boolean {
  if (typeof target !== 'number' || !Number.isFinite(target) || !same(value, target)) return true;
  return timesTheUserWrote(value, unit, userText) >= 2;
}

/**
 * Whether ONE written amount is `value` in `unit`: the unit rules `figureTheUserWrote` and `figureTheUserWroteFor` share.
 * A money unit's own letter scales the figure (SCALE, above). Under a scaled money unit a PLAIN amount grounds it only
 * when written with its own letter ("75k" is 75 £k): a bare "300" is £300 or 300 £k, so neither (DL #72 5862394804:
 * "300 subscribers" read as 0.3 £k/month).
 */
function amountIs(
  a: { readonly magnitude: number; readonly kind: string; readonly matchedText: string; readonly index?: number; readonly currencyCode?: string },
  value: number,
  unit: unknown,
  family: ReturnType<typeof unitPhraseFamily>,
  text?: string,
): boolean {
  const scale = moneyUnitScale(unit);
  const written = value * scale;
  // ⛔ AIQ 5894808343 (1) row (d): the SAME currency, not only the currency family — "£45k" is never a figure the user
  // wrote in USD. Either code unknown (a bare "dollars", an unread unit) keeps the family reading, as before.
  if (a.kind === 'currency') {
    const code = typeof unit === 'string' ? readCurrencyUnitWithQualifiers(unit) : null;
    const unitCode = code !== null && code.kind === 'currency' ? code.currencyCode : undefined;
    const sameCurrency = unitCode === undefined || a.currencyCode === undefined || a.currencyCode === unitCode;
    return (family === null || family === 'currency') && sameCurrency && same(a.magnitude, written);
  }
  // "40%" is 40 on a percentage, or 0.4 on a share kept as 0–1: the Agent passes the factor's own units.
  if (a.kind === 'percent') return (family === null || family === 'percent') && (same(a.magnitude, value) || same(a.magnitude / 100, value));
  // A count in words grounds a PLAIN figure only: "two" is never £2 or 2%, which need their written unit.
  if (a.kind === 'words') return family !== 'currency' && family !== 'percent' && same(a.magnitude, value);
  if (scale !== 1 && !writtenWithALetter(a)) return false;
  // ⛔ A PLAIN number's unit is the word written after it ("300 subscribers", "12 months"): of another family than the
  // held unit's, it is not this figure (figure-written-as-another-kind.test.ts). A word that reads as no unit keeps today's.
  const writtenAs = text === undefined ? null : unitWordAfter(text, a);
  if (family !== null && writtenAs !== null && writtenAs !== family) return false;
  return same(a.magnitude, written);
}

/** The unit family of the word written right after an amount (`unitFamilyOf`, else a counted noun), or null. */
function unitWordAfter(text: string, a: { readonly matchedText: string; readonly index?: number }): ReturnType<typeof unitFamilyOf> {
  if (typeof a.index !== 'number') return null;
  const word = /^\s*([A-Za-z][A-Za-z-]*)/.exec(text.slice(a.index + a.matchedText.length))?.[1];
  if (word === undefined) return null;
  return unitFamilyOf(word) ?? (countedNoun(word) ? 'count' : null);
}

/** Whether an amount was written with a magnitude letter: its magnitude is not the number its digits spell ("75k"). */
function writtenWithALetter(a: { readonly magnitude: number; readonly matchedText: string }): boolean {
  const digits = Number(a.matchedText.replace(/[^0-9.]/g, ''));
  return Number.isFinite(digits) && !same(digits, a.magnitude);
}

/** A money unit's own magnitude letter ("£k/month" → 1000, "£m" → 1e6); 1 for a unit with none, or one not money. */
function moneyUnitScale(unit: unknown): number {
  if (typeof unit !== 'string') return 1;
  const reading = readCurrencyUnitWithQualifiers(unit);
  return reading.kind === 'currency' && Number.isFinite(reading.multiplier) && reading.multiplier > 0 ? reading.multiplier : 1;
}

/** A number the text writes in words ("three engineers"), read by the repo's one cardinal grammar; a fraction refuses. */
const CARDINAL_PHRASE = new RegExp(`\\b(?:${CARDINAL_AMOUNT_SOURCE})${CARDINAL_FRACTION_CONTINUATION}\\b`, 'gi');

/**
 * Whether the brief states `value` as today's level: `figureTheUserWrote`, else a number written in words or "zero"
 * that COUNTS THIS FACTOR (AIQ 5881132458). The fallback used to ground ANY same-valued cardinal phrase and ANY "zero":
 * "hire three engineers" made an unstated 3% churn the user's, "zero downtime" an unstated 0 enterprise customers.
 *  · A number in words grounds a PLAIN count only — "two" is never £2 or 2% (`amountIs`'s own family rule).
 *  · "zero" is 0 in any unit, so it takes no family rule.
 *  · Either grounds the factor only when the words right after it name it (`wordsNameThisFactor`).
 * Every miss under-claims: the figure reads as Olumi's.
 */
function baselineTheBriefStates(value: number, unit: unknown, brief: string, label: unknown): boolean {
  if (figureTheUserWrote(value, unit, brief)) return true;
  if (value === 0) return [...brief.matchAll(/\bzero\b/gi)].some((m) => wordsNameThisFactor(brief, m, label, unit));
  const family = unitPhraseFamily(unit);
  if (family === 'currency' || family === 'percent') return false;
  return [...brief.matchAll(CARDINAL_PHRASE)].some((m) => {
    const v = parseCardinalAmount(m[0]);
    return v !== null && same(v, value) && wordsNameThisFactor(brief, m, label, unit);
  });
}

/** Words that name no quantity: they cannot tie "three … each month" to a factor measured per month. */
const NOT_A_NAME = new Set([
  'the', 'and', 'our', 'its', 'are', 'have', 'has', 'with', 'for', 'per', 'more', 'new', 'today', 'now', 'currently',
  'each', 'every', 'day', 'week', 'month', 'quarter', 'year', 'daily', 'weekly', 'monthly', 'quarterly', 'annual',
  'annually', 'yearly', 'total', 'count', 'number', 'level',
]);

/** A text's naming words: lower-case, three letters or more, a plural "s" dropped, time and filler words out. */
function namingWords(text: unknown): string[] {
  if (typeof text !== 'string') return [];
  return (text.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !NOT_A_NAME.has(w)).map((w) => w.replace(/s$/, ''));
}

/** Words that end the counted noun phrase: what follows them names another quantity ("three engineers FOR enterprise customers"). */
const PHRASE_BREAK = new Set([
  'for', 'of', 'to', 'in', 'on', 'at', 'with', 'by', 'from', 'into', 'across', 'over', 'under', 'within', 'per', 'than',
  'and', 'or', 'but', 'while', 'which', 'that', 'who', 'as', 'so', 'if', 'when', 'before', 'after', 'because',
]);

/**
 * Whether the COUNTED NOUN PHRASE right after the amount at `m` names the factor and nothing else: every naming word of
 * the (up to three) words before the first preposition or conjunction (PR Review 5881529306: "three engineers for
 * enterprise customers" counts engineers) is in the factor's label or unit.
 */
function wordsNameThisFactor(brief: string, m: RegExpMatchArray, label: unknown, unit: unknown): boolean {
  if (typeof m.index !== 'number') return false;
  const window = /^\s+((?:[A-Za-z][A-Za-z-]*\s*){1,3})/.exec(brief.slice(m.index + m[0].length))?.[1] ?? '';
  const words = window.trim().split(/\s+/);
  const cut = words.findIndex((w) => PHRASE_BREAK.has(w.toLowerCase()));
  const phrase = (cut === -1 ? words : words.slice(0, cut)).join(' ');
  // EVERY naming word in the phrase must name the factor, or it withholds. What a number counts is not reliably the first
  // word ("zero CUSTOMER complaints" counts complaints, PR Review 5881730098) nor the last (past a verb: "zero downtime
  // affects ENTERPRISE", 5881612484), so any word naming something else makes the reading uncertain: it withholds. Filler
  // adjectives ("new") are not naming words. A verb inside the window under-claims ("three developers joined"): safe.
  const said = namingWords(phrase);
  const names = new Set([...namingWords(label), ...namingWords(unit)]);
  return said.length > 0 && said.every((w) => names.has(w));
}

/**
 * ⛔ A FACTOR'S BASELINE IS THE USER'S (`brief_extraction`) ONLY WHEN THE BRIEF STATES IT (DL #70 5851742282).
 *
 * Admission stamps `observed_state.source: 'brief_extraction'` from the FACTOR's provenance, and "explicit" there means
 * the brief NAMES the factor, not that it states today's level. Served eng-hiring (MG construction sweep, 27 Sep): the
 * brief "hire two senior engineers or four junior engineers … salary spend under £400k" registered "Senior engineers
 * hired" 0 and the salary spend £0 as the user's own figures. The brief states neither.
 *
 * THE RULE: `figureTheUserWrote` over the brief, or the same figure written in words, or "zero" for 0. Not grounded ⇒
 * the stamp becomes Olumi's (`cee_inference`) and the value is kept, so the disclosure, the canvas label and the
 * level-limit carry all name the same author. Every miss under-claims: "no enterprise customers" is not read as 0, and the figure reads as Olumi's.
 */
export function withdrawUnstatedBaselineStamps<N extends { readonly kind?: unknown; readonly observed_state?: unknown }>(
  nodes: readonly N[],
  brief: string,
): N[] {
  return nodes.map((n) => {
    const os = n.observed_state as Record<string, unknown> | null | undefined;
    if (n.kind !== 'factor' || os === null || typeof os !== 'object' || os.source !== 'brief_extraction') return n;
    const figure = typeof os.raw_value === 'number' ? os.raw_value : os.value;
    // A signed change restated on "% of today" (`restateSignedPercentChanges`) is 100 today BY DEFINITION: the user's
    // "cut 15%" is measured from it (review 5835754404, row 4b). Admission wrote it; the brief's own framing states it.
    if (os.unit === TODAY_UNIT && figure === TODAY_LEVEL) return n;
    if (typeof figure === 'number' && baselineTheBriefStates(figure, os.unit, brief, (n as { readonly label?: unknown }).label)) return n;
    // Not the user's, so Olumi's: the ONE author the disclosure ("I supplied N values"), the canvas label and the
    // level-limit carry (`levelHasAnAuthor`) all read. Source-less, it was nobody's (#2073 review F1, AIQ 5851906910).
    return { ...n, observed_state: { ...os, source: 'cee_inference' } };
  });
}

/**
 * ⛔ A LEVEL THE BRIEF STATES FOR A FACTOR IS THE USER'S, WHATEVER THE DRAFTER TAGGED IT (R3 #72 5896630173 (2); DL
 * 5896669522). Served `03b720e0` on `a20cfd6`: "We have 1,500 paying subscribers" was drafted as an ESTIMATE of "Pro plan
 * paying subscribers" (`baseline_known: false`, 1,500), so it was saved as Olumi's (`cee_inference`). The MRR goal's
 * product then had no two user-stated parts, so no card was offered and nothing was withheld, and the Run showed 6 goal
 * chances on a product-shaped goal.
 *
 * The mirror of `withdrawUnstatedBaselineStamps`, applied to the CANDIDATE before admission so every later reader (the
 * product mint, the card, the disclosure) sees one author. A factor's level is credited to the user (`baseline_known:
 * true`, `explicit`) only when the brief writes that figure FOR THAT FACTOR (`figureTheUserWroteFor`, the per-entity door
 * #2284/#2275 and the Olumi option mark trust). A figure the brief gives as a limit, the goal's target or a proposed
 * (non-status-quo) option's level is never today's level of anything, so it is never credited; the status quo's level
 * is today's. Anything unclear stays Olumi's.
 */
export function creditStatedFactorLevels(candidate: CandidateModel, brief: string): CandidateModel {
  const labels = [
    candidate.goal?.metric, ...(candidate.factors ?? []).map((f) => f.label),
    ...(candidate.outcomes ?? []).map((o) => o.label), ...(candidate.risks ?? []).map((r) => r.label),
  ].filter((l): l is string => typeof l === 'string' && l.trim() !== '');
  const notToday = [
    ...(candidate.constraints ?? []).map((c) => c.value),
    candidate.goal?.value,
    // ⛔ PR Review CR on #2311 @ ff5e7480: a STATUS QUO sets today's level by definition ("keep it at £49" beside "from
    // £49"), so only another option's level is a proposed one, never today's. Recognised as the Olumi mark does.
    ...(candidate.options ?? [])
      .filter((o) => o.is_status_quo !== true && !labelMatchesBaseline(o.label ?? ''))
      .flatMap((o) => (o.interventions ?? []).map((i) => i.value)),
  ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  let credited = false;
  const factors = (candidate.factors ?? []).map((f) => {
    if (f.baseline_known === true && f.provenance === 'explicit') return f;
    const v = f.baseline_value;
    if (typeof v !== 'number' || !Number.isFinite(v) || notToday.some((w) => same(w, v))) return f;
    const others = labels.filter((l) => canonicalLabel(l) !== canonicalLabel(f.label));
    if (!figureTheUserWroteFor(v, f.unit, brief, { target: [f.label], others })) return f;
    credited = true;
    return { ...f, baseline_known: true, provenance: 'explicit' };
  });
  return credited ? { ...candidate, factors } : candidate;
}

/** What `holdStatedGoalAttributes` held on the goal node; each `false` is unattested and left absent. */
export interface HeldGoalAttributes {
  readonly target: boolean;
  readonly direction: boolean;
  readonly horizon: boolean;
}

/**
 * ⭐ THE GOAL'S STATED TARGET SOURCE, DIRECTION AND DEADLINE ARE HELD ON THE GOAL NODE — ONLY WHEN THE BRIEF STATES
 * THEM (G1; PJ-A2 rows 6–13, 28, 29). Before this, admission recorded the direction and deadline only as ledger
 * "losses" (GraphV3 had no home for them) and never stamped whose target it was, so a cold read had none of the three.
 *
 * THE RULE, per attribute (each independent of the others except as said):
 *  · target → `threshold_source: 'brief_extraction'`: the goal holds a target (`goal_threshold_raw`), the drafter
 *    marked the goal `explicit`, AND `figureTheUserWrote` finds that figure in the brief in the goal's unit.
 *  · direction → `goal_direction`: the candidate's comparator, held ONLY beside a target held above — it is the
 *    comparator OF that stated target, the same reading admission already acts on (`admitStatedGoalLevel`) and
 *    `goal_constraints` store. It is not read from words: `comparatorTheUserWrote` is turn-scoped and reads neither
 *    PJ-A2 brief (null on both, measured — "churn under 4%" sits beside "reaching £100k"). EXCEPT a CEILING on a level
 *    target (RT-10): held only where the brief writes that figure as a ceiling (`ceilingTheUserWroteFor`).
 *  · horizon → `goal_horizon_months`: the drafter's month count, held only when MG's `attestHorizon` finds the brief
 *    writing that deadline ("within 12 months", "over the next year"; never "12 subscribers"). Its verdict is returned
 *    as `horizon` whatever it is, so an unresolved deadline's own words ("by Q3") reach the caller, not the node.
 * Not grounded ⇒ absent, exactly as before; nothing is defaulted. Only the one goal node is touched.
 */
export function holdStatedGoalAttributes<N extends { readonly kind?: unknown }>(
  nodes: readonly N[],
  goal: { readonly operator?: unknown; readonly horizon_months?: unknown; readonly provenance?: unknown; readonly unit?: unknown; readonly baseline_value?: unknown } | null | undefined,
  brief: string,
): { nodes: N[]; held: HeldGoalAttributes; horizon: HorizonAttestation } {
  const none: HeldGoalAttributes = { target: false, direction: false, horizon: false };
  const goals = nodes.filter((n) => n.kind === 'goal');
  // The deadline's attestation, whatever it finds: held below only when `attested`; otherwise returned, never stored.
  const attestation = attestHorizon(brief, goal);
  if (goal === null || goal === undefined || goals.length !== 1) return { nodes: [...nodes], held: none, horizon: attestation };
  const node = goals[0] as N & { readonly goal_threshold_raw?: unknown; readonly goal_threshold_unit?: unknown; readonly goal_threshold_frame?: unknown };
  const raw = node.goal_threshold_raw;
  // R1 S4-core: a CHANGE target is stored as the contract's figure (a fraction r for `change_rel`, a signed c for
  // `change_abs`) and the brief writes it as the user said it: "cut it by 15%" is 15 in "%", "by 2 points" is 2 in the
  // metric's unit. The sign is the comparator's and the verb's, never a written "-15".
  const written = node.goal_threshold_frame === 'change_rel' && typeof raw === 'number'
    ? { figure: Math.abs(raw * 100), unit: '%' as unknown }
    : node.goal_threshold_frame === 'change_abs' && typeof raw === 'number'
      ? { figure: Math.abs(raw), unit: goal.unit ?? node.goal_threshold_unit }
      : { figure: raw, unit: goal.unit ?? node.goal_threshold_unit };
  // ⛔ A CHANGE target is the user's only where the brief writes it about THIS goal (PR Review CR on #2262 @ 338e4268):
  // "support volume grew 15%" is not the cloud bill's "cut by 15%". Read as a chat goal target is (`scopeIn`): a figure
  // the nearest label word gives another quantity is not the goal's; one in a clause naming none ("cut it by 15%") is.
  const isChange = node.goal_threshold_frame === 'change_rel' || node.goal_threshold_frame === 'change_abs';
  const wrote = (value: number): boolean => isChange
    ? figureTheUserWroteFor(value, written.unit, brief, quantityScope(nodes, (node as { readonly label?: unknown }).label))
    : figureTheUserWrote(value, written.unit, brief);
  const target = typeof raw === 'number' && Number.isFinite(raw) && goal.provenance === 'explicit'
    && typeof written.figure === 'number' && wrote(Math.round(written.figure * 1e9) / 1e9);
  // The stored comparator's own schema reads it (one list, `NodeV3`): anything else is undefined, i.e. not held.
  const typed = target ? NodeV3.shape.goal_direction.parse(goal.operator) : undefined;
  // ⛔ RT-10 (Codex buddy P1 on #2585; Science 5 Oct (1)): a held CEILING on a LEVEL target is the run's sense in any
  // unit (`goal-direction.ts`), so it is held only where the brief WRITES that figure as a ceiling
  // (`ceilingTheUserWroteFor`): the drafter must type some comparator, and one it chose is not the user's. A change
  // target keeps its verb's sign as before; a floor is held exactly as before.
  const ceilingOnALevel = !isChange && (typed === '<' || typed === '<=');
  const figure = Math.round((written.figure as number) * 1e9) / 1e9;
  const operator = ceilingOnALevel && !ceilingTheUserWroteFor(figure, written.unit, brief,
    quantityScope(nodes, (node as { readonly label?: unknown }).label),
    typeof goal.baseline_value === 'number' && same(goal.baseline_value, figure))
    ? undefined
    : typed;
  const direction = operator !== undefined;
  const months = attestation.status === 'attested' ? attestation.months : null;
  const horizon = months !== null;
  if (!target && !horizon) return { nodes: [...nodes], held: none, horizon: attestation };
  const stamped = {
    ...node,
    ...(target ? { threshold_source: 'brief_extraction' } : {}),
    ...(operator !== undefined ? { goal_direction: operator } : {}),
    ...(months !== null ? { goal_horizon_months: months } : {}),
  };
  return { nodes: nodes.map((n) => (n === node ? stamped : n)), held: { target, direction, horizon }, horizon: attestation };
}

/** A figure's scope among a model's QUANTITIES (every node but options and the decision): `target`'s label, and the rest. */
function quantityScope(nodes: readonly { readonly kind?: unknown; readonly label?: unknown }[], target: unknown): EntityScope {
  const label = typeof target === 'string' ? target : '';
  const others = nodes
    .filter((n) => n.kind !== 'option' && n.kind !== 'decision')
    .map((n) => (typeof n.label === 'string' ? n.label : ''))
    .filter((l) => l !== '' && l !== label);
  return { target: label === '' ? [] : [label], others };
}

/**
 * ⛔ TODAY'S LEVEL OF THE GOAL IS THE USER'S ONLY WHERE THE BRIEF WRITES IT ABOUT THE GOAL (PR Review CR on #2262
 * @ 338e4268; DL E12 5872375159 before it). The drafter's `baseline_known` + `explicit` is its word, not the brief's:
 * a £45,000 the brief never states, or states for "our support team", is not the cloud bill's level. STRICT
 * (`EntityScope.strict`): a current level is written beside its quantity ("our monthly cloud bill is £45,000"), so
 * among two figures or more one no label word attributes is nobody's — the level is withheld and said, never guessed.
 * Injected into admission (`admitCandidateModel`), which this module imports from.
 */
export function goalLevelTheUserWrote(
  model: {
    readonly goal: { readonly metric: string };
    readonly factors?: readonly { readonly label: string }[];
    readonly outcomes?: readonly { readonly label: string }[];
    readonly risks?: readonly { readonly label: string }[];
  },
  brief: string | null | undefined,
): ((value: number, unit: unknown) => boolean) & { span: (value: number, unit: unknown) => { start: number; end: number } | null } {
  const others = [...(model.factors ?? []), ...(model.outcomes ?? []), ...(model.risks ?? [])]
    .map((q) => q.label).filter((l) => l !== model.goal.metric);
  const span = (value: number, unit: unknown) => figureTheUserWroteForSpan(value, unit, brief, { target: [model.goal.metric], others, strict: true });
  return Object.assign((value: number, unit: unknown) => span(value, unit) !== null, { span });
}

/**
 * The labels a figure is FOR (its factor, and the option carrying it) and every other QUANTITY in the model (factor,
 * goal, outcome, risk). Other options are not listed: a figure measures a quantity, and option names reuse the
 * factors' nouns ("Hire Two Developers" vs "Developers hired"), so they would make the target's own word ambiguous.
 */
export interface EntityScope {
  readonly target: readonly string[];
  readonly others: readonly string[];
  /**
   * ⭐ The others that could HOLD this figure (a subset of `others`; absent = every other, as before). Only THEIR words
   * make a word of the target's shared, and so name neither. An other that cannot hold it — a headcount for a money
   * figure, a risk's likelihood — still claims every word of its own the target lacks, so a figure written beside it is
   * never the target's. PJ-E-FIG (DL CHANGES_REQUIRED on #2235): on journey E's "Senior engineers cost £120k a year
   * each" the word "senior" is shared with "New senior engineers hired" (a count) and "Senior hiring lead-time risk",
   * neither of which a £ figure can be; without this, the user's own £120k for "Senior engineer salary" was refused.
   * Only for an amount written in the unit's own kind (a £ amount for a money unit): a bare "2" in "hire 2 senior
   * engineers" is a headcount's figure, so every other still shares the target's words (DL #2235 re-review F1).
   */
  readonly rivals?: readonly string[];
  /**
   * ⛔ NEAR ONLY — opt-in, passed only by the revise door's displayed-pairing path (AIQ #75 5902884139). When a
   * comparator ("than", "versus", "vs", "compared") opens the words after the figure, the last rule (the nearest label word
   * AFTER it, beyond the two words beside it) is not read: served cut-costs' "about 25% cheaper than AWS for our workload"
   * names what the figure is compared WITH, not whose it is. Without a comparator it is read as always ("3% for our
   * enterprise customers" is Enterprise churn's; R3 CR on #2330). Every other door keeps its reading byte for byte.
   */
  readonly nearOnly?: boolean;
  /**
   * ⛔ THE STRICT READING — opt-in, passed only by the add-factor door, whose figure lands as the user's own on a factor
   * that did not exist (DL ruling on the #2235 re-review, 13:07Z 28 Sep). Every other door keeps its reading byte for byte.
   * Journey E's own typed clarification, "Record them as annual salaries: £120,000 per senior engineer and £65,000 per
   * junior engineer.", passed the SWAP and refused the correct pairing under the shared reading:
   *  · a rate names its OWNER: only its word ("per", "a", "each", "every") is passed over, never its noun, so "per senior
   *    engineer" is about seniors (the door's unit is always declared, and its own words are passed over already);
   *  · a conjunction straight after a figure ends its phrase: what follows "and" is the NEXT item;
   *  · FAIL CLOSED: in a message that writes two figures or more, a figure no label word attributes is nobody's — never
   *    "the user's, for any target". The user is asked.
   */
  readonly strict?: true;
  /** A short answer may use a live question elsewhere; this door requires the figure's entity in this clause. */
  readonly requireNamed?: true;
  /**
   * ⭐ A4 (CODEX CEE BUDDY 5919834707, AIQ 5919953251): read ONLY the written amount that starts at this index — one span,
   * never "the same figure anywhere". Opt-in, passed only by `writtenRangeFor`; every other door reads as before.
   */
  readonly at?: number;
}

/** A label's words, lower-cased, three characters or more ("Pro plan price" → pro, plan, price; "MRR" → mrr). */
export const wordsOf = (label: string): string[] => label.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);

/** One word's plain stem: "developers" → developer, "hires"/"hired"/"hire" → hir, "pricing"/"price" → pric. */
const stemOf = (w: string): string => {
  let x = w;
  for (const s of ['ing', 'ed', 'es', 's']) if (x.endsWith(s) && x.length - s.length >= 3) { x = x.slice(0, -s.length); break; }
  return x.endsWith('e') && x.length >= 4 ? x.slice(0, -1) : x;
};
/** Two words name the same thing: equal stems, or one stem (four letters or more) begins the other ("month"/"monthly"). */
/** A word naming the SOURCE end and not the target (a distinguishing source word), for binding a stated transition. */
/** Movement words in a label ("Footfall loss from price RISE") never name it: "revenue rises from 20%" is revenue's (Codex r2). */
const MOVEMENT_WORD = /^(?:ris(?:e|es|ing)|rose|increas(?:e|es|ed|ing)|decreas(?:e|es|ed|ing)|fall(?:s|ing)?|fell|drop(?:s|ped|ping)?|chang(?:e|es|ed|ing)|jump(?:s|ed|ing)?|cut(?:s|ting)?|growth|gain(?:s|ed|ing)?)$/i;
export const namesSourceOf = (ends: { readonly source: string; readonly target: string }) => (word: string): boolean =>
  !MOVEMENT_WORD.test(word) && wordsOf(ends.source).some(s => sameWord(s, word.toLowerCase())) && !wordsOf(ends.target).some(t => sameWord(t, word.toLowerCase()));
export const sameWord = (a: string, b: string): boolean => {
  const x = stemOf(a);
  const y = stemOf(b);
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 4 && long.startsWith(short);
};

/**
 * ⛔ A LINK IS THE USER'S ONLY WHEN THEY NAMED WHAT IT ACTS ON (AI Conversation #70 5849012990 U3; DL 5849023213 (2)).
 * Served on 79c299a: the user typed two option names, and the Agent's links from one of them to "AI feature
 * availability" and a new "Paid AI add-on price" — neither named, neither with a level — were stored as the user's.
 *
 * THE RULE, read with the model's OWN labels — no word list. The factor is named when THIS turn's typed words hold its
 * whole label, or one of its words that is its own: not a word of an option's name (the user typed "Keep £49 and add a paid AI add-on" to
 * name the option, so its "paid" and "add" name no factor), and not a word another quantity's label shares ("monthly"
 * in Monthly churn and Monthly new Pro subscribers names neither). Earlier turns do not count: words in the brief are
 * not a claim that THIS option acts on that factor. Every miss under-claims: the link is recorded as Olumi's, and said.
 */
export function factorTheUserNamed(
  factorLabel: string,
  turnText: string | null | undefined,
  scope: { readonly options: readonly string[]; readonly others: readonly string[] },
): boolean {
  if (typeof turnText !== 'string' || turnText.trim() === '') return false;
  const phrase = (t: string): string => ` ${t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '').join(' ')} `;
  if (phrase(factorLabel).trim() !== '' && phrase(turnText).includes(phrase(factorLabel))) return true;
  const shared = [...scope.options, ...scope.others].flatMap(wordsOf);
  const own = wordsOf(factorLabel).filter((w) => !shared.some((s) => sameWord(w, s)));
  const typed = wordsOf(turnText);
  return own.some((w) => typed.some((t) => sameWord(w, t)));
}

/**
 * ⭐ THE WRITTEN RANGE A LINK'S SIZE IS ONE END OF (A4; R3 C1/C2 5918513716; the whole identity, AIQ 5919953251 + CODEX
 * CEE BUDDY 5919834707): "deals between £1-2m" writes £1,000,000 only as the LOW end of a range, so the size is
 * said with its range and read as a bound, never as the user's single figure. The SAME span must carry the whole identity:
 *  · the end IS the size, in the target's unit and currency (`amountIs`, the currency-range reader's reading);
 *  · the span is about the link's SOURCE — its countable, and no other quantity (`figureTheUserWroteFor`, strict, read at
 *    that one span: "Angel investor outreach budgets range between £1-2m" is the angels', never the deals');
 *  · a size PER ONE of that countable: a money source (a budget, a price) is not a per-one size.
 * `null` otherwise: the size stays the user's point exactly as the #2389 door admits it, with no range words.
 */
export function writtenRangeFor(
  value: number,
  unit: unknown,
  userText: string | null | undefined,
  scope: { readonly source: string; readonly sourceUnit: unknown; readonly others: readonly string[] },
): { readonly low: number; readonly high: number; readonly text: string; readonly end: 'low' | 'high' } | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || typeof userText !== 'string') return null;
  if (unitPhraseFamily(scope.sourceUnit) === 'currency') return null;
  const family = unitPhraseFamily(unit);
  for (const r of findStatedRanges(userText)) {
    const end = amountIs(r.low, value, unit, family, userText) ? 'low' : amountIs(r.high, value, unit, family, userText) ? 'high' : null;
    if (end === null) continue;
    const at = (end === 'low' ? r.low : r.high).index;
    if (!figureTheUserWroteFor(value, unit, userText, { target: [scope.source], others: scope.others, strict: true, at })) continue;
    // In the unit's own scale, as the size is ("£m": 1 and 2, never 1,000,000 and 2,000,000).
    return { low: r.low.magnitude / moneyUnitScale(unit), high: r.high.magnitude / moneyUnitScale(unit), text: r.text, end };
  }
  return null;
}

/**
 * ⛔ A FIGURE IS THE USER'S FOR AN ENTITY ONLY WHERE THEY WROTE IT ABOUT THAT ENTITY (ChatGPT #70 5845853364: numeric
 * grounding binds figure + entity + unit + source context, not the same numeral anywhere in the conversation).
 * "Our MRR is £12,000." grounds £12,000 for MRR, never for the Pro plan price; `figureTheUserWrote` alone accepted it
 * for either.
 *
 * THE RULE, read with the model's OWN labels — no word list. Within the clause the figure was written in (a clause
 * ends at . ! ? ; , : a dash or a new line; same unit rules as `figureTheUserWrote`), the figure is ABOUT the entity it
 * sits beside:
 *   1. a label word in the two words right after it ("1 developer", "0 tech leads", "a 5% price rise");
 *   2. else the nearest label word before it ("our MRR is £12,000", "price from £49 to £59");
 *   3. else the nearest label word after it ("£59 for the Pro plan");
 *   4. no label word in the clause at all ("Test £54 vs £59") — the figure is about what the user is asking for: theirs.
 * It is the user's for the target when that word is the target's. A word shared by the target's and another entity's
 * labels ("monthly" in churn and MRR) names neither and is passed over — another that could hold the figure, when the
 * caller says which (`EntityScope.rivals`). `EntityScope.strict` reads rate owners and conjunctions, and refuses rule 4
 * among two figures or more. Every miss fails toward under-claiming: the figure is left unset or recorded as Olumi's, and said.
 */
/** Words that widen a label to the same whole rather than narrowing it (R3 #75 5924889786). */
const GENERALISERS = ['total', 'overall', 'combined', 'all'];

/** The existing size-written door's word matcher, shared with the C2 other-label refusal. */
function quantityMentionOf(w: string, unitWords: readonly string[], decisiveTarget: readonly string[], decisiveOther: readonly string[]): 'target' | 'other' | null {
  if (w.length < 3) return null;
  if (unitWords.some((u) => sameWord(u, w))) return null;
  const t = decisiveTarget.some((x) => sameWord(x, w));
  const o = decisiveOther.some((x) => sameWord(x, w));
  return t && !o ? 'target' : o && !t ? 'other' : null;
}

/** Fi R2: refuse a sentence naming another quantity; no target-label requirement. */
/** Fi only: every content word of an OTHER label, or either parenthetical name. */
export function sentenceNamesOtherQuantity(sentence: string, _unit: unknown, scope: EntityScope): boolean {
  const said = wordsOf(sentence);
  return scope.others.some(label => {
    const parenthetical = /^(.+?)\s*\(([^()]+)\)\s*$/u.exec(label);
    const alternatives = parenthetical === null ? [label] : [parenthetical[1]!, parenthetical[2]!];
    return alternatives.some(name => {
      const content = wordsOf(name).filter(w => !NOT_A_NAME.has(w));
      return content.length > 0 && content.every(w => said.some(s => sameWord(s, w)));
    });
  });
}

export function figureTheUserWroteForSpan(value: number, unit: unknown, userText: string | null | undefined, scope: EntityScope): { start: number; end: number } | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || typeof userText !== 'string') return null;
  const family = unitPhraseFamily(unit);
  const targetWords = [...new Set(scope.target.flatMap(wordsOf))];
  const otherWords = [...new Set(scope.others.flatMap(wordsOf))];
  const rivalWords = scope.rivals === undefined ? otherWords : [...new Set(scope.rivals.flatMap(wordsOf))];
  const decisiveAmong = (rivals: readonly string[]): string[] => targetWords.filter((t) => !rivals.some((o) => sameWord(t, o)));
  // Rivals decide only for an amount in the unit's own kind (`EntityScope.rivals`, F1): a bare "2" beside a £ unit is not.
  const decisiveOwnKind = decisiveAmong(rivalWords);
  const decisiveAnyKind = scope.rivals === undefined ? decisiveOwnKind : decisiveAmong(otherWords);
  const ownKind = (kind: string): boolean => (family === 'currency' ? kind === 'currency' : family === 'percent' ? kind === 'percent' : true);
  const decisiveOther = otherWords.filter((o) => !targetWords.some((t) => sameWord(t, o)));
  // The figure's own unit names no entity (R&C #2013 B1): "£59 per month" in GBP/month is not about "Monthly churn".
  const unitWords = typeof unit === 'string' ? wordsOf(unit) : [];
  const mentionOf = (w: string, decisiveTarget: readonly string[]): 'target' | 'other' | null =>
    quantityMentionOf(w, unitWords, decisiveTarget, decisiveOther);
  const strict = scope.strict === true;
  const written = [...findStatedAmounts(userText), ...countsInWords(userText)];
  const severalFigures = written.length >= 2;
  const matched = written.find((a) => {
    if (scope.at !== undefined && a.index !== scope.at) return false;
    if (!amountIs(a, value, unit, family, userText)) return false;
    const decisiveTarget = ownKind(a.kind) ? decisiveOwnKind : decisiveAnyKind;
    const amountEnd = a.index + a.matchedText.length;
    const before = userText.slice(0, a.index);
    const after = userText.slice(amountEnd);
    const clauseStart = Math.max(...['.', '!', '?', ';', ',', ':', '\n', '\u2013', '\u2014'].map((c) => before.lastIndexOf(c))) + 1;
    const endAt = after.search(/[.!?;,:\n\u2013\u2014]/);
    const clauseEnd = endAt < 0 ? userText.length : amountEnd + endAt;
    const left: string[] = [];
    const right: string[] = [];
    for (const m of userText.slice(clauseStart, clauseEnd).matchAll(/[\p{L}\p{N}]+/gu)) {
      const at = clauseStart + (m.index ?? 0);
      if (at + m[0].length <= a.index) left.push(m[0].toLowerCase());
      else if (at >= amountEnd) right.push(m[0].toLowerCase());
    }
    /**
     * ⭐ STRICT: A RIVAL CLAIMS A SHARED WORD ONLY BY ITS OWN QUALIFIER (R3 #75 5924350620; MG A4u 5924448020). A word the
     * target shares with another label names neither by itself ("deals" in "Investment-firm deals closed" and "Angel deals
     * closed"; "secured" in "Funding secured" and "Angel funding secured"), so it was passed over, and on a draft with
     * sibling labels nothing was left to bind: served 0258Z refused Paul's written deal range for the investment-firm deals,
     * and 0341Z refused his "secured £0 so far" for the goal. The clause decides, rival by rival: the target holds the word
     * when its OWN words (those that rival lacks) are written in the clause and the rival's own are not ("investment
     * firms that do deals"); when neither's own is written, the more GENERAL label holds it (the one with no own words:
     * "secured £0" is the goal's, never "Angel funding secured"'s). Anything else stays nobody's: under-claim.
     */
    const clauseWords = [...left, ...right];
    const inClause = (ws: readonly string[]): boolean => ws.some((w) => w.length >= 3 && clauseWords.some((c) => sameWord(c, w)));
    const labelWords = (labels: readonly string[]): string[][] => labels.map((l) => [...new Set(wordsOf(l))]);
    const targetLabelWords = labelWords(scope.target);
    const rivalLabelWords = labelWords(scope.rivals ?? scope.others);
    const targetHoldsShared = (w: string): boolean => {
      if (!strict || !targetWords.some((t) => sameWord(t, w))) return false;
      const rivalsWithW = rivalLabelWords.filter((r) => r.some((x) => sameWord(x, w)));
      if (rivalsWithW.length === 0) return false;
      return rivalsWithW.every((r) => targetLabelWords.some((t) => {
        if (!t.some((x) => sameWord(x, w))) return false;
        const tOwn = t.filter((x) => !r.some((y) => sameWord(x, y)));
        const rOwn = r.filter((y) => !t.some((x) => sameWord(x, y)));
        const tIn = inClause(tOwn); const rIn = inClause(rOwn);
        // R3 5924889786: the target wins on GENERALITY only over a rival that NARROWS it (a source, segment or kind:
        // "angel", "investment-firm", "monthly"). "Total"/"overall"/"combined"/"all" name the same whole: a duplicate total, a tie.
        return (tIn && !rIn) || (!tIn && !rIn && tOwn.length === 0 && rOwn.some((y) => !GENERALISERS.some((g) => sameWord(g, y))));
      }));
    };
    const firstMention = (ws: readonly string[]): 'target' | 'other' | null => {
      for (const w of ws) {
        const k = mentionOf(w, decisiveTarget);
        if (k !== null) return k;
        if (w.length >= 3 && !unitWords.some((u) => sameWord(u, w)) && targetHoldsShared(w)) return 'target';
      }
      return null;
    };
    // The figure's own RATE names no entity either (AI Conversation #70 5848429576): "£10 per month" on a factor with
    // no declared unit read "month" as "Monthly churn rate". A "per X", "/X", "a X", "each X" or "every X" written right
    // after the figure is its denominator, so it is passed over whatever unit the factor declares.
    const rate = /^\s*(?:(?:per|an?|each|every)\s+|\/\s*)[\p{L}\p{N}]+/iu.exec(after);
    // ⭐ The figure's PURPOSE names no entity either (DL #2195 CR 5863720934; Paul's C export: "we have £30,000 to
    // spend"): "to <verb>" right after it that ends the clause, or meets a preposition ("to spend on ads"), is what the
    // money is FOR, never whose it is. "to Advertising spend" (a noun follows) is not a purpose and is read as before.
    const purpose = rate === null
      ? /^\s*to\s+\p{L}+(?=\s*$|\s+(?:on|in|for|across|over|with|into|at|by)(?![\p{L}\p{N}]))/iu.exec(userText.slice(amountEnd, clauseEnd))
      : null;
    const skipped = rate ?? purpose;
    const skippedWords = skipped === null ? 0 : [...skipped[0].matchAll(/[\p{L}\p{N}]+/gu)].length;
    // STRICT: a rate names its OWNER — only the rate's own word is passed over ("per senior engineer" is about seniors).
    const afterRate = right.slice(strict && rate !== null ? skippedWords - 1 : skippedWords);
    // ⛔ STRICT: a figure followed straight away by a conjunction has ended its own phrase: what follows "and" is the NEXT
    // item, never what this figure was written about (PJ-E-FIG, DL CR on #2235: "Seniors are £120k and juniors £65k" read
    // £120k as the juniors'). Rule 1 then finds nothing and the nearest word before it decides; the words after the
    // conjunction still count last. Opt-in (DL ruling (a)): every other door reads the two words after it, as before.
    const rightAfter = strict && /^(?:and|or|but|plus|while|whereas)$/.test(afterRate[0] ?? '') ? [] : afterRate.slice(0, 2);
    if (a.kind === 'words') {
      // ⭐ A count in WORDS is an idiom far more often than a digit is ("That's one option we could try", "One more
      // thing"; AIQ #70 5859477600). It is the user's only when a label word of THIS entity sits within two words of it:
      // never by the "names nothing, so theirs" fallback below that a written digit gets.
      const near = firstMention(rightAfter) ?? firstMention([...left].reverse().slice(0, 2));
      return near === 'target';
    }
    // `nearOnly` skips the far words ONLY when a comparator opens them (R3 CR on #2330): "25% cheaper THAN AWS for our
    // workload" names what the figure is compared with; "3% for our enterprise customers" still names its owner.
    const comparatorOpens = afterRate.slice(0, rightAfter.length + 1).some((w) => /^(?:than|versus|vs|compared)$/.test(w));
    const about = firstMention(rightAfter) ?? firstMention([...left].reverse())
      ?? (scope.nearOnly === true && comparatorOpens ? null : firstMention(afterRate.slice(rightAfter.length)));
    // ⛔ STRICT, FAIL CLOSED (DL ruling (b)): among two figures or more, one no label word attributes is nobody's, never
    // "the user's, for any target" — that fallthrough let a SWAP through the door. The user is asked.
    if (about === null) return scope.requireNamed !== true && !(strict && severalFigures);
    return about === 'target';
  });
  return matched === undefined ? null : { start: matched.index, end: matched.index + matched.matchedText.length };
}

export function figureTheUserWroteFor(value: number, unit: unknown, userText: string | null | undefined, scope: EntityScope): boolean {
  return figureTheUserWroteForSpan(value, unit, userText, scope) !== null;
}

/** How many figures a message writes: digits (`findStatedAmounts`) and counts in words (`countsInWords`). */
export function figuresWrittenIn(text: string | null | undefined): number {
  return typeof text === 'string' ? findStatedAmounts(text).length + countsInWords(text).length : 0;
}

/** The longest quote the approval card shows; a longer sentence is windowed around the figure. */
export const FIGURE_QUOTE_MAX = 160;

/**
 * ⭐ THE USER'S OWN WORDS AROUND A FIGURE (DL ruling on #2235, 14:05Z 28 Sep: "Human Control is the provenance gate").
 * When a message writes two figures or more, WHOSE each one is cannot be read from word proximity (three review rounds:
 * each fix moved the failure to another common phrasing). The add-factor door then credits nothing by itself: it shows
 * each pairing on the approval card with the sentence the figure was written in, verbatim, and the user's approval makes
 * it theirs. This is that sentence: the first written amount that IS `value` in `unit` (the `figureTheUserWrote` rules),
 * cut at . ! ? (before a space) or a new line; over FIGURE_QUOTE_MAX, a window around the figure on word boundaries with
 * "…". Null when the figure is not written.
 */
export function quoteOfFigure(value: number, unit: unknown, userText: string | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || typeof userText !== 'string') return null;
  const family = unitPhraseFamily(unit);
  const a = [...findStatedAmounts(userText), ...countsInWords(userText)].find((x) => amountIs(x, value, unit, family, userText));
  if (a === undefined || typeof a.index !== 'number') return null;
  const end = a.index + a.matchedText.length;
  const starts = [...userText.slice(0, a.index).matchAll(/[.!?](?=\s)|\n/g)];
  const start = starts.length === 0 ? 0 : starts[starts.length - 1]!.index! + 1;
  const stop = /[.!?](?=\s|$)|\n/.exec(userText.slice(end));
  const stopAt = stop === null ? userText.length : end + stop.index + (stop[0] === '\n' ? 0 : 1);
  let from = start;
  let to = stopAt;
  if (to - from > FIGURE_QUOTE_MAX) {
    const room = Math.max(0, Math.floor((FIGURE_QUOTE_MAX - (end - a.index)) / 2));
    from = Math.max(start, a.index - room);
    to = Math.min(stopAt, end + room);
    // Never cut a word: widen to the nearest space (or the sentence's own edge).
    while (from > start && /\S/.test(userText.charAt(from - 1))) from -= 1;
    while (to < stopAt && /\S/.test(userText.charAt(to))) to += 1;
  }
  const words = userText.slice(from, to).replace(/\s+/g, ' ').trim();
  if (words === '') return null;
  return `${from > start ? '…' : ''}${words}${to < stopAt ? '…' : ''}`;
}

/**
 * ⭐ A COUNT WRITTEN IN WORDS ("one senior and two juniors"), read by the repo's one cardinal grammar (no articles, no
 * fractions), for `figureTheUserWroteFor` ONLY: it then binds clause by clause exactly as its digits would. Served
 * journey E07 (DL pj-20260927T181846Z): the user's 1 and 2 were dropped as "not written" (Canonical #70 5859331002).
 */
function countsInWords(text: string): { kind: 'words'; magnitude: number; index: number; matchedText: string }[] {
  return [...text.matchAll(CARDINAL_PHRASE)].flatMap((m) => {
    const v = parseCardinalAmount(m[0]);
    return v === null || m.index === undefined ? [] : [{ kind: 'words' as const, magnitude: v, index: m.index, matchedText: m[0] }];
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
  // "slight" is the canvas pill's own word for this band (#2003 follow-up), counted ONLY in the band position:
  // ending its clause, or before a link noun. "slightly" is dropped: degree adverbs mostly modify a relative CHANGE
  // ("lower it slightly", "slightly too strong"), and a closed list cannot bound that (R&C #2008 B1). A miss only
  // makes the Agent ask which band; a false hit would stamp a band the user never named as theirs.
  weak: /\b(?:weak(?:ly)?|barely|slight(?=\s*(?:$|[.,;:!?)])|\s+(?:effect|link|influence|impact|relationship|connection)\b))\b/gi,
};
// A negator inside a HYPHENATED COMPOUND is part of a word, not a denial: "no-shows", "No-show charge",
// "not-for-profit", "never-ending" (red-team F2, #87 6007779166). So a hyphen joining a letter on either side ends
// no match. "no-one" stays a negator: it IS one ("No-one thinks price matters").
const NEGATOR = new RegExp(
  "(?:^|[^\\w'\\u2019-]|(?<![\\w'\\u2019])-)(?:not|never|no|nor|neither|hardly|cannot|without|doubts?|doubtful|\\w+n['\\u2019]t"
  // A contraction typed without its apostrophe ("isnt", "doesnt") — listed, never \\w+nt ("important", "significant").
  + "|isnt|arent|wasnt|werent|doesnt|dont|didnt|cant|couldnt|wont|wouldnt|shouldnt|hasnt|havent|hadnt|aint)(?![\\w'\\u2019]|-(?!one\\b)[a-z])",
  'i',
);
/**
 * NEGATOR outside the link's own end labels: a negator word inside an end's NAME ("Not paid invoices", "No deposit
 * option") is that quantity's name, not a denial (red-team F2). Only a whole label is masked, matched token by token
 * across spaces or hyphens and case-insensitively, so a separate "no" elsewhere in the sentence still denies.
 */
function negatedOutsideEnds(text: string, ends: { readonly source: string; readonly target: string }): boolean {
  const masked = [ends.source, ends.target].sort((a, b) => b.length - a.length).reduce(maskLabel, text);
  return NEGATOR.test(masked);
}
/**
 * `text` with every WHOLE mention of `label` blanked: its words in order, joined only by spaces or hyphens,
 * case-insensitive, each word in any form with the same stem ("no-show charges" for "No-show charge"; Integrator twin (a)).
 */
function maskLabel(text: string, label: string): string {
  const want = [...label.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)].map(t => stemOf(t[0]));
  if (want.length === 0) return text;
  const words = [...text.matchAll(/[\p{L}\p{N}]+/gu)];
  const end = (w: RegExpMatchArray): number => (w.index ?? 0) + w[0].length;
  let out = text;
  for (let i = 0; i + want.length <= words.length; i++) {
    const run = words.slice(i, i + want.length);
    if (!run.every((w, k) => stemOf(w[0].toLowerCase()) === want[k]
      && (k === 0 || /^[\s-]+$/.test(text.slice(end(run[k - 1]), w.index))))) continue;
    const from = run[0].index ?? 0;
    out = out.slice(0, from) + ' '.repeat(end(run[run.length - 1]) - from) + out.slice(end(run[run.length - 1]));
    i += want.length - 1;
  }
  return out;
}
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
 * ⭐ THE USER'S OWN WORDS FOR A BAND, PROPOSED AS A READING THEY APPROVE (slice C3; ruling ChatGPT 5854968869 P3B:
 * "ordinary language may be mapped to a proposed typed interpretation for explicit approval rather than requiring the
 * user's exact enum wording"). Measured on Paul's served transcript (27 Sep): "price sensitivity is very high" was
 * refused as `strength_not_stated`, and recording "very strong" took four turns.
 *
 * Whether `words` — the phrase the Agent says the user used — is written in `turnText` (THIS turn's typed words), as
 * whole words (case and spacing aside; ' and \u2019 are one apostrophe), and said, neither asked about nor denied (the
 * one `readingAt` rule the band and comparator matchers apply). The Agent cannot invent the user's words: a phrase
 * that is not there proves nothing. Which band those words mean is the Agent's READING, shown to the user as theirs to
 * approve \u2014 never recorded as a band they named.
 */
export function wordsTheUserWrote(words: unknown, turnText: string | null | undefined): boolean {
  if (typeof words !== 'string' || typeof turnText !== 'string') return false;
  const tokens = words.trim().split(/\s+/).filter((t) => t !== '');
  if (tokens.length === 0 || tokens.length > 12 || !/[\p{L}\p{N}]/u.test(words)) return false;
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['\u2019]/g, "['\u2019]"));
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped.join('\\s+')}(?![\\p{L}\\p{N}])`, 'giu');
  for (const m of turnText.matchAll(re)) {
    if (readingAt(turnText, m.index).said === 'affirmed') return true;
  }
  return false;
}

/**
 * ⛔ WHICH WAY A PHRASE SAYS A LINK RUNS (DL #2203 verdict, named residual). `wordsTheUserWrote` proves the user wrote
 * a phrase; it does not prove the phrase is about DIRECTION. On served A16, "update it to very strong" is written and
 * said, yet says nothing about which way. So a reversal's quoted words must also say a direction:
 * - a movement: "raises / increases / boosts / pushes … up" → positive; "lowers / reduces / decreases / pushes … down"
 *   → negative. VERBS only, so "the churn increase" or "a lower price" says nothing;
 * - or that the link runs the other way ("the other way", "opposite", "backwards", "reversed") → reverse.
 * Denied words ("does not raise", "never lowers") and a phrase naming BOTH movements say nothing: null, never a guess.
 * A closed list cannot bound open language (#1971); here a miss only makes the Agent ask, and a hit still shows the
 * user their words under a plain "REVERSE its direction" preview before any approval.
 */
const REVERSE_WORDS = /\b(?:(?:the\s+)?other\s+(?:way|direction)|opposite|backwards?|reversed?|wrong\s+way)\b/i;
const UP_WORDS = /\b(?:raises|raised|raising|increases|increased|increasing|boosts|boosted|lifts|lifted|push(?:es|ed|ing)?\s+(?:\S+\s+){0,2}up|goes\s+up)\b/i;
const DOWN_WORDS = /\b(?:lowers|lowered|lowering|reduces|reduced|reducing|decreases|decreased|decreasing|push(?:es|ed|ing)?\s+(?:\S+\s+){0,2}down|goes\s+down)\b/i;
export function directionTheWordsSay(words: unknown): 'positive' | 'negative' | 'reverse' | null {
  if (typeof words !== 'string' || NEGATOR.test(words)) return null;
  const up = UP_WORDS.test(words);
  const down = DOWN_WORDS.test(words);
  if (up && down) return null;
  if (up) return 'positive';
  if (down) return 'negative';
  return REVERSE_WORDS.test(words) ? 'reverse' : null;
}

/**
 * Whether `words` hold any band word at all ("strong", "very strong", "barely", …), said, asked or denied. Such a
 * phrase is the literal matcher's alone (`bandTheUserWrote`): read as a band it could re-read a band the user named
 * ("strong" out of "very strong") or one they denied ("not strong" as strong), so it grounds no reading.
 */
export function holdsABandWord(words: unknown): boolean {
  return typeof words === 'string' && Object.values(BAND_WORDS).some((re) => [...words.matchAll(re)].length > 0);
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

/**
 * RT-6 B1–B2: a conservative pre-filter, never authority for the Agent's direction reading.
 * Both numbers must occur in ONE affirmed sentence about the named or request-selected link.
 * The typed approval card is the consent to the reading; no movement vocabulary is required here.
 */
export type LinkEffectStatementMiss = 'question' | 'denied' | 'figures_not_in_statement' | 'end_not_named'
  | 'not_one_statement' | 'unclear_figure' | 'source_figure_a_level' | 'target_figure_a_level' | 'no_change_stated'
  | 'figure_counts_another_unit' | 'figure_of_another_quantity';
type LinkEffectScope = { readonly quantities: readonly string[]; readonly link_selected?: boolean };
/** Keep the exact sentence, including its terminal punctuation, for the approval and provenance quote. */
const sentencesOf = (q: string): string[] => (q.match(/(?:[^.!?;:\n]|(?<=\d)\.(?=\d))+[.!?;:]?/g) ?? [])
  .map(x => x.trim()).filter(x => x !== '');
/**
 * Where `quote` occurs in the user's text as whole words and whole numbers (Codex buddy r1 HIGH): never starting or ending
 * inside a word or a number, so "1 percentage points…" is not the user's words when they wrote "11 percentage points…",
 * and "5 points" is not cut from "0.5 points" or "1,5 points".
 */
export function quoteSpansIn(userText: string, quote: string): number[] {
  if (quote === '') return [];
  const isWordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);
  const spans: number[] = [];
  for (let at = userText.indexOf(quote); at >= 0; at = userText.indexOf(quote, at + 1)) {
    const before = userText[at - 1]; const first = quote[0]; const last = quote[quote.length - 1];
    const after = userText[at + quote.length];
    // A separator inside a number is never an edge either: ",500 …" from "1,500" (Codex r2 HIGH), "… 1," from "1,500".
    const cutBefore = (isWordChar(before) && isWordChar(first)) || (/[.,]/.test(before ?? '') && /\d/.test(userText[at - 2] ?? '') && /\d/.test(first ?? ''))
      || (/\d/.test(before ?? '') && /[.,]/.test(first ?? '') && /\d/.test(quote[1] ?? ''));
    const cutAfter = (isWordChar(after) && isWordChar(last)) || (/\d/.test(last ?? '') && /[.,]/.test(after ?? '') && /\d/.test(userText[at + quote.length + 1] ?? ''))
      || (/[.,]/.test(last ?? '') && /\d/.test(after ?? '') && /\d/.test(quote[quote.length - 2] ?? ''));
    if (!cutBefore && !cutAfter) spans.push(at);
  }
  return spans;
}
/** The whole sentence (".", "!", "?" or a line break; never a decimal point) around each place the quote occurs. */
function enclosingSentences(userText: string, quote: string): string[] {
  const ends = [...userText.matchAll(/[!?\n]|(?<!\d)\.|\.(?!\d)/g)].map(m => m.index!);
  return quoteSpansIn(userText, quote).map(at => {
    const start = ends.filter(e => e < at).pop();
    const end = ends.find(e => e >= at + quote.length - 1);
    return userText.slice(start === undefined ? 0 : start + 1, end === undefined ? userText.length : end + 1).trim();
  });
}
/**
 * A quoted fragment cannot omit the question or denial surrounding it in the user's actual sentence. The WHOLE sentence
 * counts: "I do not believe this claim: Each 1 point …" denies what follows its colon (Codex buddy r1 HIGH).
 */
export function linkEffectQuoteContextMiss(quote: string, userText: string): 'question' | 'denied' | null {
  const enclosing = enclosingSentences(userText, quote);
  const misses = enclosing.map(sentence => sentence.includes('?') || (AUXILIARY_FIRST.test(sentence) && !REQUEST_FORM.test(sentence))
    ? 'question' as const : NEGATOR.test(sentence) ? 'denied' as const : null);
  return misses.includes(null) || misses.length === 0 ? null : misses[0]!;
}
export function linkEffectTheUserStated(
  quote: string,
  effect: { readonly amount: number; readonly amount_unit: string; readonly per_source_change: number; readonly per_source_change_unit: string },
  ends: { readonly source: string; readonly target: string },
  scope: LinkEffectScope,
): LinkEffectStatementMiss | null {
  const q = quote.trim();
  if (q.includes('?') || (AUXILIARY_FIRST.test(q) && !REQUEST_FORM.test(q))) return 'question';
  if (negatedOutsideEnds(q, ends)) return 'denied';
  const sentences = sentencesOf(q);
  const misses = sentences.map(sentence => linkEffectInOneSentence(sentence, effect, ends, scope));
  if (misses.some(m => m === null)) return null;
  return sentences.length === 1 ? misses[0]! : 'not_one_statement';
}

/** The verbatim sentence whose own figures license the proposed reading. */
export function statingSentenceOf(
  quote: string,
  effect: { readonly amount: number; readonly amount_unit: string; readonly per_source_change: number; readonly per_source_change_unit: string },
  ends: { readonly source: string; readonly target: string },
  scope: LinkEffectScope,
): string | null {
  if (linkEffectTheUserStated(quote, effect, ends, scope) !== null) return null;
  return sentencesOf(quote.trim()).find(sentence => linkEffectInOneSentence(sentence, effect, ends, scope) === null) ?? null;
}

/** Words that may stand between a distributive word and the source it counts ("each EXTRA conversation", "one MORE hire"). */
const ONE_FILLER = /^(?:extra|more|additional|single|new|another)$/;
/**
 * The token index of the word a distributive phrase counts one of ("each extra conversation" → conversation), or -1.
 * ⛔ AIQ 5925663053: it must be what the source COUNTS — the change unit's head noun ("conversations"); a unit with no
 * noun counts nothing (CODEX 5925831728) — never any other label word: "Each investment firm brings in £1m" on "Warm conversations with investment firms"
 * is per FIRM, not per conversation. The walk crosses only fillers and the source's label words, never punctuation.
 */
function distributiveOneAt(q: string, ends: { readonly source: string; readonly target: string }, unit: string): number {
  const tokens = [...q.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ w: m[0].toLowerCase(), at: m.index ?? 0 }));
  const label = wordsOf(ends.source);
  // CODEX 5925755067: the unit's HEAD noun — its last word before any "per" / "/" ("qualified investment-firm
  // conversations" → conversations; "conversations per week" → conversations). Its qualifiers are crossed, never bound.
  const unitWords = wordsOf(unit);
  const head = wordsOf(unit.split(/\s+per\s+|\//iu)[0] ?? '').slice(-1);
  // CODEX 5925831728: a symbol or scalar unit ("£/month") has no head noun, so there is nothing the phrase counts one
  // of: "Each Pro price rise" sizes no rise. No label fallback — under-claim, never invent a 1.
  if (head.length === 0) return -1;
  const own = head;
  const isLabel = (w: string): boolean => [...label, ...unitWords].some((x) => sameWord(x, w));
  for (let i = 0; i < tokens.length; i += 1) {
    const w = tokens[i]!.w; const next = tokens[i + 1]?.w;
    const from = /^(?:each|every|per)$/.test(w) ? i + 1 : w === 'one' && next === 'more' ? i + 2
      : (w === 'a' || w === 'an') && next !== undefined && /^(?:extra|single|additional)$/.test(next) ? i + 2 : -1;
    if (from < 0) continue;
    // AIQ 5925612672: the distributive word must GOVERN the source noun — at most ONE modifier between ("each extra
    // conversation"), plus the source's own label words; "per quarter from … conversations" and "one more round of
    // conversations" count something else.
    let fillers = 0;
    for (let j = from; j < tokens.length && (ONE_FILLER.test(tokens[j]!.w) || isLabel(tokens[j]!.w)); j += 1) {
      if (/[,;:()\u2013\u2014]/.test(q.slice(tokens[i]!.at, tokens[j]!.at))) break;
      if (own.some((x) => sameWord(x, tokens[j]!.w))) return j;
      if (!isLabel(tokens[j]!.w) && (fillers += 1) > 1) break;
    }
  }
  return -1;
}

/**
 * ⛔ PR REVIEW'S FIVE CRs, RESTORED AS ONE QUESTION (DL e8, 5 Oct ~18:5xZ, #2605). Option B retired the direction and verb
 * vocabulary, but a figure the user wrote as a LEVEL, or for another quantity, still sizes no change: "With Pro price £1,
 * raising it loses 50", "At a Pro price of £1", "Our budget is £1 … we currently have 50 paying subscribers", "One more
 * ROUND of conversations". Offering "+£1 → −50" there manufactures a reading; Olumi asks instead. Negative evidence only:
 * these words can stop a card, never make one.
 */
const HEDGE = /^(?:about|around|roughly|approximately|nearly|almost|only|just|some|maybe|perhaps|probably)$/i;
/** The word right before a figure (hedges skipped) that makes it a change: "every £1", "by £1", "a £10 rise". */
const CHANGE_BEFORE = /^(?:every|each|per|by|a|an|another|extra|additional|one)$/i;
/** Right after a figure: it is a change ("£1 rise", "50 fewer", "4 points off"). */
const CHANGE_AFTER = /^\s*(?:(?:percentage\s+)?points?\s+)?(?:rises?|increases?|cuts?|drops?|falls?|jumps?|hikes?|reductions?|decreases?|gains?|loss|more|fewer|less|extra|additional|higher|lower|up|down|off|changes?|swings?)\b/i;
/** Whether ONE word is a change word the binder itself reads ("adds", "costs", "raises", "means", …): where a statement's
 * predicate begins, after the counted phrase (RT-6 row 1b). */
export function isChangeWord(token: string): boolean {
  return CHANGE_STATED.test(token);
}

/** The text after a figure with its ONE change word dropped ("10 more café subscribers" → " café subscribers"), read by
 * the binder's own `CHANGE_AFTER`: the counted phrase an end's label is checked against (RT-6 row 1b). */
export function afterChangeWord(tail: string): string {
  const m = CHANGE_AFTER.exec(tail);
  return m === null ? tail : tail.slice(m[0].length);
}
/** Right before a figure, within its clause: it is a level ("At £1", "Pro price is £1", "we have 50", "With Pro price £1"). */
const LEVEL_WORD = /^(?:at|is|was|are|were|equals?|equalled|totals?|remains|currently|have|has|had|budget)$/i;
/** "is/equals" after a CHANGE noun states the change's size ("The Pro price rise is £1"), never a level (Codex r2 P2),
 * unless that noun is part of the end's own name. */
const COPULA = /^(?:is|was|are|were|equals?|equalled|totals?|remains)$/i;
const CHANGE_NOUN_OF = /^(?:rise|increase|cut|drop|fall|jump|change|reduction|decrease|gain|growth|loss|hike|swing)s?$/i;
/** Anywhere in the sentence: SOMETHING changes (presence only; the Agent's args carry the direction, B2). */
const CHANGE_STATED = /\b(?:ris(?:e|es|ing)|rose|rais(?:e|es|ed|ing)|increas(?:e|es|ed|ing)|decreas(?:e|es|ed|ing)|fall(?:s|ing)?|fell|drop(?:s|ped|ping)?|cut(?:s|ting)?|los(?:e|es|ing|t)|loss|gain(?:s|ed|ing)?|wins?|winning|won|add(?:s|ed|ing)?|cost(?:s|ing)?|bring(?:s|ing)?|brought|knocks?|knocked|push(?:es|ed|ing)?|lift(?:s|ed|ing)?|lower(?:s|ed|ing)?|reduc(?:e|es|ed|ing)|boost(?:s|ed|ing)?|grow(?:s|ing|n)?|grew|shrink(?:s|ing)?|halv(?:e|es|ed|ing)|doubl(?:e|es|ed|ing)|clos(?:e|es|ed|ing)|shut(?:s|ting)?|spend(?:s|ing)?|spent|trim(?:s|med|ming)?|sav(?:e|es|ed|ing)|worth|up|down|off|more|less|fewer|extra|additional|every|each|per|by|jumps?|chang(?:e|es|ed|ing)|mov(?:e|es|ed|ing)|means?|shed(?:s|ding)?|put(?:s|ting)?)\b/i;

function figureIsALevel(q: string, figure: StatedAmount, endLabel: string): boolean {
  const start = figure.index + (figure.matchedText.length - figure.matchedText.trimStart().length);
  if (CHANGE_AFTER.test(q.slice(figure.index + figure.matchedText.length))) return false;
  const clause = q.slice(0, start).split(/[,;:.!?]/).pop() ?? '';
  const words = [...clause.matchAll(/[\p{L}]+/gu)].map(m => m[0]);
  while (words.length > 0 && HEDGE.test(words[words.length - 1]!)) words.pop();
  const last = words[words.length - 1];
  if (last === undefined || CHANGE_BEFORE.test(last)) return false;
  // "The Pro price rise is £1" sizes the rise; "Footfall lost from price rise is 5%" is the end's own name, so a level.
  if (LEVEL_WORD.test(last)) {
    const before = words[words.length - 2];
    return !(COPULA.test(last) && before !== undefined && CHANGE_NOUN_OF.test(before)
      && !wordsOf(endLabel).some(x => sameWord(x, before.toLowerCase())));
  }
  // "a price OF £1", never "an increase of £1".
  if (/^of$/i.test(last)) return words.length >= 2 && !CHANGE_NOUN_OF.test(words[words.length - 2]!);
  // "With Pro price £1": the end's own name, opened by "with", straight before its figure.
  const withAt = words.map(w => w.toLowerCase()).lastIndexOf('with');
  return withAt >= 0 && words.slice(withAt + 1).length > 0
    && words.slice(withAt + 1).every(w => /^(?:the|our|its|a)$/i.test(w) || wordsOf(endLabel).some(x => sameWord(x, w.toLowerCase())));
}

/** A number WORD that counts something else: "One more ROUND of conversations" is one round, not one conversation. */
function wordFigureCountsAnotherUnit(q: string, figure: StatedAmount, ends: { readonly source: string }, unit: string): boolean {
  if (/\d/.test(figure.matchedText)) return false;
  // The counted noun is the HEAD before "of", across any modifiers ("One additional small GROUP of cafés"; Codex r2 HIGH).
  const m = /^((?:\s+[\p{L}-]+){1,4}?)\s+of\b/iu.exec(q.slice(figure.index + figure.matchedText.length));
  if (m === null) return false;
  const head = m[1]!.trim().split(/\s+/).pop()!.toLowerCase();
  const own = [...wordsOf(ends.source), ...wordsOf(unit)];
  return !own.some(w => sameWord(w, head));
}

/** The words after a unit's "of" ("% of appointments" → appointments), determiners dropped; [] when it has none. */
function unitDenominatorWords(unit: string): string[] {
  const tail = /\bof\s+(.+)$/iu.exec(unit)?.[1];
  return tail === undefined ? [] : [...tail.matchAll(/[\p{L}]+/gu)].map(w => w[0].toLowerCase())
    .filter(w => !/^(?:our|the|their|its|your|my|a|an)$/.test(w));
}

/**
 * The phrase a target figure is OF ("2 percentage points of net margin"), when its words are not all the target's own:
 * that figure sizes another quantity (PR Review's figure_not_bound, restored without direction words).
 */
function targetFigureOfAnotherQuantity(q: string, figure: StatedAmount, target: string, amountUnit: string): string | undefined {
  const after = q.slice(figure.index + figure.matchedText.length);
  const m = /^(?:\s*(?:percentage\s+points?|pp|points?|percent|per\s+cent))?\s+(?:of|in)\s+((?:(?!(?:while|and|but|which|that|when|if|as|so|for|than|to|this|next|last|each|every|per|a|an|years?|months?|weeks?|quarters?|today|now)\b)[\p{L}-]+\s*){1,5})/iu.exec(after);
  if (m === null) {
    // Before the figure: "cuts NET margin by 0.5" names another margin when the word before the target's head is neither
    // the target's own, a determiner, nor a change word (Codex r2 HIGH). "cuts our gross margin by 0.5" stays the target's.
    const start = figure.index + (figure.matchedText.length - figure.matchedText.trimStart().length);
    const clause = q.slice(0, start).split(/[,;:.!?]/).pop() ?? '';
    // "increase revenue'S TAX by £100": the end's name owns the quantity the figure sizes (Codex step-4 buddy r2 HIGH).
    const ownedBefore = /([\p{L}-]+)(['’])(s?)\s+((?:[\p{L}-]+\s+){0,3}?[\p{L}-]+)\s+(?:by\s+)?(?:(?:about|around|roughly|approximately|nearly|almost|only|just)\s+)?$/iu.exec(clause);
    if (ownedBefore !== null && wordsOf(target).some(t => sameWord(t, ownedBefore[1]!.toLowerCase()))
      && !ownedBefore[4]!.split(/\s+/).every(w => wordsOf(target).some(t => sameWord(t, w.toLowerCase())))) {
      return `${ownedBefore[1]}${ownedBefore[2]}${ownedBefore[3]} ${ownedBefore[4]}`;
    }
    const words = [...clause.matchAll(/[\p{L}-]+/gu)].map(w => w[0]);
    while (words.length > 0 && (HEDGE.test(words[words.length - 1]!) || /^by$/i.test(words[words.length - 1]!))) words.pop();
    const label = wordsOf(target);
    const head = wordsOf(target.split(/\s+(?:from|of|in|for|to|on|per|with|after|by)\s+/i)[0] ?? target).at(-1);
    const last = words[words.length - 1]; const modifier = words[words.length - 2];
    if (head === undefined || last === undefined || modifier === undefined || !sameWord(head, last.toLowerCase())) return undefined;
    // Is a change word before the target's head THE VERB, or a word of another quantity's name (Codex step-4 buddy r1/r2)?
    //  · a particle or comparative qualifies the change ("push UP revenue", "add MORE revenue"): the verb's;
    //  · an inflected form is a finite verb ("a price increase RAISES revenue"): the verb;
    //  · after a determiner it is inside the noun phrase ("increase our LIFT revenue"): another quantity;
    //  · after another change word it is a modifier ("increase LIFT revenue"), unless that word is a relative clause's own
    //    verb ("customers we ADD increase revenue"): another quantity, else the verb.
    const beforeModifier = words[words.length - 3]; const beforeThat = words[words.length - 4];
    const modifierIsTheChange = CHANGE_STATED.test(modifier) && (/^(?:up|down|off|more|less|fewer|extra|additional)$/i.test(modifier)
      || /(?:s|ed|ing)$/i.test(modifier) || beforeModifier === undefined
      || (!/^(?:our|the|their|its|your|my|a|an|this|that|these|those)$/i.test(beforeModifier)
        && (!CHANGE_STATED.test(beforeModifier) || (beforeThat !== undefined && /^(?:i|we|you|they|he|she|it)$/i.test(beforeThat)))));
    if (label.some(t => sameWord(t, modifier.toLowerCase())) || /^(?:our|the|their|its|your|my|a|an)$/i.test(modifier) || modifierIsTheChange) return undefined;
    return `${modifier} ${last}`;
  }
  const run = m[1]!.trim();
  // "1 point of onboarding drag'S SHARE of total delivery risk" / "…delay risks' SHARE…": a possessive (singular or plural)
  // makes the end's name the OWNER of another quantity, never that quantity (Codex step-4 buddy r1/r2 HIGH).
  const owned = /^(['’])(s?)((?:\s+(?!(?:while|and|but|which|that|when|if|as|so|for|than|to)\b)[\p{L}-]+){1,6})/iu.exec(after.slice(m[0].length));
  if (owned !== null) return `${run}${owned[1]}${owned[2]}${owned[3]}`;
  const content = [...run.matchAll(/[\p{L}]+/gu)].map(w => w[0].toLowerCase()).filter(w => !/^(?:our|the|their|its|your|my|a|an)$/.test(w));
  if (content.length === 0 || content.every(w => wordsOf(target).some(t => sameWord(t, w)))) return undefined;
  // The AMOUNT unit's own denominator ("0.05% of appointments" with unit "% of appointments"; red-team F2, #87
  // 6007779166): that run is the unit, not another quantity, but ONLY when its words ARE the denominator, word for
  // word. Never a subset (the head noun alone), a superset ("appointments booked online") or a fuzzy match.
  const denominator = unitDenominatorWords(amountUnit);
  if (denominator.length > 0 && content.length === denominator.length && content.every((w, i) => w === denominator[i])) return undefined;
  return run;
}

/**
 * Which written figure states no change of its end, if one does, with the typed question to ask about it. Used by the
 * binder (as its miss) and by the proposer (for the question's words).
 */
export function linkEffectFigureNotAChange(
  quote: string,
  effect: { readonly amount: number; readonly amount_unit: string; readonly per_source_change: number; readonly per_source_change_unit: string },
  ends: { readonly source: string; readonly target: string },
): { readonly miss: 'source_figure_a_level' | 'target_figure_a_level' | 'figure_counts_another_unit' | 'figure_of_another_quantity'; readonly question: string } | undefined {
  for (const q of sentencesOf(quote.trim())) {
    const amounts = findLinkEffectAmounts(q);
    const literal = (value: number, unit: string) => amounts.filter(a => amountIs(a, Math.abs(value), unit, unitPhraseFamily(unit), q)
      && a.magnitude === Math.abs(value) * (a.kind === 'currency' ? moneyUnitScale(unit) : 1));
    // A written "from 8% to 4%" never reads as a level here ("from"/"to" are not level words), and these checks only stop a card.
    const per = literal(effect.per_source_change, effect.per_source_change_unit);
    const amount = literal(effect.amount, effect.amount_unit);
    if (per.length > 0 && per.every(f => wordFigureCountsAnotherUnit(q, f, ends, effect.per_source_change_unit))) {
      return { miss: 'figure_counts_another_unit', question: `What change in “${ends.source}” does “${per[0]!.matchedText.trim()}” stand for?` };
    }
    if (per.length > 0 && per.every(f => figureIsALevel(q, f, ends.source))) {
      return { miss: 'source_figure_a_level', question: `Is ${per[0]!.matchedText.trim()} a change in “${ends.source}”, or its level today?` };
    }
    const otherOwner = amount.length > 0 ? targetFigureOfAnotherQuantity(q, amount[0]!, ends.target, effect.amount_unit) : undefined;
    if (otherOwner !== undefined && amount.every(f => targetFigureOfAnotherQuantity(q, f, ends.target, effect.amount_unit) !== undefined)) {
      const said = q.slice(amount[0]!.index, amount[0]!.index + amount[0]!.matchedText.length).trim();
      const unit = /^\s*(?:percentage\s+points?|pp|points?|percent|per\s+cent)/i.exec(q.slice(amount[0]!.index + amount[0]!.matchedText.length))?.[0] ?? '';
      return { miss: 'figure_of_another_quantity', question: `Is ${said}${unit} of ${otherOwner} a change in \u201c${ends.target}\u201d?` };
    }
    if (amount.length > 0 && amount.every(f => figureIsALevel(q, f, ends.target))) {
      return { miss: 'target_figure_a_level', question: `Is ${amount[0]!.matchedText.trim()} a change in “${ends.target}”, or its level today?` };
    }
  }
  return undefined;
}

function linkEffectInOneSentence(
  q: string,
  effect: { readonly amount: number; readonly amount_unit: string; readonly per_source_change: number; readonly per_source_change_unit: string },
  ends: { readonly source: string; readonly target: string },
  scope: LinkEffectScope,
): LinkEffectStatementMiss | null {
  if (q.includes('?') || (AUXILIARY_FIRST.test(q) && !REQUEST_FORM.test(q))) return 'question';
  if (negatedOutsideEnds(q, ends)) return 'denied';
  if (hasLinkEffectRange(q)) return 'unclear_figure';
  const amounts = findLinkEffectAmounts(q);
  // Link magnitudes are literal raw amounts, never the fraction fallback used for other node readers.
  const literalAmount = (value: number, unit: string) => amounts.filter(a => amountIs(a, Math.abs(value), unit, unitPhraseFamily(unit), q)
    && a.magnitude === Math.abs(value) * (a.kind === 'currency' ? moneyUnitScale(unit) : 1));
  const amountFigures = literalAmount(effect.amount, effect.amount_unit);
  const perFigures = literalAmount(effect.per_source_change, effect.per_source_change_unit);
  const levels = linkEffectSourceLevels(q, namesSourceOf(ends));
  const writtenChange = levels !== undefined && /^(?:percentage points?|pp|points?)$/i.test(effect.per_source_change_unit)
    && Math.abs(levels.change) === Math.abs(effect.per_source_change);
  const oneAt = perFigures.length === 0 && Math.abs(effect.per_source_change) === 1
    ? distributiveOneAt(q, ends, effect.per_source_change_unit) : -1;
  const bothWritten = amountFigures.some(amount => writtenChange
    ? amount.index < levels!.from_index || amount.index >= levels!.end_index
    : oneAt >= 0 || perFigures.some(per => per.index !== amount.index));
  if (!bothWritten) return 'figures_not_in_statement';
  // The target is checked even when the source change is distributive or written as levels (Codex r2 HIGH).
  const notAChange = linkEffectFigureNotAChange(q, effect, ends);
  if (notAChange !== undefined) return notAChange.miss;
  if (!CHANGE_STATED.test(q)) return 'no_change_stated';
  if (scope.link_selected === true) return null;
  const quoteWords = wordsOf(q);
  const named = (end: string, other: string): boolean => {
    const own = wordsOf(end).filter(w => !wordsOf(other).some(o => sameWord(w, o)));
    if (own.length > 0) return own.some(w => quoteWords.some(t => sameWord(w, t)));
    // Every word of this end is also the other end's ("no-shows" inside "No-show charge"; red-team F2, #87 6007779166):
    // it is named only by a mention OUTSIDE the other end's own whole-label mentions.
    const outside = wordsOf(maskLabel(q, other));
    return wordsOf(end).length > 0 && wordsOf(end).every(w => outside.some(t => sameWord(w, t)));
  };
  return named(ends.source, ends.target) && named(ends.target, ends.source) ? null : 'end_not_named';
}
