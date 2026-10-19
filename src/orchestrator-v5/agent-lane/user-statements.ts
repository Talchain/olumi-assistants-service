/**
 * ⭐ S2 — ONE USER-STATED-QUANTITY CONTRACT (RCA-PAUL-TEST-1617Z Symptom 2; AIE #94 6173489813). Paul (scenario c1494f4d,
 * 14 Oct) gave today's team time as "At least 7 months", then "8 months" when Olumi asked for the likely upper end. The
 * one-quote low/high door could hold neither: a bound had no form, two messages had no shape, and a lone figure got
 * Olumi's 6–10, below his own minimum. Nothing was saved and the Run stayed closed.
 *
 * A statement is ONE verified quote of the user's own typed words, with Olumi's reading of it (its form, figure, qualifier,
 * negation and conditions) kept beside the words. The reading is shown on the card and adopted only by the user's press;
 * approval never makes the reading human-authored. Statements about the same quantity under the same conditions combine
 * only by their ends: a bound is never turned into a point, and Olumi adds no spread beside a user's bound. Pure.
 */
import { findJoinedRanges, findStatedAmounts, readCurrencyUnitWithQualifiers } from '../../cee/provenance/stated-amounts.js';
import { authorshipOf } from '../../cee/provenance/provenance-of.js';
import { endsInQuotedSpeech, quoteIsNotTheUsersClaim, sentenceAroundSpan, usersSpanIn, withdrawnLater } from '../goal-target/input-claim-context.js';
import { plainQuoteWords, verbatimSourceLine } from './quote-confirmation.js';
import { amountsWrittenIn, comparatorTheUserWroteFor, figureTheUserWroteSpan, inAnotherSpeakersWords, amountComplete } from './stated-by-user.js';
import { unitPhraseFamily, unitPhraseHead } from './unit-conflict.js';
import { classifyValueUnitAgainstFactor } from '../routing/value-unit-resolution.js';

/**
 * `describes`: qualitative words about the quantity ("I'm not that experienced with marketing"), with no figure of the user's.
 * `holds_in_window`: the user's own FORECAST that a condition will still hold during the goal's period ("Yes, I'll still be new
 * to it then"), given only as their answer to Olumi's question about that period: never read from "holds now" (AIE 6178729504).
 */
export type StatementForm = 'point' | 'range' | 'lower_bound' | 'upper_bound' | 'holds_now' | 'holds_in_window' | 'describes';
export const STATEMENT_FORMS: readonly StatementForm[] = ['point', 'range', 'lower_bound', 'upper_bound', 'holds_now', 'holds_in_window', 'describes'];
/** The figure-free forms: no number of the user's to check. */
const FIGURE_FREE: ReadonlySet<StatementForm> = new Set(['holds_now', 'holds_in_window', 'describes']);

/** What a quantity a statement is about: set by the tool that verifies it, never by the Agent's words. */
export interface StatementSubject {
  readonly quantity: string;
  readonly node_id?: string;
  readonly option_id?: string;
}

/**
 * ⭐ CLAIM RECORD (plan v6.0 S1a; outbox/CLAIM-RECORD-SPEC.md v2; AIE 13:10Z + 14:00Z): each statement is one CLAIM, and `said_by` is
 * who asserts its figure: the user's own assertion, a party the words name (`party`, verbatim; `relayed_by`: whether the message
 * context establishes that the user supplied the report), an unresolved source, or an estimate Olumi itself introduced. `reading`
 * stays Olumi's interpretation and approval stays the host's receipt: neither moves authorship. Absent on a stored claim: derived
 * from `speaker` (`saidByOf`), so the user's own claims keep today's bytes.
 */
export type SaidBy = 'user' | 'party' | 'unknown' | 'olumi';
const SAID_BY: readonly SaidBy[] = ['user', 'party', 'unknown', 'olumi'];
export type ClaimStatus = 'proposed' | 'confirmed' | 'superseded' | 'withdrawn';
const CLAIM_STATUSES: readonly ClaimStatus[] = ['proposed', 'confirmed', 'superseded', 'withdrawn'];
/** The literal word checks, as labels the card shows: never a gate, never a reason to change `said_by` (AIE ORIGIN). */
export interface ClaimChecks {
  readonly words_found: boolean;
  readonly figure_found: boolean;
  readonly unit_found: boolean;
  /** Whether the host proved the words are about THIS subject. `false`: Olumi's reading of the user's words, which their press may confirm. */
  readonly subject_bound?: boolean;
}

export interface UserStatement {
  /**
   * `'unknown'` (the estate's speaker-unknown label, DL-3 16:14Z on #3363): words the brief writes verbatim that the quote check cannot
   * bound as one whole statement, kept exactly as written: `describes`, with no figure, unit or sign. Written only beside the two
   * legacy-legal claims (`said_by` user, or unknown words with no figure); every other claim carries `said_by` and no `speaker`, so a
   * build that predates the claim record reads it as nobody's, never the user's.
   */
  readonly speaker?: 'user' | 'unknown';
  readonly said_by?: SaidBy;
  readonly party?: string;
  readonly relayed_by?: 'user' | 'unknown';
  /** A range's EXPLICIT central figure, kept only where the words write it (C5 for G2's sizing): never a midpoint or a mean. */
  readonly value?: number;
  readonly claim_id?: string;
  readonly status?: ClaimStatus;
  readonly supersedes?: readonly string[];
  /** The host's receipt: the displayed card's proposal id. Authorises the shown operation only (AIE AMEND 13:43Z). */
  readonly approval?: { readonly proposal_id: string };
  readonly checks?: ClaimChecks;
  /** On a retired claim only: the approval or adoption its record held when it was retired (kept as a historical receipt; Codex §1). */
  readonly attested?: Readonly<Record<string, string | number | boolean>>;
  /** The user's words, verbatim, as the Agent quoted them. */
  readonly quote: string;
  /** The complete line of the user's typed words that holds the quote. */
  readonly source: string;
  readonly subject: StatementSubject;
  readonly form: StatementForm;
  /** The figure(s) the quote states, in `unit`: a point holds both ends equal; a lower bound only `low`; an upper bound only `high`. */
  readonly low?: number;
  readonly high?: number;
  readonly unit?: string;
  readonly reference?: string;
  readonly period?: string;
  /** Words that qualify the figure ("likely", "about", "low confidence"), verbatim; `qualifier_in_quote` says whether the user typed them. */
  readonly qualifier?: string;
  readonly qualifier_in_quote?: boolean;
  readonly negated?: true;
  readonly conditions?: string;
  /** The question Olumi asked that this statement answers ("the likely upper end"), in Olumi's words: context, never the user's. */
  readonly answering?: string;
  /** The form and figure are Olumi's reading of the words until the user's press adopts it. */
  readonly reading: 'olumi';
}

