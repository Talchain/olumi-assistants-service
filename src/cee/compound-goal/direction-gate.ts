/**
 * ROADMAP 2.1051 — THE CONSTRAINT-DIRECTION SEMANTIC GATE.
 *
 * A user's hard limit must never reach the wire pointing the wrong way. This is
 * the THIRD source-agnostic partition at the compound-goals merge point, beside
 * `partitionTemporalNonBinding` (2.349) and `partitionRiskFramedInversions`
 * (2.653), and it exists for the same reason both of those do: two producers —
 * this service's regex extractor and the drafting model — are taught the SAME
 * defective rule (map the comparator word to the operator, ignore the negation),
 * so fixing either one leaves the other minting the identical lie.
 *
 * ── WHY A GATE AND NOT A SIXTH PARSING RULE ────────────────────────────────
 *
 * Five consecutive rounds of window/punctuation heuristics inside the extractor
 * each fixed one direction and re-opened the other (CLAUDE.md trap 22f). The
 * ruling that closed that loop: `", and"` is genuinely ambiguous between
 * interruption and new clause, the discriminators had become two arbitrary
 * length constants with hard cliffs, and NO FURTHER PUNCTUATION-ONLY RULE WILL
 * SETTLE IT. The exit is to make the AMBIGUITY THE PRODUCT — where direction
 * cannot be determined, ASK rather than guess.
 *
 * This module is that exit. It contains NO window constants, NO length cliffs
 * and NO clause-governance predicate. It never re-attempts the unwinnable
 * question ("which clause does this negation govern?"). It asks only the
 * question it can answer: "is this row's direction PROVEN?"
 *
 * ── THE TRICHOTOMY — EXACTLY THREE OUTCOMES AND NO FOURTH ──────────────────
 *
 * The gate TERMINATES this problem rather than suppressing it. Every bound that
 * enters lands in exactly one bucket, and the three buckets PARTITION the input
 * exactly (asserted, not asserted-about — see {@link partitionUnprovenDirection}):
 *
 *   1. PROVEN      — direction demonstrated -> modelled, reaches the wire.
 *   2. UNRESOLVED  — direction ambiguous or contested -> withheld from the wire
 *                    AND surfaced as a clarification the user can answer.
 *   3. NON-LIMIT   — never a bound at all (a possibility-framed estimate the
 *                    extractor mis-read as a limit) -> declined, COUNTED and
 *                    LOGGED with its reason, never silently discarded.
 *
 * There is no fourth outcome. In particular there is no "dropped quietly"
 * bucket: bucket 2 always carries a user-answerable question, and bucket 3 is
 * counted in the partition assertion and in telemetry.
 *
 * ── BLAST RADIUS (the ratified house contract, copied from risk-polarity.ts) ─
 *
 *   - NEVER MINTS a row, not even when the evidence proves a direction for text
 *     that produced no row.
 *   - NEVER FLIPS an operator. A contradicted row is WITHHELD and ASKED ABOUT,
 *     never silently corrected. The gate has no minting authority, so a gate
 *     defect can create a spare question — it cannot create a lie.
 *   - NEVER CHANGES a value, unit, node binding or frame.
 *
 * The worst case this module can produce is the pre-constraint product plus a
 * visible question. That is provably bounded, and it is the trade the trap-22f
 * ruling already made.
 *
 * ── WHAT IS HAND-MAINTAINED HERE, AND WHAT NOTICES IT IS SHORT ─────────────
 *
 * ⚠ {@link NEG_CORE_SRC} and the T1 table are HAND-WRITTEN LISTS, and nothing
 * derived from them can notice a construction missing FROM them (trap 12d,
 * second face: derivation proves agreement, never completeness). The instrument
 * that CAN notice is the hand-written corpus in
 * `__tests__/direction-gate-corpus.test.ts`, whose cases come from OUTSIDE this
 * lane's head — the Codex F1 audit and the #888 review corpora — because four
 * successive corpora have each spelled negation the same way and each missed a
 * class the next one found (trap 22).
 *
 * ⚠ AND THE SHARED ALPHABETS ARE IMPORTED, NEVER COPIED. `AMT`, `NEGATION_LEAD`,
 * `NEGATION_OR_PREVENTION_LEAD`, `FALL_VERB` and `parseValue` come from
 * `extractor.ts`, and `POSSIBILITY_MARKER_SRC` from `risk-polarity.ts`. A copied
 * alphabet is the hand-maintained mirror this estate keeps paying for: the gate
 * would drift from the producer it screens and the drift would read as green.
 *
 * Pure, no I/O, every function exported for direct test.
 */

import {
  AMT,
  FALL_VERB,
  NEGATION_LEAD,
  NEGATION_OR_PREVENTION_LEAD,
  parseValue,
} from './extractor.js';
import { POSSIBILITY_MARKER_SRC } from './risk-polarity.js';

/* ===========================================================================
 * TYPES
 * ========================================================================= */

/** The direction a construction proves. `band` is the paired `between X and Y`. */
export type ProvenDirection = 'floor' | 'ceiling' | 'band';

/**
 * Why a bound could not be proven. Machine-readable and STABLE — this is the
 * discriminator a future elicitation surface keys on, so it is part of the
 * contract, not a log string.
 */
export type UnresolvedReason =
  /** No `source_quote` and no `label` — nothing to read a direction from. */
  | 'no_evidence'
  /** The user said in so many words that they had not decided. */
  | 'explicit_ambiguity'
  /** A construction proves a direction and the row's operator states the other. */
  | 'evidence_contradiction'
  /** A negation is present in the sentence and unaccounted for. */
  | 'unspent_negation'
  /** Two producers put opposite operators on one node, and it is not a band. */
  | 'producer_disagreement';

/** Why a row was declined as never having been a limit. */
export type NonLimitReason = 'possibility_framed_delta' | 'range_valued_delta';

/**
 * A bound whose direction the gate could not prove.
 *
 * ⭐ SHAPED FOR REUSE, NOT FOR ONE CARD. The fields answer the three questions
 * any "Olumi needs your input" elicitation surface has to render — WHAT is
 * unresolved (`reason`, `question`), WHICH FACTOR (`metric_text`, `node_label`),
 * and WHAT THE USER COULD STATE (`options`, `amount_text`) — so the coaching
 * card is a RENDERING of this record rather than the record itself. A later
 * surface consumes the same objects without a second extraction pass.
 *
 * Every text field is composed from the USER'S OWN WORDS (labels, quotes,
 * amounts) and never from node ids, so the record survives
 * `scanCoachingForIdLeakage` unchanged.
 */
export interface DirectionUnresolvedItem {
  /** The metric in the user's own words ("gross margin"). Never a node id. */
  readonly metric_text: string;
  /** The quantity as the user wrote it ("78%", "£320,000"). */
  readonly amount_text: string;
  /** The parsed value, when the row carried one. */
  readonly value: number | null;
  /** The parsed unit, when the row carried one. */
  readonly unit: string | null;
  /** Which of the five failures applies. */
  readonly reason: UnresolvedReason;
  /** The user-answerable question, surface-agnostic. */
  readonly question: string;
  /** The candidate answers, in a fixed order, for a choice control. */
  readonly options: readonly string[];
  /** The graph node's display label, when one is known. Never an id. */
  readonly node_label?: string;
}

