/**
 * INV-Q (ROADMAP 2.715) — THE PROTECTED CLASS, SINGLE-SOURCED.
 *
 * ⚠⚠ HISTORIC CAPTURES — VERBATIM, APPEND-ONLY, NEVER EDIT (CLAUDE.md trap 14b).
 * These are records of user text that was MEASURED to capture as decision
 * briefs on dated builds. They are EVIDENCE, not fixtures to keep current. You
 * may add to this file; you may not reword an existing entry to make a test
 * pass. If an entry behaves unexpectedly, that is a finding to report, not an
 * edit to make.
 *
 * WHY THIS MODULE EXISTS (CLAUDE.md trap 12 — the hand-maintained mirror).
 * The corpus previously lived only as two inline literals inside
 * `question-to-assistant.test.ts`. A second consumer (the routing-level
 * corpus at `src/orchestrator/__tests__/route-v2-inv-q-protected-class.test.ts`)
 * would have had to COPY them, and the copy would drift silently — the
 * estate's dominant defect class. Both consumers now import from here, so a
 * change to the class is a change in ONE place and both suites see it.
 *
 * PROVENANCE
 *  - CAPTURED_QUESTIONS (11): capture-semantics-derivation-2026-08-08.md §1.4 —
 *    the eleven messages measured to capture as decision briefs at `8c316b5e`.
 *    Each is a typed paraphrase of one of the product's own coaching prompts,
 *    each satisfies `isDraftShapedText` through the regex's `\?$` arm alone,
 *    and none is caught by the process-meta guard's exact-string mirror.
 *    ⚠ Note the paraphrase point specifically: the product's own coaching
 *    string is "Run a pre-mortem with me: imagine this choice failed a year
 *    from now. What went wrong?" — which the exact-string mirror DOES catch.
 *    Entry 6 below is the user's typed paraphrase of it, which it does not.
 *    A substring sweep conflates the two; an exact-string sweep does not.
 *  - A7_MUST_DEFLECT (6): PR #1002 fix round, 2026-08-17. Corpus provenance is
 *    documented in full at `question-to-assistant.test.ts` (A7) — the
 *    reviewer's execution corpus, the product's own bias-library copy, and
 *    auxiliary x subject alphabet walks.
 */

/** capture-semantics-derivation-2026-08-08.md §1.4 — the 11 that captured. */
export const CAPTURED_QUESTIONS: readonly string[] = [
  "What assumption matters most, and why?",
  "What risks and upsides am I missing from my model?",
  "Is this the right question for me to be asking here?",
  "What should I be checking before I run this?",
  "Can you take the outside view on this one, what do base rates suggest?",
  "Could you run a pre-mortem with me on this decision?",
  "How confident are you in the estimate you used for churn?",
  "Where do you and I differ on this, and why?",
  "Can you explain what the simulation actually does here?",
  "What does the confidence interval on that edge mean?",
  "Why did you pick 0.4 for that coefficient?",
];

/** PR #1002 A7 — decision verb whose SUBJECT is the assistant. */
export const A7_MUST_DEFLECT: readonly string[] = [
  // Reviewer's blocker cases (execution-proven drafting at 7d27adef).
  "How do you decide which factors matter in the analysis?",
  "How does Olumi decide which options to include?",
  // Product-authored (bias library) — forces the optional-adverb slot.
  "Would you still choose to invest in this option?",
  // Auxiliary × subject alphabet walks.
  "Could Olumi choose the best option for us automatically?",
  "Will you launch the analysis for me once the model is ready?",
  "Did you decide the baseline values yourself when drafting?",
];

/**
 * The 17 messages ROADMAP 2.715 protects from being modelled as decisions.
 * 11 + 6. The two halves stay separately named because they were derived by
 * different routes and their sizes are pinned independently.
 */
export const INV_Q_PROTECTED_CLASS: readonly string[] = [
  ...CAPTURED_QUESTIONS,
  ...A7_MUST_DEFLECT,
];

/**
 * The precision bias, ratified in META-DECISION-DIAGNOSIS-2026-07-20 and
 * restated in `process-meta-intake.ts`: over-blocking a genuine decision brief
 * is a WORSE defect than the one 2.715 fixes. Every entry is interrogative and
 * MUST keep drafting — these are the opposite-direction twins without which a
 * protection corpus is a guard watching one door (CLAUDE.md trap 22b).
 */
export const GENUINE_INTERROGATIVE_BRIEFS: readonly string[] = [
  "Should we expand into Germany or double down on the UK?",
  "Should we expand into Germany or add a second warehouse in Poland?",
  "Whether to migrate the CRM to HubSpot this quarter or stay on Salesforce?",
  "Is it better to hire two engineers now or wait until Q3?",
  "Which vendor should we choose for the data platform migration?",
  "Shall we launch the new pricing tier in Q3 or hold it for Q4?",
  "Do we buy the warehouse outright or lease it for three years?",
];
