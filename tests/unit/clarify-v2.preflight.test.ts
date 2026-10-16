/**
 * Clarify v2 preflight decision core — round semantics, no-repeat, stop
 * rule, response composition (E0-B, ROADMAP 1.94 Option A replacement).
 *
 * DRAFT-FIRST INTAKE (2026-08-17, Paul's ratified target): round 1 no
 * longer ASKS — every draft-shaped brief proceeds to the draft, with its
 * questions deferred alongside. The resume machinery (and the composer it
 * uses) stays live for LEGACY rounds — rows persisted by pre-draft-first
 * deploys, honoured within their TTL — so the resume/composition pins
 * below derive their round state from the live rubric + question composer
 * (exactly what the retired round-1 ask arm recorded), never hand-listed.
 *
 * RED-first on base (module absent). The mutation checks for these pins
 * (run in a throwaway worktree):
 *   - forcing the rubric to always return complete turns the fires-at-all
 *     pins RED (the retired never-fires baseline);
 *   - dropping `asked` from the resume filter turns the no-repeat pin RED;
 *   - removing the round budget turns the stop-rule pin RED;
 *   - restoring the round-1 blocking ask turns the draft-first pins RED.
 */
import { describe,expect,it } from "vitest";








/**
 * The questions a round over `brief` asks/defers — composed over the REAL
 * rubric's missing set, capped at the round budget. This is exactly the
 * derivation the retired round-1 ask arm used, kept live here because the
 * resume path still consumes it.
 */


/**
 * A LEGACY live round state — as persisted by a pre-draft-first deploy
 * (when round 1 still asked), and as the resume path's own follow-up asks
 * still persist it. Derived from the live modules, never hand-listed.
 */




// ─────────────────────────────────────────────────────────────────────────
// a1/first-message-drafts (19 Jul journey probe) — round 1 RESPECTS an
// explicit generate instruction. RED-first: on base decideClarifyV2Round1
// ignores the second argument and runs the rubric, so the probe brief asks
// goal (+ timeframe pre-rubric-fix) instead of proceeding. Mutation-check:
// reverting the isExplicitGenerate branch turns every pin below RED.
// ─────────────────────────────────────────────────────────────────────────






// Review fix A10 (17 Jul) — the proceed PATTERN must cover the canned
// proceed MESSAGE exactly (the redundant exact-string check was removed as
// dead code; this pin keeps it dead rather than silently uncovered).




// ─────────────────────────────────────────────────────────────────────────
// ROADMAP 1.152 — design-bearing review fixes (17 Jul record), RED-first.
// ─────────────────────────────────────────────────────────────────────────











// ─────────────────────────────────────────────────────────────────────────
// ROADMAP 1.152(i) — #498-review P2/P3: widened decline cue set + hedged
// proceed, RED-first (every decline probe below folded as an ANSWER at
// #498's head; the hedged-proceed probe folded too).
// ─────────────────────────────────────────────────────────────────────────



describe('1.152(i) — the 24-case answer battery (danger direction: every one MUST fold as an answer)', () => {
  // LEGACY live round (persisted pre-draft-first; resume still honours it).


  // Each case carries a decline/hedge cue WORD or shape that the widened
  // patterns must NOT claim. Asserting the incorporated brief CONTAINS the
  // message proves the fold (not merely "not declined").
  const ANSWER_BATTERY: readonly string[] = [
    // The four named danger pins (#498 review):
    "I don't want to expand into Germany",
    'we want to stop customer churn',
    'the options are to cancel the contract or renegotiate it',
    'Wait, the budget is £2m',
    // Cue words INSIDE real answers:
    'We should wait until Q3 before committing the budget.',
    'No, the budget is £2m not £200k',
    'We should stop hiring contractors first.',
    'Stop-loss is capped at £50k.',
    'No more than three new hires this quarter.',
    'Cancel culture is hurting our brand in the US market.',
    'Later this year we plan to open the Berlin office.',
    'Not now, but within six months we must decide.',
    "Let's not forget the Berlin team depends on this decision.",
    // Leading-adverb answers (the new softener prefix must not claim them):
    'Actually the goal is to cut costs, not grow revenue.',
    'Honestly we just want to survive the next 12 months.',
    // Hedge words INSIDE real answers (the hedged-proceed pattern's
    // required proceed-phrase tail must not claim them):
    "Maybe France, maybe Germany — we're torn.",
    'I guess the biggest risk is churn in the enterprise segment.',
    'maybe we should expand into France instead',
    // Ordinary answers (regression floor from the A1 battery):
    'The goal is to increase revenue.',
    'The main alternative is doing nothing and keeping things as they are.',
    'It depends on whether Sam accepts.',
    'The board meets soon and morale is low.',
    'The timeframe is 18 months.',
    'Our budget is £2m and the deadline is Q4.',
  ];

  it('battery integrity: exactly 24 cases', () => {
    expect(ANSWER_BATTERY).toHaveLength(24);
  });


});





/**
 * DEFECT B (dress rehearsal, 20 Jul) — CEE over-emits chips and the
 * escape hatch is evicted.
 *
 * Observed: CEE emitted 4 `suggested_actions`; the UI renders at most 3
 * (D-K "0–3 chips", ratified 15 Jul). The default-forward escape hatch
 * was appended LAST, so it was ALWAYS the chip the cap dropped — the one
 * chip the clarify doctrine calls mandatory ("no question is ever a dead
 * end") was the only one guaranteed never to reach the user.
 *
 * RED-first on base: base emits `[...candidateChips, proceedChip]` with
 * no cap, so (1) the count pin fails and (2) the survival pin fails.
 *
 * Mutation check for these pins (throwaway worktree): restore
 * `[...candidateChips, proceedChip]` in `composeClarifyV2Response` and
 * BOTH the cap pin and the survival pin go RED.
 */