/** The minimal row shape this gate reads. Both producers' entries satisfy it. */
export interface GateableConstraint {
  readonly node_id?: unknown;
  readonly operator?: unknown;
  readonly value?: unknown;
  readonly unit?: unknown;
  readonly label?: unknown;
  readonly source_quote?: unknown;
  readonly value_frame?: unknown;
}

/** One withheld row plus the reason it was withheld. */
export interface UnresolvedEntry<T> {
  readonly constraint: T;
  readonly reason: UnresolvedReason;
  readonly item: DirectionUnresolvedItem;
}

/** One declined row plus the reason it was never a limit. */
export interface NonLimitEntry<T> {
  readonly constraint: T;
  readonly reason: NonLimitReason;
}

/** A bound the brief states but no producer emitted a row for. */
export interface UncoveredNegatedBound {
  readonly metric_text: string;
  readonly amount_text: string;
  readonly sentence_index: number;
}

/* ===========================================================================
 * 3.1 — NORMALISATION AND SENTENCE SCOPE
 * ========================================================================= */

/**
 * Normalise the typography the extractor is blind to.
 *
 * The audit's a2 class is a CURLY APOSTROPHE and nothing else: `Don’t` inverts
 * where `Don't` would not, because every pattern in the estate spells the
 * straight quote only. Normalising here kills that class for the gate even
 * though the extractor stays blind to it — which is the whole point of gating
 * after the producers rather than patching one of them.
 */
export function normaliseEvidenceText(raw: string): string {
  return raw
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sentence terminators.
 *
 * ⚠ THE `\s` GUARD IS LOAD-BEARING AND GUARDS TWO NUMBER FORMATS: the decimal
 * point (`£1.5 million`) and the thousands separator (`1,500,000`). Dropping it
 * re-opens the ROADMAP 2.714 truncation, in which a magnitude guard the module's
 * own header called "the most important line here" could not fire at all
 * because the window handed to it had been cut at the decimal point. Mutant M11
 * pins this.
 */
const SENTENCE_TERMINATOR_RE = /[.!?](?=\s|$)|\n/g;

/** Split a brief into sentences, preserving each one's start offset. */
export function splitSentences(brief: string): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = [];
  let cursor = 0;
  SENTENCE_TERMINATOR_RE.lastIndex = 0;
  for (const m of brief.matchAll(SENTENCE_TERMINATOR_RE)) {
    const end = (m.index ?? 0) + m[0].length;
    const text = brief.slice(cursor, end);
    if (text.trim().length > 0) out.push({ text, start: cursor });
    cursor = end;
  }
  const tail = brief.slice(cursor);
  if (tail.trim().length > 0) out.push({ text: tail, start: cursor });
  return out;
}

/**
 * The sentence that governs a row's evidence.
 *
 * Locate the quote in the brief (exact, then case-insensitive). If the quote is
 * not in the brief at all — an LLM paraphrase, which is common and legitimate —
 * the scope IS the quote text. That fallback is deliberately narrow: a
 * paraphrase carries its own negation or it carries none, and screening the
 * paraphrase is honest about what evidence actually exists.
 */
export function governingSentence(brief: string | null | undefined, quote: string): string {
  return locateEvidence(brief, quote).sentence;
}

/**
 * Locate a row's evidence in the brief, reporting WHETHER it was found.
 *
 * ⚠⚠ THE `located` FLAG IS LOAD-BEARING AND WAS MISSING FROM THE FIRST CUT —
 * the merge-boundary spec's LLM-only configuration caught it.
 *
 * A model row carries a `source_quote` it wrote itself, and models routinely
 * paraphrase — and, measured on this very defect class, routinely STRIP THE
 * NEGATION while doing so ("Don't let gross margin drop below 78%" is quoted
 * back as "gross margin drop below 78%"). When such a quote is not in the
 * brief, the fallback scope is the quote text, which now contains no negation
 * at all: it screens CLEAN, and an inverted `<=` ships as PROVEN.
 *
 * That is the gate certifying a direction from evidence it could not check
 * against anything the user actually wrote. So an unlocated quote is FAIL-
 * CLOSED: it may still PROVE a direction if the quote itself carries a T1
 * construction, but it can never be proven by the absence of a negation,
 * because absence in a paraphrase is not evidence of absence in the brief.
 *
 * The narrowness matters: a quote that IS in the brief (the overwhelming
 * majority — the draft prompt mandates one per row) is completely unaffected.
 */
export function locateEvidence(
  brief: string | null | undefined,
  quote: string,
): { sentence: string; located: boolean } {
  const q = normaliseEvidenceText(quote);
  if (typeof brief !== 'string' || brief.length === 0 || q.length === 0) {
    return { sentence: q, located: false };
  }
  const nb = normaliseEvidenceText(brief);
  let at = nb.indexOf(q);
  if (at < 0) at = nb.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return { sentence: q, located: false };
  for (const s of splitSentences(nb)) {
    if (at >= s.start && at < s.start + s.text.length) return { sentence: s.text, located: true };
  }
  return { sentence: q, located: true };
}

/* ===========================================================================
 * THE NEGATION ALPHABET
 * ========================================================================= */

/** Strip the anonymous non-capturing wrapper off an imported alternation. */
function inner(src: string): string {
  return src.startsWith('(?:') && src.endsWith(')') ? src.slice(3, -1) : src;
}

/**
 * NEGATION PROPER — the extractor's two lead lists PLUS the contraction forms
 * they omit.
 *
 * ⚠ THE CONTRACTIONS ARE THE WHOLE AUDIT. `NEGATION_OR_PREVENTION_LEAD` carries
 * `can't/won't/shan't/shouldn't/mustn't/wouldn't/couldn't` and NOT
 * `don't/doesn't/didn't`, and `\bnot\b` cannot match inside a contraction — so
 * `Don't let gross margin drop below 78%` reached the wire as `<= 0.78`, the
 * exact inverse of the sentence, at 0.85 confidence. Three outside corpora in a
 * row spelled negation without a contraction and none of them saw it.
 *
 * ⚠ `no` MATCHES ONLY BEFORE WHITESPACE. `no-show`, `no-go` and `no-frills` are
 * COMPOUNDS, not negations, and the extractor's `\bno\b` (a hyphen is a word
 * boundary) is exactly why `Keep no-show rate under 3%` produced no row at all.
 * Mutant M6 pins this with a discriminating pair in both directions.
 */
