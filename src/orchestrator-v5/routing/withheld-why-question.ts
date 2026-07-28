/**
 * ROADMAP 2.104 — the QUESTION half: "why is there no option?"
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A NEW RECOGNISER RATHER THAN A CLASS ON `classifyAnalyticalIntent`.
 *
 * Measured at the base tip (`2ae51f85`), against the ROADMAP's own phrasing and
 * five siblings, before a line of copy was written:
 *
 *   "Why is there no option?"            classifyAnalyticalIntent -> null
 *   "Why is there no recommendation?"    -> null
 *   "Why was no option put forward?"     -> null
 *   "Why isn't there a leading option?"  -> null
 *   "Why can't you recommend one?"       -> null
 *   "Why is nothing recommended?"        -> null
 *
 * 6/6 unclassified. The withheld-why question shape has NO intent class in this
 * estate — it matches no `INTENT_PATTERNS` entry, no `CLASS_PATTERNS` entry, and
 * therefore reaches neither the post-analysis advice gate nor the fresh-analysis
 * follow-up catch-net. It falls past every deterministic guard to the LLM router.
 *
 * ⚠ THE DEFLECTION IS REAL, AND IT IS A DIFFERENT DOOR. `RECAP_TEXT`
 * ("Here's the latest analysis recap. Open the analysis view …",
 * `fresh-analysis-followup-guard.ts`) is the only "recap" copy in `src/`, and a
 * withheld run reaches it on EVERY leader-needing phrasing — measured: "What
 * does this mean?" and "Explain the results" both produce it. The mechanism is
 * structural: `turn-executor.ts` hands the advice gate
 * `projectContextPackAnalysisForWithheldClaim(...)`, whose nulled
 * `leading_option` makes all seven `needs_leading_option` classes decline with
 * `data_unavailable_for_class`, and the class-blind catch-net answers instead.
 *
 * So there are TWO holes, not one, and this module closes the first: the
 * question shape must be RECOGNISED before any composer can answer it. Adding a
 * class to `classifyAnalyticalIntent` would have closed neither — it would have
 * routed the question INTO the deflection.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * DELIBERATELY NARROW. Every pattern is anchored on BOTH halves of the question:
 * an interrogative (`why` / `what is stopping`) AND a NEGATED outcome noun (no
 * option, no recommendation, nothing put forward). A recogniser keyed on the
 * noun alone would swallow "which option should I pick?"; one keyed on `why`
 * alone would swallow every `what_drove` phrasing the advice gate already owns.
 *
 * The cost of narrowness is stated rather than hidden: a phrasing outside this
 * set still reaches the pre-existing routing, which is exactly where it goes
 * today. Narrow-and-honest degrades to the status quo; wide-and-wrong steals
 * turns from gates that answer them better.
 *
 * ⚠ THE USER'S VOCABULARY IS NOT OURS. These patterns match `recommend`,
 * `winner` and `leading option` because that is what a user types. The ANSWER
 * may use none of them — `LEADER_CLAIM_PATTERNS` bans the whole family — and
 * `compose/withheld-why-answer.ts` carries a module-load probe that fails the
 * process if a copy edit ever reaches for one. Reading a word and writing it are
 * different permissions.
 *
 * PURE pattern matching. No copy, no telemetry, no graph or analysis content.
 */

/**
 * The withheld-why question shapes. Ordered only for readability — the
 * predicate is a disjunction, so order carries no meaning.
 *
 * Each entry carries the shape it exists for, because a bare regex list is the
 * hand-maintained mirror CLAUDE.md trap #12 warns about: a future reader who
 * cannot tell which phrasings are covered will either duplicate an entry or
 * delete a load-bearing one.
 */
/**
 * The outcome the user is asking about the ABSENCE of. Shared by the noun-shaped
 * patterns so they cannot drift apart on which nouns count.
 */
const OUTCOME_NOUN =
  '(?:option|options|recommendation|recommendations|winner|answer|choice|pick|suggestion|preference)';

/** Optional qualifiers a user puts in front of the outcome noun. */
const OUTCOME_QUALIFIER = '(?:single\\s+|clear\\s+|leading\\s+|preferred\\s+|recommended\\s+|best\\s+|obvious\\s+)?';

/**
 * Contracted and uncontracted negations, in one place. Written out rather than
 * assembled from a verb list because "can't"/"won't"/"cannot" do not decompose
 * the same way — a `verb + n't` assembly silently misses "won't" (the verb is
 * "wo") and "cannot" (no apostrophe), and a recogniser that misses the
 * contraction misses the way people actually type.
 */
const NEGATION =
  "(?:can['’]?t|cannot|won['’]?t|couldn['’]?t|wouldn['’]?t|shouldn['’]?t|didn['’]?t|doesn['’]?t|don['’]?t|haven['’]?t|hasn['’]?t|isn['’]?t|aren['’]?t|wasn['’]?t|weren['’]?t|not|never|no)";

