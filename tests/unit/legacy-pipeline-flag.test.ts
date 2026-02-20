/**
 * Tests for CEE_LEGACY_PIPELINE_ENABLED feature flag.
 *
 * 1. Config defaults to false when env var is absent
 * 2. Config is true when env var is "true"
 * 3. Pipeline B entry points throw when flag is off (runtime)
 * 4. Unified pipeline entry does NOT contain the legacy gate
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "fs";

const GATE_MESSAGE = "Pipeline B is archived. Set CEE_LEGACY_PIPELINE_ENABLED=true to re-enable.";

// ── Config default tests ────────────────────────────────────────────────────

describe("CEE_LEGACY_PIPELINE_ENABLED default", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to false when env var is absent", async () => {
    // Delete rather than stub-to-empty so we exercise the Zod .default(false) path
    delete process.env.CEE_LEGACY_PIPELINE_ENABLED;
    vi.resetModules();
    const { _resetConfigCache, config } = await import("../../src/config/index.js");
    _resetConfigCache();
    expect(config.cee.legacyPipelineEnabled).toBe(false);
  });

  it("is true when env var is 'true'", async () => {
    vi.stubEnv("CEE_LEGACY_PIPELINE_ENABLED", "true");
    vi.resetModules();
    const { _resetConfigCache, config } = await import("../../src/config/index.js");
    _resetConfigCache();
    expect(config.cee.legacyPipelineEnabled).toBe(true);
  });
});

// ── Runtime gate tests ──────────────────────────────────────────────────────

describe("Legacy pipeline gate (runtime)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("finaliseCeeDraftResponse throws when flag is off", async () => {
    delete process.env.CEE_LEGACY_PIPELINE_ENABLED;
    vi.resetModules();
    const { _resetConfigCache } = await import("../../src/config/index.js");
    _resetConfigCache();
    const { finaliseCeeDraftResponse } = await import("../../src/cee/validation/pipeline.js");
    await expect(
      finaliseCeeDraftResponse({} as any, {}, {} as any),
    ).rejects.toThrow(GATE_MESSAGE);
  });

  it("runDraftGraphPipeline throws when flag is off", async () => {
    delete process.env.CEE_LEGACY_PIPELINE_ENABLED;
    vi.resetModules();
    const { _resetConfigCache } = await import("../../src/config/index.js");
    _resetConfigCache();
    const { runDraftGraphPipeline } = await import("../../src/routes/assist.draft-graph.js");
    await expect(
      runDraftGraphPipeline({} as any, {}, "test-req"),
    ).rejects.toThrow(GATE_MESSAGE);
  });

  it("runUnifiedPipeline does NOT contain the legacy gate", () => {
    // Structural check: the unified pipeline source must never reference the gate.
    // A runtime call would require heavy mocking (FastifyRequest, LLM adapters, etc.)
    // so we verify absence of the gate string at source level.
    const source = readFileSync("src/cee/unified-pipeline/index.ts", "utf-8");
    expect(source).not.toContain("Pipeline B is archived");
  });
});
