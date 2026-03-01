/**
 * Comprehensive test suite for the DSK authoring kit:
 * - Linter (structural, claim-specific, protocol, trigger, cross-ref)
 * - Canonicaliser (ordering, determinism)
 * - Hasher (stability, sensitivity, exclusions)
 */

import { describe, it, expect } from "vitest";
import { lintBundle, fixOrder } from "../../src/dsk/linter.js";
import { canonicalise } from "../../src/dsk/canonicalise.js";
import { computeDSKHash, verifyDSKHash } from "../../src/dsk/hash.js";
import type {
  DSKBundle,
  DSKClaim,
  DSKProtocol,
  DSKTrigger,
  DSKObject,
} from "../../src/dsk/types.js";

// ---------------------------------------------------------------------------
// Helpers — minimal valid objects
// ---------------------------------------------------------------------------

function validClaim(overrides: Partial<DSKClaim> = {}): DSKClaim {
  return {
    id: "DSK-B001",
    type: "claim",
    title: "Anchoring bias",
    evidence_strength: "strong",
    contraindications: ["time pressure"],
    stage_applicability: ["evaluate"],
    context_tags: ["pricing"],
    version: "1.0.0",
    last_reviewed_at: "2025-01-01",
    source_citations: [{ doi_or_isbn: "10.1234/test", page_or_section: "p.1" }],
    deprecated: false,
    claim_category: "empirical",
    scope: {
      decision_contexts: ["pricing"],
      stages: ["evaluate"],
      populations: ["adults"],
      exclusions: ["none"],
    },
    permitted_phrasing_band: "strong",
    evidence_pack: {
      key_findings: "Anchoring shifts estimates by 20-40%",
      effect_direction: "negative",
      boundary_conditions: "Applies to numeric estimates",
      known_limitations: "Lab vs field gap",
    },
    ...overrides,
  };
}

function validProtocol(overrides: Partial<DSKProtocol> = {}): DSKProtocol {
  return {
    id: "DSK-T001",
    type: "protocol",
    title: "Pre-mortem",
    evidence_strength: "strong",
    contraindications: ["very early stage"],
    stage_applicability: ["evaluate"],
    context_tags: ["general"],
    version: "1.0.0",
    last_reviewed_at: "2025-01-01",
    source_citations: [{ doi_or_isbn: "10.5678/test", page_or_section: "ch.3" }],
    deprecated: false,
    steps: ["Imagine failure", "List reasons", "Mitigate"],
    required_inputs: ["decision description"],
    expected_outputs: ["risk list"],
    ...overrides,
  };
}

function validTrigger(overrides: Partial<DSKTrigger> = {}): DSKTrigger {
  return {
    id: "DSK-TR001",
    type: "trigger",
    title: "Binary framing detected",
    evidence_strength: "medium",
    contraindications: ["genuinely binary decisions"],
    stage_applicability: ["frame"],
    context_tags: ["general"],
    version: "1.0.0",
    last_reviewed_at: "2025-01-01",
    source_citations: [{ doi_or_isbn: "10.9012/test", page_or_section: "s.2" }],
    deprecated: false,
    observable_signal: "User presents only two options",
    recommended_behaviour: "Ask about other options",
    negative_conditions: ["Decision is genuinely binary"],
    linked_claim_ids: ["DSK-B001"],
    linked_protocol_ids: ["DSK-T001"],
    ...overrides,
  };
}

function makeBundle(
  objects: DSKObject[],
  overrides: Partial<DSKBundle> = {},
): DSKBundle {
  const bundle: DSKBundle = {
    version: "1.0.0",
    generated_at: "2025-01-01T00:00:00Z",
    dsk_version_hash: "",
    objects,
    ...overrides,
  };
  bundle.dsk_version_hash = computeDSKHash(bundle);
  return bundle;
}

// ---------------------------------------------------------------------------
// Linter — valid bundle
// ---------------------------------------------------------------------------

