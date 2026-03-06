/**
 * Decision Review — DSK Integration Tests
 *
 * Tests for:
 * - buildScienceClaimsSection() — section building from DSK bundle
 * - injectScienceClaimsSection() — prompt injection with marker validation
 * - performShapeCheck() — DSK field validation (hard reject / warning / ignore)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Mock setup — must precede all imports from SUT
// ============================================================================

const {
  mockConfig,
  mockGetAllByType,
  mockGetClaimById,
  mockGetProtocolById,
  mockLog,
} = vi.hoisted(() => {
  const mockGetAllByType = vi.fn();
  const mockGetClaimById = vi.fn();
  const mockGetProtocolById = vi.fn();
  const mockLog = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const mockConfig = {
    config: {
      features: {
        dskEnabled: true,
      },
    },
  };
  return { mockConfig, mockGetAllByType, mockGetClaimById, mockGetProtocolById, mockLog };
});

vi.mock("../../src/config/index.js", () => mockConfig);

vi.mock("../../src/utils/telemetry.js", () => ({
  log: mockLog,
}));

vi.mock("../../src/orchestrator/dsk-loader.js", () => ({
  getAllByType: mockGetAllByType,
  getClaimById: mockGetClaimById,
  getProtocolById: mockGetProtocolById,
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
  buildScienceClaimsSection,
  injectScienceClaimsSection,
} from "../../src/cee/decision-review/science-claims.js";
import { performShapeCheck } from "../../src/cee/decision-review/shape-check.js";

// ============================================================================
// Test fixtures
// ============================================================================

function makeBiasClaim(id: string, title: string, strength: string) {
  return {
    id,
    type: "claim" as const,
    title,
    evidence_strength: strength,
    claim_category: "empirical",
    deprecated: false,
    stage_applicability: ["evaluate"],
    context_tags: ["general"],
    version: "1.0.0",
    last_reviewed_at: "2026-01-01",
    source_citations: [],
    contraindications: [],
    scope: { decision_contexts: [], stages: [], populations: [], exclusions: [] },
    permitted_phrasing_band: "medium",
    evidence_pack: {
      key_findings: "",
      effect_direction: "negative",
      boundary_conditions: "",
      known_limitations: "",
    },
  };
}

function makeTechniqueClaim(id: string, title: string, strength: string) {
  return {
    ...makeBiasClaim(id, title, strength),
    claim_category: "technique_efficacy",
  };
}

function makeProtocol(id: string, linkedClaimId?: string) {
  return {
    id,
    type: "protocol" as const,
    title: `Protocol ${id}`,
    deprecated: false,
    stage_applicability: ["evaluate"],
    context_tags: ["general"],
    version: "1.0.0",
    last_reviewed_at: "2026-01-01",
    source_citations: [],
    contraindications: [],
    evidence_strength: "medium",
    steps: ["Step 1"],
    required_inputs: ["input"],
    expected_outputs: ["output"],
    linked_claim_id: linkedClaimId,
  };
}

/** Minimal valid M2 response shape for performShapeCheck */
function makeValidResponse(overrides?: Record<string, unknown>) {
  return {
    narrative_summary: "Test summary",
    story_headlines: { opt1: "Headline" },
    robustness_explanation: { summary: "", primary_risk: "", stability_factors: [], fragility_factors: [] },
    readiness_rationale: "Test rationale",
    evidence_enhancements: {},
    bias_findings: [],
    key_assumptions: ["assumption 1"],
    decision_quality_prompts: [],
    ...overrides,
  };
}

const SAMPLE_PROMPT = `<ROLE>Test role</ROLE>

<INPUT_FIELDS>
Some input fields
</INPUT_FIELDS>

<CONSTRUCTION_FLOW>
Build the response
</CONSTRUCTION_FLOW>

<OUTPUT_SCHEMA>
Return JSON
</OUTPUT_SCHEMA>`;

// ============================================================================
// Tests: buildScienceClaimsSection
// ============================================================================

