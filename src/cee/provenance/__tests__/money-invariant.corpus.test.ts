/**
 * WS-A ITEM 1(b) — THE COMMIT-TIME MONEY INVARIANT, MEASURED AGAINST AN
 * OUTSIDE CORPUS.
 *
 * CLAUDE.md trap 22: a corpus drawn from the author's head cannot see the
 * class the author did not imagine, and a full mutant kit will certify it
 * anyway. So the corpus here is NOT authored: it is the 26 fresh guest
 * sessions captured from deployed staging on 11 August 2026 (CEE `8e3ad91`),
 * three arms over three briefs — the same raw evidence L2B-VARIANCE.md §3.1
 * measured. Every row is a shape the product really emitted.
 *
 * TWO ASSERTIONS, AND BOTH ARE LOAD-BEARING:
 *
 *   (1) THE DETECTION SET IS EXACT, by identity (run + factor id), not a
 *       count. A count would pass while firing on the wrong factors, and
 *       "N warnings" is precisely the shape that hides a false positive
 *       behind a true one (trap 19).
 *   (2) THE SILENT SET IS EXACT TOO. The known gap this invariant does not
 *       close (`D2` `fac_crm_licence_cost` — baseline reconciles at £30,000
 *       while the options lose the brief's £46,000) is pinned as a
 *       KNOWN-DROPPED row. The suite therefore stays green for the RIGHT
 *       reason and REDs if the set grows OR shrinks (trap 22f's honest exit
 *       for a gap that is real).
 *
 * The precision claim is the one that matters most and it is the one a
 * "does it catch the bug" test cannot make: 23 drafted sessions, every
 * currency-denominated brief-stated factor in each, and the invariant must
 * stay SILENT on every faithful encoding. A warning on `A/r1` — a run whose
 * money is exactly right — would be the product crying wolf about the user's
 * own numbers, which is a worse defect than the one being closed.
 */

import { describe, it, expect } from "vitest";

import { detectUnreconciledStatedMagnitudes } from "../money-invariant.js";
import type { NodeV3T, OptionV3T } from "../../../schemas/cee-v3.js";
import { L2B_CAPTURED_RUNS, type CapturedRun } from "./fixtures/l2b-arch-decision-captures.js";

/** Rebuild the committed-graph inputs from one capture, verbatim. */
function inputsFor(capture: CapturedRun) {
  const nodes = (capture.factors ?? []).map((f) => {
    const node: Record<string, unknown> = { id: f.id, kind: "factor", label: f.label };
    if (f.observed_state !== null) node.observed_state = f.observed_state;
    return node as unknown as NodeV3T;
  });
  const options = (capture.options ?? []).map(
    (o) =>
      ({
        id: o.id,
        label: o.label,
        interventions: Object.fromEntries(
          Object.entries(o.interventions).map(([factorId, value]) => [factorId, { value }]),
        ),
        status: "ready",
      }) as unknown as OptionV3T,
  );
  return { nodes, options, briefText: capture.brief };
}

/** Every (arm/run, factor id) the invariant flags across the whole corpus. */
function detectionSet(): string[] {
  const hits: string[] = [];
  for (const capture of L2B_CAPTURED_RUNS) {
    if (!capture.drafted) continue;
    for (const w of detectUnreconciledStatedMagnitudes(inputsFor(capture))) {
      hits.push(`${capture.arm}/${capture.run} ${String(w.affected_node_id)}`);
    }
  }
  return hits.sort();
}

/**
 * The corpus's own count of factors this invariant is ENTITLED to judge: a
 * factor node stamped `brief_extraction`, denominated in £, carrying a
 * positive cap. Derived here from the captures rather than written down, so
 * the "silent on N" claim below cannot quietly become "silent on 2".
 */
function judgeableFactorCount(): number {
  let n = 0;
  for (const capture of L2B_CAPTURED_RUNS) {
    if (!capture.drafted) continue;
    for (const f of capture.factors ?? []) {
      const os = f.observed_state as Record<string, unknown> | null;
      if (os === null) continue;
      if (os.source !== "brief_extraction") continue;
      if (os.unit !== "£") continue;
      if (typeof os.cap !== "number" || !(os.cap > 0)) continue;
      n += 1;
    }
  }
  return n;
}

