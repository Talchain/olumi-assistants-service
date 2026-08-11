/**
 * REPAIR-ORDER DEFECT — `simpleRepair` DELETES the goal-terminating causal links
 * that the deterministic sweep's `fixFactorGoalEdges` exists to SPLIT.
 *
 * TWO AUTHORITIES, OPPOSITE POLICIES, ONE EDGE PATTERN — and the deleter runs first:
 *
 *   | authority             | policy for factor→goal        | where                       | when   |
 *   |-----------------------|-------------------------------|-----------------------------|--------|
 *   | simpleRepair's filter | DELETE (not in ALLOWED_EDGES) | services/repair.ts          | Stage 3|
 *   | fixFactorGoalEdges    | SPLIT into factor→outcome→goal| deterministic-sweep.ts      | Stage 4|
 *
 * `fixFactorGoalEdges` is invoked unconditionally ("ALWAYS run regardless of
 * violations") and its own header says it exists because "the LLM may short-circuit
 * the causal chain under cost-reduction / minimisation framing" — precisely the case
 * it can never see, because Stage 3 has already deleted the evidence.
 *
 * MEASURED (spike C-EXT-BUILD-3, olumi-docs/PHASE0-EVIDENCE-2026-07-28/
 * arch-decision-2026-08-11/spike/RESULTS-SPIKE.md + P5-REPAIR-ORDER-COUNTERFACTUAL.txt):
 * pooled over 7 runs, simpleRepair removed factor→goal ×15 while the sweep's
 * `factor_goal_splits` counter read 0 on EVERY run. The counterfactual, run with the
 * REAL functions over the REAL record sets, showed the deletion roughly DOUBLES
 * NO_PATH_TO_GOAL (crm 43f49f: 7 → 14) and that running the splitter instead clears
 * MISSING_BRIDGE outright.
 *
 * WHAT THIS FILE PINS
 *  - factor→goal survives simpleRepair, so the splitter that owns it can reach it.
 *  - factor→option and factor→decision are STILL DELETED. They are the same shape but
 *    NOT the same case: no downstream authority owns them (derived below), so
 *    simpleRepair is already their single owner and deletion is the correct policy.
 *
 * FIXTURE PROVENANCE — stated honestly. `crmRecordSetGraph()` is a hand-mapping of the
 * DECODED record set from the banked run
 * `spike/runs/arm-C_EXT/crm/2026-08-11T21-28-12-922Z_C_EXT_crm_MEASURED_43f49f`
 * (7 causal_links: 3 option→factor, 3 factor→factor, 2 factor→goal — the two being
 * "Licence cost … threatening the goal" and "Sales productivity improvement drives goal
 * attainment"), plus the decision→option scaffolding the projector synthesises. It is
 * NOT the spike projector's byte-for-byte output — the projector lives on the spike
 * branch and is not importable here. What it reproduces faithfully is the TOPOLOGY the
 * live gate saw, which is what this defect is about.
 */

import { describe, it, expect } from "vitest";
import {
  simpleRepair,
  ALLOWED_EDGE_PATTERNS,
  SWEEP_OWNED_EDGE_PATTERNS,
  countEdgePatternViolations,
} from "../../src/services/repair.js";
import {
  fixFactorGoalEdges,
  fixRemainingForbiddenEdges,
} from "../../src/cee/unified-pipeline/stages/repair/deterministic-sweep.js";
import { validateGraph } from "../../src/validators/graph-validator.js";
import type { GraphT } from "../../src/schemas/graph.js";

// ---------------------------------------------------------------------------
// Fixtures — fresh objects per call (fixFactorGoalEdges MUTATES its input)
// ---------------------------------------------------------------------------

const GOAL_ID = "goal_sales_productivity";
/** The two goal-terminating links the model emitted in run 43f49f. */
const LINK_LICENCE_TO_GOAL = { from: "fac_licence_cost", to: GOAL_ID } as const;
const LINK_PRODUCTIVITY_TO_GOAL = { from: "fac_sales_productivity", to: GOAL_ID } as const;