/** One statement as the Agent passes it. */
export interface StatementArgs {
  readonly quote?: unknown;
  readonly form?: unknown;
  readonly value?: unknown;
  readonly low?: unknown;
  readonly high?: unknown;
  readonly qualifier?: unknown;
  readonly negated?: unknown;
  readonly conditions?: unknown;
  readonly answering?: unknown;
  /** The unit the AI reads the figure in, as the sentence writes it (checked only under `StatementRules.unitWritten`). */
  readonly unit?: unknown;
  /**
   * ⭐ LEAN CORE P2 (DL-3 18 Oct): the AI's OWN reading of whose claim the quoted words are (`QUOTE_SPEAKER`): `'user'`, `'other'` (the user
   * reports someone else's words or view, marked or not: "A colleague said: we lose 5% a month") or `'unknown'`. Only the user's own words
   * can be theirs; an AI-read `'user'` still needs the literal span. Absent: no reading given, the span check alone decides (as before).
   */
  readonly speaker?: unknown;
  /** ⭐ CLAIM RECORD: the AI's reading of who asserts the claim (`CLAIM_SOURCE`), the party's name as written, and who relayed it. */
  readonly said_by?: unknown;
  readonly party?: unknown;
  readonly relayed_by?: unknown;
}

/**
 * ⭐ LEAN CORE P2 (DL-3 18 Oct 2026; AIE text signed exactly, AIE-SPEAKER-AND-USER-QUOTE-TEXT-20261018-v1): ONE schema fragment, the AI's own reading of whose claim a quote is, for every
 * statement the AI cites (construction's draft statements, the statement door, team time, assumptions). Read by `verifyStatement`.
 */
export const QUOTE_SPEAKER_WORDS = "Identify the speaker separately for each statement from its full attribution context, not merely who sent the message. Use \"user\" for the user\u2019s own assertion, goal, requirement or instruction, including their own first-person statement in the brief. Uncertainty about its truth, numerical precision or item binding does not by itself make its speaker unknown; retain that uncertainty in the claim\u2019s source, qualifications and conditions. Use \"other\" for another speaker\u2019s claim reported by the user, with or without quotation marks, and \"unknown\" when the actual claimant cannot be established. A first-person phrase inside someone else\u2019s reported claim retains that speaker. Quoting an entire report does not transfer its embedded claim to the user. A user\u2019s instruction to correct or withdraw quoted material is their instruction; the embedded claim keeps its own speaker and stance. Adopting another speaker\u2019s claim as a model input does not change who made that claim. Preserve the source, qualifications, conditions and uncertainty. Attribution alone does not turn a hypothesis, question or proposal into an asserted current fact or an adopted operative definition. This field is Olumi\u2019s interpretation of attribution, not proof of user authorship or authority to write.";
export const QUOTE_SPEAKER = { type: 'string', enum: ['user', 'other', 'unknown'], description: QUOTE_SPEAKER_WORDS } as const;

export interface StatementTexts {
  /** The user's words typed this turn. */
  readonly now?: string | null;
  /** The user's verified earlier messages. */
  readonly conversation?: string | null;
  /** Retained words whose origin is not verified (reseeded history): never a source. */
  readonly unverified?: string | null;
  /**
   * The verified typed messages in order, this turn's last (the route's `verified_user_messages`), when the caller has them: a span is
   * read in the message that holds it, and a LATER message that withdraws the user's estimates makes it no longer theirs.
   */
  readonly messages?: readonly string[];
}

export interface StatementRules {
  readonly subject: StatementSubject;
  readonly unit: string;
  readonly forms: readonly StatementForm[];
  readonly reference?: string;
  readonly period?: string;
  /** The figures the quote states, in `unit` (passed: the one eligibility reads it), each as its two ends (a single figure has both equal). */
  readonly figuresIn: (quote: string, unit: string) => readonly { readonly low: number; readonly high: number }[];
  /** This description grounds an Olumi numeric estimate; a stated figure for its quantity must use a figure-bearing form. */
  readonly describesNumericEstimate?: true;
  /** Whether the Agent's figure is the stated one (the server keeps the stated one, never the Agent's rendering). */
  readonly sameFigure?: (quote: string, given: number, stated: number) => boolean;
  /** A stated 0 is a figure of this field ("no budget", "0% now"), never refused as missing (PROMPT sys2; a level or target). */
  readonly allowsZero?: boolean;
  /**
   * ⭐ ONE BINDER, its unit (DL-3 22:53Z; BUDDY-A #3329 N2): the AI's own `unit` is required and must be the unit the sentence WRITES
   * straight after the figure ("between 4 and 7 months" is months, never points). It is then the statement's unit. A literal check of
   * the quote, never a proof of what the quantity is: the row still decides which units its field takes.
   */
  readonly unitWritten?: true;
  /**
   * ⭐ CLAIM RECORD (spec v2 rule 6): the claim door only. The AI's reading of who asserts the statement is kept on it (`said_by`):
   * another party's or an unresolved claim is verified as that claim, never as the user's. Every other caller leaves this unset and
   * reads a verified statement as the user's own, exactly as before. ⭐ GATE → LABEL (change 1): here a failed word check is the
   * claim's LABEL (`checks`), never a refusal: words not found, a figure not in them, or words held with their origin unverified.
   */
  readonly claims?: true;
}

export type StatementsVerdict =
  | { readonly kind: 'verified'; readonly statements: readonly UserStatement[] }
  | { readonly kind: 'refused'; readonly refusal: 'statement_not_found' | 'origin_unknown' | 'statement_malformed' | 'figure_not_in_quote' | 'different_conditions'; readonly detail: string };

