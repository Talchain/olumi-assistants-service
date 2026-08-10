/**
 * ROADMAP 2.975 — ANSWERING "WHAT DID YOU DO WITH MY BRIEF?"
 *
 * ── THE DEFECT THIS CLOSES ─────────────────────────────────────────────────
 * The 2026-08-08 context-integrity trace asked the deployed product, on three
 * separate briefs, what it had done with the user's input. All three got the
 * same canned line, with ZERO LLM calls:
 *
 *   user  → "…what from my brief did you keep in the model, 2) what did you
 *            add or infer yourself, 3) what did you leave out…"
 *   olumi → "I don't have a record of recent edits in this conversation."
 *
 * The trace's verdict on the four questions PR1 exists to answer was NO /
 * partial-on-the-wire-only / NO / NO. Its note on the cause is the whole story:
 * *"The failure is routing + absence of a diff surface, not absent raw
 * material."*
 *
 * ── WHY IT HAPPENED (CLAUDE.md trap 21) ────────────────────────────────────
 * Two DIFFERENT questions wearing similar words, with only one authority to
 * answer them:
 *
 *   "what did you change?"                → about THIS SESSION'S EDITS
 *   "what did you change from my brief?"  → about THE DRAFT'S FIDELITY
 *
 * `state-query-guard.ts` answers the first, correctly and deterministically.
 * It matched the second on the bare verb `change`, claimed the turn, found no
 * session edits, and deflected. Neither its pattern nor its copy was wrong for
 * the question it was written for. The defect was that NOTHING SEPARATED THE
 * TWO QUESTIONS — so the fix is to name them apart, not to widen either.
 *
 * ── WHY THIS ANSWERS DETERMINISTICALLY RATHER THAN HANDING IT TO THE LLM ───
 * Letting the audit question fall through to the grounded conversational path
 * is a real improvement and is the fall-back here. It is not sufficient as the
 * ANSWER, because the same trace measured loss class 7: explanation layers
 * *"re-read the brief (or nothing) rather than the model, so the product makes
 * confident false statements about its own model's contents"* — a review card
 * asserting "assumes 40% to 60% content reuse" against an encoded U(0.25,0.75),
 * and a draft calling the DENSEST of the three briefs "light on detail".
 *
 * An audit answer produced by re-reading the brief is exactly the failure the
 * audit question exists to detect. So the answer is DERIVED from the same pure
 * function the cold-read seam serves — `deriveNotModelledManifest(brief, graph)`
 * — and this module only ever renders what that derivation already established.
 * It computes no verdict of its own.
 *
 * ── WHAT IT REFUSES TO DO ──────────────────────────────────────────────────
 * When the manifest cannot look (no brief, no graph) this returns `null` and
 * the turn falls through to the LLM. It never emits a zero tally, because on a
 * scenario we know nothing about, "nothing was dropped" is a NEW lie carrying
 * the authority of a measurement. And every answer carries the manifest's
 * `not_tracked` classes, so a finite `absent` list can never read as a complete
 * account of what was lost.
 */

import {
  deriveNotModelledManifest,
  type NotModelledItem,
  type NotModelledManifest,
} from "./not-modelled-manifest.js";

/**
 * How many of the user's own figures to quote back before summarising the
 * remainder.
 *
 * ⚠ SET FROM THE CORPUS, NOT FROM TASTE, AND THE FIRST VALUE WAS WRONG IN A
 * WAY THAT MATTERED. At 12 this list was truncated on all three trace briefs,
 * and because items are ordered by position in the brief, the cut kept whatever
 * the user happened to mention FIRST. On B3 that hid `14 May 2027` — the CEO's
 * hard demo deadline, which the trace graded a SEVERE loss — behind "and 11
 * more", while showing `22%` and `£15`. A cap that silently decides which of
 * the user's losses they get to see is a worse defect than a long sentence:
 * the whole purpose of the answer is that they can check their own figures.
 *
 * 25 covers every absent list the corpus produces (17 / 17 / 23) in full. Above
 * it the overflow is disclosed AND the ordering is named, so a user is never
 * left believing the shown items were selected for importance.
 */
const MAX_QUOTED_LITERALS = 25;

