/**
 * Field Deletion Telemetry Cap Tests
 *
 * Validates that recordFieldDeletions() enforces MAX_FIELD_DELETIONS_PER_STAGE
 * to prevent pathological inputs from bloating the trace payload.
 */
import { describe, it, expect } from "vitest";
import {
  fieldDeletion,
  recordFieldDeletions,
  MAX_FIELD_DELETIONS_PER_STAGE,
  type FieldDeletionEvent,
} from "../../src/cee/unified-pipeline/utils/field-deletion-audit.js";

// =============================================================================
// Helpers
// =============================================================================

function makeEvents(count: number, stage: string): FieldDeletionEvent[] {
  return Array.from({ length: count }, (_, i) =>
    fieldDeletion(stage, `node_${i}`, `data.field_${i}`, "EXTERNAL_HAS_DATA"),
  );
}

function makeCtx(): { fieldDeletions?: FieldDeletionEvent[] } {
  return {};
}

// =============================================================================
// Tests
// =============================================================================

describe("recordFieldDeletions cap enforcement", () => {
  it("records all events when count is under the cap", () => {
    const ctx = makeCtx();
    const events = makeEvents(10, "deterministic-sweep");
    recordFieldDeletions(ctx, "deterministic-sweep", events);

    expect(ctx.fieldDeletions).toHaveLength(10);
    expect(ctx.fieldDeletions!.every((e) => e.reason !== "TELEMETRY_CAP_REACHED")).toBe(true);
  });

  it("records exactly MAX + 1 entries when input exceeds cap (50 events + 1 summary)", () => {
    const ctx = makeCtx();
    const events = makeEvents(60, "deterministic-sweep");
    recordFieldDeletions(ctx, "deterministic-sweep", events);

    expect(ctx.fieldDeletions).toHaveLength(MAX_FIELD_DELETIONS_PER_STAGE + 1);

    // Last entry is the truncation summary
    const last = ctx.fieldDeletions![ctx.fieldDeletions!.length - 1];
    expect(last.reason).toBe("TELEMETRY_CAP_REACHED");
    expect(last.node_id).toBe("__truncated__");
    expect(last.field).toBe("*");
    expect(last.stage).toBe("deterministic-sweep");
    expect(last.meta).toEqual({ total: 60, captured: MAX_FIELD_DELETIONS_PER_STAGE });
  });

  it("records exactly MAX + 1 entries when input is exactly at cap boundary", () => {
    const ctx = makeCtx();
    // Exactly at cap → no truncation
    const events = makeEvents(MAX_FIELD_DELETIONS_PER_STAGE, "threshold-sweep");
    recordFieldDeletions(ctx, "threshold-sweep", events);

    expect(ctx.fieldDeletions).toHaveLength(MAX_FIELD_DELETIONS_PER_STAGE);
    expect(ctx.fieldDeletions!.every((e) => e.reason !== "TELEMETRY_CAP_REACHED")).toBe(true);
  });

  it("caps accumulate correctly across multiple calls for same stage", () => {
    const ctx = makeCtx();

    // First batch: 40 events (under cap)
    recordFieldDeletions(ctx, "structural-reconciliation", makeEvents(40, "structural-reconciliation"));
    expect(ctx.fieldDeletions).toHaveLength(40);

    // Second batch: 20 more events → 40 + 10 captured + 1 summary = 51
    recordFieldDeletions(ctx, "structural-reconciliation", makeEvents(20, "structural-reconciliation"));
    expect(ctx.fieldDeletions).toHaveLength(MAX_FIELD_DELETIONS_PER_STAGE + 1);

    const capEvent = ctx.fieldDeletions!.find((e) => e.reason === "TELEMETRY_CAP_REACHED");
    expect(capEvent).toBeDefined();
    expect(capEvent!.meta).toEqual({ total: 60, captured: MAX_FIELD_DELETIONS_PER_STAGE });
  });

  it("ignores further calls for a stage after cap has been reached", () => {
    const ctx = makeCtx();

    recordFieldDeletions(ctx, "deterministic-sweep", makeEvents(60, "deterministic-sweep"));
    const countAfterFirst = ctx.fieldDeletions!.length;

    // Third-party attempt to add more events for the same stage
    recordFieldDeletions(ctx, "deterministic-sweep", makeEvents(10, "deterministic-sweep"));
    expect(ctx.fieldDeletions).toHaveLength(countAfterFirst);
  });

  it("caps are independent per stage", () => {
    const ctx = makeCtx();

    // Fill stage A past cap
    recordFieldDeletions(ctx, "deterministic-sweep", makeEvents(60, "deterministic-sweep"));
    const countA = ctx.fieldDeletions!.length;
    expect(countA).toBe(MAX_FIELD_DELETIONS_PER_STAGE + 1);

    // Stage B should still accept events independently
    recordFieldDeletions(ctx, "threshold-sweep", makeEvents(10, "threshold-sweep"));
    expect(ctx.fieldDeletions).toHaveLength(countA + 10);

    // No TELEMETRY_CAP_REACHED for stage B
    const capEventsB = ctx.fieldDeletions!.filter(
      (e) => e.stage === "threshold-sweep" && e.reason === "TELEMETRY_CAP_REACHED",
    );
    expect(capEventsB).toHaveLength(0);
  });

  it("does nothing for empty event arrays", () => {
    const ctx = makeCtx();
    recordFieldDeletions(ctx, "deterministic-sweep", []);
    expect(ctx.fieldDeletions).toBeUndefined();
  });

  it("MAX_FIELD_DELETIONS_PER_STAGE is 50", () => {
    expect(MAX_FIELD_DELETIONS_PER_STAGE).toBe(50);
  });
});
