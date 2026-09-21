/**
 * THE HARNESS MUST BE ABLE TO FAIL — and every check in it must be able to do
 * BOTH things.
 *
 * A quality rubric is an absence probe wearing a score: it reports "this draft
 * is fine" by finding nothing. This estate has shipped that shape before — a
 * leak test that captured 0 bytes and therefore passed every assertion by
 * testing nothing. The defence here is three-layered, and each layer catches a
 * failure the others cannot:
 *
 *  1. TWO CONTROLS, OPPOSITE DIRECTIONS. A hand-built terrible draft must score
 *     badly; a REAL known-good capture must score well. One alone proves
 *     nothing — a rubric that fails everything and one that passes everything
 *     both satisfy a single-sided control.
 *
 *  2. PER-CHECK DISCRIMINATION. Every check must be OBSERVED passing on at
 *     least one input and failing on at least one input, across the whole
 *     control set. A check that can only ever return one answer is not
 *     measuring; it is decoration that raises or lowers the headline by a fixed
 *     amount. This is the layer that catches a predicate reading a field that
 *     does not exist — the field's absence makes it uniformly one answer, and
 *     uniformity across inputs that ought to differ is evidence about the
 *     instrument, not the world.
 *
 *  3. DISCRIMINATING REPAIR PAIRS. For each defect the terrible draft carries,
 *     a repair that fixes EXACTLY that defect must flip EXACTLY that check to
 *     pass, and must not turn any passing check into a failing one. A single
 *     biting assertion proves sensitivity to *something*; the pair proves
 *     sensitivity to *the named defect*. This is what stops a check binding to
 *     the wrong object.
 *
 * ⚠ The pinned control figures below are MEASURED, not aspirational. The
 * positive control is a real draft and is NOT perfect — it fails the
 * repair-burden check. Pinning it at "perfect" would guarantee a re-pin the
 * first time reality disagreed, which is how a control decays into a tautology.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { evaluateDraft } from "../runner.js";
import { scoreDraft, numeralAppearsInBrief, nodeIdFromValidatorPath } from "../rubric.js";
import { TERRIBLE_DRAFT, TERRIBLE_DRAFT_BRIEF, KNOWN_GOOD_GRAPH_PATH } from "../controls.js";
import { DEFAULT_GOAL_LABEL } from "../../../src/cee/structure/goal-inference.js";

type Graph = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[]; version?: string };

const clone = (): Graph => JSON.parse(JSON.stringify(TERRIBLE_DRAFT)) as Graph;
const nodeById = (g: Graph, id: string) => g.nodes.find((n) => n.id === id)!;

function scoreTerrible(mutate?: (g: Graph) => void) {
  const g = clone();
  mutate?.(g);
  return evaluateDraft({
    briefId: "control-terrible",
    graph: g,
    briefText: TERRIBLE_DRAFT_BRIEF,
    expectStatusQuo: false,
  });
}

function verdictMap(score: ReturnType<typeof evaluateDraft>) {
  return new Map(score.checks.map((c) => [c.id, c.passed]));
}

/**
 * ⭐ THE REPAIR TABLE — one entry per defect the terrible draft carries on
 * purpose. Each `repair` fixes exactly one thing, and the test asserts the
 * named check flips fail → pass.
 *
 * `alsoFlips` records the checks a repair UNAVOIDABLY drags with it (adding the
 * goal every chain was missing necessarily fixes connectivity too). Recording
 * the coupling explicitly means a future change to it goes RED rather than
 * passing quietly under a looser assertion.
 */
