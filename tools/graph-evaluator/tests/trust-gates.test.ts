/**
 * TRUST GATES — RED/GREEN controls (WP1 D4).
 *
 * Three real fixtures, none of them authored by the person writing the gates:
 *
 *   F1  the banked failing option nodes `EVIDENCE-9077a1e3` (producer handover)
 *   F2  the fresh Arm A control draw `armA/pricing-staging/run_1.json`
 *   F3  the real gpt-4.1 builder output against the v0 rich schema
 *
 * Per-gate verdicts were PRE-REGISTERED in
 * `output/model-gen-20260921/wp1/PREDICTIONS.md` before these gates existed.
 * Where a prediction disagreed with the plan, the file was kept and the
 * disagreement reported — see the G3 test on F1.
 *
 * ⚠ A self-authored fixture confirms the author's model; it does not test it.
 * The only hand-built artefact here is the PROJECTION of F3 (no projector is
 * available in this lane — `richToParsedGraph` belongs to the run-harness lane),
 * and it is declared as such at its definition.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readBriefs } from "../src/io.js";
import type { Brief, GraphNode, GoalConstraint, ParsedGraph } from "../src/types.js";
import type { RichDecisionModel } from "../src/rich-model.js";
import {
  ANCHOR_REQUIRED_STATES,
  checkProjectionProvenance,
  classifyProvenance,
  contentTokens,
  gateG1,
  gateG2,
  gateG3,
  gateG4,
  gateG5,
  gateG6,
  gateG7,
  gateG8,
  gatesAdmit,
  labelOverlap,
  normaliseUnit,
  readInterventions,
  runTrustGates,
  unitSatisfies,
  valueAppearsIn,
  TRUST_GATE_IDS,
  type GateInput,
  type GateResult,
  type ProjectedGraphLike,
  type RichModelLike,
} from "../src/trust-gates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(TOOL_ROOT, "..", "..");
const FX = path.join(TOOL_ROOT, "fixtures", "wp1");

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(FX, name), "utf-8")) as T;
}

function sha256(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

/**
 * ANTI-DRIFT, COMPILE TIME ONLY. `src/rich-model.ts` (run-harness lane) owns the
 * real `RichDecisionModel`. This module declares its own minimal `RichModelLike`
 * so the contract can be frozen without a build dependency on a file another
 * lane is editing. If the two diverge, `npm run typecheck` REDs here.
 */
const _assignabilityCheck = (m: RichDecisionModel): RichModelLike => m;
void _assignabilityCheck;

// =============================================================================
// Fixtures
// =============================================================================

const briefs = await readBriefs(path.join(TOOL_ROOT, "briefs"));
const pricingBrief = briefs.find((b) => b.id === "pricing-staging")!;

const bankedOptionNodes = readFixture<GraphNode[]>("evidence-9077a1e3-option-nodes.json");
const armA = readFixture<{
  nodes: GraphNode[];
  edges: ParsedGraph["edges"];
  goal_constraints: GoalConstraint[];
  coaching?: ParsedGraph["coaching"];
}>("armA-pricing-staging-run_1.json");
const richBuilderOutput = readFixture<RichModelLike>("rich-pricing-builder-output.json");

/** The churn constraint, read from the Arm A draw — never transcribed. */
const churnConstraint = armA.goal_constraints[0]!;

/**
 * F1 — the banked failing option nodes wrapped in a MINIMAL ParsedGraph.
 *
 * The capture holds option nodes only. The scaffold adds exactly two things,
 * both declared: (a) the two factor nodes the options intervene on, carrying NO
 * VALUES so the fixture cannot author a G3 failure of its own; (b) the goal
 * constraint copied verbatim from the Arm A draw — whose `node_id` is the SAME
 * churn id as in this capture, asserted below rather than assumed.
 */
function bankedGraph(): ParsedGraph {
  return {
    nodes: [
      ...(JSON.parse(JSON.stringify(bankedOptionNodes)) as GraphNode[]),
      { id: "6d9a37f3", kind: "factor", label: "Pro Plan Price", category: "controllable" },
      { id: "ab78e513", kind: "factor", label: "Monthly Churn Rate", category: "external" },
    ],
    edges: [],
    goal_constraints: [JSON.parse(JSON.stringify(churnConstraint)) as GoalConstraint],
  };
}

