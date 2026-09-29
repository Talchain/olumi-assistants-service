/**
 * ⭐ THE ELICITATION GRAMMAR — deterministic K-of-N reference-class
 * recognition, run BEFORE any model call.
 *
 * ROADMAP 2.688 slice 1 (+ its guard 2.722). Design:
 * `parallel-briefs/BASE-RATE-ELICITED-DESIGN-2026-08-08.md` §2.
 *
 * ⭐⭐ COUNTS FIRST — THE LOAD-BEARING CHOICE. This grammar recognises
 * "of N comparable cases, K had the outcome" and NOTHING ELSE. A stated
 * RATE without an N ("about 40% of launches like this succeed") is REFUSED
 * into this machinery by construction (I5): no N means no posterior width,
 * which means there is nothing this feature can honestly add, and
 * synthesising an "effective N" for a stated rate is fabrication. K and N
 * are the only inputs from which uncertainty can be DERIVED rather than
 * INVENTED.
 *
 * ⚠ THE ASYMMETRY IS DELIBERATE, and it is the same direction
 * `process-meta-intake.ts` and the calibration pre-route ratified: PRECISION
 * OVER RECALL. A statement wrongly NOT recognised costs exactly one LLM turn
 * that behaves as it does today. A statement wrongly recognised hijacks an
 * ordinary conversational turn and puts counts in front of the user that
 * they did not give. Where it is uncertain, this grammar declines.
 *
 * WHY THE VERB / VAGUENESS LISTS BELOW ARE HAND-WRITTEN, stated rather than
 * hidden (CLAUDE.md trap 12 — the dominant defect is the hand-maintained
 * mirror). There is no canonical source in this estate to DERIVE an
 * outcome-verb lexicon from, so derivation is not available; what is
 * available is making the drift direction safe. Every entry missing from
 * these lists produces a FALSE NEGATIVE — the message falls through to the
 * LLM path exactly as today. No entry, present or absent, can cause a number
 * to be invented. That is the whole reason the lists are permitted to be
 * hand-written here, and the spec pins them with a two-directional corpus
 * (trap 12d: derivation proves agreement, a corpus is what notices a list is
 * SHORT).
 *
 * PURE — this module classifies and never applies, persists, or composes.
 */

/**
 * The verbatim parse of one count-bearing reference-class statement.
 * Every string field is BYTE-IDENTICAL to the user's words (I3): this module
 * slices, trims surrounding whitespace, and never rewrites, title-cases,
 * lemmatises, or normalises the content.
 */
export interface ParsedReferenceClass {
  /** The user's class description, VERBATIM. e.g. "product launches like this I've seen" */
  readonly class_description: string;
  /** What counted as the outcome, VERBATIM. e.g. "hit their first-year target" */
  readonly outcome_description: string;
  /** The user's count of cases with the outcome, as said. Integer, 0 <= K <= N. */
  readonly observed_k: number;
  /** The user's count of cases in the class, as said. Integer, N >= 1. */
  readonly observed_n: number;
  /** Comparability caveats, VERBATIM, when the user offered any. */
  readonly comparability_caveats?: string;
}

export type ReferenceClassClarifyReason =
  /** "5 out of 3 projects succeeded" — K > N. Never swapped, never clamped. */
  | 'k_exceeds_n'
  /** "0 out of 0" / a zero denominator. */
  | 'n_not_positive'
  /** "about half a dozen or so similar projects succeeded" — no two integers. */
  | 'vague_counts';

export type ReferenceClassRecognition =
  /** Not a count-bearing reference-class statement. The turn proceeds untouched. */
  | { readonly kind: 'none' }
  /** A recognised statement. Nothing has been created — this is the PREVIEW input. */
  | { readonly kind: 'statement'; readonly parsed: ParsedReferenceClass }
  /** Recognised as an ATTEMPT, but not usable. Ask; never guess. */
  | {
      readonly kind: 'clarify';
      readonly reason: ReferenceClassClarifyReason;
      readonly question: string;
    }
  /** The confirm chip's replay message. THIS is the only shape that creates an object. */
  | { readonly kind: 'confirm'; readonly parsed: ParsedReferenceClass };

// ============================================================================
// Lexicons — hand-written, fail-safe by direction (see the module docstring)
// ============================================================================

