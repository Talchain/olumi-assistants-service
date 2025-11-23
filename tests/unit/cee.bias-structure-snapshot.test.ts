import { describe, it, expect } from "vitest";

import type {
  CEEDraftGraphResponseV1,
  CEEBiasCheckResponseV1,
} from "../../sdk/typescript/src/ceeTypes.js";
import type { CeeJourneyEnvelopes } from "../../sdk/typescript/src/ceeHelpers.js";
import { summarizeBiasAndStructureSnapshot } from "../../scripts/cee-bias-structure-snapshot.js";
import { expectNoSecretLikeKeys } from "../utils/no-secret-like-keys.js";

describe("cee-bias-structure-snapshot", () => {
  it("summarizes structural warnings and confidence flags from the draft envelope", () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-draft", correlation_id: "r-draft", engine: {} },
      quality: { overall: 7 } as any,
      graph: {
        nodes: [{ id: "n1", kind: "goal", label: "Should not appear" }],
        edges: [],
      } as any,
      draft_warnings: [
        {
          id: "no_outcome_node",
          severity: "medium",
          node_ids: ["n1"],
          edge_ids: [],
          explanation: "This explanation should not appear in the snapshot",
        } as any,
      ],
      confidence_flags: {
        uncertain_nodes: ["n1"],
        simplification_applied: true,
      } as any,
    } as any;

    const envelopes: CeeJourneyEnvelopes = {
      draft,
    };

    const snapshot = summarizeBiasAndStructureSnapshot(envelopes);

    expect(snapshot.draft).toBeDefined();
    expect(snapshot.draft?.quality_overall).toBe(7);
    expect(typeof snapshot.draft?.quality_band).toBe("string");
    expect(snapshot.draft?.structural_warning_count).toBe(1);

    const byId = snapshot.draft?.structural_warnings_by_id ?? {};
    expect(byId["no_outcome_node"]).toBeDefined();
    expect(byId["no_outcome_node"].count).toBe(1);
    expect(byId["no_outcome_node"].severity).toBe("medium");

    expect(snapshot.draft?.confidence_flags?.simplification_applied).toBe(true);
    expect(snapshot.draft?.confidence_flags?.uncertain_node_count).toBe(1);
  });

  it("summarizes bias findings by severity, category, and code", () => {
    const bias: CEEBiasCheckResponseV1 = {
      trace: { request_id: "r-bias", correlation_id: "r-bias", engine: {} },
      quality: { overall: 6 } as any,
      bias_findings: [
        {
          id: "f1",
          category: "selection",
          severity: "high",
          node_ids: [],
          explanation: "Missing options",
          code: "SELECTION_LOW_OPTION_COUNT",
        } as any,
        {
          id: "f2",
          category: "other",
          severity: "medium",
          node_ids: [],
          explanation: "Confirmation bias",
          code: "CONFIRMATION_BIAS",
        } as any,
        {
          id: "f3",
          category: "other",
          severity: "medium",
          node_ids: [],
          explanation: "Sunk cost",
          code: "SUNK_COST",
        } as any,
      ],
      response_limits: {
        bias_findings_max: 10,
        bias_findings_truncated: false,
      } as any,
    } as any;

    const envelopes: CeeJourneyEnvelopes = {
      bias,
    };

    const snapshot = summarizeBiasAndStructureSnapshot(envelopes);

    expect(snapshot.bias).toBeDefined();
    expect(snapshot.bias?.quality_overall).toBe(6);
    expect(typeof snapshot.bias?.quality_band).toBe("string");
    expect(snapshot.bias?.total_findings).toBe(3);

    expect(snapshot.bias?.by_severity.high).toBe(1);
    expect(snapshot.bias?.by_severity.medium).toBe(2);

    expect(snapshot.bias?.by_category.selection).toBe(1);
    expect(snapshot.bias?.by_category.other).toBe(2);

    expect(snapshot.bias?.by_code["SELECTION_LOW_OPTION_COUNT"]).toBe(1);
    expect(snapshot.bias?.by_code["CONFIRMATION_BIAS"]).toBe(1);
    expect(snapshot.bias?.by_code["SUNK_COST"]).toBe(1);
  });

  it("does not surface free-text labels or explanations in the snapshot", () => {
    const SECRET = "BIAS_STRUCT_SECRET_DO_NOT_LEAK";

    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-secret", correlation_id: "r-secret", engine: {} },
      quality: { overall: 5 } as any,
      graph: {
        nodes: [{ id: "n1", kind: "goal", label: `Goal ${SECRET}` }],
        edges: [],
      } as any,
      draft_warnings: [
        {
          id: "no_outcome_node",
          severity: "medium",
          node_ids: ["n1"],
          edge_ids: [],
          explanation: `Explanation ${SECRET}`,
        } as any,
      ],
    } as any;

    const bias: CEEBiasCheckResponseV1 = {
      trace: { request_id: "r-bias-secret", correlation_id: "r-bias-secret", engine: {} },
      quality: { overall: 6 } as any,
      bias_findings: [
        {
          id: "f1",
          category: "selection",
          severity: "high",
          node_ids: ["n1"],
          explanation: `Bias explanation ${SECRET}`,
          code: "SELECTION_LOW_OPTION_COUNT",
        } as any,
      ],
      response_limits: {
        bias_findings_max: 10,
        bias_findings_truncated: false,
      } as any,
    } as any;

    const envelopes: CeeJourneyEnvelopes = {
      draft,
      bias,
    };

    const snapshot = summarizeBiasAndStructureSnapshot(envelopes);

    // Ensure the summary is metadata-only and does not contain secret-like strings
    expectNoSecretLikeKeys(snapshot);

    const serialized = JSON.stringify(snapshot).toLowerCase();
    expect(serialized.includes(SECRET.toLowerCase())).toBe(false);
  });
});
