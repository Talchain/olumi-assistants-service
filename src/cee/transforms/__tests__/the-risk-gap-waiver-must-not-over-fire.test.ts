/**
 * ⭐⭐ THE DISCRIMINATING CONTROLS FOR A WAIVER — because a gate that stops
 * refusing is only safe if you can show WHAT IT STILL REFUSES.
 *
 * The change under test admits ONE new blocker shape at the run admission:
 * `OPTION_NEEDS_MAPPING` whose every `unresolved_targets` entry names a node that
 * EXISTS in the graph and is a `risk`, on an option carrying at least one value,
 * stamped `obligation: "offered"`. Four conjuncts. This file mutates the captured
 * witness ONE conjunct at a time and requires the refusal back each time.
 *
 * ⛔ WHY THIS IS NOT DECORATION. The estate's most expensive defect shape is a
 * predicate broader than the rule it serves, and the waiver it extends carries
 * its own warning against exactly that ("a waiver that grows is how a gate stops
 * being a gate"). A positive result with no negative controls would say nothing
 * about the boundary — and `unresolved_targets` has a SECOND producer with a
 * different meaning (`extraction/intervention-extractor.ts`: "an intervention
 * names a factor absent from the graph"), so the boundary is not hypothetical.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { analysisAdmissionFrom } from "../../../orchestrator-v5/admission/analysis-admission.js";
import { resolveRunAdmission } from "../../../orchestrator-v5/tools/handlers/analysis-ready-core.js";
import type { GraphV3T } from "../../../schemas/cee-v3.js";

const WITNESS = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/paul-hiring-session-20260921.json", import.meta.url)),
    "utf-8",
  ),
) as { graph: GraphV3T };

const RISK_LABEL = "Coordination Overhead Risk";
const BLOCKED_OPTION = "Hire a Tech Lead";

function clone(): GraphV3T {
  return JSON.parse(JSON.stringify(WITNESS.graph)) as GraphV3T;
}
function nodeBy(graph: GraphV3T, predicate: (n: { kind?: string; label?: string }) => boolean) {
  return (graph.nodes as { id: string; kind?: string; label?: string }[]).find(predicate)!;
}
function proceeds(graph: GraphV3T): boolean {
  return resolveRunAdmission(graph).willProceed;
}

describe("the risk-gap waiver must not over-fire", () => {
  it("POSITIVE CONTROL — the witnessed shape is admitted", () => {
    expect(proceeds(WITNESS.graph), "the waiver must actually fire, or every case below is vacuous").toBe(true);
  });

  it("STILL REFUSED — one unresolved target names a node that is not in the graph", () => {
    // The `missingFactors` sense of the SAME field. CEE could not resolve this
    // one, so the scope note's reason applies and the refusal must stand whole.
    const graph = clone();
    const option = nodeBy(graph, (n) => n.kind === "option" && n.label === BLOCKED_OPTION);
    (option as unknown as { unresolved_targets: string[] }).unresolved_targets = ["ghost_factor_not_in_graph"];
    graph.edges.push({
      from: option.id, to: "ghost_factor_not_in_graph", edge_type: "directed",
      strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.8, effect_direction: "positive",
    } as unknown as GraphV3T["edges"][number]);
    expect(proceeds(graph), "an unresolvable target must keep its refusal").toBe(false);
  });

  it("STILL REFUSED — a MIXED gap: one resolvable risk target AND one that names nothing", () => {
    // ⭐ THE BOUNDARY THAT MATTERS, and the reason the predicate uses `every`
    // rather than `some`. `unresolved_targets` carries TWO questions under one
    // name (trap 21): the risk hypothesis this waiver discards, and the
    // extractor's "an intervention names a factor absent from the graph", which
    // it must not. One unresolvable entry keeps the WHOLE refusal.
    const graph = clone();
    const option = nodeBy(graph, (n) => n.kind === "option" && n.label === BLOCKED_OPTION);
    const risk = nodeBy(graph, (n) => n.label === RISK_LABEL);
    (option as unknown as { unresolved_targets: string[] }).unresolved_targets = [
      risk.id,
      "ghost_factor_not_in_graph",
    ];
    expect(proceeds(graph), "a mixed gap is not a risk-only gap").toBe(false);
  });

  it("NOT THIS WAIVER — an option with no value is admitted by EXCLUSION, on its own terms", () => {
    // Measured, and it corrects this test's first draft, which expected a
    // refusal. Emptying the option routes it to the SCAFFOLD/EXCLUSION waiver,
    // which admits the run while naming what it drops — the documented
    // behaviour, and a different authority from the one under test. Asserting
    // the REASON CODE is what makes this discriminating: a bare `willProceed`
    // would have read as this change over-firing.
    const graph = clone();
    const option = nodeBy(graph, (n) => n.kind === "option" && n.label === BLOCKED_OPTION);
    (option as unknown as { interventions: Record<string, unknown> }).interventions = {};
    const admission = resolveRunAdmission(graph);
    expect(admission.waivedOptionIds, "the exclusion waiver names the option it drops").toContain(
      option.id,
    );
    expect(
      analysisAdmissionFrom(admission, graph).reasons.some(
        (r) => r.field === "structurally_analysable" && r.code === "RUN_WILL_EXCLUDE_OPTIONS",
      ),
      "admitted by exclusion, not by the risk-gap waiver",
    ).toBe(true);
  });

  it("STILL REFUSED — every option is blocked, so there is no comparison left", () => {
    // The two-option minimum. Stripping the one READY option leaves nothing the
    // run could proceed on, and the waiver must not manufacture a comparison.
    const graph = clone();
    const ready = nodeBy(graph, (n) => n.kind === "option" && n.label === "Hire One Senior Developer");
    const risk = nodeBy(graph, (n) => n.label === RISK_LABEL);
    graph.edges.push({
      from: ready.id, to: risk.id, edge_type: "directed",
      strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: "positive",
    } as unknown as GraphV3T["edges"][number]);
    (graph.nodes as { id: string; interventions?: Record<string, unknown> }[])
      .filter((n) => n.interventions).forEach((n) => { n.interventions = {}; });
    expect(proceeds(graph), "no valued options means no comparison to admit").toBe(false);
  });
});
