/**
 * Clarify v2 — deterministic brief-completeness rubric (ROADMAP 1.94,
 * Option A replacement; E0-B lane, 2026-07-16).
 *
 * The retired Stage-4 clarifier (#486) gated question generation on the
 * DRAFTING LLM's self-reported confidence — a measure of the drafter, not
 * of the brief — and consequently never asked anything (0 questions in ≥7
 * days of staging logs, positive-control-verified). This rubric is the
 * replacement's decision authority and deliberately measures the BRIEF:
 * four testable completeness dimensions, each detected by a deterministic
 * pattern battery over the brief text. No LLM call, no confidence score.
 *
 * The dimensions mirror the 1.94 build spec ("missing goal / no options /
 * no quantities / ambiguous scope"):
 *   - `goal`       — an explicit outcome/purpose marker ("the goal is…",
 *                    "in order to…", "to increase…").
 *   - `options`    — evidence of ≥2 alternatives ("X or Y", "versus",
 *                    "alternative", "instead of").
 *   - `quantities` — any magnitude signal (digits, currency, number words).
 *   - `timeframe`  — a horizon marker ("this year", "by Q3", "within…", or
 *                    a bare stated duration/runway like "14 months").
 *
 * RELATIONSHIP TO `src/cee/signals/brief-signals.ts` (deliberate seam, not
 * an accidental twin): `computeBriefSignals` answers a DIFFERENT question —
 * "is this brief measurable/strong?" (explicit option labels, numeric
 * targets, baselines, named constraints/risks) for the V1 preflight
 * readiness score. Probed empirically (E0-B, 2026-07-16): it scores
 * "Should we hire a senior tech lead or two junior developers to
 * accelerate the platform rebuild this year?" as `weak` with 5 missing
 * items (option_count 1, has_explicit_goal false, 0 anchors) — deriving
 * the clarify gate from it would fire questions on virtually every
 * naturally-phrased brief, violating the complete-brief-silence floor.
 * This rubric answers "is the brief draftable without one round of
 * tap-able questions?" and is calibrated for that. If the two engines
 * ever converge, fold THIS one into signals/ — never maintain a third.
 *
 * Detector philosophy: PRECISION over recall for the "satisfied" verdict.
 * A false "missing" costs one tap-able question with a default-forward
 * escape; a false "satisfied" silently reproduces today's never-asks
 * baseline. Detectors are exported so the fixture floors pin each one
 * against the eval pack (tools/conversation-harness/fixtures/
 * clarify-v2-briefs.json) — behaviour changes must move fixtures, loudly.
 *
 * Pure and total: no I/O, no config reads, never throws.
 */

export const CLARIFY_V2_DIMENSIONS = [
  'goal',
  'options',
  'quantities',
  'timeframe',
] as const;

export type ClarifyDimension = (typeof CLARIFY_V2_DIMENSIONS)[number];

export function isClarifyDimension(value: unknown): value is ClarifyDimension {
  return (CLARIFY_V2_DIMENSIONS as readonly string[]).includes(value as string);
}

/**
 * Priority order for question selection when more dimensions are missing
 * than the per-round question budget: a model with no objective is
 * un-analysable; options define the decision; a horizon anchors judgement;
 * quantities sharpen it.
 */
export const CLARIFY_V2_DIMENSION_PRIORITY: readonly ClarifyDimension[] = [
  'goal',
  'options',
  'timeframe',
  'quantities',
];

/**
 * Per-dimension detector batteries. A dimension is SATISFIED when any
 * pattern in its battery matches the brief.
 *
 * Kept as data (not per-dimension functions) so tests can iterate the
 * whole surface: the question-template invariant test proves every
 * candidate answer, appended to a brief, flips its own dimension to
 * satisfied — the mechanism that makes answered questions impossible to
 * re-ask (the no-repeat invariant is enforced by construction, not by
 * string-comparing question text).
 */
export const CLARIFY_V2_DIMENSION_DETECTORS: Readonly<
  Record<ClarifyDimension, readonly RegExp[]>
