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
 * an interrogative (`why` / `what is stopping`) AND a NEGATION that reaches the
 * outcome — either on the noun phrase ("no option", "not a recommendation") or
 * on a verb whose subject is THE PRODUCT ("why can't YOU recommend one"). A
 * recogniser keyed on the noun alone would swallow "which option should I
 * pick?"; one keyed on `why` alone would swallow every `what_drove` phrasing
 * the advice gate already owns.
 *
 * ⚠ THAT SENTENCE WAS ONCE A CLAIM THE REGEXES DID NOT IMPLEMENT, AND AN
 * ADVERSARIAL REVIEW PROVED IT EXECUTABLY. The first revision said every pattern
 * required "an interrogative AND a NEGATED outcome noun" while pattern 1 allowed
 * a non-negated verb beside an `a`/`an` article (a free cross-product), and the
 * negated-ability pattern allowed a BARE negation with any subject. Eight
 * phrasings matched that are not this question at all — "Why is there a clear
 * winner?", "Why can't I pick more than one option?", "Why do people not choose
 * subscriptions?" among them — and each would have received the canned withheld
 * answer as a non-sequitur. None of them was in the negative set, so nothing was
 * red.
 *
 * TWO DURABLE LESSONS, recorded because both are cheap to repeat:
 *   - A PROSE CLAIM ABOUT A REGEX IS NOT A CONSTRAINT ON IT. Where a pattern
 *     must require two things at once, write two patterns — each internally
 *     consistent — rather than one pattern and a comment asserting the coupling.
 *   - A NEGATIVE SET BUILT BY ITS OWN AUTHOR TESTS THE SHAPES THE AUTHOR WAS
 *     ALREADY THINKING ABOUT. Every attack phrasing above is now in it, and the
 *     boundary is a test rather than a paragraph.
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
 * Contracted negations, written out rather than assembled from a verb list:
 * "can't"/"won't"/"cannot" do not decompose the same way — a `verb + n't`
 * assembly silently misses "won't" (the verb is "wo") and "cannot" (no
 * apostrophe), and a recogniser that misses the contraction misses the way
 * people actually type.
 *
 * ⚠ BARE `not` / `never` / `no` ARE NOT IN THIS SET, and their absence is the
 * F1 fix. See {@link SYSTEM_SUBJECT}.
 */
const CONTRACTED_NEGATION =
  "(?:can['’]?t|cannot|won['’]?t|couldn['’]?t|wouldn['’]?t|shouldn['’]?t|didn['’]?t|doesn['’]?t|don['’]?t|haven['’]?t|hasn['’]?t|isn['’]?t|aren['’]?t|wasn['’]?t|weren['’]?t)";

/**
 * WHO is being said not to put an option forward. THE PRODUCT — never the user,
 * never a third party, never the world.
 *
 * ⚠ ADDED BY ADVERSARIAL REVIEW (F1), AND THE SUBJECT IS THE WHOLE DEFENCE.
 * The negated-ability pattern used to allow any 30 characters between "why" and
 * a bare negation, which made these three domain / capability / advice
 * questions match — each then received the canned withheld answer as a
 * non-sequitur:
 *
 *   "Why do people not choose subscriptions?"   a question about the WORLD
 *   "Why can't I pick more than one option?"    a question about the UI
 *   "Why shouldn't I pick option A?"            a request for ADVICE
 *
 * "why can't YOU recommend one" and "why can't I pick one" are different
 * questions with different answers, and only the first is about a withholding.
 * The subject is what tells them apart, so it is required rather than skipped
 * over.
 */
const SYSTEM_SUBJECT =
  '(?:you|it|this|the\\s+(?:analysis|model|system|tool|engine|result|app)|olumi)';

/** Auxiliaries that can carry an uncontracted "not" after the subject. */
const AUXILIARY = '(?:can|could|will|would|do|does|did|have|has|had|is|are|was|were)';

/** Verbs for the act of putting an option forward. */
const PUT_FORWARD_VERB =
  '(?:recommend\\w*|suggest\\w*|pick\\w*|choose|chosen|decide\\w*|put\\s+[^.?!\\n]{0,25}forward|name\\s+(?:an?|one|a\\s+single)|tell\\s+me\\s+which|say\\s+which|give\\s+me\\s+(?:an?|one))';