const MAX_STATEMENTS = 6;
/** A quote may be the user's complete message (a goal change's whole source, a brief), never cut to fit. */
const QUOTE_MAX = 4000;
const trimmed = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() !== '' && v.trim().length <= max ? v.trim() : undefined;
const figure = (v: unknown, zero = false): number | undefined => (typeof v === 'number' && Number.isFinite(v) && (v > 0 || (zero && v === 0)) ? v : undefined);
const escapeRe = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * `unit` is written straight after `figure` in the quote (or in the figure itself, "7%"), singular or plural; a whole word ("m" is
 * never "mm"). `at`: only the figure written at that index (one occurrence, never another figure equal to it, BUDDY-A #3356 R3).
 */
export function unitWrittenAfter(quote: string, figureStated: number, unit: string, at?: number): boolean {
  const u = unit.trim().toLowerCase().replace(/\s+/gu, ' ');
  if (u === '') return false;
  // ⛔ A unit no longer than its plural ending ("s", seconds) is its own stem: stripping it left an empty pattern that matched ANY
  // figure followed by a space (the #3356 unit sweep).
  const stem = u.length > 2 ? u.replace(/(?:es|s)$/u, '') : u;
  const after = new RegExp(`^\\s*${escapeRe(stem).replace(/ /gu, '\\s+')}(?:es|s)?(?![\\p{L}\\p{N}])`, 'iu');
  return findStatedAmounts(quote).some((a) => (at === undefined || a.index === at) && Math.abs(a.magnitude) === Math.abs(figureStated)
    && (a.matchedText.trim().toLowerCase().endsWith(u) || after.test(quote.slice(a.index + a.matchedText.length))));
}

export type StatementVerdict =
  | { readonly kind: 'verified'; readonly statement: UserStatement }
  | Extract<StatementsVerdict, { kind: 'refused' }>;

/**
 * ⭐ THE ONE RULE's source check (lean core): `'theirs'` when `quote` is literally the user's own words in a verified typed message
 * (`usersSpanIn`: never cut from another speaker's quotation marks), that message does not report it as Olumi's claim, dispute it or
 * disown it (`quoteIsNotTheUsersClaim`), and no LATER message withdraws the user's estimates (`withdrawnLater`). `'retained'`: only in
 * retained words of unknown origin. `'not_their_claim'`: written, but not theirs. `'absent'`: not written.
 */
function usersOwnSpan(texts: StatementTexts, quote: string, current?: CurrentCorrection): 'theirs' | 'retained' | 'not_their_claim' | 'absent' {
  const messages = texts.messages !== undefined && texts.messages.length > 0
    ? texts.messages : [texts.conversation, texts.now].filter((t): t is string => typeof t === 'string' && t !== '');
  // ⛔ PL-0048 (2): the subject's account as the user last CORRECTED it: the correction door's PERSISTED record (read, never re-derived),
  // in force whether or not its chat message is in this history (cold read, partial history, aggregated turn). Under it a span is
  // current only inside a span the correction explicitly kept, or in words typed AFTER it: a message later than the last one holding
  // the correction's words or, that message not in this history, this turn's own words. Never its own message or anything before.
  const correctedAt = current === undefined ? -1 : messages.reduce((at, m, i) => (usersSpanIn(m, current.correction) >= 0 ? i : at), -1);
  const keptByCorrection = current !== undefined && current.kept.some((k) => plainQuoteWords(k).includes(plainQuoteWords(quote)));
  const typedAfterCorrection = (i: number): boolean => current === undefined || keptByCorrection
    || (correctedAt >= 0 ? i > correctedAt : messages[i] === texts.now);
  let found = false;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (usersSpanIn(messages[i]!, quote) < 0) continue;
    found = true;
    if (!typedAfterCorrection(i)) continue;
    if (!quoteIsNotTheUsersClaim(messages[i]!, quote) && !withdrawnLater(messages.slice(i + 1))) return 'theirs';
  }
  if (found) return 'not_their_claim';
  return typeof texts.unverified === 'string' && usersSpanIn(texts.unverified, quote) >= 0 ? 'retained' : 'absent';
}

/**
 * The figures a span writes: every single figure, in digits or spelled ("six mid-weight developers", by the one cardinal parser),
 * and every range it writes as one (`findJoinedRanges`: two figures JOINED as a range, low below high).
 * ⭐ G3 (TL 11:18Z): that join is a provenance check of the quote, not a meaning reader. "Cut legacy 25% to 15%" is high to low
 * and "six developers and 25% legacy" is not joined, so neither is a range; whether a joined pair is a range or a change is the
 * AI's own `form`. Unjoined figures never pair.
 */
export function figuresWritten(quote: string, unit?: string): readonly { readonly low: number; readonly high: number }[] {
  // The ONE located-amount reader (`amountsWrittenIn`): digits and words, a fraction or an ordinal never a count (Codex #3427 R4 SIMPLER),
  // through the SAME eligibility as the one check (`amountComplete`, in the statement's own unit where it has one;
  // Codex #3438 R5: no raw-word bypass at the verifier). A range is written only when BOTH its ends are (Codex #3438 R8: "20 ± 5 to
  // 10" is no range of 5 to 10).
  const amounts = amountsWrittenIn(quote).filter((a) => amountComplete(a, unit, quote)).sort((a, b) => a.index - b.index);
  return [...amounts.flatMap((a) => [{ low: a.magnitude, high: a.magnitude },
    ...(a.magnitude > 0 && statesLossBefore(quote, a.index) ? [{ low: -a.magnitude, high: -a.magnitude }] : [])]),
    ...findJoinedRanges(quote).filter((r) => amountComplete(r.low, unit, quote) && amountComplete(r.high, unit, quote))
      .map((r) => ({ low: r.low.magnitude, high: r.high.magnitude }))];
}

/**
 * ⭐ LEAN CORE (check 3; #3389 probe P2): every place the quote writes `figure` sits inside another speaker's paired quotation marks
 * ("A colleague said: “we lose 5% a month”"): the figure is that speaker's, never the user's, though the user typed the report.
 */
function figureOnlyInSpeech(quote: string, figure: number, unit: string): boolean {
  // The one reader's amounts and its ONE speaker rule (`inAnotherSpeakersWords`, every quote style, both forms; Codex #3427 R4 SIMPLER).
  // Where the quote writes the figure as a standalone, complete span (`amountComplete`, the figure list's own eligibility), only those places
  // count: words never credited ("… and twenty-odd hours") cannot make a quoted "120 hours" the user's (Codex #3438 R5).
  const at = amountsWrittenIn(quote).filter((a) => Math.abs(a.magnitude) === Math.abs(figure));
  const complete = at.filter((a) => amountComplete(a, unit, quote));
  const places = complete.length > 0 ? complete : at;
  return places.length > 0 && places.every((a) => inAnotherSpeakersWords(quote, a));
}


/**
 * ⭐ S4 NET LOSS (DL 15 Oct 06:43Z): "we're losing a net 15 members a month" states 15 AND, read as a net flow, −15: the same
 * figure with the opposite direction word, where the words state a NET flow. With no such words a negative is never the user's.
 * AIE 6187351293 (2a scope): "We lose 15 members a month" can be a gross count of 15 lost, so only a net flow states −15.
 */
const LOSS_BEFORE = /\b(?:(?:losing|lose|loses|lost) (?:a )?net|(?:a )?net (?:loss|outflow|decline|drop) of|(?:a )?deficit of)(?: (?:about|around|roughly|nearly|almost|some|over))?\s*$/iu;
export function statesLossBefore(quote: string, index: number): boolean {
  return LOSS_BEFORE.test(quote.slice(0, index));
}

/**
 * The span writes `unit` for its figure: straight after it (`unitWrittenAfter`), or, for money, the same currency on that amount
 * ("£54k" is £ and £k). A statement with no figure writes its unit only as words after nothing, so never.
 */
function unitWrittenIn(quote: string, end: number | undefined, unit: string, scale: number): boolean {
  if (end === undefined) return false;
  if (unitWrittenAfter(quote, end, unit)) return true;
  const code = readCurrencyUnitWithQualifiers(unit).currencyCode;
  return typeof code === 'string' && findStatedAmounts(quote).some((a) => a.kind === 'currency' && a.currencyCode === code
    && (Math.abs(a.magnitude) === Math.abs(end) || Math.abs(a.magnitude) === Math.abs(end * scale)));
}

