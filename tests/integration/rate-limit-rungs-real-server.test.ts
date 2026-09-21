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
 *   - GLOBAL rung (`src/server.ts`) → `global-rate-limit-429.test.ts`, plus the
 *     15-minute ttl-derivation case at the bottom of this file.
 *   - ROUTE-SCOPED rung → this file, via `assist.share` (public, no admin key).
 *   - ADMIN rung → this file, via `admin.testing`'s own 10/min limiter.
 *   - The other six admin builders (`admin.prompts`, `admin.prompts.status`,
 *     `admin.v1.turn-debug`, `admin.v1.llm-output`, `admin.v1.routing-log`,
 *     `admin.v1.draft-failures`) are covered STRUCTURALLY by the derived guard
 *     (`tests/meta/rate-limit-builders-return-error.test.ts` +
 *     `scripts/ci/assert-rate-limit-builders-return-error.mjs`), which REDs on
 *     any builder — including a brand-new tenth — that returns a non-Error.
 *     They are not merely hard to reach — they are UNREACHABLE, measured: an
 *     independent review drove `/admin/v1/turn-debug` to refusal and got
 *     `x-ratelimit-limit: 60`, i.e. `assist.share`'s cap, not turn-debug's own
 *     100. Every limiter registers on the ROOT instance and the plugin is
 *     `fp`-wrapped, so an earlier-registered hook always refuses first (and on
 *     any route carrying a route-level `config.rateLimit` override, that is the
 *     GLOBAL builder). Consequence worth rowing: the PUBLIC share limiter is
 *     silently the effective 60/min cap on every admin route. Pre-existing
 *     registration-layout property, recorded here, not changed by this lane.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";

import { build } from "../../src/server.js";
import { _resetConfigCache } from "../../src/config/index.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

// `InjectOptions`/`LightMyRequestResponse` are taken from FASTIFY, which
// re-exports them (`fastify.d.ts:184`), not from `light-my-request` directly:
// that package is a TRANSITIVE dependency, so importing it does not resolve
// under this repo's node16 module resolution. `Parameters<FastifyInstance
// ["inject"]>` is not a substitute either — `inject` is overloaded and
// `Parameters<>` resolves to the last (zero-arg) overload.
//
// Worth noting how this was caught: `pnpm typecheck` uses `tsconfig.build.json`,
// which EXCLUDES tests, so it stayed green while the separate
// `Typecheck Drift (ratchet)` job went red. Exactly the blind spot CLAUDE.md
// trap 2 warns about. Fixed at source; no baseline touched.

/** Drive a route until the limiter refuses, or give up. Returns the refusal. */
async function driveUntilRefused(
  app: FastifyInstance,
  opts: InjectOptions,
  attempts: number,
): Promise<LightMyRequestResponse | null> {
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

describe("admin rung: the admin.testing limiter (10/min) refuses with typed 429", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("LLM_PROVIDER", "fixtures");
    // An admin key is all that is needed to register the admin plugins
    // (`config.prompts.adminApiKey`), without enabling the prompt store.
    vi.stubEnv("ADMIN_API_KEY", "test-admin-key-2181");
    // Keep every EARLIER-registered limiter well clear of admin.testing's own
    // 10/min cap — see the note below on why that matters.
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

  it("answers 429 error.v1 RATE_LIMITED from an ADMIN plugin's own builder", async () => {
    // ⚠ WHICH BUILDER ANSWERS IS NOT OBVIOUS — established empirically, not
    // assumed. Every `app.register(rateLimit, …)` in this app is registered on
    // the ROOT instance, so a route inherits an onRequest hook from EVERY
    // limiter registered before it, and the FIRST hook to exceed is the one
    // that throws. A route-level `config: { rateLimit: { max } }` override
    // applies to ALL of those hooks, so on such a route the GLOBAL builder wins
    // and the plugin's own builder is never reached.
    //
    // `admin.testing` is chosen because it needs neither: its own cap is 10/min,
    // strictly below every earlier hook here (global 1000, assist.share 60, the
    // six admin plugins 100/15min), and its routes carry no route-level
    // override. So the refusal is unambiguously ITS builder.
    //
    // The requests deliberately carry an INVALID admin key: the limiter is an
    // onRequest hook, so it counts the request before the handler's 401, which
    // keeps the drive cheap and makes no LLM calls.
    const refused = await driveUntilRefused(
      app,
      {
        method: "GET",
        url: "/admin/v1/test-prompt-llm/models",
        headers: { "x-admin-key": "wrong-key-on-purpose" },
      },
      25,
    );

    expect(
      refused,
      "the admin.testing 10/min cap never fired — the assertions below would be vacuous",
    ).not.toBeNull();

    expect(refused!.headers["x-ratelimit-limit"]).toBe("10");
    expect(refused!.headers["x-ratelimit-remaining"]).toBe("0");

    const body = refused!.json();
    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.request_id).toBeTruthy();
    expect(typeof body.details?.retry_after_seconds).toBe("number");
    expect(body.details.retry_after_seconds).toBeGreaterThan(0);
    expect(Number(refused!.headers["retry-after"])).toBe(
      body.details.retry_after_seconds,
    );
  });
});

describe("ttl derivation on a 15-minute window (not the 60s fallback)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("LLM_PROVIDER", "fixtures");
    vi.stubEnv("ADMIN_API_KEY", "test-admin-key-2181");
    vi.stubEnv("GLOBAL_RATE_LIMIT_RPM", "1000");
    _resetConfigCache();
    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("reports ~900s on /admin/prompts/inventory (20 per 15 min)", async () => {
    // ⚠ SCOPE, stated honestly: `/admin/prompts/inventory` carries a route-level
    // `config: { rateLimit: { max: 20, timeWindow: 15 * 60 * 1000 } }`, which
    // applies to EVERY limiter hook on the route — so the earliest-registered
    // hook (the GLOBAL one in `src/server.ts`) is what refuses here. This test
    // therefore covers the GLOBAL builder, NOT an admin builder; the admin
    // builders are covered by the describe above (admin.testing) and by the
    // derived guard.
    //
    // Its value is the ttl DERIVATION: a 15-minute window makes ~900s the right
    // answer, which the old hardcoded 60s fallback can never produce. The
    // 1-minute global test cannot discriminate that, because there 60 is both
    // the fallback and the correct value.
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
      "the 20/15-min cap never fired — the assertions below would be vacuous",
    ).not.toBeNull();

    expect(refused!.headers["x-ratelimit-limit"]).toBe("20");

    const body = refused!.json();
    expect(body.code).toBe("RATE_LIMITED");

    const retryAfter = body.details?.retry_after_seconds;
    expect(typeof retryAfter).toBe("number");
    expect(retryAfter).toBeGreaterThan(600);
    expect(retryAfter).toBeLessThanOrEqual(900);
    // …and it must agree with the header the plugin staged itself.
    expect(Number(refused!.headers["retry-after"])).toBe(retryAfter);
  });
});
