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
import { findStatedAmounts, findStatedRanges, readCurrencyUnitWithQualifiers } from '../../cee/provenance/stated-amounts.js';
import { NodeV3 } from '../../schemas/cee-v3.js';
import { CARDINAL_AMOUNT_SOURCE, CARDINAL_FRACTION_CONTINUATION, parseCardinalAmount } from '../../utils/cardinal-words.js';
import { canonicalLabel, TODAY_LEVEL, TODAY_UNIT, type CandidateModel } from './admit-model.js';
import { attestHorizon, type HorizonAttestation } from './horizon-attestation.js';
import { unitPhraseFamily } from './unit-conflict.js';
import { unitFamilyOf } from '../routing/value-unit-resolution.js';
import { countedNoun } from './counted-nouns.js';
import { labelMatchesBaseline } from '../../cee/transforms/analysis-ready.js';

const same = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** Whether `value`, in `unit`, is a figure written in `userText`. No text (or none bound) proves nothing: false. */
export function figureTheUserWrote(value: number, unit: unknown, userText: string | null | undefined): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const family = unitPhraseFamily(unit);
  return findStatedAmounts(userText).some((a) => amountIs(a, value, unit, family, userText ?? undefined));
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
 *    PJ-A2 brief (null on both, measured — "churn under 4%" sits beside "reaching £100k").
 *  · horizon → `goal_horizon_months`: the drafter's month count, held only when MG's `attestHorizon` finds the brief
 *    writing that deadline ("within 12 months", "over the next year"; never "12 subscribers"). Its verdict is returned
 *    as `horizon` whatever it is, so an unresolved deadline's own words ("by Q3") reach the caller, not the node.
 * Not grounded ⇒ absent, exactly as before; nothing is defaulted. Only the one goal node is touched.
 */