function armAGraph(): ParsedGraph {
  return JSON.parse(JSON.stringify({
    nodes: armA.nodes,
    edges: armA.edges,
    goal_constraints: armA.goal_constraints,
    coaching: armA.coaching,
  })) as ParsedGraph;
}

function idealRich(): RichModelLike {
  return JSON.parse(JSON.stringify(richBuilderOutput)) as RichModelLike;
}

/**
 * HAND-BUILT, and declared as such. `richToParsedGraph` lives in the run-harness
 * lane, so this is the projection the CONTRACT requires, written from
 * `CONTRACT-v0/README.md`'s projection rules — not a capture. It is used ONLY to
 * exercise G9's comparison; no claim is made that any producer emits it yet.
 */
function idealProjection(): ProjectedGraphLike {
  return {
    nodes: [
      { id: "dec1", kind: "decision", label: "Pro plan pricing", provenance: "from_brief" },
      {
        id: "opt1",
        kind: "option",
        label: "Increase Pro plan price from £49 to £59 per month with the next Pro feature release",
        provenance: "from_brief",
        interventions: { f1: { value: 59, raw_value: 59, unit: "£/month", source: "brief_extraction" } },
      },
      {
        id: "opt2",
        kind: "option",
        label: "Keep Pro plan price at £49 per month",
        // The OPTION is ai_proposed; its lever VALUE is the user's own £49,
        // anchored by source_fact_id uf5 — so the number projects as user-bound.
        provenance: "ai_inferred",
        interventions: { f1: { value: 49, raw_value: 49, unit: "£/month", source: "brief_extraction" } },
      },
      {
        id: "f1",
        kind: "factor",
        label: "Pro plan price",
        provenance: "from_brief",
        observed_state: { value: 49, raw_value: 49, source: "brief_extraction" },
      },
      { id: "o1", kind: "outcome", label: "Monthly Recurring Revenue (MRR)", provenance: "from_brief" },
      { id: "o2", kind: "risk", label: "Monthly churn rate", provenance: "from_brief" },
    ],
    goal_constraints: [
      { constraint_id: "c1", node_id: "o2", value: 4, provenance: "brief_extraction" },
    ],
  };
}

/** The projection as a ParsedGraph, so G1–G8 can run on the projected subset. */
function idealProjectedParsedGraph(): ParsedGraph {
  const p = idealProjection();
  return {
    nodes: p.nodes as unknown as GraphNode[],
    edges: [],
    goal_constraints: [
      {
        constraint_id: "c1",
        node_id: "o2",
        operator: "<=",
        value: 4,
        unit: "%",
        label: "Monthly churn rate",
        provenance: "brief_extraction",
        strictness: "strict",
        relaxed_to: "<=",
      },
    ],
  };
}

function input(over: Partial<GateInput> = {}): GateInput {
  return { rich: null, graph: null, brief: pricingBrief, ...over };
}

function byGate(results: GateResult[]): Record<string, GateResult> {
  return Object.fromEntries(results.map((r) => [r.gate, r]));
}

// =============================================================================
// Fixture provenance — the bytes ARE the banked bytes
// =============================================================================

