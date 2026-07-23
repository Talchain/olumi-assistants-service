/**
 * Truncation-failure recovery — honest copy + typed mapping.
 *
 * PROBE FINDING (S-AUDIT-2026-07-20 probe lane 1, aggravator 1): when a draft
 * generation is cut at the derived token budget (stop_reason=max_tokens), the
 * pipeline served the generic vague-brief recovery hint — "Provide a clearer,
 * more specific decision brief." — which INCREASES output-token demand and
 * steers the user directly back into the failure. The three probed failures
 * (briefs of 344–1,730 chars) were well-formed drafts mid-generation, not
 * vague-brief garbage; asking for MORE specificity makes the next attempt
 * strictly more likely to truncate again.
 *
 * These tests pin the honest mapping: a truncation-flagged failure gets
 * demand-REDUCING recovery copy (shorter brief / fewer options / try again)
 * and a distinct diagnosable reason, while the vague-brief copy stays exactly
 * as it was for genuinely unparseable output.
 *
 * Also pinned: a truncated generation whose extracted-but-partial object fails
 * SCHEMA validation maps to the same typed 400 — previously the truncation
 * prefix broke the `^anthropic_response_invalid_schema` anchor and the request
 * fell through to an untyped 500 CEE_INTERNAL_ERROR with no recovery at all.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/cee/unified-pipeline/stages/parse.js", () => ({
  runStageParse: vi.fn(),
}));
vi.mock("../../src/cee/unified-pipeline/stages/normalise.js", () => ({
  runStageNormalise: vi.fn(),
}));
vi.mock("../../src/cee/unified-pipeline/stages/enrich.js", () => ({
  runStageEnrich: vi.fn(),
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/index.js", () => ({
  runStageRepair: vi.fn(),
}));
vi.mock("../../src/cee/unified-pipeline/stages/package.js", () => ({
  runStagePackage: vi.fn(),
}));
vi.mock("../../src/cee/unified-pipeline/stages/boundary.js", () => ({
  runStageBoundary: vi.fn(),
}));

vi.mock("../../src/config/index.js", () => ({
  config: {
    cee: {
      pipelineCheckpointsEnabled: false,
    },
    features: {
      diagnosticTraceEnabled: false,
    },
  },
}));

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

vi.mock("../../src/cee/corrections.js", () => ({
  createCorrectionCollector: () => ({
    add: vi.fn(),
    addByStage: vi.fn(),
    getCorrections: () => [],
    getSummary: () => ({ total: 0, by_layer: {}, by_type: {} }),
    hasCorrections: () => false,
    count: () => 0,
  }),
}));

vi.mock("../../src/utils/request-id.js", () => ({
  getRequestId: () => "test-request-id",
  generateRequestId: () => "test-plan-id-0000-0000-000000000000",
}));

vi.mock("../../src/cee/validation/pipeline.js", () => ({
  buildCeeErrorResponse: (code: string, msg: string, opts?: any) => ({
    schema: "cee.error.v1",
    code,
    message: msg,
    reason: opts?.reason,
    retryable: opts?.retryable,
    recovery: opts?.recovery,
  }),
}));

import { runUnifiedPipeline } from "../../src/cee/unified-pipeline/index.js";
import { runStageParse } from "../../src/cee/unified-pipeline/stages/parse.js";
import { UpstreamNonJsonError } from "../../src/adapters/llm/errors.js";

const mockRequest = {
  id: "test",
  headers: {},
  query: {},
  raw: { destroyed: false },
} as any;

const baseOpts = {
  schemaVersion: "v3" as const,
};

/** The adapter's truncation-typed parse failure: an UpstreamNonJsonError
 *  carrying the structured truncation flag it now attaches at throw time. */
function makeTruncatedNonJsonError(): UpstreamNonJsonError {
  return Object.assign(
    new UpstreamNonJsonError(
      "anthropic draft_graph output truncated at max_tokens=8550 (stop_reason=max_tokens, " +
        "output_tokens=8550) — runaway generation returned truncated JSON " +
        "inside the 110000ms timeout instead of hanging to it",
      "anthropic",
      "draft_graph",
      52_000,
      '{"nodes":[{"id":"opt_1","kind":"option","label":"Migrate now',
    ),
    { truncated_at_max_tokens: true },
  );
}

