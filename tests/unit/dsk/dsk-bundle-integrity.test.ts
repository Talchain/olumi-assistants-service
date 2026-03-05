/**
 * DSK bundle integrity tests.
 *
 * Loads the actual production bundle from data/dsk/v1.json (not mocked)
 * and validates structural integrity: IDs, cross-references, hash, citations.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  DSKBundle,
  DSKClaim,
  DSKProtocol,
  DSKTrigger,
} from "../../../src/dsk/types.js";
import { DSK_ID_REGEX } from "../../../src/dsk/types.js";
import { verifyDSKHash } from "../../../src/dsk/hash.js";
import { lintBundle } from "../../../src/dsk/linter.js";

// ---------------------------------------------------------------------------
// Load production bundle and vocab
// ---------------------------------------------------------------------------

const bundlePath = resolve(process.cwd(), "data/dsk/v1.json");
const bundle: DSKBundle = JSON.parse(readFileSync(bundlePath, "utf-8"));

const vocabPath = resolve(process.cwd(), "data/dsk/context-tags.json");
const vocab: string[] = JSON.parse(readFileSync(vocabPath, "utf-8"));

const EXPECTED_HASH =
  "ca0f63fb0a7d942ccd7b5be67ffde5ad61edef92f8181269d8f966d690d9c896";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DSK bundle integrity", () => {
  it("passes the full linter without errors", () => {
    const result = lintBundle(bundle, vocab);
    expect(result.exitCode, `Linter errors: ${JSON.stringify(result.errors)}`).not.toBe(1);
  });

  it("all IDs match DSK_ID_REGEX", () => {
    for (const obj of bundle.objects) {
      expect(obj.id).toMatch(DSK_ID_REGEX);
    }
  });

  it("no duplicate IDs", () => {
    const ids = bundle.objects.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("hash verifies via verifyDSKHash()", () => {
    expect(verifyDSKHash(bundle)).toBe(true);
  });

  it("hash matches expected test vector", () => {
    expect(bundle.dsk_version_hash).toBe(EXPECTED_HASH);
  });

  it("no null values in doi_or_isbn fields", () => {
    for (const obj of bundle.objects) {
      for (const citation of obj.source_citations) {
        expect(citation.doi_or_isbn).not.toBeNull();
        expect(typeof citation.doi_or_isbn).toBe("string");
      }
    }
  });

  it("evidence_strength is strong or medium for all objects", () => {
    for (const obj of bundle.objects) {
      expect(
        ["strong", "medium"].includes(obj.evidence_strength),
        `${obj.id} has evidence_strength="${obj.evidence_strength}"`,
      ).toBe(true);
    }
  });

  it("claim_category is empirical or technique_efficacy for all claims", () => {
    const claims = bundle.objects.filter(
      (o): o is DSKClaim => o.type === "claim",
    );
    for (const claim of claims) {
      expect(
        ["empirical", "technique_efficacy"].includes(claim.claim_category),
        `${claim.id} has claim_category="${claim.claim_category}"`,
      ).toBe(true);
    }
  });

  it("no PLACEHOLDER strings remain", () => {
    const raw = readFileSync(bundlePath, "utf-8");
    expect(raw).not.toContain("PLACEHOLDER");
  });

  it("trigger source_citations: [] is acceptable", () => {
    const triggers = bundle.objects.filter(
      (o): o is DSKTrigger => o.type === "trigger",
    );
    for (const trigger of triggers) {
      expect(Array.isArray(trigger.source_citations)).toBe(true);
    }
  });

  describe("cross-references", () => {
    const idSet = new Map(bundle.objects.map((o) => [o.id, o]));

    it("trigger linked_claim_ids all resolve to claims", () => {
      const triggers = bundle.objects.filter(
        (o): o is DSKTrigger => o.type === "trigger",
      );
      for (const trigger of triggers) {
        for (const claimId of trigger.linked_claim_ids) {
          const target = idSet.get(claimId);
          expect(target, `${trigger.id} → ${claimId} not found`).toBeDefined();
          expect(target?.type).toBe("claim");
        }
      }
    });

    it("trigger linked_protocol_ids all resolve to protocols", () => {
      const triggers = bundle.objects.filter(
        (o): o is DSKTrigger => o.type === "trigger",
      );
      for (const trigger of triggers) {
        for (const protocolId of trigger.linked_protocol_ids) {
          const target = idSet.get(protocolId);
          expect(
            target,
            `${trigger.id} → ${protocolId} not found`,
          ).toBeDefined();
          expect(target?.type).toBe("protocol");
        }
      }
    });

    it("protocol linked_claim_id resolves to a claim (when present)", () => {
      const protocols = bundle.objects.filter(
        (o): o is DSKProtocol => o.type === "protocol",
      );
      for (const protocol of protocols) {
        if (protocol.linked_claim_id) {
          const target = idSet.get(protocol.linked_claim_id);
          expect(
            target,
            `${protocol.id} → ${protocol.linked_claim_id} not found`,
          ).toBeDefined();
          expect(target?.type).toBe("claim");
        }
      }
    });
  });
});