/** Same bound, for the figures we supplied ourselves. */
const MAX_QUOTED_FACTORS = 8;

// ── the discriminator ───────────────────────────────────────────────────────

/**
 * Does this message ask what the system did WITH THE USER'S BRIEF, as opposed
 * to what it changed in this session?
 *
 * ⚠⚠ THE DIRECTION OF FAILURE IS NOT UNIFORM, AND ROUND 1 GOT THIS WRONG.
 * Round 1 reasoned that a narrow predicate "fails toward the GAP". That is true
 * only for utterances `STATE_QUERY_PATTERNS` does NOT match, which fall through
 * to the grounded LLM. For utterances it DOES match, the session-edit arm
 * claims the turn and the canned deflection fires, so narrowness fails toward
 * the LIE. The safe default is a property of the UTTERANCE, not of the
 * predicate — and two of PR1's four questions sit in the second class:
 *
 *   "what did you add or infer yourself?"  matches `what did you add`
 *   "what did you change or reinterpret?"  matches `what did you change`
 *
 * Both shipped the canned deflection at the round-1 head. This is why
 * {@link INFERENCE_VERB_PATTERNS} exists: those two questions are identified by
 * a verb that has no session-edit reading, so they can be claimed without
 * widening anything that a genuine "what did you add?" would satisfy.
 *
 * ⚠ TWO CONJUNCTS, AND THAT IS THE DESIGN (CLAUDE.md trap 22b). This predicate
 * still guards two OPPOSITE harms, which cannot share one window:
 *
 *   - too narrow → deflection (a LIE) for utterances the session-edit arm
 *     claims; a GAP for the rest. See the correction above.
 *   - too wide   → a genuine session-edit question ("what did you just
 *     change?") is answered with a report about the brief. A LIE either way.
 *
 * So both conjuncts must hold:
 *
 *   1. an AUDIT FRAME — the question is about what YOU (the system) did; and
 *   2. a BRIEF REFERENT ("my brief", "what I told you") OR an OMISSION VERB
 *      ("leave out", "omit", "ignore") that has no session-edit reading in this
 *      product, whose edit vocabulary is add / change / update / set.
 *
 * The frame alone is not enough: *"what did you change?"* satisfies it and is
 * the canonical session-edit question. The referent alone is not enough:
 * *"add a factor from my brief"* is an imperative edit. Only together do they
 * identify the question the trace measured being deflected.
 */
export function isBriefAuditQuestion(message: string): boolean {
  if (!AUDIT_FRAME_PATTERNS.some((p) => p.test(message))) return false;
  if (BRIEF_REFERENT_PATTERNS.some((p) => p.test(message))) return true;
  if (OMISSION_VERB_PATTERNS.some((p) => p.test(message))) return true;
  if (INFERENCE_VERB_PATTERNS.some((p) => p.test(message))) return true;
  // ⚠ THE WEAK REFERENT NEEDS A SECOND KEY, AND THIS IS WHERE THE TWO HARMS
  // SEPARATE. "my numbers" does NOT identify the question on its own:
  //
  //   "which of my numbers did you use?"    → fidelity. There is no session-
  //                                            edit reading of "use".
  //   "did you change my numbers?"          → AMBIGUOUS. After a value edit
  //                                            this is a session-edit question,
  //                                            and answering it with a brief
  //                                            report would be the lie.
  //
  // So a weak referent admits the question only alongside a verb that has no
  // session-edit reading. `change` / `update` / `add` are deliberately absent
  // from that verb set, which is exactly what keeps the ambiguous phrasing on
  // the session-edit side (trap 22f: where direction cannot be determined,
  // do not guess — here the safe default is the existing behaviour).
  return (
    WEAK_INPUT_REFERENT_PATTERNS.some((p) => p.test(message)) &&
    RETENTION_VERB_PATTERNS.some((p) => p.test(message))
  );
}

