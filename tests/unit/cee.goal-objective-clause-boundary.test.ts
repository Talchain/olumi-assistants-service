/**
 * WHERE DOES THE OBJECTIVE CLAUSE END?
 *
 * ⭐ THE LIVE DEFECT THIS PINS. A 15-journey battery captured a real run whose
 * objective node read:
 *
 *     "Bring first-response time back under four hours without going over budget"
 *
 * The budget CONSTRAINT had been swallowed into the OBJECTIVE, so the analysis
 * optimised for a compound thing the user never set as their goal. Root cause is
 * `inferGoalFromBrief`'s lazy capture, bounded only by sentence end:
 *
 *     /(?:I |we )?want to (.+?)(?:\.|,|$)/i
 *
 * With no comma and no full stop before the trailing clause, `(.+?)` runs to `$`
 * and takes the qualifier with it.
 *
 * ⚠ THIS IS A STRUCTURAL QUESTION, NOT A SEMANTIC ONE, AND THAT DISTINCTION IS
 * WHY THIS LANE COULD SHIP WHERE PR #1214 COULD NOT. #1214 asked *"is this span a
 * limit or an objective?"* — a judgement about MEANING, and a sibling proved by
 * execution that the identical quote is an objective in one brief and a
 * constraint in another with byte-identical inputs. Unwinnable at the span level.
 * This file asks only *"where does the objective clause END?"* — a boundary
 * question about clause structure. `want to X without Y`, `achieve X while
 * keeping Y`: in each the objective is X and the trailing clause qualifies it,
 * regardless of what X and Y MEAN.
 *
 * ⭐⭐ THE OPPOSITE-DIRECTION TWIN IS MANDATORY IN THIS FILE (CLAUDE.md trap 22b).
 * Two harms sit under one predicate and they CANNOT share one window:
 *   - trimming too little  → a constraint is swallowed into the objective (the
 *     live defect: the model optimises for the wrong thing);
 *   - trimming too much    → a legitimate objective is TRUNCATED, and a truncated
 *     objective reads as a complete one, which is worse than the original.
 * Every case below therefore carries its twin. A corpus that tests one direction
 * is a guard watching one door.
 *
 * ⭐ THE CORPUS CAME FROM OUTSIDE THE AUTHOR'S HEAD (trap 22). The governed
 * briefs in `tools/graph-evaluator/briefs/` supplied four independent instances
 * of this class — 02, 04, 09 and 12 — none of which the author invented. A
 * corpus drawn from the author's head cannot see the class the author did not
 * imagine, and a 25/25 mutant kit will happily certify it.
 */

import { describe, it, expect } from "vitest";
import {
  inferGoalFromBrief,
  TRAILING_QUALIFIER_CONNECTIVES,
} from "../../src/cee/structure/goal-inference.js";

