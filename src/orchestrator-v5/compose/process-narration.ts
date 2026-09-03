/**
 * ⭐⭐⭐ THE PRODUCT PRINTED ITS OWN CHAIN OF THOUGHT TO THE USER AS THE ANSWER.
 *
 * ── WITNESSED, VERBATIM, ON A REAL USER SESSION (3 Sep 2026) ───────────────
 * Debug bundle `olumi-debug-f2e2df1b-20260903.json`, UI build `86786efb`,
 * scenario `7826c742-2939-4584-917c-f1286a663ae4`. Two turns, both
 * `status: 200`, both `completed: true`, both LLM-authored, both shipped
 * verbatim into `assistant_text`:
 *
 *   turn 18 (routing prompt v121, hash bec840a648800928)
 *     "The user's asking about specific structural values ("50%" strengths on
 *      outcomes and risks). Let me check what's actually in the model. There's
 *      no field carrying edge strengths or coefficient magnitudes as raw
 *      percentages visible in graph.edges , those show qualitative
 *      relationship phrases (moderate positive link, etc.), not "50%". This
 *      looks like they may be looking at something in the UI (like a display
 *      default) that isn't reflected in the ContextPack's relationship
 *      labels. I shouldn't invent an explanation for a number I can't ground."
 *
 *   turn 15 (edit_graph_default@v11)
 *     "This is a question about existing analysis results, not a model edit
 *      request. Per the conversation, updating Sales Headcount Investment
 *      from £80 to £100,000 widened … No model changes are needed to answer
 *      this."
 *
 * Both describe the SYSTEM'S OWN PROCESS rather than the user's problem: one
 * is deliberation, one is a routing verdict read out loud.
 *
 * ── WHY THE EXISTING GUARDS DID NOT SEE THEM (measured, not assumed) ───────
 * Probed at `f4c8f501` against the two verbatim strings, with two contrast
 * controls in the SAME run so a blind instrument could not fake the result:
 *
 *   LEAK (turn 18)     isPlanningText=false  findForbiddenPhraseHit=null
 *   LEAK (turn 15)     isPlanningText=false  findForbiddenPhraseHit=null
 *   CONTROL planning   isPlanningText=TRUE   (the 29 Aug witnessed monologue)
 *   CONTROL forbidden  findForbiddenPhraseHit="context pack"
 *   CONTROL clean      both false            (a real answer from the capture)
 *
 * Targets zero, both contrasts non-zero: the absence is real, not instrument
 * blindness. Three separate misses, each one character wide:
 *
 *   1. `strip-planning-preamble`'s third-person pattern carries `is\s+asking`
 *      but not the CONTRACTION `the user's asking`.
 *   2. `FORBIDDEN_USER_FACING_PHRASES` carries `context[\s_]packs?` — a
 *      SEPARATOR is mandatory, so the CamelCase `ContextPack` walks through.
 *      (Widened to `[\s_]?` in that module by this change; the sweep for it
 *      is in this header's false-positive section.)
 *   3. Nothing anywhere matched the routing verdict "not a model edit
 *      request" / "No model changes are needed to answer this".
 *
 * And a fourth, structural: `stripPlanningPreamble` is wired ONLY to the
 * execute and clarify compose branches. Its own header says so, and says why —
 * on coach / converse / text_only "the orientation IS the whole answer and
 * emptying it would ship a blank reply". Both witnessed leaks are on exactly
 * those branches. The stripper was pointed away from where the leak lands.
 *
 * ── THE QUESTION THIS MODULE ANSWERS, AND THE ONE IT DOES NOT ─────────────
 * This estate's signature defect is two authorities under similar names
 * answering different questions (CLAUDE.md trap 21). So, plainly:
 *
 *   `stripPlanningPreamble` asks — "is this PRE-TOOL-CALL ORIENTATION BLOCK
 *     deliberation rather than orientation?" Remedy: drop the whole block,
 *     because a receipt or a deterministic question follows it.
 *
 *   `applyProcessNarrationGuard` (here) asks — "does the text ABOUT TO SHIP
 *     TO THE USER narrate the system's own process instead of answering?"
 *     Remedy: it must NOT be able to return nothing, because on these
 *     branches there is nothing behind it.
 *
 * They are not aligned defaults of one rule; they are two questions. What they
 * DO share is the marker vocabulary, and that is deliberately ONE definition
 * exported from here — `strip-planning-preamble.ts` imports
 * {@link PROCESS_NARRATION_PATTERNS} and {@link SENTENCE_SPLIT} rather than
 * keeping a second copy, so a marker added here cannot cover one path and
 * silently miss the other (CLAUDE.md trap 12).
 *
 * ── WHY PER-SENTENCE HERE WHEN WHOLE-BLOCK WAS RIGHT THERE ────────────────
 * `strip-planning-preamble` records that a per-sentence first draft was WORSE
 * for its case: filtering sentences left "the unmarked residue of the same
 * monologue". That finding is correct and is not being reversed — it is about
 * a block that is monologue END TO END, sitting in front of a receipt.
 *
 * The 3 Sep capture contains the case that finding could not see. Turn 15 is
 * narration AND a real answer in ONE block: sentences 1 and 4 are the routing
 * verdict, sentences 2 and 3 are the answer the user asked for. A whole-block
 * drop there destroys a genuine answer. So the rule is per-sentence, PLUS a
 * structural condemnation rule for the monologue case:
 *
 *   ⭐ A BLOCK WHOSE NARRATION SENTENCES ARE A STRICT MAJORITY IS A MONOLOGUE,
 *   and the unmarked minority is its residue, not an answer.
 *
 * Measured on the capture, which is why the rule is `> half` and not `>= half`:
 *   turn 18 — 4 narration of 5 ⇒ 8 > 5 ⇒ condemned (correct: no answer in it)
 *   turn 15 — 2 narration of 4 ⇒ 4 > 4 is false ⇒ excised (correct: answer kept)
 * A hand-picked threshold would have separated them either way; this one is
 * pinned by the two real blocks and by a control at each side of the boundary.
 *
 * ── FAILURE DIRECTION ─────────────────────────────────────────────────────
 * A FALSE POSITIVE on one sentence costs that sentence. A false positive on a
 * whole block costs the model's prose and substitutes
 * {@link PROCESS_NARRATION_FALLBACK_TEXT} — honest, and it asks the user for
 * the one thing that would unblock the turn. A FALSE NEGATIVE ships the
 * monologue, which is today's behaviour. Nothing here can mutate a model, lose
 * an edit, or empty a response: the guard never returns blank.
 *
 * The excised narration is NOT destroyed — it is handed to the caller in
 * `narration` for the `_reasoning` disclosure channel (ROADMAP 1.42), which is
 * where verbatim deliberation already belongs. Paul's standard: reasoning must
 * remain AVAILABLE; it must not be the first thing the user reads.
 *
 * ── MARKER SET: INTERNAL BY CONSTRUCTION ONLY ─────────────────────────────
 * Every pattern below names something a user cannot see: the numbered rules of
 * a system prompt, the router's own action taxonomy, an internal type name, or
 * the product referring to its reader in the third person. Ordinary English
 * that merely resembles thinking aloud is deliberately left alone — four
 * consecutive rounds were burned on one natural-language predicate in this
 * estate (CLAUDE.md trap 22f) and a stripper is not the place to relearn it.
 *
 * FALSE-POSITIVE SWEEP (at `f4c8f501`): every STRING LITERAL in the 930
 * production source files under `src/` excluding tests and prompts — 56,009
 * literals — plus a contrast control (`context[\s_]packs?`, expected present)
 * which returned 5 hits, so the sweep was not blind. Results:
 *
 *   third-person reader          24 hits — ALL model-facing prompt text
 *                                (tool-schema tool descriptions, the routing
 *                                system prompt, coaching directives, the
 *                                rolling summariser's system prompt). None can
 *                                ever be `assistant_text`.
 *   self-honesty policy           0 hits
 *   internal CamelCase name       7 hits — log messages, prompt headings and
 *                                observability labels. None user-facing.
 *   internal dotted path         29 hits — JSON-pointer path CONSTANTS
 *                                ('graph.nodes'), validator error strings, and
 *                                template-literal SOURCE (`${g.nodes.length}`)
 *                                that renders without the dotted token at all.
 *                                None user-facing.
 *   routing taxonomy (2 pats)     0 hits
 *
 * ⛔ KNOWN NOT COVERED, and deliberately: *"Let me check what's actually in
 * the model."* — self-addressed inspection with no internal marker in it. In
 * the witnessed block the MAJORITY rule condemns it along with the rest, which
 * is the right outcome; a bare `let me check` pattern is ordinary English an
 * assistant may legitimately say and is not being guessed at here. Reported
 * rather than invented.
 *
 * British English.
 */

