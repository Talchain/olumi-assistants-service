import { describe, it, expect } from "vitest";
import { TelemetryEvents, VALID_EVENT_NAMES } from "../../src/utils/telemetry.js";

/**
 * Telemetry Event Freeze (M3 - CI Gate)
 *
 * These tests enforce that telemetry event names remain frozen and cannot
 * be accidentally changed without updating dashboards and alerts.
 *
 * **Why this matters:**
 * - Datadog dashboards query specific event names
 * - Alerts are configured for specific metrics
 * - Historical data uses these event names
 * - Changing an event name breaks observability
 *
 * **If you need to add a new event:**
 * 1. Add to TelemetryEvents enum in src/utils/telemetry.ts
 * 2. Update the snapshot in this test
 * 3. Update Datadog dashboard JSON (observability/dashboards/)
 * 4. Document in observability/README.md
 *
 * **If you need to rename an event:**
 * 1. DO NOT rename - create a new event instead
 * 2. Keep old event emitting for 30 days (deprecation period)
 * 3. Add deprecation notice in telemetry.ts
 * 4. Update dashboards to use new event name
 * 5. After 30 days, remove old event
 */

describe("Telemetry Events (Frozen Enum - M3)", () => {
  describe("Event name stability", () => {
    it("freezes all telemetry event names to prevent accidental changes", () => {
      // This snapshot ensures event names never change without explicit approval
      // If this test fails, you've changed an event name - update dashboards first!
      const eventSnapshot = {
        DraftStarted: "assist.draft.started",
        DraftCompleted: "assist.draft.completed",

        SSEStarted: "assist.draft.sse_started",
        SSECompleted: "assist.draft.sse_completed",
        SSEError: "assist.draft.sse_error",
        FixtureShown: "assist.draft.fixture_shown",
        FixtureReplaced: "assist.draft.fixture_replaced",

        ValidationFailed: "assist.draft.validation_failed",
        RepairAttempted: "assist.draft.repair_attempted",
        RepairStart: "assist.draft.repair_start",
        RepairSuccess: "assist.draft.repair_success",
        RepairPartial: "assist.draft.repair_partial",
        RepairFallback: "assist.draft.repair_fallback",

        LegacyProvenance: "assist.draft.legacy_provenance",

        Stage: "assist.draft.stage",
      };

      // Ensure TelemetryEvents matches the snapshot exactly
      expect(TelemetryEvents).toEqual(eventSnapshot);
    });

    it("validates that VALID_EVENT_NAMES set matches enum values", () => {
      const enumValues = Object.values(TelemetryEvents);
      const setValues = Array.from(VALID_EVENT_NAMES).sort();

      expect(setValues).toEqual(enumValues.sort());
    });

    it("ensures no duplicate event names exist", () => {
      const eventNames = Object.values(TelemetryEvents);
      const uniqueNames = new Set(eventNames);

      expect(uniqueNames.size).toBe(eventNames.length);
    });
  });

  describe("Event namespace consistency", () => {
    it("ensures all events start with 'assist.draft.' prefix", () => {
      const allEvents = Object.values(TelemetryEvents);

      for (const event of allEvents) {
        expect(event).toMatch(/^assist\.draft\./);
      }
    });

    it("uses snake_case for event suffixes (not camelCase)", () => {
      const allEvents = Object.values(TelemetryEvents);

      // Check that no events use camelCase after the prefix
      for (const event of allEvents) {
        const suffix = event.replace("assist.draft.", "");

        // Should not contain capital letters (camelCase indicator)
        expect(suffix).not.toMatch(/[A-Z]/);

        // Should use underscores, not hyphens
        if (suffix.includes("_")) {
          expect(suffix).not.toMatch(/-/);
        }
      }
    });
  });

  describe("Critical events coverage", () => {
    it("has core lifecycle events (started, completed)", () => {
      expect(TelemetryEvents.DraftStarted).toBe("assist.draft.started");
      expect(TelemetryEvents.DraftCompleted).toBe("assist.draft.completed");
    });

    it("has SSE streaming events for fixture tracking", () => {
      expect(TelemetryEvents.SSEStarted).toBe("assist.draft.sse_started");
      expect(TelemetryEvents.SSECompleted).toBe("assist.draft.sse_completed");
      expect(TelemetryEvents.SSEError).toBe("assist.draft.sse_error");
      expect(TelemetryEvents.FixtureShown).toBe("assist.draft.fixture_shown");
      expect(TelemetryEvents.FixtureReplaced).toBe("assist.draft.fixture_replaced");
    });

    it("has validation and repair events for quality tracking", () => {
      expect(TelemetryEvents.ValidationFailed).toBe("assist.draft.validation_failed");
      expect(TelemetryEvents.RepairAttempted).toBe("assist.draft.repair_attempted");
      expect(TelemetryEvents.RepairStart).toBe("assist.draft.repair_start");
      expect(TelemetryEvents.RepairSuccess).toBe("assist.draft.repair_success");
      expect(TelemetryEvents.RepairPartial).toBe("assist.draft.repair_partial");
      expect(TelemetryEvents.RepairFallback).toBe("assist.draft.repair_fallback");
    });

    it("has deprecation tracking event", () => {
      expect(TelemetryEvents.LegacyProvenance).toBe("assist.draft.legacy_provenance");
    });

    it("has debug stage event", () => {
      expect(TelemetryEvents.Stage).toBe("assist.draft.stage");
    });
  });

  describe("Datadog metric alignment", () => {
    it("documents which events map to Datadog metrics", () => {
      // This serves as documentation for dashboard creators
      const datadogMetrics = {
        // Counters
        "draft.started": [TelemetryEvents.DraftStarted],
        "draft.completed": [TelemetryEvents.DraftCompleted],
        "draft.sse.started": [TelemetryEvents.SSEStarted],
        "draft.sse.completed": [TelemetryEvents.SSECompleted],
        "draft.sse.errors": [TelemetryEvents.SSEError],
        "draft.validation.failed": [TelemetryEvents.ValidationFailed],
        "draft.repair.attempted": [TelemetryEvents.RepairAttempted, TelemetryEvents.RepairStart],
        "draft.repair.success": [TelemetryEvents.RepairSuccess],
        "draft.repair.partial": [TelemetryEvents.RepairPartial],
        "draft.repair.fallback": [TelemetryEvents.RepairFallback],
        "draft.legacy_provenance.occurrences": [TelemetryEvents.LegacyProvenance],
        "draft.fixture.shown": [TelemetryEvents.FixtureShown],
        "draft.fixture.replaced": [TelemetryEvents.FixtureReplaced],

        // Histograms
        "draft.latency_ms": [TelemetryEvents.DraftCompleted],
        "draft.sse.stream_duration_ms": [TelemetryEvents.SSECompleted],
        "draft.confidence": [TelemetryEvents.DraftCompleted],
        "draft.cost_usd": [TelemetryEvents.DraftCompleted],

        // Gauges
        "draft.graph.nodes": [TelemetryEvents.DraftCompleted],
        "draft.graph.edges": [TelemetryEvents.DraftCompleted],
        "draft.validation.violations": [TelemetryEvents.ValidationFailed],
        "draft.legacy_provenance.percentage": [TelemetryEvents.LegacyProvenance],
      };

      // Verify all events are documented
      const allEvents = Object.values(TelemetryEvents);
      const documentedEvents = new Set(
        Object.values(datadogMetrics).flat()
      );

      // Stage events are debug-only, don't need Datadog metrics
      const debugOnlyEvents: string[] = [TelemetryEvents.Stage];

      for (const event of allEvents) {
        if (!debugOnlyEvents.includes(event)) {
          expect(documentedEvents).toContain(event);
        }
      }
    });
  });

  describe("Spec v04 compliance", () => {
    it("matches frozen event names from specification v04", () => {
      // These event names are specified in the v04 specification
      // and must not change without updating the spec document
      const specV04Events = [
        "assist.draft.started",
        "assist.draft.completed",
        "assist.draft.sse_started",
        "assist.draft.sse_completed",
        "assist.draft.sse_error",
        "assist.draft.fixture_shown",
        "assist.draft.fixture_replaced",
        "assist.draft.validation_failed",
        "assist.draft.repair_attempted",
        "assist.draft.repair_start",
        "assist.draft.repair_success",
        "assist.draft.repair_partial",
        "assist.draft.repair_fallback",
        "assist.draft.legacy_provenance",
        "assist.draft.stage",
      ];

      const actualEvents = Object.values(TelemetryEvents).sort();
      expect(actualEvents).toEqual(specV04Events.sort());
    });
  });
});