/**
 * Conjunct 1 — the question is about what the SYSTEM did, in the past.
 *
 * ⚠⚠ THIS DOCSTRING WAS RIGHT AND THE PATTERNS DID NOT IMPLEMENT IT, WHICH IS
 * HOW ROUND 2 STOLE HYPOTHETICAL TURNS. It said "deliberately second-person and
 * past-tense", then listed the BARE PRESENT forms `keep` and `use` — and a
 * conditional clause is made of exactly those:
 *
 *   "Assuming you keep the 3-day policy, what happens to attrition?"
 *                 ^^^^^^^^ satisfied the frame from inside the hypothetical
 *
 * That turn has no edit and no ambiguity, and it began receiving a fidelity
 * report with zero LLM calls where it previously reached the LLM: strictly
 * worse than before the row existed.
 *
 * The frame is now genuinely restricted to constructions that report on a
 * COMPLETED action or ASK about one:
 *   · `did you` / `have you`  — interrogative past
 *   · `do you`                — interrogative present. Kept deliberately:
 *     "which of my figures do you use?" is a real audit question, and a
 *     conditional clause never produces "do you". Dropping it lost that
 *     question for no gain, measured.
 *   · `you <PAST-TENSE verb>` — "what you kept", "everything you left out"
 *
 * A bare present-tense verb ("use my brief", "you keep X") is a request or a
 * supposition, never a report. That distinction is the whole conjunct.
 */
const AUDIT_FRAME_PATTERNS: readonly RegExp[] = [
  // "what did you keep", "which parts of my brief did you leave out"
  /\bdid\s+you\b/i,
  // "have you left anything out", "have you used my numbers"
  /\bhave\s+you\b/i,
  // "which of my figures do you use?" — interrogative, not conditional.
  /\bdo\s+you\b/i,
  // "what you kept", "everything you left out", "what you inferred".
  // PAST TENSE ONLY: `keep`/`use` are what a conditional clause is built from.
  /\byou\s+(?:kept|used|left|dropped|omitted|ignored|inferred|included|excluded|discarded|captured|missed|reinterpreted)\b/i,
];

/**
 * Conjunct 2a — the message names the user's own submitted input.
 *
 * ⚠ NOT a synonym list for "the model". "the graph"/"the model" are what the
 * brief was turned INTO; naming those is not an audit of fidelity to the input.
 */
const BRIEF_REFERENT_PATTERNS: readonly RegExp[] = [
  /\b(?:my|the|that|this)\s+brief\b/i,
  /\bmy\s+(?:input|notes|write-?up|description|summary|context)\b/i,
  // "what I told you", "what I gave you", "anything I wrote", "the parts I
  // described". The determiner is generalised because "anything I wrote" refers
  // to the submitted text exactly as "what I wrote" does, and pinning only the
  // interrogative form left "have you replaced anything I wrote?" unclaimed.
  /\b(?:what|anything|everything|all|the\s+(?:things|parts|bits|stuff))\s+i\s+(?:told|gave|wrote|said|sent|described|shared)\b/i,
  // "the text I gave you", "the information I provided"
  /\bthe\s+(?:text|information|detail|numbers|figures)\s+i\s+(?:gave|wrote|sent|provided|shared)\b/i,
];

/**
 * Conjunct 2b — verbs of OMISSION, which have no session-edit reading.
 *
 * The product's edit vocabulary is add / change / update / set. Nothing in it
 * means "leave out", so these identify a fidelity question on their own —
 * *"what did you leave out?"* is unambiguous even with no brief named.
 */
/**
 * Conjunct 2c — a possessive reference to the user's own DATA rather than to
 * their brief as a document. Weak by construction: it does not distinguish
 * "the numbers I wrote in my brief" from "the numbers I set on the canvas", so
 * it is only ever admitted together with {@link RETENTION_VERB_PATTERNS}.
 */
const WEAK_INPUT_REFERENT_PATTERNS: readonly RegExp[] = [
  /\bmy\s+(?:numbers|figures|data|estimates|assumptions|targets|constraints)\b/i,
  /\bthe\s+(?:numbers|figures)\s+i\s+\w+/i,
];

/**
 * Verbs of RETENTION — "did any of it survive into the model?".
 *
 * ⚠ `change`, `update`, `add` and `set` are DELIBERATELY EXCLUDED. They are the
 * product's edit vocabulary, so admitting them here would let a weak referent
 * plus an edit verb ("did you change my numbers?") be claimed as an audit —
 * the lie this predicate's two-key design exists to prevent.
 */