/**
 * Outcome-verb markers. The word at which a captured span stops being the
 * CLASS and starts being the OUTCOME ("similar projects | succeeded").
 *
 * Longest-first at match time so "ended up" beats "ended" and "made it"
 * beats "made" — the same longest-match-wins discipline
 * `detectProbabilityPhrase` uses, and for the same reason: only the longer
 * span carries the user's meaning.
 */
const OUTCOME_VERB_MARKERS: readonly string[] = [
  'came in under',
  'came in over',
  'came in',
  'ended up',
  'turned out',
  'made it',
  'went well',
  'went badly',
  'fell short',
  'hit their',
  'missed their',
  'paid off',
  'broke even',
  'succeeded',
  'failed',
  'worked',
  'delivered',
  'landed',
  'shipped',
  'launched',
  'converted',
  'renewed',
  'churned',
  'survived',
  'achieved',
  'reached',
  'exceeded',
  'beat',
  'hit',
  'missed',
  'met',
  'won',
  'lost',
  'closed',
  'were',
  'was',
];

/**
 * Vague quantifiers. Their presence in a K-of-N SHAPE means the user is
 * making a base-rate claim without the two integers — the grammar asks for
 * them rather than guessing (design §2.2). Guessing here would be the
 * fabricated-N defect this whole feature exists to prevent.
 */
const VAGUE_COUNT_MARKERS: readonly string[] = [
  'a few',
  'few',
  'several',
  'a handful',
  'a couple',
  'a bunch',
  'a dozen',
  'dozens',
  'half',
  'lots',
  'loads',
  'many',
  'most',
  'some',
  'plenty',
];

const VAGUE_ALTERNATION = VAGUE_COUNT_MARKERS.map((m) => m.replace(/ /g, '\\s+')).join('|');

/** The clarifying copy. Deterministic, and it always asks for the TWO INTEGERS. */
const CLARIFY_QUESTIONS: Readonly<Record<ReferenceClassClarifyReason, string>> = {
  k_exceeds_n:
    'I want to make sure I have those the right way round: you named a count that is larger than the group it came from. How many comparable cases were there in total, and how many of them had the outcome?',
  n_not_positive:
    'I need a group with at least one case in it to work from. How many comparable cases have you seen, and how many of them had the outcome?',
  vague_counts:
    'I can work with a base rate if you can put two numbers on it. Roughly how many comparable cases have you seen, and how many of them had the outcome?',
};

// ============================================================================
// Patterns
// ============================================================================

/**
 * The confirm chip's replay prefix. An EXPLICIT, UNAMBIGUOUS IMPERATIVE that
 * carries the full K / N / class / outcome, so the confirm turn re-parses to
 * exactly the statement the preview showed — the same discipline
 * `buildCalibrationConfirmMessage` follows ("Set X to 70%.").
 *
 * It is what makes I8 (confirmation IS existence) structural: only a message
 * bearing this prefix can reach the object constructor.
 */
export const REFERENCE_CLASS_CONFIRM_PREFIX = 'Record this base rate:';

const CONFIRM_PREFIX_PATTERN = /^\s*record\s+this\s+base\s+rate\s*:\s*/i;

/**
 * Pattern A — N-first with an explicit "of":
 *   "Of the 7 product launches like this I've seen, 3 hit their first-year target"
 * The clause boundary (comma or semicolon) separates class from the K-clause.
 */
const N_FIRST_OF_PATTERN =
  /\bof\s+(?:the\s+)?(\d+)\s+([^,;.!?]+?)\s*[,;]\s*(\d+)\s+([^.;!?]+)/i;

/**
 * Pattern B — N-first with an experience verb:
 *   "we've run 12 campaigns; 9 landed"
 *   "I've seen 20 rollouts, 4 slipped"
 */
