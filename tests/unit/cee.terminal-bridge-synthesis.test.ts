/**
 * ROADMAP 2.1099 — R1 terminal-bridge synthesis.
 *
 * THE DEFECT (measured, `PHASE0-EVIDENCE-2026-07-28/draft-reliability-2026-08-12/
 * DIAGNOSIS-ENFORCEMENT.md`): the drafter emits `decision → options → factors`
 * plus a goal with no bridge. `MISSING_BRIDGE` fires (`outcomes.length === 0 &&
 * risks.length === 0`), `ALLOWED_EDGES` has no `factor→goal` rule, so every node
 * is `NO_PATH_TO_GOAL` and the WHOLE DRAFT is rejected at
 * `applyDeterministicEnforcement`. S3 failed 7/7 and S4 2/2 across two builds.
 * Six existing connectivity repairs all presuppose ≥1 outcome/risk node, so the
 * one shape that has none is the one that reaches the gate — and `ensureGoalNode`
 * mints the goal that is then judged unreachable.
 *
 * ⚠ THESE TESTS BIND TO THE REAL GATE, NOT TO A SUBSTEP. The pre-existing guard
 * (`cee.deterministic-sweep.canonical-direction.test.ts`) imports
 * `runDeterministicSweep`, so it proves a substep's behaviour and is structurally
 * incapable of observing whether that survives to `applyDeterministicEnforcement`.
 * Everything here runs the full `runStageRepair`.
 *
 * ⚠ AND THE HONESTY CONSTRAINT IS A TEST, NOT A COMMENT. This repair MINTS A NODE
 * THE USER NEVER WROTE. Anything that lets it acquire brief-attributed provenance
 * must turn this file RED.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runStageRepair } from "../../src/cee/unified-pipeline/stages/repair/index.js";
import { validateGraph } from "../../src/validators/graph-validator.js";
import { transformGraphToV3 } from "../../src/cee/transforms/schema-v3.js";
import { createEdgeFieldStash } from "../../src/cee/unified-pipeline/edge-identity.js";
import {
  SYNTHETIC_BRIDGE_NODE_ID,
  needsTerminalBridge,
  fixTerminalBridge,
} from "../../src/cee/unified-pipeline/stages/repair/terminal-bridge.js";

const BRIEF =
  "We are a 40-person B2B SaaS company. Our goal is to improve net revenue retention. " +
  "We could raise prices 15%, launch a services tier, invest in customer success, or do nothing.";

type BuildOpts = { includeGoal?: boolean; includeOutcome?: boolean };

/** The measured S3 topology: decision → 4 options → 5 factors, goal with no bridge. */
function buildS3Graph(opts: BuildOpts = {}): any {
  const { includeGoal = true, includeOutcome = false } = opts;

  const nodes: any[] = [
    { id: "dec_main", kind: "decision", label: "How to improve net revenue retention" },
    { id: "opt_raise", kind: "option", label: "Raise prices 15%" },
    { id: "opt_services", kind: "option", label: "Launch a services tier" },
    { id: "opt_cs", kind: "option", label: "Invest in customer success" },
    { id: "opt_nothing", kind: "option", label: "Do nothing" },
    { id: "fac_churn", kind: "factor", category: "controllable", label: "Churn rate", data: { value: 0.12, unit: "other" } },
    { id: "fac_arpu", kind: "factor", category: "controllable", label: "ARPU", data: { value: 400, unit: "other" } },
    { id: "fac_cost", kind: "factor", category: "controllable", label: "Delivery cost", data: { value: 90, unit: "other" } },
    { id: "fac_nps", kind: "factor", category: "controllable", label: "Customer satisfaction", data: { value: 30, unit: "other" } },
  ];
  if (includeGoal) nodes.push({ id: "goal_nrr", kind: "goal", label: "Improve net revenue retention" });
  if (includeOutcome) nodes.push({ id: "out_retention", kind: "outcome", label: "Retention impact" });

  const edges: any[] = [
    { id: "e_d_raise", from: "dec_main", to: "opt_raise", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
    { id: "e_d_services", from: "dec_main", to: "opt_services", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
    { id: "e_d_cs", from: "dec_main", to: "opt_cs", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
    { id: "e_d_nothing", from: "dec_main", to: "opt_nothing", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
    // option→factor structural edges carrying the model-invented strengths the
    // Anthropic tool grammar COMPELS (it requires `strength` on every edge and
    // never states the canonical constant).
    { id: "e_raise_arpu", from: "opt_raise", to: "fac_arpu", strength_mean: 0.8, strength_std: 0.15, belief_exists: 0.9, effect_direction: "positive" },
    { id: "e_raise_churn", from: "opt_raise", to: "fac_churn", strength_mean: 0.6, strength_std: 0.2, belief_exists: 0.85, effect_direction: "positive" },
    { id: "e_services_arpu", from: "opt_services", to: "fac_arpu", strength_mean: 0.7, strength_std: 0.18, belief_exists: 0.8, effect_direction: "positive" },
    { id: "e_services_cost", from: "opt_services", to: "fac_cost", strength_mean: 0.75, strength_std: 0.12, belief_exists: 0.9, effect_direction: "positive" },
    { id: "e_cs_churn", from: "opt_cs", to: "fac_churn", strength_mean: 0.65, strength_std: 0.2, belief_exists: 0.85, effect_direction: "positive" },
    { id: "e_cs_nps", from: "opt_cs", to: "fac_nps", strength_mean: 0.7, strength_std: 0.15, belief_exists: 0.9, effect_direction: "positive" },
    { id: "e_nothing_churn", from: "opt_nothing", to: "fac_churn", strength_mean: 0.5, strength_std: 0.2, belief_exists: 0.7, effect_direction: "positive" },
  ];

  if (includeOutcome) {
    edges.push(
      { id: "e_churn_out", from: "fac_churn", to: "out_retention", strength_mean: -0.4, strength_std: 0.15, belief_exists: 0.85, effect_direction: "negative" },
      { id: "e_arpu_out", from: "fac_arpu", to: "out_retention", strength_mean: 0.35, strength_std: 0.15, belief_exists: 0.8, effect_direction: "positive" },
      { id: "e_cost_out", from: "fac_cost", to: "out_retention", strength_mean: -0.2, strength_std: 0.15, belief_exists: 0.8, effect_direction: "negative" },
      { id: "e_nps_out", from: "fac_nps", to: "out_retention", strength_mean: 0.3, strength_std: 0.15, belief_exists: 0.8, effect_direction: "positive" },
    );
    if (includeGoal) {
      edges.push({ id: "e_out_goal", from: "out_retention", to: "goal_nrr", strength_mean: 0.5, strength_std: 0.15, belief_exists: 0.9, effect_direction: "positive" });
    }
  }

  return { version: "v1", nodes, edges };
}

function makeCtx(graph: any): any {
  const corrections: any[] = [];
  const collector = {
    addByStage: (stage: number, type: string, target: unknown, reason: string, before?: unknown, after?: unknown) =>
      corrections.push({ stage, type, target, reason, before, after }),
    add: () => {},
    getCorrections: () => corrections,
    getSummary: () => ({}),
  };
  return {
    input: { brief: BRIEF, context: {} },
    rawBody: {},
    request: { headers: {} },
    requestId: "test-2-1099",
    opts: {},
    start: Date.now(),
    graph,
    rationales: [],
    draftCost: 0,
    draftAdapter: undefined,
    llmMeta: {},
    confidence: undefined,
    effectiveBrief: BRIEF,
    edgeFieldStash: createEdgeFieldStash(graph.edges),
    skipRepairDueToBudget: false,
    repairTimeoutMs: 30_000,
    draftDurationMs: 0,
    strpResult: undefined,
    riskCoefficientCorrections: [],
    transforms: [],
    enrichmentResult: undefined,
    hadCycles: false,
    nodeRenames: new Map<string, string>(),
    goalConstraints: undefined,
    constraintStrpResult: undefined,
    structuralMeta: {},
    validationSummary: undefined,
    quality: undefined,
    archetype: undefined,
    draftWarnings: [],
    ceeResponse: undefined,
    pipelineTrace: {},
    finalResponse: undefined,
    collector,
    __corrections: corrections,
    pipelineCheckpoints: [],
    checkpointsEnabled: false,
    pipelineOutcome: {},
  };
}

/** The gate's own predicate, called exactly as `applyDeterministicEnforcement` calls it. */
function gateCodes(graph: any): string[] {
  return validateGraph({ graph, requestId: "test", phase: "post_enforcement" as any }).errors.map((e) => e.code);
}

function countCodes(codes: string[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const c of codes) m[c] = (m[c] ?? 0) + 1;
  return m;
}

describe("ROADMAP 2.1099 — terminal-bridge synthesis (R1)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("the rejecting predicate, confirmed at this tip", () => {
    it("POSITIVE CONTROL: the S3 topology is rejected by the real gate predicate, on MISSING_BRIDGE", () => {
      // This is the fixture's licence to exist. If it stops failing, every
      // assertion below is vacuous and this file is testing nothing.
      const codes = countCodes(gateCodes(buildS3Graph()));
      expect(codes["MISSING_BRIDGE"]).toBe(1);
      expect(codes["NO_PATH_TO_GOAL"]).toBeGreaterThan(0);
      expect(codes["NO_EFFECT_PATH"]).toBeGreaterThan(0);
    });

    it("CONTRAST CONTROL: the same topology WITH an outcome bridge emits NONE of the bridge codes", () => {
      // Proves the fixture's bridge codes are caused by the missing bridge and
      // not by some unrelated defect baked into the fixture — an absence claim
      // needs a probe that can also report presence. Scoped to the three codes
      // the bridge governs: the fixture ALSO carries non-canonical structural
      // edges and factor-data gaps on purpose (the sweep repairs those), so
      // asserting an empty list here would assert something this control does
      // not test.
      const codes = countCodes(gateCodes(buildS3Graph({ includeOutcome: true })));
      expect(codes["MISSING_BRIDGE"]).toBeUndefined();
      expect(codes["NO_PATH_TO_GOAL"]).toBeUndefined();
      expect(codes["NO_EFFECT_PATH"]).toBeUndefined();
      // …and the codes it does NOT govern are still present, so this control is
      // discriminating rather than merely quiet.
      expect(codes["STRUCTURAL_EDGE_NOT_CANONICAL_ERROR"]).toBeGreaterThan(0);
    });
  });

  describe("trigger predicate — written against the VALIDATOR'S SPEC, not the observed failure", () => {
    it("fires when a goal exists and there are zero outcome AND zero risk nodes", () => {
      // MISSING_BRIDGE's predicate is `outcomes.length === 0 && risks.length === 0`.
      // The trigger is that predicate, NOT "the goal has zero inbound edges" —
      // which is a description of the S3 sample, not of the rule being satisfied.
      expect(needsTerminalBridge(buildS3Graph())).toBe(true);
    });

    it("does NOT fire when an outcome node already exists", () => {
      expect(needsTerminalBridge(buildS3Graph({ includeOutcome: true }))).toBe(false);
    });

    it("does NOT fire when a risk node exists instead of an outcome", () => {
      const g = buildS3Graph();
      g.nodes.push({ id: "risk_churn_spike", kind: "risk", label: "Churn spike" });
      expect(needsTerminalBridge(g)).toBe(false);
    });

    it("does NOT fire when there is no goal node to bridge to", () => {
      expect(needsTerminalBridge(buildS3Graph({ includeGoal: false }))).toBe(false);
    });
  });

  describe("R1 clears the gate END-TO-END through the real runStageRepair", () => {
    it("an S3-shaped draft reaches Stage 5 instead of a 422", async () => {
      const ctx = makeCtx(buildS3Graph());
      expect(countCodes(gateCodes(ctx.graph))["MISSING_BRIDGE"]).toBe(1); // pre-state, in-test

      await runStageRepair(ctx);

      expect(ctx.earlyReturn).toBeUndefined();
      expect(gateCodes(ctx.graph)).toEqual([]);
    });

    it("clears MISSING_BRIDGE, every NO_PATH_TO_GOAL and every NO_EFFECT_PATH", async () => {
      const ctx = makeCtx(buildS3Graph());
      const before = countCodes(gateCodes(ctx.graph));

      await runStageRepair(ctx);
      const after = countCodes(gateCodes(ctx.graph));

      expect(before["MISSING_BRIDGE"]).toBeGreaterThan(0);
      expect(before["NO_PATH_TO_GOAL"]).toBeGreaterThan(0);
      expect(before["NO_EFFECT_PATH"]).toBeGreaterThan(0);
      expect(after["MISSING_BRIDGE"]).toBeUndefined();
      expect(after["NO_PATH_TO_GOAL"]).toBeUndefined();
      expect(after["NO_EFFECT_PATH"]).toBeUndefined();
    });

    it("closes the ensureGoalNode incoherence: a draft with NO goal node also drafts", async () => {
      // §4.2 of the diagnosis: CEE synthesises the goal itself and then fails
      // closed because that freshly-minted node is unreachable. The repair must
      // therefore run AFTER `ensureGoalNode`, not inside the substep-1 sweep.
      const ctx = makeCtx(buildS3Graph({ includeGoal: false }));

      await runStageRepair(ctx);

      expect(ctx.earlyReturn).toBeUndefined();
      expect(gateCodes(ctx.graph)).toEqual([]);
      expect((ctx.graph.nodes as any[]).some((n) => n.kind === "goal")).toBe(true);
    });
  });

  describe("⛔ THE SYNTHETIC NODE MUST BE VISIBLY SYNTHETIC — never the user's own content", () => {
    it("the minted outcome node NEVER carries brief-attributed provenance on the wire", async () => {
      const ctx = makeCtx(buildS3Graph());
      await runStageRepair(ctx);

      // Bind by IDENTITY (the exact minted id), never by a predicate another
      // node could satisfy — trap 19.
      const minted = (ctx.graph.nodes as any[]).find((n) => n.id === SYNTHETIC_BRIDGE_NODE_ID);
      expect(minted, `no node with id ${SYNTHETIC_BRIDGE_NODE_ID}`).toBeDefined();
      expect(minted.kind).toBe("outcome");

      // Derived through the REAL V3 transform, not through my model of it.
      const v3 = transformGraphToV3(ctx.graph as any);
      const wireNode = (v3.graph.nodes as any[]).find((n) => n.id === SYNTHETIC_BRIDGE_NODE_ID);
      expect(wireNode, "minted node did not survive to the V3 wire").toBeDefined();
      expect(wireNode.provenance).not.toBe("from_brief");
      expect(wireNode.provenance).not.toBe("user_set");
      expect(wireNode.provenance).toBe("ai_inferred");

      // The structural fields that MANUFACTURE a from_brief claim must be absent.
      expect(minted.extractionType).toBeUndefined();
      expect(minted.observed_state).toBeUndefined();
      expect(minted.data).toBeUndefined();
    });

    it("the minted node discloses itself in the text the user reads", async () => {
      const ctx = makeCtx(buildS3Graph());
      await runStageRepair(ctx);

      const v3 = transformGraphToV3(ctx.graph as any);
      const wireNode = (v3.graph.nodes as any[]).find((n) => n.id === SYNTHETIC_BRIDGE_NODE_ID);

      // `description` is the V3 projection of `node.body` and is a declared wire
      // field (schemas/cee-v3.ts) — so this disclosure is not stripped.
      expect(typeof wireNode.description).toBe("string");
      expect(wireNode.description.toLowerCase()).toContain("added by olumi");
      expect(wireNode.description.toLowerCase()).toContain("not from your brief");
      expect(wireNode.label).toMatch(/added by olumi/i);
    });

    it("every edge the repair mints is marked repair/synthetic on the wire", async () => {
      const ctx = makeCtx(buildS3Graph());
      await runStageRepair(ctx);

      const v3 = transformGraphToV3(ctx.graph as any);
      const bridgeEdges = (v3.graph.edges as any[]).filter(
        (e) => e.from === SYNTHETIC_BRIDGE_NODE_ID || e.to === SYNTHETIC_BRIDGE_NODE_ID,
      );
      expect(bridgeEdges.length).toBeGreaterThan(0);
      for (const e of bridgeEdges) {
        expect(e.origin, `edge ${e.from}→${e.to}`).toBe("repair");
        expect(e.provenance_display, `edge ${e.from}→${e.to}`).not.toBe("from_brief");
        expect(e.provenance_display, `edge ${e.from}→${e.to}`).toBe("ai_inferred");
      }
    });

    it("records the mint as a correction so the addition is auditable, not silent", async () => {
      const ctx = makeCtx(buildS3Graph());
      await runStageRepair(ctx);

      const mintRecords = (ctx.__corrections as any[]).filter(
        (c) => c.target?.node_id === SYNTHETIC_BRIDGE_NODE_ID,
      );
      expect(mintRecords.length).toBeGreaterThan(0);
      expect(mintRecords[0].type).toBe("node_added");
      expect(String(mintRecords[0].reason)).toMatch(/synthetic|added by olumi|no outcome/i);
    });

    it("REGRESSION PIN: a from_brief claim on the minted node is refused even if something sets one", async () => {
      // The negative twin of the provenance test. If a future change gives the
      // minted node an `extractionType` that maps to `from_brief`, this must go
      // RED — the check is on the WIRE value, so it cannot be satisfied by
      // renaming an internal field.
      const ctx = makeCtx(buildS3Graph());
      await runStageRepair(ctx);

      const minted = (ctx.graph.nodes as any[]).find((n) => n.id === SYNTHETIC_BRIDGE_NODE_ID);
      (minted as any).extractionType = "explicit"; // simulate the drift

      const v3 = transformGraphToV3(ctx.graph as any);
      const wireNode = (v3.graph.nodes as any[]).find((n) => n.id === SYNTHETIC_BRIDGE_NODE_ID);
      // `mayClaimFromBrief` withholds the claim for a value-free node — so even
      // under the drift the wire must NOT say from_brief. This pins the
      // downstream protection we are relying on, so it cannot be removed
      // silently underneath us.
      expect(wireNode.provenance).not.toBe("from_brief");
    });
  });

  describe("does no harm — the cases where the transformation COULD fire and must not", () => {
    it("leaves a healthy graph that already has an outcome bridge byte-identical", async () => {
      // Trap 22b: a "does no harm" case that cannot trigger the transformation
      // asserts nothing. This graph has a goal, factors and options — every
      // ingredient the repair consumes — and differs ONLY in already having a
      // bridge.
      const graph = buildS3Graph({ includeOutcome: true });
      const before = JSON.parse(JSON.stringify(graph));

      const result = fixTerminalBridge(graph, "V1_FLAT");

      expect(result.repairs).toEqual([]);
      expect(result.bridgeNodeId).toBeUndefined();
      expect(graph).toEqual(before);
    });

    it("does not mint a second bridge when run twice (idempotent)", async () => {
      const graph = buildS3Graph();
      fixTerminalBridge(graph, "V1_FLAT");
      const afterFirst = JSON.parse(JSON.stringify(graph));

      const second = fixTerminalBridge(graph, "V1_FLAT");

      expect(second.repairs).toEqual([]);
      expect(graph).toEqual(afterFirst);
      expect((graph.nodes as any[]).filter((n) => n.kind === "outcome")).toHaveLength(1);
    });

    it("a healthy draft still passes the gate end-to-end after the change", async () => {
      const ctx = makeCtx(buildS3Graph({ includeOutcome: true }));
      await runStageRepair(ctx);

      expect(ctx.earlyReturn).toBeUndefined();
      expect(gateCodes(ctx.graph)).toEqual([]);
      // and no synthetic bridge was added to a graph that did not need one
      expect((ctx.graph.nodes as any[]).some((n) => n.id === SYNTHETIC_BRIDGE_NODE_ID)).toBe(false);
    });

    it("does not fire on a graph with no factors to bridge from", () => {
      // A bridge with no inbound edge would itself be UNREACHABLE_FROM_DECISION —
      // trading one blocking code for another. The repair must decline.
      const graph: any = {
        version: "v1",
        nodes: [
          { id: "dec_main", kind: "decision", label: "D" },
          { id: "opt_a", kind: "option", label: "A" },
          { id: "goal_g", kind: "goal", label: "G" },
        ],
        edges: [
          { id: "e1", from: "dec_main", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
        ],
      };
      expect(needsTerminalBridge(graph)).toBe(false);
      const result = fixTerminalBridge(graph, "V1_FLAT");
      expect(result.repairs).toEqual([]);
    });
  });

  describe("closes the test blindness — the guard is on the GATE, not on a substep", () => {
    it("no STRUCTURAL_EDGE_NOT_CANONICAL_ERROR reaches the real gate through the full runStageRepair", async () => {
      // The pre-existing canonical-direction spec imports `runDeterministicSweep`
      // and therefore proves only that SUBSTEP 1 canonicalises. This asserts the
      // property at the place the product actually fails closed. It is exactly
      // the guard whose absence let the defect ship.
      const ctx = makeCtx(buildS3Graph());
      // in-test precondition: the fixture DOES carry non-canonical structural
      // edges, so a pass here is the code's doing and not the fixture's
      // (trap 13b — pin your own precondition).
      expect(countCodes(gateCodes(ctx.graph))["STRUCTURAL_EDGE_NOT_CANONICAL_ERROR"]).toBeGreaterThan(0);

      await runStageRepair(ctx);

      expect(gateCodes(ctx.graph)).not.toContain("STRUCTURAL_EDGE_NOT_CANONICAL_ERROR");
    });

    it("the same holds for the healthy-shaped draft", async () => {
      const ctx = makeCtx(buildS3Graph({ includeOutcome: true }));
      expect(countCodes(gateCodes(ctx.graph))["STRUCTURAL_EDGE_NOT_CANONICAL_ERROR"]).toBeGreaterThan(0);

      await runStageRepair(ctx);

      expect(gateCodes(ctx.graph)).not.toContain("STRUCTURAL_EDGE_NOT_CANONICAL_ERROR");
    });
  });
});
