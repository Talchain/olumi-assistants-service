/**
 * draft goal_constraints[] — survival onto the V5 `/orchestrate/v2/turn` WIRE.
 *
 * WHY THIS FILE EXISTS (it is NOT a duplicate of
 * cee.draft-goal-constraints-egress.test.ts):
 *
 * The #512 egress test asserts survival into `JSON.stringify(transformResponse
 * ToV3(...))` — the INTERNAL V3 pipeline body. That body is the response of
 * `/assist/v1/draft-graph`, and on that endpoint the field genuinely survives:
 * `CEEGraphResponseV3` declares `goal_constraints` at its root, so the V3
 * boundary parse keeps it. That test is correct about what it measures.
 *
 * It is NOT the live V5 wire. On `/orchestrate/v2/turn` the V3 body is only an
 * intermediate: it is consumed by `orchestrator/tools/draft-graph.ts`, turned
 * into a `DraftGraphResult`, and then RE-PROJECTED into an `OlumiResponse` by
 * `draftResultToOlumiResponse` in draft-graph-dispatch.ts. That projection is
 * where the field dies, and the #512 test stops one hop short of it. Live
 * staging logs (build 311676e) show `cee.compound_goal.integrated
 * constraint_count:1 from_regex:1` on turns whose wire response has no
 * goal_constraints anywhere — the #512 test stayed green throughout.
 *
 * This file pins the remaining hop end-to-end and records the contract
 * blocker that stops the obvious fix.
 */

import { describe, it, expect } from "vitest";

import { runCompoundGoals } from "../../src/cee/unified-pipeline/stages/repair/compound-goals.js";
import { transformResponseToV3 } from "../../src/cee/transforms/schema-v3.js";
import { draftResultToOlumiResponse } from "../../src/orchestrator-v5/handlers/draft-graph-dispatch.js";

/**
 * Mirrors the live staging scenario: a brief carrying a hard budget cap, and
 * a graph whose nodes are the remap targets the live logs named
 * (`out_budget_headroom` / `risk_budget_breach`).
 *
 * The brief text is the REAL one from the live turns, so the DETERMINISTIC
 * REGEX extractor fires — matching the live `from_regex:1 from_llm:0`. No LLM
 * constraint is supplied anywhere in this file: the regex path alone must
 * carry the field to the wire.
 */
const LIVE_BRIEF =
  "Should we launch the new product this year? " +
  "Hard constraint: first-year budget cannot exceed £50,000 — " +
  "anything over is unaffordable, full stop.";

/**
 * Same decision, no hard constraint. Drives the omission case: the extractor
 * finds nothing, so the projection must omit the key entirely rather than
 * emit an empty array.
 */
const NO_CONSTRAINT_BRIEF =
  "Should we launch the new product this year? " +
  "We would like it to go well and are weighing the options.";

function makeGraph() {
  return {
    nodes: [
      { id: "g1", kind: "goal", label: "Launch Successfully" },
      { id: "d1", kind: "decision", label: "Launch?" },
      { id: "opt_a", kind: "option", label: "Launch now" },
      { id: "fac_year_budget", kind: "factor", label: "First-Year Budget" },
      { id: "out_budget_headroom", kind: "outcome", label: "Budget Headroom" },
    ],
    edges: [
      { from: "d1", to: "opt_a", strength_mean: 1 },
      { from: "opt_a", to: "fac_year_budget", strength_mean: 0.5 },
      { from: "fac_year_budget", to: "out_budget_headroom", strength_mean: 0.5 },
      { from: "out_budget_headroom", to: "g1", strength_mean: 0.5 },
    ],
  };
}

/**
 * Reproduces the LIVE chain from the compound-goal integration point to the
 * object `draft-graph.ts` hands the V5 dispatcher as `graphOutput`.
 *
 * Every hop here is the real production function or the real production
 * expression — no fixtures are hand-assembled downstream of the extractor:
 *   compound-goals.runCompoundGoals   (ctx.goalConstraints)
 *   package.ts:406                    (goal_constraints as a SIBLING of graph)
 *   schema-v3.transformResponseToV3   (V1 root -> V3 root)
 *   draft-graph.ts:300                (`body.graph ?? body`)
 */
