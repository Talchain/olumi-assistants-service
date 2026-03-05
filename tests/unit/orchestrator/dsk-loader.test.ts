/**
 * DSK Loader Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";

// ============================================================================
// Mock setup
// ============================================================================

// Must mock config before importing the loader
vi.mock("../../../src/config/index.js", () => ({
  config: {
    features: {
      dskV0: false,
      dskEnabled: false,
    },
  },
}));

vi.mock("../../../src/utils/telemetry.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock node:fs so we can control file reads
vi.mock("node:fs");

// Mock computeDSKHash to return the bundle's stored hash by default (simulating valid bundle).
// Individual tests override this to test hash mismatch.
vi.mock("../../../src/dsk/hash.js", () => ({
  computeDSKHash: vi.fn((bundle: { dsk_version_hash: string }) => bundle.dsk_version_hash),
}));

// ============================================================================
// Tests
// ============================================================================

const TEST_BUNDLE = {
  version: '1.0.0',
  generated_at: '2026-01-01T00:00:00Z',
  dsk_version_hash: 'abc123hash',
  objects: [
    {
      id: 'DSK-T-001',
      type: 'claim',
      title: 'Anchoring Bias',
      deprecated: false,
      stage_applicability: ['frame', 'evaluate'],
      context_tags: ['uncertainty', 'framing'],
      evidence_strength: 'strong',
      contraindications: [],
      version: '1.0.0',
      last_reviewed_at: '2025-01-01',
      source_citations: [],
      claim_category: 'empirical',
      scope: { decision_contexts: ['any'], stages: ['frame'], populations: ['any'], exclusions: ['none'] },
      permitted_phrasing_band: 'medium',
      evidence_pack: {
        key_findings: 'Anchoring affects estimates',
        effect_direction: 'negative',
        boundary_conditions: 'General',
        known_limitations: 'None',
      },
    },
    {
      id: 'DSK-B-001',
      type: 'claim',
      title: 'Confirmation Bias',
      deprecated: false,
      stage_applicability: ['evaluate'],
      context_tags: ['bias', 'evaluation'],
      evidence_strength: 'strong',
      contraindications: [],
      version: '1.0.0',
      last_reviewed_at: '2025-01-01',
      source_citations: [],
      claim_category: 'empirical',
      scope: { decision_contexts: ['any'], stages: ['evaluate'], populations: ['any'], exclusions: ['none'] },
      permitted_phrasing_band: 'strong',
      evidence_pack: {
        key_findings: 'Confirmation bias affects evaluation',
        effect_direction: 'negative',
        boundary_conditions: 'General',
        known_limitations: 'None',
      },
    },
  ],
};

describe("DSK Loader", () => {
  let loadDskBundle: () => void;
  let queryDsk: (stage: string, tags: string[], codes: string[]) => unknown[];
  let getDskVersionHash: () => string | null;
  let _resetDskBundle: () => void;
  let configModule: { config: { features: { dskV0: boolean; dskEnabled: boolean } } };
  let logModule: { log: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } };

  beforeEach(async () => {
    // Reset mocks
    vi.resetAllMocks();

    // Re-import to get fresh module with mocked dependencies
    const module = await import("../../../src/orchestrator/dsk-loader.js");
    loadDskBundle = module.loadDskBundle;
    queryDsk = module.queryDsk;
    getDskVersionHash = module.getDskVersionHash;
    _resetDskBundle = module._resetDskBundle;

    configModule = await import("../../../src/config/index.js");
    logModule = await import("../../../src/utils/telemetry.js") as unknown as typeof logModule;

    _resetDskBundle();
  });

  describe("when flag is OFF", () => {
    it("loadDskBundle is a no-op, does not read file", () => {
      configModule.config.features.dskV0 = false;
      loadDskBundle();
      expect(fs.readFileSync).not.toHaveBeenCalled();
    });

    it("queryDsk returns empty array", () => {
      configModule.config.features.dskV0 = false;
      loadDskBundle();
      const results = queryDsk('frame', ['uncertainty'], []);
      expect(results).toEqual([]);
    });

    it("getDskVersionHash returns null", () => {
      configModule.config.features.dskV0 = false;
      loadDskBundle();
      expect(getDskVersionHash()).toBeNull();
    });
  });

  describe("when flag is ON and file is present", () => {
    beforeEach(async () => {
      configModule.config.features.dskV0 = true;
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(TEST_BUNDLE));
      // Restore hash mock: return stored hash (valid bundle)
      const hashModule = await import("../../../src/dsk/hash.js");
      vi.mocked(hashModule.computeDSKHash).mockImplementation(
        (bundle: { dsk_version_hash: string }) => bundle.dsk_version_hash,
      );
      _resetDskBundle();
    });

    it("loads bundle successfully", () => {
      loadDskBundle();
      expect(getDskVersionHash()).toBe('abc123hash');
    });

    it("returns version hash", () => {
      loadDskBundle();
      expect(getDskVersionHash()).toBe('abc123hash');
    });

    it("queryDsk filters by stage", () => {
      loadDskBundle();
      const results = queryDsk('frame', ['uncertainty'], []);
      expect(results).toHaveLength(1);
      expect((results[0] as any).id).toBe('DSK-T-001');
    });

    it("queryDsk filters by context_tags", () => {
      loadDskBundle();
      const results = queryDsk('evaluate', ['bias'], []);
      expect(results).toHaveLength(1);
      expect((results[0] as any).id).toBe('DSK-B-001');
    });

    it("queryDsk returns stable sort by id asc", () => {
      loadDskBundle();
      const results = queryDsk('evaluate', ['bias', 'uncertainty', 'evaluation'], []);
      if (results.length > 1) {
        for (let i = 1; i < results.length; i++) {
          expect((results[i - 1] as any).id <= (results[i] as any).id).toBe(true);
        }
      }
    });

    it("queryDsk excludes deprecated objects", () => {
      const bundleWithDeprecated = {
        ...TEST_BUNDLE,
        objects: [
          ...TEST_BUNDLE.objects,
          {
            ...TEST_BUNDLE.objects[0],
            id: 'DSK-T-002',
            deprecated: true,
          },
        ],
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(bundleWithDeprecated));
      _resetDskBundle();
      loadDskBundle();
      const results = queryDsk('frame', ['uncertainty'], []);
      const ids = results.map((r) => (r as any).id);
      expect(ids).not.toContain('DSK-T-002');
    });

    it("rejects bundle with hash mismatch — throws with both hashes in message", async () => {
      const hashModule = await import("../../../src/dsk/hash.js");
      vi.mocked(hashModule.computeDSKHash).mockReturnValue('different-hash-xyz');
      _resetDskBundle();

      expect(() => loadDskBundle()).toThrow(/hash mismatch/);
      expect(() => loadDskBundle()).toThrow(/different-hash-xyz/);
    });
  });

  describe("when flag is ON and file is missing", () => {
    beforeEach(() => {
      configModule.config.features.dskV0 = true;
      const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      vi.mocked(fs.readFileSync).mockImplementation(() => { throw enoentError; });
      _resetDskBundle();
    });

    it("throws with file-not-found message", () => {
      expect(() => loadDskBundle()).toThrow(/not found/);
    });
  });

  describe("when flag is ON and file has invalid JSON", () => {
    beforeEach(() => {
      configModule.config.features.dskV0 = true;
      vi.mocked(fs.readFileSync).mockReturnValue('{ invalid json }');
      _resetDskBundle();
    });

    it("throws with not-valid-JSON message", () => {
      expect(() => loadDskBundle()).toThrow(/not valid JSON/);
    });
  });

  describe("when flag is ON and file has invalid bundle shape", () => {
    beforeEach(() => {
      configModule.config.features.dskV0 = true;
      _resetDskBundle();
    });

    it("missing version — throws with shape error details", () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ objects: [], dsk_version_hash: 'abc' }));
      expect(() => loadDskBundle()).toThrow(/shape invalid.*version/);
    });

    it("objects is not an array — throws with shape error details", () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: '1.0.0', objects: null, dsk_version_hash: 'abc', generated_at: '2026-01-01T00:00:00Z' }));
      expect(() => loadDskBundle()).toThrow(/shape invalid.*objects/);
    });

    it("empty dsk_version_hash — throws with shape error details", () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: '1.0.0', objects: [], dsk_version_hash: '', generated_at: '2026-01-01T00:00:00Z' }));
      expect(() => loadDskBundle()).toThrow(/shape invalid.*dsk_version_hash/);
    });

    it("missing generated_at — throws with shape error details", () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: '1.0.0', objects: [], dsk_version_hash: 'abc' }));
      expect(() => loadDskBundle()).toThrow(/shape invalid.*generated_at/);
    });
  });
});
