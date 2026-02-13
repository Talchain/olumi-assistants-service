/**
 * CIL Step 12: Qualitative Brief Lifecycle Tests
 *
 * Fixture-based integration tests verifying analysis_ready invariants
 * across the full draft-graph pipeline. The fixture provider returns
 * a deterministic graph regardless of brief content, so these tests
 * verify structural invariants rather than brief-specific outcomes.
 *
 * KEY INVARIANTS:
 * - analysis_ready.status is always a valid AnalysisReadyStatus
 * - Every blocker.factor_id resolves to a node in the graph
 * - Every blocker has a non-empty message
 * - Options with non-empty interventions are never "needs_user_mapping"
 * - Enrichment runs exactly once (Pipeline B only, no Pipeline A duplicate)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("CIL Step 12: Qualitative Lifecycle", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("LLM_PROVIDER", "fixtures");
    vi.stubEnv("ASSIST_API_KEYS", "test-key-lifecycle");
    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Helper: POST to draft-graph and return parsed V3 body.
   */
  async function draftGraph(brief: string) {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph?schema=v3",
      headers: {
        "Content-Type": "application/json",
        "X-Olumi-Assist-Key": "test-key-lifecycle",
      },
      payload: JSON.stringify({ brief }),
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body);
  }

  describe("analysis_ready structural invariants", () => {
    it("fixture graph produces valid analysis_ready with status and options", async () => {
      const body = await draftGraph("Should we hire a tech lead or promote internally?");

      expect(body.schema_version).toBe("3.0");
      expect(body.analysis_ready).toBeDefined();
      const ar = body.analysis_ready;

      // Status must be a valid AnalysisReadyStatus
      expect(["ready", "needs_user_input", "needs_user_mapping", "needs_encoding"]).toContain(ar.status);

      // Options must be present and non-empty
      expect(Array.isArray(ar.options)).toBe(true);
      expect(ar.options.length).toBeGreaterThan(0);

      // Each option has valid status
      for (const opt of ar.options) {
        expect(["ready", "needs_user_mapping", "needs_encoding"]).toContain(opt.status);
        expect(opt.id).toBeTruthy();
        expect(opt.label).toBeTruthy();
      }
    });

    it("every blocker.factor_id resolves to a graph node", async () => {
      const body = await draftGraph("Should we expand into the US market?");

      const ar = body.analysis_ready;
      const blockers = ar.blockers ?? [];
      const nodeIds = new Set((body.nodes ?? []).map((n: any) => n.id));

      for (const blocker of blockers) {
        expect(blocker.message).toBeTruthy();
        if (blocker.factor_id) {
          expect(nodeIds.has(blocker.factor_id)).toBe(true);
        }
      }
    });

    it("options with non-empty interventions are never needs_user_mapping", async () => {
      const body = await draftGraph("Should we raise prices from £49 to £59 to increase revenue?");

      const ar = body.analysis_ready;
      for (const opt of ar.options) {
        const interventionCount = Object.keys(opt.interventions ?? {}).length;
        if (interventionCount > 0) {
          expect(opt.status).not.toBe("needs_user_mapping");
        }
      }
    });
  });

  describe("enrichment single-call verification", () => {
    it("trace.pipeline.enrich shows exactly 1 call from Pipeline B", async () => {
      const body = await draftGraph("Should we automate our deployment pipeline?");

      const enrich = body.trace?.pipeline?.enrich;
      // If enrichment trace is present, verify single-call semantics
      if (enrich) {
        expect(enrich.called_count).toBe(1);
        expect(typeof enrich.extraction_mode).toBe("string");
        expect(enrich.source).toBe("pipeline_b");
      }
    });
  });

  describe("needs_user_input is payload-level only", () => {
    it("no option has needs_user_input status", async () => {
      const body = await draftGraph("Should we hire more staff or outsource?");

      const ar = body.analysis_ready;
      for (const opt of ar.options) {
        expect(opt.status).not.toBe("needs_user_input");
      }
    });
  });
});