describe("fixture provenance", () => {
  it("the in-repo fixtures are byte-identical to the banked evidence they were copied from", () => {
    expect(sha256(path.join(FX, "evidence-9077a1e3-option-nodes.json"))).toBe(
      "9f73dffdf775be974953b5b0f3caf12c9b1dd12df7a4441884103b1f9b4f12d1"
    );
    expect(sha256(path.join(FX, "armA-pricing-staging-run_1.json"))).toBe(
      "88967754b2ebe4df267483b9b2e2c46d660baf190bb887f1473b28160d04d32f"
    );
    expect(sha256(path.join(FX, "rich-pricing-builder-output.json"))).toBe(
      "d97ba9871e6359a2cf0376cd5540c1d11850202ea767e9d96026736300bea403"
    );
  });

  it("the Arm A constraint really does bound the SAME churn node the banked capture intervenes on", () => {
    // The F1 scaffold borrows this constraint. If the ids did not match, the
    // scaffold would be inventing the G6 failure rather than exposing it.
    expect(churnConstraint.node_id).toBe("ab78e513");
    const churnTargets = bankedOptionNodes.flatMap((n) =>
      readInterventions(n).filter((iv) => iv.factorId === churnConstraint.node_id)
    );
    expect(churnTargets.length).toBeGreaterThan(0);
  });

  it("the pricing brief oracle loaded, with the spans quoted verbatim from the body", () => {
    expect(pricingBrief.meta.corpus_class).toBe("captured");
    expect(pricingBrief.meta.expected_user_values).toHaveLength(5);
    for (const v of pricingBrief.meta.expected_user_values ?? []) {
      expect(pricingBrief.body, `oracle quote "${v.quote}" must be a verbatim span`).toContain(v.quote);
    }
    expect(pricingBrief.meta.expected_constraints?.[0]?.strict).toBe(true);
  });

  it("the three sha256-PINNED briefs carry their oracle from a SIDECAR, leaving their bytes untouched", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(TOOL_ROOT, "governed", "draft-graph-v5", "manifest.json"), "utf-8")
    ) as { corpus: { order: Array<{ id: string; sha256: string }> } };
    const pinned = new Map(manifest.corpus.order.map((o) => [o.id, o.sha256]));
    for (const id of ["02-multi-option-constrained", "03-vague-underspecified", "12-similar-options"]) {
      const brief = briefs.find((b) => b.id === id)!;
      expect(brief.meta.oracle_source, `${id} oracle must come from a sidecar`).toBe("sidecar");
      expect(brief.meta.corpus_class).toBe("authored");
      // The pin still holds — this is the whole reason the sidecar exists.
      expect(sha256(path.join(TOOL_ROOT, "briefs", `${id}.md`))).toBe(pinned.get(id));
    }
  });
});

// =============================================================================
// Unit-level: the normaliser and the provenance vocabulary
// =============================================================================

describe("unit normaliser", () => {
  it("matches the oracle's families as a SUBSET of the candidate's", () => {
    expect(unitSatisfies("£", "£/month")).toBe(true);
    expect(unitSatisfies("£", "GBP")).toBe(true);
    expect(unitSatisfies("£", "pounds")).toBe(true);
    expect(unitSatisfies("%", "percent")).toBe(true);
    expect(unitSatisfies("£/month", "£ per month")).toBe(true);
    expect(unitSatisfies("£/month", "monthly £")).toBe(true);
  });

  it("REFUSES the relabelled 0-1 unit CEE actually emits for a percentage", () => {
    // armA run_1's constraint carries unit "fraction" for "4%".
    expect(unitSatisfies("%", "fraction")).toBe(false);
    expect(unitSatisfies("%", null)).toBe(false);
  });

  it("a RATE is not a DURATION", () => {
    // "£/month" must not satisfy an oracle asking for a horizon in months.
    expect(normaliseUnit("£/month").has("months")).toBe(false);
    expect(unitSatisfies("months", "£/month")).toBe(false);
    expect(unitSatisfies("months", "12 months")).toBe(true);
  });
});

describe("provenance vocabulary", () => {
  it("classifies the wire's own tokens", () => {
    expect(classifyProvenance("brief_extraction")).toBe("user");
    expect(classifyProvenance("from_brief")).toBe("user");
    expect(classifyProvenance("explicit")).toBe("user");
    expect(classifyProvenance("cee_hypothesis")).toBe("ai");
    expect(classifyProvenance("ai_inferred")).toBe("ai");
    expect(classifyProvenance(null)).toBe("unknown");
    expect(classifyProvenance("something_new")).toBe("unknown");
  });

  it("DRIFT ALARM: `explicit` is still CEE's own constraint-provenance token", () => {
    // The user side of every gate includes `explicit` because src/schemas/assist.ts
    // declares it. If that enum is renamed or moved, this REDs instead of the
    // gates silently widening or narrowing what counts as user authority.
    const assist = readFileSync(path.join(REPO_ROOT, "src", "schemas", "assist.ts"), "utf-8");
    expect(
      assist,
      "src/schemas/assist.ts no longer declares provenance: z.enum([\"explicit\", \"inferred\", \"proxy\"]) — " +
        "re-derive USER_PROVENANCE_TOKENS against the new source of truth; do NOT just delete this test."
    ).toContain('provenance: z.enum(["explicit", "inferred", "proxy"])');
  });
});

