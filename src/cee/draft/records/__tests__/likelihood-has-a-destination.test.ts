/**
 * Authored, UNRUN controls. Likelihood retention stops at draft records.
 * These assertions do not establish model behaviour or saved-model retention.
 */
import { describe, expect, it } from "vitest";
import { DRAFT_RECORDS_INSTRUCTION } from "../instruction.js";
import { projectDraftRecords } from "../seam.js";
import {
  ANTHROPIC_OPTIONAL_PARAM_LIMIT,
  SERIALIZED_BYTES_BUDGET,
  buildDraftRecordsSchema,
  countOptionalParams,
  type DraftInferenceClaim,
  type DraftRecordSet,
} from "../grammar.js";

function projectRisk(quantity: Partial<DraftInferenceClaim>) {
  const records: DraftRecordSet = {
    stated_items: [
      { kind: "goal", source_quote: "retain subscribers" },
      { kind: "option", source_quote: "run a retention programme" },
    ],
    claims: [
      { claim_kind: "factor", label: "Support Quality" },
      { claim_kind: "risk", label: "Subscriber Loss", ...quantity },
      { claim_kind: "causal_link", label: "programme improves support", from_stated: 1, to_claim: 0 },
      { claim_kind: "causal_link", label: "support affects loss", from_claim: 0, to_claim: 1 },
      { claim_kind: "causal_link", label: "loss affects retention", from_claim: 1, to_stated: 0 },
    ],
  };
  const result = projectDraftRecords(records);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  const risk = result.projection.graph.nodes.find((node) => node.kind === "risk");
  expect(risk).toBeDefined();
  return { result, risk: risk! };
}

describe("a likelihood is retained only in draft records", () => {
  it("retains the existing grammar budget control", () => {
    const schema = buildDraftRecordsSchema();
    expect(countOptionalParams(schema)).toBeLessThanOrEqual(ANTHROPIC_OPTIONAL_PARAM_LIMIT);
    expect(Buffer.byteLength(JSON.stringify(schema), "utf8")).toBeLessThanOrEqual(SERIALIZED_BYTES_BUDGET);
  });

  it("retains an explicit event probability without minting a measured current value", () => {
    const { result, risk } = projectRisk({ likelihood: 0.04 });
    expect(result.records.claims[1]!.likelihood).toBe(0.04);
    expect(risk.observed_state).toBeUndefined();
    expect(risk.data).toBeUndefined();
    expect(risk).not.toHaveProperty("likelihood");
  });

  it("contrast: the same magnitude explicitly declared as a current rate carries its unit", () => {
    const { result, risk } = projectRisk({ value: 0.04, unit: "%", value_scale: "unit_interval" });
    expect(result.records.claims[1]!.likelihood).toBeUndefined();
    expect(risk.data).toMatchObject({ value: 0.04, raw_value: 4, unit: "%", extractionType: "inferred" });
    expect(risk.observed_state?.baseline).toBeUndefined();
  });

  it("states the retention limit and declines to infer a current level from an ambiguous label", () => {
    const flat = DRAFT_RECORDS_INSTRUCTION.replace(/\s+/g, " ");
    expect(flat).toContain("It is not projected into the saved model or used by analysis");
    expect(flat).toContain('"Churn risk: 4%", "Vendor slippage: 30%" and "Contract loss: 4%"');
    expect(flat).toContain("do not by themselves establish which role the number has");
    expect(flat).toContain("Do not invent a current level merely to make a limit checkable");
  });
});