const NEG_CORE_SRC =
  '(?:' +
  // multi-word forms FIRST so they match as a unit rather than as bare `not`
  'must\\s+not|will\\s+not|should\\s+not|shall\\s+not|would\\s+not|could\\s+not|' +
  'do\\s+not|does\\s+not|did\\s+not|is\\s+not|are\\s+not|was\\s+not|were\\s+not|' +
  'cannot|can\'t|won\'t|shan\'t|shouldn\'t|mustn\'t|wouldn\'t|couldn\'t|' +
  'don\'t|doesn\'t|didn\'t|isn\'t|aren\'t|wasn\'t|weren\'t|' +
  'without|never|not|no(?=\\s)' +
  ')';

/**
 * PREVENTION verbs — the extractor's suppression lead, minus `keep`.
 *
 * ⚠ `keep` IS DELIBERATELY ABSENT AND MUST STAY ABSENT. "Keep churn under 4%"
 * is the commonest legitimate ceiling in the corpus; admitting `keep` here would
 * send every plain ceiling to the unresolved bucket and turn the gate into the
 * 13-of-14 over-suppression the #888 review measured. `keep` appears in this
 * module ONLY inside the T1-3 `keep X from falling below Y` construction, where
 * the word `from` is what carries the prevention sense.
 */
const PREVENTION_SRC =
  '(?:' +
  'avoid(?:s|ing)?|prevent(?:s|ing)?|stop(?:s|ping)?|refus(?:e|es|ing)|' +
  'protect(?:s|ing)?|guard(?:s|ing)?|sacrific(?:e|es|ing)' +
  ')';

/** Any token that makes a sentence's direction unsafe to read off a comparator. */
const NEG_PLUS_RE = new RegExp(`\\b(?:${inner(NEG_CORE_SRC)}|${inner(PREVENTION_SRC)})`, 'i');

/** FALL verbs — the extractor's own list, plus the `go/going` forms it omits. */
const FALL_PLUS_SRC = `(?:${inner(FALL_VERB)}|go(?:es|ing)?|went|sink(?:s|ing)?|sank|declin(?:e|es|ing)|decreas(?:e|es|ing)|slid(?:e|es|ing)?)`;

/** RISE verbs / upper-crossing forms, for the ceiling constructions. */
const RISE_PLUS_SRC = '(?:exceed(?:s|ing)?|surpass(?:es|ing)?|overshoot(?:s|ing)?|go(?:es|ing)?\\s+(?:above|over|beyond|past)|ris(?:e|es|ing)\\s+above)';

/** A bounded subject capture — the extractor's own shape, so no new window. */
const SUBJ = '\\w+(?:[\\s-]+\\w+){0,3}';

/** Optional permissive verb between a negation and the metric. */
const LET = '(?:let(?:ting|s)?|allow(?:ing|s)?)';

/* ===========================================================================
 * 3.2 — THE CONSTRUCTION TABLE (T1)
 *
 * Constructions whose DIRECTION SURVIVES NEGATION because the negation is part
 * of the construction itself. Every entry is ADJACENCY-BOUND — the tokens must
 * be contiguous modulo whitespace and a bounded subject capture — so there are
 * no window constants and no clause discrimination anywhere in this table.
 * Those are the two things the trap-22f ruling closed.
 * ========================================================================= */

interface T1Entry {
  readonly id: string;
  readonly re: RegExp;
  readonly direction: ProvenDirection;
  /** Index of the capture group holding the amount. */
  readonly amountGroup: number;
  /** Index of the capture group holding the metric subject, when present. */
  readonly subjectGroup?: number;
  /** For bands: the index of the SECOND amount. */
  readonly amountGroup2?: number;
}

const BELOW = '(?:below|under|beneath)';
const ABOVE = '(?:above|over|beyond)';

/**
 * The table. Order is irrelevant to correctness (the LONGEST match covering the
 * row's own amount wins), but entries are grouped floor-first for reading.
 */
export const T1_TABLE: readonly T1Entry[] = [
  // T1-1 — subject-less: "Don't drop below 78%"
  {
    id: 'T1-1',
    re: new RegExp(`\\b${NEG_CORE_SRC}\\s+(?:${LET}\\s+)?${FALL_PLUS_SRC}\\s+${BELOW}\\s+(${AMT})`, 'gi'),
    direction: 'floor',
    amountGroup: 1,
  },
  // T1-2 — "Don't let gross margin drop below 78%"  (the a1/a2 class)
  {
    id: 'T1-2',
    re: new RegExp(`\\b${NEG_CORE_SRC}\\s+${LET}\\s+(${SUBJ})\\s+${FALL_PLUS_SRC}\\s+${BELOW}\\s+(${AMT})`, 'gi'),
    direction: 'floor',
    amountGroup: 2,
    subjectGroup: 1,
  },
  // T1-2b — "gross margin cannot drop below 78%"
  {
    id: 'T1-2b',
    re: new RegExp(`\\b(${SUBJ})\\s+${NEG_CORE_SRC}\\s+${FALL_PLUS_SRC}\\s+${BELOW}\\s+(${AMT})`, 'gi'),
    direction: 'floor',
    amountGroup: 2,
    subjectGroup: 1,
  },
  // T1-2c — "without dropping gross margin below 78%"
  {
    id: 'T1-2c',
    re: new RegExp(`\\b${NEG_CORE_SRC}\\s+(?:${LET}\\s+)?${FALL_PLUS_SRC}\\s+(${SUBJ})\\s+${BELOW}\\s+(${AMT})`, 'gi'),
    direction: 'floor',
    amountGroup: 2,
    subjectGroup: 1,
  },
  // T1-3 — "Keep gross margin from falling below 78%"  (the a3 class)
  {
    id: 'T1-3',
    re: new RegExp(
      `\\b(?:keep(?:s|ing)?|stop(?:s|ping)?|prevent(?:s|ing)?|protect(?:s|ing)?|guard(?:s|ing)?)\\s+(${SUBJ})\\s+from\\s+${FALL_PLUS_SRC}\\s+${BELOW}\\s+(${AMT})`,
      'gi',
    ),
    direction: 'floor',
    amountGroup: 2,
    subjectGroup: 1,
  },
  // T1-3b — "Keep churn from rising above 4%"  — THE CEILING TWIN OF T1-3.
  //
  // ⚠⚠ THIS ENTRY EXISTS BECAUSE THE TWIN CLASS CAUGHT ITS ABSENCE, and it is
  // the single most valuable case in the corpus. T1-3 was written for the floor
  // form the audit reported (`keep X from falling below Y`) and I did not think
  // to write its mirror. Without T1-3b, "Keep churn from rising above 4%" — a
  // plain CEILING — has no construction verdict, and `keep` is deliberately not
  // a negation, so the sentence screens CLEAN and the extractor's `>=` (minted
  // from the word "above") reaches the wire as a hard FLOOR demanding the very
  // churn the user is trying to prevent.
  //
  // That is the 2.653 defect exactly, re-created inside the gate written to
  // stop it — a guard with the same asymmetry as the code it screens (trap
  // 13d). Nothing derived from my own table could have noticed; only writing
  // the opposite-direction twin of every case did (trap 22b).
  {
    id: 'T1-3b',
    re: new RegExp(
      `\\b(?:keep(?:s|ing)?|stop(?:s|ping)?|prevent(?:s|ing)?|protect(?:s|ing)?|guard(?:s|ing)?)\\s+(${SUBJ})\\s+from\\s+(?:${inner(RISE_PLUS_SRC)}|ris(?:e|es|ing)|climb(?:s|ing)?|increas(?:e|es|ing)|grow(?:s|ing)?)\\s+(?:${ABOVE})?\\s*(${AMT})`,
      'gi',
    ),
    direction: 'ceiling',
    amountGroup: 2,
    subjectGroup: 1,
  },
  // T1-4 — "Ensure gross margin doesn't drop below 78%"  (the a4 class)
  {
    id: 'T1-4',
    re: new RegExp(
      `\\b(?:ensur(?:e|es|ing)|make\\s+sure|guarantee(?:s|ing)?)\\s+(${SUBJ})\\s+${NEG_CORE_SRC}\\s+${FALL_PLUS_SRC}\\s+${BELOW}\\s+(${AMT})`,
      'gi',
    ),
    direction: 'floor',
    amountGroup: 2,
    subjectGroup: 1,
  },
  // T1-5 — "must not exceed £50k" / "don't go above £50k"
  {
    id: 'T1-5',
    re: new RegExp(`\\b${NEG_CORE_SRC}\\s+(?:${LET}\\s+)?${RISE_PLUS_SRC}\\s+(${AMT})`, 'gi'),
    direction: 'ceiling',
    amountGroup: 1,
  },
  // T1-5b — "spend must not exceed £50k"
  {
    id: 'T1-5b',
    re: new RegExp(`\\b(${SUBJ})\\s+${NEG_CORE_SRC}\\s+(?:${LET}\\s+)?${RISE_PLUS_SRC}\\s+(${AMT})`, 'gi'),
    direction: 'ceiling',
    amountGroup: 2,
    subjectGroup: 1,
  },
  // T1-6 — closed ceiling idioms
  {
    id: 'T1-6',
    re: new RegExp(`\\b(?:no\\s+more\\s+than|at\\s+most|capped\\s+at|limited\\s+to|maximum\\s+(?:of\\s+)?)\\s*(${AMT})`, 'gi'),
    direction: 'ceiling',
    amountGroup: 1,
  },
  // T1-7 — closed floor idioms
  {
    id: 'T1-7',
    re: new RegExp(`\\b(?:at\\s+least|no\\s+less\\s+than|no\\s+lower\\s+than|minimum\\s+(?:of\\s+)?)\\s*(${AMT})`, 'gi'),
    direction: 'floor',
    amountGroup: 1,
  },
  // T1-7b — "retention must be above 90%"
  {
    id: 'T1-7b',
    re: new RegExp(`\\b(${SUBJ})\\s+(?:must|should|shall|needs?\\s+to)\\s+(?:be|stay|remain)\\s+${ABOVE}\\s+(${AMT})`, 'gi'),
    direction: 'floor',
    amountGroup: 2,
    subjectGroup: 1,
  },
  // T1-8 — the band
  {
    id: 'T1-8',
    re: new RegExp(`\\b(${SUBJ})\\s+between\\s+(${AMT})\\s+and\\s+(${AMT})`, 'gi'),
    direction: 'band',
    amountGroup: 2,
    amountGroup2: 3,
    subjectGroup: 1,
  },
];