describe("WS-A 1(b) — the money invariant, over the 2026-08-11 capture corpus", () => {
  it("has a corpus of the size the evidence records (26 sessions, 23 drafted, 3 briefs)", () => {
    // POSITIVE CONTROL ON THE INSTRUMENT ITSELF (trap 13): an absence claim
    // needs proof the probe can see a presence, and a corpus that silently
    // shrank would make every "silent on N" claim below vacuous.
    expect(L2B_CAPTURED_RUNS.length).toBe(26);
    expect(L2B_CAPTURED_RUNS.filter((r) => r.drafted).length).toBe(23);
    expect(new Set(L2B_CAPTURED_RUNS.map((r) => r.brief)).size).toBe(3);
    expect(judgeableFactorCount()).toBe(51);
  });

  it("flags EXACTLY the eight encodings that lost the user's money, named by run and factor", () => {
    // ⚠ THIS LIST IS MEASURED, NOT PREDICTED. The first draft of this test
    // hand-derived five rows from the four runs the author had personally
    // read, and the corpus returned eight — three of them (`D2/r2`, `D2/r4`)
    // in runs the author never opened. That is trap 22 firing in the intended
    // direction: the corpus saw the class the author did not enumerate. The
    // expectation below is the corpus's answer, checked row by row against the
    // capture arithmetic, with the brief's stated £30,000 / £18,000 / £6,000
    // (and £46,000 in the D2 arm) as the reference set:
    //   A/r9  fac_training_cost       cap  6000 → £0 £720 £0 £1,440        (max £1,440 vs £6,000)
    //   D2/r1 fac_switching_cost      cap 25000 → £0 £1,500 £0 £4,500      (max £4,500 vs £18,000)
    //   D2/r1 fac_training_investment cap 10000 → £0 £200 £0 £600          (max £600   vs £6,000)
    //   D2/r2 fac_switching_cost      cap 50000 → £0 £0 £0 £24,000         (£24,000 is stated nowhere)
    //   D2/r3 fac_switching_cost      cap 25000 → £0 £1,750 £0 £4,500
    //   D2/r3 fac_training_investment cap 10000 → £0 £300 £0 £600
    //   D2/r4 fac_switching_cost      cap 25000 → £0 £0 £2,000 £0 £4,500
    //   D2/r4 fac_training_investment cap 10000 → £0 £0 £300 £0 £600
    // Eight flags over 51 judgeable factors across 23 drafted sessions, and
    // every one of them a real loss — see the silence assertions below for the
    // other half of that claim.
    expect(detectionSet()).toEqual([
      "A/r9 fac_training_cost",
      "D2/r1 fac_switching_cost",
      "D2/r1 fac_training_investment",
      "D2/r2 fac_switching_cost",
      "D2/r3 fac_switching_cost",
      "D2/r3 fac_training_investment",
      "D2/r4 fac_switching_cost",
      "D2/r4 fac_training_investment",
    ]);
  });

  it("stays SILENT on A/r1, whose money is encoded exactly right", () => {
    // The precision half. `fac_switch_cost` 0.75 × 24000 = £18,000 and
    // `fac_training_cost` 0.6 × 10000 = £6,000 — both stated, both faithful,
    // both under a cap that is itself NOT a stated amount. A warning here
    // would be the product doubting the user's own correct numbers.
    const capture = L2B_CAPTURED_RUNS.find((r) => r.arm === "A" && r.run === "r1");
    expect(capture?.drafted).toBe(true);
    expect(detectUnreconciledStatedMagnitudes(inputsFor(capture!))).toEqual([]);
  });

  it("stays SILENT on A/r9's fac_switch_cost while flagging its sibling in the SAME graph", () => {
    // The discriminating pair, inside one run: 0.72 × 25000 = £18,000 is
    // reconciled and must not warn; 0.24 × 6000 = £1,440 is not and must.
    // A guard that warns on "any brief-stated currency factor" passes the
    // previous test and fails this one.
    const capture = L2B_CAPTURED_RUNS.find((r) => r.arm === "A" && r.run === "r9");
    const flagged = detectUnreconciledStatedMagnitudes(inputsFor(capture!)).map(
      (w) => w.affected_node_id,
    );
    expect(flagged).toEqual(["fac_training_cost"]);
  });

  it("KNOWN-DROPPED, pinned exactly: a factor whose BASELINE reconciles hides an option-level loss", () => {
    // THE ONE CLASS THIS INVARIANT CANNOT SEE, named rather than left to be
    // found (trap 22f's honest exit). When the factor's own baseline
    // reproduces one stated magnitude, the invariant is satisfied — and a
    // DIFFERENT stated magnitude lost by the options goes unobserved. Catching
    // it needs a per-intervention binding to the stated amount THAT
    // intervention was derived from, and that identity does not exist on the
    // wire (trap 19: a value predicate another amount could satisfy is not a
    // binding).
    //
    // Two measured instances, both pinned so the set REDs if it grows AND if
    // it silently closes:
    //
    //  (i) D2 `fac_crm_licence_cost` — baseline 0.5 × 60000 = £30,000 (stated)
    //      reconciles, while `opt_switch_hubspot` encodes the brief's £46,000
    //      as 0.46 × 60000 = £27,600.
    for (const run of ["r1", "r3", "r4"]) {
      const capture = L2B_CAPTURED_RUNS.find((r) => r.arm === "D2" && r.run === run)!;
      const licence = (capture.factors ?? []).find((f) => f.id === "fac_crm_licence_cost");
      expect(licence?.observed_state).toMatchObject({
        source: "brief_extraction",
        unit: "£",
        cap: 60000,
      });
      expect(capture.brief).toContain("£46,000");
      expect(
        detectUnreconciledStatedMagnitudes(inputsFor(capture)).map((w) => w.affected_node_id),
      ).not.toContain("fac_crm_licence_cost");
    }

    //  (ii) D1/r8 — L2B-VARIANCE.md §3.1's 5×-overstated run. BOTH baselines
    //      are faithful (0.6 × 30000 = £18,000; 0.2 × 30000 = £6,000) while
    //      the full-switch option encodes £30,000 for both. Silent here, and
    //      that silence is the gap, not a bug in the arithmetic.
    const d1r8 = L2B_CAPTURED_RUNS.find((r) => r.arm === "D1" && r.run === "r8")!;
    expect(d1r8.drafted).toBe(true);
    expect(detectUnreconciledStatedMagnitudes(inputsFor(d1r8))).toEqual([]);
  });

  it("never fabricates: no brief, no stated amounts, or a currency the brief never uses ⇒ no warning", () => {
    const capture = L2B_CAPTURED_RUNS.find((r) => r.arm === "A" && r.run === "r9")!;
    const base = inputsFor(capture);
    expect(detectUnreconciledStatedMagnitudes({ ...base, briefText: undefined })).toEqual([]);
    expect(detectUnreconciledStatedMagnitudes({ ...base, briefText: "   " })).toEqual([]);
    expect(
      detectUnreconciledStatedMagnitudes({ ...base, briefText: "no numbers here at all" }),
    ).toEqual([]);
    // A currency the brief never uses: the question has no true answer, so
    // the honest output is silence rather than a warning about a mismatch we
    // cannot establish.
    expect(
      detectUnreconciledStatedMagnitudes({
        ...base,
        briefText: "training would cost roughly €6,000 and switching €18,000",
      }),
    ).toEqual([]);
  });

  it("carries a machine-readable disclosure that names the factor and both magnitude sets", () => {
    const capture = L2B_CAPTURED_RUNS.find((r) => r.arm === "A" && r.run === "r9")!;
    const [warning] = detectUnreconciledStatedMagnitudes(inputsFor(capture));
    expect(warning?.code).toBe("STATED_MAGNITUDE_UNRECONCILED");
    expect(warning?.severity).toBe("warn");
    expect(warning?.affected_node_id).toBe("fac_training_cost");
    expect(warning?.details).toMatchObject({
      factor_id: "fac_training_cost",
      unit: "£",
      cap: 6000,
      encoded_magnitudes: [0, 720, 0, 1440],
      stated_magnitudes_in_currency: [30_000, 18_000, 6_000],
    });
    // The copy states the observation, never a verdict on the user.
    expect(warning?.message).toContain("Staff Training Cost");
    expect(warning?.message).toContain("£1,440");
    expect(warning?.message).toContain("£6,000");
    expect(warning?.message).not.toMatch(/\brecommend/i);
  });
});

