/**
 * Clarify v2 — DRAFT-FIRST intake: a draft-shaped brief ALWAYS drafts, with
 * its missing-dimension questions deferred alongside the draft response.
 *
 * HISTORY, because the table below has moved twice and each move was the
 * point:
 *   - 2026-08-13 (Track 1, INTAKE-FUNNEL §5b): EXACTLY ONE missing
 *     dimension drafted first; ≥2 kept the blocking ask.
 *   - #928 review: two predicted flips (S4, M5) rode FAIL-UNSAFE timeframe
 *     arms; those detector arms were ablated. Round 4 removed every claim
 *     about the user's brief from the disclosure copy.
 *   - 2026-08-17 (Paul's ratified target — draft-first intake): the
 *     blocking round-1 ask is DELETED. A substantive brief produces the
 *     provisional model immediately; clarification rides alongside,
 *     non-blocking, and must never gate seeing the model. The wire witness
 *     (olumi-docs/witness-998-2026-08-16/, session A1) showed a fully
 *     substantive brief answered with questions instead of a model — and
 *     #928 R4 had already voided the cost model that licensed the blocking
 *     ask ("a false MISSING costs one question with a one-tap escape").
 *
 * The trigger remains a COUNT over the existing detectors and the route's
 * own draft-shape heuristic — deliberately NOT a new natural-language
 * predicate (traps 22/22b/22f).
 *
 * Honesty invariants pinned here (INTAKE-FUNNEL §5b i + #928 R4):
 *   - the deferred ask's disclosure names the assumptions as the
 *     ASSISTANT's, never as user-stated, and claims NOTHING about the
 *     user's brief (both branches: genuine miss and over-detection);
 *   - the disclosure binds to the MISSING dimensions by identity;
 *   - explicit-generate still proceeds with NO deferred ask (the user
 *     pressed Generate; unchanged behaviour).
 *
 * The 15-brief table is driven by REAL WIRE CAPTURES (tests/fixtures/
 * clarify-v2-wire-briefs-2026-08-12.json — append-only, never edited).
 * Expected missing-dimension sets are the LIVE RUBRIC's own verdicts,
 * derived at fa8bacc5 (the rubric is untouched by draft-first intake):
 * this table pins the ROUTING OUTCOME (trap 23) — every brief drafts.
 */
import { describe,expect,it } from 'vitest';





// The measured over-detection sentence is IMPORTED from the corpus that owns
// it — never retyped here (round 4: it was mirrored across two specs).






/**
 * The provenance marker every disclosure must carry (assistant-authored).
 *
 * ⚠ CHANGED at #928 round 4. The old marker was the literal string
 * `'not something you told me'` — which is itself A CLAIM ABOUT THE USER'S
 * WORDS, i.e. the very thing round 4 removes. A marker that pins the defect
 * is a guard holding the defect in place.
 */


// ── The 15-brief outcome table (the acceptance table, pinned) ──────────────
// 'complete'    → proceed silently, reason 'complete', NO deferred questions.
// 'draft_first' → proceed with the named dimensions' questions deferred:
//                 reason 'single_gap_draft_first' for one dimension,
//                 'multi_gap_draft_first' for two or more. EVERY gapped
//                 brief drafts — no row may be a blocking ask.




// ── Gap-count semantics (the off-by-one mutant target, inverted) ───────────


// ── Disclosure honesty (INTAKE-FUNNEL §5b constraint i) ────────────────────


// ── B3 (#928 round 4): THE DISCLOSURE MAKES NO CLAIM ABOUT THE USER'S BRIEF ─
/**
 * ⭐ THE GOVERNING RULE (orchestrator ruling, #928 round 4):
 * **the product may describe what IT did; it may not tell the user what THEY
 * said.** One of those we can always verify; the other we cannot.
 *
 * Round 3's copy said *"your brief didn't state the goal"*. The round-3
 * reviewer measured that sentence shipping, on the wire, on a brief reading
 * *"Our goal is not just cost but speed."* — a false assertion about the
 * user's own words. Draft-first is what made it serious: it removed both the
 * clarifying question and the one-tap escape that used to make a false
 * MISSING cost one question, so the error now costs a confident falsehood
 * about the user with no way to answer back. Draft-first INTAKE (2026-08-17)
 * widens draft-first to every gap count, so this rule now covers the
 * multi-gap disclosure too — pinned below in BOTH branches.
 *
 * THE EXIT IS NOT A BETTER DETECTOR. Four rounds of widening this predicate
 * each fixed one direction and opened the other (trap 22f). Round 4 instead
 * makes the predicate's accuracy STOP BEING A TRUTH-BEARING PROPERTY: the
 * disclosure claims only what the product itself did, so over-detection
 * degrades from a TRUTH defect to a QUALITY-OF-ASSUMPTION defect.
 */
describe('B3 — the disclosure is true in BOTH branches (it claims nothing about the brief)', () => {
  /**
   * Assertions about the USER'S OWN WORDS. Anything matching these is a claim
   * we cannot verify and therefore must not make.
   *
   * ⚠ This list is a hand-written lexicon and CANNOT be complete — it catches
   * the shapes we have actually shipped, not every shape English affords. It
   * is honest about that limit rather than pretending to be a derived guard
   * (trap 12d: deriving would prove the copies agree, never that the list is
   * right). Its POSITIVE CONTROL below is what stops it being decorative.
   */
  const BRIEF_CLAIM_PATTERNS: readonly RegExp[] = [
    /your brief/i,
    /\byou (?:didn't|did not|never|haven't|have not)\b/i,
    /\byou (?:said|stated|told|wrote|mentioned|gave|named|specified|provided)\b/i,
    /something you told me/i,
  ];

  const claimsAboutTheBrief = (text: string): readonly string[] =>
    BRIEF_CLAIM_PATTERNS.filter((re) => re.test(text)).map((re) => re.source);



  it('POSITIVE CONTROL — the guard can SEE a violation (round 3’s exact shipped copy)', () => {
    // Without this, every absence assertion below could pass by testing
    // nothing (trap 13). This is the literal round-3 string, measured on the
    // wire by the reviewer; the guard must flag it.
    const ROUND_3_COPY =
      "One thing to check: your brief didn't state the goal, so the goal in this draft is my " +
      'assumption — not something you told me. What outcome would make this decision a success?';
    expect(claimsAboutTheBrief(ROUND_3_COPY).length).toBeGreaterThan(0);
  });





  /**
   * The two branches, both routed through the REAL decision function so the
   * test binds to what a user would actually receive — not to the copy table.
   */


  /**
   * BRANCH B — THE OVER-DETECTION BRANCH. The reviewer's measured
   * over-detection sentence, IMPORTED from the corpus that owns it, embedded
   * in an otherwise complete brief exactly as measured (REVIEW-928-R3 §6 D-iv).
   *
   * ⚠ COMPOSED FROM THE IMPORT, NOT RETYPED. These bytes were previously
   * duplicated here with no import — two specs depending on one adjudication
   * with nothing tying them together (trap 12).
   */





});

// ── Dispatch level: the outcome is a DRAFT instruction, not a commit ──────
