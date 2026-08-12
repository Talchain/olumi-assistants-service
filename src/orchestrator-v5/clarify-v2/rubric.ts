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
 *                    "versus", "alternative", "instead of"), ENUMERATED
 *                    ("three options: A, B and C", a short-list, repeated
 *                    "Option A … Option B" labels), or LISTED as parallel
 *                    actions under a choice lead ("should we A, B, and C?" —
 *                    ROADMAP 2.162a).
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
 * CHOICE-SET NOUNS, in TWO deliberately-separated tiers (ROADMAP 2.162a Slice
 * A, amended after adversarial review).
 *
 * `_CORE` is the vocabulary that shipped before 2.162a. `_WIDENED` is the six
 * nouns 2.162a adds. They are separated NOT because two lists are wanted —
 * that is exactly the trap-12 drift this lane was fixing — but because the two
 * tiers have measurably different precision and therefore earn different
 * evidence requirements. Each tier is written ONCE and every arm derives from
 * these two names, so there is still no list to keep in sync by hand.
 *
 * WHY THE SPLIT, measured. The first cut of this fix put all sixteen nouns
 * into every arm. An untargeted corpus of naturally-written thin briefs then
 * showed the widened nouns firing on ordinary prose that names no alternatives
 * at all — `"Our plans are ambitious, but our budget is tight"`, `"there are
 * three ways this could go wrong"`. The `_CORE` nouns do not do this: they are
 * choice-set nouns in essentially every usage, which is why they were safe to
 * ship bare. `plans`/`ways`/`directions` are ordinary nouns that happen to be
 * choice-set nouns in SOME usages, so they need the usage pinned down.
 *
 * Plural-only in both tiers: a singular "our plan" names ONE thing.
 */
const CHOICE_SET_NOUNS_CORE =
  'options|alternatives|choices|candidates|contenders|routes|paths|proposals|bids|quotes';

/**
 * The 2.162a additions. Admitted ONLY with same-sentence evidence that the
 * noun is being used to introduce a choice set — list punctuation for the
 * enumeration arm, a decision frame for the counted arm. Never bare.
 */
const CHOICE_SET_NOUNS_WIDENED =
  'approaches|ways|directions|scenarios|plans|courses of action';

/** Both tiers, for the arms that carry their own evidence requirement. */
const CHOICE_SET_NOUNS_ALL = `${CHOICE_SET_NOUNS_CORE}|${CHOICE_SET_NOUNS_WIDENED}`;

/**
 * Count tokens. A COUNT in front of a CORE choice-set noun ("three options",
 * "4 routes") is self-evidencing: it states that ≥2 alternatives exist. In
 * front of a WIDENED noun it is not — "three ways this could go wrong" counts
 * failure modes, not alternatives — so that arm carries a decision frame too.
 */
const COUNT_TOKENS = 'two|three|four|five|six|seven|eight|nine|ten|\\d+';

/**
 * A DELIBERATIVE choice lead — "should we …", "we could …", "do we …".
 *
 * Deliberately excludes the ASSERTIVE modals (`will`, `must`, `shall`) and the
 * second/third-person subjects (`you`, `they`). Measured reason: "We WILL
 * launch in Q1, hire in Q2, and expand in Q3" is a plan being announced, not a
 * choice being weighed, and the first cut credited it as three alternatives.
 * A lead has to mark deliberation for the list after it to be a choice set.
 */
const CHOICE_LEAD =
  '(?:(?:should|could|can|do|would|might)\\s+(?:we|i)|(?:we|i)\\s+(?:could|can|might|may|should|would))';

/**
 * Base-form ACTION verbs that can head an alternative in a business decision.
 *
 * This is the ITEM-LEVEL ANCHOR that makes the serial-list arm safe, and it is
 * the whole reason that arm can ship. Ordinary English serial grammar ("A, B,
 * and C") is used for lots of things that are NOT alternatives — a geography
 * list ("launch in France, Spain, and Italy"), a shopping list ("buy laptops,
 * monitors, and desks"), a set of facts.
 *
 * ⚠ "Item-level" means EVERY item, and the first cut of this arm did not do
 * that: it checked the first item and the item after the terminating
 * `and`/`or`, with an unconstrained span between them. Adversarial review
 * broke it in one word — "Should we launch in France, Spain, Italy, and hire
 * locally this year?" has an action verb at each END and junk in the middle,
 * and scored COMPLETE. The arm below now requires a verb at the head of every
 * comma-separated item, with no comma permitted inside an item, so there is no
 * unchecked span left for a non-alternative to hide in.
 *
 * Deliberately CLOSED, and it fails in the SAFE direction: an unlisted verb
 * scores options-MISSING, which costs one tap-able question with a
 * default-forward escape — never a silent false "satisfied". So this list is
 * not the trap-12 mirror class (there is no other source of truth it must be
 * kept in sync with); it is a precision floor that can only under-credit.
 */