describe("buildScienceClaimsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.config.features.dskEnabled = true;
  });

  it("returns section with correct counts when DSK enabled and claims present", () => {
    mockGetAllByType.mockImplementation((type: string) => {
      if (type === "claim") {
        return [
          makeBiasClaim("DSK-B-001", "Anchoring", "strong"),
          makeBiasClaim("DSK-B-002", "Confirmation bias", "medium"),
          makeTechniqueClaim("DSK-T-001", "Pre-mortem", "medium"),
        ];
      }
      if (type === "protocol") {
        return [makeProtocol("DSK-P-001", "DSK-T-001")];
      }
      return [];
    });

    const result = buildScienceClaimsSection();

    expect(result).not.toBeNull();
    expect(result!.section).toContain("<SCIENCE_CLAIMS>");
    expect(result!.section).toContain("</SCIENCE_CLAIMS>");
    expect(result!.biasCount).toBe(2);
    expect(result!.techniqueCount).toBe(1);
  });

  it("returns null and logs info when DSK disabled", () => {
    mockConfig.config.features.dskEnabled = false;

    const result = buildScienceClaimsSection();

    expect(result).toBeNull();
    expect(mockLog.info).toHaveBeenCalledWith(
      {},
      expect.stringContaining("DSK disabled by config"),
    );
  });

  it("returns null and logs warn when bundle has no claims", () => {
    mockGetAllByType.mockReturnValue([]);

    const result = buildScienceClaimsSection();

    expect(result).toBeNull();
    expect(mockLog.warn).toHaveBeenCalledWith(
      {},
      expect.stringContaining("DSK bundle load failed"),
    );
  });

  it("sorts bias claims and technique claims by ID", () => {
    mockGetAllByType.mockImplementation((type: string) => {
      if (type === "claim") {
        return [
          makeBiasClaim("DSK-B-003", "Sunk cost", "strong"),
          makeBiasClaim("DSK-B-001", "Anchoring", "strong"),
          makeTechniqueClaim("DSK-T-002", "Outside view", "strong"),
          makeTechniqueClaim("DSK-T-001", "Pre-mortem", "medium"),
        ];
      }
      if (type === "protocol") return [];
      return [];
    });

    const result = buildScienceClaimsSection();
    const section = result!.section;

    // Verify bias claims appear in ID order
    const b001Idx = section.indexOf("DSK-B-001");
    const b003Idx = section.indexOf("DSK-B-003");
    expect(b001Idx).toBeLessThan(b003Idx);

    // Verify technique claims appear in ID order
    const t001Idx = section.indexOf("DSK-T-001");
    const t002Idx = section.indexOf("DSK-T-002");
    expect(t001Idx).toBeLessThan(t002Idx);
  });

  it("excludes triggers and protocols from claim rows", () => {
    mockGetAllByType.mockImplementation((type: string) => {
      if (type === "claim") {
        return [makeBiasClaim("DSK-B-001", "Anchoring", "strong")];
      }
      if (type === "protocol") {
        return [makeProtocol("DSK-P-001")];
      }
      return [];
    });

    const result = buildScienceClaimsSection();
    const section = result!.section;

    // Should contain DSK-B-001 as a claim row
    expect(section).toContain("DSK-B-001");
    // DSK-P-001 should only appear in the Protocol column, not as a claim row
    // DSK-TR-* should not appear at all (triggers aren't returned by getAllByType('claim'))
    expect(section).not.toContain("DSK-TR-");
    // Verify the protocol appears only in the Protocol column context
    const lines = section.split("\n");
    const protocolAsClaimRow = lines.some(
      (l) => l.startsWith("| DSK-P-") && !l.includes("Protocol"),
    );
    expect(protocolAsClaimRow).toBe(false);
  });
});

// ============================================================================
// Tests: injectScienceClaimsSection
// ============================================================================

