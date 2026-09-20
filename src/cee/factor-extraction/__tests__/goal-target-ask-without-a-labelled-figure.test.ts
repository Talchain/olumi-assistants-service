/**
 * ⭐⭐⭐ A GOAL WHOSE LABEL NAMES NO FIGURE STILL DESERVES THE QUESTION.
 *
 * ── THE WITNESS. Deployed staging, 19 Sep 2026, scenario `26b908ee`. The
 * person wrote *"We're raising 1.3 million, and we need all of it. If we fall
 * short, we'd have to completely replan our approach, which would be a very
 * bad outcome. Ideally, we'd like to be offered more."* The drafter labelled
 * the goal **"Ideally, We'd Like to Be Offered More"** — the brief's softest
 * final clause — and `goal_threshold` stayed null for the whole 34-minute
 * session. The person was never asked what would count as success.
 *
 * ── WHY IT WAS NEVER ASKED, measured. `deriveGoalTargetFromLabel` refuses
 * `no_quantity_in_label` when the GOAL NODE'S LABEL carries no figure, and
 * `deriveGoalTargetCandidate` returned `undefined` on that refusal — so the
 * whole elicitation chain that already exists (`decideGoalTargetAsk` ->
 * `elicit_goal_target` -> resume -> `stampGoalThreshold`) never armed.
 *
 * The cost is not one missing question. A census across twelve captures from
 * that day: `goal_target_stated` false in 9 of 12, and the product named a
 * recommendation in exactly ONE session — the one whose goal happened to be
 * labelled "Reach £30k MRR Within 18 Months", so the figure sat inside the
 * LABEL. **Whether a person is asked for their own success criterion is
 * currently decided by how the model phrased a display string.**
 *
 * ── WHAT THIS CHANGE DOES NOT DO, and the ruling it is held to.
 * Codex's #1328 ruling governs this module: no consumer may mint, preselect or
 * assert a stated target, and a neutral amount question must not present a
 * rejected or unrelated amount as the user's choice. This change widens ONLY
 * WHEN THE QUESTION IS ASKED. It cannot leak a figure, because:
 *   · `composeGoalTargetQuestion` ignores the candidate entirely and returns a
 *     constant sentence that quotes nothing;
 *   · the pending `elicit_goal_target` record carries no value field, so the
 *     number written comes from parsing the USER'S ANSWER;
 *   · this arm reports `unit: 'count'`, which `isUserEstablishedUnit` rejects
 *     by name, so no unit hint is carried either. We do not know the unit and
 *     we say so.
 * The canonical hostile case — "We rejected the proposal to reach £64k MRR." —
 * is pinned below and must reach the SAME question, never that figure.
 */
import { describe, expect, it } from "vitest";

import {
  deriveGoalTargetCandidate,
  deriveGoalTargetFromLabel,
} from "../goal-label-target.js";

/** The person's own words, capture `26b908ee`, 19 Sep 2026. */
const CAPTURED_BRIEF =
  "For our startup, should we target angel investors or focus only on funds that can provide the " +
  "full amount for our pre-seed round? We're raising 1.3 million, and we need all of it. If we " +
  "fall short, we'd have to completely replan our approach, which would be a very bad outcome. " +
  "Ideally, we'd like to be offered more.";

/** The label the drafter actually produced for that brief. */
const CAPTURED_GOAL_LABEL = "Ideally, We'd Like to Be Offered More";

describe("a goal label with no figure still earns the target question", () => {
  it("⭐ THE WITNESS: the captured goal yields a candidate, so the question is armed", () => {
    // The producer still refuses, and that refusal is correct — the label
    // genuinely names no figure. What changes is that the refusal no longer
    // ends the chain.
    const refusal = deriveGoalTargetFromLabel(CAPTURED_GOAL_LABEL, CAPTURED_BRIEF);
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) expect(refusal.refusal).toBe("no_quantity_in_label");

    const candidate = deriveGoalTargetCandidate("goal_1", CAPTURED_GOAL_LABEL, CAPTURED_BRIEF);
    expect(candidate).toBeDefined();
    expect(candidate?.goal_node_id).toBe("goal_1");
    expect(candidate?.binding).toBe("unlabelled_goal");
    expect(candidate?.reason).toBe("no_quantity_in_label");
  });

  it("⛔ IT CARRIES NO UNIT — we do not know it, and `count` is how this module says so", () => {
    // `isUserEstablishedUnit` rejects 'count' by name, so the pending action
    // never gains a unit hint from this arm. Without this the ask could carry
    // '£' inferred from an unrelated figure in the brief.
    const candidate = deriveGoalTargetCandidate("goal_1", CAPTURED_GOAL_LABEL, CAPTURED_BRIEF);
    expect(candidate?.unit).toBe("count");
    expect(candidate?.label_span).toBe("");
  });

  it("⛔ THE HOSTILE CASE reaches the question and never the figure", () => {
    // Codex's canonical case. Under the label route this brief's £64k was
    // classified `governed` — the REJECTED proposal is the canonical member of
    // that class. Here the label names no figure at all, so this arm fires;
    // it must still be a neutral ask, which it is by construction because the
    // composer ignores the candidate. Pinned so a future consumer that starts
    // reading `value_user_units` has to confront this case.
    const brief = "We rejected the proposal to reach £64k MRR. We are deciding how to grow.";
    const candidate = deriveGoalTargetCandidate("goal_1", "Grow The Business", brief);

    expect(candidate).toBeDefined();
    expect(candidate?.binding).toBe("unlabelled_goal");
    expect(candidate?.unit).toBe("count");
  });

  it("⛔ NO FIGURE IN THE BRIEF ⇒ STILL NO CANDIDATE — the module's standing rule is untouched", () => {
    // The discriminating twin of the witness: same shape of label, a brief
    // with nothing to ask about. Without this the first case would be equally
    // consistent with an arm that fires unconditionally.
    const candidate = deriveGoalTargetCandidate(
      "goal_1",
      CAPTURED_GOAL_LABEL,
      "We are deciding whether to expand into Germany or stay put.",
    );
    expect(candidate).toBeUndefined();
  });

  it("the LABELLED route is byte-unchanged — a figure in the label still binds as it did", () => {
    // The positive control from the one session of twelve that worked. This
    // must keep returning `governed` off the label, not fall through to the
    // new arm.
    const candidate = deriveGoalTargetCandidate(
      "goal_1",
      "Reach £30k MRR Within 18 Months",
      "We are at £8k MRR and our goal is reaching £30k MRR within 18 months.",
    );
    expect(candidate?.binding).toBe("governed");
    expect(candidate?.unit).toBe("£");
    expect(candidate?.label_span).not.toBe("");
  });

  it("a label naming a figure the brief never states is STILL refused", () => {
    // `quantity_not_attested` must not be swept into the new arm: a figure the
    // model invented is not a reason to ask about the model's invention.
    const candidate = deriveGoalTargetCandidate(
      "goal_1",
      "Reach £99k MRR",
      "We are at £8k MRR and want to grow.",
    );
    expect(candidate?.binding).not.toBe("unlabelled_goal");
  });
});