function buildLiveGraphOutput(
  brief: string = LIVE_BRIEF,
): { graphOutput: any; constraintCount: number } {
  const ctx: any = {
    requestId: "test-goal-constraints-wire",
    effectiveBrief: brief,
    graph: makeGraph(),
    goalConstraints: undefined,
    // Live turns reported from_llm:0 — the model contributed nothing.
    llmGoalConstraints: undefined,
  };

  runCompoundGoals(ctx);

  // package.ts:406 — goal_constraints rides as a SIBLING of `graph`, never
  // inside it. This sibling placement is what makes the next hop load-bearing.
  const v1Response: any = {
    graph: ctx.graph,
    goal_constraints: ctx.goalConstraints,
    rationales: [],
    confidence: 0.5,
  };

  const v3Body: any = transformResponseToV3(v1Response, { requestId: ctx.requestId });

  // draft-graph.ts:300 — `const graph = body.graph ?? body`. CEEGraphResponseV3
  // is FLAT (nodes/edges at root, no `graph` key), so `body.graph` is undefined
  // and the whole V3 body becomes the graph. isGraphV3() is a loose duck-type
  // (Array.isArray(nodes) && Array.isArray(edges)), so the body passes and
  // graphOutput ends up carrying the root-level goal_constraints.
  const graphOutput = v3Body.graph ?? v3Body;

  return {
    graphOutput,
    constraintCount: Array.isArray(ctx.goalConstraints) ? ctx.goalConstraints.length : 0,
  };
}

/** Minimal MessageTurnPayload the composer reads (scenario_id + stage). */
const PAYLOAD: any = {
  scenario_id: "scn_test",
  turn_id: "turn_test",
  stage: "frame",
  message: LIVE_BRIEF,
};

describe("draft goal_constraints — the chain UP TO the V5 projection (controls)", () => {
  it("POSITIVE CONTROL: the regex extractor alone populates goal_constraints (from_llm:0, from_regex:1)", () => {
    const { constraintCount } = buildLiveGraphOutput();

    // If this ever goes to 0 the absence assertions below become vacuous —
    // they would pass by testing nothing. This is the presence proof that
    // makes the strip assertion meaningful.
    expect(constraintCount).toBeGreaterThan(0);
  });

  it("graphOutput handed to the V5 dispatcher STILL carries goal_constraints", () => {
    const { graphOutput } = buildLiveGraphOutput();

    // Proves the strip is NOT upstream of the dispatcher: everything the
    // #512 test covers is genuinely working, and the field is still present
    // on the object the V5 path receives.
    expect(Array.isArray(graphOutput.goal_constraints)).toBe(true);
    expect(graphOutput.goal_constraints.length).toBeGreaterThan(0);
  });
});

function composeWire(brief: string = LIVE_BRIEF) {
  const { graphOutput } = buildLiveGraphOutput(brief);

  const result: any = {
    graphOutput,
    assistantText: null,
    analysisReady: null,
    strengthenItems: [],
    coachingSummary: null,
    coachingBiasSignals: [],
    coachingWideningLogObject: null,
  };

  // The REAL composer that builds the `/orchestrate/v2/turn` response body.
  const response = draftResultToOlumiResponse(result, PAYLOAD, true, "req_test");

  // Serialize for real: `undefined` vanishes silently through JSON emission,
  // so an object-level assertion can pass on a value the client never sees.
  return JSON.stringify(response);
}

describe("draft goal_constraints — THE PROJECTION (draft-graph-dispatch.ts:261-269)", () => {
  it("draft_graph carries EXACTLY the four base keys PLUS goal_constraints", () => {
    const reparsed = JSON.parse(composeWire());

    // The graph itself rode onto the wire — so the assertion below is a
    // targeted claim about goal_constraints, not about an empty response.
    expect(reparsed.draft_graph).toBeDefined();
    expect(reparsed.draft_graph.nodes.length).toBeGreaterThan(0);

    // Exact key-set, so ANY future change to the projection turns this red
    // and forces the author here. Was the four base keys before the fix;
    // goal_constraints is the fifth and the only addition.
    expect(Object.keys(reparsed.draft_graph).sort()).toEqual([
      "edge_count",
      "edges",
      "goal_constraints",
      "node_count",
      "nodes",
    ]);
  });

  it("goal_constraints survives into the serialized V5 wire BYTES", () => {
    // Promoted from the `it.fails` pin landed by PR #514, which characterised
    // this exact assertion as known-open. It is asserted against the
    // SERIALIZED bytes on purpose: `undefined` vanishes silently through JSON
    // emission, so an object-level assertion can pass on a value the client
    // never receives.
    const wire = composeWire();
    expect(wire).toContain('"goal_constraints"');

    const reparsed = JSON.parse(wire);
    const constraints = reparsed.draft_graph.goal_constraints;
    expect(Array.isArray(constraints)).toBe(true);
    expect(constraints.length).toBeGreaterThan(0);

    // The payload is the real extracted constraint, not an empty husk: the
    // budget cap from the brief, bound to a node that exists in the graph.
    const c = constraints[0];
    expect(typeof c.constraint_id).toBe("string");
    expect(["<=", ">="]).toContain(c.operator);
    expect(typeof c.value).toBe("number");
    // node_id must resolve against the sibling nodes array — the contract
    // states CEE drops any constraint that does not.
    const nodeIds = reparsed.draft_graph.nodes.map((n: any) => n.id);
    expect(nodeIds).toContain(c.node_id);
  });

  it("OMISSION: a brief with no constraint omits the key ENTIRELY (never `[]`)", () => {
    // Byte-identity guarantee for the flag-off / no-constraint case: the
    // pre-0.18.0 wire had four keys and no goal_constraints, and a brief that
    // carries no hard constraint must still produce exactly that. Emitting an
    // empty array instead would change every no-constraint response on the
    // wire for no benefit.
    const wire = composeWire(NO_CONSTRAINT_BRIEF);
    const reparsed = JSON.parse(wire);

    // Positive control: the graph still rode onto the wire, so this is a
    // targeted absence claim and not a vacuous assertion about an empty body.
    expect(reparsed.draft_graph.nodes.length).toBeGreaterThan(0);

    expect(Object.keys(reparsed.draft_graph).sort()).toEqual([
      "edge_count",
      "edges",
      "node_count",
      "nodes",
    ]);
    expect(wire).not.toContain('"goal_constraints"');
  });
});

