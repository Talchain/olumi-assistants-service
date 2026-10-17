import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "../../src/server.js";
import type { FastifyInstance } from "fastify";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("v1 SSE Stream Integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.LLM_PROVIDER = "fixtures";
    delete process.env.ASSIST_API_KEY;
    delete process.env.ASSIST_API_KEYS;
    cleanBaseUrl();

    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("v1 stream endpoint", () => {
    it("should return 410 for legacy /assist/draft-graph/stream", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/stream",
        headers: { "content-type": "application/json" },
        payload: { brief: "Should get 410" },
      });

      expect(response.statusCode).toBe(410);
    });

    it("should return 410 for legacy /assist/draft-graph/resume", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/resume",
        headers: { "x-resume-token": "any-token" },
      });

      expect(response.statusCode).toBe(410);
    });
  });

  describe("SSE Telemetry", () => {
    it("should verify SSE-related telemetry events are defined", async () => {
      const { TelemetryEvents } = await import("../../src/utils/telemetry.js");

      expect(TelemetryEvents.SseResumeLiveStart).toBeDefined();
      expect(TelemetryEvents.SseResumeLiveContinue).toBeDefined();
      expect(TelemetryEvents.SseResumeLiveEnd).toBeDefined();
      expect(TelemetryEvents.SseSnapshotRenewed).toBeDefined();
    });
  });
});