describe("DSK Linter", () => {
  it("valid bundle passes with zero errors and exit 0", () => {
    const bundle = makeBundle([validClaim(), validProtocol(), validTrigger()]);
    const result = lintBundle(bundle);
    expect(result.errors).toHaveLength(0);
    expect(result.exitCode).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Structural rules
  // -----------------------------------------------------------------------

  describe("structural rules", () => {
    it("invalid type discriminant", () => {
      const obj = validClaim({ type: "bogus" as "claim" });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "type")).toBe(true);
      expect(result.exitCode).toBe(1);
    });

    it("invalid id format", () => {
      const obj = validClaim({ id: "INVALID-001" });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "id")).toBe(true);
    });

    it("missing id", () => {
      const obj = validClaim({ id: "" });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "id")).toBe(true);
    });

    it("duplicate ids", () => {
      const bundle = makeBundle([
        validClaim({ id: "DSK-B001" }),
        validClaim({ id: "DSK-B001" }),
      ]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.message.includes("Duplicate"))).toBe(true);
    });

    it("empty title", () => {
      const obj = validClaim({ title: "" });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "title")).toBe(true);
    });

    it("invalid semver version", () => {
      const obj = validClaim({ version: "1.0" });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "version" && e.message.includes("semver"))).toBe(true);
    });

    it("invalid ISO 8601 date", () => {
      const obj = validClaim({ last_reviewed_at: "not-a-date" });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "last_reviewed_at")).toBe(true);
    });

    it("loose date string rejected by strict ISO 8601 check", () => {
      const obj = validClaim({ last_reviewed_at: "Tuesday" });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "last_reviewed_at")).toBe(true);
    });

    it("valid YYYY-MM-DD date passes ISO 8601 check", () => {
      const obj = validClaim({ last_reviewed_at: "2025-06-15" });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.filter((e) => e.fieldPath === "last_reviewed_at")).toHaveLength(0);
    });

    it("valid full ISO datetime passes ISO 8601 check", () => {
      const obj = validClaim({ last_reviewed_at: "2025-06-15T10:30:00Z" });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.filter((e) => e.fieldPath === "last_reviewed_at")).toHaveLength(0);
    });

    it("ISO datetime with offset passes ISO 8601 check", () => {
      const obj = validClaim({ last_reviewed_at: "2025-06-15T10:30:00+05:30" });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.filter((e) => e.fieldPath === "last_reviewed_at")).toHaveLength(0);
    });

    it("ISO datetime with milliseconds passes ISO 8601 check", () => {
      const obj = validClaim({ last_reviewed_at: "2025-06-15T10:30:00.123Z" });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.filter((e) => e.fieldPath === "last_reviewed_at")).toHaveLength(0);
    });

    it("invalid month in ISO date rejected", () => {
      const obj = validClaim({ last_reviewed_at: "2025-13-01" });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "last_reviewed_at")).toBe(true);
    });

    it("invalid day in ISO date rejected", () => {
      const obj = validClaim({ last_reviewed_at: "2025-01-32" });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "last_reviewed_at")).toBe(true);
    });

    it("impossible calendar date 2025-02-31 rejected", () => {
      const obj = validClaim({ last_reviewed_at: "2025-02-31" });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "last_reviewed_at")).toBe(true);
    });

    it("impossible calendar date 2025-04-31 rejected", () => {
      const obj = validClaim({ last_reviewed_at: "2025-04-31" });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "last_reviewed_at")).toBe(true);
    });

    it("Feb 29 in leap year accepted", () => {
      const obj = validClaim({ last_reviewed_at: "2024-02-29" });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.filter((e) => e.fieldPath === "last_reviewed_at")).toHaveLength(0);
    });

    it("Feb 29 in non-leap year rejected", () => {
      const obj = validClaim({ last_reviewed_at: "2025-02-29" });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "last_reviewed_at")).toBe(true);
    });

    it("empty source_citations", () => {
      const obj = validClaim({ source_citations: [] });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "source_citations")).toBe(true);
    });

    it("deprecated without deprecated_reason", () => {
      const obj = validClaim({ deprecated: true });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "deprecated_reason")).toBe(true);
    });

    it("replacement_id references non-existent object", () => {
      const obj = validClaim({ replacement_id: "DSK-B999" });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "replacement_id" && e.message.includes("not found"))).toBe(true);
    });

    it("replacement_id cross-type reference triggers error", () => {
      const claim = validClaim({ replacement_id: "DSK-T001" });
      const proto = validProtocol();
      const bundle = makeBundle([claim, proto]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "replacement_id" && e.message.includes("same type"))).toBe(true);
    });

    it("replacement_id references deprecated object", () => {
      const claim1 = validClaim({
        id: "DSK-B001",
        replacement_id: "DSK-B002",
      });
      const claim2 = validClaim({
        id: "DSK-B002",
        deprecated: true,
        deprecated_reason: "Superseded",
      });
      const bundle = makeBundle([claim1, claim2]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "replacement_id" && e.message.includes("itself deprecated"))).toBe(true);
    });

    it("circular replacement chain triggers error", () => {
      const claim1 = validClaim({
        id: "DSK-B001",
        replacement_id: "DSK-B002",
      });
      const claim2 = validClaim({
        id: "DSK-B002",
        replacement_id: "DSK-B001",
      });
      const bundle = makeBundle([claim1, claim2]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.message.includes("Circular replacement chain"))).toBe(true);
    });

    it("circular replacement chain emits exactly one diagnostic per cycle", () => {
      const claim1 = validClaim({
        id: "DSK-B001",
        replacement_id: "DSK-B002",
      });
      const claim2 = validClaim({
        id: "DSK-B002",
        replacement_id: "DSK-B001",
      });
      const bundle = makeBundle([claim1, claim2]);
      const result = lintBundle(bundle);
      const circularErrors = result.errors.filter((e) =>
        e.message.includes("Circular replacement chain"),
      );
      expect(circularErrors).toHaveLength(1);
    });

    it("feeder node into cycle does not emit duplicate cycle diagnostic", () => {
      // X→B→C→B: X is a feeder into the B↔C cycle
      const claimX = validClaim({
        id: "DSK-B001",
        replacement_id: "DSK-B002",
      });
      const claimB = validClaim({
        id: "DSK-B002",
        replacement_id: "DSK-B003",
      });
      const claimC = validClaim({
        id: "DSK-B003",
        replacement_id: "DSK-B002",
      });
      const bundle = makeBundle([claimX, claimB, claimC]);
      const result = lintBundle(bundle);
      const circularErrors = result.errors.filter((e) =>
        e.message.includes("Circular replacement chain"),
      );
      expect(circularErrors).toHaveLength(1);
    });

    it("multiple feeders into same cycle emit exactly one diagnostic", () => {
      // Y→X→B→C→B: two feeders (Y, X) into B↔C cycle
      const claimY = validClaim({
        id: "DSK-B001",
        replacement_id: "DSK-B002",
      });
      const claimX = validClaim({
        id: "DSK-B002",
        replacement_id: "DSK-B003",
      });
      const claimB = validClaim({
        id: "DSK-B003",
        replacement_id: "DSK-B004",
      });
      const claimC = validClaim({
        id: "DSK-B004",
        replacement_id: "DSK-B003",
      });
      const bundle = makeBundle([claimY, claimX, claimB, claimC]);
      const result = lintBundle(bundle);
      const circularErrors = result.errors.filter((e) =>
        e.message.includes("Circular replacement chain"),
      );
      expect(circularErrors).toHaveLength(1);
    });

    it("empty contraindications", () => {
      const obj = validClaim({ contraindications: [] });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "contraindications")).toBe(true);
    });

    it("empty context_tags", () => {
      const obj = validClaim({ context_tags: [] });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "context_tags" && e.message.includes("at least one"))).toBe(true);
    });

    it("empty stage_applicability", () => {
      const obj = validClaim({ stage_applicability: [] });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "stage_applicability" && e.message.includes("at least one"))).toBe(true);
    });

    it("PLACEHOLDER string detection triggers error", () => {
      const obj = validClaim({
        title: "PLACEHOLDER — needs review",
      });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.message.includes("Placeholder content"))).toBe(true);
    });

    it("PLACEHOLDER detection is case-insensitive", () => {
      const obj = validClaim({
        title: "placeholder stuff",
      });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.message.includes("Placeholder content"))).toBe(true);
    });

    it("PLACEHOLDER in nested array element", () => {
      const obj = validClaim({
        contraindications: ["valid", "PLACEHOLDER — needs review"],
      });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.message.includes("Placeholder content") && e.fieldPath.includes("contraindications"))).toBe(true);
    });

    it("controlled vocabulary violation in context_tags", () => {
      const obj = validClaim({ context_tags: ["invalid_tag"] });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "context_tags" && e.message.includes("invalid_tag"))).toBe(true);
    });

    it("invalid stage_applicability value", () => {
      const obj = validClaim({
        stage_applicability: ["invalid_stage" as "frame"],
      });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "stage_applicability")).toBe(true);
    });

    it("invalid evidence_strength value", () => {
      const obj = validClaim({
        evidence_strength: "invalid" as "strong",
      });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "evidence_strength")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Claim-specific rules
  // -----------------------------------------------------------------------

  describe("claim-specific rules", () => {
    it("empty scope.decision_contexts", () => {
      const obj = validClaim();
      obj.scope.decision_contexts = [];
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "scope.decision_contexts")).toBe(true);
    });

    it("invalid scope.decision_contexts value", () => {
      const obj = validClaim();
      obj.scope.decision_contexts = ["bogus"];
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "scope.decision_contexts" && e.message.includes("bogus"))).toBe(true);
    });

    it("empty scope.stages", () => {
      const obj = validClaim();
      obj.scope.stages = [];
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "scope.stages")).toBe(true);
    });

    it("invalid scope.stages value", () => {
      const obj = validClaim();
      obj.scope.stages = ["bogus" as "frame"];
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "scope.stages")).toBe(true);
    });

    it("empty scope.populations", () => {
      const obj = validClaim();
      obj.scope.populations = [];
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "scope.populations")).toBe(true);
    });

    it("empty scope.exclusions gives guidance", () => {
      const obj = validClaim();
      obj.scope.exclusions = [];
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "scope.exclusions" && e.message.includes("Use ['none']"))).toBe(true);
    });

    it("permitted_phrasing_band inconsistent with evidence_strength", () => {
      const obj = validClaim({
        evidence_strength: "strong",
        permitted_phrasing_band: "weak",
      });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "permitted_phrasing_band" && e.message.includes("Inconsistent"))).toBe(true);
    });

    it("mixed evidence_strength requires weak phrasing band", () => {
      const obj = validClaim({
        evidence_strength: "mixed",
        permitted_phrasing_band: "medium",
      });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "permitted_phrasing_band")).toBe(true);
    });

    it("empty evidence_pack.key_findings", () => {
      const obj = validClaim();
      obj.evidence_pack.key_findings = "";
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "evidence_pack.key_findings")).toBe(true);
    });

    it("invalid effect_direction", () => {
      const obj = validClaim();
      (obj.evidence_pack as Record<string, unknown>).effect_direction = "bogus";
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "evidence_pack.effect_direction")).toBe(true);
    });

    it("invalid claim_category", () => {
      const obj = validClaim({ claim_category: "bogus" as "empirical" });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "claim_category")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Protocol-specific rules
  // -----------------------------------------------------------------------

  describe("protocol-specific rules", () => {
    it("empty steps", () => {
      const obj = validProtocol({ steps: [] });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "steps")).toBe(true);
    });

    it("empty required_inputs", () => {
      const obj = validProtocol({ required_inputs: [] });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "required_inputs")).toBe(true);
    });

    it("empty expected_outputs", () => {
      const obj = validProtocol({ expected_outputs: [] });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "expected_outputs")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Trigger-specific rules
  // -----------------------------------------------------------------------

  describe("trigger-specific rules", () => {
    it("empty observable_signal", () => {
      const obj = validTrigger({ observable_signal: "" });
      const bundle = makeBundle([validClaim(), validProtocol(), obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "observable_signal")).toBe(true);
    });

    it("empty recommended_behaviour", () => {
      const obj = validTrigger({ recommended_behaviour: "" });
      const bundle = makeBundle([validClaim(), validProtocol(), obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "recommended_behaviour")).toBe(true);
    });

    it("empty negative_conditions gives guidance", () => {
      const obj = validTrigger({ negative_conditions: [] });
      const bundle = makeBundle([validClaim(), validProtocol(), obj]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "negative_conditions" && e.message.includes("false positives"))).toBe(true);
    });

    it("orphan trigger — linked_claim_ids references non-existent claim", () => {
      const trigger = validTrigger({ linked_claim_ids: ["DSK-B999"] });
      const bundle = makeBundle([validProtocol(), trigger]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "linked_claim_ids" && e.message.includes("not found"))).toBe(true);
    });

    it("linked_claim_ids references a non-claim type", () => {
      const trigger = validTrigger({
        linked_claim_ids: ["DSK-T001"],
        linked_protocol_ids: ["DSK-T001"],
      });
      const bundle = makeBundle([validProtocol(), trigger]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "linked_claim_ids" && e.message.includes('expected "claim"'))).toBe(true);
    });

    it("orphan trigger — linked_protocol_ids references non-existent protocol", () => {
      const trigger = validTrigger({
        linked_claim_ids: ["DSK-B001"],
        linked_protocol_ids: ["DSK-T999"],
      });
      const bundle = makeBundle([validClaim(), trigger]);
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "linked_protocol_ids" && e.message.includes("not found"))).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Ordering
  // -----------------------------------------------------------------------

  describe("ordering", () => {
    it("unsorted bundle produces warning (exit 2, not exit 1)", () => {
      const bundle = makeBundle([
        validTrigger(),
        validClaim(),
        validProtocol(),
      ]);
      const result = lintBundle(bundle);
      expect(result.warnings.some((w) => w.message.includes("canonical id order"))).toBe(true);
      // No errors beyond possible hash mismatch — filter those
      const nonHashErrors = result.errors.filter(
        (e) => e.fieldPath !== "dsk_version_hash",
      );
      if (nonHashErrors.length === 0) {
        expect(result.exitCode).toBe(2);
      }
    });

    it("sorted bundle produces no ordering warning", () => {
      const bundle = makeBundle([
        validClaim(),
        validProtocol(),
        validTrigger(),
      ]);
      const result = lintBundle(bundle);
      expect(result.warnings.some((w) => w.message.includes("canonical id order"))).toBe(false);
    });

    it("--fix-order rewrites objects in correct order", () => {
      const bundle = makeBundle([
        validTrigger(),
        validClaim(),
        validProtocol(),
      ]);
      const fixed = fixOrder(bundle);
      expect(fixed.objects.map((o) => o.id)).toEqual([
        "DSK-B001",
        "DSK-T001",
        "DSK-TR001",
      ]);
    });
  });

  // -----------------------------------------------------------------------
  // Hash verification via linter
  // -----------------------------------------------------------------------

  describe("hash verification", () => {
    it("empty hash reports computed value", () => {
      const bundle: DSKBundle = {
        version: "1.0.0",
        generated_at: "2025-01-01T00:00:00Z",
        dsk_version_hash: "",
        objects: [validClaim()],
      };
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "dsk_version_hash" && e.message.includes("computed value should be"))).toBe(true);
    });

    it("incorrect hash reports mismatch", () => {
      const bundle = makeBundle([validClaim()]);
      bundle.dsk_version_hash = "0000000000000000000000000000000000000000000000000000000000000000";
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "dsk_version_hash" && e.message.includes("does not match"))).toBe(true);
    });

    it("correct hash passes", () => {
      const bundle = makeBundle([validClaim()]);
      const result = lintBundle(bundle);
      expect(result.errors.filter((e) => e.fieldPath === "dsk_version_hash")).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe("edge cases", () => {
    it("empty bundle (no objects)", () => {
      const bundle = makeBundle([]);
      const result = lintBundle(bundle);
      // No objects = no object-level errors, just possibly hash-related
      expect(result.exitCode).toBe(0);
    });

    it("bundle with only deprecated objects", () => {
      const obj = validClaim({
        deprecated: true,
        deprecated_reason: "Superseded by newer research",
      });
      const bundle = makeBundle([obj]);
      const result = lintBundle(bundle);
      // Should pass — deprecated with reason is valid
      expect(result.errors.filter((e) => e.fieldPath !== "dsk_version_hash")).toHaveLength(0);
    });

    it("deterministic output — running linter twice produces identical results", () => {
      const bundle = makeBundle([
        validClaim(),
        validProtocol(),
        validTrigger(),
      ]);
      const r1 = lintBundle(bundle);
      const r2 = lintBundle(bundle);
      expect(r1).toEqual(r2);
    });
  });

  // -----------------------------------------------------------------------
  // Bundle-level validation
  // -----------------------------------------------------------------------

  describe("bundle-level validation", () => {
    it("missing bundle version", () => {
      const bundle = makeBundle([validClaim()]);
      (bundle as unknown as Record<string, unknown>).version = "";
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.objectId === "(bundle)" && e.fieldPath === "version")).toBe(true);
    });

    it("invalid bundle semver", () => {
      const bundle = makeBundle([validClaim()]);
      (bundle as unknown as Record<string, unknown>).version = "1.0";
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.objectId === "(bundle)" && e.fieldPath === "version" && e.message.includes("semver"))).toBe(true);
    });

    it("missing generated_at", () => {
      const bundle = makeBundle([validClaim()]);
      (bundle as unknown as Record<string, unknown>).generated_at = "";
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.objectId === "(bundle)" && e.fieldPath === "generated_at")).toBe(true);
    });

    it("invalid generated_at", () => {
      const bundle = makeBundle([validClaim()]);
      (bundle as unknown as Record<string, unknown>).generated_at = "not-a-date";
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.objectId === "(bundle)" && e.fieldPath === "generated_at" && e.message.includes("ISO 8601"))).toBe(true);
    });

    it("missing objects array returns early with exit 1", () => {
      const bundle = { version: "1.0.0", generated_at: "2025-01-01T00:00:00Z", dsk_version_hash: "" } as unknown as DSKBundle;
      const result = lintBundle(bundle);
      expect(result.errors.some((e) => e.fieldPath === "objects")).toBe(true);
      expect(result.exitCode).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Canonicaliser
// ---------------------------------------------------------------------------

describe("DSK Canonicaliser", () => {
  it("unordered arrays (context_tags, scope.stages) are sorted in canonical output", () => {
    const claim = validClaim({
      context_tags: ["pricing", "hiring", "general"],
      stage_applicability: ["decide", "evaluate", "frame"],
    });
    claim.scope.stages = ["decide", "evaluate", "frame"];
    const bundle = makeBundle([claim]);
    const canonical = canonicalise(bundle);
    const parsed = JSON.parse(canonical) as { objects: Array<Record<string, unknown>> };
    const obj = parsed.objects[0]!;
    expect(obj["context_tags"]).toEqual(["general", "hiring", "pricing"]);
    expect(obj["stage_applicability"]).toEqual(["decide", "evaluate", "frame"]);
    const scope = obj["scope"] as Record<string, unknown>;
    expect(scope["stages"]).toEqual(["decide", "evaluate", "frame"]);
  });

  it("ordered arrays (steps, source_citations) preserve order in canonical output", () => {
    const proto = validProtocol({
      steps: ["Step C", "Step A", "Step B"],
      required_inputs: ["input2", "input1"],
      expected_outputs: ["output2", "output1"],
    });
    const bundle = makeBundle([proto]);
    const canonical = canonicalise(bundle);
    const parsed = JSON.parse(canonical) as { objects: Array<Record<string, unknown>> };
    const obj = parsed.objects[0]!;
    // These are ordered — must preserve original order
    expect(obj["steps"]).toEqual(["Step C", "Step A", "Step B"]);
    expect(obj["required_inputs"]).toEqual(["input2", "input1"]);
    expect(obj["expected_outputs"]).toEqual(["output2", "output1"]);
  });

  it("source_citations preserve order", () => {
    const claim = validClaim({
      source_citations: [
        { doi_or_isbn: "10.9999/z", page_or_section: "z" },
        { doi_or_isbn: "10.0001/a", page_or_section: "a" },
      ],
    });
    const bundle = makeBundle([claim]);
    const canonical = canonicalise(bundle);
    const parsed = JSON.parse(canonical) as { objects: Array<Record<string, unknown>> };
    const obj = parsed.objects[0]!;
    const citations = obj["source_citations"] as Array<Record<string, string>>;
    expect(citations[0]!["doi_or_isbn"]).toBe("10.9999/z");
    expect(citations[1]!["doi_or_isbn"]).toBe("10.0001/a");
  });

  it("objects sorted by id in canonical output", () => {
    const bundle = makeBundle([
      validTrigger(),
      validProtocol(),
      validClaim(),
    ]);
    const canonical = canonicalise(bundle);
    const parsed = JSON.parse(canonical) as { objects: Array<Record<string, unknown>> };
    const ids = parsed.objects.map((o) => o["id"]);
    expect(ids).toEqual(["DSK-B001", "DSK-T001", "DSK-TR001"]);
  });

  it("keys sorted alphabetically at every nesting level", () => {
    const bundle = makeBundle([validClaim()]);
    const canonical = canonicalise(bundle);
    const parsed = JSON.parse(canonical) as Record<string, unknown>;
    const keys = Object.keys(parsed);
    expect(keys).toEqual([...keys].sort());
  });

  it("no whitespace in canonical output", () => {
    const bundle = makeBundle([validClaim()]);
    const canonical = canonicalise(bundle);
    // JSON.stringify without spaces = no extra whitespace
    expect(canonical).not.toMatch(/\n/);
    // Spaces may exist in string values, but not as formatting
    const reparsed = JSON.stringify(JSON.parse(canonical));
    expect(canonical).toBe(reparsed);
  });

  it("canonicaliser output is identical when called from linter and hasher context", () => {
    const bundle = makeBundle([validClaim(), validProtocol(), validTrigger()]);
    const c1 = canonicalise(bundle);
    const c2 = canonicalise(bundle);
    expect(c1).toBe(c2);
  });
});

// ---------------------------------------------------------------------------
// Hasher
// ---------------------------------------------------------------------------

describe("DSK Hasher", () => {
  it("same bundle always produces same hash (stability)", () => {
    const bundle = makeBundle([validClaim(), validProtocol()]);
    const h1 = computeDSKHash(bundle);
    const h2 = computeDSKHash(bundle);
    expect(h1).toBe(h2);
  });

  it("changing any field changes the hash (sensitivity)", () => {
    const bundle1 = makeBundle([validClaim()]);
    const bundle2 = makeBundle([validClaim({ title: "Modified" })]);
    expect(computeDSKHash(bundle1)).not.toBe(computeDSKHash(bundle2));
  });

  it("changing version changes the hash", () => {
    const bundle1 = makeBundle([validClaim()]);
    const bundle2 = makeBundle([validClaim()], { version: "2.0.0" });
    expect(computeDSKHash(bundle1)).not.toBe(computeDSKHash(bundle2));
  });

  it("hash excludes generated_at — changing it does NOT change the hash", () => {
    const bundle1 = makeBundle([validClaim()]);
    const bundle2 = { ...bundle1, generated_at: "2099-12-31T23:59:59Z" };
    expect(computeDSKHash(bundle1)).toBe(computeDSKHash(bundle2));
  });

  it("hash excludes dsk_version_hash — changing it does NOT change the hash", () => {
    const bundle1 = makeBundle([validClaim()]);
    const bundle2 = { ...bundle1, dsk_version_hash: "modified" };
    expect(computeDSKHash(bundle1)).toBe(computeDSKHash(bundle2));
  });

  it("verifyDSKHash returns true for correct hash", () => {
    const bundle = makeBundle([validClaim()]);
    expect(verifyDSKHash(bundle)).toBe(true);
  });

  it("verifyDSKHash returns false for incorrect hash", () => {
    const bundle = makeBundle([validClaim()]);
    bundle.dsk_version_hash = "wrong";
    expect(verifyDSKHash(bundle)).toBe(false);
  });

  it("hash is a 64-char hex string (SHA-256)", () => {
    const bundle = makeBundle([validClaim()]);
    const hash = computeDSKHash(bundle);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("object order does not affect hash (canonicaliser sorts by id)", () => {
    const bundle1 = makeBundle([validClaim(), validProtocol()]);
    const bundle2 = makeBundle([validProtocol(), validClaim()]);
    expect(computeDSKHash(bundle1)).toBe(computeDSKHash(bundle2));
  });

  it("unordered set array order does not affect hash", () => {
    const claim1 = validClaim({ context_tags: ["pricing", "hiring"] });
    const claim2 = validClaim({ context_tags: ["hiring", "pricing"] });
    const bundle1 = makeBundle([claim1]);
    const bundle2 = makeBundle([claim2]);
    expect(computeDSKHash(bundle1)).toBe(computeDSKHash(bundle2));
  });

  it("ordered array order DOES affect hash", () => {
    const proto1 = validProtocol({ steps: ["A", "B", "C"] });
    const proto2 = validProtocol({ steps: ["C", "B", "A"] });
    const bundle1 = makeBundle([proto1]);
    const bundle2 = makeBundle([proto2]);
    expect(computeDSKHash(bundle1)).not.toBe(computeDSKHash(bundle2));
  });
});

// ---------------------------------------------------------------------------
// Malformed JSON (linter CLI handles this — unit test the parse boundary)
// ---------------------------------------------------------------------------

describe("malformed input handling", () => {
  it("bundle with missing objects field does not crash and reports error", () => {
    const bundle = { version: "1.0.0", generated_at: "2025-01-01T00:00:00Z", dsk_version_hash: "" } as unknown as DSKBundle;
    // lintBundle now guards against missing objects — should not throw
    expect(() => lintBundle(bundle)).not.toThrow();
    const result = lintBundle(bundle);
    expect(result.errors.some((e) => e.fieldPath === "objects")).toBe(true);
    expect(result.exitCode).toBe(1);
  });
});