/**
 * State-transition verbs for the from-X-to-Y options arm (Track-1 intake
 * fix). Deliberately CLOSED and SMALL: each verb must make "from X to Y"
 * read as two states of the same thing — i.e. a status-quo alternative and
 * a proposed one. Growth/measurement verbs (grew, rose, went) are excluded
 * on purpose: their from…to names a RANGE, not a choice set. Fails safe:
 * an unlisted verb scores options-MISSING (one tap-able question), never a
 * silent false "satisfied".
 */
const FROM_TO_CHANGE_VERBS =
  'switch(?:ing)?|mov(?:e|ing)|shift(?:ing)?|transition(?:ing)?|migrat(?:e|ing)|chang(?:e|ing)|convert(?:ing)?|go(?:ing)?|pivot(?:ing)?|upgrad(?:e|ing)|downgrad(?:e|ing)';

const CHOICE_ACTION_VERBS =
  'abandon|acquire|adopt|automate|begin|bring|build|buy|cancel|centralise|centralize|close|commission|consolidate|continue|contract|cut|defer|delay|develop|divest|do|double|drop|end|enter|exit|expand|extend|finance|fire|focus|fund|go|grow|halt|hire|hold|insource|integrate|invest|keep|launch|lease|licence|license|merge|migrate|modernise|modernize|move|offer|open|outsource|partner|patch|pause|pilot|pivot|procure|promote|prototype|raise|rebuild|recruit|reduce|refactor|rehire|reinvest|relaunch|renegotiate|renew|rent|replace|restructure|retain|rewrite|run|scale|sell|ship|spend|split|sponsor|standardise|standardize|start|stay|stop|subcontract|switch|take|test|train|trial|upgrade|use|wait';

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
    // TRACK-1 INTAKE FIX (2026-08-13) — the predicate-nominative PRIZE
    // construction, MEASURED as a detection miss on a real wire brief
    // (INTAKE-FUNNEL §2.1, brief M3: "Faster delivery to northern customers
    // is the main prize" — an explicit objective statement no arm could see;
    // the fourth instance of the same class the three corrections above
    // record). Anchored on the copula + determiner ("is/are/remains the …
    // prize") so prize-as-subject ("First prize is a weekend in Paris"),
    // "a prize draw" and "the prize money" cannot fire — the opposite-
    // direction twins are pinned in clarify-v2.rubric-widening.test.ts
    // (trap 22b: every positive ships with its inverse).
    /\b(?:is|are|remains)\s+the\s+(?:(?:main|real|big|biggest|key|top)\s+)?prize\b/i,
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
    // NOUN: an UNANCHORED comma list ("we sell in France, Spain and Italy") is
    // not evidence of alternatives and still scores MISSING (see the
    // serial-list arm at the bottom for the anchored case that IS credited).
    // `alternatives` is already covered by the bare-word arm above; it is
    // listed here only so the enumeration shapes read as one rule.
    //
    // ROADMAP 2.162a, AMENDED after adversarial review. The COPULA form
    // (`are|were|would be|include`) keeps the pre-2.162a CORE noun set,
    // BYTE-FOR-BYTE the behaviour that shipped before this lane — the widened
    // nouns are ordinary prose in that construction and leak badly.
    //
    // ⚠ The first cut of this fix tried to admit the widened nouns here behind
    // a "must introduce a list" guard (a comma or an `and`/`or` within 160
    // chars). That guard was WRONG: it looks for a separator ANYWHERE in the
    // sentence, not between items, so "Our plans are ambitious, but our budget
    // is tight" satisfied it on the comma of an ordinary subordinate clause.
    // The guard is withdrawn entirely rather than patched — with the CORE set
    // restored there is nothing left for it to protect, and a guard that
    // cannot state which token it requires is a guard nobody can review.
    // ⚠ The noun set here is the FIVE the copula arm shipped with, not the ten
    // the COUNTED arm shipped with — those were always different sets and the
    // difference is not the drift this lane set out to fix. A first pass at
    // this amendment used the ten and the corpus caught it immediately: "The
    // paths are unclear" credited options on a brief naming none. Restored to
    // five, i.e. byte-equivalent to the pre-2.162a behaviour.
    /\b(?:options|alternatives|choices|candidates|contenders)\s*(?:are|were|would be|include)\s*\S/i,
    // LIST-INTRODUCING PUNCTUATION, in which the full vocabulary is safe:
    // a colon or a dash after a choice-set noun IS the enumeration marker, and
    // it is what gives this arm the `routes|paths` the counted arm always had.
    // "Approaches: rebuild, buy, stay" is a list of alternatives; "our
    // approaches are varied" is a sentence about them, and only the first
    // shape can reach this arm.
    new RegExp(`\\b(?:${CHOICE_SET_NOUNS_ALL})\\s*[:—–]\\s*\\S`, 'i'),
    // A COUNTED option set — "three options", "two candidates", "4 routes".
    // The count itself is the evidence that ≥2 alternatives exist. Restricted
    // to CORE choice-set nouns; deliberately excludes generic entity nouns
    // ("three vendors", "two teams") which carry no decision framing.
    // Unchanged from the pre-2.162a battery.
    new RegExp(`\\b(?:${COUNT_TOKENS})\\s+(?:${CHOICE_SET_NOUNS_CORE})\\b`, 'i'),
    // The same COUNTED shape for the WIDENED nouns, which need one more thing.
    // ⚠ Measured: a bare count in front of a widened noun is NOT evidence of
    // alternatives — "there are three ways this could go wrong" counts failure
    // modes, "two directions the market could move" counts outcomes. So the
    // count must sit in the same sentence as an explicit decision frame: list
    // punctuation, "on the table", or a considering/weighing/choosing-between
    // verb, in either order.
    new RegExp(
      `\\b(?:${COUNT_TOKENS})\\s+(?:${CHOICE_SET_NOUNS_WIDENED})\\b[^.!?;]{0,60}?(?:[:—–]|\\bon the table\\b)` +
        `|\\b(?:consider(?:ing)?|weigh(?:ing)?|evaluating|(?:choos(?:e|ing)|decid(?:e|ing))\\s+between)\\b[^.!?;]{0,60}?\\b(?:${COUNT_TOKENS})\\s+(?:${CHOICE_SET_NOUNS_WIDENED})\\b`,
      'i',
    ),
    // A COUNTED set under active consideration — "four things we are
    // considering", "three items on the table". The count carries the ≥2
    // evidence; the consideration verb (or "on the table") carries the
    // decision framing that a bare "four things" lacks. Without the count this
    // would fire on any brief that mentions considering anything, so the count
    // is not decoration (ROADMAP 2.162a Slice A).
    new RegExp(
      `\\b(?:${COUNT_TOKENS})\\s+(?:things|items|ideas)\\s+(?:(?:we|i)\\s+(?:are\\s+|'re\\s+)?(?:considering|weighing|evaluating|looking at)|(?:we|i)\\s+(?:could|can|might)\\s+do|on the table)\\b`,
      'i',
    ),
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
    //
    // ROADMAP 2.162a: `and/or` is now accepted. The original pattern required
    // WHITESPACE immediately before `or`, so the very common "X, Y, and/or Z"
    // — where `or` is preceded by a slash — scored MISSING. That was a
    // whitespace accident, not a decision: `and/or` is a disjunction marker by
    // definition, and the "or not" exclusion still applies through it.
    /\S\s+(?:and\/)?or\s+(?!not\b)\w/i,
    // A SERIAL LIST of parallel actions under a choice lead — ordinary English
    // "A, B, and C" grammar, which is how people actually name alternatives
    // and which NOTHING in the battery above credits: every other arm needs a
    // joining `or` / `versus` / `weighing … against` or an option-family noun.
    // The measured consequence (2.162a adjudication, executed against the
    // deployed rubric): "Should we rebuild billing in-house, buy Vendor A, and
    // stay put?" names three alternatives and scored options-MISSING, so the
    // intake asked "What alternatives are you weighing this against?" — while
    // the same sentence with `and` → `or` scored SATISFIED. A one-word flip.
    //
    // THREE anchors keep this precise, and each one is load-bearing:
    //   1. CHOICE_LEAD — a DELIBERATIVE frame ("should we", "we could"). An
    //      assertive one is a plan, not a choice: "We WILL launch in Q1, hire
    //      in Q2, and expand in Q3" is three steps, not three alternatives,
    //      and the first cut credited it.
    //   2. ≥3 items — at least two comma-separated items before the one the
    //      `and`/`or` terminates. "A, and B" is not a serial list.
    //   3. CHOICE_ACTION_VERBS at the head of EVERY item, with no comma
    //      allowed inside an item ([^,.!?;]). This is the amendment that
    //      matters. Checking only the first and last item leaves an unchecked
    //      span in the middle, and review broke that in one word: "Should we
    //      launch in France, Spain, Italy, and hire locally this year?" has an
    //      action verb at each END, junk between, and scored COMPLETE. Now
    //      every item must be an action, so `Spain` fails at item 2 and the
    //      whole arm declines — as it does for a geography list, a shopping
    //      list, and a list of facts.
    //
    // The Oxford comma before the terminator is OPTIONAL: "…, buy Vendor A and
    // stay put" is the same sentence with one fewer comma and must not turn on
    // punctuation style. It is safe to relax precisely BECAUSE every item is
    // verb-anchored — the comma was never what made this arm precise, and the
    // measured negatives hold identically with and without it.
    //
    // Spans cannot cross a sentence boundary ([^,.!?;]), so an unrelated later
    // clause can supply neither an item nor the terminator.
    new RegExp(
      `\\b${CHOICE_LEAD}\\s+(?:${CHOICE_ACTION_VERBS})\\b[^,.!?;]{0,80}` +
        `(?:,\\s*(?:${CHOICE_ACTION_VERBS})\\b[^,.!?;]{0,80})+` +
        `,?\\s*(?:and|or)\\s+(?:${CHOICE_ACTION_VERBS})\\b`,
      'i',
    ),
    // TRACK-1 INTAKE FIX (2026-08-13) — the FROM-X-TO-Y change construction
    // under a deliberative lead, MEASURED as a detection miss on a real wire
    // brief (INTAKE-FUNNEL §2.1, brief M4: "switch our 40-person engineering
    // team from quarterly releases to continuous deployment" names both
    // alternatives — status quo X and proposed Y — with no `or` anywhere).
    //
    // THREE anchors, same discipline as the serial-list arm above:
    //   1. CHOICE_LEAD — deliberative only. "We WILL migrate from AWS to
    //      GCP" is an announcement, not a choice (twin pinned).
    //   2. a CHANGE VERB head — a closed list of state-transition verbs, so
    //      "revenue grew from £2m to £4m" (a numeric range) and "went from
    //      strength to strength" (an idiom) cannot fire. Closed and failing
    //      SAFE: an unlisted verb scores options-MISSING, one tap-able
    //      question — never a silent false "satisfied".
    //   3. bounded same-sentence spans between verb → `from` → `to`, so an
    //      unrelated later clause can supply neither preposition.
    new RegExp(
      `\\b${CHOICE_LEAD}\\s+(?:${FROM_TO_CHANGE_VERBS})\\b[^.!?;]{0,60}?\\bfrom\\b[^.!?;]{1,80}?\\bto\\b\\s+\\S`,
      'i',
    ),
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
    // TRACK-1 INTAKE FIX (2026-08-13) — bare `for + word-form duration`,
    // MEASURED as a detection miss on a real wire brief (INTAKE-FUNNEL §2.1,
    // brief S4: "renew our office lease for two years" — the lease term IS
    // the horizon, and `for` was only accepted with `the next/coming`). The
    // digit form ("for 2 years") already fires via the digit-duration arm
    // above; this admits the word form.
    //
    // Two guards keep the backward-looking uses out, and BOTH are bounded
    // precision devices, not complete grammars (trap 22f — no punctuation
    // rule settles tense; the residual false-satisfied class is an unlisted
    // past verb, which costs one silently-skipped question on a brief that
    // does state a duration):
    //   - a same-sentence perfective/past lookbehind blocks "we have been in
    //     this office for two years" / "we ran the pilot for six months";
    //   - a trailing `now|already` lookahead blocks elapsed-time "for two
    //     years now". The known-blocked set is pinned as opposite-direction
    //     twins in clarify-v2.rubric-widening.test.ts.
    /(?<!\b(?:been|has|have|had|was|were|ran|spent|lasted|took|used|tried)\b[^.!?;]{0,50})\bfor\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen)[\s-](?:week|month|quarter|year)s?\b(?!\s+(?:now|already)\b)/i,
    // TRACK-1 INTAKE FIX (2026-08-13) — a bare calendar month behind
    // in/until/before/during, MEASURED as a detection miss on a real wire
    // brief (INTAKE-FUNNEL §2.1, brief M5: "launch … in September … or wait
    // for … December" — the timing IS the decision, and months matched only
    // behind `by`). Same bounded past-context guard as the arm above
    // (blocks "we tried this in March", "the pilot we launched in
    // September") plus a `last(-year)` lookahead (blocks "in May last
    // year"). Twins pinned in clarify-v2.rubric-widening.test.ts.
    /(?<!\b(?:was|were|did|had|launched|ran|tried|started|began|happened|failed|joined|opened)\b[^.!?;]{0,50})\b(?:in|until|before|during)\s+(?:early\s+|mid[- ]|late\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)\b(?!\s+(?:last|of\s+last)\b)/i,
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
