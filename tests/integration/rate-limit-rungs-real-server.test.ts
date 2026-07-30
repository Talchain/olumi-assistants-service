/**
 * ROADMAP 2.181 — real-server pins for the ROUTE-SCOPED and ADMIN rate-limit
 * rungs.
 *
 * WHY THIS FILE EXISTS. The 2.181 fix corrected nine `errorResponseBuilder`s,
 * but only the GLOBAL one was pinned (`global-rate-limit-429.test.ts`). The
 * adversarial review of #763 reverted three of the other eight to their exact
 * pre-fix plain objects and `pnpm test:required` came back **byte-identical to
 * baseline — 0 failed**. Eight of nine advertised fixes could be reverted
 * invisibly. That is a fix with no pin, which is the thing this programme
 * treats as not-shipped.
 *
 * These tests boot the REAL app via `build()` — the defect is invisible under a
 * bare `Fastify()`, because the plain object's `statusCode: 429` is honoured by
 * Fastify's DEFAULT error handler and only the app's custom `setErrorHandler`
 * turns it into 500 INTERNAL.
 *
 * Coverage split (stated so nobody assumes more than is here):
 *   - GLOBAL rung → `global-rate-limit-429.test.ts` (`src/server.ts`).
 *   - ROUTE-SCOPED rung → this file, via `assist.share` (public, no admin key).
 *   - ADMIN rung → this file, via `GET /admin/prompts/inventory`.
 *   - The remaining admin builders (`admin.v1.turn-debug`, `admin.v1.llm-output`,
 *     `admin.v1.routing-log`, `admin.v1.draft-failures`, `admin.testing`) are
 *     covered STRUCTURALLY by the derived guard
 *     (`tests/meta/rate-limit-builders-return-error.test.ts` +
 *     `scripts/ci/assert-rate-limit-builders-return-error.mjs`), which REDs on
 *     any builder — including a brand-new tenth — that returns a non-Error.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { InjectOptions } from "light-my-request";

import { build } from "../../src/server.js";
import { _resetConfigCache } from "../../src/config/index.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

/** Drive a route until the limiter refuses, or give up. Returns the refusal. */
async function driveUntilRefused(
  app: FastifyInstance,
  opts: InjectOptions,
  attempts: number,
): Promise<Awaited<ReturnType<FastifyInstance["inject"]>> | null> {
  for (let i = 0; i < attempts; i++) {
    const res = await app.inject(opts);
    if (res.statusCode === 429) return res;
    // Any other non-2xx is the route's own answer (e.g. a 410 for a bogus share
    // token) and is expected — keep driving the counter.
  }
  return null;
}

describe("route-scoped rung: assist.share limiter refuses with typed 429", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("LLM_PROVIDER", "fixtures");
    vi.stubEnv("SHARE_REVIEW_ENABLED", "1");
    vi.stubEnv("SHARE_SECRET", "test-secret-key-2181");
    // Keep the GLOBAL cap well clear of the share cap (60/min) so the refusal
    // under test is unambiguously the ROUTE-SCOPED limiter, not the global one.
    vi.stubEnv("GLOBAL_RATE_LIMIT_RPM", "1000");
    // The config module caches on first read, and vitest.setup.ts only resets
    // that cache per-FILE and per-TEST — not between two `beforeAll`s in the
    // same file. Without this the second app would boot on the FIRST
    // describe's config and silently register no admin routes, making the
    // positive control below fail for the wrong reason.
    _resetConfigCache();
    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("answers 429 error.v1 RATE_LIMITED once the share limiter (60/min) is exhausted", async () => {
    const refused = await driveUntilRefused(
      app,
      { method: "GET", url: "/assist/share/not-a-real-token-2181" },
      80,
    );

    // Positive control (trap 13) before any shape assertion.
    expect(
      refused,
      "the assist.share 60/min limiter never fired — the assertions below would be vacuous",
    ).not.toBeNull();

    // It is the limiter answering, not the route.
    expect(refused!.headers["x-ratelimit-limit"]).toBe("60");
    expect(refused!.headers["x-ratelimit-remaining"]).toBe("0");

    const body = refused!.json();
    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.request_id).toBeTruthy();
    expect(typeof body.details?.retry_after_seconds).toBe("number");
    expect(body.details.retry_after_seconds).toBeGreaterThan(0);
    expect(Number(refused!.headers["retry-after"])).toBeGreaterThan(0);
  });
});

describe("admin rung: /admin/prompts/inventory limiter refuses with typed 429", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("LLM_PROVIDER", "fixtures");
    // An admin key is all that is needed to register the admin plugins
    // (`config.prompts.adminApiKey`), without enabling the prompt store.
    vi.stubEnv("ADMIN_API_KEY", "test-admin-key-2181");
    vi.stubEnv("GLOBAL_RATE_LIMIT_RPM", "1000");
    // The config module caches on first read, and vitest.setup.ts only resets
    // that cache per-FILE and per-TEST — not between two `beforeAll`s in the
    // same file. Without this the second app would boot on the FIRST
    // describe's config and silently register no admin routes, making the
    // positive control below fail for the wrong reason.
    _resetConfigCache();
    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("answers 429 error.v1 RATE_LIMITED with the 15-MINUTE retry hint, not the 60s fallback", async () => {
    const refused = await driveUntilRefused(
      app,
      {
        method: "GET",
        url: "/admin/prompts/inventory",
        headers: { "x-admin-key": "test-admin-key-2181" },
      },
      40,
    );

    expect(
      refused,
      "the admin 20/15-min cap never fired — the assertions below would be vacuous",
    ).not.toBeNull();

    expect(refused!.headers["x-ratelimit-limit"]).toBe("20");
    expect(refused!.headers["x-ratelimit-remaining"]).toBe("0");

    const body = refused!.json();
    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.request_id).toBeTruthy();

    // DISCRIMINATING ASSERTION, and the reason this rung uses the 15-minute
    // window: the pre-fix code could only ever emit the hardcoded 60s fallback
    // (`context.after` is a human-readable STRING, so its numeric guard never
    // matched). A window whose real remaining TTL is ~900s therefore separates a
    // correct ttl derivation from the fallback — which a 1-minute window cannot
    // do, since there 60 is both the fallback AND the right answer.
    const retryAfter = body.details?.retry_after_seconds;
    expect(typeof retryAfter).toBe("number");
    expect(retryAfter).toBeGreaterThan(600);
    expect(retryAfter).toBeLessThanOrEqual(900);
    // …and it must agree with the header the plugin staged itself.
    expect(Number(refused!.headers["retry-after"])).toBe(retryAfter);
  });
});
