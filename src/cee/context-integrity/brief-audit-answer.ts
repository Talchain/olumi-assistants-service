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
  type QuantityKind,
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
 *
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

/**
 * Conjunct 2b — verbs of OMISSION, which have no session-edit reading.
 *
 * The product's edit vocabulary is add / change / update / set. Nothing in it
 * means "leave out", so these identify a fidelity question on their own —
 * *"what did you leave out?"* is unambiguous even with no brief named.
 */
const OMISSION_VERB_PATTERNS: readonly RegExp[] = [
  // ⚠ THE PARTICLE IS SEPARABLE. `leave out` is a phrasal verb whose object
  // routinely splits it — *"did you leave anything out?"*, *"did you leave my
  // deadline out?"* — and the adjacent-only form scored those as NO disposition,
  // so a genuine fidelity question lost its grounded answer and fell through.
  // The 0-2 word window matches the shape the sibling INFERENCE patterns use.
  //
  // ⛔ WHAT THIS WINDOW IS *NOT* BOUNDED BY — do not read the number as measured.
  // The boundary sits at THREE intervening words, and *"did you leave the churn
  // factor out?"* is a perfectly ordinary fidelity question that this window
  // DROPS. That gap is pinned as a KNOWN-DROPPED case in
  // `__tests__/brief-audit-answer.test.ts` so it is visible in the suite rather
  // than invisible to it, and so the set REDs if it grows OR shrinks.
  //
  // It is left at 2 deliberately and NOT widened on my own judgement: this
  // predicate guards two opposite harms — too narrow drops a real fidelity
  // question, too wide answers a genuine SESSION-EDIT question with a report
  // about the brief, "A LIE either way" (`:110-111`). A corpus from the author's
  // head cannot bound a natural-language predicate (trap 22), and a mutant
  // widening this to {0,6} SURVIVED the first twin written here — the twin's
  // case sat eight words out and could never discriminate at the boundary. The
  // widening is a rowed question for an external corpus, not a guess to make here.
  /\ble(?:ave|aving|ft)\s+(?:\w+\s+){0,2}out\b/i,
  /\bomit(?:ted|ting|s)?\b/i,
  /\bignor(?:e|ed|ing)\b/i,
  /\bdiscard(?:ed|ing|s)?\b/i,
  /\b(?:not|never|didn['’]t|did\s+not)\s+model(?:led|ed)?\b/i,
  /\bmiss(?:ed|ing)\s+(?:out|anything|any)\b/i,
];

/**
 * Does the message attribute a HANDLING ACTION to the system — keeping,
 * dropping, omitting, inferring? i.e. is there a disposition for the manifest
 * to report on at all?
 *
 * ⚠ DERIVED FROM THE THREE VERB LISTS ABOVE, NOT COPIED FROM THEM (CLAUDE.md
 * trap 12). One definition, two readers: `isBriefAuditQuestion` uses the lists
 * to ADMIT a question, and `state-query-guard`'s brief-audit arm uses this to
 * decide whether a judgement request has left anything for the manifest to
 * answer. A hand-listed second copy here would drift the moment either list
 * grew.
 *
 * Exported for exactly one caller — the brief-audit arm's decline conjunct. It
 * narrows that decline: *"do you agree you left out my deadline?"* carries a
 * disposition (`left out`) and stays with the manifest, while *"do you actually
 * disagree with anything I said?"* carries none and goes to the reasoning
 * layer. See `orchestrator-v5/routing/judgement-request.ts` for why the two
 * must part.
 */
export function hasDispositionVerb(message: string): boolean {
  if (typeof message !== "string" || message.length === 0) return false;
  return (
    OMISSION_VERB_PATTERNS.some((p) => p.test(message)) ||
    RETENTION_VERB_PATTERNS.some((p) => p.test(message)) ||
    INFERENCE_VERB_PATTERNS.some((p) => p.test(message))
  );
}

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
 * How many of the user's own figures the DRAFT-TURN notice quotes before
 * summarising the remainder.
 *
 * ⚠ THIS IS A DIFFERENT CAP FROM `MAX_QUOTED_LITERALS`, AND DELIBERATELY SO —
 * the two answer different questions and must not be collapsed (trap 21).
 * `MAX_QUOTED_LITERALS` (25) governs the PULLED audit, where the user asked
 * "what happened to my figures?" and wants the whole account; it was raised
 * from 12 precisely because a tight cap hid a severe loss behind "and 11 more".
 * This one governs a PUSHED footer on a reply the user did not ask for, where
 * the same 25 figures would be a wall rather than a disclosure. It matches
 * `MAX_LISTED_WHEN_OVER` in `post-draft-narrative.ts`, the list cap that file
 * already applies to everything else it names.
 *
 * The tight cap is only defensible because the remainder is COUNTED and the
 * ordering DISCLOSED below, and because the full account remains one question
 * away — this notice is a pointer to that capability, never a replacement for
 * it.
 */
export const MAX_FIGURES_IN_DRAFT_NOTICE = 3;

/**
 * The kinds the pushed draft-turn notice must NOT name — those denoting a
 * POINT IN TIME rather than a magnitude a factor can carry as a value.
 *
 * ⚠ EXPRESSED AS AN EXCLUSION, NEVER AS AN ALLOW-LIST, and that is trap 12 not
 * style. A literal list of the disclosable kinds would be a mirror of
 * `QuantityKind`: add a seventh kind and it would be silently withheld, with no
 * error anywhere and a comment above still claiming otherwise. Testing for the
 * two temporal members is TOTAL over the vocabulary — a new kind is disclosed
 * by default, which is the correct direction for a clause whose entire subject
 * is silent omission.
 */
const TEMPORAL_KINDS: ReadonlySet<QuantityKind> = new Set<QuantityKind>(["date", "period"]);

function isDisclosableInDraftNotice(kind: QuantityKind): boolean {
  return !TEMPORAL_KINDS.has(kind);
}

/**
 * THE SHORT, PUSHED FORM: name the figures the model did not carry, on the
 * draft turn, without being asked.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * `TEAM-TEST-MVP.md` criterion 2 requires that a material fact stated in the
 * brief is either preserved in the model OR explicitly disclosed as not
 * modelled — *"silent omission fails this"*. Every part of the derivation
 * needed to satisfy it already shipped: the manifest classifies each stated
 * quantity, and {@link composeBriefAuditAnswer} renders the full account. But
 * both were reachable ONLY through `state-query-guard.ts`, which fires only
 * when the user ASKS. A user reading their first draft has no reason to think
 * to ask, so the answer existed and nobody ever saw it. Measured on deployed
 * CEE `df3e542`: a brief stating £240,000 and £65,000 produced a model
 * carrying neither and a reply mentioning neither.
 *
 * This adds no derivation and no new verdict. It renders, in one sentence,
 * what {@link deriveNotModelledManifest} had already decided.
 *
 * ── WHAT IT DISCLOSES, AND THE TWO IT WITHHOLDS ────────────────────────────
 * `absent` ONLY. Both other verdicts are deliberately silent:
 *   · `in_model`   — the figure is carried; saying otherwise is a false alarm.
 *   · `prose_only` — the figure IS in the model's own text, where the user can
 *     read it. It is not driving anything, which the PULLED audit says in its
 *     own paragraph; but on an unsolicited footer, telling someone we could not
 *     find a number they can see is the cry-wolf direction.
 *
 * That matters more here than in the pulled answer. A notice the user did not
 * ask for is read once and then learned from: if it fires on faithful models it
 * trains the reader to skip it, and the one that matters goes with it. Two
 * harms, one predicate, and they cannot share a window — so this takes the
 * conservative side and the twin is pinned in
 * `coaching/__tests__/dropped-figures-disclosed.test.ts`.
 *
 * ── ⚠ THE COPY REPORTS THE SEARCH, NEVER THE MODEL ─────────────────────────
 * Same rule as F3 above, and for the same reason: `stated-amounts.ts` declares
 * its own false-negative set incomplete, and every one of those misses points
 * the same way — toward reporting a figure as missing when it is present. So
 * this says *"could not find"* and never *"is not in the model"*. The weaker
 * claim is the true one.
 *
 * ── ⚠ AND IT DISCLOSES MAGNITUDES ONLY — MEASURED, NOT ASSUMED ─────────────
 * `date` and `period` are excluded, and the reason is this notice's own
 * promise: *"tell me what they apply to and I'll add them."* That is only a
 * truthful offer for a quantity the model can CARRY AS A VALUE. There is no
 * temporal dimension on the graph for `Q3` to be added to, so naming it
 * prescribes an action that terminates in refusal — the defect class this
 * estate already has on record elsewhere in the product.
 *
 * ⚠ THIS WAS INCLUDED FIRST AND REFUTED BY THE TWIN, which is why it is stated
 * as a measurement rather than an opinion. On a model that faithfully carried
 * BOTH of the user's money figures, the notice still fired — on `Q3`. That is
 * the cry-wolf direction exactly: a notice that fires on a faithful model
 * teaches the reader to skip it, and the one that matters goes with it.
 *
 * ⭐ AND THE MEASUREMENT THAT SETTLES IT RATHER THAN THE INTUITION. Across all
 * four real cold-read captures, EVERY `date`/`period` item — `FY28`,
 * `Q3 2027`, `January 2027`, `14 May 2027` — carries `matched_node_id: null`,
 * INCLUDING the ones verdicted `in_model`. For these kinds `in_model` means
 * only "the string occurs in the model's prose", never "a quantity carries
 * it". So neither verdict supports a claim about a value, in either direction.
 *
 * ⛔ NOTHING IS HIDDEN BY THIS. A dropped deadline is a real loss — the
 * 2026-08-08 trace graded `14 May 2027` SEVERE — and
 * {@link composeBriefAuditAnswer} still reports it in full, unchanged, one
 * question away. This narrows WHAT THIS FOOTER PUSHES, never what the product
 * admits to losing.
 *
 * ── ⚠ THE REMAINDER IS COUNTED, THE ORDERING DISCLOSED ─────────────────────
 * Measured on the real captures, `absent` runs to 17, 17 and 23 figures. A
 * pushed footer cannot carry those, and a silently short list is the same lie
 * as an empty one. So the remainder is stated and the ordering named as
 * positional — this sentence makes no completeness claim, and the complete
 * account (which handles `MAX_ITEMS` truncation explicitly, F4 above) is the
 * one the user can ask for.
 *
 * Returns `null` whenever there is nothing honest to say, so a caller can only
 * choose between a grounded notice and silence.
 */
export function composeDroppedFigureNotice(manifest: NotModelledManifest): string | null {
  if (manifest.status !== "derived") return null;
  const q = manifest.quantities;
  if (q === null || q.absent === 0) return null;

  const absent = q.items.filter(
    (i) => i.verdict === "absent" && isDisclosableInDraftNotice(i.kind),
  );
  if (absent.length === 0) return null;

  const shown = absent.slice(0, MAX_FIGURES_IN_DRAFT_NOTICE).map((i) => i.literal);
  const remainder = absent.length - shown.length;
  const list =
    remainder > 0
      ? `${shown.join(", ")}, and ${remainder} more (the first ${shown.length} in the order ` +
        `you wrote them, not a ranking)`
      : shown.join(", ");

  return (
    `Figures from your brief I could not find in the model: ${list}. ` +
    `Tell me what they apply to and I'll add them.`
  );
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