describe("injectScienceClaimsSection", () => {
  it("injects section between </INPUT_FIELDS> and <CONSTRUCTION_FLOW>", () => {
    const section = "<SCIENCE_CLAIMS>\nTest claims\n</SCIENCE_CLAIMS>";
    const result = injectScienceClaimsSection(SAMPLE_PROMPT, section);

    // Markers preserved
    expect(result).toContain("</INPUT_FIELDS>");
    expect(result).toContain("<CONSTRUCTION_FLOW>");
    // Section injected
    expect(result).toContain("<SCIENCE_CLAIMS>");

    // Verify order: </INPUT_FIELDS> → <SCIENCE_CLAIMS> → <CONSTRUCTION_FLOW>
    const endInputIdx = result.indexOf("</INPUT_FIELDS>");
    const scienceIdx = result.indexOf("<SCIENCE_CLAIMS>");
    const flowIdx = result.indexOf("<CONSTRUCTION_FLOW>");
    expect(endInputIdx).toBeLessThan(scienceIdx);
    expect(scienceIdx).toBeLessThan(flowIdx);
  });

  it("throws when </INPUT_FIELDS> marker is missing", () => {
    const badPrompt = "<ROLE>Test</ROLE>\n<CONSTRUCTION_FLOW>Build</CONSTRUCTION_FLOW>";

    expect(() =>
      injectScienceClaimsSection(badPrompt, "<SCIENCE_CLAIMS>x</SCIENCE_CLAIMS>"),
    ).toThrow(/missing.*<\/INPUT_FIELDS>/i);
  });

  it("throws when prompt already contains <SCIENCE_CLAIMS>", () => {
    const promptWithSection =
      SAMPLE_PROMPT.replace(
        "</INPUT_FIELDS>",
        "</INPUT_FIELDS>\n<SCIENCE_CLAIMS>existing</SCIENCE_CLAIMS>",
      );

    expect(() =>
      injectScienceClaimsSection(promptWithSection, "<SCIENCE_CLAIMS>new</SCIENCE_CLAIMS>"),
    ).toThrow(/refusing to double-inject/i);
  });
});

// ============================================================================
// Tests: performShapeCheck — DSK enabled
// ============================================================================

describe("performShapeCheck (DSK enabled)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.config.features.dskEnabled = true;
  });

  it("passes with valid dsk_claim_id in bias_findings", () => {
    mockGetClaimById.mockReturnValue(
      makeBiasClaim("DSK-B-001", "Anchoring", "strong"),
    );

    const data = makeValidResponse({
      bias_findings: [
        {
          type: "ANCHORING",
          source: "structural",
          description: "Test",
          affected_elements: [],
          suggested_action: "Test",
          linked_critique_code: "STRENGTH_CLUSTERING",
          dsk_claim_id: "DSK-B-001",
          evidence_strength: "strong",
        },
      ],
    });

    const result = performShapeCheck(data);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("hard rejects when dsk_claim_id not found in bundle", () => {
    mockGetClaimById.mockReturnValue(undefined);

    const data = makeValidResponse({
      bias_findings: [
        {
          type: "ANCHORING",
          source: "structural",
          description: "Test",
          affected_elements: [],
          suggested_action: "Test",
          linked_critique_code: "STRENGTH_CLUSTERING",
          dsk_claim_id: "DSK-B-999",
          evidence_strength: "strong",
        },
      ],
    });

    const result = performShapeCheck(data);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"DSK-B-999" not found in loaded DSK bundle'),
      ]),
    );
  });

  it("warns on evidence_strength drift, does not reject", () => {
    mockGetClaimById.mockReturnValue(
      makeBiasClaim("DSK-B-001", "Anchoring", "strong"),
    );

    const data = makeValidResponse({
      bias_findings: [
        {
          type: "ANCHORING",
          source: "structural",
          description: "Test",
          affected_elements: [],
          suggested_action: "Test",
          linked_critique_code: "STRENGTH_CLUSTERING",
          dsk_claim_id: "DSK-B-001",
          evidence_strength: "medium", // drifts from "strong"
        },
      ],
    });

    const result = performShapeCheck(data);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("drifts from bundle value"),
      ]),
    );
  });

  it("passes with valid dsk_claim_id + dsk_protocol_id in decision_quality_prompts", () => {
    mockGetClaimById.mockReturnValue(
      makeTechniqueClaim("DSK-T-001", "Pre-mortem", "medium"),
    );
    mockGetProtocolById.mockReturnValue(
      makeProtocol("DSK-P-001", "DSK-T-001"),
    );

    const data = makeValidResponse({
      decision_quality_prompts: [
        {
          question: "What could go wrong?",
          principle: "Pre-mortem (Klein)",
          applies_because: "readiness is ready",
          dsk_claim_id: "DSK-T-001",
          evidence_strength: "medium",
          dsk_protocol_id: "DSK-P-001",
        },
      ],
    });

    const result = performShapeCheck(data);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns when dsk_protocol_id not found in bundle", () => {
    mockGetClaimById.mockReturnValue(
      makeTechniqueClaim("DSK-T-001", "Pre-mortem", "medium"),
    );
    mockGetProtocolById.mockReturnValue(undefined);

    const data = makeValidResponse({
      decision_quality_prompts: [
        {
          question: "What could go wrong?",
          principle: "Pre-mortem (Klein)",
          applies_because: "readiness is ready",
          dsk_claim_id: "DSK-T-001",
          evidence_strength: "medium",
          dsk_protocol_id: "DSK-P-999",
        },
      ],
    });

    const result = performShapeCheck(data);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"DSK-P-999" not found in loaded DSK bundle'),
      ]),
    );
  });

  it("warns when claim↔protocol linked_claim_id mismatches", () => {
    mockGetClaimById.mockReturnValue(
      makeTechniqueClaim("DSK-T-001", "Pre-mortem", "medium"),
    );
    // Protocol links to DSK-T-002, but the prompt references DSK-T-001
    mockGetProtocolById.mockReturnValue(
      makeProtocol("DSK-P-001", "DSK-T-002"),
    );

    const data = makeValidResponse({
      decision_quality_prompts: [
        {
          question: "What could go wrong?",
          principle: "Pre-mortem (Klein)",
          applies_because: "readiness is ready",
          dsk_claim_id: "DSK-T-001",
          evidence_strength: "medium",
          dsk_protocol_id: "DSK-P-001",
        },
      ],
    });

    const result = performShapeCheck(data);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('linked_claim_id is "DSK-T-002"'),
      ]),
    );
  });
});

