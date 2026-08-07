import { describe, it, expect, afterEach, vi } from "vitest";

import {
  RATE_BUCKET_REGISTRY,
  tierRpm,
  tierFailsOpen,
  resolveCeeRateLimit,
  assertRateBucketsValid,
  getCeeFeatureRateLimiter,
  enforceRateBuckets,
  resetAllCeeFeatureRateLimiters,
  isSanctionedKey,
  CEE_DEFAULT_FEATURE_RATE_LIMIT_RPM,
} from "../../src/cee/config/limits.js";

afterEach(() => {
  vi.unstubAllEnvs();
  resetAllCeeFeatureRateLimiters();
});

describe("rate bucket tiers — derived, ordered", () => {
  it("derives draft < coach < read (the whole point of tiering)", () => {
    expect(tierRpm("draft")).toBeLessThan(tierRpm("coach"));
    expect(tierRpm("coach")).toBeLessThan(tierRpm("read"));
  });

  it("has the design-partner-calibrated defaults draft=10, coach=40, read=90", () => {
    expect(tierRpm("draft")).toBe(10);
    expect(tierRpm("coach")).toBe(40);
    expect(tierRpm("read")).toBe(90);
  });

  it("honours a per-tier env override", () => {
    vi.stubEnv("CEE_RATE_BUCKET_DRAFT_RPM", "7");
    expect(tierRpm("draft")).toBe(7);
  });

  it("declares fail posture: compute (draft/coach) closed, read open", () => {
    expect(tierFailsOpen("draft")).toBe(false);
    expect(tierFailsOpen("coach")).toBe(false);
    expect(tierFailsOpen("read")).toBe(true);
  });
});

describe("resolveCeeRateLimit — derive, don't mirror", () => {
  it("derives a registered env var's default from its tier, NOT the flat 5", () => {
    expect(resolveCeeRateLimit("CEE_DRAFT_RATE_LIMIT_RPM")).toBe(tierRpm("draft"));
    expect(resolveCeeRateLimit("CEE_GRAPH_READINESS_RATE_LIMIT_RPM")).toBe(tierRpm("read"));
    expect(resolveCeeRateLimit("CEE_REVIEW_RATE_LIMIT_RPM")).toBe(tierRpm("coach"));
  });

  it("regression: the historical flat-5 no longer applies to registered routes", () => {
    // Pre-fix, every unset route silently ran at 5 because the `?? N` fallbacks
    // in route files were dead code. Now each resolves to its tier.
    expect(resolveCeeRateLimit("CEE_DRAFT_RATE_LIMIT_RPM")).not.toBe(5);
    expect(resolveCeeRateLimit("CEE_GRAPH_READINESS_RATE_LIMIT_RPM")).not.toBe(5);
  });

  it("an explicit per-route env override still wins (back-compat)", () => {
    vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "3");
    expect(resolveCeeRateLimit("CEE_DRAFT_RATE_LIMIT_RPM")).toBe(3);
  });

  it("an unregistered env var fails SAFE at the default", () => {
    expect(resolveCeeRateLimit("CEE_TOTALLY_UNKNOWN_RATE_LIMIT_RPM")).toBe(
      CEE_DEFAULT_FEATURE_RATE_LIMIT_RPM,
    );
  });

  it("registry maps the two LLM routes to draft and graph-readiness to read", () => {
    expect(RATE_BUCKET_REGISTRY.CEE_DRAFT_RATE_LIMIT_RPM).toBe("draft");
    expect(RATE_BUCKET_REGISTRY.CEE_STREAM_RATE_LIMIT_RPM).toBe("draft");
    expect(RATE_BUCKET_REGISTRY.CEE_GRAPH_READINESS_RATE_LIMIT_RPM).toBe("read");
    expect(RATE_BUCKET_REGISTRY.CEE_TURN_RATE_LIMIT_RPM).toBe("coach");
  });
});

describe("assertRateBucketsValid — boot invariant (mutation-checkable)", () => {
  it("passes under the default env", () => {
    expect(() => assertRateBucketsValid()).not.toThrow();
  });

  it("throws LOUD when a tier override inverts the ordering", () => {
    // draft looser than read must never be allowed to boot silently.
    vi.stubEnv("CEE_RATE_BUCKET_DRAFT_RPM", "1000");
    expect(() => assertRateBucketsValid()).toThrow(/ordering violated/);
  });
});

