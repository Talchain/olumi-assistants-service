/**
 * MM P1 (ROADMAP 1.25 hygiene batch, item 7 — readResultRecords read-order
 * cleanup).
 *
 * PLoT's actual `/v2/run` wire response emits `option_comparison[]`, never
 * a top-level `results[]` — verified against `plot-lite-service`
 * `origin/staging` (`3cf5433`) `src/routes/v2/run.ts` (no `results` key is
 * ever set on the outbound envelope) and against CEE's own
 * `V2RunResponseMinimal` schema comment in `src/orchestrator/plot-client.ts`
 * ("PLoT returns option data in `option_comparison` (not `results`)").
 * `readResultRecords` previously preferred `results` when both were
 * populated; since PLoT never populates `results`, this was a dead
 * precedence branch that also mis-documented `results` as "canonical".
 * These tests pin the corrected precedence and the (unaffected)
 * single-key/neither-key branches.
 */
import { describe, it, expect } from "vitest";
import { readResultRecords } from "../../../../../src/orchestrator-v5/tools/handlers/run-analysis.js";
import type { V2RunResponseEnvelope } from "../../../../../src/orchestrator/types.js";

function envelope(fields: Record<string, unknown>): V2RunResponseEnvelope {
  return fields as unknown as V2RunResponseEnvelope;
}

describe("readResultRecords (ROADMAP 1.25 item 7)", () => {
  it("prefers option_comparison[] when BOTH keys are populated (the shape PLoT actually emits)", () => {
    const result = readResultRecords(
      envelope({
        option_comparison: [{ option_id: "opt_a", win_probability: 0.6 }],
        results: [{ option_id: "opt_stale", win_probability: 0.4 }],
      }),
    );
    expect(result).toEqual([{ option_id: "opt_a", win_probability: 0.6 }]);
  });

  it("falls back to results[] when only results is populated (defensive-tolerance branch, unaffected by the reorder)", () => {
    const result = readResultRecords(
      envelope({ results: [{ option_id: "opt_a", win_probability: 0.6 }] }),
    );
    expect(result).toEqual([{ option_id: "opt_a", win_probability: 0.6 }]);
  });

  it("reads option_comparison[] when only it is populated (the real-world PLoT shape)", () => {
    const result = readResultRecords(
      envelope({ option_comparison: [{ option_id: "opt_a", win_probability: 0.6 }] }),
    );
    expect(result).toEqual([{ option_id: "opt_a", win_probability: 0.6 }]);
  });

  it("returns [] when neither key is populated", () => {
    expect(readResultRecords(envelope({}))).toEqual([]);
  });

  it("returns [] when both keys are present but empty", () => {
    expect(readResultRecords(envelope({ results: [], option_comparison: [] }))).toEqual([]);
  });

  it("filters non-record entries out of whichever array is selected", () => {
    const result = readResultRecords(
      envelope({ option_comparison: [{ option_id: "opt_a" }, null, "not-a-record", 42] }),
    );
    expect(result).toEqual([{ option_id: "opt_a" }]);
  });
});