/** Verbs for the act of putting an option forward. */
const PUT_FORWARD_VERB =
  '(?:recommend\\w*|suggest\\w*|pick\\w*|choose|chosen|decide\\w*|put\\s+[^.?!\\n]{0,25}forward|name\\s+(?:an?|one|a\\s+single)|tell\\s+me\\s+which|say\\s+which|give\\s+me\\s+(?:an?|one))';

const WITHHELD_WHY_PATTERNS: readonly RegExp[] = [
  // "Why is there no option?" — the ROADMAP row's own phrasing, and the shape
  // the live journey used. Also: "Why are there no recommendations?",
  // "Why isn't there a leading option?", "Why was there no winner?".
  //
  // The negation is optional on the verb because it can live on EITHER side:
  // "why IS there NO option" and "why ISN'T there AN option" are the same
  // question, and requiring it in one place misses half of them. At least one
  // of the two positions must carry it — enforced by the trailing group, which
  // demands `no`/`any` when the verb was not negated.
  new RegExp(
    `\\bwhy\\s+(?:is|are|was|were)(?:\\s*n['’]?t|\\s+not)?\\s+there\\s+` +
      `(?:(?:no|not\\s+a|not\\s+any|any)\\s+|(?:a|an)\\s+(?=${OUTCOME_QUALIFIER}${OUTCOME_NOUN}))` +
      `${OUTCOME_QUALIFIER}${OUTCOME_NOUN}\\b`,
    'i',
  ),

  // "Why is no option put forward?" · "Why is nothing recommended?"
  // "Why was no option shown?" · "Why is none of them recommended?"
  /\bwhy\s+(?:is|are|was|were)\s+(?:no|none|nothing|not\s+one)\b[^.?!\n]{0,50}\b(?:put\s+forward|recommended|shown|suggested|chosen|picked|named|given|offered)\b/i,

  // "Why no option?" · "Why no recommendation?" · "Why not a winner?"
  new RegExp(
    `\\bwhy\\s+(?:no|not)\\s+(?:a\\s+|an\\s+|any\\s+)?${OUTCOME_QUALIFIER}${OUTCOME_NOUN}\\b`,
    'i',
  ),

  // "Why was no option put forward?" — the verb-first passive, where the
  // outcome noun is the subject and no trailing participle follows.
  new RegExp(
    `\\bwhy\\s+(?:was|were|is|are)\\s+(?:no|none|nothing)\\s+${OUTCOME_QUALIFIER}${OUTCOME_NOUN}\\b`,
    'i',
  ),

  // The NEGATED-ABILITY family, in one entry rather than one per auxiliary:
  //   "Why can't you recommend one?"      "Why won't it pick an option?"
  //   "Why did you not pick an option?"   "Why haven't you recommended anything?"
  //   "Why can't the analysis put an option forward?"
  //
  // Requires BOTH a negation and a put-an-option-forward verb, which is what
  // keeps it off "Why didn't the result change?" and every `what_drove`
  // phrasing the advice gate already owns.
  new RegExp(
    `\\bwhy\\s+[^.?!\\n]{0,30}\\b${NEGATION}\\b[^.?!\\n]{0,40}\\b${PUT_FORWARD_VERB}`,
    'i',
  ),

  // "What is stopping a recommendation?" · "What's preventing an option being
  // put forward?" — the same question in a non-`why` frame.
  //
  // Deliberately requires the outcome noun or verb, so it does NOT swallow the
  // advice gate's `readiness` pattern `\bwhat's (blocking|stopping|preventing)`,
  // which is about the GRAPH being ready to RUN rather than about a result that
  // ran and withheld.
  /\bwhat(?:['’]s|\s+is)\s+(?:stopping|preventing|blocking)\b[^.?!\n]{0,40}\b(?:recommendation|an?\s+option|the\s+option|recommending|choosing|picking|deciding)\b/i,
];

/**
 * Is the user asking WHY no option is being put forward?
 *
 * Answers only the question shape. It says nothing about whether the turn's
 * verdict actually withholds — that is the CALLER's permission to establish,
 * from the persisted verdict, and it must never be inferred from the words the
 * user chose. A user may ask this on a permitting run (because they missed the
 * answer, or the UI did not show it), and answering "here is why we withheld"
 * on a run that withheld nothing would be a fabricated cause of exactly the
 * class `withheldLeaderInputNoteForState` was corrected for.
 */
export function isWithheldWhyQuestion(message: string): boolean {
  if (typeof message !== 'string') return false;
  const trimmed = message.trim();
  if (trimmed.length === 0) return false;
  for (const re of WITHHELD_WHY_PATTERNS) {
    if (re.test(trimmed)) return true;
  }
  return false;
}