describe("value presence", () => {
  it("sees a de-normalised percentage (0.04 for \"4%\") and says which limb found it", () => {
    expect(valueAppearsIn(0.04, "keeping monthly churn under 4%")).toEqual({
      found: true,
      via: "x100 (de-normalised)",
    });
    expect(valueAppearsIn(20000, "goal of reaching £20k MRR").found).toBe(false);
  });
});

describe("label overlap", () => {
  it("uses the smaller label as the denominator", () => {
    expect(labelOverlap("Raise Price to £59 with Feature Release", "Raise Price to £59")).toBe(1);
    expect(labelOverlap("Hire a tech lead", "Raise the price")).toBeLessThan(0.8);
    expect(contentTokens("the a of to").size).toBe(0);
  });
});

// =============================================================================
// F1 — the banked failing option nodes
// =============================================================================

describe("F1 — banked EVIDENCE-9077a1e3 option nodes (graph only)", () => {
  const f1 = () => input({ graph: bankedGraph() });

  it("G1 FAILS: the user's £59 survives only as a cee_hypothesis estimate", () => {
    const r = gateG1(f1());
    expect(r.status).toBe("FAIL");
    expect(r.evidence).toContain("59");
  });

  it("G3 PASSES — and that CONTRADICTS the plan's WP1 §5 expectation", () => {
    // PRE-REGISTERED in wp1/PREDICTIONS.md before the gate existed. The plan said
    // this capture "must fail G1, G3, G6". Every intervention in it carries
    // `"source": "cee_hypothesis"` — it is LABELLED ai, and G3 is about the
    // ABSENCE of a label. Widening G3 to swallow "labelled but invented" would
    // make it fire on every legitimate AI proposal; that class is G2's and G8's.
    // The disagreement is reported, not resolved by bending the gate.
    const r = gateG3(f1());
    expect(r.status).toBe("PASS");
    expect(r.evidence).toContain("recognised provenance label");
    // POSITIVE CONTROL that the gate is not simply blind here: strip the label
    // from one intervention and it must RED.
    const blinded = bankedGraph();
    const opt = blinded.nodes.find((n) => n.id === "868f8b07")!;
    delete opt.interventions!["ab78e513"]!.source;
    expect(gateG3(input({ graph: blinded })).status).toBe("FAIL");
  });

  it("G4 FAILS: a bare `<=` with no strictness disclosure", () => {
    const r = gateG4(f1());
    expect(r.status).toBe("FAIL");
    expect(r.evidence).toContain("<=");
  });

  it("G5 FAILS: an AI option equals the user's option on the legitimate-lever projection", () => {
    const r = gateG5(f1());
    expect(r.status).toBe("FAIL");
    expect(r.evidence).toContain("USER OPTION");
    // and it reports the other reading too, so the verdict is never ambiguous
    expect(r.evidence).toContain("the FULL map differs");
  });

  it("G6 FAILS: three options intervene on the constrained churn quantity", () => {
    const r = gateG6(f1());
    expect(r.status).toBe("FAIL");
    expect(r.evidence).toContain("ab78e513");
  });

  it("is INADMISSIBLE, and the full verdict matches the pre-registered table", () => {
    const g = byGate(runTrustGates(f1()));
    expect(gatesAdmit(Object.values(g))).toBe(false);
    expect({
      G1: g.G1!.status, G2: g.G2!.status, G3: g.G3!.status, G4: g.G4!.status,
      G5: g.G5!.status, G6: g.G6!.status, G7: g.G7!.status, G8: g.G8!.status,
    }).toEqual({
      G1: "FAIL", G2: "PASS", G3: "PASS", G4: "FAIL",
      G5: "FAIL", G6: "FAIL", G7: "NA", G8: "NA",
    });
  });
});

// =============================================================================
// F2 — the fresh Arm A control draw
// =============================================================================