/** One T1 hit, resolved to a direction and a numeric amount. */
export interface T1Match {
  readonly id: string;
  readonly direction: 'floor' | 'ceiling';
  readonly value: number;
  readonly unit: string;
  readonly amountText: string;
  readonly subject: string | null;
  readonly length: number;
}

/**
 * Every T1 construction in a sentence, each resolved to the NUMERIC amount it
 * governs.
 *
 * Resolving to a NUMBER is what binds a construction to a ROW BY IDENTITY
 * rather than by proximity (trap 19). "There is a T1 match in this sentence" is
 * a predicate a neighbouring bound could satisfy; "a T1 match governs THIS
 * row's own amount" is not.
 */
export function findT1Matches(sentence: string): T1Match[] {
  const out: T1Match[] = [];
  const s = normaliseEvidenceText(sentence);
  for (const entry of T1_TABLE) {
    const re = new RegExp(entry.re.source, entry.re.flags);
    for (const m of s.matchAll(re)) {
      const subject = entry.subjectGroup ? (m[entry.subjectGroup] ?? null) : null;
      const push = (text: string | undefined, dir: 'floor' | 'ceiling') => {
        if (typeof text !== 'string' || text.length === 0) return;
        const { value, unit } = parseValue(text);
        if (!Number.isFinite(value)) return;
        out.push({ id: entry.id, direction: dir, value, unit, amountText: text, subject, length: m[0].length });
      };
      if (entry.direction === 'band') {
        // The low amount is the floor, the high amount is the ceiling.
        push(m[entry.amountGroup], 'floor');
        push(m[entry.amountGroup2 ?? -1], 'ceiling');
      } else {
        push(m[entry.amountGroup], entry.direction);
      }
    }
  }
  return out;
}

/* ===========================================================================
 * 3.3 — THE SCREENS
 * ========================================================================= */

/**
 * S1 — EXPLICIT AMBIGUITY. The user said, in so many words, that they had not
 * decided. Today the product picks one and shows no warning anywhere.
 *
 * A miss here reproduces today's behaviour exactly, so this lexicon can only
 * ever ADD honesty — it can never remove any.
 */
const AMBIGUITY_RE = new RegExp(
  [
    "unsure\\s+(?:whether|if)",
    "not\\s+sure\\s+(?:whether|if)",
    "n't\\s+sure\\s+(?:whether|if)",
    "undecided",
    "haven't\\s+decided",
    "have\\s+not\\s+decided",
    "still\\s+deciding",
    "debat(?:e|ed|ing)\\s+whether",
    "arguing\\s+(?:about\\s+)?whether",
    "could\\s+be\\s+(?:a\\s+)?(?:floor|ceiling|cap|minimum|maximum)",
    "(?:floor|ceiling)\\s+or\\s+(?:a\\s+)?(?:ceiling|floor)",
    "as\\s+(?:a\\s+)?(?:floor|ceiling)\\s+or",
    "or\\s+treat\\s+[^,.;]{0,40}\\s+as\\s+(?:a\\s+)?(?:floor|ceiling)",
    "whether\\s+[^,.;]{0,60}\\s+is\\s+(?:a\\s+)?(?:floor|ceiling|minimum|maximum)",
  ].join('|'),
  'i',
);

/** Does this sentence declare its own ambiguity? */
export function hasExplicitAmbiguity(sentence: string): boolean {
  return AMBIGUITY_RE.test(normaliseEvidenceText(sentence));
}