/** Units whose figures are 0–1 shares of a whole: a percentage the user writes is that share ×100. */
const SHARE_UNITS: ReadonlySet<string> = new Set(['proportion', 'share', 'fraction']);

/**
 * The subject's current CORRECTION, as the correction door recorded it (`currentCorrectionOf`, statement-door/read.ts, read only): the
 * correction's own words and the spans it explicitly kept. Never written here.
 */
export interface CurrentCorrection {
  readonly correction: string;
  readonly kept: readonly string[];
}

/** What the AI cites for ONE value or statement: its span of the user's words, and its own reading of it. */
export type StatedClaim = StatementArgs;
export type StatedVerdict =
  /** The user's: their words, figure and sign. `unitIsUsers`: the span writes the AI's unit straight after the figure. */
  | { readonly origin: 'human'; readonly statement: UserStatement; readonly unitIsUsers: boolean }
  /**
   * ⛔ PL-0048 (1): a missing citation is NOT Olumi's authorship. No span, a span that is not the user's current claim, or a figure the
   * span does not write: `unknown` (source not verified). `ai` ONLY with positive evidence of Olumi's generation, through the writer's
   * existing carrier (`opts.ownEstimate`: the tool's own-estimate flag, or an Olumi-proposed record). Never relabelled either way.
   */
  | { readonly origin: 'ai' | 'unknown'; readonly refusal: StatedRefusal; readonly detail: string };
export type StatedRefusal = Extract<StatementsVerdict, { kind: 'refused' }>['refusal'] | 'no_quote';

/**
 * ⭐⭐ THE ONE AUTHORSHIP RULE (lean core, DL-3 18 Oct 2026; Paul's binding rule 2: no per-field matcher). A value or statement is the
 * USER'S only when the AI cites a span that is literally the user's own typed words (`usersOwnSpan`) and the value, unit and sign read
 * directly from that span (`figuresWritten`; a money unit's own scale letter reads "£54k" as 54 £k; the unit only where it is written
 * straight after the figure). Anything else is NOT the user's: its source is unknown, and it is Olumi's only where the writer
 * positively declares Olumi's own estimate (`ownEstimate`; PL-0048). Approval is recorded separately and never rewrites this origin.
 * A span the user's later correction retired (`current`, the subject's correction as recorded) is not theirs again. The form is the AI's reading
 * (`claim.form`), else the writer's field (`opts.form`), else what the claim gives (two ends: a range; one figure: a point; none: words
 * that describe). Every writer that records a value or statement as the user's calls this, and nothing else. Pure.
 */
export function userStated(claim: StatedClaim | null | undefined, texts: StatementTexts, subject: StatementSubject,
  opts: { readonly form?: StatementForm; readonly ownEstimate?: boolean; readonly current?: CurrentCorrection } = {}): StatedVerdict {
  // The one label authority (`authorshipOf`): not verified is unknown, unless Olumi's own estimate is positively declared.
  const notTheirs = (refusal: StatedRefusal, detail: string): StatedVerdict =>
    ({ origin: authorshipOf({ words: { verified: false, unknown: opts.ownEstimate !== true } }).origin === 'ai' ? 'ai' : 'unknown', refusal, detail });
  const quote = trimmed(claim?.quote, QUOTE_MAX);
  if (quote === undefined) return notTheirs('no_quote', 'No words of the user were quoted for this, so its source is not verified.');
  const given = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
  const form = STATEMENT_FORMS.find((f) => f === claim?.form) ?? opts.form
    ?? (given(claim?.low) && given(claim?.high) ? 'range' : given(claim?.value) ? 'point' : 'describes');
  const unit = trimmed(claim?.unit, 60);
  // The unit's own scale: a money unit's magnitude letter ("£k": ×1000), or a 0–1 share unit, which reads a written PERCENTAGE ("30%" is
  // 0.3 of a proportion; never a plain "30 people").
  const share = unit !== undefined && SHARE_UNITS.has(unit.toLowerCase());
  const scale = share ? 100 : unit === undefined ? 1 : readCurrencyUnitWithQualifiers(unit).multiplier ?? 1;
  const percentAt = (q: string, n: number): boolean => findStatedAmounts(q).some((a) => a.kind === 'percent' && Math.abs(a.magnitude - n) <= 1e-9 * Math.max(1, Math.abs(n)));
  const v = verifyStatement({ ...claim, quote, form }, texts, { subject, unit: unit ?? '', forms: STATEMENT_FORMS, figuresIn: figuresWritten,
    allowsZero: true, sameFigure: (q, a, b) => a === b || (scale > 1 && Math.abs(a * scale - b) <= 1e-9 * Math.max(1, Math.abs(b)) && (!share || percentAt(q, b))) }, opts.current);
  if (v.kind === 'refused') return notTheirs(v.refusal, v.detail);
  const { unit: _read, ...read } = v.statement;
  // An end read at the unit's own scale ("£54k" for 54 £k) is kept in the AI's unit, the figure the user wrote.
  const claimed = [claim?.value, claim?.low, claim?.high].filter((n): n is number => typeof n === 'number');
  const inUnit = (n: number | undefined): number | undefined => (n !== undefined && scale > 1 && !claimed.includes(n) && claimed.some((c) => Math.abs(c * scale - n) <= 1e-9 * Math.max(1, Math.abs(n))) ? n / scale : n);
  const rest = { ...read, ...(read.low !== undefined ? { low: inUnit(read.low)! } : {}), ...(read.high !== undefined ? { high: inUnit(read.high)! } : {}) };
  const unitIsUsers = unit !== undefined && unitWrittenIn(quote, rest.high ?? rest.low, unit, scale);
  if (unit !== undefined && !unitIsUsers && writtenInAnotherUnit(quote, claimed, unit, scale)) {
    return notTheirs('figure_not_in_quote', `“${quote}” writes that figure in another unit than ${unit}, so it is not the user's figure in ${unit}. `
      + 'Nothing was prepared. Use the unit their words write after the figure.');
  }
  return { origin: 'human', statement: unitIsUsers ? { ...rest, unit } : rest, unitIsUsers };
}

/**
 * ⛔ RULE POINT 5, THE UNIT (BUDDY-A #3356 R1 B1; AIQ 5894808343 (1d); verify of f41c3c30 B1/B2): a figure the span writes in ANOTHER
 * unit than the AI's is not the user's figure in that unit ("between 4 and 6 lb a day" is never 4–6 kg, "$650" never £650, "30%" never
 * 30 people). Two existing readers decide, on the cited span only, never the user's whole text: the stated-figure rule
 * (`figureTheUserWroteSpan`: the same currency, a percentage or a 0–1 share, a plain number's unit word of another family, a money
 * scale letter) for each end written in digits, and, for a unit of time or measure, the value-unit verdict
 * (`classifyValueUnitAgainstFactor`: the word after the figure is that family's unit or ordinary prose, never an unread unit). A figure
 * with no unit written is still the user's; its unit is Olumi's reading (`unitIsUsers` false).
 */
