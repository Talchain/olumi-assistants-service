/**
 * ⭐ ONE PAYLOAD, TWO PRODUCERS, TWO DIFFERENT ANSWERS TO "WHAT IS STILL OPEN?"
 *
 * THE DEFECT, wire-witnessed twice on one session state: FOUR factors had no
 * value, the provenance surface named all four correctly, and the assistant's
 * prose said *"One factor still has no value set"* — an understatement of the
 * remaining work by 4×, on a product whose premise is a truthful living model.
 *
 * ── THE SEAM, MEASURED (not inferred) ───────────────────────────────────────
 * `analysis_ready` has TWO producers and they disagree in SHAPE:
 *
 *   canonical (`buildCanonicalAnalysisReadyFromGraph`)
 *       8 blockers · 8 readiness_issues · repair_proposal PRESENT  → names 4
 *   pipeline  (`cee/transforms/analysis-ready.ts`)
 *       8 blockers · 0 readiness_issues · repair_proposal ABSENT   → names 1
 *
 * `summariseReadiness` takes its multi-item branch only on
 * `repair_proposal && canonicalIssues.length >= 2`. The pipeline payload carries
 * NEITHER field — `cee/transforms/analysis-ready.ts` never computes them (zero
 * occurrences of either name; contrast control `blockers` = 20 in the same
 * sweep) and `extractAnalysisReady` is a NAMED-FIELD RE-PROJECTION that names
 * `blockers` but not the other two. So it falls through to
 * `projectReadinessRecovery`, which returns EXACTLY ONE item, and three factors
 * are dropped.
 *
 * ⭐ AND THE TRUNCATION IS SILENT BECAUSE THE COLLAPSE HAPPENS *BEFORE* THE CAP
 * THAT WOULD HAVE DISCLOSED IT. `items_omitted` exists and is correct; it never
 * fires, because the loss is upstream of the cap it guards. Disclosure
 * machinery downstream of a silent loss discloses nothing — that is the
 * reusable part.
 *
 * ── WHY NOT A SECOND COUNTER (the fix's whole shape) ────────────────────────
 * The correct count is ALREADY in the payload the pack receives: `blockers`
 * survives BOTH paths intact, with `factor_label` on every entry — which is
 * exactly why the provenance surface gets it right (it never reads
 * `readiness_issues` at all). So the fix CONSULTS the existing authority:
 * `blockerIssue(...)`, already exported from `analysis-ready-helper.ts` with a
 * comment saying it is exported precisely so nobody re-implements it. No second
 * mapper, no second count.
 *
 * ── THE PRECONDITION IS PINNED IN-TEST, DELIBERATELY ────────────────────────
 * Every count assertion below is preceded by an assertion that the payload
 * under test GENUINELY has four valueless factors and GENUINELY has the poor
 * shape (0 readiness_issues, no repair_proposal). Without that, a test that
 * asserts "four" passes for the wrong reason the moment a producer changes.
 *
 * ── THE DISCRIMINATING PAIR ────────────────────────────────────────────────
 * A fix that only makes the poor shape better while silently changing the good
 * one is the over-wide failure this estate keeps paying for. So the CANONICAL
 * shape's correctness is asserted here too, and the `ready` payload is asserted
 * to gain NO invented items — the two directions a widened predicate breaks.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  calculateCost: vi.fn(() => 0),
  TelemetryEvents: {},
}));
vi.mock("../../../config/index.js", () => ({
  config: { cee: {}, features: {} },
  isProduction: () => false,
}));

import { buildAnalysisReadyPayload } from "../../../cee/transforms/analysis-ready.js";
import { buildCanonicalAnalysisReadyFromGraph } from "../../../orchestrator/tools/analysis-ready-helper.js";
import { GraphV3 } from "../../../schemas/cee-v3.js";
import { projectContextPackReadiness, summariseReadiness } from "../readiness-summary.js";

/** The four factors from the witnessed session, by identity — never by count alone. */
const VALUELESS = [
  "AI-native rebuild investment",
  "Discount-led logo acquisition",
  "Positioning and packaging overhaul",
  "Competitive differentiation vs AI copilot rivals",
] as const;