/**
 * S3 — THE UNSPENT-NEGATION SCREEN.
 *
 * ⚠⚠ THE SPAN EXEMPTION IS PER-ROW, NOT PER-SENTENCE, AND THAT IS THE WHOLE
 * DIFFERENCE BETWEEN THIS GATE AND THE FIVE ROUNDS THAT FAILED.
 *
 * The design brief said "any negation not inside SOME T1 span in that sentence".
 * Implemented literally, that re-opens the exact defect it was commissioned to
 * close. In
 *
 *     "Without letting gross margin drop below 78% or churn fall below 90%."
 *
 * the word `Without` sits INSIDE the T1-2 span that proves the FIRST bound. A
 * sentence-wide exemption therefore finds nothing unspent for the SECOND bound
 * and passes `churn <= 0.9` — the inverted conjunct, which is precisely the
 * spent-negation residue #888 admitted and this lane was commissioned to kill.
 *
 * "The negation was already spent on another bound" is `suppressionWindow`
 * step 0 — THE MECHANISM THAT PRODUCED THE DEFECT. Re-deriving it here would be
 * the sixth round of the ruled-unwinnable predicate.
 *
 * So: a row that has its OWN T1 verdict is decided by S2 and never reaches this
 * screen. A row with NO T1 verdict is screened against ANY negation or
 * prevention token in its governing sentence, full stop. No spans, no windows,
 * no clause governance, and SIGN-SYMMETRIC BY CONSTRUCTION — this screen reads
 * the sentence and never looks at the operator, so it cannot acquire the
 * one-directional blind spot of trap 13d.
 *
 * The cost is stated and accepted: a legitimate bare-comparator bound sharing a
 * sentence with an unrelated negation becomes a QUESTION rather than a silent
 * correct row. A correct answer sometimes becomes a question; a wrong answer can
 * never reach the wire.
 */
export function hasUnspentNegation(sentence: string): boolean {
  return NEG_PLUS_RE.test(normaliseEvidenceText(sentence));
}

/* ===========================================================================
 * 3.4 — THE DELTA-VS-LIMIT DISCRIMINATOR
 * ========================================================================= */

const POSSIBILITY_RE = new RegExp(`\\b${POSSIBILITY_MARKER_SRC}\\b`, 'i');

/**
 * A numeric RANGE stated as the amount: `3-8pp`, `3 to 8`, `between 3 and 8`.
 * A hard limit has ONE number; a range is an estimate.
 */
const RANGE_RE = /(\d+(?:\.\d+)?)\s*(?:-|–|—|to|and)\s*(\d+(?:\.\d+)?)/gi;

/**
 * Is this range the row's OWN amount, rather than any two numbers in the
 * sentence?
 *
 * Binding by identity matters here for a mundane reason: a date like
 * `2027-06-30` is two numbers separated by a hyphen, and a bare range test would
 * read "Reduce churn by 2pp by 2027-06-30" as range-valued and decline a real
 * limit. Requiring the range's LOW number to equal the row's own magnitude
 * (`|value|`) makes the test about this row and not about the sentence.
 */
export function rangeGovernsAmount(sentence: string, value: number): boolean {
  const s = normaliseEvidenceText(sentence);
  const target = Math.abs(value);
  RANGE_RE.lastIndex = 0;
  for (const m of s.matchAll(RANGE_RE)) {
    const lo = parseFloat(m[1] ?? '');
    const hi = parseFloat(m[2] ?? '');
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    if (hi <= lo) continue;
    if (Math.abs(lo - target) < 1e-9 || Math.abs(lo / 100 - target) < 1e-9) return true;
  }
  return false;
}

/**
 * Classify a `value_frame: 'delta'` row as a stated ESTIMATE rather than a
 * limit, or `null` if it stands as a limit and proceeds through S1–S4.
 *
 * Why `risk-polarity` did not already catch this: its movement lists carry
 * fall/drop/decline but NOT the transitive reduction verbs
 * (`reduce/cut/lower/shrink`), so "The migration could reduce retention by
 * 3-8pp" — a stated consequence — mints `retention <= -3` at 0.85 confidence.
 * The discriminator lives HERE rather than as an edit to the 2.653 lists so the
 * two gates' corpora stay independent and neither inherits the other's blind
 * spot.
 */
export function classifyNonLimitDelta(
  sentence: string,
  value: number | null,
): NonLimitReason | null {
  if (POSSIBILITY_RE.test(normaliseEvidenceText(sentence))) return 'possibility_framed_delta';
  if (value !== null && rangeGovernsAmount(sentence, value)) return 'range_valued_delta';
  return null;
}

/* ===========================================================================
 * COPY / PAYLOAD COMPOSITION
 * ========================================================================= */

/**
 * Words that make a subject capture useless as a metric name.
 *
 * ⚠ THE BARE CONSONANTS ARE CONTRACTION REMNANTS, NOT TYPOS. A bounded `\w+`
 * capture starting just after an apostrophe reads `Don't let gross margin` as
 * the subject `t let gross margin`, because `'` is a word boundary and `t` is a
 * perfectly good `\w+`. That is how the extractor's own a4 row came to be
 * bound to the node `fac_t_drop`. Stripping them here keeps the defect out of
 * user-facing copy even though the row's node id still carries it.
 */
const SUBJECT_NOISE_RE =
  /^(?:the|a|an|to|of|and|or|we|it|is|are|was|were|be|been|that|this|our|their|its|unspecified|so|while|even|ever|during|under|any|all|circumstances|let|letting|lets|allow|allowing|allows|keep|keeping|keeps|maintain|maintaining|ensure|ensuring|ensures|guarantee|guaranteeing|approve|approves|approving|treat|treating|sacrificing|protect|protecting|stop|stopping|prevent|preventing|must|should|shall|will|would|could|not|no|never|without|t|s|re|ve|ll|d|m)\b/i;

/** A label that states a DIRECTION rather than naming a metric. */
const DIRECTIONAL_LABEL_RE = /^(?:at\s+or\s+(?:above|below)|no\s+more\s+than|no\s+less\s+than|at\s+least|at\s+most|minimum|maximum)\b/i;

/**
 * Connectives and verbs a width-bounded capture runs into at its right edge
 * ("customer trust while keeping churn"). Purely cosmetic: this trims the tail
 * of a metric NAME and can never change a verdict.
 */
const TRAILING_NOISE_RE =
  /\s+(?:while|when|so|and|or|but|by|for|with|from|that|to|in|on|of|as|is|are|be|the|a|an|keep|keeping|let|letting|allow|allowing|stay|stays|remain|remains|go|going|drop|dropping|fall|falling)$/i;

/**
 * Recover the metric in the USER'S OWN WORDS.
 *
 * Never a node id — the record must survive `scanCoachingForIdLeakage`, and an
 * id in user-facing copy is a leak whether or not the scanner happens to catch
 * that particular spelling.
 */
