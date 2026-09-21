/**
 * DSK coverage map tests.
 *
 * Validates that every bias type and principle referenced in the decision review
 * prompt maps to a real DSK object in the production bundle, and vice versa.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DSKBundle } from "../../../src/dsk/types.js";

// ---------------------------------------------------------------------------
// Load production bundle and prompt
// ---------------------------------------------------------------------------

const bundlePath = resolve(process.cwd(), "data/dsk/v1.json");
const bundle: DSKBundle = JSON.parse(readFileSync(bundlePath, "utf-8"));
const bundleIds = new Set(bundle.objects.map((o) => o.id));

const promptPath = resolve(
  process.cwd(),
  "src/prompts/Versions /decision_review_prompt_v5.2.txt",
);
const promptText = readFileSync(promptPath, "utf-8");

// ---------------------------------------------------------------------------
// Coverage maps — explicit, auditable constants
//
// Only bias types that appear directly in the prompt are included.
// ANCHORING and STATUS_QUO_BIAS appear only as structural critique→bias mappings
// (STRENGTH_CLUSTERING→ANCHORING, MISSING_BASELINE→STATUS_QUO_BIAS) — they will
// be added to this map when the prompt is updated to reference them by name.
// ---------------------------------------------------------------------------

const BIAS_TYPE_TO_DSK: Record<string, string> = {
  SUNK_COST: "DSK-B-003",
  AVAILABILITY: "DSK-B-005",
  AFFECT_HEURISTIC: "DSK-B-009",
  PLANNING_FALLACY: "DSK-B-008",
  DOMINANT_FACTOR: "DSK-B-007",
  NARROW_FRAMING: "DSK-B-007",
};

const PRINCIPLE_TO_DSK: Record<
  string,
  { claim: string; protocol: string } | null
> = {
  "Pre-mortem (Klein)": { claim: "DSK-T-001", protocol: "DSK-P-001" },
  "Outside View (Kahneman)": { claim: "DSK-T-002", protocol: "DSK-P-002" },
  Disconfirmation: { claim: "DSK-T-003", protocol: "DSK-P-003" },
  "Opportunity Cost": { claim: "DSK-T-004", protocol: "DSK-P-004" },
  "Devil's Advocate": { claim: "DSK-T-005", protocol: "DSK-P-005" },
  // Practitioner heuristic, no peer-reviewed evidence — wave 2
  "10-10-10 (Welch)": null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DSK coverage map", () => {
  describe("BIAS_TYPE_TO_DSK", () => {
    it("every DSK ID in the map resolves to a bundle object", () => {
      const uniqueIds = new Set(Object.values(BIAS_TYPE_TO_DSK));
      for (const id of uniqueIds) {
        expect(bundleIds.has(id), `${id} not found in bundle`).toBe(true);
      }
    });

    it("every bias type key appears as a substring in the prompt", () => {
      for (const key of Object.keys(BIAS_TYPE_TO_DSK)) {
        expect(
          promptText.includes(key),
          `${key} not found in prompt text`,
        ).toBe(true);
      }
    });

    it("mapped DSK objects are claims (type=claim)", () => {
      const uniqueIds = new Set(Object.values(BIAS_TYPE_TO_DSK));
      for (const id of uniqueIds) {
        const obj = bundle.objects.find((o) => o.id === id);
        expect(obj?.type, `${id} should be a claim`).toBe("claim");
      }
    });
  });

  describe("PRINCIPLE_TO_DSK", () => {
    it("every non-null DSK claim ID resolves to a bundle object", () => {
      for (const [principle, mapping] of Object.entries(PRINCIPLE_TO_DSK)) {
        if (mapping === null) continue;
        expect(
          bundleIds.has(mapping.claim),
          `${principle} claim ${mapping.claim} not found in bundle`,
        ).toBe(true);
      }
    });

    it("every non-null DSK protocol ID resolves to a bundle object", () => {
      for (const [principle, mapping] of Object.entries(PRINCIPLE_TO_DSK)) {
        if (mapping === null) continue;
        expect(
          bundleIds.has(mapping.protocol),
          `${principle} protocol ${mapping.protocol} not found in bundle`,
        ).toBe(true);
      }
    });

    it("every principle key appears as a substring in the prompt", () => {
      for (const key of Object.keys(PRINCIPLE_TO_DSK)) {
        expect(
          promptText.includes(key),
          `${key} not found in prompt text`,
        ).toBe(true);
      }
    });

    it("10-10-10 (Welch) is explicitly null (no DSK mapping)", () => {
      expect(PRINCIPLE_TO_DSK["10-10-10 (Welch)"]).toBeNull();
    });

    it("mapped claims are technique claims (type=claim)", () => {
      for (const [, mapping] of Object.entries(PRINCIPLE_TO_DSK)) {
        if (mapping === null) continue;
        const obj = bundle.objects.find((o) => o.id === mapping.claim);
        expect(obj?.type).toBe("claim");
      }
    });

    it("mapped protocols are protocols (type=protocol)", () => {
      for (const [, mapping] of Object.entries(PRINCIPLE_TO_DSK)) {
        if (mapping === null) continue;
        const obj = bundle.objects.find((o) => o.id === mapping.protocol);
        expect(obj?.type).toBe("protocol");
      }
    });
  });

  // Claims not yet mapped to prompt bias types — will be added when prompt is updated.
  // ANCHORING (DSK-B-001) maps from STRENGTH_CLUSTERING critique code, not a prompt bias type.
  // CONFIRMATION_BIAS (DSK-B-002) not referenced in current prompt semantic/structural tables.
  // OVERCONFIDENCE (DSK-B-004) not referenced in current prompt semantic/structural tables.
  // STATUS_QUO_BIAS (DSK-B-006) maps from MISSING_BASELINE critique code, not a prompt bias type.
  const UNMAPPED_CLAIMS_WAVE2 = new Set([
    "DSK-B-001", // Anchoring — maps from STRENGTH_CLUSTERING critique code
    "DSK-B-002", // Confirmation bias — not in current prompt tables
    "DSK-B-004", // Overconfidence — not in current prompt tables
    "DSK-B-006", // Status quo bias — maps from MISSING_BASELINE critique code
    "DSK-T-006", // Implementation intentions — coaching card, not a prompt principle
  ]);

  // DSK-P-006 (implementation intentions protocol) is referenced by DSK-TR-006
  // but not by any prompt principle. Will be added when prompt is updated.
  const UNMAPPED_PROTOCOLS_WAVE2 = new Set(["DSK-P-006"]);

  describe("no orphan claims or protocols", () => {
    it("every DSK claim is referenced by a map entry or listed as wave-2 unmapped", () => {
      const referencedClaims = new Set([
        ...Object.values(BIAS_TYPE_TO_DSK),
        ...Object.values(PRINCIPLE_TO_DSK)
          .filter((m): m is { claim: string; protocol: string } => m !== null)
          .map((m) => m.claim),
      ]);

      const allClaims = bundle.objects
        .filter((o) => o.type === "claim")
        .map((o) => o.id);

      for (const claimId of allClaims) {
        const referenced = referencedClaims.has(claimId) || UNMAPPED_CLAIMS_WAVE2.has(claimId);
        expect(
          referenced,
          `Claim ${claimId} is not referenced in any coverage map and not listed as wave-2`,
        ).toBe(true);
      }
    });

    it("every DSK protocol is referenced by a map entry or listed as wave-2 unmapped", () => {
      const referencedProtocols = new Set(
        Object.values(PRINCIPLE_TO_DSK)
          .filter((m): m is { claim: string; protocol: string } => m !== null)
          .map((m) => m.protocol),
      );

      const allProtocols = bundle.objects
        .filter((o) => o.type === "protocol")
        .map((o) => o.id);

      for (const protocolId of allProtocols) {
        const referenced = referencedProtocols.has(protocolId) || UNMAPPED_PROTOCOLS_WAVE2.has(protocolId);
        expect(
          referenced,
          `Protocol ${protocolId} is not referenced in any coverage map and not listed as wave-2`,
        ).toBe(true);
      }
    });
  });
});
