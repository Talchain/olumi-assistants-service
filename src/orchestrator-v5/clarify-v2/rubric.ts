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
 *   - `options`    — evidence of ≥2 alternatives, either JOINED ("X or Y",
 *                    "versus", "alternative", "instead of") or ENUMERATED
 *                    ("three options: A, B and C", a short-list, repeated
 *                    "Option A … Option B" labels).
 *   - `quantities` — any magnitude signal (digits, currency, number words).
 *   - `timeframe`  — a horizon marker ("this year", "by Q3", "by March",
 *                    "within…"/"in six months"/"over the next two years",
 *                    a bare stated duration/runway like "14 months", or a
 *                    stated window like "a six month window").
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
    // PREFERENCE / PRIORITY constructions — how a real person actually states
    // an objective ("I care most about profit in 2 years", "what matters most
    // is margin", "my priority is cash", "we're optimising for retention").
    // The end-to-end journey (2026-07-25, Finding #4) brought a brief ending
    // "I care most about profit in 2 years"; goal scored MISSING on 5 of 5
    // fresh users, so the first thing every new customer saw was a question
    // asking for the goal they had just given, offering "grow revenue" and
    // "cut costs" — neither of which was it. The drafter then named the goal
    // exactly right ("Maximise 2-Year Net Profit"), so the information was
    // there the whole time and only the rubric could not see it.
    //
    // PRECISION over recall, per the round-2 calibration direction B: an
    // INTENSIFIER is required on the "care about" arm, so "I care most about
    // profit" satisfies goal while a bare "I care about my team" (a value, not
    // an objective) does not. Every arm is anchored to a first-person subject
    // or an explicit priority noun so no adjectival use can fire.
    /\b(?:I|we)\s+(?:really\s+)?care\s+(?:most|mainly|mostly|primarily|above all)\s+about\b/i,
    /\bwhat\s+(?:I|we)\s+care\s+(?:most\s+)?about\b/i,
    /\bwhat\s+matters\s+most\b/i,
    /\b(?:my|our)\s+(?:main\s+|top\s+|number one\s+|overriding\s+)?priority\s+(?:is|here is)\b/i,
    /\b(?:optimis|optimiz)(?:e|es|ed|ing)\s+for\b/i,
    // SUCCESS-DEFINITION constructions the launch battery's `success …` arm
    // missed. It credited "success looks like / means / is defined / is
    // measured" but not the equally common future-conditional phrasing
    // ("Success would be fewer than five failed invoices a week"), so a user
    // who had just defined success was asked "What outcome would make this
    // decision a success?" — the outcome half of ROADMAP 2.103. Anchored on
    // the modal so a bare "success is important" cannot fire.
    /\bsuccess\s+(?:would|will|should)\s+be\b/i,
  ],
  options: [
    /\b(?:versus|vs\.?|alternative(?:s|ly)?|either|instead of|rather than|compared? (?:to|with)|(?:choice|choos(?:e|ing)|decid(?:e|ing)) between|option[s]? (?:are|would be|include))\b/i,
    // ENUMERATED alternatives — the ROADMAP 2.103 / HANDOVER 18 Jul defect.
    // EVERY arm the launch battery shipped requires a JOINING WORD (or /
    // versus / either / instead of / weighing … against), so a brief that
    // LISTS its alternatives instead of joining them matched nothing:
    // "We have three options: Vendor A at £180,000, Vendor B at £240,000,
    // and an in-house build at £200,000" scored options-MISSING, and the
    // intake asked "What alternatives are you weighing this against?" over a
    // brief that had just enumerated three of them. Reproduced independently
    // twice on live journeys (HANDOVER 18 Jul; ROADMAP 2.103, 28 Jul).
    //
    // PRECISION over recall is preserved by requiring the option-family
    // NOUN: a bare comma list ("we sell in France, Spain and Italy") is not
    // evidence of alternatives and still scores MISSING. `alternatives` is
    // already covered by the bare-word arm above; it is listed here only so
    // the enumeration shapes read as one rule.
    /\b(?:options|alternatives|choices|candidates|contenders)\s*(?:are|were|would be|include|:|—|–)\s*\S/i,
    // A COUNTED option set — "three options", "two candidates", "4 routes".
    // The count itself is the evidence that ≥2 alternatives exist. Restricted
    // to choice-set nouns; deliberately excludes generic entity nouns
    // ("three vendors", "two teams") which carry no decision framing.
    /\b(?:two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:options|alternatives|choices|candidates|contenders|routes|paths|proposals|bids|quotes)\b/i,
    // A short-list is a set of alternatives by definition.
    /\bshort[- ]?list(?:s|ed)?\b/i,
    // Repeated explicit option LABELS ("Option A … Option B", "Option 1 …
    // Option 2"). Requires TWO occurrences within a bounded span, so a
    // single "Option A looks fine" cannot satisfy the dimension alone.
    /\boption\s+(?:[a-e]|one|two|three|1|2|3)\b[\s\S]{0,400}?\boption\s+(?:[a-e]|one|two|three|1|2|3)\b/i,
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
    // ROADMAP 2.103 — a WORD-FORM horizon behind any preposition other than
    // the literal "within". The arm above is digit-anchored and the arm above
    // THAT hard-codes the opener "within", so "it must be live in six months"
    // scored timeframe-MISSING and the intake asked for a horizon the brief
    // had just stated. This is the THIRD correction of this same class in
    // this battery (the "14 months runway" and "profit in 2 years" fixes
    // above are the first two) — the recurring error is assuming the ONE
    // phrasing the fixture author happened to write.
    //
    // The FORWARD anchor is what keeps precision: the number-word must follow
    // the preposition immediately, so a backward-looking "in the last three
    // years" / "over the past two quarters" cannot fire (its "the" blocks the
    // match), and the deliberate exclusion of bare compound adjectives
    // ("four-day week", "two-year plan") is untouched — they carry no
    // preposition.
    /\b(?:in|over|across|within)\s+(?:a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen)\s+(?:week|month|quarter|year)s?\b/i,
    // The explicitly forward-looking form, which may carry a determiner:
    // "over the next two years", "for the next three quarters".
    /\b(?:in|over|across|within|for|during)\s+the\s+(?:next|coming)\s+(?:a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen|few)\s+(?:week|month|quarter|year)s?\b/i,
    // A word-form duration attached to an explicit HORIZON NOUN — "a six
    // month window", "an eighteen month runway". The noun is what makes this
    // a decision horizon rather than a compound adjective, so the digit
    // anchor is not needed and the "two-year plan" exclusion still holds
    // (no horizon noun follows it).
    /\b(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen)[\s-](?:week|month|quarter|year)[\s-](?:window|horizon|runway|deadline|timeline|period|programme|program)\b/i,
    // A bare calendar-month deadline. "by the end of March" already matched
    // the `by (?:the )?end of` arm at the top; the bare "by March" did not.
    /\bby\s+(?:next\s+|early\s+|mid[- ]|late\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
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