const REPAIRS: { check: string; describe: string; repair: (g: Graph) => void; alsoFlips?: string[] }[] = [
  {
    check: "D1.1-exactly-one-goal",
    describe: "drop the second goal node instead of joining the two labels",
    repair: (g) => { g.nodes = g.nodes.filter((n) => n.id !== "goal_2"); },
    alsoFlips: ["D1.3-no-compound-goal-prefix"],
  },
  {
    check: "D1.2-goal-label-not-verbatim-quote",
    describe: "author the goal label; keep the verbatim quote as provenance",
    repair: (g) => {
      (nodeById(g, "goal_1") as { label: string }).label = "Grow Delivery Capacity Without Losing Margin";
      (nodeById(g, "goal_2") as { label: string }).label = "Hold Headcount Flat";
    },
    alsoFlips: ["D1.3-no-compound-goal-prefix"],
  },
  {
    check: "D1.4-decision-label-authored",
    describe: 'replace the hardcoded "Decision" literal with an authored contrastive framing',
    repair: (g) => { (nodeById(g, "dec_1") as { label: string }).label = "Hire Now vs Wait Six Months"; },
  },
  {
    check: "D2.1-every-valued-factor-is-interpretable",
    describe: "give the bare unit-interval factor a unit",
    repair: (g) => { (nodeById(g, "fac_1").data as Record<string, unknown>).unit = "story points/sprint"; },
  },
  {
    check: "D3.1-at-least-one-authored-risk",
    describe: "name the downside a risk instead of leaving it unsaid",
    repair: (g) => {
      g.nodes.push({ id: "risk_1", kind: "risk", label: "Onboarding Drag", provenance: { provenance_class: "ai_inferred" } });
      g.edges.push({ id: "e_r", from: "fac_1", to: "risk_1" });
    },
  },
  {
    check: "D4.2-option-labels-authored",
    describe: "author every option label",
    repair: (g) => {
      (nodeById(g, "opt_1") as { label: string }).label = "Hire Two Mid-Level Developers";
      (nodeById(g, "opt_2") as { label: string }).label = "Hire One Senior Developer";
      (nodeById(g, "opt_3") as { label: string }).label = "Keep Current Team (Status Quo)";
    },
    alsoFlips: ["D4.3-option-labels-distinct", "D4.5-status-quo-label-compliant"],
  },
  {
    check: "D4.3-option-labels-distinct",
    describe: "make the two colliding option labels genuinely different",
    repair: (g) => { (nodeById(g, "opt_2") as { label: string }).label = "wait six months"; },
  },
  {
    check: "D4.4-status-quo-matches-the-brief",
    describe: "this brief expects no status quo — do not mint one",
    repair: (g) => { (nodeById(g, "opt_3") as { is_baseline: boolean }).is_baseline = false; },
    // With no is_baseline option left there is nothing for D4.5 to judge, so it
    // becomes UNEVALUABLE. That is a flip out of `false`, and it is expected.
    alsoFlips: ["D4.5-status-quo-label-compliant"],
  },
  {
    check: "D4.5-status-quo-label-compliant",
    describe: 'the served prompt mandates the label contain "Status Quo"',
    repair: (g) => { (nodeById(g, "opt_3") as { label: string }).label = "Keep Current Team (Status Quo)"; },
  },
  {
    check: "D5.1-no-orphan-nodes",
    describe: "connect everything, or do not emit it",
    repair: (g) => {
      g.nodes = g.nodes.filter((n) => n.id !== "fac_orphan" && n.id !== "goal_2");
      g.edges.push({ id: "e_g1", from: "out_1", to: "goal_1" }, { id: "e_f2", from: "fac_2", to: "fac_1" });
    },
    // ⚠ MEASURED, not assumed: removing the orphans does NOT clear D5.2. The
    // remaining chains still do not reach the goal, so the connectivity check
    // stays red — orphan-freedom and reachability are different properties and
    // this pair is the proof they are not the same check twice.
    alsoFlips: ["D1.1-exactly-one-goal", "D1.3-no-compound-goal-prefix"],
  },
  {
    check: "D8.1-no-numeral-badged-as-the-users-is-absent-from-the-brief",
    describe: "quote back the figure the user actually gave",
    repair: (g) => { (nodeById(g, "fac_2").data as Record<string, unknown>).raw_value = 250000; },
  },
];