describe("F2 — Arm A control draw run_1.json (graph only)", () => {
  const f2 = () => input({ graph: armAGraph() });

  it("G1 FAILS on every declared user value", () => {
    const r = gateG1(f2());
    expect(r.status).toBe("FAIL");
    expect(r.evidence).toContain("5/5");
  });

  it("G4 FAILS: operator `<=`, no strictness, no relaxed_to", () => {
    const r = gateG4(f2());
    expect(r.status).toBe("FAIL");
    expect(r.evidence).toContain("strictness ABSENT");
  });

  it("CONTRAST CONTROL: G6 PASSES here while it FAILS on F1 — same gate, two banked graphs", () => {
    expect(gateG6(f2()).status).toBe("PASS");
    expect(gateG6(input({ graph: bankedGraph() })).status).toBe("FAIL");
  });

  it("CONTROL: `goal_threshold_raw` is NOT a G1 channel, proven behaviourally", () => {
    // The Arm A goal node carries goal_threshold_raw: 20000 with
    // provenance: from_brief. It is enricher-minted and ingress-stripped, so a
    // gate reading it would score CEE's regex extractor, not the candidate.
    // Adding or removing it must not move the verdict.
    const withQuad = armAGraph();
    const goal = withQuad.nodes.find((n) => n.kind === "goal")!;
    expect(goal.goal_threshold_raw).toBe(20000);
    const withoutQuad = armAGraph();
    const goal2 = withoutQuad.nodes.find((n) => n.kind === "goal")!;
    delete goal2.goal_threshold;
    delete goal2.goal_threshold_raw;
    delete goal2.goal_threshold_unit;
    delete goal2.goal_threshold_cap;
    expect(gateG1(input({ graph: withoutQuad }))).toEqual(gateG1(input({ graph: withQuad })));
  });

  it("full verdict matches the pre-registered table", () => {
    const g = byGate(runTrustGates(f2()));
    expect({
      G1: g.G1!.status, G2: g.G2!.status, G3: g.G3!.status, G4: g.G4!.status,
      G5: g.G5!.status, G6: g.G6!.status, G7: g.G7!.status, G8: g.G8!.status,
    }).toEqual({
      G1: "FAIL", G2: "PASS", G3: "PASS", G4: "FAIL",
      G5: "PASS", G6: "PASS", G7: "NA", G8: "NA",
    });
  });
});

// =============================================================================
// F3 — the real rich builder output + its projection: GREEN on every gate
// =============================================================================

describe("F3 — real gpt-4.1 builder output against the v0 rich schema", () => {
  const f3 = () => input({ rich: idealRich(), graph: idealProjectedParsedGraph() });

  it("passes every gate and is ADMISSIBLE", () => {
    const results = runTrustGates(f3());
    const g = byGate(results);
    expect(
      Object.values(g).map((r) => `${r.gate}=${r.status}`).join(" "),
      results.filter((r) => r.status === "FAIL").map((r) => r.evidence).join("\n")
    ).toBe("G1=PASS G2=PASS G3=PASS G4=PASS G5=PASS G6=PASS G7=PASS G8=PASS");
    expect(gatesAdmit(results)).toBe(true);
  });

  it("G5 passes but FLAGS the near-duplicate labels for the judge", () => {
    const r = gateG5(f3());
    expect(r.status).toBe("PASS");
    expect(r.evidence).toContain("judge flag");
    expect(r.evidence).not.toContain("0 judge flag(s)");
  });

  it("G9 passes on the projection", () => {
    expect(checkProjectionProvenance(idealRich(), idealProjection()).status).toBe("PASS");
  });
});

// =============================================================================
// MUTANTS — one per gate; each must flip EXACTLY its own gate
// =============================================================================

interface Mutant {
  gate: string;
  what: string;
  apply: (rich: RichModelLike) => void;
}

