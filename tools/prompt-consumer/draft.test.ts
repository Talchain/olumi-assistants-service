import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  DRAFT_CASE_IDS,
  inspectDraftRecords,
  makeClaimMediatedFixture,
  makeDraftFixture,
  runDraftContractProbe,
  runDraftContractProbes,
  runDraftMutationFamilies,
  verifyAbsentScalar,
  verifyInferredScalar,
  verifyOptionEffect,
  verifyStatedPercent,
} from "./draft.js";

const executed = new Set<string>();
beforeEach(() => expect.hasAssertions());
afterAll(() => {
  expect([...executed].sort()).toEqual([
    "claim-mediated", "collection", "grammar-rejection", "ownership", "participation",
    "scalar", "sets-to", "uncertainty", "unknown",
  ]);
});

describe("draft compatibility probes report actual consumer meaning, not prompt vocabulary", () => {
  it("collects every expected probe exactly once and exposes current failures", () => {
    executed.add("collection");
    const results = runDraftContractProbes();
    expect(results.map(result => result.id)).toEqual(DRAFT_CASE_IDS);
    expect(new Set(results.map(result => result.id)).size).toBe(10);
    expect(results.filter(result => result.status === "FAIL").map(result => result.id)).toEqual([
      "draft.inferred-scalar-ownership", "draft.requested-confidence", "draft.claim-mediated-percent",
    ]);
    expect(results.filter(result => result.status === "PASS")).toHaveLength(7);
    const families = runDraftMutationFamilies();
    expect(families.map(family => family.id)).toEqual([
      "draft.stated-percent", "draft.inferred-scalar", "draft.option-effect",
      "draft.cited-option-effect", "draft.absent-scalar",
    ]);
    for (const family of families) expect(family.status, family.issues.join("; ")).toBe("PASS");
  });

  it("records actual schema, parser, graph validator and final V3 consumer participation", () => {
    executed.add("participation");
    const result = runDraftContractProbe("draft.option-effect");
    expect(result.status).toBe("PASS");
    expect(result.participation.components.map(entry => entry.role).sort()).toEqual([
      "consumer", "graphSchema", "parser", "schema",
    ]);
    for (const entry of result.participation.components) expect(entry.calls).toBeGreaterThan(0);
    expect(result.participation.identity.status).toBe("UNVERIFIED");
  });

  it("required-field rejection is real; unrelated semantic-link captions remain legal", () => {
    executed.add("grammar-rejection");
    expect(runDraftContractProbe("draft.required-fields").status).toBe("PASS");
    expect(runDraftContractProbe("draft.required-fields", fixture => {
      delete (fixture.records.claims[0] as unknown as Record<string, unknown>).label;
    }).status).toBe("FAIL");
    expect(runDraftContractProbe("draft.required-fields", fixture => {
      fixture.records.claims[1]!.label = "Unrelated caption about a teapot";
    }).status).toBe("PASS");
  });

  it("actual scalar carriage fails after semantic deletion, not after unrelated content changes", () => {
    executed.add("scalar");
    expect(runDraftContractProbe("draft.inferred-scalar").status).toBe("PASS");
    expect(runDraftContractProbe("draft.inferred-scalar", fixture => {
      delete fixture.records.claims[0]!.value;
    }).status).toBe("FAIL");
    expect(runDraftContractProbe("draft.inferred-scalar", fixture => {
      fixture.brief += " The office owns a porcelain teapot.";
    }).status).toBe("PASS");
    const fixture = makeDraftFixture();
    const observation = inspectDraftRecords(fixture.records, fixture.brief);
    verifyInferredScalar(observation);
    verifyStatedPercent(observation);
  });

  it("sets_to reaches an actual option effect; source evidence is discriminating", () => {
    executed.add("sets-to");
    expect(runDraftContractProbe("draft.option-effect").status).toBe("PASS");
    expect(runDraftContractProbe("draft.option-effect", fixture => {
      delete fixture.records.claims[1]!.sets_to;
    }).status).toBe("FAIL");
    expect(runDraftContractProbe("draft.option-effect", fixture => {
      fixture.records.claims[2]!.label = "A different explanation of the same relationship";
    }).status).toBe("PASS");
    expect(runDraftContractProbe("draft.cited-option-effect").status).toBe("PASS");
    expect(runDraftContractProbe("draft.cited-option-effect", fixture => {
      delete fixture.records.claims[1]!.basis;
    }).status).toBe("FAIL");
    const fixture = makeDraftFixture();
    verifyOptionEffect(inspectDraftRecords(fixture.records, fixture.brief));
  });

  it("absent scalar remains absent, and an explicit zero is a different state", () => {
    executed.add("unknown");
    expect(runDraftContractProbe("draft.absent-scalar").status).toBe("PASS");
    expect(runDraftContractProbe("draft.absent-scalar", fixture => {
      fixture.records.claims[0]!.value = 0;
    }).status).toBe("FAIL");
    expect(runDraftContractProbe("draft.absent-scalar", fixture => {
      fixture.records.claims[1]!.label = "Unrelated label";
    }).status).toBe("PASS");
    const fixture = makeDraftFixture();
    fixture.records.claims[0]!.value = 0;
    const zero = inspectDraftRecords(fixture.records, fixture.brief);
    expect(zero.consumer?.graph.nodes.find(node => node.label === "Coordination effort")?.observed_state?.value).toBe(0);
    expect(() => verifyAbsentScalar(zero)).toThrow();
  });

  it("requested confidence fails both representability and degradation preservation", () => {
    executed.add("uncertainty");
    const fixture = makeDraftFixture();
    (fixture.records.claims[0] as unknown as Record<string, unknown>).confidence = 0.8;
    const unsupported = inspectDraftRecords(fixture.records, fixture.brief);
    expect(unsupported.schemaAccepted).toBe(false);
    expect(unsupported.seam.ok).toBe(true);
    if (!unsupported.seam.ok) throw new Error(unsupported.seam.reason);
    expect(unsupported.seam.records.claims[0]).not.toHaveProperty("confidence");
    expect(unsupported.consumer?.graph.nodes.find(node => node.label === "Coordination effort")).not.toHaveProperty("confidence");
    expect(runDraftContractProbe("draft.requested-confidence").status).toBe("FAIL");
    expect(runDraftContractProbe("draft.requested-confidence", current => {
      current.brief += " There is a teapot in reception.";
    }).status).toBe("FAIL");
    expect(runDraftContractProbe("draft.inferred-scalar").status).toBe("PASS");
    // Scalar support is intentionally NOT claimed as uncertainty support.
  });

  it("claim-mediated percentage loss stays visible; the direct-stated reference remains correct", () => {
    executed.add("claim-mediated");
    const fixture = makeClaimMediatedFixture();
    const lossy = inspectDraftRecords(fixture.records, fixture.brief);
    expect(lossy.schemaAccepted).toBe(true);
    expect(lossy.seam.ok).toBe(true);
    if (!lossy.seam.ok) throw new Error(lossy.seam.reason);
    expect(lossy.seam.records.stated_items[1]).toMatchObject({ value: 12, unit: "%" });
    const point = lossy.consumer?.graph.nodes.find(node => node.label === "Current churn");
    expect(point).toMatchObject({ scale_frame: 20, observed_state: { value: 0.6, raw_value: 12 }, display_value: "12" });
    expect(point?.observed_state?.unit).toBeUndefined();
    expect(lossy.seam.projection.dropped).toContainEqual(expect.objectContaining({
      reason: "unconnected_to_goal", value: 12, unit: "%",
    }));
    expect(runDraftContractProbe("draft.claim-mediated-percent").status).toBe("FAIL");
    expect(runDraftContractProbe("draft.claim-mediated-percent", current => {
      current.records.claims[1]!.label = "An unrelated causal caption";
    }).status).toBe("FAIL");

    // Change ONLY the semantic endpoint. Basis was supporting evidence, not a
    // declared same-quantity identity; promoting every equal-valued claim would be unsafe.
    delete fixture.records.claims[1]!.from_claim;
    fixture.records.claims[1]!.from_stated = 1;
    const direct = inspectDraftRecords(fixture.records, fixture.brief);
    verifyStatedPercent(direct, "Current churn is 12%.");
  });

  it("does not hide the downstream false-source default behind correct projector provenance", () => {
    executed.add("ownership");
    const result = runDraftContractProbe("draft.inferred-scalar-ownership");
    expect(result.status).toBe("FAIL");
    expect(result.issues.join(" ")).toContain("uncited AI scalar");
    expect(runDraftContractProbe("draft.inferred-scalar-ownership", fixture => {
      fixture.records.claims[2]!.label = "Unrelated label change";
    }).status).toBe("FAIL");
    // Genuine user-owned quantity remains the opposite control.
    expect(runDraftContractProbe("draft.stated-percent").status).toBe("PASS");
    expect(runDraftContractProbe("draft.stated-percent", fixture => {
      delete fixture.records.stated_items[2]!.unit;
    }).status).toBe("FAIL");
  });
});
