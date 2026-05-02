/**
 * Endpoint-feature contract matrix.
 *
 * For each cross-boundary feature shipped in V5 (waves 1-3), assert that the
 * endpoint the UI actually calls produces the expected fields. The fixtures
 * in tests/fixtures/cross-service/ are used as canonical inputs/outputs.
 *
 * V5 route tests are NOT route-verified — booting /orchestrate/v2/turn
 * locally requires a session store, scenario commit, LLM router, and ingress
 * extension parsers; the substitute is a unit test of the same composition
 * primitives the route uses (buildFailureResponse, applyStalenessPrefix,
 * sanitiseOlumiResponseForEgress, and the chip-generator stale path).
 * Skipped route tests are flagged in
 * Docs/v5/cross-boundary-contract-test-report.md as `not_route_verified`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Mock the unified pipeline at module scope so the draft-graph route returns
// whatever fixture we feed it. We intentionally do NOT mock the route
// handler itself — the route's own behaviour (header stamping, error envelope,
// rate-limit pre-flight) is part of the contract under test.
import draftWithCoachingFixture from "../fixtures/cross-service/draft-graph.success.with-coaching-and-provenance.json";
import draftNoCoachingFixture from "../fixtures/cross-service/draft-graph.success.no-coaching.json";
import draftPartialCoachingFixture from "../fixtures/cross-service/draft-graph.success.partial-coaching.json";
import v5StaleFixture from "../fixtures/cross-service/v5-turn.explain-stale.json";
import v5FailureFixture from "../fixtures/cross-service/v5-turn.failure-with-recovery-chip.json";
import v5FreshFixture from "../fixtures/cross-service/v5-turn.explain-fresh.json";

import { sanitiseUserFacingText } from "../../src/orchestrator-v5/compose/output-safety.js";

let pipelineReturn: { statusCode: number; body: unknown; headers?: Record<string, string> } = {
  statusCode: 200,
  body: draftWithCoachingFixture,
};

vi.mock("../../src/cee/unified-pipeline/index.js", async () => {
  return {
    runUnifiedPipeline: vi.fn(async () => pipelineReturn),
  };
});

vi.stubEnv("ASSIST_API_KEYS", "contract-test-key");
vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "draft-model-contract-test");
vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "1000");

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

const HEADERS = { "X-Olumi-Assist-Key": "contract-test-key" } as const;
// Brief must be ≥ 30 chars per DraftGraphInput Zod schema (src/schemas/assist.ts).
const VALID_BRIEF = "Should we hire London engineers or offshore to Bangalore for compliance work?";

const FORBIDDEN_USER_TEXT = [
  "winner",
  "recommended",
  "error",
  "failed",
  "handler",
  "Zod",
  "executor",
  "AI service",
];

/**
 * User-facing prose paths — strings here are read by the user. The egress
 * scan ONLY scans these paths against ENTITY_ID_LEAK_RE; structural
 * pointers (node ids, intervention keys, etc.) are deliberately not scanned
 * because they ARE entity IDs by design.
 */
const USER_FACING_DRAFT_GRAPH_PATHS = [
  // Coaching prose (v0.11.0 schema amendment: widening_log is the
  // canonical OBJECT shape; the user-facing-prose path inside is
  // `widening_log.elements_considered_but_excluded[*]` — free-text reason
  // strings. `widening_log.elements_added[*]` is structural node IDs by
  // contract and NOT user-facing prose.)
  "coaching.summary",
  "coaching.strengthen_items[*].label",
  "coaching.strengthen_items[*].detail",
  "coaching.widening_log.elements_considered_but_excluded[*]",
  "coaching.bias_signals[*].detail",
  // Graph prose
  "nodes[*].label",
  "nodes[*].description",
  "edges[*].provenance.reasoning",
  "options[*].label",
  "options[*].description",
  // Validation/draft warning prose
  "validation_warnings[*].message",
  "validation_warnings[*].suggestion",
  "draft_warnings[*].explanation",
  "draft_warnings[*].fix_hint",
];

/**
 * Walks a JSON value yielding (jsonPath, leafString) pairs for every primitive
 * string. Array indexes are normalised to `[*]` so excluded-path matching is
 * stable across array length.
 */
function* walkStrings(
  value: unknown,
  path: string,
): Generator<[string, string]> {
  if (typeof value === "string") {
    yield [path, value];
  } else if (Array.isArray(value)) {
    for (const child of value) {
      const childPath = path ? `${path}[*]` : "[*]";
      yield* walkStrings(child, childPath);
    }
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      yield* walkStrings(v, path ? `${path}.${k}` : k);
    }
  }
}