const RETENTION_VERB_PATTERNS: readonly RegExp[] = [
  /\bus(?:e|ed|ing)\b/i,
  // Both alternatives carry their own anchors: `/\bkeep|kept\b/` would parse as
  // `(\bkeep)|(kept\b)` and silently lose an anchor on each side.
  /\bkeeps?\b|\bkept\b/i,
  /\binclud(?:e|ed)\b/i,
  /\bcaptur(?:e|ed)\b/i,
  /\breflect(?:ed)?\b/i,
  /\bincorporat(?:e|ed)\b/i,
  /\bdrop(?:ped)?\b/i,
  /\blos(?:e|t)\b/i,
];

/**
 * Conjunct 2d — verbs of INFERENCE and REINTERPRETATION, which are what PR1's
 * second and fourth questions are actually made of.
 *
 * These name something only the SYSTEM can have done to the USER'S material,
 * and none of them is an edit the product performs: you cannot ask Olumi to
 * "infer" or "reinterpret" a node. That is what lets these fire on
 * *"what did you add or infer yourself?"* while leaving the bare
 * *"what did you add?"* to the session-edit guard — the two differ by exactly
 * the word that carries the audit sense.
 *
 * ⚠ `add` and `change` are NOT here, and must never be: they are the verbs the
 * session-edit arm owns, and putting them here would answer "what did you just
 * change?" with a report about the brief.
 */
/**
 * ⚠ BOUND TO THE FRAME, NOT MERELY CO-OCCURRING WITH IT. Round 2 tested these
 * verbs anywhere in the sentence, so `Assuming` at the head of a conditional
 * paired with a frame match further along and claimed the turn. The verb must
 * be the OBJECT OF THE AUDIT CONSTRUCTION — "did you ... infer" — which is what
 * distinguishes a question about our inference from a supposition offered to us.
 *
 * The gap is measured in WORDS, not characters, and deliberately so: this
 * estate has already burned four rounds on a predicate discriminated by
 * "two arbitrary length constants with hard cliffs on either side"
 * (CLAUDE.md trap 22f). Nought-to-three words is a grammatical claim — the verb
 * is the head of the frame's complement — not a tuning knob. A ZERO gap does
 * not work: it loses "what did you add or infer yourself?", which is PR1's own
 * second question.
 */
const INFERENCE_VERB =
  "infer(?:red|ring|s)?|(?:re)?interpret(?:ed|ing|s|ation)?|invent(?:ed|ing|s)?" +
  "|assum(?:e|ed|ing|ption|ptions)|made?\\s+up|guess(?:ed|ing|es)?|fill(?:ed)?\\s+in";

/** Past participles only — the form that reports a completed inference. */
const PAST_INFERENCE_VERB =
  "inferred|(?:re)?interpreted|invented|assumed|guessed|made\\s+up|filled\\s+in";

const INFERENCE_VERB_PATTERNS: readonly RegExp[] = [
  new RegExp(`\\bdid\\s+you\\s+(?:\\w+\\s+){0,3}(?:${INFERENCE_VERB})\\b`, "i"),
  new RegExp(`\\bhave\\s+you\\s+(?:\\w+\\s+){0,3}(?:${INFERENCE_VERB})\\b`, "i"),
  new RegExp(`\\bdo\\s+you\\s+(?:\\w+\\s+){0,3}(?:${INFERENCE_VERB})\\b`, "i"),
  new RegExp(`\\byou\\s+(?:\\w+\\s+){0,2}(?:${PAST_INFERENCE_VERB})\\b`, "i"),
];

