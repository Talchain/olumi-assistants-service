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
function buildLiveGraphOutput(): { graphOutput: any; constraintCount: number } {
  const ctx: any = {
    requestId: "test-goal-constraints-wire",
    effectiveBrief: LIVE_BRIEF,
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

function composeWire() {
  const { graphOutput } = buildLiveGraphOutput();

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

describe("draft goal_constraints — THE STRIP (draft-graph-dispatch.ts:261-269)", () => {
  it("characterises the strip: draft_graph is rebuilt to EXACTLY four keys, dropping every sibling", () => {
    const reparsed = JSON.parse(composeWire());

    // The graph itself rode onto the wire — so the assertion below is a
    // targeted claim about goal_constraints, not about an empty response.
    expect(reparsed.draft_graph).toBeDefined();
    expect(reparsed.draft_graph.nodes.length).toBeGreaterThan(0);

    // The rebuild is total: these four keys and nothing else. Written as an
    // exact key-set so that ANY future change to the projection — including
    // the fix — turns this red and forces the author here.
    expect(Object.keys(reparsed.draft_graph).sort()).toEqual([
      "edge_count",
      "edges",
      "node_count",
      "nodes",
    ]);
  });

  it.fails(
    "DESIRED (known-open): goal_constraints survives into the serialized V5 wire bytes",
    () => {
      // `it.fails` pins the defect rather than asserting it away: this flips
      // RED the moment goal_constraints reaches the wire, which is the signal
      // to delete this wrapper and promote it to a normal expectation. It is
      // deliberately NOT a passing "absence" test — an absence asserted as
      // correct is how a defect becomes the spec.
      //
      // Blocked on a contract change, NOT on CEE alone — see the pin below.
      expect(composeWire()).toContain('"goal_constraints"');
    },
  );
});

describe("draft goal_constraints — WHY the one-line fix is blocked (contract pin)", () => {
  it("the pinned egress contract REJECTS goal_constraints inside draft_graph", async () => {
    // Derived from the real pinned schema, never a hand-copied mirror: when
    // @talchain/schemas is bumped to declare the field, this test goes RED and
    // names the follow-up (thread it at draft-graph-dispatch.ts:261-269).
    const { OlumiResponseSchema } = await import("@talchain/schemas/boundary");

    const parsed = OlumiResponseSchema.safeParse({
      response_version: 2,
      assistant_text: "x",
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: "analyse",
      draft_graph: {
        nodes: [],
        edges: [],
        node_count: 0,
        edge_count: 0,
        goal_constraints: [{ node_id: "out_budget_headroom", operator: "<=", value: 50000 }],
      },
    });

    // DraftGraphBlockSchema is `.strict()` with exactly
    // { type, nodes, edges, node_count, edge_count }. Threading the field
    // through the strip WITHOUT a schemas bump would therefore not ship the
    // constraint — it would fail validateEgress and replace every draft
    // response with the EGRESS_CONTRACT_VIOLATION fallback envelope.
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.code === "unrecognized_keys");
      expect(issue).toBeDefined();
      expect((issue as any).keys).toContain("goal_constraints");
      expect(issue!.path).toEqual(["draft_graph"]);
    }
  });
});
