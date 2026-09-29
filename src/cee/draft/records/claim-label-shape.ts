/**
 * ⭐⭐ IS THIS LABEL A NAME, OR A SENTENCE? — the shape question for any claim
 * that becomes a NODE.
 *
 * ── THE WITNESSED DEFECT (Paul's manual test, 6 Sep 2026) ──────────────────
 * A factor node carried the 105-character sentence
 *   "Tech lead hiring typically takes 6–10 weeks; two developers may be found
 *    faster but add coordination cost"
 * and `fixFactorGoalEdges` minted a mediating outcome labelled
 * `${factorLabel} Impact` from it. The canvas clamps a title to two lines, so
 * both nodes rendered the SAME visible string and the user could not tell them
 * apart. The mint is correct in intent — `deterministic-sweep.ts:1163` states
 * why *"'<Factor> Impact' claims nothing about the world"* — it inherited a bad
 * input, which is why this module sits at the SOURCE and that file is untouched.
 *
 * ── THE MECHANISM: ONE FIELD, TWO QUESTIONS (trap 21) ──────────────────────
 * `claims[].label` means different things per `claim_kind`, and the projector
 * reads all of them as a display name:
 *   · `factor`/`risk`/`outcome`/`option_refinement` → the model supplies a NOUN
 *     PHRASE. All 41 such labels in the banked corpora are name-shaped.
 *   · `prior` → `instruction.ts` asks for *"what you believe about a quantity,
 *     and how sure you are"*, so the model supplies a BELIEF SENTENCE — and
 *     `CLAIM_KIND_TO_NODE_KIND` maps `prior → "factor"`.
 *   · `causal_link` → a relationship sentence that mints an EDGE, never a node.
 *
 * ⚠ THE SCOPE IS THEREFORE "MINTS A NODE", NOT "IS A FACTOR" (trap 13d — write
 * the predicate against the spec, not against the case you came in through). A
 * `causal_link` label of 103 characters is CORRECT and must never be flagged;
 * the caller passes only node-minting claims.
 *
 * ⚠ AND IT IS SCOPED TO MODEL-AUTHORED CLAIM LABELS. A stated item's label is
 * the user's own canonicalised quote (or an authored objective derived from it),
 * and judging the user's words by this predicate is a different question with a
 * different answer — the same scope discipline `label-bound.ts` states for
 * truncation.
 *
 * ── THE BOUND IS MEASURED, NOT CHOSEN (trap 22 — the corpus is from outside
 * this author's head) ──────────────────────────────────────────────────────
 * Over the four banked fixtures in `__tests__/fixtures`, node-minting kinds only:
 *
 *   kind               n    min  median  max
 *   factor             33    16      26   60
 *   option_refinement   8    14      39   59
 *   prior              15    48      65  104   ← the defect class
 *
 * The largest legitimate name observed is 60 characters ("Rewrite engineering
 * cost (10 engineers × 12 months, doubled)"). {@link CLAIM_LABEL_NAME_MAX_CHARS}
 * is set ABOVE that rather than AT it: a bound tuned to exactly admit the corpus
 * maximum is overfitted to the sample, and this predicate's job is to be quiet
 * about legitimate names.
 *
 * ── WHY THIS DISCLOSES AND NEVER TRUNCATES ────────────────────────────────
 * Truncation moves the lie rather than removing it — the node would still be
 * named by a mutilated claim, and two nodes sharing a prefix would still
 * collide. It is also unavailable in principle here: `label-bound.ts` may
 * truncate only because a verbatim `source_quote` is CONSERVED beside it, and an
 * `ai_inferred` claim node has no `source_quote` by construction. So the honest
 * move is the one the estate already ratified for ambiguity (trap 22f): make it
 * VISIBLE. The label ships unchanged and the disclosure says out loud that the
 * model named a node with a sentence.
 *
 * ── THE KNOWN GAP IS PINNED, NOT PAPERED OVER (trap 22f) ──────────────────
 * This predicate flags 12 of the 15 corpus `prior` labels and 0 of the 41
 * legitimate names. The three it misses are pinned BY NAME in
 * `__tests__/claim-label-is-a-name.test.ts`, so the suite REDs if that set grows
 * OR shrinks. A gap recorded in the suite is honest; a gap invisible to it is
 * how a predicate oscillates for four rounds.
 */

/**
 * The longest a model-authored NODE label may be before it is disclosed as a
 * sentence rather than a name.
 *
 * ⚠ NOT A CONTRACT BOUND, and deliberately not derived from one. The published
 * `NodeV3Schema.label.max(200)` is an EGRESS limit — the point past which a
 * label destroys the user's reply (`label-bound.ts`) — and it is 95 characters
 * above the largest real name anyone has emitted. Deriving this from it would
 * make the guard agree with a number chosen to answer a different question.
 */
export const CLAIM_LABEL_NAME_MAX_CHARS = 72;

/**
 * Punctuation that joins CLAUSES, and therefore never appears inside a name.
 *
 * ⚠ THE HYPHEN AND THE EN DASH ARE DELIBERATELY ABSENT. Six factor labels and
 * two option labels in the corpora carry a hyphen ("Copilot Year-One Revenue"),
 * and the en dash spells numeric ranges ("£1.50–£9"). Including either would
 * flag legitimate names — the false positive this predicate exists to avoid.
 * The em dash, semicolon and colon return ZERO hits across all 41 legitimate
 * names and 10 hits across the 15 belief sentences.
 */
const CLAUSE_PUNCTUATION = /[;:—]/u;

/**
 * TRUE when `label` reads as a NAME for a node.
 *
 * Two independent signals, each measured at ZERO false positives over the 41
 * legitimate names in the banked corpora. They are OR-ed rather than AND-ed
 * because they catch different halves of the same class: a short belief
 * ("LLM serving cost prior: wide uncertainty…") is caught by its colon, a long
 * one ("Win rate lift from 22% to 30% is based on 15 AE Slack poll…") by its
 * length.
 */
export function isNameShapedLabel(label: string): boolean {
  const trimmed = label.trim();
  if (trimmed.length > CLAIM_LABEL_NAME_MAX_CHARS) return false;
  if (CLAUSE_PUNCTUATION.test(trimmed)) return false;
  return true;
}