function writtenInAnotherUnit(quote: string, claimed: readonly number[], unit: string, scale: number): boolean {
  const family = unitPhraseFamily(unit);
  const head = unitPhraseHead(unit) ?? unit;
  const money = readCurrencyUnitWithQualifiers(unit).kind === 'currency';
  return claimed.some((n) => {
    const size = Math.abs(n);
    const at = findStatedAmounts(quote).filter((a) => [size, size * scale].some((s) => Math.abs(Math.abs(a.magnitude) - s) <= 1e-9 * Math.max(1, s)));
    // A count in words ("six") is never money or a percentage, which are written with their unit (the stated-figure rule's own reading).
    if (at.length === 0) return money || family === 'currency' || family === 'percent';
    // An amount written in a currency is never a figure in a unit that is not money (the brief rule's own class, `isAmountStatedInBrief`).
    if (!money && at.every((a) => a.kind === 'currency')) return true;
    if (figureTheUserWroteSpan(size, unit, quote) === null) return true;
    return (family === 'time' || family === 'metric') && !classifyValueUnitAgainstFactor(quote, head, size).resolved;
  });
}

/**
 * ⭐ ONE statement, verified or refused on its own (SYSTEM 1's door and SYSTEM 2's construction map, PROMPT sys2 §2): a quote
 * must stand as a WHOLE statement in the user's own verified words, and its figure must be one the quote states.
 */