describe("positive control — a burst actually 429s", () => {
  it("the (rpm+1)th request against a bucket is denied with a retry-after", () => {
    const limiter = getCeeFeatureRateLimiter("test_burst", "CEE_DRAFT_RATE_LIMIT_RPM");
    const rpm = tierRpm("draft");
    for (let i = 0; i < rpm; i++) {
      expect(limiter.tryConsume("key::alice").allowed).toBe(true);
    }
    const denied = limiter.tryConsume("key::alice");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("a different key in the same feature has an independent budget", () => {
    const limiter = getCeeFeatureRateLimiter("test_burst_iso", "CEE_DRAFT_RATE_LIMIT_RPM");
    const rpm = tierRpm("draft");
    for (let i = 0; i < rpm; i++) limiter.tryConsume("key::alice");
    expect(limiter.tryConsume("key::alice").allowed).toBe(false);
    expect(limiter.tryConsume("key::bob").allowed).toBe(true);
  });
});

describe("sanctioned keys — the eval/probe bucket", () => {
  it("recognises an allowlisted key id", () => {
    vi.stubEnv("CEE_RATE_LIMIT_SANCTIONED_KEY_IDS", "evalkey123, probekey456");
    expect(isSanctionedKey("evalkey123")).toBe(true);
    expect(isSanctionedKey("probekey456")).toBe(true);
    expect(isSanctionedKey("randomkey")).toBe(false);
    expect(isSanctionedKey(undefined)).toBe(false);
  });

  it("does NOT throttle a sanctioned key far past the base tier", () => {
    vi.stubEnv("CEE_RATE_LIMIT_SANCTIONED_KEY_IDS", "evalkey123");
    const limiter = getCeeFeatureRateLimiter("test_sanction", "CEE_DRAFT_RATE_LIMIT_RPM");
    const rpm = tierRpm("draft");
    for (let i = 0; i < rpm * 5; i++) {
      expect(limiter.tryConsume("key::evalkey123", "evalkey123").allowed).toBe(true);
    }
  });

  it("DOES throttle an unsanctioned key at the same bucket (control)", () => {
    const limiter = getCeeFeatureRateLimiter("test_unsanction", "CEE_DRAFT_RATE_LIMIT_RPM");
    const rpm = tierRpm("draft");
    for (let i = 0; i < rpm; i++) limiter.tryConsume("key::bob", "bob");
    expect(limiter.tryConsume("key::bob", "bob").allowed).toBe(false);
  });
});

describe("enforceRateBuckets — per-key AND per-scenario dimensions", () => {
  it("enforces the per-key dimension when a key is present", () => {
    const rpm = tierRpm("draft");
    let last = { allowed: true } as ReturnType<typeof enforceRateBuckets>;
    for (let i = 0; i <= rpm; i++) {
      last = enforceRateBuckets({
        feature: "erb_key",
        envVarName: "CEE_DRAFT_RATE_LIMIT_RPM",
        keyId: "k1",
      });
    }
    expect(last.allowed).toBe(false);
    expect(last.dimension).toBe("key");
  });

  it("enforces the per-scenario dimension independently of any key", () => {
    const rpm = tierRpm("coach");
    let last = { allowed: true } as ReturnType<typeof enforceRateBuckets>;
    for (let i = 0; i <= rpm; i++) {
      last = enforceRateBuckets({
        feature: "erb_scen",
        envVarName: "CEE_TURN_RATE_LIMIT_RPM",
        scenarioId: "s1",
      });
    }
    expect(last.allowed).toBe(false);
    expect(last.dimension).toBe("scenario");
  });

  it("different scenarios have independent budgets (fairness/isolation)", () => {
    const rpm = tierRpm("coach");
    for (let i = 0; i < rpm; i++) {
      enforceRateBuckets({
        feature: "erb_iso",
        envVarName: "CEE_TURN_RATE_LIMIT_RPM",
        scenarioId: "sA",
      });
    }
    expect(
      enforceRateBuckets({
        feature: "erb_iso",
        envVarName: "CEE_TURN_RATE_LIMIT_RPM",
        scenarioId: "sA",
      }).allowed,
    ).toBe(false);
    expect(
      enforceRateBuckets({
        feature: "erb_iso",
        envVarName: "CEE_TURN_RATE_LIMIT_RPM",
        scenarioId: "sB",
      }).allowed,
    ).toBe(true);
  });

  it("a sanctioned key is lifted on the per-scenario dimension too", () => {
    vi.stubEnv("CEE_RATE_LIMIT_SANCTIONED_KEY_IDS", "evalkey123");
    const rpm = tierRpm("coach");
    for (let i = 0; i < rpm * 3; i++) {
      const d = enforceRateBuckets({
        feature: "erb_sanction_scen",
        envVarName: "CEE_TURN_RATE_LIMIT_RPM",
        scenarioId: "s1",
        keyId: "evalkey123",
      });
      expect(d.allowed).toBe(true);
    }
  });
});
