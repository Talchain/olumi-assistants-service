/**
 * ROADMAP 2.181 — the GLOBAL rate limiter must refuse with a typed
 * 429 `RATE_LIMITED`, not a generic 500 `INTERNAL`.
 *
 * Live defect (staging, 30 Jul 2026): request #121 on `GET /healthz`
 * (global 120/min) answered
 *   http=500  x-ratelimit-limit: 120  x-ratelimit-remaining: 0  retry-after: 47
 *   {"schema":"error.v1","code":"INTERNAL","message":"Internal server error",...}
 * The limiter itself fired (headers present, request refused) — only the
 * response shape was wrong. A client that retries on 5xx but backs off on
 * 429 behaves wrongly against it.
 *
 * Mechanism (verified at the bytes, @fastify/rate-limit 10.3.0 index.js:333):
 * the plugin does `throw params.errorResponseBuilder(req, respCtx)` — it
 * THROWS whatever the builder RETURNS. The builder returned a plain object,
 * so CEE's central error handler received a non-Error, `toErrorV1` fell
 * through to its "unknown error type" branch, and the reply became
 * INTERNAL/500. `statusCode: 429` on a plain object is not enough here: it
 * is only read by Fastify's DEFAULT error handler, and this app installs a
 * custom one (`app.setErrorHandler`) that derives the status from the
 * error.v1 `code` instead.
 *
 * This test boots the REAL app via `build()` and drives it over the wire
 * shape the defect was observed on, so it cannot pass while the deployed
 * response is still a 500 (a unit test that only calls the builder would).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Deterministic, zero-cost boot.
vi.stubEnv("LLM_PROVIDER", "fixtures");
// Tiny global cap so the limiter bites within a handful of injects.
vi.stubEnv("GLOBAL_RATE_LIMIT_RPM", "3");

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

const GLOBAL_MAX = 3;

describe("global rate limit — typed 429 RATE_LIMITED (ROADMAP 2.181)", () => {
  let app: FastifyInstance;
  const warnPayloads: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    vi.stubEnv("LLM_PROVIDER", "fixtures");
    vi.stubEnv("GLOBAL_RATE_LIMIT_RPM", String(GLOBAL_MAX));
    cleanBaseUrl();
    app = await build();

    // Record structured warns so the `rate_limit_hit` observability claim is
    // asserted directly, not inferred from the response.
    const originalWarn = app.log.warn.bind(app.log);
    vi.spyOn(app.log, "warn").mockImplementation(((
      first: unknown,
      ...rest: unknown[]
    ) => {
      if (first && typeof first === "object") {
        warnPayloads.push(first as Record<string, unknown>);
      }
      return (originalWarn as (...a: unknown[]) => unknown)(first, ...rest);
    }) as typeof app.log.warn);

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("refuses the over-limit request with 429 + error.v1 RATE_LIMITED + retry_after_seconds", async () => {
    let refused: Awaited<ReturnType<FastifyInstance["inject"]>> | null = null;

    // One extra request past the cap; stop at the first refusal.
    for (let i = 0; i < GLOBAL_MAX + 3; i++) {
      const res = await app.inject({ method: "GET", url: "/healthz" });
      if (res.statusCode !== 200) {
        refused = res;
        break;
      }
    }

    // Positive control (trap 13): assert the limiter actually fired before
    // asserting anything about its shape, or every assertion below is vacuous.
    expect(
      refused,
      `the ${GLOBAL_MAX}/min global cap never fired — the assertions below would be vacuous`,
    ).not.toBeNull();

    // The limiter's own headers prove it is the limiter refusing, not a route error.
    expect(refused!.headers["x-ratelimit-limit"]).toBe(String(GLOBAL_MAX));
    expect(refused!.headers["x-ratelimit-remaining"]).toBe("0");

    // The defect: this was 500 / INTERNAL live.
    expect(
      refused!.statusCode,
      `got ${refused!.statusCode}: ${refused!.body}`,
    ).toBe(429);

    const body = refused!.json();
    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.request_id).toBeTruthy();
    expect(typeof body.details?.retry_after_seconds).toBe("number");
    expect(body.details.retry_after_seconds).toBeGreaterThan(0);
    // The window is 1 minute, so a correct remaining-TTL derivation can never
    // exceed 60s. The old `context.after` arithmetic could not produce this at
    // all (`after` is a human-readable STRING, so the guard never matched and
    // the value was pinned to the 60 fallback).
    expect(body.details.retry_after_seconds).toBeLessThanOrEqual(60);

    // Retry-After header must be present and parseable for a backing-off client.
    expect(Number(refused!.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("logs the rate_limit_hit warn (the builder completes, and is observable)", async () => {
    // Depends on the first test having tripped the limiter; the shared 1-minute
    // window means the cap is still exhausted here.
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(429);

    const hits = warnPayloads.filter((p) => p.event === "rate_limit_hit");
    expect(
      hits.length,
      "no rate_limit_hit warn was emitted — the limit refusal is invisible in logs",
    ).toBeGreaterThan(0);
    expect(hits[0]!.max).toBe(GLOBAL_MAX);
    expect(hits[0]!.request_id).toBeTruthy();
  });
});
