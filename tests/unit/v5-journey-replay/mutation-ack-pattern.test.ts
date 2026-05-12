/**
 * V5 replay harness — MUTATION_ACK_PATTERN regression pin.
 *
 * Background: post PR #164 (V5 H5 Tier-1 safety, merged 2026-05-11),
 * a Layer-B replay reading of the dl7-edit-graph evidence packs
 * suggested the mutation-ack assertion was rejecting genuine mutations
 * like "Strengthened the X edge from Y to Z". Investigation showed the
 * regex already accepted that phrasing — the misread came from the
 * Step-2 failure-evidence string, which listed three sample verbs
 * ("Updated X", "X now has...", "Adjusted ...") and was easy to take
 * for the regex's full vocabulary.
 *
 * This test pins the accepted vs rejected classes of MUTATION_ACK_PATTERN
 * so a future reader cannot make the same misread without breaking the
 * test. Three groups:
 *
 *   1. Accepted — genuine mutation phrasing the harness MUST keep
 *      passing. Cases drawn verbatim from the post-PR-#164 replay
 *      evidence (Docs/v5/v5-dl7-edit-graph-diagnostic.md and the
 *      h5-replay run-* packs).
 *
 *   2. Rejected — Mode A draft / proposal copy, Step-1 graph-echo
 *      prose, and "no change" denial. These MUST keep failing on the
 *      regex itself.
 *
 *   3. Documented matched-but-Step-3-caught — bare or ambiguous
 *      accepted-verb phrases that match the regex on their own
 *      (e.g. a bare past-tense "Updated Price.", or a present-tense
 *      "I can set ..." that matches the case-insensitive `Set` token).
 *      Layered defence: Step 3 (`assertWhatChanged`) fails the journey
 *      if `recent_changes` cannot surface the change. Do NOT narrow
 *      the regex to drop these cases — narrowing would also drop
 *      genuine mutations.
 */

import { describe, it, expect } from 'vitest';

import { MUTATION_ACK_PATTERN } from '../../../tools/v5-journey-replay/assertions.js';

describe('MUTATION_ACK_PATTERN — accepts genuine mutation phrasing', () => {
  it.each([
    // Verbatim from Docs/v5/v5-dl7-edit-graph-diagnostic.md:73 (Step 2 PASS).
    'Strengthened the Incremental Hiring Cost to Budget Overrun Risk edge from 0.5 to 0.7.',
    // Verbatim shape from h5-replay dl7-edit-graph-run-2 / run-6 (Step 2 PASS).
    'Strengthened the headcount investment to delivery capacity edge from ~0.15 to 0.32.',
    // Past-tense "Increased" — accepted class.
    'Increased the strength of X from 0.4 to 0.6.',
    // Verbatim shape from h5-replay dl7-edit-graph-run-3 / run-8 / run-10 (Step 2 PASS, mutation_ack="now has").
    'Headcount Investment Level now has a stronger and more certain effect on Q3 Delivery Capacity.',
    // Passive-voice acknowledgement.
    'X has been updated.',
  ])('matches: %s', (text) => {
    expect(text).toMatch(MUTATION_ACK_PATTERN);
  });
});

describe('MUTATION_ACK_PATTERN — rejects Mode A / draft / Step-1 echo', () => {
  it.each([
    // Verbatim from h5-replay dl7-edit-graph-run-5 (Step 2 FAIL, correct rejection).
    'I have changes in mind for Headcount and Scaling Budget, but I need the specifics to apply them directly.',
    // Verbatim from Docs/v5/v5-dl7-edit-graph-diagnostic.md:169 (intermittent Mode A draft, correct rejection).
    "I've drafted a change that fits your description, but I can't apply a draft proposal automatically yet.",
    // Verbatim from h5-replay dl7-edit-graph-run-1 (Step-1 graph-echo template repeated at Step 2, correct rejection).
    "Your decision model for 'Build a High-Performing, Sustainable Team' is ready, with 4 options, 4 factors, and 2 risks to consider.",
    // Generic denial — no mutation verb.
    'No changes were needed.',
  ])('does not match: %s', (text) => {
    expect(text).not.toMatch(MUTATION_ACK_PATTERN);
  });
});

describe('MUTATION_ACK_PATTERN — known matched-but-Step-3-caught (do not narrow)', () => {
  // These cases match MUTATION_ACK_PATTERN on a bare or ambiguous
  // accepted-verb token — a bare past-tense verb ("Updated Price.")
  // or a present-tense match against the case-insensitive `Set` token
  // ("I can set X to Y. Reply with ..."). That is intentional and is
  // the prose half of a layered defence:
  // the structural backstop is Step 3 (`assertWhatChanged`), which
  // fails the journey if the next turn cannot surface the change via
  // `recent_changes`.
  //
  // Do NOT "fix" these cases by narrowing the regex. Narrowing the
  // `Set` token would reject legitimate acknowledgements such as
  // "Set X to 20." Narrowing the `Updated` token would reject the
  // canonical set_factor_value acknowledgement
  // ("Updated Incremental Hiring Cost from £0 to 20%."). The right
  // place to enforce "did the mutation actually persist" is Step 3,
  // which already does so.
  it.each([
    // Bare past-tense verb. Matches on "Updated".
    'Updated Price.',
    // Mode A offer phrased with a present-tense "set". Matches on
    // case-insensitive "set" against the `Set` token in the regex.
    "I can set X to Y. Reply with the value you'd like.",
  ])('matches at the regex (Step 3 must catch the absence of recent_changes): %s', (text) => {
    expect(text).toMatch(MUTATION_ACK_PATTERN);
  });
});