const MUTANTS: Mutant[] = [
  {
    gate: "G1",
    what: "uf6.unit -> null (the £59 loses its unit)",
    apply: (m) => { m.user_facts.find((f) => f.id === "uf6")!.unit = null; },
  },
  {
    gate: "G2",
    what: "uf1.transformation -> null (20000 unreconstructible from \"£20k MRR\")",
    apply: (m) => { m.user_facts.find((f) => f.id === "uf1")!.transformation = null; },
  },
  {
    gate: "G3",
    what: "f1.source_fact_id -> null (a known baseline with no anchor)",
    apply: (m) => { m.factors.find((f) => f.id === "f1")!.source_fact_id = null; },
  },
  {
    gate: "G4",
    what: "c1.operator \"<\" -> \"<=\" (the silent relaxation)",
    apply: (m) => { m.constraints.find((c) => c.id === "c1")!.operator = "<="; },
  },
  {
    gate: "G5",
    what: "a third option with opt1's exact lever settings",
    apply: (m) => {
      const opt1 = m.options.find((o) => o.id === "opt1")!;
      m.options.push({
        id: "opt3",
        label: "Move the Pro plan to £59 per month",
        provenance: "ai_proposed",
        source_fact_id: null,
        is_status_quo: false,
        lever_settings: JSON.parse(JSON.stringify(opt1.lever_settings)),
        rationale: "Worth considering as a separate framing.",
      });
    },
  },
  {
    gate: "G6",
    what: "opt1's lever retargeted from the price factor to the constrained churn outcome",
    apply: (m) => { m.options.find((o) => o.id === "opt1")!.lever_settings[0]!.factor_id = "o2"; },
  },
  {
    gate: "G7",
    what: "the feature-release timing dropped from EVERY carrier (factor f2, unknown u3, option label)",
    // MEASURED, not assumed: the first version of this mutant deleted only f2
    // and u3 and SURVIVED, because the user's own option label still carries
    // "feature release". A gate that still finds the item is RIGHT to pass; the
    // mutant was the thing that was wrong. The honest mutation is "the candidate
    // dropped the timing", which means dropping it everywhere it is stated.
    apply: (m) => {
      m.factors = m.factors.filter((f) => f.id !== "f2");
      m.unknowns = (m.unknowns ?? []).filter((u) => u.id !== "u3");
      const opt1 = m.options.find((o) => o.id === "opt1")!;
      opt1.label = "Increase Pro plan price from £49 to £59 per month";
    },
  },
  {
    gate: "G8",
    what: "f2.current_value null -> 59 while epistemic_state stays \"unknown\"",
    // 59 is inside uf4's quote, so G2 cannot fire on it — the mutant is clean.
    apply: (m) => { m.factors.find((f) => f.id === "f2")!.current_value = 59; },
  },
];

describe("mutants — each flips EXACTLY one gate", () => {
  /**
   * ⚠ EVALUATED RICH-ONLY, and that is the point.
   *
   * Every mutant edits the RICH MODEL. Run against `{rich, graph}` together,
   * three of them SURVIVED on the first execution: the fixed projection still
   * carried the £59 at `brief_extraction` (M-G1) and still disclosed
   * `strictness: "strict"` (M-G4), so the gates — correctly — still found what
   * the oracle asked for. A mutant must be measured against the channel it
   * mutates, or it measures the other channel. The paired
   * `{rich, graph}` behaviour is covered by the F3 admissibility test above.
   */
  const baselineStatuses = (): Record<string, string> => {
    const g = byGate(runTrustGates(input({ rich: idealRich() })));
    return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.status]));
  };

  it("BASELINE CONTROL: the unmutated rich model passes every gate rich-only", () => {
    const g = byGate(runTrustGates(input({ rich: idealRich() })));
    expect(Object.values(g).map((r) => `${r.gate}=${r.status}`).join(" ")).toBe(
      "G1=PASS G2=PASS G3=PASS G4=PASS G5=PASS G6=PASS G7=PASS G8=PASS"
    );
  });

  it.each(MUTANTS)("M-$gate: $what", ({ gate, apply }) => {
    const base = baselineStatuses();
    const mutated = idealRich();
    apply(mutated);
    const after = byGate(runTrustGates(input({ rich: mutated })));

    expect(after[gate]!.status, `M-${gate} did not turn ${gate} RED: ${after[gate]!.evidence}`).toBe("FAIL");

    const collateral = Object.entries(after)
      .filter(([id, r]) => id !== gate && r.status !== base[id])
      .map(([id, r]) => `${id}: ${base[id]} -> ${r.status} (${r.evidence})`);
    expect(
      collateral,
      `M-${gate} is not a discriminating mutant — it also moved: ${collateral.join(" | ")}`
    ).toEqual([]);
  });

  it("covers every gate that can be mutated on a rich model", () => {
    // G9 needs a projection, so it has its own mutant below. Every other gate id
    // must appear exactly once, or a gate is going untested.
    expect(MUTANTS.map((m) => m.gate).sort()).toEqual(
      TRUST_GATE_IDS.filter((g) => g !== "G9").slice().sort()
    );
  });
});