describe("draft-quality rubric — the controls that make it evidence", () => {
  const terrible = scoreTerrible();
  const goodRaw = JSON.parse(readFileSync(KNOWN_GOOD_GRAPH_PATH, "utf8"));
  const good = evaluateDraft({
    briefId: "control-live-4day-week",
    graph: goodRaw.graph ?? goodRaw,
  });

  it("NEGATIVE CONTROL: the deliberately terrible draft scores badly", () => {
    // MEASURED at the tip this test was written against. If a rubric change
    // moves this, that is a finding to report, not a number to re-pin quietly.
    expect(terrible.checksApplicable).toBe(18);
    expect(terrible.checksPassed).toBe(4);
    expect(terrible.checksPassed / terrible.checksApplicable).toBeLessThan(0.25);
  });

  it("POSITIVE CONTROL: a real captured draft scores well on the same rubric", () => {
    // `live-4day-week.cold-read.json` — the estate's own pre-cutover capture,
    // named by MODEL-QUALITY-BAR §1 Q2 as the positive control the corpus
    // already contains.
    expect(good.checksApplicable).toBe(13);
    expect(good.checksPassed).toBe(12);
    expect(good.checksPassed / good.checksApplicable).toBeGreaterThan(0.85);
  });

  it("the two controls are SEPARATED — a rubric that cannot tell them apart is not measuring", () => {
    const badRate = terrible.checksPassed / terrible.checksApplicable;
    const goodRate = good.checksPassed / good.checksApplicable;
    expect(goodRate - badRate).toBeGreaterThan(0.5);
  });

  it("the positive control is NOT pinned as perfect — it fails repair burden, and that is recorded", () => {
    // A control pinned at 100% gets re-pinned the moment reality disagrees.
    // This asserts the ONE thing it genuinely fails, by identity.
    const failing = good.checks.filter((c) => c.passed === false).map((c) => c.id);
    expect(failing).toEqual(["D7.1-draft-creates-no-blocking-repair"]);
  });

  it("UNEVALUABLE is never silently scored as a pass", () => {
    // The flattened wire shape carries no `source_quote`, so the label-vs-quote
    // checks have nothing to compare. They must say so.
    const m = verdictMap(good);
    expect(m.get("D1.2-goal-label-not-verbatim-quote")).toBeNull();
    expect(m.get("D4.2-option-labels-authored")).toBeNull();
    expect(good.checksUnevaluable).toBe(5);
    // …and an unevaluable check is excluded from the denominator, so it cannot
    // inflate the rate either.
    expect(good.checksApplicable).toBe(good.checks.length - good.checksUnevaluable);
  });
});