const WITHHELD_WHY_PATTERNS: readonly RegExp[] = [
  // "Why is there no option?" — the ROADMAP row's own phrasing, and the shape
  // the live journey used. Also "Why are there no recommendations?" and
  // "Why was there no winner?".
  //
  // ⚠ SPLIT FROM ITS SIBLING BELOW BY ADVERSARIAL REVIEW (F1), AND THE SPLIT IS
  // THE FIX. One pattern used to carry both a NEGATION-OPTIONAL verb and an
  // `a`/`an` article branch, under a comment claiming the trailing group
  // "demands no/any when the verb was not negated". It demanded nothing of the
  // sort: the two were a free cross-product, so a NON-negated verb plus an
  // article matched — and these all received the canned withheld answer:
  //
  //   "Why is there an option to do nothing?"        a question about a NODE
  //   "Why is there an option called Hold?"          a question about a NODE
  //   "Why is there a clear winner?"                 the OPPOSITE question
  //   "Why is there a choice between these two?"     a framing question
  //   "Why is there a preference for hiring?"        a question about WEIGHTS
  //
  // Two patterns, each internally consistent, is the only way to state the
  // requirement the docstring makes. A prose claim about a regex is not a
  // constraint on it — the reviewer's probe proved that executably, and the
  // negative set now carries every one of those phrasings.
  //
  // 1a — NEGATED VERB. The article is then free, because the negation is
  // already carried: "Why isn't there a leading option?", "Why wasn't there an
  // option?", "Why isn't there any recommendation?".
  new RegExp(
    `\\bwhy\\s+(?:is|are|was|were)(?:\\s*n['’]?t|\\s+not)\\s+there\\s+` +
      `(?:(?:a|an|any)\\s+)?${OUTCOME_QUALIFIER}${OUTCOME_NOUN}\\b`,
    'i',
  ),

  // 1b — NON-NEGATED VERB, so the NEGATION MUST RIDE THE NOUN PHRASE.
  // "Why is there no option?", "Why are there no recommendations?",
  // "Why was there not a recommendation?".
  //
  // Bare `any` is deliberately NOT an alternative here: "why is there any
  // option..." is a question about why an option EXISTS, which is the inverse
  // of this one. It survives only on the negated branch above, where the
  // negation makes the reading unambiguous.
  new RegExp(
    `\\bwhy\\s+(?:is|are|was|were)\\s+there\\s+(?:no|not\\s+a|not\\s+an|not\\s+any)\\s+` +
      `${OUTCOME_QUALIFIER}${OUTCOME_NOUN}\\b`,
    'i',
  ),

  // "Why is no option put forward?" · "Why is nothing recommended?"
  // "Why was no option shown?" · "Why is none of them recommended?"
  /\bwhy\s+(?:is|are|was|were)\s+(?:no|none|nothing|not\s+one)\b[^.?!\n]{0,50}\b(?:put\s+forward|recommended|shown|suggested|chosen|picked|named|given|offered)\b/i,

  // "Why no option?" · "Why no recommendation?" · "Why not a winner?"
  //
  // ⚠ STATED BOUNDARY (adversarial review, minor note). "why no clear winner
  // LAST TIME?" matches here, and the answer is composed from the LATEST run's
  // verdict — so a question about an earlier run is answered about the current
  // one. Accepted rather than fixed: this recogniser has no run-selection
  // vocabulary and neither does the composer, the persisted verdict is
  // per-fact with only the latest selected, and a half-built temporal read
  // would be worse than a stated boundary. Recorded so the next reader does
  // not mistake it for an oversight.
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

  // The NEGATED-ABILITY family — THE PRODUCT is what cannot put one forward.
  //
  // Two orders, because English puts the subject on either side of the
  // negation, and both are the same question:
  //   contracted:   "Why can't YOU recommend one?"  "Why won't IT pick one?"
  //                 "Why haven't YOU recommended anything?"
  //                 "Why can't THE ANALYSIS put an option forward?"
  //   uncontracted: "Why can YOU not suggest one?"  "Why did YOU not pick one?"
  //
  // ⚠ THE SUBJECT IS REQUIRED (F1). This entry used to allow any 30 characters
  // between "why" and a BARE negation, so "why do PEOPLE not choose…",
  // "why can't I pick…" and "why shouldn't I pick…" all matched — three
  // questions that are not about a withholding at all. Requiring
  // `SYSTEM_SUBJECT` adjacent to the negation is what separates "why can't YOU
  // recommend one" from "why can't I pick one"; the verb alone never could.
  new RegExp(
    `\\bwhy\\s+${CONTRACTED_NEGATION}\\s+${SYSTEM_SUBJECT}\\b[^.?!\\n]{0,30}\\b${PUT_FORWARD_VERB}`,
    'i',
  ),
  new RegExp(
    `\\bwhy\\s+${AUXILIARY}\\s+${SYSTEM_SUBJECT}\\s+(?:not|never)\\b[^.?!\\n]{0,30}\\b${PUT_FORWARD_VERB}`,
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