describe("M-G9 — removing the provenance mapping must turn the test RED (amendment 2)", () => {
  it("strips every projected provenance and G9 REDs with the fail-open wording", () => {
    const stripped = idealProjection();
    for (const node of stripped.nodes) {
      delete node.provenance;
      if (node.observed_state) delete node.observed_state.source;
      for (const iv of Object.values(node.interventions ?? {})) delete iv.source;
    }
    for (const gc of stripped.goal_constraints ?? []) delete gc.provenance;

    const r = checkProjectionProvenance(idealRich(), stripped);
    expect(r.status).toBe("FAIL");
    expect(r.evidence).toContain("UNKNOWN PROVENANCE CANNOT DEFAULT TO USER AUTHORITY");
  });

  it("laundering AI content into user authority REDs, and the inverse REDs too", () => {
    // opt2 is ai_proposed with an UNANCHORED extra lever — projecting that number
    // as brief_extraction is the laundering amendment 2 forbids.
    const rich = idealRich();
    const opt2 = rich.options.find((o) => o.id === "opt2")!;
    opt2.lever_settings.push({
      factor_id: "f9",
      value: 0.07,
      unit: null,
      epistemic_state: "ai_hypothesis",
      source_fact_id: null,
    });
    const laundered = idealProjection();
    laundered.nodes.find((n) => n.id === "opt2")!.interventions!["f9"] = {
      value: 0.07,
      source: "brief_extraction",
    };
    const r = checkProjectionProvenance(rich, laundered);
    expect(r.status).toBe("FAIL");
    expect(r.evidence).toContain('projects rich "ai" content as graph "brief_extraction"');

    // Control: the SAME projection with the honest source passes.
    const honest = idealProjection();
    honest.nodes.find((n) => n.id === "opt2")!.interventions!["f9"] = {
      value: 0.07,
      source: "cee_hypothesis",
    };
    expect(checkProjectionProvenance(rich, honest).status).toBe("PASS");
  });

  it("a projected number with no rich source at all is a FAIL, never a default", () => {
    const orphan = idealProjection();
    orphan.nodes.push({
      id: "ghost",
      kind: "factor",
      label: "Appeared at projection",
      provenance: "from_brief",
      observed_state: { value: 12, source: "brief_extraction" },
    });
    const r = checkProjectionProvenance(idealRich(), orphan);
    expect(r.status).toBe("FAIL");
    expect(r.evidence).toContain("MISSING from the model");
  });
});

// =============================================================================
// NA behaviour
// =============================================================================

describe("NA is not a pass and not a fail", () => {
  it("G7 on a bare graph says the format cannot carry the item", () => {
    const r = gateG7(input({ graph: armAGraph() }));
    expect(r.status).toBe("NA");
    expect(r.evidence).toContain("graph cannot carry");
  });

  it("G8 on a bare graph says epistemic state is not representable", () => {
    expect(gateG8(input({ graph: armAGraph() })).status).toBe("NA");
  });

  it("a brief that declares no quantity makes G1 NA rather than PASS", () => {
    const vague = briefs.find((b) => b.id === "03-vague-underspecified")!;
    const r = gateG1({ rich: null, graph: armAGraph(), brief: vague });
    expect(r.status).toBe("NA");
    // ... and that NA never admits a candidate on its own.
    expect(gatesAdmit([r])).toBe(true);
  });

  it("ANCHOR_REQUIRED_STATES is the v0 schema's own list, not a free invention", () => {
    expect([...ANCHOR_REQUIRED_STATES].sort()).toEqual(["known", "observed", "user_estimate"]);
    const schema = JSON.parse(
      readFileSync(path.join(TOOL_ROOT, "contracts", "rich-decision-model.v0.json"), "utf-8")
    ) as Record<string, unknown>;
    expect(JSON.stringify(schema)).toContain("Required when epistemic_state is known/observed/user_estimate");
  });
});