export function verifyStatement(given: StatementArgs | null | undefined, texts: StatementTexts, rules: StatementRules, current?: CurrentCorrection): StatementVerdict {
  const malformed = (detail: string): StatementVerdict => ({ kind: 'refused', refusal: 'statement_malformed', detail });
  const same = rules.sameFigure ?? ((_q: string, a: number, b: number) => a === b);
  const quote = trimmed(given?.quote, QUOTE_MAX);
  const form = STATEMENT_FORMS.find((f) => f === given?.form && rules.forms.includes(f));
  if (quote === undefined || form === undefined) {
    return malformed(`Each statement needs the user's exact words (quote) and one form of: ${rules.forms.join(', ')}. Nothing was prepared.`);
  }
  // ⭐ CLAIM RECORD (spec v2 rule 6; AIE 13:10Z ruling 1, 14:00Z ORIGIN): the AI's reading of WHO asserts the claim is kept, never
  // vetoed. Words it reads as another speaker's are that party's claim, relayed by the user; words it cannot place stay unresolved.
  // Only the user's own reading can be theirs, and only on their literal span (below). Olumi's own estimates are not statements.
  // Every caller but the claim door (`rules.claims`) asks "did the USER state this?": there, another speaker's or an unresolved reading
  // is never theirs (LEAN CORE P2, unchanged). The claim door keeps it as that claim instead (spec v2 rule 6).
  if (rules.claims !== true && (given?.speaker === 'other' || given?.speaker === 'unknown')) {
    return { kind: 'refused', refusal: 'statement_not_found', detail: `You read “${quote}” as ${given.speaker === 'other' ? 'someone else\u2019s words or view, reported by the user' : 'words whose speaker you cannot tell'}, so they are not the user's own statement and nothing was prepared. Their words stay as said, with that speaker.` };
  }
  const claims = rules.claims === true;
  const given_by = claims ? claimSourceOf(given) : { said_by: 'user' as const };
  if (given_by === undefined) return malformed(`Give who asserts “${quote}”: the user, a named party, or unresolved. Nothing was prepared.`);
  // ⭐ THE ONE AUTHORSHIP RULE (lean core, DL-3 18 Oct): the span is the user's own words, literally, in a verified message.
  const said = usersOwnSpan(texts, quote, current);
  // Another party's or an unresolved claim needs its words held: typed by the user (they relayed it) or retained, origin unverified
  // (relay unknown). The user's own claim needs their literal span, as before. In the claim door only words the user's own messages
  // report as Olumi's, disputed or withdrawn are refused; every other miss is the claim's label (below).
  if (said !== 'theirs' && (claims ? said === 'not_their_claim' : given_by.said_by === 'user' || said !== 'retained')) {
    return said === 'retained'
      ? { kind: 'refused', refusal: 'origin_unknown', detail: `The words “${quote}” are retained, but their origin is not verified, so nothing was prepared. Ask the user to confirm that figure in their own words.` }
      : said === 'not_their_claim'
        ? { kind: 'refused', refusal: 'statement_not_found', detail: `“${quote}” is reported as Olumi’s, disputed, or withdrawn in the user’s own messages, so it is not their statement and nothing was prepared.` }
        : { kind: 'refused', refusal: 'statement_not_found', detail: `“${quote}” is not in the user's own words, so nothing was prepared. Quote their words, verbatim, from any of their messages.` };
  }
  // ⭐ GATE → LABEL: in the claim door, words held with their origin unverified are never the user's own claim, and words found in no
  // message cannot be placed as anyone's: each is an unresolved claim (spec v2 ORIGIN), labelled, never refused.
  const wordsFound = said === 'theirs' || said === 'retained';
  const unresolved = { said_by: 'unknown' as const };
  let by: NonNullable<ReturnType<typeof claimSourceOf>> = claims && (!wordsFound || (said === 'retained' && given_by.said_by === 'user'))
    ? unresolved : given_by;
  // ⭐ LEAN CORE P2 (C2): words that END in another speaker's quoted words are a report: quoting an entire report does not transfer its
  // embedded claim (AIE). The AI's speaker reading only ever subtracts credit, so an explicit `user` reading never exempts it (Founder
  // 05:46 evidence row: an explicit speaker=user requote of a whole reported line became a "your words" card). The claim door keeps it
  // as an unresolved claim instead: the words do not name who asserts it.
  if (by.said_by === 'user' && form === 'describes' && endsInQuotedSpeech(quote)) {
    if (!claims) return { kind: 'refused', refusal: 'statement_not_found', detail: `“${quote}” ends in another speaker's quoted words, so it reports their claim, not the user's own statement. Nothing was prepared. Their words stay as said.` };
    by = unresolved;
  }
  const theirs = by.said_by === 'user';
  const relayed: 'user' | 'unknown' = said === 'theirs' && by.relayed_by !== 'unknown' ? 'user' : 'unknown';
  const source = verbatimSourceLine({ now: texts.now, conversation: texts.conversation }, quote) ?? quote;
  const qualifier = trimmed(given?.qualifier, 80);
  const conditions = trimmed(given?.conditions, 160);
  // The ask's own words, whole: a cohort option's forecast ask (both questions, its label twice) runs past 500 characters, and a
  // longer cap's silent drop lost the binding the writer re-checks (M4-cohort).
  const answering = trimmed(given?.answering, 1000);
  const negated = given?.negated === true;
  const givenUnit = rules.unitWritten === true ? trimmed(given?.unit, 60) : undefined;
  if (rules.unitWritten === true && givenUnit === undefined) return malformed(`Give the unit “${quote}” writes after its figure, as unit. Nothing was prepared.`);
  const anotherSpeaker = (figureWords: string): StatementVerdict => ({ kind: 'refused', refusal: 'statement_not_found',
    detail: `In “${quote}”, ${figureWords} is in another speaker's quoted words, so it is not the user's own figure. Nothing was prepared.` });
  // ⛔ A span cut from inside a line never drops the bound the user wrote on its own figure (the confirmed widening's limit; ebd S2 row):
  // "7 months" out of "At least 7 months" is not their point. The estate's one comparator reader reads the line and the span alike.
  // Read in the span's own sentence of its line only: the same figure elsewhere on the line ("at least 55%" in another sentence) is not its bound.
  const spanSentence = sentenceAroundSpan(source, quote);
  const dropsBound = (figure: number): boolean => spanSentence !== undefined && comparatorTheUserWroteFor(spanSentence, Math.abs(figure)) !== null
    && comparatorTheUserWroteFor(quote, Math.abs(figure)) === null;
  const boundDropped = (figureWords: string): StatementVerdict => ({ kind: 'refused', refusal: 'statement_not_found',
    detail: `“${quote}” leaves out the bound the user wrote on ${figureWords} (“${source}”), so it is not their statement. Quote their words with it. Nothing was prepared.` });
  const unitRefused = (said: string): StatementVerdict => ({ kind: 'refused', refusal: 'figure_not_in_quote',
    detail: `“${quote}” does not state ${said} in ${givenUnit}: the unit read is the one written after the figure. Quote the words that state it. Nothing was prepared.` });
  // Who asserts it: the user's own claim keeps today's bytes (`speaker`); any other carries `said_by` (and a party its name and relay).
  const assertedBy = (b: typeof by) => (b.said_by === 'user' ? { speaker: 'user' as const }
    : b.said_by === 'party' ? { said_by: 'party' as const, party: b.party!, relayed_by: relayed } : { said_by: b.said_by });
  const core = { quote, source, subject: rules.subject, form, unit: givenUnit ?? rules.unit,
    ...(rules.reference !== undefined ? { reference: rules.reference } : {}), ...(rules.period !== undefined ? { period: rules.period } : {}),
    ...(qualifier !== undefined ? { qualifier, qualifier_in_quote: plainQuoteWords(quote).toLowerCase().includes(plainQuoteWords(qualifier).toLowerCase()) } : {}),
    ...(negated ? { negated: true as const } : {}), ...(conditions !== undefined ? { conditions } : {}),
    ...(answering !== undefined ? { answering } : {}), reading: 'olumi' as const };
  // Recording a measure/source may retain numbers in its words; using them to ground a figure-free estimate may not.
  if (form === 'describes' && rules.describesNumericEstimate === true && rules.figuresIn(quote, rules.unit).length > 0) return { kind: 'refused', refusal: 'figure_not_in_quote',
    detail: 'These words state a figure for this quantity. Use the figure-bearing form in its stated unit, rather than a figure-free description. Nothing was prepared.' };
  /**
   * ⭐ GATE → LABEL (change 1; Codex co-design §1): the claim door's statement with its word checks as LABELS, only where one failed
   * (a claim whose checks all pass keeps today's bytes). A figure the words do not write is kept as Olumi's reading of them, its ends as
   * given, and never reads as "you said" (`youSaid`); a figure only in another speaker's quoted words is an unresolved claim.
   */
  const labelled = (ends: { low?: number; high?: number }, figureFound: boolean, inSpeech = false): StatementVerdict => {
    const statement = { ...assertedBy(inSpeech ? unresolved : by), ...core, ...ends };
    return { kind: 'verified', statement: wordsFound && figureFound ? statement
      : { ...statement, checks: { words_found: wordsFound, figure_found: figureFound, unit_found: figureFound } } };
  };
  // No figure of the user's to check: a condition that holds now, or words that describe the quantity (never a number of theirs).
  if (FIGURE_FREE.has(form)) return labelled({}, true);
  const stated = rules.figuresIn(quote, rules.unit);
  if (form === 'range') {
    const low = figure(given?.low, rules.allowsZero), high = figure(given?.high, rules.allowsZero);
    if (low === undefined || high === undefined || !(low < high)) return malformed(`A range needs low below high, as “${quote}” states them. Nothing was prepared.`);
    const read = stated.find((r) => r.low < r.high && same(quote, low, r.low) && same(quote, high, r.high));
    if (read === undefined) {
      return claims ? labelled({ low, high }, false)
        : { kind: 'refused', refusal: 'figure_not_in_quote', detail: `“${quote}” does not state ${low}–${high} ${rules.unit}. Quote the words that state it. Nothing was prepared.` };
    }
    const inSpeech = theirs && figureOnlyInSpeech(quote, read.high, rules.unit);
    if (inSpeech && !claims) return anotherSpeaker(`${low}–${high}`);
    if (dropsBound(read.low) || dropsBound(read.high)) return boundDropped(`${low}–${high}`);
    if (givenUnit !== undefined && !unitWrittenAfter(quote, read.high, givenUnit)) return unitRefused(`${low}–${high}`);
    return labelled({ low: read.low, high: read.high }, true, inSpeech);
  }
  // A negative is a figure only where the quote's own words state it as one (`figuresIn`: a net loss, S4); never the Agent's sign.
  const signed = typeof given?.value === 'number' && given.value < 0 && stated.some((r) => r.low === given.value && r.high === given.value)
    ? given.value : undefined;
  const value = figure(given?.value, rules.allowsZero) ?? signed;
  if (value === undefined) return malformed(`A ${form.replace('_', ' ')} needs the one figure “${quote}” states, as value. Nothing was prepared.`);
  const end = stated.flatMap((r) => (r.low === r.high ? [r.low] : [r.low, r.high])).find((s) => same(quote, value, s));
  const endsOf = (x: number) => (form === 'point' ? { low: x, high: x } : form === 'lower_bound' ? { low: x } : { high: x });
  if (end === undefined) {
    return claims ? labelled(endsOf(value), false)
      : { kind: 'refused', refusal: 'figure_not_in_quote', detail: `“${quote}” does not state ${value} ${rules.unit}. Quote the words that state it. Nothing was prepared.` };
  }
  const inSpeech = theirs && figureOnlyInSpeech(quote, end, rules.unit);
  if (inSpeech && !claims) return anotherSpeaker(String(value));
  if (dropsBound(end)) return boundDropped(String(value));
  if (givenUnit !== undefined && !unitWrittenAfter(quote, end, givenUnit)) return unitRefused(String(value));
  return labelled(endsOf(end), true, inSpeech);
}