export function deriveMetricText(
  subject: string | null,
  label: unknown,
  quote: unknown,
): string {
  const clean = (raw: string): string | null => {
    let t = normaliseEvidenceText(raw).replace(/[.,;:]+$/, '').trim();
    while (t.length > 0 && SUBJECT_NOISE_RE.test(t)) t = t.replace(SUBJECT_NOISE_RE, '').trim();
    // Drop a trailing movement verb the capture swept up ("gross margin drop").
    t = t.replace(new RegExp(`\\s+${inner(FALL_PLUS_SRC)}$`, 'i'), '').trim();
    // Drop trailing connectives the bounded capture ran into ("trust while
    // keeping churn"). The capture is deliberately width-bounded rather than
    // syntax-aware, so it routinely ends mid-clause; trimming the tail is
    // cosmetic and cannot change any verdict.
    let prev = '';
    while (prev !== t) {
      prev = t;
      t = t.replace(TRAILING_NOISE_RE, '').trim();
    }
    return t.length > 0 && /[a-z]/i.test(t) ? t : null;
  };
  if (typeof subject === 'string') {
    const c = clean(subject);
    if (c) return c;
  }
  if (typeof label === 'string' && !DIRECTIONAL_LABEL_RE.test(normaliseEvidenceText(label))) {
    // Strip the direction phrasing the producers stamp into labels, so the copy
    // does not repeat a direction the gate has just declined to believe.
    // A label that is ONLY direction phrasing ("At or below 90%") names no
    // metric at all and is rejected outright above — otherwise the question
    // reads "Should At or below 90% stay at or above 90%?", which is the copy
    // equivalent of a node id leak: technically derived from the row, and
    // meaningless to the person being asked.
    const stripped = label
      .replace(/^(?:keep|maintain|hold|ensure)\s+/i, '')
      .replace(/\s+at\s+or\s+(?:above|below)\s+.*$/i, '')
      .replace(/\s+(?:floor|ceiling|minimum|maximum|cap|limit)$/i, '');
    const c = clean(stripped);
    if (c) return c;
  }
  if (typeof quote === 'string') {
    const c = clean(quote.split(/\s+(?:below|under|above|over|exceed)/i)[0] ?? '');
    if (c) return c;
  }
  return FALLBACK_METRIC;
}

/** Used when no user-derived word survives cleaning. */
export const FALLBACK_METRIC = 'this measure';

/** Render the amount the way the user wrote it, from the evidence when possible. */
export function deriveAmountText(
  sentence: string,
  value: number | null,
  unit: string | null,
): string {
  if (value === null) return 'the value you gave';
  const s = normaliseEvidenceText(sentence);
  const re = new RegExp(AMT, 'gi');
  for (const m of s.matchAll(re)) {
    const parsed = parseValue(m[0]);
    if (Math.abs(parsed.value - value) < 1e-9) return m[0];
  }
  if (unit === '%' || unit === 'fraction') {
    const pct = value * 100;
    return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
  }
  if (unit && /^[£$€]$/.test(unit)) return `${unit}${value.toLocaleString('en-GB')}`;
  return String(value);
}

/** The user-answerable question, phrased once, surface-agnostic. */
function composeQuestion(reason: UnresolvedReason, metric: string, amount: string): string {
  switch (reason) {
    case 'explicit_ambiguity':
      return `You said you hadn't settled whether ${amount} is a floor or a ceiling for ${metric}. Which is it?`;
    case 'producer_disagreement':
      return `I read two conflicting limits for ${metric} around ${amount}. Which one do you want enforced?`;
    case 'no_evidence':
      return `Is ${amount} a floor or a ceiling for ${metric}?`;
    case 'evidence_contradiction':
    case 'unspent_negation':
    default:
      return `Should ${metric} stay at or above ${amount}, or at or below it?`;
  }
}

const OPTION_SET = Object.freeze([
  'a floor — keep it at or above this value',
  'a ceiling — keep it at or below this value',
]);

/** Build the reusable unresolved record for one withheld row. */
export function buildUnresolvedItem(
  reason: UnresolvedReason,
  sentence: string,
  row: GateableConstraint,
  subject: string | null,
  nodeLabel?: string,
): DirectionUnresolvedItem {
  const value = typeof row.value === 'number' && Number.isFinite(row.value) ? row.value : null;
  const unit = typeof row.unit === 'string' && row.unit.length > 0 ? row.unit : null;
  const metric_text = deriveMetricText(subject, row.label, row.source_quote);
  const amount_text = deriveAmountText(sentence, value, unit);
  return {
    metric_text,
    amount_text,
    value,
    unit,
    reason,
    question: composeQuestion(reason, metric_text, amount_text),
    options: OPTION_SET,
    ...(nodeLabel ? { node_label: nodeLabel } : {}),
  };
}

/* ===========================================================================
 * THE PARTITION
 * ========================================================================= */

export interface DirectionPartition<T> {
  readonly proven: T[];
  readonly unresolved: Array<UnresolvedEntry<T>>;
  readonly nonLimit: Array<NonLimitEntry<T>>;
}

function evidenceOf(c: GateableConstraint): string | null {
  if (typeof c?.source_quote === 'string' && c.source_quote.trim().length > 0) return c.source_quote;
  if (typeof c?.label === 'string' && c.label.trim().length > 0) return c.label;
  return null;
}

/**
 * THE GATE.
 *
 * Rules apply IN ORDER and the FIRST DECISIVE RULE WINS — no weights, no
 * confidence arithmetic, and every verdict carries its rule name as `reason`, so
 * any outcome is explainable in one line to a user or a reviewer.
 *
 * ⭐ THE RETURN VALUE IS AN EXACT PARTITION OF THE INPUT, AND THAT IS ASSERTED
 * RATHER THAN INTENDED. `proven + unresolved + nonLimit === constraints.length`
 * is the structural form of "no bound is ever silently dropped": a row cannot
 * fall out of this function without landing in a named, counted bucket. A future
 * edit that adds a fourth path has to break this assertion to ship.
 */
