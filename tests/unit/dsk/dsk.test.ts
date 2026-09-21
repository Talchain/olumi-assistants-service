/**
 * DSK authoring kit — comprehensive test suite.
 *
 * Tests the linter, canonicaliser, and hasher.
 * In-memory bundles are used throughout to avoid filesystem coupling;
 * file-loading is tested separately via a small helper.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { lintBundle, fixOrder } from "../../../src/dsk/linter.js";
import { computeDSKHash, verifyDSKHash } from "../../../src/dsk/hash.js";
import { canonicalise } from "../../../src/dsk/canonicalise.js";
import type {
  DSKBundle,
  DSKClaim,
  DSKProtocol,
  DSKTrigger,
  DSKObject,
} from "../../../src/dsk/types.js";
import { DSK_ID_REGEX } from "../../../src/dsk/types.js";

// ---------------------------------------------------------------------------
// Shared vocab for tests
// ---------------------------------------------------------------------------

const VOCAB = [
  "pricing",
  "hiring",
  "build_vs_buy",
  "general",
  "investment",
];

// ---------------------------------------------------------------------------
// Minimal valid object builders
// ---------------------------------------------------------------------------

function makeClaim(overrides: Partial<DSKClaim> = {}): DSKClaim {
  return {
    id: "DSK-B-001",
    type: "claim",
    title: "Test bias",
    evidence_strength: "strong",
    contraindications: ["not applicable in X"],
    stage_applicability: ["evaluate"],
    context_tags: ["general"],
    version: "1.0.0",
    last_reviewed_at: "2026-01-01",
    source_citations: [{ doi_or_isbn: "10.1000/xyz", page_or_section: "p. 1" }],
    deprecated: false,
    claim_category: "empirical",
    scope: {
      decision_contexts: ["general"],
      stages: ["evaluate"],
      populations: ["adults"],
      exclusions: ["none"],
    },
    permitted_phrasing_band: "strong",
    evidence_pack: {
      key_findings: "Some key findings",
      effect_direction: "positive",
      boundary_conditions: "Some boundaries",
      known_limitations: "Some limitations",
    },
    ...overrides,
  };
}

function makeProtocol(overrides: Partial<DSKProtocol> = {}): DSKProtocol {
  return {
    id: "DSK-P-001",
    type: "protocol",
    title: "Test protocol",
    evidence_strength: "medium",
    contraindications: ["not in time-critical decisions"],
    stage_applicability: ["evaluate"],
    context_tags: ["general"],
    version: "1.0.0",
    last_reviewed_at: "2026-01-01",
    source_citations: [{ doi_or_isbn: "10.1000/abc", page_or_section: "p. 5" }],
    deprecated: false,
    steps: ["Step 1", "Step 2"],
    required_inputs: ["Decision statement"],
    expected_outputs: ["Revised decision"],
    ...overrides,
  };
}

function makeTrigger(overrides: Partial<DSKTrigger> = {}): DSKTrigger {
  return {
    id: "DSK-TR-001",
    type: "trigger",
    title: "Test trigger",
    evidence_strength: "medium",
    contraindications: ["not when X"],
    stage_applicability: ["frame"],
    context_tags: ["general"],
    version: "1.0.0",
    last_reviewed_at: "2026-01-01",
    source_citations: [{ doi_or_isbn: "10.1000/def", page_or_section: "p. 10" }],
    deprecated: false,
    observable_signal: "User uses binary framing",
    recommended_behaviour: "Suggest more options",
    negative_conditions: ["Already considering multiple options"],
    linked_claim_ids: [],
    linked_protocol_ids: [],
    ...overrides,
  };
}

function makeBundle(objects: DSKObject[], overrides: Partial<DSKBundle> = {}): DSKBundle {
  const bundle: DSKBundle = {
    version: "1.0.0",
    generated_at: "2026-01-01",
    dsk_version_hash: "",
    objects,
    ...overrides,
  };
  bundle.dsk_version_hash = computeDSKHash(bundle);
  return bundle;
}

// ---------------------------------------------------------------------------
// 1. Valid bundle passes with zero errors
// ---------------------------------------------------------------------------

describe("Valid bundle", () => {
  it("passes with zero errors and exit 0", () => {
    const bundle = makeBundle([makeClaim()]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.exitCode).toBe(0);
  });

  it("valid protocol passes", () => {
    const bundle = makeBundle([makeProtocol()]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors).toHaveLength(0);
    expect(result.exitCode).toBe(0);
  });

  it("valid trigger passes", () => {
    const bundle = makeBundle([makeTrigger()]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors).toHaveLength(0);
    expect(result.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. ID format validation
// ---------------------------------------------------------------------------

describe("ID format", () => {
  it.each([
    "DSK-B-001",
    "DSK-T-001",
    "DSK-F-001",
    "DSK-G-001",
    "DSK-P-001",
    "DSK-TR-001",
    "DSK-B-999",
    "DSK-TR-099",
  ])("accepts valid id %s", (id) => {
    expect(DSK_ID_REGEX.test(id)).toBe(true);
  });

  it.each([
    "DSK-B001",    // missing hyphen before number
    "DSK-T001",
    "DSK-TR001",
    "dsk-b-001",   // lowercase
    "DSK-B-01",    // only 2 digits
    "DSK-B-0001",  // 4 digits
    "DSK-X-001",   // unknown prefix
    "DSK-B-",      // no number
    "DSKB001",     // no separators
  ])("rejects invalid id %s", (id) => {
    expect(DSK_ID_REGEX.test(id)).toBe(false);
  });

  it("reports error for invalid id format in bundle", () => {
    const claim = makeClaim({ id: "DSK-B001" }); // missing hyphen
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    const idError = result.errors.find((e) => e.fieldPath === "id");
    expect(idError).toBeDefined();
    expect(idError!.message).toContain("Invalid id format");
  });

  it("reports error for duplicate ids", () => {
    const c1 = makeClaim({ id: "DSK-B-001" });
    const c2 = makeClaim({ id: "DSK-B-001", title: "Another claim" });
    const bundle = makeBundle([c1, c2]);
    const result = lintBundle(bundle, VOCAB);
    const dupError = result.errors.find((e) => e.message.includes("Duplicate id"));
    expect(dupError).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Required fields — structural checks
// ---------------------------------------------------------------------------

describe("Structural validation — required fields", () => {
  it("reports error for missing title", () => {
    const claim = makeClaim({ title: "" });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "title")).toBe(true);
  });

  it("reports error for whitespace-only title", () => {
    const claim = makeClaim({ title: "   " });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "title")).toBe(true);
  });

  it("reports error for invalid semver version", () => {
    const claim = makeClaim({ version: "1.0" }); // not semver
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "version" && e.objectId === "DSK-B-001")).toBe(true);
  });

  it("reports error for invalid ISO 8601 date", () => {
    const claim = makeClaim({ last_reviewed_at: "01/01/2026" });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "last_reviewed_at")).toBe(true);
  });

  it("rejects impossible calendar date (2025-02-30)", () => {
    const claim = makeClaim({ last_reviewed_at: "2025-02-30" });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "last_reviewed_at")).toBe(true);
  });

  it("reports error for empty source_citations", () => {
    const claim = makeClaim({ source_citations: [] });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "source_citations")).toBe(true);
  });

  it("reports error for empty contraindications", () => {
    const claim = makeClaim({ contraindications: [] });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "contraindications")).toBe(true);
  });

  it("reports error for empty context_tags", () => {
    const claim = makeClaim({ context_tags: [] });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "context_tags")).toBe(true);
  });

  it("reports error for empty stage_applicability", () => {
    const claim = makeClaim({ stage_applicability: [] });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "stage_applicability")).toBe(true);
  });

  it("reports error for invalid stage_applicability value", () => {
    const claim = makeClaim({ stage_applicability: ["invalid_stage" as never] });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "stage_applicability")).toBe(true);
  });

  it("reports error for deprecated object without deprecated_reason", () => {
    const claim = makeClaim({ deprecated: true, deprecated_reason: undefined });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "deprecated_reason")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. PLACEHOLDER detection
// ---------------------------------------------------------------------------

describe("PLACEHOLDER detection", () => {
  it("reports error for PLACEHOLDER in string field", () => {
    const claim = makeClaim({
      evidence_pack: {
        key_findings: "PLACEHOLDER — needs review",
        effect_direction: "positive",
        boundary_conditions: "Some boundaries",
        known_limitations: "Some limitations",
      },
    });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.message.includes("Placeholder content"))).toBe(true);
  });

  it("PLACEHOLDER is case-insensitive", () => {
    const claim = makeClaim({ title: "placeholder value" });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.message.includes("Placeholder content"))).toBe(true);
  });

  it("reports error for PLACEHOLDER in nested array", () => {
    const claim = makeClaim({ contraindications: ["PLACEHOLDER — needs review"] });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.message.includes("Placeholder content"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Context tags — vocabulary validation
// ---------------------------------------------------------------------------

describe("Context tags", () => {
  it("reports error for invalid context tag", () => {
    const claim = makeClaim({ context_tags: ["unknown_tag"] });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "context_tags" && e.message.includes("unknown_tag"))).toBe(true);
  });

  it("accepts valid context tags from vocabulary", () => {
    const claim = makeClaim({ context_tags: ["pricing", "hiring"] });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.filter((e) => e.fieldPath === "context_tags")).toHaveLength(0);
  });

  it("reports error for duplicate context_tags", () => {
    const claim = makeClaim({ context_tags: ["general", "general"] });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "context_tags" && e.message.includes("Duplicate"))).toBe(true);
  });

  it("uses custom vocabulary when provided", () => {
    const customVocab = ["custom_tag"];
    const claim = makeClaim({ context_tags: ["custom_tag"] });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, customVocab);
    expect(result.errors.filter((e) => e.fieldPath === "context_tags")).toHaveLength(0);
  });

  it("reports error with custom vocabulary when tag not in it", () => {
    const customVocab = ["custom_tag"];
    const claim = makeClaim({ context_tags: ["general"] }); // general not in customVocab
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, customVocab);
    expect(result.errors.some((e) => e.fieldPath === "context_tags" && e.message.includes("general"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Claim-specific validation
// ---------------------------------------------------------------------------

describe("Claim validation", () => {
  it("reports error for empty scope.decision_contexts", () => {
    const claim = makeClaim({ scope: { decision_contexts: [], stages: ["evaluate"], populations: ["adults"], exclusions: ["none"] } });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "scope.decision_contexts")).toBe(true);
  });

  it("reports error for decision_context not in vocabulary", () => {
    const claim = makeClaim({ scope: { decision_contexts: ["not_valid"], stages: ["evaluate"], populations: ["adults"], exclusions: ["none"] } });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "scope.decision_contexts")).toBe(true);
  });

  it("accepts scope.decision_contexts: ['all'] as special value", () => {
    const claim = makeClaim({ scope: { decision_contexts: ["all"], stages: ["evaluate"], populations: ["adults"], exclusions: ["none"] } });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.filter((e) => e.fieldPath === "scope.decision_contexts")).toHaveLength(0);
  });

  it("reports error for empty scope.stages", () => {
    const claim = makeClaim({ scope: { decision_contexts: ["general"], stages: [], populations: ["adults"], exclusions: ["none"] } });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "scope.stages")).toBe(true);
  });

  it("reports error for empty scope.populations", () => {
    const claim = makeClaim({ scope: { decision_contexts: ["general"], stages: ["evaluate"], populations: [], exclusions: ["none"] } });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "scope.populations")).toBe(true);
  });

  it("reports error for empty scope.exclusions with guidance", () => {
    const claim = makeClaim({ scope: { decision_contexts: ["general"], stages: ["evaluate"], populations: ["adults"], exclusions: [] } });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    const e = result.errors.find((e) => e.fieldPath === "scope.exclusions");
    expect(e).toBeDefined();
    expect(e!.message).toContain("none");
  });

  it("accepts scope.exclusions: ['none'] (explicitly universal)", () => {
    const claim = makeClaim({ scope: { decision_contexts: ["general"], stages: ["evaluate"], populations: ["adults"], exclusions: ["none"] } });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.filter((e) => e.fieldPath === "scope.exclusions")).toHaveLength(0);
  });

  it("reports error for empty evidence_pack.key_findings", () => {
    const claim = makeClaim({
      evidence_pack: { key_findings: "", effect_direction: "positive", boundary_conditions: "x", known_limitations: "y" },
    });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "evidence_pack.key_findings")).toBe(true);
  });

  // Phrasing band directional validation
  it("phrasing band: strong evidence + strong phrasing = valid", () => {
    const claim = makeClaim({ evidence_strength: "strong", permitted_phrasing_band: "strong" });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.filter((e) => e.fieldPath === "permitted_phrasing_band")).toHaveLength(0);
  });

  it("phrasing band: strong evidence + medium phrasing = valid (conservative)", () => {
    const claim = makeClaim({ evidence_strength: "strong", permitted_phrasing_band: "medium" });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.filter((e) => e.fieldPath === "permitted_phrasing_band")).toHaveLength(0);
  });

  it("phrasing band: strong evidence + weak phrasing = error (below medium floor for strong)", () => {
    // Brief: strong evidence → strong or medium only
    const claim = makeClaim({ evidence_strength: "strong", permitted_phrasing_band: "weak" });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "permitted_phrasing_band")).toBe(true);
  });

  it("phrasing band: medium evidence + strong phrasing = error (exceeds)", () => {
    const claim = makeClaim({ evidence_strength: "medium", permitted_phrasing_band: "strong" });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    const e = result.errors.find((e) => e.fieldPath === "permitted_phrasing_band");
    expect(e).toBeDefined();
    expect(e!.message).toContain("exceeds evidence strength");
  });

  it("phrasing band: medium evidence + medium phrasing = valid", () => {
    const claim = makeClaim({ evidence_strength: "medium", permitted_phrasing_band: "medium" });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.filter((e) => e.fieldPath === "permitted_phrasing_band")).toHaveLength(0);
  });

  it("phrasing band: medium evidence + weak phrasing = valid (conservative)", () => {
    const claim = makeClaim({ evidence_strength: "medium", permitted_phrasing_band: "weak" });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.filter((e) => e.fieldPath === "permitted_phrasing_band")).toHaveLength(0);
  });

  it("phrasing band: weak evidence + strong phrasing = error", () => {
    const claim = makeClaim({ evidence_strength: "weak", permitted_phrasing_band: "strong" });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "permitted_phrasing_band")).toBe(true);
  });

  it("phrasing band: weak evidence + medium phrasing = error", () => {
    const claim = makeClaim({ evidence_strength: "weak", permitted_phrasing_band: "medium" });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "permitted_phrasing_band")).toBe(true);
  });

  it("phrasing band: weak evidence + weak phrasing = valid", () => {
    const claim = makeClaim({ evidence_strength: "weak", permitted_phrasing_band: "weak" });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.filter((e) => e.fieldPath === "permitted_phrasing_band")).toHaveLength(0);
  });

  it("phrasing band: mixed evidence + strong phrasing = error", () => {
    const claim = makeClaim({ evidence_strength: "mixed", permitted_phrasing_band: "strong" });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "permitted_phrasing_band")).toBe(true);
  });

  it("phrasing band: mixed evidence + weak phrasing = valid", () => {
    const claim = makeClaim({ evidence_strength: "mixed", permitted_phrasing_band: "weak" });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.filter((e) => e.fieldPath === "permitted_phrasing_band")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Protocol-specific validation
// ---------------------------------------------------------------------------

describe("Protocol validation", () => {
  it("reports error for empty steps", () => {
    const p = makeProtocol({ steps: [] });
    const bundle = makeBundle([p]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "steps")).toBe(true);
  });

  it("reports error for empty required_inputs", () => {
    const p = makeProtocol({ required_inputs: [] });
    const bundle = makeBundle([p]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "required_inputs")).toBe(true);
  });

  it("reports error for empty expected_outputs", () => {
    const p = makeProtocol({ expected_outputs: [] });
    const bundle = makeBundle([p]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "expected_outputs")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Trigger-specific validation
// ---------------------------------------------------------------------------

describe("Trigger validation", () => {
  it("reports error for empty observable_signal", () => {
    const t = makeTrigger({ observable_signal: "" });
    const bundle = makeBundle([t]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "observable_signal")).toBe(true);
  });

  it("reports error for empty recommended_behaviour", () => {
    const t = makeTrigger({ recommended_behaviour: "  " });
    const bundle = makeBundle([t]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "recommended_behaviour")).toBe(true);
  });

  it("reports error for empty negative_conditions with guidance", () => {
    const t = makeTrigger({ negative_conditions: [] });
    const bundle = makeBundle([t]);
    const result = lintBundle(bundle, VOCAB);
    const e = result.errors.find((e) => e.fieldPath === "negative_conditions");
    expect(e).toBeDefined();
    expect(e!.message).toContain("false positives");
  });

  it("reports error for linked_claim_ids referencing non-existent id", () => {
    const t = makeTrigger({ linked_claim_ids: ["DSK-B-999"] });
    const bundle = makeBundle([t]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "linked_claim_ids" && e.message.includes("DSK-B-999"))).toBe(true);
  });

  it("reports error for linked_claim_ids referencing a protocol (wrong type)", () => {
    const p = makeProtocol({ id: "DSK-P-001" });
    const t = makeTrigger({ linked_claim_ids: ["DSK-P-001"] });
    const bundle = makeBundle([p, t]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "linked_claim_ids" && e.message.includes("protocol"))).toBe(true);
  });

  it("reports error for linked_protocol_ids referencing non-existent id", () => {
    const t = makeTrigger({ linked_protocol_ids: ["DSK-P-999"] });
    const bundle = makeBundle([t]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "linked_protocol_ids" && e.message.includes("DSK-P-999"))).toBe(true);
  });

  it("reports error for linked_protocol_ids referencing a claim (wrong type)", () => {
    const c = makeClaim({ id: "DSK-B-001" });
    const t = makeTrigger({ linked_protocol_ids: ["DSK-B-001"] });
    const bundle = makeBundle([c, t]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "linked_protocol_ids" && e.message.includes("claim"))).toBe(true);
  });

  it("accepts valid cross-references", () => {
    const c = makeClaim({ id: "DSK-B-001" });
    const p = makeProtocol({ id: "DSK-P-001" });
    const t = makeTrigger({ linked_claim_ids: ["DSK-B-001"], linked_protocol_ids: ["DSK-P-001"] });
    const bundle = makeBundle([c, p, t]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.filter((e) => e.fieldPath === "linked_claim_ids" || e.fieldPath === "linked_protocol_ids")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 9. supersedes cross-type reference
// ---------------------------------------------------------------------------

describe("supersedes validation", () => {
  it("reports error for supersedes cross-type reference", () => {
    const protocol = makeProtocol({ id: "DSK-P-001" });
    // Claim trying to supersede a protocol (different type)
    const claim = makeClaim({ id: "DSK-B-001", supersedes: "DSK-P-001" });
    const bundle = makeBundle([protocol, claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "supersedes" && e.message.includes("same type"))).toBe(true);
  });

  it("reports error for supersedes referencing non-existent id", () => {
    const claim = makeClaim({ supersedes: "DSK-B-999" });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "supersedes" && e.message.includes("DSK-B-999"))).toBe(true);
  });

  it("reports error for supersedes referencing a deprecated object", () => {
    const old = makeClaim({ id: "DSK-B-002", deprecated: true, deprecated_reason: "Replaced" });
    const claim = makeClaim({ id: "DSK-B-001", supersedes: "DSK-B-002" });
    const bundle = makeBundle([old, claim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "supersedes" && e.message.includes("deprecated"))).toBe(true);
  });

  it("accepts valid supersedes (same type, not deprecated)", () => {
    const oldClaim = makeClaim({ id: "DSK-B-002" });
    const newClaim = makeClaim({ id: "DSK-B-001", supersedes: "DSK-B-002" });
    const bundle = makeBundle([oldClaim, newClaim]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.filter((e) => e.fieldPath === "supersedes")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 10. Circular supersedes chain detection
// ---------------------------------------------------------------------------

describe("Circular supersedes chain", () => {
  it("detects direct cycle A → B → A", () => {
    const a = makeClaim({ id: "DSK-B-001", supersedes: "DSK-B-002" });
    const b = makeClaim({ id: "DSK-B-002", supersedes: "DSK-B-001" });
    const bundle = makeBundle([a, b]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "supersedes" && e.message.includes("Circular"))).toBe(true);
  });

  it("detects three-node cycle A → B → C → A", () => {
    const a = makeClaim({ id: "DSK-B-001", supersedes: "DSK-B-002" });
    const b = makeClaim({ id: "DSK-B-002", supersedes: "DSK-B-003" });
    const c = makeClaim({ id: "DSK-B-003", supersedes: "DSK-B-001" });
    const bundle = makeBundle([a, b, c]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "supersedes" && e.message.includes("Circular"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11. Ordering warning
// ---------------------------------------------------------------------------

describe("Object ordering", () => {
  it("emits warning (exit 2) when objects are not in canonical id order", () => {
    const b = makeClaim({ id: "DSK-B-002" });
    const a = makeClaim({ id: "DSK-B-001", supersedes: undefined });
    // Put b before a — wrong order
    const bundle: DSKBundle = {
      version: "1.0.0",
      generated_at: "2026-01-01",
      dsk_version_hash: "",
      objects: [b, a],
    };
    bundle.dsk_version_hash = computeDSKHash(bundle);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.fieldPath === "objects")).toBe(true);
    expect(result.exitCode).toBe(2);
  });

  it("no ordering warning when objects are in canonical order", () => {
    const a = makeClaim({ id: "DSK-B-001" });
    const b = makeClaim({ id: "DSK-B-002", title: "Another claim" });
    const bundle = makeBundle([a, b]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.warnings.filter((w) => w.fieldPath === "objects")).toHaveLength(0);
  });

  it("fixOrder returns bundle with objects sorted by id", () => {
    const b = makeClaim({ id: "DSK-B-002" });
    const a = makeClaim({ id: "DSK-B-001" });
    const bundle: DSKBundle = {
      version: "1.0.0",
      generated_at: "2026-01-01",
      dsk_version_hash: computeDSKHash({ version: "1.0.0", generated_at: "2026-01-01", dsk_version_hash: "", objects: [b, a] }),
      objects: [b, a],
    };
    const fixed = fixOrder(bundle);
    expect(fixed.objects[0]!.id).toBe("DSK-B-001");
    expect(fixed.objects[1]!.id).toBe("DSK-B-002");
  });
});

// ---------------------------------------------------------------------------
// 12. Hash stability, sensitivity, exclusion
// ---------------------------------------------------------------------------

describe("Hash", () => {
  it("same bundle always produces same hash", () => {
    const bundle = makeBundle([makeClaim()]);
    const h1 = computeDSKHash(bundle);
    const h2 = computeDSKHash(bundle);
    expect(h1).toBe(h2);
  });

  it("changing any field changes the hash", () => {
    const bundle = makeBundle([makeClaim()]);
    const h1 = computeDSKHash(bundle);
    const bundle2 = makeBundle([makeClaim({ title: "Modified title" })]);
    const h2 = computeDSKHash(bundle2);
    expect(h1).not.toBe(h2);
  });

  it("changing generated_at does NOT change the hash", () => {
    const b1 = makeBundle([makeClaim()]);
    const h1 = computeDSKHash(b1);
    const b2 = { ...b1, generated_at: "2099-12-31" };
    const h2 = computeDSKHash(b2);
    expect(h1).toBe(h2);
  });

  it("changing dsk_version_hash field itself does NOT change the hash", () => {
    const b1 = makeBundle([makeClaim()]);
    const h1 = computeDSKHash(b1);
    const b2 = { ...b1, dsk_version_hash: "different_stored_hash" };
    const h2 = computeDSKHash(b2);
    expect(h1).toBe(h2);
  });

  it("verifyDSKHash returns true for correctly hashed bundle", () => {
    const bundle = makeBundle([makeClaim()]);
    expect(verifyDSKHash(bundle)).toBe(true);
  });

  it("verifyDSKHash returns false when hash is wrong", () => {
    const bundle = makeBundle([makeClaim()]);
    bundle.dsk_version_hash = "tampered";
    expect(verifyDSKHash(bundle)).toBe(false);
  });

  it("linter reports error when stored hash is wrong", () => {
    const bundle = makeBundle([makeClaim()]);
    bundle.dsk_version_hash = "wrong_hash";
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.fieldPath === "dsk_version_hash")).toBe(true);
  });

  it("linter reports error when hash is empty (with computed value)", () => {
    const bundle = makeBundle([makeClaim()]);
    bundle.dsk_version_hash = "";
    const result = lintBundle(bundle, VOCAB);
    const e = result.errors.find((e) => e.fieldPath === "dsk_version_hash");
    expect(e).toBeDefined();
    expect(e!.message).toContain("computed value should be");
  });
});

// ---------------------------------------------------------------------------
// 13. Canonicaliser — ordered vs unordered arrays
// ---------------------------------------------------------------------------

describe("Canonicaliser", () => {
  it("unordered arrays (context_tags) are sorted in canonical output", () => {
    const claimA = makeClaim({ context_tags: ["pricing", "general"] });
    const claimB = makeClaim({ context_tags: ["general", "pricing"] });
    const bA = makeBundle([claimA]);
    const bB = makeBundle([claimB]);
    // Sorted canonically, both should produce the same JSON
    expect(canonicalise(bA)).toBe(canonicalise(bB));
  });

  it("ordered arrays (steps) preserve order in canonical output", () => {
    const p1 = makeProtocol({ steps: ["Step A", "Step B", "Step C"] });
    const p2 = makeProtocol({ steps: ["Step C", "Step A", "Step B"] });
    const b1 = makeBundle([p1]);
    const b2 = makeBundle([p2]);
    // Different step orders → different canonical JSON
    expect(canonicalise(b1)).not.toBe(canonicalise(b2));
  });

  it("ordered arrays (source_citations) preserve order in canonical output", () => {
    const cit1 = { doi_or_isbn: "10.1000/aaa", page_or_section: "p. 1" };
    const cit2 = { doi_or_isbn: "10.1000/bbb", page_or_section: "p. 2" };
    const claimA = makeClaim({ source_citations: [cit1, cit2] });
    const claimB = makeClaim({ source_citations: [cit2, cit1] });
    const bA = makeBundle([claimA]);
    const bB = makeBundle([claimB]);
    expect(canonicalise(bA)).not.toBe(canonicalise(bB));
  });

  it("stage_applicability (unordered) is sorted in canonical output", () => {
    const claimA = makeClaim({ stage_applicability: ["decide", "evaluate"] });
    const claimB = makeClaim({ stage_applicability: ["evaluate", "decide"] });
    const bA = makeBundle([claimA]);
    const bB = makeBundle([claimB]);
    expect(canonicalise(bA)).toBe(canonicalise(bB));
  });

  it("canonicaliser output is identical whether called from linter context or directly", () => {
    // Verify the canonicalise function used by hash and linter are the same module
    const bundle = makeBundle([makeClaim(), makeProtocol()]);
    const directResult = canonicalise(bundle);
    // The hash is computed via canonicalise internally
    const hash1 = computeDSKHash(bundle);
    const hash2 = createHash("sha256").update(directResult, "utf8").digest("hex");
    expect(hash1).toBe(hash2);
  });

  it("objects array is sorted by id in canonical output regardless of input order", () => {
    const b_obj = makeClaim({ id: "DSK-B-002" });
    const a_obj = makeClaim({ id: "DSK-B-001" });
    // Put b before a
    const bundleUnsorted: DSKBundle = {
      version: "1.0.0",
      generated_at: "2026-01-01",
      dsk_version_hash: "",
      objects: [b_obj, a_obj],
    };
    const bundleSorted: DSKBundle = {
      version: "1.0.0",
      generated_at: "2026-01-01",
      dsk_version_hash: "",
      objects: [a_obj, b_obj],
    };
    expect(canonicalise(bundleUnsorted)).toBe(canonicalise(bundleSorted));
  });
});

// ---------------------------------------------------------------------------
// 14. Deterministic output
// ---------------------------------------------------------------------------

describe("Deterministic output", () => {
  it("running linter twice on the same bundle produces identical results", () => {
    const bundle = makeBundle([makeClaim()]);
    const r1 = lintBundle(bundle, VOCAB);
    const r2 = lintBundle(bundle, VOCAB);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("computing hash twice produces identical results", () => {
    const bundle = makeBundle([makeClaim()]);
    expect(computeDSKHash(bundle)).toBe(computeDSKHash(bundle));
  });

  it("diagnostics are sorted by (objectId, fieldPath)", () => {
    // Use two invalid objects to generate multiple errors across different objects
    const c1 = makeClaim({ id: "DSK-B-002", title: "", source_citations: [] });
    const c2 = makeClaim({ id: "DSK-B-001", title: "", source_citations: [] });
    const bundle = makeBundle([c1, c2]);
    const result = lintBundle(bundle, VOCAB);
    const ids = result.errors.map((e) => e.objectId);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------
// 15. Edge cases
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
  it("empty bundle (no objects) — bundle-level fields still validated", () => {
    const bundle: DSKBundle = {
      version: "1.0.0",
      generated_at: "2026-01-01",
      dsk_version_hash: "",
      objects: [],
    };
    bundle.dsk_version_hash = computeDSKHash(bundle);
    const result = lintBundle(bundle, VOCAB);
    // Empty bundle with correct hash should be clean
    expect(result.errors).toHaveLength(0);
    expect(result.exitCode).toBe(0);
  });

  it("bundle with only deprecated objects — valid if deprecated_reason present", () => {
    const c = makeClaim({ deprecated: true, deprecated_reason: "Superseded by DSK-B-002" });
    const bundle = makeBundle([c]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.filter((e) => e.fieldPath === "deprecated_reason")).toHaveLength(0);
  });

  it("bundle missing version field reports error", () => {
    const bundle: DSKBundle = {
      version: "",
      generated_at: "2026-01-01",
      dsk_version_hash: "",
      objects: [],
    };
    bundle.dsk_version_hash = computeDSKHash(bundle);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.some((e) => e.objectId === "(bundle)" && e.fieldPath === "version")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 16. File-loading via tmp files (CLI vocabulary path tests)
// ---------------------------------------------------------------------------

describe("Context-tags file loading", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dsk-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("loads vocabulary from a custom file and validates against it", async () => {
    const vocabPath = join(tmpDir, "vocab.json");
    await writeFile(vocabPath, JSON.stringify(["custom_tag", "other_tag"]), "utf-8");
    const vocab = JSON.parse(await readFile(vocabPath, "utf-8")) as string[];

    const claim = makeClaim({ context_tags: ["custom_tag"] });
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, vocab);
    expect(result.errors.filter((e) => e.fieldPath === "context_tags")).toHaveLength(0);
  });

  it("rejects tag not in custom vocabulary file", async () => {
    const vocabPath = join(tmpDir, "vocab.json");
    await writeFile(vocabPath, JSON.stringify(["custom_tag"]), "utf-8");
    const vocab = JSON.parse(await readFile(vocabPath, "utf-8")) as string[];

    const claim = makeClaim({ context_tags: ["general"] }); // not in this vocab
    const bundle = makeBundle([claim]);
    const result = lintBundle(bundle, vocab);
    expect(result.errors.some((e) => e.fieldPath === "context_tags")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 17. All six ID prefixes accepted
// ---------------------------------------------------------------------------

describe("ID prefix coverage", () => {
  it.each([
    ["DSK-B-001", "claim"],
    ["DSK-T-001", "claim"],
    ["DSK-F-001", "claim"],
    ["DSK-G-001", "claim"],
    ["DSK-P-001", "protocol"],
    ["DSK-TR-001", "trigger"],
  ] as const)("accepts ID prefix in %s", (id, type) => {
    let obj: DSKObject;
    if (type === "claim") {
      obj = makeClaim({ id });
    } else if (type === "protocol") {
      obj = makeProtocol({ id });
    } else {
      obj = makeTrigger({ id });
    }
    const bundle = makeBundle([obj]);
    const result = lintBundle(bundle, VOCAB);
    expect(result.errors.filter((e) => e.fieldPath === "id" && e.objectId === id)).toHaveLength(0);
  });
});