/**
 * ⚠ HAND-BUILT, AND THE REASON IS THE FINDING (CLAUDE.md trap 12d: check what
 * your corpus EXCLUDES, not what it covers).
 *
 * The mutation kit measured two of this detector's gates as UNGUARDED by the
 * capture corpus: deleting the `source === "brief_extraction"` gate, and
 * deleting the currency gate, each left all seven corpus assertions GREEN. The
 * cause is a real property of the corpus rather than a weak test — in all 26
 * captured sessions the two gates are CO-EXTENSIVE: every currency-denominated
 * capped factor happens to be `brief_extraction`, and every `cee_inference`
 * factor happens to carry a non-currency unit ("scale"). A corpus in which two
 * conditions never disagree cannot tell you which one is doing the work, and
 * the surviving gate would be deleted by the next tidy-up with nothing red.
 *
 * The graphs below are therefore AUTHORED, deliberately, to supply exactly the
 * two classes the captures omit. They are the only authored fixtures in this
 * file and they claim nothing about what the product emits — only about which
 * gate governs which case.
 */
describe("WS-A 1(b) — the gates the capture corpus cannot discriminate", () => {
  const BRIEF = "switching would cost roughly £18,000 one-off, plus around £6,000 of training";

  function graph(observed: Record<string, unknown>, level: number) {
    return {
      nodes: [
        { id: "fac_under_test", kind: "factor", label: "Factor Under Test", observed_state: observed },
      ] as unknown as NodeV3T[],
      options: [
        {
          id: "opt_a",
          label: "Option A",
          status: "ready",
          interventions: { fac_under_test: { value: level } },
        },
      ] as unknown as OptionV3T[],
      briefText: BRIEF,
    };
  }

  it("judges a brief_extraction £ factor — the positive control for both gates", () => {
    // 0.24 × 6000 = £1,440, which the brief does not state. Without this
    // firing, the two silences below prove nothing (trap 13: an absence
    // assertion needs a demonstrated presence).
    const flagged = detectUnreconciledStatedMagnitudes(
      graph({ value: 0, unit: "£", cap: 6000, source: "brief_extraction" }, 0.24),
    );
    expect(flagged.map((w) => w.affected_node_id)).toEqual(["fac_under_test"]);
  });

  it("does NOT judge the same £ encoding when CEE inferred it rather than reading it from the brief", () => {
    // The `brief_extraction` gate, alone and visible. CEE never claimed this
    // magnitude came from the user, so there is no claim to audit and a
    // warning would be an accusation about a value nobody attributed to them.
    expect(
      detectUnreconciledStatedMagnitudes(
        graph({ value: 0, unit: "£", cap: 6000, source: "cee_inference" }, 0.24),
      ),
    ).toEqual([]);
  });

  it("does NOT judge a brief_extraction factor denominated in something that is not money", () => {
    // The currency gate, alone and visible. A "scale" reading of 0.24 × 6000
    // has no denomination to match against the brief's £ amounts, and matching
    // it would re-open the cross-denomination hole `stated-amounts.ts` exists
    // to keep closed.
    expect(
      detectUnreconciledStatedMagnitudes(
        graph({ value: 0, unit: "scale", cap: 6000, source: "brief_extraction" }, 0.24),
      ),
    ).toEqual([]);
    expect(
      detectUnreconciledStatedMagnitudes(
        graph({ value: 0, unit: "%", cap: 100, source: "brief_extraction" }, 0.24),
      ),
    ).toEqual([]);
  });

  it("does NOT judge a brief_extraction £ factor with no usable cap", () => {
    // With no declared denominator the encoding denotes nothing this module
    // can check, so silence is the honest answer rather than a comparison
    // against a level read as though it were a magnitude.
    for (const cap of [undefined, 0, -1, Number.NaN]) {
      expect(
        detectUnreconciledStatedMagnitudes(
          graph({ value: 0, unit: "£", source: "brief_extraction", ...(cap !== undefined && { cap }) }, 0.24),
        ),
        `cap=${String(cap)}`,
      ).toEqual([]);
    }
  });
});