export function partitionUnprovenDirection<T extends GateableConstraint>(
  constraints: readonly T[],
  brief?: string | null,
  nodeLabels?: ReadonlyMap<string, string>,
): DirectionPartition<T> {
  const proven: T[] = [];
  const unresolved: Array<UnresolvedEntry<T>> = [];
  const nonLimit: Array<NonLimitEntry<T>> = [];

  const withhold = (
    c: T,
    reason: UnresolvedReason,
    sentence: string,
    subject: string | null,
  ) => {
    const nodeId = typeof c.node_id === 'string' ? c.node_id : undefined;
    unresolved.push({
      constraint: c,
      reason,
      item: buildUnresolvedItem(reason, sentence, c, subject, nodeId ? nodeLabels?.get(nodeId) : undefined),
    });
  };

  // ── Pass 1: per-row screens S1–S3 + the delta discriminator ──────────
  const survivors: Array<{ row: T; sentence: string; subject: string | null }> = [];

  for (const c of constraints) {
    const operator = typeof c.operator === 'string' ? c.operator : null;
    const value = typeof c.value === 'number' && Number.isFinite(c.value) ? c.value : null;

    // A row with no evidence at all cannot have its direction proven. FAIL
    // CLOSED — "cannot emit a direction it did not prove" is the whole gate.
    const evidence = evidenceOf(c);
    if (evidence === null) {
      withhold(c, 'no_evidence', '', null);
      continue;
    }

    const { sentence, located } = locateEvidence(brief, evidence);

    // §3.4 — was this ever a limit at all?
    if (c.value_frame === 'delta') {
      const nonLimitReason = classifyNonLimitDelta(sentence, value);
      if (nonLimitReason !== null) {
        nonLimit.push({ constraint: c, reason: nonLimitReason });
        continue;
      }
    }

    // S1 — explicit ambiguity beats everything else.
    if (hasExplicitAmbiguity(sentence)) {
      withhold(c, 'explicit_ambiguity', sentence, null);
      continue;
    }

    // Operators this gate does not adjudicate pass through untouched: it screens
    // DIRECTION, and a row without a direction has none to contradict.
    if (operator !== '>=' && operator !== '<=') {
      survivors.push({ row: c, sentence, subject: null });
      continue;
    }

    // S2 — the construction verdict, bound to THIS row's amount by identity.
    const matches = value === null ? [] : findT1Matches(sentence).filter((m) => amountsMatch(m, value, c.unit));
    if (matches.length > 0) {
      // Longest match wins — the most specific construction covering the bound.
      const best = matches.reduce((a, b) => (b.length > a.length ? b : a));
      const wanted = best.direction === 'floor' ? '>=' : '<=';
      if (wanted === operator) {
        survivors.push({ row: c, sentence, subject: best.subject });
      } else {
        withhold(c, 'evidence_contradiction', sentence, best.subject);
      }
      continue;
    }

    // S3 — no construction verdict: any unaccounted negation withholds.
    if (hasUnspentNegation(sentence)) {
      withhold(c, 'unspent_negation', sentence, null);
      continue;
    }

    // FAIL CLOSED on an unverifiable quote. Reaching here means the direction
    // rests entirely on "no negation in the evidence" — which is worth nothing
    // when the evidence is a paraphrase the gate could not find in the brief.
    if (!located) {
      withhold(c, 'no_evidence', sentence, null);
      continue;
    }

    survivors.push({ row: c, sentence, subject: null });
  }

  // ── Pass 2: S4 — the cross-row CONTESTED screen ──────────────────────
  const byNode = new Map<string, Array<{ row: T; sentence: string; subject: string | null }>>();
  for (const s of survivors) {
    const id = typeof s.row.node_id === 'string' ? s.row.node_id : '';
    const list = byNode.get(id);
    if (list) list.push(s);
    else byNode.set(id, [s]);
  }

  for (const [, group] of byNode) {
    const floors = group.filter((g) => g.row.operator === '>=');
    const ceilings = group.filter((g) => g.row.operator === '<=');

    if (floors.length === 0 || ceilings.length === 0) {
      for (const g of group) proven.push(g.row);
      continue;
    }

    // Opposite operators on one node stand ONLY as a coherent band: every floor
    // strictly below every ceiling. `between 20% and 30%` is a real band and
    // must survive; `>= 0.78` beside `<= 0.78` is two producers disagreeing.
    const coherent = floors.every((f) =>
      ceilings.every((c) => {
        const fv = typeof f.row.value === 'number' ? f.row.value : NaN;
        const cv = typeof c.row.value === 'number' ? c.row.value : NaN;
        return Number.isFinite(fv) && Number.isFinite(cv) && fv < cv;
      }),
    );

    if (coherent) {
      for (const g of group) proven.push(g.row);
    } else {
      for (const g of group) withhold(g.row, 'producer_disagreement', g.sentence, g.subject);
    }
  }

  /* istanbul ignore next — structural invariant, not a branch under test */
  if (proven.length + unresolved.length + nonLimit.length !== constraints.length) {
    throw new Error(
      `direction-gate partition lost rows: in=${constraints.length} ` +
        `proven=${proven.length} unresolved=${unresolved.length} nonLimit=${nonLimit.length}`,
    );
  }

  return { proven, unresolved, nonLimit };
}

/**
 * Does a T1 match govern THIS row's amount?
 *
 * The comparison is on the PARSED value, because the row has been through unit
 * normalisation (`78%` → `0.78 fraction`) while the sentence still spells `78%`.
 * Both sides go through the extractor's own {@link parseValue}, so this test can
 * never drift from the producer it screens.
 */
function amountsMatch(m: T1Match, value: number, unit: unknown): boolean {
  if (Math.abs(m.value - value) < 1e-9) return true;
  // A percent amount normalised to a fraction, or the reverse.
  if (unit === 'fraction' || unit === '%' || m.unit === '%') {
    if (Math.abs(m.value / 100 - value) < 1e-9) return true;
    if (Math.abs(m.value - value / 100) < 1e-9) return true;
  }
  return false;
}

/* ===========================================================================
 * 3.6 — THE UNMATCHED-NEGATION DETECTOR (the dropped-floor class)
 * ========================================================================= */

/**
 * A negated bound the brief STATES but no producer emitted a row for.
 *
 * Without this, claim (g) stays silent: "Retention must not — even during
 * migration — fall below 92%" produces NO ROWS at all, because the em-dash aside
 * sits between the negation and the verb so no minting pattern spans it, while
 * the suppression correctly kills the ceiling misreading. Net output today is
 * silence — the user's floor simply disappears.
 *
 * ⚠ THIS RUNS EVEN WHEN THE MERGED SET IS EMPTY, which is why the host
 * function's early return had to move below it. A dropped floor means BOTH
 * producers emitted nothing, and that is precisely when the detector matters.
 *
 * It fires ONLY on negation-bearing sentences, by design. Widening it to all
 * bounds would make it a second extractor — prohibited, and it would inherit
 * every blind spot the first one has.
 */
const NEGATED_BOUND_NEIGHBOURHOOD = new RegExp(
  `(${SUBJ})\\s+(?:${inner(FALL_PLUS_SRC)}|${inner(RISE_PLUS_SRC)})?\\s*(?:below|under|above|over|exceed(?:s|ing)?|more\\s+than|less\\s+than|short\\s+of)\\s+(${AMT})`,
  'gi',
);

/**
 * An amount in an explicitly-ambiguous sentence.
 *
 * When the user has said IN SO MANY WORDS that they do not know whether a
 * quantity is a floor or a ceiling, that is a question worth asking even though
 * no comparator appears and no producer minted a row — "We haven't decided
 * whether 4% churn is a floor or a ceiling" states a limit and its own
 * uncertainty in one breath, and today the product says nothing at all.
 *
 * This path still MINTS NOTHING. It raises a question and no row, which is the
 * gate's whole contract.
 */
/**
 * `keep/stop/prevent/protect/guard X FROM …` — a prevention construction whose
 * sense lives in `from`, not in the verb. Scoped to that frame precisely so
 * that a bare `keep X under Y` ceiling is untouched.
 */