> = {
  goal: [
    // "target" needs a goal-marker construction ("the target is…", "target
    // of 20%"): the bare noun over-matched adjectival uses ("the target
    // account list") and silently satisfied goal on genuinely thin briefs
    // (round-2 calibration, direction B).
    /\b(?:goal|objective|aim|purpose|target (?:is|of)|success (?:looks like|means|criterion|metric|is (?:defined|measured))|so that|in order to)\b/i,
    /\bto (?:increase|grow|improve|boost|reduce|cut|lower|save|protect|retain|maximise|maximize|minimise|minimize|accelerate|win|achieve|hit|reach)\b/i,
    /\bwe (?:want|need|hope|are trying|are aiming) to\b/i,
  ],
  options: [
    /\b(?:versus|vs\.?|alternative(?:s|ly)?|either|instead of|rather than|compared? (?:to|with)|(?:choice|choos(?:e|ing)|decid(?:e|ing)) between|option[s]? (?:are|would be|include))\b/i,
    // "weighing X against Y" — the weigh-verb construction names two
    // alternatives without an "or" (round-2 calibration, direction A).
    // Bounded gap so an unrelated "against" clauses away does not fire.
    /\bweigh(?:ing|ed|s)?\b[^.!?;]{0,80}\bagainst\b/i,
    // A bare "or" joining alternatives ("hire a lead or two developers",
    // "raise prices by 10% or hold"). Anchored between non-space tokens so
    // leading / trailing fragments do not fire; the left token is \S (not
    // \w) because alternatives routinely end in %, £, digits or ).
    // "X or not" is excluded: it restates the yes/no framing, it does not
    // name a second alternative (round-2 calibration, direction B).
    /\S\s+or\s+(?!not\b)\w/i,
  ],
  quantities: [
    // Digits, EXCEPT a bare calendar year (1900–2099): "this 2026" is a
    // timeframe signal, not a magnitude, and the old bare /\d/ silently
    // satisfied quantities on briefs with no scale at all (round-2
    // calibration, direction B). Longer runs ("20,000", "2026Q1") still
    // count via the surrounding-digit lookarounds.
    /(?<!\d)(?!(?:19|20)\d\d(?!\d))\d/,
    /[£$€]/,
    // "one" removed: as a determiner/pronoun ("the one big account", "one
    // more review") it carries no magnitude and over-matched (direction B).
    /\b(?:percent|per cent|half|double|triple|dozens?|hundreds?|thousands?|millions?|billions?|two|three|four|five|six|seven|eight|nine|ten|twenty|fifty)\b/i,
  ],
  timeframe: [
    /\b(?:today|tomorrow|this (?:week|month|quarter|year)|next (?:week|month|quarter|year)|by (?:the )?end of|deadline|timeline|time ?frame|horizon|short[- ]term|long[- ]term|near[- ]term|q[1-4]\b|20\d\d|within (?:a|one|two|three|six|twelve|\d+) ?(?:week|month|quarter|year)s?)\b/i,
    // A bare stated duration / runway horizon — DIGITS immediately followed
    // by a time unit, WITHOUT the "within …" opener the arm above requires.
    // "14 months", "18-month runway", "6 week sprint", "in 9 months". A
    // runway or stated horizon IS a timeframe signal; the launch battery
    // credited only the "within …" phrasing and so scored the journey
    // probe's "current runway 14 months" as timeframe-MISSING — clarify then
    // asked for a horizon the brief already carried (19 Jul first-message
    // probe, scenario 43238dd6). Digit-anchored on purpose: the WORD form
    // ("four-day week", "two-year plan") is a compound adjective / schedule,
    // not a decision horizon — precision over recall for the "satisfied"
    // verdict (a false-missing costs one tap-able question; a false-satisfied
    // silently reproduces the never-asks baseline). The number-word durations
    // stay reachable only through the "within …" arm above, deliberately.
    /(?<!\d)\d{1,4}[\s-]*(?:week|month|quarter|year)s?\b/i,
  ],
};

export interface BriefCompleteness {
  /** Dimensions the brief already satisfies, in canonical order. */
  readonly satisfied: readonly ClarifyDimension[];
  /** Dimensions the brief is missing, in priority order. */
  readonly missing: readonly ClarifyDimension[];
  /** True when nothing is missing — the caller must proceed silently. */
  readonly complete: boolean;
}

/**
 * Assess a decision brief against the four completeness dimensions.
 * Deterministic: identical input ⇒ identical verdict, always.
 */
export function assessBriefCompleteness(brief: string): BriefCompleteness {
  const satisfied: ClarifyDimension[] = [];
  const missingUnordered = new Set<ClarifyDimension>();
  for (const dimension of CLARIFY_V2_DIMENSIONS) {
    const detected = CLARIFY_V2_DIMENSION_DETECTORS[dimension].some((re) =>
      re.test(brief),
    );
    if (detected) {
      satisfied.push(dimension);
    } else {
      missingUnordered.add(dimension);
    }
  }
  const missing = CLARIFY_V2_DIMENSION_PRIORITY.filter((d) =>
    missingUnordered.has(d),
  );
  return { satisfied, missing, complete: missing.length === 0 };
}