describe("draft goal_constraints — the contract pin (now UNBLOCKED at 0.18.0)", () => {
  /**
   * The inverse of the pin PR #514 landed. That pin asserted the contract
   * REJECTED the field and named the blocker; at @talchain/schemas 0.18.0 it
   * is declared, so the pin is inverted rather than deleted — the seam keeps
   * a live assertion in both directions.
   */
  const baseResponse = {
    response_version: 2,
    assistant_text: "x",
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: "analyse",
  };

  it("the pinned egress contract ACCEPTS goal_constraints inside draft_graph", async () => {
    // Derived from the real pinned schema, never a hand-copied mirror. If the
    // pin is ever rolled back below 0.18.0 this goes RED and names the cause.
    const { OlumiResponseSchema } = await import("@talchain/schemas/boundary");

    const parsed = OlumiResponseSchema.safeParse({
      ...baseResponse,
      draft_graph: {
        nodes: [],
        edges: [],
        node_count: 0,
        edge_count: 0,
        goal_constraints: [
          {
            constraint_id: "constraint_out_budget_headroom_max",
            node_id: "out_budget_headroom",
            operator: "<=",
            value: 50000,
          },
        ],
      },
    });

    expect(parsed.success).toBe(true);
    // Survives the parse rather than merely passing it — a schema can accept
    // a key and still strip it, which would be the same silent loss.
    if (parsed.success) {
      expect(parsed.data.draft_graph?.goal_constraints).toHaveLength(1);
    }
  });

  it("STRICTNESS RETAINED: an unrecognised sibling key is still rejected", async () => {
    // The fix for a dropped field at this seam is to DECLARE it, never to
    // loosen the block to passthrough. Without this assertion the test above
    // would also pass under a blanket `.passthrough()`, which would silently
    // re-open every other dropped-sibling defect at this seam.
    const { OlumiResponseSchema } = await import("@talchain/schemas/boundary");

    const parsed = OlumiResponseSchema.safeParse({
      ...baseResponse,
      draft_graph: {
        nodes: [],
        edges: [],
        node_count: 0,
        edge_count: 0,
        goal_constraints: [],
        totally_undeclared_key: true,
      },
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.code === "unrecognized_keys");
      expect(issue).toBeDefined();
      expect((issue as any).keys).toContain("totally_undeclared_key");
      expect(issue!.path).toEqual(["draft_graph"]);
    }
  });

  it("the REAL validateEgress passes the composed response (no EGRESS_CONTRACT_VIOLATION)", async () => {
    // The production egress validator, not a re-implementation. This is the
    // gate that would have replaced the whole draft response with the
    // EGRESS_CONTRACT_VIOLATION fallback envelope had the field been threaded
    // without the contract bump — so it is the assertion that proves the fix
    // actually ships rather than merely type-checks.
    const { validateEgress } = await import("../../src/validators/b1.js");

    const { graphOutput } = buildLiveGraphOutput();
    const response = draftResultToOlumiResponse(
      {
        graphOutput,
        assistantText: null,
        analysisReady: null,
        strengthenItems: [],
        coachingSummary: null,
        coachingBiasSignals: [],
        coachingWideningLogObject: null,
      } as any,
      PAYLOAD,
      true,
      "req_egress",
    );

    const egress: any = validateEgress(response, "req_egress");

    // Positive control: the response we are validating genuinely carries the
    // field, so a pass here is a pass ON the constraint-bearing payload.
    expect((response as any).draft_graph.goal_constraints.length).toBeGreaterThan(0);

    expect(egress.ok).toBe(true);
    const blocks = (egress.response ?? response).blocks ?? [];
    expect(
      blocks.some((b: any) => b?.error_code === "EGRESS_CONTRACT_VIOLATION"),
    ).toBe(false);
  });
});
