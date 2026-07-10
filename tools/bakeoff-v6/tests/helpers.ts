import type { BlindCandidate, CandidateRecord } from "../src/types.ts";

/** Minimal candidate satisfying the full CEEGraphResponseV3 contract. */
export function makeValidCandidate(): Record<string, unknown> {
  return {
    schema_version: "3.0",
    nodes: [
      { id: "goal_1", kind: "goal", label: "Deliver CRM capability on time" },
      { id: "dec_1", kind: "decision", label: "Buy vs build" },
      { id: "opt_buy", kind: "option", label: "Buy commercial CRM" },
      { id: "opt_build", kind: "option", label: "Build custom CRM" },
      { id: "fac_cost", kind: "factor", label: "Total cost" },
      { id: "out_time", kind: "outcome", label: "Time to market" },
    ],
    edges: [
      mkEdge("dec_1", "opt_buy"),
      mkEdge("dec_1", "opt_build"),
      mkEdge("opt_buy", "fac_cost"),
      mkEdge("opt_build", "fac_cost"),
      mkEdge("fac_cost", "out_time", "negative"),
      mkEdge("out_time", "goal_1"),
    ],
    options: [
      { id: "opt_buy", label: "Buy commercial CRM", status: "needs_user_mapping", interventions: {} },
      { id: "opt_build", label: "Build custom CRM", status: "needs_user_mapping", interventions: {} },
    ],
    goal_node_id: "goal_1",
  };
}

/**
 * A v8 LLM-BOUNDARY draft candidate: the shape M1 actually emits at run time —
 * nodes (options are kind:"option" nodes) + edges, and NO top-level options[],
 * goal_node_id or schema_version. This is what mergeProposals receives on every
 * live arm-C run; the V3-shaped makeValidCandidate() masked the base.options deref.
 */
export function makeV8DraftCandidate(): Record<string, unknown> {
  const v3 = makeValidCandidate();
  const { options, goal_node_id, schema_version, ...v8 } = v3 as Record<string, unknown>;
  void options; void goal_node_id; void schema_version;
  return v8;
}

export function mkEdge(
  from: string,
  to: string,
  direction: "positive" | "negative" = "positive"
): Record<string, unknown> {
  return {
    from,
    to,
    strength: { mean: direction === "positive" ? 0.5 : -0.5, std: 0.2 },
    exists_probability: 0.9,
    effect_direction: direction,
  };
}

export const TEST_BRIEF =
  "Should we buy a commercial CRM system or build our own? We need to launch within 6 months with a budget of $200k.";

export function makeBlind(overrides?: Partial<BlindCandidate>): BlindCandidate {
  return {
    blind_id: "B001",
    brief: TEST_BRIEF,
    graph: {
      nodes: [
        { id: "goal_1", kind: "goal", label: "Deliver CRM capability" },
        { id: "dec_1", kind: "decision", label: "Buy vs build" },
        { id: "opt_buy", kind: "option", label: "Buy commercial CRM" },
        { id: "opt_build", kind: "option", label: "Build custom CRM" },
        { id: "fac_cost", kind: "factor", label: "Total budget cost" },
        { id: "out_launch", kind: "outcome", label: "Launch within six months" },
      ],
      edges: [
        blindEdge("dec_1", "opt_buy"),
        blindEdge("dec_1", "opt_build"),
        blindEdge("opt_buy", "fac_cost"),
        blindEdge("opt_build", "fac_cost"),
        blindEdge("fac_cost", "out_launch", "negative"),
        blindEdge("out_launch", "goal_1"),
      ],
      options: [
        { id: "opt_buy", label: "Buy commercial CRM", status: "needs_user_mapping", interventions: [] },
        { id: "opt_build", label: "Build custom CRM", status: "needs_user_mapping", interventions: [] },
      ],
      goal_node_id: "goal_1",
    },
    open_questions: [],
    ...overrides,
  };
}

function blindEdge(from: string, to: string, direction: "positive" | "negative" = "positive") {
  return {
    from,
    to,
    strength_mean: direction === "positive" ? 0.5 : -0.5,
    strength_std: 0.2,
    exists_probability: 0.9,
    effect_direction: direction,
  };
}

export function makeRecord(overrides?: Partial<CandidateRecord>): CandidateRecord {
  return {
    record_version: 1,
    run_id: "test-run",
    arm: "A",
    brief_id: "buy-vs-build",
    seed: 17,
    prompt_hashes: { "arm-a.system.txt": "deadbeef" },
    prompt_placeholder: true,
    requested_models: ["claude-sonnet-4-6"],
    served_models: ["claude-sonnet-4-6-mock"],
    calls: [],
    cost_usd_total: 0.01,
    candidate: makeValidCandidate(),
    validation: { valid: true, errors: [] },
    arm_c: null,
    arm_d: null,
    artifacts: [],
    failure: null,
    timing: { started_at: "2026-07-02T00:00:00Z", finished_at: "2026-07-02T00:00:01Z", total_latency_ms: 1000 },
    canonical_hash: "",
    ...overrides,
  };
}
