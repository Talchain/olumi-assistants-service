/**
 * Unit tests for the V3 provenance display mappers.
 *
 * These project the internal extractionType / provenance.source enums into
 * the UI's display vocabulary (from_brief / ai_inferred / user_set).
 */
import { describe, it, expect } from "vitest";
import {
  nodeProvenanceDisplay,
  edgeProvenanceDisplay,
} from "../../src/cee/transforms/provenance-display.js";

describe("nodeProvenanceDisplay", () => {
  it("maps explicit/observed extractionType to from_brief", () => {
    expect(nodeProvenanceDisplay("explicit")).toBe("from_brief");
    expect(nodeProvenanceDisplay("observed")).toBe("from_brief");
  });

  it("maps inferred/range extractionType to ai_inferred", () => {
    expect(nodeProvenanceDisplay("inferred")).toBe("ai_inferred");
    expect(nodeProvenanceDisplay("range")).toBe("ai_inferred");
  });

  it("falls back to ai_inferred for absent or unknown extractionType", () => {
    expect(nodeProvenanceDisplay(undefined)).toBe("ai_inferred");
    expect(nodeProvenanceDisplay(null)).toBe("ai_inferred");
    expect(nodeProvenanceDisplay("")).toBe("ai_inferred");
    expect(nodeProvenanceDisplay("something_unknown")).toBe("ai_inferred");
  });

  it("falls back to ai_inferred for non-string inputs", () => {
    expect(nodeProvenanceDisplay(42)).toBe("ai_inferred");
    expect(nodeProvenanceDisplay({})).toBe("ai_inferred");
    expect(nodeProvenanceDisplay([])).toBe("ai_inferred");
  });
});

describe("edgeProvenanceDisplay", () => {
  it("maps brief_extraction to from_brief", () => {
    expect(edgeProvenanceDisplay("brief_extraction")).toBe("from_brief");
  });

  it("maps user_specified to user_set", () => {
    expect(edgeProvenanceDisplay("user_specified")).toBe("user_set");
  });

  it("maps cee_hypothesis and domain_knowledge to ai_inferred", () => {
    expect(edgeProvenanceDisplay("cee_hypothesis")).toBe("ai_inferred");
    expect(edgeProvenanceDisplay("domain_knowledge")).toBe("ai_inferred");
  });

  it("falls back to ai_inferred for absent / unknown source", () => {
    expect(edgeProvenanceDisplay(undefined)).toBe("ai_inferred");
    expect(edgeProvenanceDisplay(null)).toBe("ai_inferred");
    expect(edgeProvenanceDisplay("")).toBe("ai_inferred");
    expect(edgeProvenanceDisplay("something_unknown")).toBe("ai_inferred");
  });
});
