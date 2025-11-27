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

    it("rejects low-readiness brief in strict mode with CEE_VALIDATION_FAILED", async () => {
      // Non-decision brief that passes preflight but has low readiness score
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

      expect(res.statusCode).toBe(400);
      const body = res.json();

      // Error response schema
      expect(body.schema).toBe("cee.error.v1");
      expect(body.code).toBe("CEE_VALIDATION_FAILED");
      expect(body.retryable).toBe(true);

      // Specific preflight rejection details
      expect(body.details).toBeDefined();
      expect(body.details.rejection_reason).toBe("preflight_rejected");
      expect(typeof body.details.readiness_score).toBe("number");
      expect(body.details.readiness_score).toBeLessThan(0.5);
      expect(body.details.readiness_level).toBeDefined();
      expect(body.details.suggested_questions).toBeDefined();
      expect(body.details.hint).toContain("clearer decision statement");

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

      expect(body.graph).toBeDefined();
      expect(body.quality).toBeDefined();
      expect(body.trace).toBeDefined();
    });

    it("includes readiness factors in rejection response", async () => {
      // Brief without decision language - will have low decision_relevance
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers,
        payload: {
          brief: "The building has windows and doors and multiple floors and rooms inside.",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();

      expect(body.details).toBeDefined();
      expect(body.details.factors).toBeDefined();
      // Factors object should have numeric scores
      const factors = body.details.factors;
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
        url: "/assist/v1/draft-graph",
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
        url: "/assist/v1/draft-graph",
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

    it("preflight rejection takes precedence over clarification requirement", async () => {
      // Gibberish input fails preflight validation (not readiness threshold)
      // This triggers preflight.valid = false, which means readiness = 0
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

      // Should be preflight rejection due to gibberish detection
      expect(body.code).toBe("CEE_VALIDATION_FAILED");
      expect(body.details.rejection_reason).toBe("preflight_rejected");
      expect(body.details.readiness_score).toBe(0);
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
});