export function holdStatedGoalAttributes<N extends { readonly kind?: unknown }>(
  nodes: readonly N[],
  goal: { readonly operator?: unknown; readonly horizon_months?: unknown; readonly provenance?: unknown; readonly unit?: unknown } | null | undefined,
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
  const operator = target ? NodeV3.shape.goal_direction.parse(goal.operator) : undefined;
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
): (value: number, unit: unknown) => boolean {
  const others = [...(model.factors ?? []), ...(model.outcomes ?? []), ...(model.risks ?? [])]
    .map((q) => q.label).filter((l) => l !== model.goal.metric);
  return (value, unit) => figureTheUserWroteFor(value, unit, brief, { target: [model.goal.metric], others, strict: true });
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

export function figureTheUserWroteFor(value: number, unit: unknown, userText: string | null | undefined, scope: EntityScope): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value) || typeof userText !== 'string') return false;
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
  const mentionOf = (w: string, decisiveTarget: readonly string[]): 'target' | 'other' | null => {
    if (w.length < 3) return null;
    if (unitWords.some((u) => sameWord(u, w))) return null;
    const t = decisiveTarget.some((x) => sameWord(x, w));
    const o = decisiveOther.some((x) => sameWord(x, w));
    return t && !o ? 'target' : o && !t ? 'other' : null;
  };
  const strict = scope.strict === true;
  const written = [...findStatedAmounts(userText), ...countsInWords(userText)];
  const severalFigures = written.length >= 2;
  return written.some((a) => {
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
    if (about === null) return !(strict && severalFigures);
    return about === 'target';
  });
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
 * ⛔ A LINK'S SIZE IS THE USER'S ONLY WHEN ONE STATEMENT OF THEIRS SAYS IT (PR Review CHANGES_REQUIRED on #2275 @
 * `ac0023c7`): a verbatim quote plus the two numerals somewhere in the turn is not authorship. "Our budget is £1 per
 * month and we currently have 50 subscribers. Does a Pro price rise affect subscribers?" writes 1 and 50, and says no
 * effect at all. The quote itself must, read with the model's OWN labels:
 *   1. STATE, not ask: no "?", and not opened by an auxiliary (the same reading as `bandTheUserWrote`);
 *   2. not DENY it (the shared negator);
 *   3. write BOTH figures (`figureTheUserWrote`, on the quote only — never the rest of the turn);
 *   4. NAME BOTH ENDS: each end by a word of its label the OTHER end lacks ("the Pro price" / "paying subscribers" for
 *      Pro plan price → Pro plan paying subscribers), unless the quote also writes a word of another quantity that
 *      carries that word and the end lacks ("price sensitivity" claims "price" for Price sensitivity risk) — the same
 *      label words and stems as `factorTheUserNamed`; the two ends named in one statement disambiguate each other;
 *   5. SAY WHICH WAY the target moves, the same way as the amount's sign, with ONE closed class of verbs: lose / cost /
 *      fewer / drop … against gain / win / adds / rise … A move word right after the SOURCE's figure ("£1 increase",
 *      "£10 rise", "£1 we add to the price") or beside a word naming the source ("the price falls", "raise the price")
 *      is the SOURCE's move, and must match the sign of `per_source_change`; with none, the source is read as rising.
 * All of it from ONE sentence of the quote, and each figure SIZES its change: the amount joined to the target's movement
 * ("loses us about 50", "50 fewer"), the source's figure joined to a word of the source ("£1 on the Pro price", "the
 * Pro price falls by £1") — through linking words only, never "and" or another clause: a figure written for anything
 * else (a budget, today's level) is never a size.
 * Every miss under-claims (the Agent asks the user to say it as one statement): an unlisted verb ("sheds"), a source
 * named only by implication ("a £10 rise adds…"), both movements for one end, a figure far from its movement, or the
 * elements spread over several sentences.
 */
export type LinkEffectStatementMiss = 'question' | 'denied' | 'figures_not_in_statement' | 'end_not_named'
  | 'direction_not_stated' | 'direction_contradicts' | 'figure_not_bound' | 'not_one_statement' | 'source_figure_not_a_change';
const TARGET_DOWN = /^(?:lose|loses|losing|lost|cost|costs|costing|fewer)$/;
const TARGET_UP = /^(?:gain|gains|gaining|gained|win|wins|winning|won|adds|added|adding)$/;
const MOVE_UP = /^(?:rise|rises|rising|rose|increase|increases|increasing|increased|raise|raises|raising|raised|boost|boosts|boosted|boosting|lift|lifts|lifted|lifting|grow|grows|growing|grew|add)$/;
const MOVE_DOWN = /^(?:fall|falls|falling|fell|drop|drops|dropping|dropped|decrease|decreases|decreasing|decreased|reduce|reduces|reducing|reduced|lower|lowers|lowering|lowered|cut|cuts|cutting)$/;
/**
 * A figure SIZES a change only when words of that change join it, and only such words stand between (PR Review's third
 * CR, #2275 @ 157b42ae: "Our budget is £1 and Pro price rises, losing 50 paying subscribers" sits £1 beside "price"
 * without describing a price change). The source's figure joins a word of the source through these, its label words
 * or its move ("£1 on the Pro price", "£10 rise in the Pro price", "the Pro price falls by £1"); the amount joins the
 * target's movement through these ("loses us about 50", "50 fewer").
 */
const SOURCE_LINK = /^(?:on|in|of|to|the|a|an|our|its|their|we|you|by|extra|more|each|every|per)$/;
const AMOUNT_LINK = /^(?:us|about|roughly|around|approximately|some|nearly|almost|over|up|to|the|our|of|by|an|a|extra|another)$/;
const SOURCE_REACH = 6;
/**
 * The source's figure is a CHANGE only when it is distributive ("every / each / per £1") or joined to the source's move
 * ("£10 rise", "£1 increase", "falls by £1") — PR Review's fourth CR (#2275 @ ce3cd9d0): "With Pro price £1 today,
 * raising it loses 50 paying subscribers" writes £1 as today's LEVEL, beside "price", and sizes no rise.
 */
const DELTA_BEFORE = /^(?:every|each|per)$/;
/**
 * A change NAMED by a noun the figure sizes ("a £10 rise", "a £1 price increase") — never a verb whose object is
 * the source ("£1 raising it": today's £1, then a rise of no stated size; PR Review on #2275 @ fe509477).
 */
const CHANGE_NOUN = /^(?:rise|increase|drop|fall|cut|decrease|reduction|hike|boost|lift|uplift|jump)$/;
/** Words that may stand between a move and "by £1" ("raise the Pro price by £1", "raising it by £1"). */
const BY_LINK = /^(?:the|a|an|our|its|it|their|them|we|you|prices?)$/;
const AMOUNT_REACH = 4;
/** The quote's sentences: split at ! ? ; : a new line, or a period — except a period BETWEEN digits ("0.5", "£1.50"). */
const sentencesOf = (q: string): string[] => q.split(/[!?;:\n]|(?<!\d)\.|\.(?!\d)/).map((x) => x.trim()).filter((x) => x !== '');
export function linkEffectTheUserStated(
  quote: string,
  effect: { readonly amount: number; readonly amount_unit: string; readonly per_source_change: number; readonly per_source_change_unit: string },
  ends: { readonly source: string; readonly target: string },
  scope: { readonly quantities: readonly string[] },
): LinkEffectStatementMiss | null {
  const q = quote.trim();
  if (q.includes('?') || (AUXILIARY_FIRST.test(q) && !REQUEST_FORM.test(q))) return 'question';
  if (NEGATOR.test(q)) return 'denied';
  // ⛔ PR Review's second CR (#2275 @ f5aaec34): every element must come from ONE sentence — "Pro price rises. Paying
  // subscribers fall. Our budget is £1 per month. We currently have 50 paying subscribers." states no £1 → 50.
  const sentences = sentencesOf(q);
  const misses = sentences.map((sentence) => linkEffectInOneSentence(sentence, effect, ends, scope));
  if (misses.some((m) => m === null)) return null;
  return sentences.length === 1 ? misses[0]! : 'not_one_statement';
}

/**
 * The ONE sentence of the quote that states the effect (`linkEffectTheUserStated` passes on it), verbatim, or null.
 * AIQ 5884881500 ("proposer, not stamper"): that sentence is what the proposal stores as the user's words and what the
 * approval card shows beside the reading — the user approves the READING, so a wrong parse costs a "no", never a false
 * `user_stated`.
 */
export function statingSentenceOf(
  quote: string,
  effect: { readonly amount: number; readonly amount_unit: string; readonly per_source_change: number; readonly per_source_change_unit: string },
  ends: { readonly source: string; readonly target: string },
  scope: { readonly quantities: readonly string[] },
): string | null {
  if (linkEffectTheUserStated(quote, effect, ends, scope) !== null) return null;
  return sentencesOf(quote.trim()).find((sentence) => linkEffectInOneSentence(sentence, effect, ends, scope) === null) ?? null;
}

function linkEffectInOneSentence(
  q: string,
  effect: { readonly amount: number; readonly amount_unit: string; readonly per_source_change: number; readonly per_source_change_unit: string },
  ends: { readonly source: string; readonly target: string },
  scope: { readonly quantities: readonly string[] },
): LinkEffectStatementMiss | null {
  const amountFigure = findStatedAmounts(q).find((a) => amountIs(a, Math.abs(effect.amount), effect.amount_unit, unitPhraseFamily(effect.amount_unit), q));
  const perFigure = findStatedAmounts(q).find((a) => amountIs(a, Math.abs(effect.per_source_change), effect.per_source_change_unit,
    unitPhraseFamily(effect.per_source_change_unit), q));
  if (amountFigure === undefined || perFigure === undefined) return 'figures_not_in_statement';
  const othersOf = (label: string): string[] => scope.quantities.filter((l) => l !== label);
  const quoteWords = wordsOf(q);
  const has = (w: string): boolean => quoteWords.some((t) => sameWord(w, t));
  const named = (end: string, other: string): boolean => wordsOf(end).some((w) => has(w)
    && !wordsOf(other).some((o) => sameWord(w, o))
    && !othersOf(end).filter((l) => l !== other).some((l) => wordsOf(l).some((x) => sameWord(x, w))
      && wordsOf(l).some((x) => !wordsOf(end).some((e) => sameWord(e, x)) && has(x))));
  if (!named(ends.source, ends.target) || !named(ends.target, ends.source)) return 'end_not_named';
  const tokens = [...q.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ w: m[0].toLowerCase(), at: m.index ?? 0 }));
  const sourceOwn = wordsOf(ends.source).filter((w) => !wordsOf(ends.target).some((s) => sameWord(w, s)));
  const sourceAt = tokens.flatMap((t, i) => (sourceOwn.some((w) => sameWord(w, t.w)) ? [i] : []));
  const tokenAt = (index: number | undefined): number => tokens.findIndex((t) => t.at >= (index ?? 0));
  const perAt = tokenAt(perFigure.index);
  const amountAt = tokenAt(amountFigure.index);
  // A figure's own digits ("0.5" → 0, 5) are never words standing between it and what it sizes.
  const inFigure = (i: number): boolean => [perFigure, amountFigure].some((f) => tokens[i]!.at >= (f.index ?? 0)
    && tokens[i]!.at < (f.index ?? 0) + f.matchedText.length);
  // Punctuation ends a phrase (PR Review's fifth CR: "£1, raising it"): a comma, dash or bracket between two words breaks them.
  const unbroken = (a: number, b: number): boolean => {
    const [x, y] = a < b ? [a, b] : [b, a];
    return !/[,;:()\u2013\u2014]/.test(q.slice(tokens[x]!.at + tokens[x]!.w.length, tokens[y]!.at));
  };
  const joined = (a: number, b: number, reach: number, link: (w: string) => boolean): boolean => a >= 0 && b >= 0
    && Math.abs(a - b) <= reach && unbroken(a, b)
    && tokens.slice(Math.min(a, b) + 1, Math.max(a, b)).every((t, k) => inFigure(Math.min(a, b) + 1 + k) || link(t.w));
  const sourceLabel = wordsOf(ends.source);
  // "£1 increase", "£10 rise", "£1 we add": right after the source's figure. "the price falls", "raise the price": beside
  // a word naming the source. "add … to the Pro price": up to four words before it.
  const isSourceMove = (i: number, w: string): boolean => (perAt >= 0 && i > perAt && i - perAt <= 3)
    || sourceAt.some((s) => (w === 'add' ? s > i && s - i <= 4 : Math.abs(s - i) <= 2));
  let target = 0; let targetBoth = false; let source = 0; let sourceBoth = false;
  const targetMoves: number[] = []; const sourceMoves: number[] = [];
  const say = (end: 'target' | 'source', dir: 1 | -1, i: number): void => {
    if (end === 'target') { if (target !== 0 && target !== dir) targetBoth = true; target = dir; targetMoves.push(i); } else { if (source !== 0 && source !== dir) sourceBoth = true; source = dir; sourceMoves.push(i); }
  };
  tokens.forEach((t, i) => {
    if (TARGET_DOWN.test(t.w)) say('target', -1, i);
    else if (TARGET_UP.test(t.w)) say('target', 1, i);
    else if (MOVE_UP.test(t.w)) say(isSourceMove(i, t.w) ? 'source' : 'target', 1, i);
    else if (MOVE_DOWN.test(t.w)) say(isSourceMove(i, t.w) ? 'source' : 'target', -1, i);
  });
  if (target === 0 || targetBoth || sourceBoth) return 'direction_not_stated';
  // Each figure SIZES its change: the amount joined to the target's movement, the source's figure to a source word.
  const sourceLinkWord = (w: string): boolean => SOURCE_LINK.test(w) || MOVE_UP.test(w) || MOVE_DOWN.test(w)
    || sourceLabel.some((x) => sameWord(x, w));
  if (!targetMoves.some((m) => joined(amountAt, m, AMOUNT_REACH, (w) => AMOUNT_LINK.test(w)))
    || !sourceAt.some((s) => joined(perAt, s, SOURCE_REACH, sourceLinkWord))) return 'figure_not_bound';
  // The source's figure is itself IN a change phrase (PR Review's fifth CR: "With Pro price £1, raising it" is today's
  // price, then a rise of no stated size): distributive ("every £1"), its own move straight after ("£10 rise", "£1 price
  // increase"), or "by £1" after a move ("falls by £1", "raise the Pro price by £1").
  const isMove = (w: string): boolean => MOVE_UP.test(w) || MOVE_DOWN.test(w);
  const isLabel = (w: string): boolean => sourceLabel.some((x) => sameWord(x, w));
  const distributive = perAt > 0 && DELTA_BEFORE.test(tokens[perAt - 1]!.w) && unbroken(perAt - 1, perAt);
  const moveAfter = [1, 2, 3].some((d) => perAt + d < tokens.length && CHANGE_NOUN.test(tokens[perAt + d]!.w) && unbroken(perAt, perAt + d)
    && tokens.slice(perAt + 1, perAt + d).every((t, k) => inFigure(perAt + 1 + k) || isLabel(t.w)));
  const byAfterMove = perAt > 1 && tokens[perAt - 1]!.w === 'by' && tokens.slice(Math.max(0, perAt - 7), perAt - 1).some((t, k, xs) => {
    const m = Math.max(0, perAt - 7) + k;
    return isMove(t.w) && unbroken(m, perAt) && xs.slice(k + 1).every((u) => BY_LINK.test(u.w) || isLabel(u.w));
  });
  if (!distributive && !moveAfter && !byAfterMove) return 'source_figure_not_a_change';
  if (target !== Math.sign(effect.amount)) return 'direction_contradicts';
  if (source === 0 ? effect.per_source_change < 0 : source !== Math.sign(effect.per_source_change)) {
    return source === 0 ? 'direction_not_stated' : 'direction_contradicts';
  }
  return null;
}
