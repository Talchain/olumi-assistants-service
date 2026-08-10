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
 * ⚠ TWO CONJUNCTS, AND THAT IS THE DESIGN (CLAUDE.md trap 22b). This predicate
 * guards against two OPPOSITE harms, which cannot share one window:
 *
 *   - too narrow → the audit question keeps being deflected. A GAP: the user is
 *     no worse off than today.
 *   - too wide   → a genuine session-edit question ("what did you just
 *     change?") is answered with a report about the brief. A LIE, and strictly
 *     worse than the gap.
 *
 * So both conjuncts must hold, and the predicate fails toward the GAP:
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
 * Deliberately second-person and past-tense. A present-tense imperative
 * ("use my brief") is a request, not an audit.
 */
const AUDIT_FRAME_PATTERNS: readonly RegExp[] = [
  // "what did you keep", "which parts of my brief did you leave out",
  // "did you use my ARR figure"
  /\bdid\s+you\b/i,
  // "what you kept", "everything you left out", "what you inferred"
  /\byou\s+(?:kept|keep|used|use|left|dropped|omitted|ignored|inferred|included|excluded|discarded|captured|missed|reinterpreted)\b/i,
  // "have you left anything out", "have you used my numbers"
  /\bhave\s+you\b/i,
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
  // "what I told you", "what I gave you", "what I wrote", "what I said"
  /\bwhat\s+i\s+(?:told|gave|wrote|said|sent|described|shared)\b/i,
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
  /\bkeep|kept\b/i,
  /\binclud(?:e|ed)\b/i,
  /\bcaptur(?:e|ed)\b/i,
  /\breflect(?:ed)?\b/i,
  /\bincorporat(?:e|ed)\b/i,
  /\bdrop(?:ped)?\b/i,
  /\blos(?:e|t)\b/i,
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

  paragraphs.push(
    `Here is what happened to the figures in your brief. I found ${count(q.total, "stated figure")}. ` +
      `${q.in_model} of them are carried in the model, ${q.prose_only} appear only in the commentary, ` +
      `and ${q.absent} are not in the model at all.`,
  );

  const absent = q.items.filter((i) => i.verdict === "absent");
  if (absent.length > 0) {
    paragraphs.push(`Not in the model: ${quoteLiterals(absent)}.`);
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

  // The anti-reassurance clause. Never optional: a finite `absent` list that
  // reads as exhaustive is the one failure the manifest's own header calls
  // "more damaging than silence".
  paragraphs.push(
    `This is not a complete account of what was left out. It only covers figures I can ` +
      `locate in your text, so it cannot see ${humaniseClasses(manifest.not_tracked)}. ` +
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
  if (phrases.length === 1) return phrases[0]!;
  return `${phrases.slice(0, -1).join(", ")}, or ${phrases[phrases.length - 1]!}`;
}