// ============================================================================
// Tests: performShapeCheck — DSK disabled
// ============================================================================

describe("performShapeCheck (DSK disabled)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.config.features.dskEnabled = false;
  });

  it("ignores all DSK fields when DSK disabled — no errors, no warnings", () => {
    const data = makeValidResponse({
      bias_findings: [
        {
          type: "ANCHORING",
          source: "structural",
          description: "Test",
          affected_elements: [],
          suggested_action: "Test",
          linked_critique_code: "STRENGTH_CLUSTERING",
          dsk_claim_id: "DSK-B-FAKE-999",
          evidence_strength: "invalid_value",
        },
      ],
      decision_quality_prompts: [
        {
          question: "What could go wrong?",
          principle: "Pre-mortem",
          applies_because: "test",
          dsk_claim_id: "DSK-T-FAKE",
          dsk_protocol_id: "DSK-P-FAKE",
        },
      ],
    });

    const result = performShapeCheck(data);
    expect(result.valid).toBe(true);
    // No DSK-related warnings or errors
    const dskWarnings = result.warnings.filter((w) => w.includes("dsk_"));
    const dskErrors = result.errors.filter((e) => e.includes("dsk_"));
    expect(dskWarnings).toHaveLength(0);
    expect(dskErrors).toHaveLength(0);
    // getClaimById should not have been called
    expect(mockGetClaimById).not.toHaveBeenCalled();
    expect(mockGetProtocolById).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Integration: full prompt assembly
// ============================================================================

describe("full prompt assembly integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.config.features.dskEnabled = true;
  });

  it("assembles prompt with <SCIENCE_CLAIMS> between markers", () => {
    mockGetAllByType.mockImplementation((type: string) => {
      if (type === "claim") {
        return [
          makeBiasClaim("DSK-B-001", "Anchoring", "strong"),
          makeTechniqueClaim("DSK-T-001", "Pre-mortem", "medium"),
        ];
      }
      if (type === "protocol") {
        return [makeProtocol("DSK-P-001", "DSK-T-001")];
      }
      return [];
    });

    const scienceResult = buildScienceClaimsSection();
    expect(scienceResult).not.toBeNull();

    const assembled = injectScienceClaimsSection(SAMPLE_PROMPT, scienceResult!.section);

    // Verify structural order
    const inputEnd = assembled.indexOf("</INPUT_FIELDS>");
    const scienceStart = assembled.indexOf("<SCIENCE_CLAIMS>");
    const scienceEnd = assembled.indexOf("</SCIENCE_CLAIMS>");
    const flowStart = assembled.indexOf("<CONSTRUCTION_FLOW>");

    expect(inputEnd).toBeLessThan(scienceStart);
    expect(scienceStart).toBeLessThan(scienceEnd);
    expect(scienceEnd).toBeLessThan(flowStart);

    // Verify claim content present
    expect(assembled).toContain("DSK-B-001");
    expect(assembled).toContain("DSK-T-001");
    expect(assembled).toContain("DSK-P-001");
    expect(assembled).toContain("Anchoring");
    expect(assembled).toContain("Pre-mortem");
  });
});