describe("/assist/v1/draft-graph endpoint contract", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("success carries coaching (summary, strengthen_items, widening_log, bias_signals)", async () => {
    pipelineReturn = { statusCode: 200, body: draftWithCoachingFixture };

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: HEADERS,
      payload: { brief: VALID_BRIEF },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.coaching).toBeDefined();
    expect(typeof body.coaching.summary).toBe("string");
    expect(body.coaching.summary.length).toBeGreaterThan(0);
    expect(Array.isArray(body.coaching.strengthen_items)).toBe(true);
    expect(body.coaching.strengthen_items.length).toBeGreaterThanOrEqual(2);
    // v0.11.0 schema amendment: widening_log is the canonical object
    // (was array pre-amendment). bias_signals remains an array.
    expect(typeof body.coaching.widening_log).toBe("object");
    expect(body.coaching.widening_log).not.toBeNull();
    expect(Array.isArray(body.coaching.widening_log.elements_added)).toBe(true);
    expect(Array.isArray(body.coaching.bias_signals)).toBe(true);
    for (const item of body.coaching.strengthen_items) {
      expect(item).toMatchObject({
        id: expect.any(String),
        label: expect.any(String),
        detail: expect.any(String),
        action_type: expect.any(String),
      });
    }
  });

  it("success carries node provenance ∈ {from_brief, ai_inferred, user_set}", async () => {
    pipelineReturn = { statusCode: 200, body: draftWithCoachingFixture };

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: HEADERS,
      payload: { brief: VALID_BRIEF },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.nodes)).toBe(true);
    const valid = new Set(["from_brief", "ai_inferred", "user_set"]);
    const observed = new Set<string>();
    for (const n of body.nodes) {
      expect(typeof n.provenance).toBe("string");
      expect(valid.has(n.provenance)).toBe(true);
      observed.add(n.provenance);
    }
    // Fixture 1 covers all three values
    expect(observed.size).toBeGreaterThanOrEqual(3);
  });

  it("success carries edge provenance_display ∈ {from_brief, ai_inferred, user_set}", async () => {
    pipelineReturn = { statusCode: 200, body: draftWithCoachingFixture };

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: HEADERS,
      payload: { brief: VALID_BRIEF },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.edges)).toBe(true);
    const valid = new Set(["from_brief", "ai_inferred", "user_set"]);
    const observed = new Set<string>();
    for (const e of body.edges) {
      expect(typeof e.provenance_display).toBe("string");
      expect(valid.has(e.provenance_display)).toBe(true);
      observed.add(e.provenance_display);
    }
    expect(observed.size).toBeGreaterThanOrEqual(3);
  });

  it("error response (400) omits coaching", async () => {
    pipelineReturn = {
      statusCode: 400,
      body: {
        schema: "cee.error.v1",
        code: "CEE_PIPELINE_FAILED",
        message: "synthetic failure",
        retryable: false,
      },
    };

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: HEADERS,
      payload: { brief: VALID_BRIEF },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).not.toHaveProperty("coaching");
    expect(body.code).toBe("CEE_PIPELINE_FAILED");
  });

  // Brief test 5 ("Mocked coaching containing fac_test_id is sanitised
  // in the response") lives in tests/contract/stage-5-sanitisation.test.ts.
  // That file drives runStagePackage(ctx) directly with dirty coaching
  // and asserts ctx.ceeResponse.coaching is scrubbed end-to-end. The
  // Stage 5 boundary is the closest stable substitute
  // (sanitiseCoachingForDisplay is module-private) and catches
  // integration drift if Stage 5 ever stops calling its sanitiser.
  // See report §3 skip-and-substitute table.

  it("response with no coaching succeeds (coaching field absent)", async () => {
    pipelineReturn = { statusCode: 200, body: draftNoCoachingFixture };

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: HEADERS,
      payload: { brief: VALID_BRIEF },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.coaching).toBeUndefined();
    expect(Array.isArray(body.nodes)).toBe(true);
  });

  it("partial coaching is preserved (summary null, empty arrays, omitted optional fields)", async () => {
    pipelineReturn = { statusCode: 200, body: draftPartialCoachingFixture };

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: HEADERS,
      payload: { brief: VALID_BRIEF },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.coaching).toBeDefined();
    expect(body.coaching.summary).toBeNull();
    expect(body.coaching.strengthen_items).toEqual([]);
  });

  it("egress scan: no confirmed entity-ID leaks in user-facing prose (path-aware)", () => {
    // Use the production sanitiser's `sanitiseUserFacingText`: the raw
    // ENTITY_ID_LEAK_RE pattern triggers on legitimate hyphenated English
    // ("decision-relevant", "outcome-oriented"); the sanitiser then confirms
    // each match (digit present, ambiguous-prefix check, suffix shape, etc.)
    // and reports only confirmed leaks. This test asserts that no confirmed
    // leak survives — the contract the egress guard enforces in production.
    const fixture = draftWithCoachingFixture as unknown;
    for (const [path, str] of walkStrings(fixture, "")) {
      const normalised = path.replace(/\[\d+\]/g, "[*]");
      if (!USER_FACING_DRAFT_GRAPH_PATHS.includes(normalised)) continue;
      const r = sanitiseUserFacingText(str, null);
      expect(
        r.matches.length,
        `confirmed entity-ID leak at ${path}: ${r.matches.map((m) => m.prefix).join(", ")} in: ${str.slice(0, 120)}`,
      ).toBe(0);
    }
  });

  it("egress scan: no forbidden terms in user-facing prose (path-aware)", () => {
    for (const [path, str] of walkStrings(draftWithCoachingFixture, "")) {
      const normalised = path.replace(/\[\d+\]/g, "[*]");
      if (!USER_FACING_DRAFT_GRAPH_PATHS.includes(normalised)) continue;
      const lower = str.toLowerCase();
      for (const term of FORBIDDEN_USER_TEXT) {
        expect(
          lower.includes(term.toLowerCase()),
          `forbidden term '${term}' at ${path}: ${str.slice(0, 120)}`,
        ).toBe(false);
      }
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// /orchestrate/v2/turn — substitute coverage
// ──────────────────────────────────────────────────────────────────────────
//
// The V5 turn route requires a Supabase session store, scenario row, LLM
// router, and ingress extension parsers — bootstrapping all of that for a
// route-verified test would duplicate the existing tests/integration/
// orchestrate-v2.test.ts plumbing without adding contract value. Per the
// brief's skip-and-substitute policy, V5 contract assertions exercise the
// composition primitives the route uses end-to-end:
//   - applyStalenessPrefix: stale prefix on assistant text
//   - chip-generator stale path: rerun chip on a noop explanation handler
//     fact when analysis carries staleness_reason and analysis is ready
//   - buildFailureResponse: error block + recovery chip on failure paths
//   - sanitiseOlumiResponseForEgress: entity-ID guard on the egress envelope
//
// These all share state with the route — the route is the orchestration that
// calls them in sequence. Tests classified `not_route_verified` in the
// report.

import { applyStalenessPrefix, STALENESS_PREFIX } from "../../src/orchestrator-v5/tools/handlers/staleness-prefix.js";
import { buildFailureResponse } from "../../src/orchestrator-v5/failure-response.js";
import { sanitiseOlumiResponseForEgress } from "../../src/orchestrator-v5/compose/output-safety.js";

describe("/orchestrate/v2/turn — substitute composition primitives", () => {
  it("[stale-prefix] applyStalenessPrefix prepends canonical caveat when staleness_reason is non-null", () => {
    const result = applyStalenessPrefix(
      "The London hire option leads in roughly 62% of simulations.",
      "loaded_from_prior_run",
    );
    expect(result.prefixed).toBe(true);
    expect(result.text.startsWith(STALENESS_PREFIX)).toBe(true);
  });

  it("[stale-prefix] applyStalenessPrefix is idempotent on already-prefixed text", () => {
    const text = `${STALENESS_PREFIX} Some figures.`;
    const result = applyStalenessPrefix(text, "loaded_from_prior_run");
    expect(result.prefixed).toBe(false);
    expect(result.text).toBe(text);
  });

  it("[stale-prefix] no prefix added when staleness_reason is null", () => {
    const result = applyStalenessPrefix("Fresh prose.", null);
    expect(result.prefixed).toBe(false);
    expect(result.text).toBe("Fresh prose.");
  });

  it("[failure] buildFailureResponse emits a non-empty recovery chip + preserved error_code", () => {
    const response = buildFailureResponse(
      "LLM_TIMEOUT",
      "analyse",
      undefined,
      {
        previousUserMessage: "Compare the London hire option against offshoring to Bangalore.",
        analysisReady: false,
        scenarioId: "scn_test",
        turnId: "turn_test",
        isRetry: false,
        handlerId: null,
      },
    );

    expect(response.assistant_text.length).toBeGreaterThan(0);
    expect(response.suggested_actions.length).toBeGreaterThanOrEqual(1);
    expect(response.blocks.length).toBeGreaterThan(0);
    expect(response.blocks[0].type).toBe("error");
    if (response.blocks[0].type === "error") {
      expect(typeof response.blocks[0].error_code).toBe("string");
    }

    // No forbidden terms in the recovery copy
    for (const term of FORBIDDEN_USER_TEXT) {
      expect(response.assistant_text.toLowerCase().includes(term.toLowerCase())).toBe(false);
    }
  });

  it("[failure] failure response chip contains the previous user message in the prompt-style retry", () => {
    const previous = "Compare the London hire option against offshoring to Bangalore.";
    const response = buildFailureResponse(
      "LLM_TIMEOUT",
      "analyse",
      undefined,
      {
        previousUserMessage: previous,
        analysisReady: false,
        scenarioId: "scn_test",
        turnId: "turn_test",
        isRetry: false,
        handlerId: null,
      },
    );

    const chip = response.suggested_actions[0];
    expect(chip.label).toBe("Try again");
    // Retry chips OMIT action_type per recovery-chips.ts contract
    expect(chip.action_type).toBeUndefined();
    expect(chip.message).toBe(previous);
  });

  it("[stale-fixture] explain-stale fixture: assistant_text carries canonical staleness prefix + run_analysis chip", () => {
    expect(v5StaleFixture.assistant_text.startsWith(STALENESS_PREFIX)).toBe(true);

    const runAnalysisChips = v5StaleFixture.suggested_actions.filter(
      (c) => c.action_type === "run_analysis",
    );
    expect(runAnalysisChips.length).toBe(1);
    // Brief calls this chip "Rerun analysis" — code agrees (chip-generator.ts:235).
    expect(runAnalysisChips[0].label).toBe("Rerun analysis");
  });

  it("[fresh-fixture] explain-fresh fixture: no staleness prefix, no run_analysis chip", () => {
    expect(v5FreshFixture.assistant_text.startsWith(STALENESS_PREFIX)).toBe(false);
    const runAnalysisChips = v5FreshFixture.suggested_actions.filter(
      (c) => c.action_type === "run_analysis",
    );
    expect(runAnalysisChips.length).toBe(0);
  });

  it("[failure-fixture] failure-with-recovery-chip fixture: ≥1 chip + preserved error_code + no forbidden terms", () => {
    expect(v5FailureFixture.suggested_actions.length).toBeGreaterThanOrEqual(1);
    const errorBlock = v5FailureFixture.blocks.find((b) => b.type === "error");
    expect(errorBlock).toBeDefined();
    expect(errorBlock?.error_code).toBe("UPSTREAM_TIMEOUT");

    for (const term of FORBIDDEN_USER_TEXT) {
      expect(
        v5FailureFixture.assistant_text.toLowerCase().includes(term.toLowerCase()),
        `forbidden term '${term}' in failure assistant_text`,
      ).toBe(false);
    }
  });

  it("[egress-guard] sanitiseOlumiResponseForEgress scrubs entity-ID-shaped tokens from user-facing prose", () => {
    const dirty = {
      response_version: 2 as const,
      assistant_text: "The fac_revenue is a strong factor in this analysis.",
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: "review" as const,
    };
    const scrubbed = sanitiseOlumiResponseForEgress(dirty, {
      graph: null,
      requestId: "test",
      exitPath: "test",
    });
    expect(scrubbed.assistant_text).not.toContain("fac_revenue");
  });

  it("[egress-scan] all user-facing fixture strings are entity-ID clean (path-aware exclusions)", () => {
    const v5UserFacingPaths = [
      "assistant_text",
      "blocks[*].narrative",
      "blocks[*].content",
      "blocks[*].summary",
      "suggested_actions[*].label",
      "suggested_actions[*].message",
      "insights[*].text",
    ];
    const v5Excluded = new Set([
      "blocks[*].error_code",
      "blocks[*].leading_option_id",
      "blocks[*].referenced_option_ids[*]",
      "suggested_actions[*].id",
      "suggested_actions[*].action_type",
    ]);

    for (const fixture of [v5StaleFixture, v5FreshFixture, v5FailureFixture]) {
      for (const [path, str] of walkStrings(fixture, "")) {
        const normalised = path.replace(/\[\d+\]/g, "[*]");
        if (v5Excluded.has(normalised)) continue;
        if (!v5UserFacingPaths.includes(normalised)) continue;
        const r = sanitiseUserFacingText(str, null);
        expect(
          r.matches.length,
          `confirmed entity-ID leak at ${path}: ${str.slice(0, 120)}`,
        ).toBe(0);
      }
    }
  });
});