/** Words `text` writes verbatim on one line, kept with speaker unknown for `subject`: no figure, unit or sign. `undefined` if not written. */
export function unknownSpeakerWords(quote: unknown, text: string, subject: StatementSubject): UserStatement | undefined {
  const q = trimmed(quote, 400);
  const source = q === undefined ? undefined : verbatimSourceLine({ now: text }, q);
  return q === undefined || source === undefined ? undefined : { speaker: 'unknown', quote: q, source, subject, form: 'describes', reading: 'olumi' };
}

/** Every statement verified, or the first refusal (all or nothing, for a chat card); then one set of conditions only. */
export function verifyStatements(raw: unknown, texts: StatementTexts, rules: StatementRules): StatementsVerdict {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_STATEMENTS) {
    return { kind: 'refused', refusal: 'statement_malformed', detail: `Give one to ${MAX_STATEMENTS} statements, each the user's exact words with your reading of them. Nothing was prepared.` };
  }
  const out: UserStatement[] = [];
  for (const given of raw as StatementArgs[]) {
    const v = verifyStatement(given, texts, rules);
    if (v.kind === 'refused') return v;
    out.push(v.statement);
  }
  const conditionsOf = (s: UserStatement): string => plainQuoteWords(s.conditions ?? '').toLowerCase();
  if (new Set(out.map(conditionsOf)).size > 1) {
    return { kind: 'refused', refusal: 'different_conditions', detail: 'These statements are about different conditions, so they cannot be combined into one figure. '
      + 'Propose only the statements about today\'s situation, or ask the user which conditions the model should use. Nothing was prepared.' };
  }
  return { kind: 'verified', statements: out };
}

export type CombinedEnds =
  /** Both ends are HARD ends the user gave ("at least 7", "no more than 9"): the user's own range. */
  | { readonly kind: 'range'; readonly low: number; readonly high: number }
  /** One figure and no end at all: the only case where a tool may add its own labelled spread. */
  | { readonly kind: 'point'; readonly value: number; readonly statement: UserStatement }
  /**
   * ⭐ AIE #94 6174707160: what the user said is kept AS STATED, but it is not two hard ends: a lone bound, or a qualified end
   * ("8 months as a likely upper end, not the latest possible time"). No end is chosen for them, no percentile is assumed and
   * no number is picked to open the Run; `needs` is the one hard end still missing, the next useful question.
   */
  | { readonly kind: 'held'; readonly needs: 'upper' | 'lower'; readonly hard_end?: { readonly end: 'lower' | 'upper'; readonly months: number } }
  | { readonly kind: 'conflict'; readonly detail: string };

/** The ends the statements give, hard apart from qualified. A negated statement ("not 7 months") gives no end. */
export function combineStatementEnds(statements: readonly UserStatement[]): CombinedEnds {
  const used = statements.filter((s) => s.negated !== true && !FIGURE_FREE.has(s.form));
  const isLow = (s: UserStatement): boolean => (s.form === 'lower_bound' || s.form === 'range') && s.low !== undefined;
  const isHigh = (s: UserStatement): boolean => (s.form === 'upper_bound' || s.form === 'range') && s.high !== undefined;
  const hard = (s: UserStatement): boolean => s.qualifier === undefined;
  const distinct = (xs: readonly UserStatement[], end: 'low' | 'high'): number[] => [...new Set(xs.map((s) => s[end]!))];
  const two = (xs: number[], what: string): CombinedEnds | null => (xs.length > 1
    ? { kind: 'conflict', detail: `The user's words give two different ${what} (${xs.join(' and ')}). Ask which one holds.` } : null);
  const hardLows = distinct(used.filter((s) => isLow(s) && hard(s)), 'low'), softLows = distinct(used.filter((s) => isLow(s) && !hard(s)), 'low');
  const hardHighs = distinct(used.filter((s) => isHigh(s) && hard(s)), 'high'), softHighs = distinct(used.filter((s) => isHigh(s) && !hard(s)), 'high');
  const points = distinct(used.filter((s) => s.form === 'point' && s.low !== undefined), 'low');
  const clash = two(hardLows, 'lower ends') ?? two(hardHighs, 'upper ends') ?? two(softLows, 'likely lower ends') ?? two(softHighs, 'likely upper ends');
  if (clash !== null) return clash;
  const low = hardLows[0], high = hardHighs[0];
  if (low !== undefined && high !== undefined && !(low < high)) {
    return { kind: 'conflict', detail: `The user's lower end (${low}) is not below their upper end (${high}). Ask which one holds.` };
  }
  // Every other figure the user gave must sit inside their own hard ends.
  const outside = [...points, ...softLows, ...softHighs].find((p) => (low !== undefined && p < low) || (high !== undefined && p > high));
  if (outside !== undefined) return { kind: 'conflict', detail: `The user's figure ${outside} falls outside their own bound. Ask which one holds.` };
  if (low !== undefined && high !== undefined) return { kind: 'range', low, high };
  if (low !== undefined || high !== undefined || softLows.length > 0 || softHighs.length > 0) {
    return { kind: 'held', needs: high === undefined ? 'upper' : 'lower',
      ...(low !== undefined ? { hard_end: { end: 'lower' as const, months: low } } : high !== undefined ? { hard_end: { end: 'upper' as const, months: high } } : {}) };
  }
  if (points.length > 1) return { kind: 'conflict', detail: `The user's words give different figures (${points.join(' and ')}). Ask which one holds.` };
  if (points.length === 1) return { kind: 'point', value: points[0]!, statement: used.find((s) => s.form === 'point')! };
  return { kind: 'conflict', detail: 'None of these statements gives a figure. Quote the words that state one.' };
}

/**
 * A statement as stored (a card's operation, a carrier's `statements`), read back as the contract's type, or `undefined` if it is
 * not one. The ONE reader, so no caller double-casts stored bytes into a statement (the forbidden-boundary gate).
 */
/**
 * The AI's reading of who asserts a statement (`said_by`, else its P2 `speaker` reading): the user (also when no reading is given, as
 * before), a party it names (`party`, as written; without a name the source is unresolved), or unresolved. `undefined` for any other
 * reading, Olumi's own estimate included: that is proposed as an assumption, never as the user's statement.
 */
function claimSourceOf(given: StatementArgs | null | undefined): { readonly said_by: 'user' | 'party' | 'unknown'; readonly party?: string; readonly relayed_by?: 'user' | 'unknown' } | undefined {
  const reading = given?.said_by ?? (given?.speaker === 'other' ? 'party' : given?.speaker);
  const party = trimmed(given?.party, 200);
  const relayedBy = given?.relayed_by === 'unknown' ? 'unknown' as const : undefined;
  if (reading === undefined || reading === 'user') return { said_by: 'user' };
  if (reading === 'unknown' || (reading === 'party' && party === undefined)) return { said_by: 'unknown' };
  return reading === 'party' ? { said_by: 'party', party: party!, ...(relayedBy !== undefined ? { relayed_by: relayedBy } : {}) } : undefined;
}