/**
 * Sentence boundary that does NOT cut at a decimal point.
 *
 * ⚠ `£1.5 million` split on a bare `[.!?]` is how a magnitude guard was fed
 * the string `1` and could not fire (CLAUDE.md trap 22). The delimiter must be
 * followed by whitespace AND an opening character, which a decimal never is.
 *
 * Moved here from `strip-planning-preamble.ts` (byte-identical source) so the
 * two narration modules split sentences the same way by construction. That
 * module now imports it.
 */
export const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=["'([]?[A-Z])/;

/**
 * An internal system-prompt rule, cited by number. The user cannot see the
 * numbered rules, so any reference to one is deliberation that escaped.
 *
 * Both witnessed forms are covered: *"Per rule 9 (one action per turn), …"*
 * and *"rule 9 says one action per turn"*. Bare `rule 9` is NOT matched on its
 * own — a user's model may legitimately discuss a numbered rule of a real
 * regulation.
 */
export const RULE_CITATION_PATTERNS: readonly RegExp[] = [
  /\b(?:as\s+)?per\s+rules?\s+\d+\b/i,
  /\brules?\s+\d+\s+(?:says?|states?|requires?|means?|is\b|applies\b)/i,
  /\brules?\s+\d+\s*\(/i,
];

/**
 * The product speaking ABOUT its reader rather than TO them.
 *
 * Bound to a mental or communicative verb so a model legitimately containing
 * "the user" — a user-journey factor, a user-base estimate — is untouched.
 *
 * ⭐ THE SECOND PATTERN IS THE 3 SEP MISS, AND IT IS ITS OWN PATTERN ON
 * PURPOSE. The witnessed leak opens *"The user's asking…"*. Folding the
 * contraction into the first pattern as an optional `(?:['’]s)?` would ALSO
 * admit the bare gerund *"the user asking"*, which is a shape an ordinary
 * factor label could take. Requiring the possessive for the gerund forms keeps
 * the widening to exactly the class that was measured leaking.
 */
export const THIRD_PERSON_READER_PATTERNS: readonly RegExp[] = [
  /\bthe\s+user\s+(?:wants?|is\s+asking|asked|asks|has\s+asked|needs?|would\s+like|is\s+trying|said|means|meant|expects?)\b/i,
  /\bthe\s+user['’]s\s+(?:asking|wanting|trying|saying|looking|after)\b/i,
];

/**
 * Routing vocabulary that only exists inside the orchestrator's own frame.
 */
export const ROUTING_SELF_TALK_PATTERNS: readonly RegExp[] = [
  /\bone\s+action\s+per\s+turn\b/i,
  /\bi\s+can\s+only\s+(?:route|dispatch|handle)\s+one\b/i,
];

/**
 * The model narrating its own honesty POLICY rather than applying it.
 *
 * From the capture: *"I shouldn't invent an explanation for a number I can't
 * ground."* The product never tells a user what it is not allowed to do; it
 * simply does not do it, and says what it does not know. Zero hits across
 * 56,009 production string literals, so this cannot displace shipped copy.
 */
export const SELF_HONESTY_POLICY_PATTERNS: readonly RegExp[] = [
  /\bI\s+(?:should|shouldn['’]t|should\s+not|must|mustn['’]t|must\s+not|need\s+to|can['’]t|cannot)\s+(?:not\s+)?(?:invent|fabricate|make\s+up|speculate|guess\s+at)\b/i,
];

/**
 * Internal type and field names in prose, in the two shapes the shipped
 * lexicon cannot see.
 *
 * ⚠ SCOPE, STATED RATHER THAN IMPLIED. This is NOT a second copy of the
 * internal-jargon entries in `FORBIDDEN_USER_FACING_PHRASES` — those stay
 * there and keep their own (fatal, whole-response) remedy, which is a
 * different question from this module's. These two patterns cover the forms
 * that lexicon MISSES by construction:
 *
 *   · CamelCase with no separator — `ContextPack`, which walked through
 *     `context[\s_]packs?` because that pattern requires a separator. (That
 *     entry is widened to `[\s_]?` by this change as defence in depth; this
 *     pattern is what gives the offending SENTENCE a proportionate remedy
 *     instead of erasing the whole reply.)
 *   · A dotted field path — `graph.edges`, from the capture. The lexicon
 *     carries `graph[\s_]hash` and `node[\s_]ids?` but no dotted form.
 *
 * The dotted alternation is closed, not open (`edges|nodes|options|factors`):
 * every member is a real GraphV3 collection, and a wildcard after `graph.`
 * would match ordinary prose the moment a sentence ended on the word "graph".
 * It cannot false-positive across a sentence boundary either — "…across the
 * graph. Nodes with…" has whitespace after the stop, and this pattern does not.
 */
export const INTERNAL_IDENTIFIER_PATTERNS: readonly RegExp[] = [
  /\bContext\s?Pack\b/,
  /\bgraph\.(?:edges|nodes|options|factors)\b/i,
];

/**
 * The router's own action taxonomy, read out to the user.
 *
 * From the capture: *"This is a question about existing analysis results, not
 * a model edit request. … No model changes are needed to answer this."* The
 * user never asked which lane their sentence was routed down.
 *
 * ⚠ NOT the same thing as an honest mutation denial. *"I have not changed the
 * model"* (also in this capture, and correct) is a statement about WHAT
 * HAPPENED and is governed by `FORBIDDEN_USER_FACING_PHRASES`' denial family.
 * These two patterns are about the ROUTING DECISION, which is a different
 * fact, and they are anchored on the internal nouns ("edit request", "model
 * changes … needed") rather than on the verb, so the denial family is
 * untouched. Zero hits across 56,009 production string literals.
 */
export const ROUTE_TAXONOMY_PATTERNS: readonly RegExp[] = [
  /\bnot\s+an?\s+(?:model\s+|graph\s+)?edit\s+request\b/i,
  /\bno\s+(?:model|graph)\s+changes?\s+(?:are|is|were|was)\s+(?:needed|required)\b/i,
];

/**
 * THE marker set. One definition, two consumers with two different remedies
 * (see this module's header). Exported as named groups above so a spec can
 * iterate a class rather than hand-listing exemplar strings — a hand-listed
 * array in a spec is the mirror that lets a seventh pattern land uncovered.
 */
export const PROCESS_NARRATION_PATTERNS: readonly RegExp[] = [
  ...RULE_CITATION_PATTERNS,
  ...THIRD_PERSON_READER_PATTERNS,
  ...ROUTING_SELF_TALK_PATTERNS,
  ...SELF_HONESTY_POLICY_PATTERNS,
  ...INTERNAL_IDENTIFIER_PATTERNS,
  ...ROUTE_TAXONOMY_PATTERNS,
];

/**
 * The first process-narration marker that hits in `text`, verbatim (not the
 * regex source), so telemetry groups by the phrase a human can read. Null when
 * clean. Mirrors `findForbiddenPhraseHit`'s shape so both signals read alike.
 */
export function findProcessNarrationHit(text: string): string | null {
  if (!text) return null;
  for (const re of PROCESS_NARRATION_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

/** True when any marker hits. Kept for `strip-planning-preamble`'s whole-block question. */
export function isProcessNarration(text: string): boolean {
  return findProcessNarrationHit(text) !== null;
}

/**
 * ⭐ THE REPLACEMENT ANSWER for a block that was narration end to end.
 *
 * Paul's standard for this exact turn: *"The right behaviour was not silence
 * and not a monologue — the model correctly realised it lacked grounding, and
 * should have said so in one sentence and asked the clarifying question."*
 *
 * So this is one honest sentence about the limit, then one question that moves
 * the turn forward. It is deliberately NOT the generic
 * `EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT` ("Let me know what you'd like me to
 * do next"), which is a shrug and hands the work back without narrowing it.
 *
 * The user's own next turn in the capture proves the shape is the right one:
 * asked again, the model said *"I don't have visibility of any strength
 * percentages… If you tell me which specific relationship shows 50%… I can
 * check whether that connection exists in the saved structure."* That is this
 * copy, one turn late.
 *
 * PROPERTIES, asserted in `__tests__/process-narration.test.ts`: contains no
 * `FORBIDDEN_USER_FACING_PHRASES` match, no process-narration marker (so the
 * guard is idempotent), no first-person mutation-success claim, and no leading
 * option named. It has to survive the three finaliser guards that run after
 * this one, and it does.
 */
export const PROCESS_NARRATION_FALLBACK_TEXT =
  "I can't ground that in what I can see of your model, so I won't guess at it. " +
  'Tell me which factor, option or link you mean and I will check it against the saved structure.';

export type ProcessNarrationRemedy = 'none' | 'sentences_removed' | 'block_replaced';

export interface ProcessNarrationGuardResult {
  /** True when `text` differs from the input. */
  readonly rewritten: boolean;
  /** The text to ship. NEVER empty when the input was non-empty. */
  readonly text: string;
  /**
   * The excised narration, joined, for the `_reasoning` disclosure channel.
   * Empty string when nothing was excised. Never shipped as `assistant_text`.
   */
  readonly narration: string;
  /** The first marker matched, verbatim, for telemetry. Null when clean. */
  readonly hit: string | null;
  readonly remedy: ProcessNarrationRemedy;
  readonly sentencesTotal: number;
  readonly sentencesRemoved: number;
}

const CLEAN = (text: string): ProcessNarrationGuardResult => ({
  rewritten: false,
  text,
  narration: '',
  hit: null,
  remedy: 'none',
  sentencesTotal: 0,
  sentencesRemoved: 0,
});

/**
 * Separate the system's process narration from the user's answer.
 *
 * Pure. Idempotent — a second call on a rewritten result is a no-op, because
 * neither the surviving answer sentences nor
 * {@link PROCESS_NARRATION_FALLBACK_TEXT} carries a marker.
 *
 * ⚠ PARAGRAPHS ARE PRESERVED. Splitting on sentences alone and re-joining with
 * a space would silently reflow a two-paragraph deterministic receipt into one
 * block — a formatting regression on turns this guard should not be touching
 * at all. Each paragraph is filtered independently and the blank-line
 * separators are put back.
 */
export function applyProcessNarrationGuard(text: string): ProcessNarrationGuardResult {
  if (typeof text !== 'string') return CLEAN('');
  const trimmed = text.trim();
  if (trimmed.length === 0) return CLEAN(text);
  const hit = findProcessNarrationHit(trimmed);
  if (hit === null) return CLEAN(text);

  const paragraphs = trimmed.split(/\n{2,}/);
  const keptParagraphs: string[] = [];
  const removed: string[] = [];
  let sentencesTotal = 0;
  let sentencesRemoved = 0;

  for (const paragraph of paragraphs) {
    const sentences = paragraph.split(SENTENCE_SPLIT);
    const kept: string[] = [];
    for (const sentence of sentences) {
      sentencesTotal += 1;
      if (isProcessNarration(sentence)) {
        sentencesRemoved += 1;
        removed.push(sentence.trim());
      } else {
        kept.push(sentence);
      }
    }
    const joined = kept.join(' ').trim();
    if (joined.length > 0) keptParagraphs.push(joined);
  }

  // ⭐ THE MAJORITY RULE — see this module's header for why it is `> half` and
  // for the two real blocks that pin it. A block whose narration sentences are
  // a strict majority IS the monologue; whatever is left is its residue, and
  // shipping half a thought is the defect, not a partial fix for it.
  const isMonologue = sentencesRemoved * 2 > sentencesTotal;
  const answer = keptParagraphs.join('\n\n');

  if (isMonologue || answer.length === 0) {
    return {
      rewritten: true,
      text: PROCESS_NARRATION_FALLBACK_TEXT,
      narration: trimmed,
      hit,
      remedy: 'block_replaced',
      sentencesTotal,
      sentencesRemoved,
    };
  }

  return {
    rewritten: true,
    text: answer,
    narration: removed.join(' '),
    hit,
    remedy: 'sentences_removed',
    sentencesTotal,
    sentencesRemoved,
  };
}