const PREVENTION_CONSTRUCTION_RE =
  /\b(?:keep(?:s|ing)?|stop(?:s|ping)?|prevent(?:s|ing)?|protect(?:s|ing)?|guard(?:s|ing)?)\s+[\w\s'-]{0,40}?\bfrom\b/i;

const BARE_AMOUNT_RE = new RegExp(`(${SUBJ})?\\s*(${AMT})`, 'gi');

export function detectUncoveredNegatedBounds(
  brief: string | null | undefined,
  coveredValues: readonly number[],
  coveredSentences: ReadonlySet<number>,
): UncoveredNegatedBound[] {
  if (typeof brief !== 'string' || brief.trim().length === 0) return [];
  const out: UncoveredNegatedBound[] = [];
  const seen = new Set<string>();

  const sentences = splitSentences(normaliseEvidenceText(brief));
  sentences.forEach((s, idx) => {
    if (coveredSentences.has(idx)) return;
    const ambiguous = hasExplicitAmbiguity(s.text);
    // `keep X from …` is a PREVENTION construction even though `keep` is not a
    // negation token (it must not be — "keep churn under 4%" is the commonest
    // legitimate ceiling in the corpus). The word carrying the prevention sense
    // is `from`, and only in that frame. Without this, "Keep gross margin from
    // falling below 78%" — which no producer emits a row for — is silence.
    const preventionConstruction = PREVENTION_CONSTRUCTION_RE.test(s.text);
    if (!ambiguous && !preventionConstruction && !NEG_PLUS_RE.test(s.text)) return;

    // An explicitly-ambiguous sentence needs no comparator to be worth asking
    // about: the user has already told us the direction is undecided.
    const source = ambiguous ? BARE_AMOUNT_RE : NEGATED_BOUND_NEIGHBOURHOOD;
    const re = new RegExp(source.source, source.flags);
    for (const m of s.text.matchAll(re)) {
      const amountText = m[2];
      if (typeof amountText !== 'string') continue;
      const { value } = parseValue(amountText);
      if (!Number.isFinite(value)) continue;
      // Covered: a surviving PROVEN row already carries this quantity.
      const covered = coveredValues.some(
        (v) => Math.abs(v - value) < 1e-9 || Math.abs(v - value / 100) < 1e-9 || Math.abs(v * 100 - value) < 1e-9,
      );
      if (covered) continue;
      // The local capture is the best evidence for WHICH metric, but an
      // interrupted construction leaves it pointing at the aside rather than at
      // the subject ("even during migration — fall below 92%"). When it cleans
      // to nothing usable, fall back to the SENTENCE TOPIC — the words before
      // the first negation — which for those constructions is the metric
      // itself ("Retention must not — … — fall below 92%").
      let metric = deriveMetricText(m[1] ?? null, null, null);
      if (metric === FALLBACK_METRIC) {
        const negAt = s.text.search(NEG_PLUS_RE);
        const topic = negAt > 0 ? s.text.slice(0, negAt) : '';
        metric = deriveMetricText(topic.split(/\s+/).slice(0, 4).join(' '), null, null);
      }
      const key = `${metric}::${amountText}::${idx}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ metric_text: metric, amount_text: amountText, sentence_index: idx });
    }
  });

  return out;
}

/** Turn a detector finding into the same reusable record shape. */
export function detectorItem(f: UncoveredNegatedBound): DirectionUnresolvedItem {
  const { value, unit } = parseValue(f.amount_text);
  return {
    metric_text: f.metric_text,
    amount_text: f.amount_text,
    value: Number.isFinite(value) ? value : null,
    unit: unit.length > 0 ? unit : null,
    reason: 'unspent_negation',
    question: `Should ${f.metric_text} stay at or above ${f.amount_text}, or at or below it?`,
    options: OPTION_SET,
  };
}

/* ===========================================================================
 * RENDERING — record -> coaching card
 * ========================================================================= */

/**
 * How many clarifications one draft may carry.
 *
 * Mirrors `MAX_NAMED_CONSTRAINTS` in the constraint-gap disclosure, and for the
 * same reason: a draft that opens with six questions reads as a broken product,
 * not a careful one. Overflow collapses into a single item naming the count, so
 * the user still learns that more limits are unresolved — nothing vanishes.
 */
export const MAX_DIRECTION_CLARIFICATIONS = 3;

/** The coaching-card shape, structurally identical to `StrengthenItemSchema`. */
export interface DirectionStrengthenItem {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly action_type: 'add_constraint';
}

/**
 * Render the reusable unresolved records as coaching `strengthen_items[]`.
 *
 * ⭐ THIS IS A RENDERER, NOT THE RECORD. `DirectionUnresolvedItem` carries the
 * question, the options, the metric and the amount in a surface-agnostic shape;
 * this function projects them onto the ONE surface that exists today. A later
 * "Olumi needs your input" elicitation panel renders the same records with a
 * different projection and needs no change to the gate.
 *
 * `action_type: 'add_constraint'` is the product's own existing convention for
 * "a limit the model noticed but did not mint" — the live draft prompt already
 * routes qualitative guardrails to it, and the UI's add-constraint flow makes
 * the user state the direction explicitly, which is exactly the ratification
 * this gate declined to invent. Zero schema change: `StrengthenItemSchema` is
 * `.strict()` at 0.39.0 with precisely these fields.
 *
 * Dedupe is by (metric, amount) — the same limit reached by two producers, or
 * by a row and the detector, is ONE question to the user.
 */
export function renderDirectionClarifications(
  items: readonly DirectionUnresolvedItem[],
): DirectionStrengthenItem[] {
  const seen = new Set<string>();
  const unique: DirectionUnresolvedItem[] = [];
  for (const it of items) {
    const key = `${it.metric_text.toLowerCase()}::${it.amount_text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(it);
  }
  if (unique.length === 0) return [];

  const shown = unique.slice(0, MAX_DIRECTION_CLARIFICATIONS);
  const out: DirectionStrengthenItem[] = shown.map((it, n) => ({
    id: `direction_unresolved_${n + 1}`,
    label: `Confirm the direction of the ${it.metric_text} limit`,
    detail:
      `You mentioned ${it.amount_text} for ${it.metric_text}. I couldn't tell from the ` +
      `wording whether that's a floor (keep it at or above ${it.amount_text}) or a ceiling ` +
      `(keep it at or below ${it.amount_text}), so it isn't being enforced yet. ` +
      `Add it as a constraint to make it binding.`,
    action_type: 'add_constraint' as const,
  }));

  const overflow = unique.length - shown.length;
  if (overflow > 0) {
    out.push({
      id: 'direction_unresolved_more',
      label: `${overflow} more limit${overflow === 1 ? ' needs' : 's need'} a direction`,
      detail:
        `${overflow} further limit${overflow === 1 ? '' : 's'} in your brief could be read as ` +
        `either a floor or a ceiling, so ${overflow === 1 ? 'it is' : 'they are'} not being ` +
        `enforced yet. Add ${overflow === 1 ? 'it' : 'them'} as constraints to make ` +
        `${overflow === 1 ? 'it' : 'them'} binding.`,
      action_type: 'add_constraint' as const,
    });
  }
  return out;
}