function edge(from: string, to: string, mean: number, direction: "positive" | "negative"): any {
  return {
    from,
    to,
    strength_mean: mean,
    strength_std: 0.15,
    belief_exists: 0.9,
    effect_direction: direction,
  };
}

/** Run 43f49f's topology. */
function crmRecordSetGraph(): GraphT {
  return {
    version: "1",
    default_seed: 17,
    nodes: [
      { id: "dec_crm", kind: "decision", label: "Replace the CRM?" },
      { id: "opt_hubspot", kind: "option", label: "Replace our current CRM with HubSpot next quarter" },
      { id: "opt_keep", kind: "option", label: "Keep what we have" },
      { id: "fac_licence_cost", kind: "factor", category: "controllable", label: "Annual CRM Licence Cost", data: { value: 30000 } },
      { id: "fac_switching_cost", kind: "factor", category: "controllable", label: "One-off Switching Cost (Migration + Setup)", data: { value: 18000 } },
      { id: "fac_training_cost", kind: "factor", category: "controllable", label: "Training Cost", data: { value: 6000 } },
      { id: "fac_sales_productivity", kind: "factor", category: "observable", label: "Sales Rep Productivity Level" },
      { id: "fac_adoption_rate", kind: "factor", category: "controllable", label: "CRM Adoption Rate", data: { value: 0.5 } },
      { id: "fac_migration_risk", kind: "factor", category: "external", label: "Data Migration Risk" },
      { id: GOAL_ID, kind: "goal", label: "Higher sales productivity without blowing the budget" },
    ],
    edges: [
      // projector scaffolding
      edge("dec_crm", "opt_hubspot", 1, "positive"),
      edge("dec_crm", "opt_keep", 1, "positive"),
      // stated causal_links
      edge("opt_hubspot", "fac_switching_cost", 0.6, "positive"),
      edge("opt_hubspot", "fac_training_cost", 0.6, "positive"),
      edge("opt_keep", "fac_licence_cost", 0.6, "positive"),
      edge("fac_adoption_rate", "fac_sales_productivity", 0.6, "positive"),
      edge("fac_training_cost", "fac_adoption_rate", 0.5, "positive"),
      edge("fac_migration_risk", "fac_sales_productivity", 0.4, "negative"),
      // the two goal-terminating links — the pattern under test
      edge(LINK_LICENCE_TO_GOAL.from, LINK_LICENCE_TO_GOAL.to, -0.5, "negative"),
      edge(LINK_PRODUCTIVITY_TO_GOAL.from, LINK_PRODUCTIVITY_TO_GOAL.to, 0.7, "positive"),
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" },
  } as unknown as GraphT;
}

/**
 * The SAME record-set topology plus the reversed links the model also emitted on the
 * B1/B3 briefs (factor→option ×11, factor→decision ×4 pooled). These are the
 * adjudication's negative cases: same shape, no downstream owner, deletion stands.
 */
function crmRecordSetGraphWithReversedLinks(): GraphT {
  const g = crmRecordSetGraph();
  (g.edges as any[]).push(
    edge("fac_sales_productivity", "opt_hubspot", 0.4, "positive"), // factor→option
    edge("fac_licence_cost", "dec_crm", 0.4, "negative"),           // factor→decision
  );
  return g;
}

function hasEdge(g: GraphT, from: string, to: string): boolean {
  return (g.edges as any[]).some((e) => e.from === from && e.to === to);
}

function countCode(g: GraphT, code: string): number {
  return validateGraph({ graph: g, phase: "test" as any }).errors.filter((e) => e.code === code).length;
}

// ---------------------------------------------------------------------------

describe("repair order — factor→goal must reach the authority that repairs it", () => {
  // -- Preconditions. A guard must pin its own precondition in-test, or it can pass
  // -- for a reason that has nothing to do with the property (platform trap 13b).
  describe("preconditions (pin the fixture, so no assertion below can pass vacuously)", () => {
    it("factor→goal is genuinely an INVALID pattern under the closed-world topology", () => {
      expect(
        ALLOWED_EDGE_PATTERNS.some((p) => p.from === "factor" && p.to === "goal"),
        "if factor→goal ever becomes an allowed pattern this whole file is vacuous",
      ).toBe(false);
    });

    it("the fixture carries the two named goal-terminating links from run 43f49f", () => {
      const g = crmRecordSetGraph();
      expect(hasEdge(g, LINK_LICENCE_TO_GOAL.from, LINK_LICENCE_TO_GOAL.to)).toBe(true);
      expect(hasEdge(g, LINK_PRODUCTIVITY_TO_GOAL.from, LINK_PRODUCTIVITY_TO_GOAL.to)).toBe(true);
    });

    it("the splitter DOES fire on this fixture — otherwise the counterfactual is vacuous", () => {
      const g = crmRecordSetGraph();
      const { splitCount } = fixFactorGoalEdges(g, "V1_FLAT");
      expect(splitCount).toBe(2);
    });
  });

  // -- The defect.
  describe("simpleRepair preserves factor→goal for the sweep's splitter", () => {
    it("preserves BOTH goal-terminating links, bound by identity not by count", () => {
      const repaired = simpleRepair(crmRecordSetGraph(), "test-req");

      expect(
        hasEdge(repaired, LINK_LICENCE_TO_GOAL.from, LINK_LICENCE_TO_GOAL.to),
        "fac_licence_cost→goal was deleted before fixFactorGoalEdges could split it",
      ).toBe(true);
      expect(
        hasEdge(repaired, LINK_PRODUCTIVITY_TO_GOAL.from, LINK_PRODUCTIVITY_TO_GOAL.to),
        "fac_sales_productivity→goal was deleted before fixFactorGoalEdges could split it",
      ).toBe(true);
    });

    it("hands the pattern on intact: the splitter still finds and splits both links after simpleRepair", () => {
      const repaired = simpleRepair(crmRecordSetGraph(), "test-req");
      const { splitCount, repairs } = fixFactorGoalEdges(repaired, "V1_FLAT");

      expect(splitCount, "the sweep's factor_goal_splits counter read 0 on every measured run").toBe(2);
      expect(repairs.every((r) => r.code === "FACTOR_GOAL_EDGE_SPLIT")).toBe(true);

      // The split produces the legal spine the appendix asked for, bound by identity.
      expect(hasEdge(repaired, LINK_LICENCE_TO_GOAL.from, "out_fac_licence_cost_impact")).toBe(true);
      expect(hasEdge(repaired, "out_fac_licence_cost_impact", GOAL_ID)).toBe(true);
      expect(hasEdge(repaired, LINK_PRODUCTIVITY_TO_GOAL.from, "out_fac_sales_productivity_impact")).toBe(true);
      expect(hasEdge(repaired, "out_fac_sales_productivity_impact", GOAL_ID)).toBe(true);

      // …and leaves no factor→goal behind, so the pattern is genuinely resolved and not
      // merely tolerated.
      expect(hasEdge(repaired, LINK_LICENCE_TO_GOAL.from, GOAL_ID)).toBe(false);
      expect(hasEdge(repaired, LINK_PRODUCTIVITY_TO_GOAL.from, GOAL_ID)).toBe(false);
    });

    it("does not make the graph strictly worse at the gate (measured: NO_PATH_TO_GOAL 7 → 14)", () => {
      const before = countCode(crmRecordSetGraph(), "NO_PATH_TO_GOAL");
      const after = countCode(simpleRepair(crmRecordSetGraph(), "test-req"), "NO_PATH_TO_GOAL");

      expect(
        after,
        `simpleRepair raised NO_PATH_TO_GOAL from ${before} to ${after} by deleting the only links to the goal`,
      ).toBeLessThanOrEqual(before);
    });
  });

  // -- The adjudication's negative half. These are GREEN before the fix and must STAY
  // -- green: they are what binds the change to factor→goal and nothing else.
  describe("the other reversed patterns keep their existing single owner — deletion", () => {
    it("still deletes factor→option (no downstream authority owns it)", () => {
      const repaired = simpleRepair(crmRecordSetGraphWithReversedLinks(), "test-req");
      expect(hasEdge(repaired, "fac_sales_productivity", "opt_hubspot")).toBe(false);
    });

    it("still deletes factor→decision (no downstream authority owns it, and no legal reverse exists)", () => {
      const repaired = simpleRepair(crmRecordSetGraphWithReversedLinks(), "test-req");
      expect(hasEdge(repaired, "fac_licence_cost", "dec_crm")).toBe(false);
    });

    it("still deletes the patterns the sweep's own forbidden-edge list DOES own", () => {
      // outcome→outcome is in the sweep's SIMPLE_REMOVE_PATTERNS: both authorities
      // agree on DELETE there, so there is no disagreement to resolve and nothing to
      // defer. Pinned so a broadened deferral cannot slip through unnoticed.
      const g = crmRecordSetGraph();
      (g.nodes as any[]).push(
        { id: "out_a", kind: "outcome", label: "A" },
        { id: "out_b", kind: "outcome", label: "B" },
      );
      (g.edges as any[]).push(
        edge("fac_adoption_rate", "out_a", 0.5, "positive"),
        edge("out_a", GOAL_ID, 0.5, "positive"),
        edge("fac_adoption_rate", "out_b", 0.5, "positive"),
        edge("out_b", GOAL_ID, 0.5, "positive"),
        edge("out_a", "out_b", 0.5, "positive"), // outcome→outcome
      );
      const repaired = simpleRepair(g, "test-req");
      expect(hasEdge(repaired, "out_a", "out_b")).toBe(false);
    });
  });

  // -- Single ownership, derived from the downstream authority rather than asserted.
  describe("single ownership holds downstream", () => {
    it("the sweep's remaining-forbidden-edge remover does NOT also claim factor→goal", () => {
      const g = crmRecordSetGraph();
      const { removedCount } = fixRemainingForbiddenEdges(g, "test-req");

      expect(removedCount, "a second deleter downstream would re-open the same two-authority defect").toBe(0);
      expect(hasEdge(g, LINK_LICENCE_TO_GOAL.from, GOAL_ID)).toBe(true);
      expect(hasEdge(g, LINK_PRODUCTIVITY_TO_GOAL.from, GOAL_ID)).toBe(true);
    });

    it("the deferral list is exactly the pattern that has a downstream repairer", () => {
      // Bound by identity, not by length: a broadened list that still contained
      // factor→goal would pass a length check.
      expect([...SWEEP_OWNED_EDGE_PATTERNS]).toEqual([{ from: "factor", to: "goal" }]);
    });
  });

  // -- Stage 3's post-repair alarm must stay honest: an expected deferral is not a
  // -- violation, and a broken alarm is worse than no alarm.
  describe("Stage 3's post-repair alarm distinguishes deferral from violation", () => {
    it("counts a deferred factor→goal as deferred and NOT as invalid", () => {
      const counts = countEdgePatternViolations(simpleRepair(crmRecordSetGraph(), "test-req"));
      expect(counts).toEqual({ invalid: 0, deferred: 2 });
    });

    it("still counts a genuinely-unowned invalid pattern as invalid", () => {
      // The positive control for the assertion above: a pattern nothing downstream
      // owns must still register, or the alarm has been silenced rather than
      // sharpened. Fed directly (not via simpleRepair, which deletes it).
      const g = crmRecordSetGraphWithReversedLinks();
      const counts = countEdgePatternViolations(g);
      expect(counts.invalid).toBe(2); // factor→option + factor→decision
      expect(counts.deferred).toBe(2); // the two factor→goal links
    });

    it("ignores dangling edges rather than miscounting them as pattern violations", () => {
      const g = crmRecordSetGraph();
      (g.edges as any[]).push(edge("fac_licence_cost", "node_that_does_not_exist", 0.5, "positive"));
      expect(countEdgePatternViolations(g)).toEqual({ invalid: 0, deferred: 2 });
    });
  });
});
