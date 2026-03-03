/**
 * CEE Preflight Enforcement Integration Tests
 *
 * Tests for:
 * 1. Preflight strict mode rejection (when readiness < threshold)
 * 2. Clarification enforcement (when rounds are required)
 *
 * These are integration-level gaps identified in code review analysis.
 *
 * Readiness scoring factors (weights):
 * - length: 0.15 (optimal 50-500 chars)
 * - clarity: 0.25 (dictionary coverage + entropy)
 * - decision_relevance: 0.30 (decision patterns)
 * - specificity: 0.15 (numbers, dates, named entities)
 * - context: 0.15 (goals, constraints, stakeholders)
 *
 * Thresholds:
 * - score >= 0.7 = "ready"
 * - 0.4 <= score < 0.7 = "needs_clarification"
 * - score < 0.4 = "not_ready"
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

describe("CEE Preflight Enforcement (Integration)", () => {
  describe("Strict Mode Rejection", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      // Reset config cache to ensure fresh config parsing with new env vars
      _resetConfigCache();

      // Re-stub core envs here because other suites call vi.unstubAllEnvs()
      vi.stubEnv("LLM_PROVIDER", "fixtures");
      vi.stubEnv("CEE_CAUSAL_VALIDATION_ENABLED", "false");
      vi.stubEnv("VALIDATION_CACHE_ENABLED", "false");

      vi.stubEnv("ASSIST_API_KEYS", "preflight-test-key");
      vi.stubEnv("CEE_PREFLIGHT_ENABLED", "true");
      vi.stubEnv("CEE_PREFLIGHT_STRICT", "true");
      vi.stubEnv("CEE_PREFLIGHT_READINESS_THRESHOLD", "0.5");
      // Disable clarification enforcement to isolate preflight testing
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
      "X-Olumi-Assist-Key": "preflight-test-key",
    } as const;

    it("returns 200 needs_clarification for low-readiness brief in strict mode (policy ladder v1.17)", async () => {
      // Policy ladder: valid English + underspecified → 200 with needs_clarification guidance.
      // Only gibberish/empty/schema-violation → 400.
      // Non-decision brief that passes preflight but has low readiness score:
      // - No decision keywords (decision_relevance: 0)
      // - Short length (length_score: ~0.4)
      // - No specificity indicators (specificity: ~0.3)
      // - No context indicators (context: ~0.2)
      // Expected score: ~0.3-0.4
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers,
        payload: {
          brief: "The sky is blue and clouds are white today in our area.",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // needs_clarification response schema
      expect(body.status).toBe("needs_clarification");
      expect(typeof body.readiness_score).toBe("number");
      expect(body.readiness_score).toBeLessThan(0.5);
      expect(body.readiness_level).toBeDefined();
      expect(Array.isArray(body.clarification_questions)).toBe(true);
      expect(body.summary).toBeDefined();

      // Readiness score header
      expect(res.headers["x-cee-readiness-score"]).toBeDefined();
    });

    it("accepts high-readiness brief in strict mode", async () => {
      // Well-formed decision question with high readiness
      // - Strong decision keywords (decision_relevance: ~1.0)
      // - Good length (length_score: 1.0)
      // - Has specificity indicators: budget, deadline, Q4 (specificity: ~0.6+)
      // - Has context: team, goal mention (context: ~0.5+)
      // Expected score: ~0.8+
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers,
        payload: {
          brief: "Should we hire an additional senior developer for the team to help with the Q4 product launch? We have budget for one more headcount and the deadline is in 3 months.",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // V3 response has nodes/edges at root level (not nested under graph)
      expect(body.nodes).toBeDefined();
      expect(body.edges).toBeDefined();
      expect(body.quality).toBeDefined();
      expect(body.trace).toBeDefined();
    });

    it("includes readiness factors in needs_clarification response (policy ladder v1.17)", async () => {
      // Policy ladder: valid English + underspecified → 200 with factors in response body.
      // Brief without decision language - will have low decision_relevance
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers,
        payload: {
          brief: "The building has windows and doors and multiple floors and rooms inside.",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.status).toBe("needs_clarification");
      expect(body.factors).toBeDefined();
      // Factors object should have numeric scores
      const factors = body.factors;
      expect(typeof factors.decision_relevance_score).toBe("number");
      expect(typeof factors.clarity_score).toBe("number");
      expect(typeof factors.specificity_score).toBe("number");
      expect(typeof factors.context_score).toBe("number");
    });
  });

  describe("Clarification Enforcement", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      // Reset config cache to ensure fresh config parsing with new env vars
      _resetConfigCache();

      // Re-stub core envs here because other suites call vi.unstubAllEnvs()
      vi.stubEnv("LLM_PROVIDER", "fixtures");
      vi.stubEnv("CEE_CAUSAL_VALIDATION_ENABLED", "false");
      vi.stubEnv("VALIDATION_CACHE_ENABLED", "false");

      vi.stubEnv("ASSIST_API_KEYS", "clarification-test-key");
      vi.stubEnv("CEE_PREFLIGHT_ENABLED", "true");
      vi.stubEnv("CEE_PREFLIGHT_STRICT", "false"); // Don't reject on preflight, allow clarification flow
      vi.stubEnv("CEE_CLARIFICATION_ENFORCED", "true");
      vi.stubEnv("CEE_CLARIFICATION_THRESHOLD_ALLOW_DIRECT", "0.8"); // >= 0.8 = allow direct
      vi.stubEnv("CEE_CLARIFICATION_THRESHOLD_ONE_ROUND", "0.4"); // >= 0.4 = 1 round, < 0.4 = 2+ rounds

      cleanBaseUrl();
      app = await build();
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
      vi.unstubAllEnvs();
    });

    const headers = {
      "X-Olumi-Assist-Key": "clarification-test-key",
    } as const;

    it("requires clarification for medium-readiness brief (0.4-0.8 range)", async () => {
      // Brief with decision language but lacking specificity and context
      // - Has "should" pattern (decision_relevance: ~0.33-0.67)
      // - Medium length (length_score: ~0.4-1.0)
      // - Low specificity (no numbers, dates)
      // - Low context (no constraints, stakeholders)
      // Expected score: ~0.5-0.7 (needs clarification, 1 round required)
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers,
        payload: {
          brief: "Should we expand our product line with new features for our customers in the market?",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();

      expect(body.schema).toBe("cee.error.v1");
      expect(body.code).toBe("CEE_CLARIFICATION_REQUIRED");
      expect(body.retryable).toBe(true);

      // Clarification details
      expect(body.details).toBeDefined();
      expect(body.details.required_rounds).toBeGreaterThan(0);
      expect(body.details.completed_rounds).toBe(0);
      expect(body.details.clarification_endpoint).toBe("/assist/clarify-brief");
      // Note: suggested_questions may be undefined if readiness.level is "ready"
      // because the level threshold (0.7) differs from clarification threshold (0.8)
      expect(body.details.hint).toContain("clarification round");
    });

    it("allows direct draft when clarification_rounds_completed meets requirement", { timeout: 30000 }, async () => {
      // Same brief but with completed clarification rounds
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v1",
        headers,
        payload: {
          brief: "Should we expand our product line with new features for our customers in the market?",
          clarification_rounds_completed: 2, // Enough rounds completed
        },
      });

      if (res.statusCode !== 200) {
        console.error("Unexpected response:", JSON.stringify(res.json(), null, 2));
      }
      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.graph).toBeDefined();
      expect(body.quality).toBeDefined();
    });

    // Note: This test and the one above can be slow due to full draft pipeline execution
    // with fixtures provider. 30s timeout accommodates CI resource variability.
    it("allows high-readiness brief without clarification", { timeout: 30000 }, async () => {
      // Well-formed brief with high readiness (>= 0.8 threshold)
      // - Strong decision keywords: "Should", "hire", "decision", "choose" (decision_relevance: ~1.0)
      // - Good length (length_score: 1.0)
      // - Has specificity: $150,000, Q4, React, Node.js (specificity: ~0.7+)
      // - Has context: team, deadline, alternative (context: ~0.6+)
      // Expected score: ~0.85+
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v1",
        headers,
        payload: {
          brief: "Should we hire an additional senior developer for our engineering team to meet the Q4 deadline? Our budget is $150,000 annually and we need someone with React and Node.js experience. The alternative is to outsource to a contractor.",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.graph).toBeDefined();
    });

    it("requires 2+ rounds for low readiness briefs (< 0.4)", async () => {
      // Brief that passes preflight but has very low readiness score
      // - No strong decision keywords (decision_relevance: ~0)
      // - Short length 20-50 chars (length_score: ~0.4)
      // - Lower clarity due to short length
      // - No specificity indicators (specificity: ~0.3)
      // - No context indicators (context: ~0.2)
      // Expected score: ~0.25-0.35 (not_ready, 2 rounds required since < 0.4)
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers,
        payload: {
          brief: "The system has various parts working.",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();

      expect(body.code).toBe("CEE_CLARIFICATION_REQUIRED");
      expect(body.details.required_rounds).toBeGreaterThanOrEqual(2);
      expect(body.details.readiness_score).toBeLessThan(0.4);
    });

    it("calculates remaining rounds correctly for 1-round requirement", async () => {
      // Brief requiring 1 round (0.4 <= score < 0.8) with 0 completed - should fail
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers,
        payload: {
          brief: "Should we expand our product line with new features for our customers in the market?",
          clarification_rounds_completed: 0,
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();

      expect(body.code).toBe("CEE_CLARIFICATION_REQUIRED");
      expect(body.details.required_rounds).toBe(1);
      expect(body.details.completed_rounds).toBe(0);
      expect(body.details.hint).toContain("clarification round");
    });
  });

  describe("Preflight with Clarification Combined", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      // Reset config cache to ensure fresh config parsing with new env vars
      _resetConfigCache();

      // Re-stub core envs here because other suites call vi.unstubAllEnvs()
      vi.stubEnv("LLM_PROVIDER", "fixtures");
      vi.stubEnv("CEE_CAUSAL_VALIDATION_ENABLED", "false");
      vi.stubEnv("VALIDATION_CACHE_ENABLED", "false");

      vi.stubEnv("ASSIST_API_KEYS", "combined-test-key");
      vi.stubEnv("CEE_PREFLIGHT_ENABLED", "true");
      vi.stubEnv("CEE_PREFLIGHT_STRICT", "true");
      vi.stubEnv("CEE_PREFLIGHT_READINESS_THRESHOLD", "0.25"); // Very low threshold so only gibberish fails
      vi.stubEnv("CEE_CLARIFICATION_ENFORCED", "true");
      vi.stubEnv("CEE_CLARIFICATION_THRESHOLD_ALLOW_DIRECT", "0.8");
      vi.stubEnv("CEE_CLARIFICATION_THRESHOLD_ONE_ROUND", "0.4");

      cleanBaseUrl();
      app = await build();
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
      vi.unstubAllEnvs();
    });

    const headers = {
      "X-Olumi-Assist-Key": "combined-test-key",
    } as const;

    it("gibberish input returns 400 CEE_VALIDATION_FAILED (hard reject, policy ladder v1.17)", async () => {
      // Gibberish input fails preflight validation — preflight.valid = false → 400 hard reject.
      // "asdfghjkl qwertyuiop zxcvbnm keyboard test" has 4 words, all pure letters, zero coverage.
      // The 3+ words + all-pure-letters + coverage=0 conjunction triggers BRIEF_APPEARS_GIBBERISH.
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers,
        payload: {
          brief: "asdfghjkl qwertyuiop zxcvbnm keyboard test",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();

      // Hard reject: gibberish detected
      expect(body.code).toBe("CEE_VALIDATION_FAILED");
      // rejection_reason is now the preflight issue code (e.g. BRIEF_APPEARS_GIBBERISH)
      expect(body.details.rejection_reason).toBe("BRIEF_APPEARS_GIBBERISH");
    });

    it("clarification check runs after preflight passes for low readiness", async () => {
      // Valid but vague brief - passes preflight (valid English) but has low score
      // Threshold is 0.25 so this passes preflight but needs clarification
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers,
        payload: {
          brief: "Should we maybe think about doing something different with the process?",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();

      // Should require clarification (preflight passed, but score < 0.8)
      expect(body.code).toBe("CEE_CLARIFICATION_REQUIRED");
      expect(body.details.readiness_score).toBeGreaterThan(0.25); // Above preflight threshold
      expect(body.details.readiness_score).toBeLessThan(0.8); // Below direct draft threshold
    });
  });

  // ============================================================================
  // Primary Regression Tests (route-level contract)
  // ============================================================================
  //
  // These tests are the primary regression guard for the v1.17 fixes.
  // They validate the full request path: Zod → preflight → policy ladder → response.
  // If the gibberish regex is reintroduced or the policy ladder breaks, these fail.

  describe("Primary Regression Guard (v1.17)", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      _resetConfigCache();

      vi.stubEnv("LLM_PROVIDER", "fixtures");
      vi.stubEnv("CEE_CAUSAL_VALIDATION_ENABLED", "false");
      vi.stubEnv("VALIDATION_CACHE_ENABLED", "false");

      vi.stubEnv("ASSIST_API_KEYS", "regression-test-key");
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
      "X-Olumi-Assist-Key": "regression-test-key",
    } as const;

    it("'Should we expand internationally?' returns 200 with graph — NOT gibberish (primary regression)", async () => {
      // This is the exact brief that was hard-rejected as BRIEF_APPEARS_GIBBERISH before v1.17.
      // "internationally" (15 chars) matched /[a-z]{15,}/i which was removed in v1.17.
      // Must NEVER return 400 with rejection_reason === "BRIEF_APPEARS_GIBBERISH".
      //
      // Readiness score (~0.64) is ABOVE the 0.5 threshold → action:"proceed" → graph response.
      // (If score ever drops below 0.5, the pipeline outcome shifts to needs_clarification.
      //  That would be a preflight calibration regression, and this test would catch it.)
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers,
        payload: {
          brief: "Should we expand internationally?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // Must NOT be any kind of error
      expect(body.code).toBeUndefined();
      expect(body.details?.rejection_reason).toBeUndefined();
      expect(body.status).not.toBe("needs_clarification");

      // At threshold=0.5 this brief proceeds to pipeline — assert graph output (V3: flat nodes/edges)
      expect(body.nodes).toBeDefined();
      expect(Array.isArray(body.nodes)).toBe(true);
    });

    it("low-readiness non-decision brief returns 200 needs_clarification in strict mode (shape contract)", async () => {
      // Uses a brief that has: no decision keywords, no specificity, no context
      // Readiness score well below 0.5 threshold → needs_clarification response.
      // This validates the shape of the needs_clarification response at route level.
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers,
        payload: {
          brief: "The sky is blue and clouds are white today in our area.",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // Top-level keys (NOT nested under preflight or similar)
      expect(body.status).toBe("needs_clarification");
      expect(typeof body.readiness_score).toBe("number");
      expect(body.readiness_score).toBeGreaterThan(0);
      expect(body.readiness_score).toBeLessThanOrEqual(1);
      expect(body.readiness_level).toBeDefined();
      expect(Array.isArray(body.clarification_questions)).toBe(true);
      // At least one non-empty clarification question
      expect(body.clarification_questions.length).toBeGreaterThan(0);
      for (const q of body.clarification_questions) {
        expect(typeof q).toBe("string");
        expect(q.length).toBeGreaterThan(0);
      }

      // Not a hard error
      expect(body.code).toBeUndefined();
      expect(body.details?.rejection_reason).toBeUndefined();
    });

    it("gibberish brief returns 400 CEE_VALIDATION_FAILED with exact code and reason", async () => {
      // "asdfghjkl qwerty zxcvbnm poiuytrewq" — 4 words, all pure letters, coverage=0.
      // Triggers rule 3: 3+ words + all-pure-letters + coverage===0 → BRIEF_APPEARS_GIBBERISH.
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers,
        payload: {
          brief: "asdfghjkl qwerty zxcvbnm poiuytrewq",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();

      // Exact error code — not loose matching
      expect(body.code).toBe("CEE_VALIDATION_FAILED");
      // Exact rejection reason — not "preflight_rejected" or similar
      expect(body.details.rejection_reason).toBe("BRIEF_APPEARS_GIBBERISH");
    });
  });
});
