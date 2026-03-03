/**
 * CEE Preflight SSE Parity Integration Tests
 *
 * Validates that the /assist/v1/draft-graph/stream endpoint applies the same
 * preflight policy ladder as the sync endpoint:
 *
 * - Gibberish briefs → SSE `error` event with code CEE_VALIDATION_FAILED
 *   and reason BRIEF_APPEARS_GIBBERISH (NOT a graph stream)
 * - Valid briefs proceed normally
 *
 * SSE protocol: HTTP status is always 200 (stream opened). Errors and
 * guidance are communicated via typed events within the stream.
 *
 * Policy ladder reference: src/cee/validation/preflight-decision.ts
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider for deterministic graphs and zero cost
vi.stubEnv("LLM_PROVIDER", "fixtures");

// Disable external integrations that might cause hangs
vi.stubEnv("CEE_CAUSAL_VALIDATION_ENABLED", "false");
vi.stubEnv("VALIDATION_CACHE_ENABLED", "false");

// Avoid calling real engine validate service
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
}));

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";
import { _resetConfigCache } from "../../src/config/index.js";

/**
 * Parse SSE events from a raw response body string.
 * Returns an array of { event, data } objects.
 */
function parseSseEvents(body: string): Array<{ event: string; data: unknown }> {
  const events: Array<{ event: string; data: unknown }> = [];
  const blocks = body.split(/\n\n+/);

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split("\n");
    let eventName = "message";
    let dataLine: string | undefined;

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLine = line.slice("data:".length).trim();
      }
    }

    if (dataLine !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(dataLine);
      } catch {
        parsed = dataLine;
      }
      events.push({ event: eventName, data: parsed });
    }
  }

  return events;
}

describe("CEE Preflight SSE Parity — reject branch", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    _resetConfigCache();

    vi.stubEnv("LLM_PROVIDER", "fixtures");
    vi.stubEnv("CEE_CAUSAL_VALIDATION_ENABLED", "false");
    vi.stubEnv("VALIDATION_CACHE_ENABLED", "false");

    vi.stubEnv("ASSIST_API_KEYS", "sse-preflight-test-key");
    vi.stubEnv("CEE_PREFLIGHT_ENABLED", "true");
    vi.stubEnv("CEE_PREFLIGHT_STRICT", "true");
    vi.stubEnv("CEE_PREFLIGHT_READINESS_THRESHOLD", "0.5");
    vi.stubEnv("CEE_CLARIFICATION_ENFORCED", "false");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const headers = {
    "X-Olumi-Assist-Key": "sse-preflight-test-key",
  } as const;

  it("gibberish brief on SSE endpoint emits error event with CEE_VALIDATION_FAILED and BRIEF_APPEARS_GIBBERISH", async () => {
    // "asdfghjkl qwerty zxcvbnm poiuytrewq" — keyboard-row spam, coverage=0, triggers gibberish rule.
    // SSE protocol: HTTP 200 (stream opened), then error event, then stream closes.
    // Must NOT send a graph stream.
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph/stream",
      headers: {
        ...headers,
        Accept: "text/event-stream",
      },
      payload: {
        brief: "asdfghjkl qwerty zxcvbnm poiuytrewq",
      },
    });

    // SSE streams always open with 200
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");

    const events = parseSseEvents(res.body);
    const errorEvent = events.find((e) => e.event === "error");

    expect(errorEvent).toBeDefined();
    const data = errorEvent!.data as Record<string, unknown>;

    // Exact code — not loose matching
    expect(data.code).toBe("CEE_VALIDATION_FAILED");
    // Exact reason — regression guard
    expect(data.reason).toBe("BRIEF_APPEARS_GIBBERISH");

    // Must NOT emit a graph (no stage events with graph data)
    const stageEvents = events.filter((e) => e.event === "stage");
    const hasGraph = stageEvents.some((e) => {
      const d = e.data as Record<string, unknown>;
      return d?.payload && typeof d.payload === "object" && "nodes" in (d.payload as object);
    });
    expect(hasGraph).toBe(false);
  });
});

describe("CEE Preflight SSE Parity — clarify branch", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    _resetConfigCache();

    vi.stubEnv("LLM_PROVIDER", "fixtures");
    vi.stubEnv("CEE_CAUSAL_VALIDATION_ENABLED", "false");
    vi.stubEnv("VALIDATION_CACHE_ENABLED", "false");

    vi.stubEnv("ASSIST_API_KEYS", "sse-clarify-test-key");
    vi.stubEnv("CEE_PREFLIGHT_ENABLED", "true");
    vi.stubEnv("CEE_PREFLIGHT_STRICT", "true");
    // High threshold (0.9) ensures low-readiness briefs always trigger clarify,
    // not proceed. The non-decision brief below scores ~0.42.
    vi.stubEnv("CEE_PREFLIGHT_READINESS_THRESHOLD", "0.9");
    vi.stubEnv("CEE_CLARIFICATION_ENFORCED", "false");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const headers = {
    "X-Olumi-Assist-Key": "sse-clarify-test-key",
  } as const;

  it("low-readiness brief on SSE endpoint emits needs_clarification event and closes stream", async () => {
    // "The sky is blue..." — no decision keywords, no specificity, no context.
    // Observed readiness score: ~0.42, well below the 0.9 threshold.
    // Policy ladder: valid English + underspecified + strict → action:"clarify".
    // SSE protocol: HTTP 200, event: needs_clarification, stream closes. No graph follows.
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph/stream",
      headers: {
        ...headers,
        Accept: "text/event-stream",
      },
      payload: {
        brief: "The sky is blue and clouds are white today in our area.",
      },
    });

    // SSE always opens with 200
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");

    const events = parseSseEvents(res.body);

    // Must emit a needs_clarification event
    const clarifyEvent = events.find((e) => e.event === "needs_clarification");
    expect(clarifyEvent).toBeDefined();

    const data = clarifyEvent!.data as Record<string, unknown>;
    // Core shape contract
    expect(data.status).toBe("needs_clarification");
    expect(typeof data.readiness_score).toBe("number");
    // Narrow range guard: this brief consistently scores ~0.42.
    // If scoring drifts outside 0.35–0.55, a calibration regression has occurred.
    expect((data.readiness_score as number)).toBeGreaterThan(0.35);
    expect((data.readiness_score as number)).toBeLessThan(0.55);

    // Clarify is a terminal branch — pipeline never runs, so no stage events at all.
    const stageEvents = events.filter((e) => e.event === "stage");
    expect(stageEvents.length).toBe(0);

    // Must NOT emit an error event (this is guidance, not a hard error)
    const errorEvent = events.find((e) => e.event === "error");
    expect(errorEvent).toBeUndefined();
  });
});