describe("draft-quality rubric — discriminating repair pairs", () => {
  const base = scoreTerrible();
  const baseMap = verdictMap(base);

  for (const entry of REPAIRS) {
    it(`${entry.check} binds to its own defect: ${entry.describe}`, () => {
      // The defect must be present to begin with, or the repair proves nothing.
      expect(baseMap.get(entry.check)).toBe(false);

      const after = scoreTerrible(entry.repair);
      const afterMap = verdictMap(after);

      // 1. The named check flips.
      expect(afterMap.get(entry.check)).toBe(true);

      // 2. Nothing that passed is now failing — a repair that breaks another
      //    check means the two are not independent and the coupling is unrecorded.
      const regressions = [...baseMap.entries()]
        .filter(([id, was]) => was === true && afterMap.get(id) === false)
        .map(([id]) => id);
      expect(regressions).toEqual([]);

      // 3. The ONLY other checks that may move are the declared couplings.
      const moved = [...baseMap.entries()]
        .filter(([id, was]) => id !== entry.check && was !== afterMap.get(id))
        .map(([id]) => id)
        .sort();
      expect(moved).toEqual([...(entry.alsoFlips ?? [])].sort());
    });
  }

  it("D4.1-option-count-within-budget fails on both sides of its band", () => {
    // It passes on the terrible draft (3 options), so without this it would be
    // a check never observed failing.
    const tooFew = scoreTerrible((g) => { g.nodes = g.nodes.filter((n) => n.id === "opt_1" || n.kind !== "option"); });
    expect(verdictMap(tooFew).get("D4.1-option-count-within-budget")).toBe(false);

    const tooMany = scoreTerrible((g) => {
      for (let i = 0; i < 5; i++) {
        g.nodes.push({ id: `opt_x${i}`, kind: "option", label: `Extra Option ${i}`, is_baseline: false });
        g.edges.push({ id: `e_x${i}`, from: "dec_1", to: `opt_x${i}` });
      }
    });
    expect(verdictMap(tooMany).get("D4.1-option-count-within-budget")).toBe(false);
  });

  it("D6.1-graph-reaches-a-viable-spine fails on a model too small to be a decision", () => {
    const tiny = scoreDraft({ briefId: "tiny", graph: { nodes: [{ id: "a", kind: "goal" }], edges: [] } });
    expect(verdictMap(tiny as never).get("D6.1-graph-reaches-a-viable-spine")).toBe(false);
  });

  it("D7.2 fails when a mandatory value ask lands on structure the SYSTEM invented (P6)", () => {
    // The check passes on the terrible draft, so it needs an input that trips
    // it or it is never observed failing. A controllable factor the PROJECTOR
    // minted, missing its data, is exactly the P6 harm: the product asking the
    // user to fill in its own invention.
    const p6 = scoreTerrible((g) => {
      g.nodes.push({
        id: "fac_synthetic",
        kind: "factor",
        label: "Machine-Minted Factor",
        provenance: { provenance_class: "projector_structural", source: "synthetic" },
      });
      g.edges.push({ id: "e_p6a", from: "opt_1", to: "fac_synthetic" }, { id: "e_p6b", from: "fac_synthetic", to: "goal_1" });
    });
    expect(verdictMap(p6).get("D7.2-no-mandatory-ask-over-system-inferred-structure")).toBe(false);
  });

  it("D7.1 passes on a graph the validator clears — otherwise it is a check that can only fail", () => {
    const clean = scoreDraft({
      briefId: "clean",
      graph: { nodes: [], edges: [] },
      verdict: { errors: [], warnings: [] },
    });
    expect(verdictMap(clean as never).get("D7.1-draft-creates-no-blocking-repair")).toBe(true);
  });

  it("D5.2 passes when the validator reports no connectivity error", () => {
    const clean = scoreDraft({
      briefId: "clean",
      graph: { nodes: [], edges: [] },
      verdict: { errors: [{ code: "SOMETHING_ELSE" }], warnings: [] },
    });
    expect(verdictMap(clean as never).get("D5.2-no-connectivity-errors")).toBe(true);
  });

  it("D1.5 fails on the machine placeholder goal label, bound to the product's own constant", () => {
    // This is the label the repair sweep mints when the drafted record set
    // produced no goal at all. Imported, not typed as a string, so a reworded
    // placeholder cannot walk past this check.
    const placeholder = scoreDraft({
      briefId: "placeholder-goal",
      graph: { nodes: [{ id: "g", kind: "goal", label: DEFAULT_GOAL_LABEL }], edges: [] },
    });
    expect(verdictMap(placeholder as never).get("D1.5-goal-label-is-not-the-machine-placeholder")).toBe(false);

    // Opposite-direction twin: a real authored goal must NOT trip it.
    const authored = scoreDraft({
      briefId: "authored-goal",
      graph: { nodes: [{ id: "g", kind: "goal", label: "Reach £20m ARR by End of FY28" }], edges: [] },
    });
    expect(verdictMap(authored as never).get("D1.5-goal-label-is-not-the-machine-placeholder")).toBe(true);
  });

  it("D1.3 fails on the `Compound Goal:` literal alone", () => {
    // The literal is the HARD half of Q1b and must bite on its own, not only in
    // company with the other goal defects.
    const only = scoreDraft({
      briefId: "compound-only",
      graph: { nodes: [{ id: "g", kind: "goal", label: "Compound Goal: A + B" }], edges: [] },
    });
    expect(verdictMap(only as never).get("D1.3-no-compound-goal-prefix")).toBe(false);
  });
});