const OMISSION_VERB_PATTERNS: readonly RegExp[] = [
  /\ble(?:ave|aving|ft)\s+out\b/i,
  /\bomit(?:ted|ting|s)?\b/i,
  /\bignor(?:e|ed|ing)\b/i,
  /\bdiscard(?:ed|ing|s)?\b/i,
  /\b(?:not|never|didn['’]t|did\s+not)\s+model(?:led|ed)?\b/i,
  /\bmiss(?:ed|ing)\s+(?:out|anything|any)\b/i,
];

// ── the composer ────────────────────────────────────────────────────────────

/**
 * Render the derived manifest as an answer, or `null` when it must not claim.
 *
 * `null` means "fall through" — never a canned deflection, and never a zero.
 */
export function composeBriefAuditAnswer(manifest: NotModelledManifest): string | null {
  if (manifest.status !== "derived") return null;
  const q = manifest.quantities;
  if (q === null) return null;

  const paragraphs: string[] = [];

  /**
   * ⚠ F5 — ONE QUESTION, ONE NUMBER, ACROSS BOTH SURFACES (CLAUDE.md trap 21 at
   * the presentation layer).
   *
   * The UI panel's "Not modelled yet" count is `absent + prose_only`
   * (`V7WhatIWasGivenSection`), while round 1's headline here was `absent`
   * alone. On B2 that was 23 against 17: two surfaces reading the SAME
   * derivation and reporting different totals for what a user reads as the same
   * question, with nothing saying they differed. Neither number was wrong; the
   * defect was that the concepts were never named apart.
   *
   * The headline is now the panel's concept, so the two reconcile, and the two
   * parts are named underneath so the stronger claim ("I could not find it at
   * all") is still distinguishable from the weaker one ("it is only in the
   * prose").
   */
  const notYetModelled = q.absent + q.prose_only;
  paragraphs.push(
    `Here is what happened to the figures in your brief. I found ${count(q.total, "stated figure")}. ` +
      `${q.in_model} of them are carried in the model. The other ${notYetModelled} are not yet ` +
      `driving anything: ${q.absent} I could not find in the model, and ${q.prose_only} appear ` +
      `only in the commentary.`,
  );

  const absent = q.items.filter((i) => i.verdict === "absent");
  if (absent.length > 0) {
    // ⚠ F3 — "could not find", never "not in the model at all". The derivation
    // supports a statement about THIS SEARCH, not about the model. The locator
    // declines word-form numerals, requires currency identity, and does not
    // read ranges where a currency fails to distribute; its own header calls
    // that false-negative set incomplete. Every one of those failures points
    // the same way, toward reporting a figure as missing when it is present, so
    // the copy must not upgrade a search result into a fact about the model.
    paragraphs.push(`Figures I could not find in the model: ${quoteLiterals(absent)}.`);
  }

  const proseOnly = q.items.filter((i) => i.verdict === "prose_only");
  if (proseOnly.length > 0) {
    paragraphs.push(
      `Mentioned in the commentary but not driving anything: ${quoteLiterals(proseOnly)}.`,
    );
  }

  if (manifest.inferred_factors.status === "derived" && manifest.inferred_factors.items.length > 0) {
    const labels = manifest.inferred_factors.items.map((f) => f.label);
    paragraphs.push(
      `Figures I supplied myself, which you did not state: ${joinWithOverflow(labels, MAX_QUOTED_FACTORS)}. ` +
        `Those are my estimates, not yours, and they are worth checking.`,
    );
  }

  if (manifest.declared_exclusions.status === "reported" && manifest.declared_exclusions.items.length > 0) {
    paragraphs.push(
      `I also recorded leaving these out at the time: ${manifest.declared_exclusions.items.join("; ")}.`,
    );
  }

  /**
   * ⚠ F4 — A TRUNCATED DERIVATION SAYS SO.
   *
   * `deriveNotModelledManifest` tallies EVERY quantity it finds but caps
   * `items` at `MAX_ITEMS`, setting `truncated`. Round 1 read `items` and
   * ignored the flag, so on a long brief the headline counted figures the lists
   * then failed to name, and the difference vanished without a word. On a
   * 260-figure brief that is 60 of the user's own figures silently unaccounted
   * for, inside a capability whose entire promise is "here is what happened to
   * everything you said".
   */
  if (q.truncated) {
    const unaccounted = q.total - q.items.length;
    paragraphs.push(
      `One limit worth knowing: your brief is long, so I checked the first ${q.items.length} ` +
        `figures in it. ${unaccounted} further ${unaccounted === 1 ? "figure is" : "figures are"} ` +
        `not accounted for above. Ask me about a specific one and I will check it directly.`,
    );
  }

  // The anti-reassurance clause. Never optional: a finite `absent` list that
  // reads as exhaustive is the one failure the manifest's own header calls
  // "more damaging than silence".
  //
  // F3's second half: the SEARCH's own bounds are stated too, from
  // `scope.excluded_from_search`. Saying "I could not find it" is only honest
  // alongside what was never looked at.
  paragraphs.push(
    `This is not a complete account of what was left out. It only covers figures I can ` +
      `locate in your text: it does not look at ${humaniseList(searchExclusions(manifest))}, ` +
      `and it cannot see ${humaniseClasses(manifest.not_tracked)}. ` +
      `If something matters and is missing, tell me and I will add it.`,
  );

  return paragraphs.join("\n\n");
}

/**
 * Derive and render in one step — the shape the routing seam consumes.
 *
 * Returns `null` whenever no honest answer is available, so a caller can only
 * ever choose between a grounded answer and falling through.
 */
export function tryBriefAuditAnswer(
  briefText: string | null | undefined,
  graph: unknown,
): string | null {
  return composeBriefAuditAnswer(deriveNotModelledManifest(briefText, graph));
}

// ── rendering helpers ───────────────────────────────────────────────────────

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * Quote the user's own bytes back, verbatim.
 *
 * `literal` is the exact text the user wrote. It is never re-formatted,
 * re-scaled or re-worded: the point of the answer is that the user recognises
 * their own figure, and a "tidied" quote is the attribution defect (row 2.1006)
 * one level down.
 */
function quoteLiterals(items: readonly NotModelledItem[]): string {
  return joinWithOverflow(
    items.map((i) => i.literal),
    MAX_QUOTED_LITERALS,
  );
}

/**
 * Join, capping the visible list and DISCLOSING both the remainder AND the
 * order.
 *
 * Naming the order is the load-bearing half. Items arrive in the order they
 * appear in the brief, so an undisclosed cut invites the reader to assume the
 * shown items were the significant ones — a claim this module has no basis to
 * make and does not make.
 */
function joinWithOverflow(values: readonly string[], cap: number): string {
  if (values.length <= cap) return values.join(", ");
  const shown = values.slice(0, cap).join(", ");
  return `${shown}, and ${values.length - cap} more (these are the first ${cap} in the order you wrote them, not a ranking)`;
}

/**
 * Render `not_tracked` identifiers as English.
 *
 * ⚠ DERIVED, NOT MAPPED (CLAUDE.md trap 12). A hand-written identifier→prose
 * table would be a fifth mirror in a service that has paid for four; a class
 * added to `NOT_TRACKED_CLASSES` would then be silently absent from this
 * sentence, quietly making the caveat narrower than the truth. Underscores to
 * spaces is total over the identifier vocabulary and cannot drift.
 */
function humaniseClasses(classes: readonly string[]): string {
  const phrases = classes.map((c) => c.replace(/_/g, " "));
  if (phrases.length === 0) return "everything it does not track";
  return humaniseList(phrases);
}

/** Join a list in English, with "or" before the last item. */
function humaniseList(values: readonly string[]): string {
  if (values.length === 0) return "nothing";
  if (values.length === 1) return values[0]!;
  return `${values.slice(0, -1).join(", ")}, or ${values[values.length - 1]!}`;
}

/**
 * What the SEARCH never looked at, read from the manifest's own `scope`.
 *
 * ⚠ DERIVED, NOT RE-SPELLED (trap 12). One entry is a cross-reference rather
 * than user copy — `"everything in not_tracked"` — and the sentence that
 * follows already names those classes in full, so repeating the pointer would
 * be noise. It is dropped by matching the CROSS-REFERENCE, and if that entry's
 * wording ever changes the string simply renders literally: visibly odd, but
 * never a false narrowing of what we admit to skipping. Failing loud beats
 * failing quiet.
 */
const NOT_TRACKED_CROSS_REFERENCE = "everything in not_tracked";

function searchExclusions(manifest: NotModelledManifest): readonly string[] {
  return manifest.scope.excluded_from_search.filter(
    (entry) => entry !== NOT_TRACKED_CROSS_REFERENCE,
  );
}