/** Who asserts a claim's figure: its own `said_by`, else its legacy `speaker` (the user's, or unresolved). */
export const saidByOf = (s: Pick<UserStatement, 'said_by' | 'speaker'>): SaidBy => s.said_by ?? (s.speaker === 'user' ? 'user' : 'unknown');

/** A claim's identity, status, supersession, approval and check labels, each only where stored; `undefined` if any is malformed. */
function claimFieldsOf(r: Record<string, unknown>): Partial<Pick<UserStatement, 'claim_id' | 'status' | 'supersedes' | 'approval' | 'checks' | 'attested'>> | undefined {
  const id = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= 200;
  const status = CLAIM_STATUSES.find((x) => x === r.status);
  const a = r.approval, c = r.checks;
  const approval = a !== null && typeof a === 'object' && !Array.isArray(a) && id((a as Record<string, unknown>).proposal_id)
    ? { proposal_id: (a as Record<string, unknown>).proposal_id as string } : undefined;
  const cr = c !== null && typeof c === 'object' && !Array.isArray(c) ? c as Record<string, unknown> : undefined;
  const checks = cr !== undefined && (['words_found', 'figure_found', 'unit_found'] as const).every((k) => typeof cr[k] === 'boolean')
    && (cr.subject_bound === undefined || typeof cr.subject_bound === 'boolean')
    ? { words_found: cr.words_found as boolean, figure_found: cr.figure_found as boolean, unit_found: cr.unit_found as boolean,
      ...(typeof cr.subject_bound === 'boolean' ? { subject_bound: cr.subject_bound } : {}) } : undefined;
  if ((r.claim_id !== undefined && !id(r.claim_id)) || (r.status !== undefined && status === undefined)
    || (r.supersedes !== undefined && !(Array.isArray(r.supersedes) && r.supersedes.every(id)))
    || (a !== undefined && approval === undefined) || (c !== undefined && checks === undefined)) return undefined;
  const t = r.attested;
  const attested = t !== null && typeof t === 'object' && !Array.isArray(t) && Object.values(t).every((x) => typeof x === 'boolean'
    || (typeof x === 'string' && x.length <= 200) || (typeof x === 'number' && Number.isFinite(x))) ? { ...(t as Record<string, string | number | boolean>) } : undefined;
  if (t !== undefined && attested === undefined) return undefined;
  return { ...(id(r.claim_id) ? { claim_id: r.claim_id } : {}), ...(status !== undefined ? { status } : {}),
    ...(Array.isArray(r.supersedes) ? { supersedes: [...r.supersedes as string[]] } : {}),
    ...(approval !== undefined ? { approval } : {}), ...(checks !== undefined ? { checks } : {}), ...(attested !== undefined ? { attested } : {}) };
}

export function userStatementOf(v: unknown): UserStatement | undefined {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  const subject = r.subject !== null && typeof r.subject === 'object' && !Array.isArray(r.subject) ? r.subject as Record<string, unknown> : undefined;
  const form = STATEMENT_FORMS.find((f) => f === r.form);
  const optional = (k: string): string | undefined => (typeof r[k] === 'string' ? r[k] as string : undefined);
  const end = (k: string): number | undefined => (typeof r[k] === 'number' && Number.isFinite(r[k]) ? r[k] as number : undefined);
  const unknownWords = r.speaker === 'unknown' && form === 'describes' && [r.low, r.high, r.unit, r.negated].every((x) => x === undefined);
  // The two legacy-legal speakers; any other `speaker` is malformed. A stored `said_by` must agree with the speaker beside it.
  const legacy: 'user' | 'unknown' | undefined = r.speaker === 'user' ? 'user' : unknownWords ? 'unknown' : undefined;
  const saidBy = SAID_BY.find((x) => x === r.said_by);
  const by = saidBy ?? legacy;
  if ((r.speaker !== undefined && legacy === undefined) || (r.said_by !== undefined && saidBy === undefined) || by === undefined
    || (legacy !== undefined && saidBy !== undefined && legacy !== saidBy)) return undefined;
  const party = trimmed(r.party, 200);
  const relayedBy = r.relayed_by === 'user' || r.relayed_by === 'unknown' ? r.relayed_by : undefined;
  if (by === 'party' ? party === undefined || relayedBy === undefined : r.party !== undefined || r.relayed_by !== undefined) return undefined;
  if (r.reading !== 'olumi' || typeof r.quote !== 'string' || typeof r.source !== 'string' || form === undefined
    || subject === undefined || typeof subject.quantity !== 'string') return undefined;
  const claim = claimFieldsOf(r);
  if (claim === undefined) return undefined;
  const low = end('low'), high = end('high'), qualifier = optional('qualifier'), conditions = optional('conditions');
  return { ...(legacy !== undefined ? { speaker: legacy } : {}), ...(saidBy !== undefined ? { said_by: saidBy } : {}),
    ...(party !== undefined ? { party } : {}), ...(relayedBy !== undefined ? { relayed_by: relayedBy } : {}),
    ...(end('value') !== undefined ? { value: end('value') } : {}), ...claim,
    quote: r.quote, source: r.source, form, reading: 'olumi',
    subject: { quantity: subject.quantity, ...(typeof subject.node_id === 'string' ? { node_id: subject.node_id } : {}),
      ...(typeof subject.option_id === 'string' ? { option_id: subject.option_id } : {}) },
    ...(low !== undefined ? { low } : {}), ...(high !== undefined ? { high } : {}),
    ...(optional('unit') !== undefined ? { unit: optional('unit') } : {}), ...(optional('reference') !== undefined ? { reference: optional('reference') } : {}),
    ...(optional('period') !== undefined ? { period: optional('period') } : {}),
    ...(qualifier !== undefined ? { qualifier, ...(typeof r.qualifier_in_quote === 'boolean' ? { qualifier_in_quote: r.qualifier_in_quote } : {}) } : {}),
    ...(r.negated === true ? { negated: true as const } : {}), ...(conditions !== undefined ? { conditions } : {}),
    ...(optional('answering') !== undefined ? { answering: optional('answering') } : {}) };
}

/** How a statement's reading reads on a card: "at least 7 months", "a likely upper end of 8 months". */
export function statementReadingWords(s: UserStatement, unit: string): string {
  const q = s.qualifier !== undefined ? `${s.qualifier} ` : '';
  if (s.form === 'lower_bound') return `a ${q}lower end of ${s.low} ${unit}`;
  if (s.form === 'upper_bound') return `a ${q}upper end of ${s.high} ${unit}`;
  if (s.form === 'range') return `a ${q}range of ${s.low}–${s.high} ${unit}`;
  if (s.form === 'point') return `${q}${s.low} ${unit}`;
  return s.form === 'describes' ? 'your description' : s.form === 'holds_in_window' ? 'your forecast that it holds during the period'
    : 'a condition that holds now';
}