describe("draft-quality rubric — no check is decoration", () => {
  /**
   * ⭐ The layer that catches a predicate reading a field that does not exist.
   * Across the whole control set, EVERY check must have been observed both
   * passing and failing. A check stuck on one answer contributes a constant to
   * the headline and measures nothing — and it looks exactly like a working
   * check until you ask this question.
   */
  it("every check is observed BOTH passing and failing across the control set", () => {
    const goodRaw = JSON.parse(readFileSync(KNOWN_GOOD_GRAPH_PATH, "utf8"));
    const inputs: ReturnType<typeof evaluateDraft>[] = [
      scoreTerrible(),
      evaluateDraft({ briefId: "good", graph: goodRaw.graph ?? goodRaw }),
      ...REPAIRS.map((r) => scoreTerrible(r.repair)),
      scoreTerrible((g) => { g.nodes = g.nodes.filter((n) => n.id === "opt_1" || n.kind !== "option"); }),
      scoreTerrible((g) => {
        g.nodes.push({
          id: "fac_synthetic", kind: "factor", label: "Machine-Minted Factor",
          provenance: { provenance_class: "projector_structural", source: "synthetic" },
        });
        g.edges.push({ id: "e_p6a", from: "opt_1", to: "fac_synthetic" }, { id: "e_p6b", from: "fac_synthetic", to: "goal_1" });
      }),
      scoreDraft({ briefId: "tiny", graph: { nodes: [{ id: "a", kind: "goal" }], edges: [] } }) as never,
      scoreDraft({ briefId: "clean", graph: { nodes: [], edges: [] }, verdict: { errors: [], warnings: [] } }) as never,
      scoreDraft({ briefId: "placeholder-goal", graph: { nodes: [{ id: "g", kind: "goal", label: DEFAULT_GOAL_LABEL }], edges: [] } }) as never,
    ];

    const seen = new Map<string, { pass: boolean; fail: boolean }>();
    for (const s of inputs) {
      for (const c of s.checks) {
        const row = seen.get(c.id) ?? { pass: false, fail: false };
        if (c.passed === true) row.pass = true;
        if (c.passed === false) row.fail = true;
        seen.set(c.id, row);
      }
    }
    const neverPassed = [...seen].filter(([, v]) => !v.pass).map(([id]) => id);
    const neverFailed = [...seen].filter(([, v]) => !v.fail).map(([id]) => id);
    expect({ neverPassed, neverFailed }).toEqual({ neverPassed: [], neverFailed: [] });
    // Guard the guard: if the check set is ever emptied, the two arrays above
    // are trivially empty and this test passes by measuring nothing.
    expect(seen.size).toBe(18);
  });
});

describe("draft-quality rubric — the numeral predicate is generous by design", () => {
  const brief = "We have £4M ARR, 2,000 customers, a 3.5% monthly churn rate and a £250,000 budget.";

  it("recognises ordinary written forms of a stated number", () => {
    expect(numeralAppearsInBrief(4_000_000, brief)).toBe(true); // "£4M"
    expect(numeralAppearsInBrief(2000, brief)).toBe(true); // "2,000" with the comma stripped
    expect(numeralAppearsInBrief(250_000, brief)).toBe(true); // "£250,000"
    expect(numeralAppearsInBrief(0.035, brief)).toBe(true); // "3.5%"
  });

  it("still catches a number the brief never states", () => {
    // Without this, generosity would make the check vacuous.
    expect(numeralAppearsInBrief(987_654, brief)).toBe(false);
    expect(numeralAppearsInBrief(41, brief)).toBe(false);
  });
});

describe("draft-quality rubric — the P6 attribution path", () => {
  it("parses the validator's own node path format, and refuses anything else", () => {
    expect(nodeIdFromValidatorPath("nodesById.fac_1")).toBe("fac_1");
    expect(nodeIdFromValidatorPath("nodes[fac_1]")).toBeUndefined();
    expect(nodeIdFromValidatorPath(undefined)).toBeUndefined();
  });
});
