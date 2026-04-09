/**
 * Tests for resolveInsightEntities() — replaces raw entity IDs
 * with human-readable labels in insight descriptions.
 */

import { describe, it, expect, vi } from "vitest";
import { resolveInsightEntities } from "../../../../src/orchestrator/deterministic/response-assembler.legacy.js";
import type { LLMInsight, EntityRegistry, EntityEntry } from "../../../../src/orchestrator/deterministic/types.js";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

function makeRegistry(entries: Array<[string, Partial<EntityEntry>]>): EntityRegistry {
  const nodes = new Map<string, EntityEntry>();
  for (const [id, partial] of entries) {
    nodes.set(id, {
      id,
      label: partial.label ?? id,
      kind: partial.kind ?? 'factor',
      aliases: [],
      is_action_target: false,
      ...partial,
    } as EntityEntry);
  }
  return { nodes, edges: [], option_ids: [], goal_id: null };
}

describe("resolveInsightEntities", () => {
  const registry = makeRegistry([
    ["fac_hiring_cost", { label: "Hiring Cost" }],
    ["fac_talent_market", { label: "Talent Market" }],
    ["opt_remote", { label: "Remote Hiring" }],
    ["goal_revenue", { label: "Revenue Growth" }],
    ["dec_expand", { label: "Expansion Decision" }],
    ["out_market_share", { label: "Market Share" }],
    ["risk_churn", { label: "Churn Risk" }],
    ["con_budget", { label: "Budget Constraint" }],
  ]);

  it("replaces fac_ IDs in description with labels", () => {
    const insight: LLMInsight = {
      type: "assumption_risk",
      description: "Given fac_hiring_cost and fac_talent_market are both external and uncertain",
      severity: "warning",
    };
    const result = resolveInsightEntities(insight, registry);
    expect(result.description).toBe(
      "Given Hiring Cost and Talent Market are both external and uncertain",
    );
  });

  it("replaces opt_, goal_, dec_, out_, risk_, con_ IDs in description", () => {
    const insight: LLMInsight = {
      type: "missing_perspective",
      description: "opt_remote impacts goal_revenue through risk_churn",
      severity: "info",
    };
    const result = resolveInsightEntities(insight, registry);
    expect(result.description).toBe(
      "Remote Hiring impacts Revenue Growth through Churn Risk",
    );
  });

  it("leaves target_id unchanged (programmatic reference)", () => {
    const insight: LLMInsight = {
      type: "assumption_risk",
      description: "Hiring Cost is highly uncertain",
      severity: "warning",
      target_id: "fac_hiring_cost",
    };
    const result = resolveInsightEntities(insight, registry);
    expect(result.target_id).toBe("fac_hiring_cost");
  });

  it("leaves unknown IDs unchanged in description", () => {
    const insight: LLMInsight = {
      type: "structural_gap",
      description: "The fac_unknown factor is missing",
      severity: "info",
    };
    const result = resolveInsightEntities(insight, registry);
    expect(result.description).toBe("The fac_unknown factor is missing");
  });

  it("handles insight with no description gracefully", () => {
    const insight: LLMInsight = {
      type: "opportunity",
      description: "",
      severity: "info",
    };
    const result = resolveInsightEntities(insight, registry);
    expect(result.description).toBe("");
  });

  it("does not mutate the original insight object", () => {
    const original: LLMInsight = {
      type: "assumption_risk",
      description: "The fac_hiring_cost factor is key",
      severity: "warning",
      target_id: "fac_hiring_cost",
    };
    const result = resolveInsightEntities(original, registry);
    expect(original.description).toBe("The fac_hiring_cost factor is key");
    expect(result.description).toBe("The Hiring Cost factor is key");
  });

  // --- Colon and hyphen ID regression fixtures ---

  it("resolves colon-separated IDs (fac:pricing)", () => {
    const reg = makeRegistry([["fac:pricing", { label: "Pricing Sensitivity" }]]);
    const insight: LLMInsight = {
      type: "assumption_risk",
      description: "The fac:pricing factor drives uncertainty",
      severity: "warning",
    };
    const result = resolveInsightEntities(insight, reg);
    expect(result.description).toBe("The Pricing Sensitivity factor drives uncertainty");
  });

  it("resolves hyphen-separated IDs (fac-cost)", () => {
    const reg = makeRegistry([["fac-cost", { label: "Total Cost" }]]);
    const insight: LLMInsight = {
      type: "assumption_risk",
      description: "The fac-cost is too high",
      severity: "warning",
    };
    const result = resolveInsightEntities(insight, reg);
    expect(result.description).toBe("The Total Cost is too high");
  });

  it("resolves mixed separator IDs (fac_cost-benefit)", () => {
    const reg = makeRegistry([["fac_cost-benefit", { label: "Cost-Benefit Ratio" }]]);
    const insight: LLMInsight = {
      type: "opportunity",
      description: "Consider the fac_cost-benefit when deciding",
      severity: "info",
    };
    const result = resolveInsightEntities(insight, reg);
    expect(result.description).toBe("Consider the Cost-Benefit Ratio when deciding");
  });
});