describe("goal inference — objective clause boundary", () => {
  describe("the witnessed live case", () => {
    /**
     * RED-first signature at pristine:
     *   expected 'Bring first-response time back under four hours without going
     *   over budget' to be 'Bring first-response time back under four hours'
     */
    it("does not swallow a trailing 'without' constraint into the objective", () => {
      const brief =
        "Our support queue has degraded badly this quarter. We want to bring first-response time back under four hours without going over budget.";

      const result = inferGoalFromBrief(brief);

      expect(result.source).toBe("brief");
      expect(result.label).toBe("Bring first-response time back under four hours");
      // Bind by IDENTITY of the excluded span, not by a length predicate that
      // any shorter string would satisfy (trap 19).
      expect(result.label).not.toContain("budget");
      expect(result.label).not.toContain("without");
    });
  });

  /**
   * ⭐ THE FOUR GOVERNED-BRIEF INSTANCES. These are lifted verbatim from
   * `tools/graph-evaluator/briefs/` — real briefs, not authored for this suite.
   * Each asserts the objective that SURVIVES and the qualifier that is CUT, so a
   * fix that trims the wrong amount fails on a named string rather than on a
   * length.
   */
  describe("governed-brief corpus — the qualifier is cut, the objective survives", () => {
    it.each([
      {
        brief: "02-multi-option-constrained",
        text: "We need to achieve 15% revenue growth within 18 months while keeping total expansion costs below £2M.",
        label: "15% revenue growth within 18 months",
        cut: "expansion costs",
      },
      {
        brief: "04-conflicting-constraints",
        text: "The board wants us to achieve 3x user growth this year while simultaneously cutting our burn rate by 30%.",
        label: "3x user growth this year",
        cut: "burn rate",
      },
      {
        brief: "09-nested-subdecision",
        text: "We need to reduce our cost-per-delivery below £7 within 12 months while maintaining our 98% on-time rate.",
        label: "Our cost-per-delivery below £7 within 12 months",
        cut: "on-time rate",
      },
      {
        brief: "12-similar-options",
        text: "We need to increase MRR from £215k to £250k within 6 months without pushing churn above 5%.",
        label: "MRR from £215k to £250k within 6 months",
        cut: "churn",
      },
    ])("$brief: keeps the objective, drops the qualifier", ({ text, label, cut }) => {
      const result = inferGoalFromBrief(text);
      expect(result.source).toBe("brief");
      expect(result.label).toBe(label);
      expect(result.label).not.toContain(cut);
    });
  });

  /**
   * ⭐⭐ THE OPPOSITE-DIRECTION TWINS. Every one of these contains a preposition
   * or connective INSIDE a legitimate objective. If the boundary predicate is too
   * wide, these truncate — and a truncated objective is the more dangerous harm,
   * because it reads as complete. All three named cases from the lane brief are
   * here, plus the adversarial pair that DECIDED the connective set by
   * measurement (see the KNOWN-UNHANDLED block below).
   */
  describe("opposite direction — a legitimate objective is NEVER truncated", () => {
    it.each([
      { name: "preposition 'per' inside the objective", text: "We want to reduce cost per delivery", label: "Cost per delivery" },
      { name: "'by N%' is part of the objective", text: "We want to cut carbon emissions by 40%", label: "Cut carbon emissions by 40%" },
      { name: "co-equal objectives joined by 'and'", text: "We want to grow revenue and cut churn", label: "Grow revenue and cut churn" },
      { name: "a deadline is part of the objective", text: "We want to reach £25M GMV within 18 months", label: "Reach £25M GMV within 18 months" },
      { name: "'nothing but' is not a qualifier boundary", text: "We want to eliminate nothing but waste", label: "Eliminate nothing but waste" },
      { name: "'all but' is not a qualifier boundary", text: "We want to cut all but essential spend", label: "Cut all but essential spend" },
    ])("$name", ({ text, label }) => {
      const result = inferGoalFromBrief(text);
      expect(result.source).toBe("brief");
      expect(result.label).toBe(label);
    });

    it("leaves a brief with no trailing qualifier byte-identical", () => {
      // 03-vague-underspecified, verbatim.
      const result = inferGoalFromBrief(
        "We need to figure out our hiring strategy for next quarter."
      );
      expect(result.label).toBe("Figure out our hiring strategy for next quarter");
    });
  });

  /**
   * ⭐ THE DERIVED GUARD ON THE LIST ITSELF (CLAUDE.md trap 12d).
   *
   * The behavioural cases above prove the connectives we HAVE are handled. They
   * are structurally blind to a member that was never added — deriving a guard
   * from a list MOVES the risk, it does not remove it. This assertion pins the
   * list EXACTLY, so it REDs if the set GROWS or SHRINKS, and the KNOWN-UNHANDLED
   * block below records what was deliberately left out and why. A gap recorded in
   * the suite is honest; a gap invisible to it is how four rounds happen.
   */
  it("pins the trailing-qualifier connective set exactly", () => {
    expect([...TRAILING_QUALIFIER_CONNECTIVES]).toEqual(["without", "while", "whilst"]);
  });

  /**
   * ⛔⛔ KNOWN-UNHANDLED — DELIBERATE, MEASURED, AND PINNED.
   *
   * Each of these was RUN before being excluded. They are not oversights, and the
   * assertions below hold them at their PRISTINE behaviour so that anyone adding
   * them to the connective set gets a RED here rather than a silent regression on
   * the opposite-direction twins.
   *
   * 1. `but` — REJECTED BY MEASUREMENT. It bought nothing on any real corpus
   *    brief and broke two adversarial cases: "eliminate nothing but waste" →
   *    "Eliminate nothing", "cut all but essential spend" → "Cut all". `but` is
   *    both a coordinator ("X but keep Y below Z") and half of a quantifier
   *    idiom ("nothing but", "all but"), and there is no structural discriminator
   *    between them at this layer. This is trap 22f's "genuinely ambiguous"
   *    condition: the exit is to leave it, not to add a length constant.
   *
   * 2. `and` — REJECTED. It drops a CO-EQUAL objective ("grow revenue and cut
   *    churn" → "Grow revenue"). `", and"` is the exact predicate on which this
   *    estate lost four consecutive rounds (CLAUDE.md trap 22f). Not reopened.
   *
   * 3. `within` / `so that` — REJECTED. A deadline is part of the objective's
   *    specification, not a constraint on it. Adding `within` re-truncates four
   *    of the very governed briefs this fix repairs (02, 09, 11, 12) — measured,
   *    not assumed.
   *
   * 4. The decimal-truncation defect in `06-operations-warehouse` — "reduce
   *    errors to 0.3%" yields the label "Errors to 0", because the patterns'
   *    `(?:\.|,|$)` terminator cuts at the DECIMAL POINT. This is CLAUDE.md trap
   *    22's exact shape and it is a DIFFERENT seam (the terminator, not the
   *    clause boundary). It is NOT fixed here and is pinned at its current
   *    behaviour so it cannot regress further unnoticed.
   */
  describe("KNOWN-UNHANDLED (pinned at pristine behaviour — see block comment)", () => {
    it.each([
      { why: "'but' is ambiguous: coordinator vs quantifier idiom", text: "We want to hit 95% uptime but keep spend below £10k", label: "Hit 95% uptime but keep spend below £10k" },
      { why: "'and' joins co-equal objectives", text: "We want to grow revenue and cut churn", label: "Grow revenue and cut churn" },
      { why: "'within' introduces a deadline, not a constraint", text: "We want to reach £25M GMV within 18 months", label: "Reach £25M GMV within 18 months" },
    ])("leaves untouched: $why", ({ text, label }) => {
      expect(inferGoalFromBrief(text).label).toBe(label);
    });

    it("does NOT fix the decimal-point terminator defect (different seam, 06-operations-warehouse)", () => {
      const result = inferGoalFromBrief(
        "We're evaluating whether to invest £800k in robotic picking systems that promise to reduce errors to 0.3% and increase throughput by 40%."
      );
      // Pinned, not blessed. If this ever changes, it should change deliberately.
      expect(result.label).toBe("Errors to 0");
    });
  });

  /**
   * The conservative fallback. Trimming must never manufacture a stub: if cutting
   * at the connective leaves nothing viable, the untrimmed text stands. This is
   * the module's own existing 5-character floor, not a new invented constant.
   */
  it("keeps the untrimmed text when trimming would leave no viable objective", () => {
    const result = inferGoalFromBrief("We want to win without spending anything at all");
    expect(result.label).toBe("Win without spending anything at all");
  });
});