const edge = (from: string, to: string, mean = 0.5) => ({
  from,
  to,
  strength: { mean, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: (mean >= 0 ? "positive" : "negative") as "positive" | "negative",
});

/**
 * `valued` controls the ONE variable under test: whether each option states an
 * effect value on every factor. Valueless options + valueless factors is the
 * witnessed state; the valued variant is the `ready` control.
 */
function graphWithFourValuelessFactors(valued: boolean): any {
  const interventions = (v: number) =>
    Object.fromEntries(
      VALUELESS.map((_, i) => [
        `fac_${i}`,
        { value: v, source: "user_specified", target_match: "exact" },
      ]),
    );
  const nodes: any[] = [
    { id: "dec_1", kind: "decision", label: "Which strategy?" },
    {
      id: "opt_a",
      kind: "option",
      label: "Ship AI rebuild",
      ...(valued ? { data: { interventions: interventions(0.6) } } : {}),
    },
    {
      id: "opt_b",
      kind: "option",
      label: "Hold position",
      ...(valued ? { data: { interventions: interventions(0.4) } } : {}),
    },
    { id: "out_1", kind: "outcome", label: "Contribution", observed_state: { value: 0.5 } },
    { id: "goal_1", kind: "goal", label: "Maximise contribution", goal_threshold: 0.7 },
  ];
  const edges: any[] = [edge("dec_1", "opt_a", 1), edge("dec_1", "opt_b", 1)];
  VALUELESS.forEach((label, i) => {
    // THE STATE UNDER TEST: a factor with no value anywhere.
    nodes.push({ id: `fac_${i}`, kind: "factor", label, category: "controllable" });
    edges.push(edge(`fac_${i}`, "out_1", 0.4));
    edges.push(edge("opt_a", `fac_${i}`, 1));
    edges.push(edge("opt_b", `fac_${i}`, 1));
  });
  edges.push(edge("out_1", "goal_1", 0.9));
  return { nodes, edges };
}

function pipelineOptions(valued: boolean): any[] {
  const interventions = (v: number) =>
    Object.fromEntries(VALUELESS.map((_, i) => [`fac_${i}`, v]));
  return [
    { id: "opt_a", label: "Ship AI rebuild", status: undefined, interventions: valued ? interventions(0.6) : {} },
    { id: "opt_b", label: "Hold position", status: undefined, interventions: valued ? interventions(0.4) : {} },
  ];
}

/** GROUND TRUTH, derived from the graph independently of every seam under test. */
function valuelessFactorLabels(graph: any): string[] {
  return graph.nodes
    .filter(
      (n: any) =>
        n.kind === "factor"
        && n?.observed_state?.value === undefined
        && n?.data?.value === undefined,
    )
    .map((n: any) => n.label);
}

/** Which of the four the projection NAMES, by identity. */
function factorsNamed(items: readonly { description: string }[]): string[] {
  return VALUELESS.filter((label) => items.some((it) => it.description.includes(label)));
}

describe("readiness open items — the pipeline-shaped payload must not collapse four factors to one", () => {
  it("PRECONDITION: the graph under test genuinely has four valueless factors and strictly parses", () => {
    const graph = graphWithFourValuelessFactors(false);
    // A guard must pin its own precondition, or it passes for the wrong reason.
    expect(GraphV3.safeParse(graph).success).toBe(true);
    expect(valuelessFactorLabels(graph).sort()).toEqual([...VALUELESS].sort());
  });

  it("PRECONDITION: the pipeline producer really does emit the POOR shape (blockers, but no readiness_issues and no repair_proposal)", () => {
    const graph = graphWithFourValuelessFactors(false);
    const payload: any = buildAnalysisReadyPayload(pipelineOptions(false) as any, "goal_1", graph as any);

    // This is the whole reason the defect exists. If any of these three stops
    // holding, the test below is no longer testing the collapse and must be
    // re-derived rather than trusted.
    expect(payload.readiness_issues ?? []).toHaveLength(0);
    expect(payload.repair_proposal ?? null).toBeNull();
    expect((payload.blockers ?? []).length).toBeGreaterThanOrEqual(2);

    // …and `blockers` carries the factor identity that makes the fix possible.
    const blockerFactors = new Set((payload.blockers ?? []).map((b: any) => b.factor_label));
    expect([...blockerFactors].sort()).toEqual([...VALUELESS].sort());
  });

  it("names ALL FOUR valueless factors on the pipeline-shaped payload", () => {
    const graph = graphWithFourValuelessFactors(false);
    const payload: any = buildAnalysisReadyPayload(pipelineOptions(false) as any, "goal_1", graph as any);
    const pack = projectContextPackReadiness(payload);

    // Bound by IDENTITY: which factors are named, not how many items exist.
    expect(factorsNamed(pack?.open_items ?? []).sort()).toEqual([...VALUELESS].sort());
  });

  it("keeps the CANONICAL-shaped payload correct — the good shape must not change", () => {
    const graph = graphWithFourValuelessFactors(false);
    const payload: any = buildCanonicalAnalysisReadyFromGraph(graph);

    // Precondition: this really IS the rich shape, so this test guards the
    // branch it claims to guard rather than silently re-testing the poor one.
    expect((payload.readiness_issues ?? []).length).toBeGreaterThanOrEqual(2);
    expect(payload.repair_proposal ?? null).not.toBeNull();

    expect(factorsNamed(projectContextPackReadiness(payload)?.open_items ?? []).sort()).toEqual(
      [...VALUELESS].sort(),
    );
  });

  it("invents NOTHING on a payload the canonical authority calls ready", () => {
    const graph = graphWithFourValuelessFactors(true);
    const payload: any = buildCanonicalAnalysisReadyFromGraph(graph);

    // Precondition pinned: without this the assertion below is vacuous on any
    // payload that merely happens to be empty.
    expect(payload.status).toBe("ready");

    expect(summariseReadiness(payload).open_items).toHaveLength(0);
    expect(projectContextPackReadiness(payload)?.open_items ?? []).toHaveLength(0);
  });
});