const N_FIRST_EXPERIENCE_PATTERN =
  /\b(?:i|we)\s*(?:'ve|\s+have)?\s*(?:seen|run|ran|done|tried|shipped|launched|been\s+through|worked\s+on)\s+(\d+)\s+([^,;.!?]+?)\s*[,;]\s*(\d+)\s+([^.;!?]+)/i;

/**
 * Pattern C — K-of-N inline:
 *   "3 out of 7 similar projects succeeded"
 * The trailing span is split at the first outcome-verb marker; text before it
 * is the class, the marker onward is the outcome.
 *
 * ⚠ THIS IS THE 2.722 HAZARD'S EXACT SHAPE. `parseFraction`
 * (`src/cee/belief-elicitation/index.ts:335-348`) matches
 * `/(\d+)\s*(?:in|out of)\s*(\d+)/i` and collapses this sentence to 0.43 with
 * confidence 'high', destroying the 7. The discrimination that keeps "3 in 4"
 * a legitimate probability while "3 out of 7 similar projects succeeded"
 * becomes a reference class is the REQUIRED trailing class-and-outcome span:
 * a bare fraction has none, so it is not recognised here and keeps its
 * existing meaning everywhere.
 */
const K_OF_N_PATTERN = /(\d+)\s+(?:out\s+of|of|in)\s+(?:the\s+)?(\d+)\s+([^.;!?]+)/i;

/** The K-of-N shape with a vague quantifier on either side of the "of". */
const VAGUE_K_OF_N_PATTERN = new RegExp(
  String.raw`\b(?:${VAGUE_ALTERNATION}|\d+)\s+(?:out\s+of|of|in)\s+(?:the\s+|a\s+)?(?:${VAGUE_ALTERNATION})\b`,
  'i',
);

/**
 * Comparability caveats, VERBATIM. Captured, never acted on: v1 applies NO
 * discount for imperfect comparability (design §3.3 — an effective sample
 * size would need a constant nobody has ruled). The caveat rides the
 * disclosure in the user's own words so the reader can discount it
 * themselves.
 */
const CAVEAT_PATTERN =
  /\b((?:though|although|but|mind\s+you|admittedly|that\s+said|to\s+be\s+fair)\b[^.;!?]+)/i;

// ============================================================================
// Recognition
// ============================================================================

function splitClassAndOutcome(
  span: string,
): { readonly class_description: string; readonly outcome_description: string } | null {
  const haystack = span.toLowerCase();
  let bestIndex = -1;
  let bestLength = 0;
  for (const marker of OUTCOME_VERB_MARKERS) {
    const index = haystack.indexOf(marker);
    if (index <= 0) continue; // index 0 => no class words before the verb
    // Word-boundary on both sides so "was" does not fire inside "washing".
    const before = haystack[index - 1];
    const after = haystack[index + marker.length];
    if (before !== undefined && /[a-z0-9]/.test(before)) continue;
    if (after !== undefined && /[a-z0-9]/.test(after)) continue;
    // Earliest split wins; on a tie the LONGER marker wins.
    if (bestIndex === -1 || index < bestIndex || (index === bestIndex && marker.length > bestLength)) {
      bestIndex = index;
      bestLength = marker.length;
    }
  }
  if (bestIndex === -1) return null;
  const class_description = span.slice(0, bestIndex).trim();
  const outcome_description = span.slice(bestIndex).trim();
  if (class_description.length === 0 || outcome_description.length === 0) return null;
  return { class_description, outcome_description };
}

function readCaveat(message: string): string | undefined {
  const match = CAVEAT_PATTERN.exec(message);
  const caveat = match?.[1]?.trim();
  return caveat !== undefined && caveat.length > 0 ? caveat : undefined;
}

/**
 * Build the parse, or refuse. K <= N is enforced HERE and an inverted
 * statement CLARIFIES — it is never swapped and never clamped. An inverted
 * statement is a slip the user should see, and silently repairing it would
 * put a number in front of them that they did not say.
 */
function buildParse(
  rawK: string,
  rawN: string,
  classDescription: string,
  outcomeDescription: string,
  message: string,
): ReferenceClassRecognition {
  const k = Number(rawK);
  const n = Number(rawN);
  if (!Number.isInteger(k) || !Number.isInteger(n)) {
    return { kind: 'clarify', reason: 'vague_counts', question: CLARIFY_QUESTIONS.vague_counts };
  }
  if (n < 1) {
    return {
      kind: 'clarify',
      reason: 'n_not_positive',
      question: CLARIFY_QUESTIONS.n_not_positive,
    };
  }
  if (k > n) {
    return { kind: 'clarify', reason: 'k_exceeds_n', question: CLARIFY_QUESTIONS.k_exceeds_n };
  }
  const trimmedClass = classDescription.trim();
  const trimmedOutcome = outcomeDescription.trim();
  if (trimmedClass.length === 0 || trimmedOutcome.length === 0) return { kind: 'none' };
  const caveat = readCaveat(message);
  return {
    kind: 'statement',
    parsed: {
      class_description: trimmedClass,
      outcome_description: trimmedOutcome,
      observed_k: k,
      observed_n: n,
      ...(caveat !== undefined ? { comparability_caveats: caveat } : {}),
    },
  };
}

/**
 * Recognise a count-bearing reference-class statement.
 *
 * Returns `{ kind: 'none' }` for everything this grammar does not own —
 * which is the overwhelming majority of turns, including every stated rate
 * without counts, every calibration phrase, and every product coaching
 * prompt. The turn then proceeds exactly as it does today.
 */
export function recogniseReferenceClass(message: string): ReferenceClassRecognition {
  if (typeof message !== 'string' || message.trim().length === 0) return { kind: 'none' };

  const isConfirm = CONFIRM_PREFIX_PATTERN.test(message);
  const body = isConfirm ? message.replace(CONFIRM_PREFIX_PATTERN, '') : message;

  // A percentage anywhere in the numeric slots means the user stated a RATE,
  // not counts. Refused into this machinery (I5) — it routes on as today.
  // Checked FIRST so "3 out of 7% ..." can never be read as a count pair.
  const percentInCountSlot = /\d+\s*%\s*(?:out\s+of|of|in)\s+/i.test(body) || /(?:out\s+of|of|in)\s+(?:the\s+)?\d+\s*%/i.test(body);
  if (percentInCountSlot) return { kind: 'none' };

  const patterns: readonly RegExp[] = [
    N_FIRST_OF_PATTERN,
    N_FIRST_EXPERIENCE_PATTERN,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(body);
    if (match === null) continue;
    const [, rawN, classSpan, rawK, outcomeSpan] = match;
    if (rawN === undefined || classSpan === undefined || rawK === undefined || outcomeSpan === undefined) {
      continue;
    }
    const built = buildParse(rawK, rawN, classSpan, outcomeSpan, body);
    if (built.kind === 'none') continue;
    return isConfirm && built.kind === 'statement' ? { kind: 'confirm', parsed: built.parsed } : built;
  }

  const inline = K_OF_N_PATTERN.exec(body);
  if (inline !== null) {
    const [, rawK, rawN, span] = inline;
    if (rawK !== undefined && rawN !== undefined && span !== undefined) {
      const split = splitClassAndOutcome(span);
      if (split !== null) {
        const built = buildParse(rawK, rawN, split.class_description, split.outcome_description, body);
        if (built.kind !== 'none') {
          return isConfirm && built.kind === 'statement'
            ? { kind: 'confirm', parsed: built.parsed }
            : built;
        }
      }
    }
  }

  // No usable integer pair. If the sentence nonetheless has the K-of-N SHAPE
  // with a vague quantifier AND an outcome verb, the user is making a
  // base-rate claim they have not quantified — ask for the two integers.
  if (VAGUE_K_OF_N_PATTERN.test(body) && splitClassAndOutcome(body) !== null) {
    return { kind: 'clarify', reason: 'vague_counts', question: CLARIFY_QUESTIONS.vague_counts };
  }

  return { kind: 'none' };
}

/**
 * ⭐⭐ THE 2.722 GUARD PREDICATE — "would this utterance lose its sample size
 * if it reached a point-probability parser?"
 *
 * TRUE exactly when {@link recogniseReferenceClass} owns the utterance as a
 * count-bearing statement (or would, once the counts are supplied). The
 * consumer is `src/cee/belief-elicitation/index.ts`, which imports THIS
 * rather than re-implementing the discrimination — one place, no mirror.
 *
 * WHAT IT PROTECTS. `parseFraction` maps "3 out of 7 similar projects
 * succeeded" to 0.43 with confidence 'high'. That is two defects at once: the
 * 7 is destroyed, and a small-sample statement is returned as a near-certain
 * point. This predicate lets that path ASK instead — never silently assert
 * sureness the user never expressed.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH. A bare fraction ("3 in 4", "3/4",
 * "1 in 10") carries no class and no outcome, is not recognised, and keeps
 * its documented meaning for every existing caller. The guard is narrow by
 * construction, not by a second hand-kept list.
 */
export function isReferenceClassCollapseHazard(expression: string): boolean {
  const recognition = recogniseReferenceClass(expression);
  return recognition.kind === 'statement' || recognition.kind === 'confirm';
}
