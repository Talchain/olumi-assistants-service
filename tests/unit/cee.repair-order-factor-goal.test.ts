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

import { describe, it, expect, vi, afterEach } from "vitest";
import { runStageEnrich } from "../../src/cee/unified-pipeline/stages/enrich.js";
import { runPlotValidation } from "../../src/cee/unified-pipeline/stages/repair/plot-validation.js";
import { createCorrectionCollector } from "../../src/cee/corrections.js";
import { log } from "../../src/utils/telemetry.js";

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

// Substep 2 calls the external PLoT engine first and only reaches its deterministic
// fallback (the simpleRepair call this file is about) when that returns not-ok. Stub it
// not-ok so the fallback is the path under test — no network, and no other test in this
// file imports this module.
vi.mock("../../src/services/validateClientWithCache.js", () => ({
  validateGraph: vi.fn(async () => ({ ok: false, violations: ["[INVALID_EDGE_TYPE] at edge factor→goal"] })),
}));

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

/** What Stage 3 (enrich.ts) passes — the ONE call site the exemption is justified at. */
const STAGE_3_OPTS = { deferSweepOwnedPatterns: true } as const;

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
      const repaired = simpleRepair(crmRecordSetGraph(), "test-req", STAGE_3_OPTS);

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
      const repaired = simpleRepair(crmRecordSetGraph(), "test-req", STAGE_3_OPTS);
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
      const after = countCode(simpleRepair(crmRecordSetGraph(), "test-req", STAGE_3_OPTS), "NO_PATH_TO_GOAL");

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
      const repaired = simpleRepair(crmRecordSetGraphWithReversedLinks(), "test-req", STAGE_3_OPTS);
      expect(hasEdge(repaired, "fac_sales_productivity", "opt_hubspot")).toBe(false);
    });

    it("still deletes factor→decision (no downstream authority owns it, and no legal reverse exists)", () => {
      const repaired = simpleRepair(crmRecordSetGraphWithReversedLinks(), "test-req", STAGE_3_OPTS);
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
      const repaired = simpleRepair(g, "test-req", STAGE_3_OPTS);
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

    it("deferral is OPT-IN: the default preserves the delete-all behaviour for every other call site", () => {
      // The exemption is justified by what runs AFTER the caller, so it belongs to the
      // call site, not to the function. Only Stage 3 is followed by the sweep.
      const byDefault = simpleRepair(crmRecordSetGraph(), "test-req");
      expect(hasEdge(byDefault, LINK_LICENCE_TO_GOAL.from, GOAL_ID)).toBe(false);
      expect(hasEdge(byDefault, LINK_PRODUCTIVITY_TO_GOAL.from, GOAL_ID)).toBe(false);

      const optedIn = simpleRepair(crmRecordSetGraph(), "test-req", { deferSweepOwnedPatterns: true });
      expect(hasEdge(optedIn, LINK_LICENCE_TO_GOAL.from, GOAL_ID)).toBe(true);
      expect(hasEdge(optedIn, LINK_PRODUCTIVITY_TO_GOAL.from, GOAL_ID)).toBe(true);
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
      const counts = countEdgePatternViolations(simpleRepair(crmRecordSetGraph(), "test-req", STAGE_3_OPTS));
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

  // -- Stage 3 end to end. The unit assertions above prove simpleRepair's behaviour;
  // -- they say nothing about whether the STAGE reports it honestly. Both halves are
  // -- driven through the real `runStageEnrich`, the only call site that matters here.
  describe("Stage 3 (runStageEnrich) — the real call site", () => {
    afterEach(() => vi.restoreAllMocks());

    /** Minimal StageContext — only the fields Stage 3 reads. */
    function makeCtx(graph: GraphT): any {
      return {
        input: {},
        rawBody: {},
        request: {},
        requestId: "test-repair-order",
        opts: { schemaVersion: "v1" as const },
        start: Date.now(),
        graph,
        effectiveBrief: "Should we replace our CRM with HubSpot next quarter?",
        rationales: [],
        draftCost: 0,
        skipRepairDueToBudget: false,
        repairTimeoutMs: 0,
        draftDurationMs: 0,
        riskCoefficientCorrections: [],
        transforms: [],
        hadCycles: false,
        nodeRenames: new Map<string, string>(),
      };
    }

    it("carries the goal-terminating links out of Stage 3, and reports them as DEFERRED not INVALID", async () => {
      const warnSpy = vi.spyOn(log, "warn");
      const infoSpy = vi.spyOn(log, "info");

      const ctx = makeCtx(crmRecordSetGraph());
      await runStageEnrich(ctx);

      // (a) The stage's output still carries the pattern, so Stage 4's splitter can see it.
      expect(hasEdge(ctx.graph as GraphT, LINK_LICENCE_TO_GOAL.from, GOAL_ID)).toBe(true);
      expect(hasEdge(ctx.graph as GraphT, LINK_PRODUCTIVITY_TO_GOAL.from, GOAL_ID)).toBe(true);

      // (b) The post-repair alarm did not cry wolf about a deliberate deferral. An
      // alarm that fires on every ordinary draft is one everyone learns to ignore.
      const events = (spy: typeof warnSpy) =>
        spy.mock.calls.map((c) => (c[0] as any)?.event).filter(Boolean);
      expect(events(warnSpy)).not.toContain("cee.enrich.post_repair_invalid_edges");

      // (c) …but the deferral IS reported, with the count, so "deferred in, never
      // repaired out" is observable rather than silent.
      const deferred = infoSpy.mock.calls
        .map((c) => c[0] as any)
        .find((a) => a?.event === "cee.enrich.post_repair_deferred_edges");
      expect(deferred, "Stage 3 must record the handoff it just performed").toBeDefined();
      expect(deferred.deferred_count).toBe(2);
    });

    it("SUBSTEP 2 must NOT defer — the id-collision collider, refuted by execution in review", async () => {
      // ── The blocker round 1 shipped ────────────────────────────────────────────
      // Round 1's PR body claimed "no factor→goal edge remains for substep 2 to see,
      // so the deferral is inert there". FALSE, and the splitter itself falsifies it:
      // fixFactorGoalEdges reuses an existing `out_<factorId>_impact` node WITHOUT
      // checking its kind (deterministic-sweep.ts:981, `!nodeKindMap.has(outcomeId)`).
      // Put a NON-outcome node on that id and the splitter EMITS a fresh factor→goal
      // edge *after* the sweep has run. A function-scoped exemption then defers it at
      // substep 2 to an authority that already ran — base DELETED it, round 1 shipped
      // it to a 422 at the post-enforcement gate.
      //
      // That is trap 21 one level up from the defect this file fixes: the exemption's
      // justification holds at ONE call site, and it was applied at FUNCTION scope.
      // The fix is the opt-in parameter — substep-2 deferral becomes impossible BY
      // CONSTRUCTION rather than by an argument a constructed case defeats.
      //
      // The splitter's missing kind guard is NOT fixed here (out of scope, rowed with
      // the review's other latent findings). It is PINNED below, because it is exactly
      // what makes this case non-vacuous.
      const COLLIDER_ID = "out_fac_sales_productivity_impact";

      const g = crmRecordSetGraph();
      (g.nodes as any[]).push({
        id: COLLIDER_ID, // the id the splitter would mint — already taken, by a FACTOR
        kind: "factor",
        category: "observable",
        label: "Productivity Impact (pre-existing, not an outcome)",
      });

      // Stage 3 defers, as designed.
      const afterStage3 = simpleRepair(g, "test-collider", { deferSweepOwnedPatterns: true });
      expect(hasEdge(afterStage3, LINK_PRODUCTIVITY_TO_GOAL.from, GOAL_ID)).toBe(true);

      // PRECONDITION — the splitter reuses the colliding node and emits a NEW
      // factor→goal edge. If this ever stops holding, the assertion below is vacuous
      // and must be re-derived rather than trusted.
      fixFactorGoalEdges(afterStage3, "V1_FLAT");
      const colliderKind = (afterStage3.nodes as any[]).find((n) => n.id === COLLIDER_ID)?.kind;
      expect(colliderKind, "the collider must still be a factor, or nothing illegal is emitted").toBe("factor");
      expect(
        hasEdge(afterStage3, COLLIDER_ID, GOAL_ID),
        "precondition: the splitter must emit the illegal factor→goal edge for this case to test anything",
      ).toBe(true);

      // ── The assertion ─────────────────────────────────────────────────────────
      // Drive the REAL substep 2, so this binds to plot-validation.ts's actual call
      // and REDs if anyone later passes the opt-in there.
      const ctx: any = {
        graph: afterStage3,
        collector: createCorrectionCollector(),
        requestId: "test-collider",
        llmRepairNeeded: false,
        remainingViolations: [],
      };
      await runPlotValidation(ctx);

      expect(
        hasEdge(ctx.graph as GraphT, COLLIDER_ID, GOAL_ID),
        "substep 2 must delete this edge as it did at base — its repair authority has already run, so deferring sends it to a 422",
      ).toBe(false);
    });

    it("still raises the invalid-edge alarm when an edge nothing owns survives", async () => {
      // Positive control for the assertion above: prove the alarm can still fire, or
      // "it did not fire" is evidence of nothing (platform trap 13). Fed by stubbing
      // the count directly — reaching this state through the pipeline would require a
      // later stage to re-add an edge, which is exactly the condition that should not
      // be reachable.
      const { countEdgePatternViolations: real } = await import("../../src/services/repair.js");
      expect(real({
        nodes: [
          { id: "f", kind: "factor" },
          { id: "o", kind: "option" },
        ] as any,
        edges: [{ from: "f", to: "o" }] as any,
      })).toEqual({ invalid: 1, deferred: 0 });
    });
  });
});
