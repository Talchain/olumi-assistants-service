/**
 * Deterministic fixture client — no network, no keys.
 *
 * Drives the whole pipeline in --mock (smoke) mode: same purpose + model +
 * user content always produce the same reply, so the deterministic paths
 * (merge, validation, scoring, blinding, report) can be proven byte-identical
 * across runs. Output produced here is NEVER meaningful — the report
 * watermark is forced on in mock mode by construction (placeholder prompts +
 * no preflight attestation).
 */
import { sha256Hex } from "../util/stable.ts";
import type { LlmCallRequest, LlmCallResult, LlmClient } from "./client.ts";

function mockGraphCandidate(seedTag: string, opts?: { inventValue?: boolean; danglingEdge?: boolean }): unknown {
  const nodes = [
    { id: "goal_1", kind: "goal", label: `Achieve the outcome (${seedTag})` },
    { id: "dec_1", kind: "decision", label: "Core decision" },
    { id: "opt_a", kind: "option", label: "Option A" },
    { id: "opt_b", kind: "option", label: "Option B" },
    { id: "fac_cost", kind: "factor", label: "Total cost" },
    { id: "out_success", kind: "outcome", label: "Successful delivery" },
  ];
  if (opts?.inventValue) {
    nodes.push({
      id: "fac_market",
      kind: "factor",
      label: "Market size",
      observed_state: { value: 987654, unit: "EUR", source: "cee_inference" },
    } as never);
  }
  const edges = [
    edge("dec_1", "opt_a"),
    edge("dec_1", "opt_b"),
    edge("opt_a", "fac_cost"),
    edge("opt_b", "fac_cost"),
    edge("fac_cost", "out_success", "negative"),
    edge("out_success", "goal_1"),
  ];
  if (opts?.danglingEdge) edges.push(edge("fac_ghost", "goal_1"));
  return {
    schema_version: "3.0",
    nodes,
    edges,
    options: [
      { id: "opt_a", label: "Option A", status: "needs_user_mapping", interventions: {} },
      { id: "opt_b", label: "Option B", status: "needs_user_mapping", interventions: {} },
    ],
    goal_node_id: "goal_1",
  };
}

function edge(from: string, to: string, direction: "positive" | "negative" = "positive") {
  return {
    from,
    to,
    strength: { mean: direction === "positive" ? 0.5 : -0.5, std: 0.2 },
    exists_probability: 0.9,
    effect_direction: direction,
  };
}

function mockProposals(): unknown[] {
  return [
    {
      type: "added_risk",
      delta: {
        node: { id: "risk_adoption", kind: "risk", label: "Low user adoption" },
        edge: {
          from: "risk_adoption",
          to: "out_success",
          strength: { mean: -0.4, std: 0.2 },
          exists_probability: 0.8,
          effect_direction: "negative",
        },
        question: null,
      },
      evidence_pointer: "brief: launch/adoption stakes",
      rationale: "Adoption risk is implied by the launch framing.",
    },
    {
      type: "clarification_proposal",
      delta: { node: null, edge: null, question: "What is the acceptable payback period?" },
      evidence_pointer: "brief: budget constraint",
      rationale: "Budget is stated but payback horizon is not.",
    },
    {
      // Deliberately invalid: dangling edge endpoint — must be RECORDED as a
      // merge failure (never silently dropped, never crashing the run).
      type: "added_causal_link",
      delta: {
        node: null,
        edge: {
          from: "fac_nonexistent",
          to: "goal_1",
          strength: { mean: 0.3, std: 0.2 },
          exists_probability: 0.7,
          effect_direction: "positive",
        },
        question: null,
      },
      evidence_pointer: "brief: (smoke fixture invalid proposal)",
      rationale: "Smoke fixture: exercises failure accounting.",
    },
  ];
}

export class MockLlmClient implements LlmClient {
  readonly name = "mock";

  async call(req: LlmCallRequest): Promise<LlmCallResult> {
    const seedTag = sha256Hex(`${req.purpose}|${req.model}|${req.userContent}`).slice(0, 8);
    let payload: unknown;
    let iterations: unknown[] | null = null;
    if (req.purpose.startsWith("arm-c-critique")) {
      // Object-root wire shape { proposals: [...] } — lockstep with arm-c.ts,
      // which requires the object root (mirrors live m2-review.ts).
      payload = { proposals: mockProposals() };
    } else if (req.purpose.startsWith("holistic")) {
      payload = {
        coherence: 6,
        brief_coverage: 6,
        decision_usefulness: 6,
        parsimony: 7,
        overall: 6,
        rationale: "Deterministic mock holistic verdict (smoke only).",
      };
    } else {
      payload = mockGraphCandidate(seedTag);
    }
    if (req.purpose.startsWith("arm-d")) {
      // Advisor-tool shape: top-level usage deliberately covers ONLY the final
      // executor pass; the true cost lives in usage.iterations[] (executor +
      // advisor sub-inference). Mirrors the real accounting trap.
      iterations = [
        { type: "message", model: req.model, input_tokens: 900, output_tokens: 700 },
        { type: "advisor_message", model: "claude-opus-4-8", input_tokens: 400, output_tokens: 300 },
      ];
    }
    const text = JSON.stringify(payload, null, 2);
    return {
      text,
      contentBlockTypes: req.purpose.startsWith("arm-d") ? ["advisor_tool_result", "text"] : ["text"],
      content: [{ type: "text", text }],
      servedModel: `${req.model}-mock`,
      stopReason: "end_turn",
      usage: {
        input_tokens: 1000,
        output_tokens: 800,
        ...(iterations ? { iterations } : {}),
      },
      iterations,
      latencyMs: 0,
    };
  }
}