describe("truncation-failure recovery copy (probe aggravator 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("truncated parse failure → typed 400 with a DISTINCT reason, not the generic llm_non_json", async () => {
    (runStageParse as any).mockImplementation(async () => {
      throw makeTruncatedNonJsonError();
    });

    const result = await runUnifiedPipeline(
      { brief: "A perfectly ordinary 400-char business brief" } as any,
      {},
      mockRequest,
      baseOpts,
    );

    expect(result.statusCode).toBe(400);
    expect((result.body as any).code).toBe("CEE_LLM_VALIDATION_FAILED");
    expect((result.body as any).reason).toBe("llm_truncated_max_tokens");
  });

  it("truncation recovery copy NEVER asks for more specificity — it reduces demand (shorter brief / fewer options / try again)", async () => {
    (runStageParse as any).mockImplementation(async () => {
      throw makeTruncatedNonJsonError();
    });

    const result = await runUnifiedPipeline(
      { brief: "A perfectly ordinary 400-char business brief" } as any,
      {},
      mockRequest,
      baseOpts,
    );

    const recovery = (result.body as any).recovery;
    expect(recovery).toBeDefined();
    const allCopy = [recovery.suggestion, ...(recovery.hints ?? [])].join(" ").toLowerCase();
    // The anti-pattern the probe caught: steering the user toward MORE output
    // tokens on a failure caused by too many output tokens.
    expect(allCopy).not.toContain("more specific");
    expect(allCopy).not.toContain("clearer");
    // The honest levers: scope reduction (fewer options / one decision) + retry.
    expect(allCopy).toMatch(/shorter|simplif|fewer|focus/);
    expect(allCopy).toMatch(/try again|retry/);
  });

  it("2026-07-23 firefight: RETRY is the PRIMARY lever and the copy NEVER says 'simplify the brief' (counterproductive — a vaguer brief infers MORE factors)", async () => {
    (runStageParse as any).mockImplementation(async () => {
      throw makeTruncatedNonJsonError();
    });

    const result = await runUnifiedPipeline(
      { brief: "A perfectly ordinary 400-char business brief" } as any,
      {},
      mockRequest,
      baseOpts,
    );

    const recovery = (result.body as any).recovery;
    // The suggestion (primary, first-read copy) leads with retry, not blame.
    expect(recovery.suggestion.toLowerCase()).toMatch(/try again|retry/);
    // The exact counterproductive phrasing the firefight removed. A vaguer /
    // "simpler" brief gives the model less to anchor on → it infers MORE factors
    // → a LARGER graph → MORE likely to truncate again (the cruel inversion).
    const allCopy = [recovery.suggestion, ...(recovery.hints ?? [])].join(" ").toLowerCase();
    expect(allCopy).not.toContain("simplify the brief");
    expect(allCopy).not.toContain("too large to finish");
    // Truncation is transient over-generation — the wire marks it retryable.
    expect((result.body as any).retryable).toBe(true);
  });

  it("truncated-then-schema-invalid failure maps to the SAME typed 400 + truncation recovery (was an untyped 500 with none)", async () => {
    // anthropic.ts prefixes the schema-validation message with the truncation
    // note, which breaks the `^anthropic_response_invalid_schema` anchor — the
    // structured flag, not the message, must carry the classification.
    (runStageParse as any).mockImplementation(async () => {
      throw Object.assign(
        new Error(
          "anthropic draft_graph output truncated at max_tokens=8550 (stop_reason=max_tokens, " +
            "output_tokens=8550) — truncated JSON failed schema validation — " +
            "anthropic_response_invalid_schema: nodes: Required",
        ),
        { truncated_at_max_tokens: true },
      );
    });

    const result = await runUnifiedPipeline(
      { brief: "A perfectly ordinary 400-char business brief" } as any,
      {},
      mockRequest,
      baseOpts,
    );

    expect(result.statusCode).toBe(400);
    expect((result.body as any).code).toBe("CEE_LLM_VALIDATION_FAILED");
    expect((result.body as any).reason).toBe("llm_truncated_max_tokens");
    const recovery = (result.body as any).recovery;
    expect(recovery).toBeDefined();
    expect([recovery.suggestion, ...(recovery.hints ?? [])].join(" ").toLowerCase()).not.toContain(
      "more specific",
    );
  });

  it("NON-truncated non-JSON failure keeps the vague-brief copy unchanged (no overreach)", async () => {
    (runStageParse as any).mockImplementation(async () => {
      throw new UpstreamNonJsonError(
        "LLM returned non-JSON",
        "anthropic",
        "draft_graph",
        5000,
        "asdf garbled output...",
      );
    });

    const result = await runUnifiedPipeline(
      { brief: "asdfjkl; purple monkey dishwasher" } as any,
      {},
      mockRequest,
      baseOpts,
    );

    expect(result.statusCode).toBe(400);
    expect((result.body as any).reason).toBe("llm_non_json");
    expect((result.body as any).recovery.suggestion).toBe(
      "Provide a clearer, more specific decision brief.",
    );
  });
});
