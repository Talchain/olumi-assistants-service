/**
 * ⛔ KNOWN-WRONG PIN — elicited user magnitudes come back stamped as Olumi's.
 *
 * WHAT THIS FILE ASSERTS: today's behaviour, not the desired behaviour. Every expectation below
 * that reads `provenance === "cee"` is pinning a DEFECT. When this file REDs, the instruction is
 * to INVERT the expectation, not to weaken it.
 *
 * ── WHY IT EXISTS (measured 22 Sep 2026) ──────────────────────────────────────────────────
 * Live PLoT `/v2/run` accepts the current product's graph and refuses an honest one. The reason:
 * all 17 edges PLoT computed on carry `source: "cee_hypothesis"`, reasoning "Model-inferred
 * causal link (records projector)", and 0 of 17 appear anywhere in the user's brief. A model that
 * records causal magnitude as `unknown` instead of inventing one is refused with
 * `NO_EFFECTIVE_PATH_TO_GOAL`. So today's analysis runs on invented numbers.
 *
 * The cheapest honest fix is to ASK the user for the few magnitudes that matter — and the server
 * already can: `POST /assist/v1/elicit-belief` (`routes/assist.v1.elicit-belief.ts:78`, registered
 * `server.ts:32`) accepts `target_type: "edge_weight"` and converts natural language to [0,1].
 *
 * ⛔ But it cannot attribute the result to the user. `ElicitBeliefOutput.provenance` is declared as
 * the TYPE-LEVEL LITERAL `"cee"` (index.ts:29). It is not one return path that forgot — the
 * contract has no way to express "the user said this". So routing elicitation through this seam
 * unchanged converts a number the user typed in their own words into an Olumi estimate, which is
 * the precise failure this workstream exists to remove.
 *
 * ── WHAT A FIX LOOKS LIKE ─────────────────────────────────────────────────────────────────
 * Widen `provenance` to a union (e.g. `"user_stated" | "user_calibration" | "cee"`) and return a
 * user-authored value when the input is the user's own expression, reserving `"cee"` for the
 * module's own inference (the clarification options it generates, which the user did not choose).
 * ⚠ Before changing it, read `DecisionGuideAI/src/canvas/domain/valueProvenance.ts:125-145` — a
 * byte-read ledger of every `observed_state.source` literal any producer writes. It also records
 * that CEE writes `user_override` for BOTH "confirm as is" and "type a new value", collapsing two
 * different acts; a fix here should not add a fourth spelling to that set.
 *
 * Full evidence: output/model-gen-20260921/DECISION-MEMO.md
 */
import { describe, it, expect } from "vitest";
import { elicitBelief, type ElicitBeliefInput } from "../../src/cee/belief-elicitation/index.js";

const base: Omit<ElicitBeliefInput, "user_expression" | "target_type"> = {
  node_id: "n1",
  node_label: "Monthly churn rate",
};

describe("elicit-belief provenance (KNOWN-WRONG PIN)", () => {
  it("⛔ stamps a value the USER stated in their own words as Olumi's", () => {
    const out = elicitBelief({ ...base, user_expression: "about 70%", target_type: "prior" });

    // The conversion itself is correct and is NOT the defect — pinned so a fix cannot
    // quietly break it while changing authorship.
    expect(out.suggested_value).toBeCloseTo(0.7, 5);
    expect(out.confidence).toBe("high");
    expect(out.needs_clarification).toBe(false);

    // ⛔ THE DEFECT. The user said "about 70%". It comes back as Olumi's estimate.
    expect(out.provenance).toBe("cee");
  });

  it("⛔ does the same for an edge weight — the target type route 1 needs", () => {
    const out = elicitBelief({
      ...base,
      user_expression: "pretty likely",
      target_type: "edge_weight",
    });

    expect(out.suggested_value).toBeGreaterThan(0);
    expect(out.suggested_value).toBeLessThanOrEqual(1);
    // ⛔ Same defect on the branch that would carry elicited CAUSAL MAGNITUDES — the numbers
    // PLoT currently invents 17 at a time.
    expect(out.provenance).toBe("cee");
  });

  it("⛔ the stamp does not vary with how directly the user stated the value", () => {
    // DISCRIMINATING PAIR. One expression is an unambiguous user-stated quantity; the other is
    // vague enough that the module has to offer its own options. Those are different epistemic
    // situations — the first is the user's number, the second is Olumi's menu — and the contract
    // gives them the SAME provenance. If a fix makes only one of these change, that is progress;
    // if neither changes, nothing was fixed.
    const explicit = elicitBelief({ ...base, user_expression: "3 in 4", target_type: "prior" });
    const vague = elicitBelief({ ...base, user_expression: "fairly high", target_type: "prior" });

    expect(explicit.suggested_value).toBeCloseTo(0.75, 5);
    expect(explicit.needs_clarification).toBe(false);

    // The two cases genuinely differ in every way EXCEPT authorship, which is the point.
    expect(vague.needs_clarification).not.toBe(explicit.needs_clarification);

    expect(explicit.provenance).toBe("cee");
    expect(vague.provenance).toBe("cee");
  });

  it("⛔ the type itself admits no user-authored value (the fix is a contract change)", () => {
    // Exercised over a spread of inputs rather than asserted about one call, so the claim is
    // about the CONTRACT and not about a branch that happens to be reachable.
    const expressions = [
      "about 70%",
      "3 in 4",
      "50-50",
      "very likely",
      "I'd say probably around 30%",
      "no idea",
    ];
    const stamps = new Set(
      expressions.map(
        (e) => elicitBelief({ ...base, user_expression: e, target_type: "prior" }).provenance,
      ),
    );

    // ⛔ ONE value across every input the module accepts. Not a branch that forgot — a contract
    // with no way to say "the user said this".
    expect([...stamps]).toEqual(["cee"]);
  });
});
