import { describe, it, expect } from "vitest";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OrchestratorStreamEventSchema } from "../../../../src/orchestrator/pipeline/stream-events.js";

const FIXTURES_DIR = resolve(__dirname, "../../../fixtures/streaming");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, name), "utf-8"));
}

// ============================================================================
// Stream event fixtures — each is an array of OrchestratorStreamEvent
// ============================================================================

const STREAM_FIXTURES = [
  "deterministic.json",
  "llm-only.json",
  "llm-plus-tool.json",
  "error-mid-llm.json",
  "error-mid-tool.json",
  "disconnect.json",
] as const;

describe("OrchestratorStreamEventSchema", () => {
  for (const fixture of STREAM_FIXTURES) {
    describe(fixture, () => {
      const events = loadFixture(fixture) as unknown[];

      it("validates every event against the schema", () => {
        for (const event of events) {
          const result = OrchestratorStreamEventSchema.safeParse(event);
          if (!result.success) {
            // Show which event failed for easier debugging
            expect.fail(
              `Event failed validation: ${JSON.stringify(event, null, 2)}\nErrors: ${JSON.stringify(result.error.flatten())}`,
            );
          }
        }
      });

      it("has monotonically increasing seq numbers", () => {
        const seqs = (events as Array<{ seq: number }>).map((e) => e.seq);
        for (let i = 1; i < seqs.length; i++) {
          expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
        }
      });

      it("starts with turn_start", () => {
        expect((events[0] as { type: string }).type).toBe("turn_start");
      });
    });
  }

  // Terminal event checks
  describe("terminal events", () => {
    it("deterministic ends with turn_complete", () => {
      const events = loadFixture("deterministic.json") as Array<{ type: string }>;
      expect(events[events.length - 1].type).toBe("turn_complete");
    });

    it("llm-only ends with turn_complete", () => {
      const events = loadFixture("llm-only.json") as Array<{ type: string }>;
      expect(events[events.length - 1].type).toBe("turn_complete");
    });

    it("llm-plus-tool ends with turn_complete", () => {
      const events = loadFixture("llm-plus-tool.json") as Array<{ type: string }>;
      expect(events[events.length - 1].type).toBe("turn_complete");
    });

    it("error-mid-llm ends with error", () => {
      const events = loadFixture("error-mid-llm.json") as Array<{ type: string }>;
      expect(events[events.length - 1].type).toBe("error");
    });

    it("error-mid-tool ends with error", () => {
      const events = loadFixture("error-mid-tool.json") as Array<{ type: string }>;
      expect(events[events.length - 1].type).toBe("error");
    });

    it("disconnect has no terminal event", () => {
      const events = loadFixture("disconnect.json") as Array<{ type: string }>;
      const last = events[events.length - 1].type;
      expect(last).not.toBe("turn_complete");
      expect(last).not.toBe("error");
    });
  });

  // Cached JSON is a single envelope, not a stream event array
  describe("cached-json.json", () => {
    it("is a valid envelope object (not an event array)", () => {
      const data = loadFixture("cached-json.json") as Record<string, unknown>;
      expect(data).toHaveProperty("turn_id");
      expect(data).toHaveProperty("assistant_text");
      expect(data).toHaveProperty("lineage");
      expect(Array.isArray(data)).toBe(false);
    });
  });

  // Parser hardening edge cases present in fixtures
  describe("parser hardening", () => {
    it("llm-only contains an empty delta", () => {
      const events = loadFixture("llm-only.json") as Array<{ type: string; delta?: string }>;
      const deltas = events.filter((e) => e.type === "text_delta");
      expect(deltas.some((d) => d.delta === "")).toBe(true);
    });

    it("disconnect contains unicode characters", () => {
      const events = loadFixture("disconnect.json") as Array<{ type: string; delta?: string }>;
      const deltas = events.filter((e) => e.type === "text_delta");
      const allText = deltas.map((d) => d.delta).join("");
      // Contains £/€ multi-currency
      expect(allText).toContain("£");
      expect(allText).toContain("€");
    });

    it("disconnect contains newlines in deltas", () => {
      const events = loadFixture("disconnect.json") as Array<{ type: string; delta?: string }>;
      const deltas = events.filter((e) => e.type === "text_delta");
      const allText = deltas.map((d) => d.delta).join("");
      expect(allText).toContain("\n");
    });

    it("tool_result uses slim schema only", () => {
      const events = loadFixture("llm-plus-tool.json") as Array<Record<string, unknown>>;
      const toolResults = events.filter((e) => e.type === "tool_result");
      for (const tr of toolResults) {
        // Only allowed keys: type, seq, tool_name, success, duration_ms
        const keys = Object.keys(tr);
        const allowed = new Set(["type", "seq", "tool_name", "success", "duration_ms"]);
        for (const key of keys) {
          expect(allowed.has(key)).toBe(true);
        }
        // Must NOT have rich payload fields
        expect(tr).not.toHaveProperty("blocks");
        expect(tr).not.toHaveProperty("analysis_response");
        expect(tr).not.toHaveProperty("guidance_items");
        expect(tr).not.toHaveProperty("applied_changes");
      }
    });
  });
});
