/**
 * PLoT → CEE wire-shape contract (/v2/run envelope → run_analysis fact).
 *
 * Installed from the olumi-schemas contract-test pack (contract-tests/
 * plot-to-cee.contract.test.ts @ main 5612e266, enrichment v1 rollout
 * step 2 — see that repo's docs/enrichment-v1/ROLLOUT.md and
 * contract-tests/README.md §CEE lane). Requires @talchain/schemas ≥ 0.14.0.
 *
 * CEE's run_analysis handler persists the PLoT /v2/run response
 * BYTE-FOR-BYTE as RunAnalysisHandlerFact.result.enrichment (F.6 handler-
 * ownership invariant). This contract pins:
 *
 *   1. the envelope parses against AnalysisEnrichmentSchema (typed since
 *      @talchain/schemas 0.14.0 — malformed known keys now fail loudly
 *      instead of flowing silently), and
 *   2. every load-bearing CEE read-path exists on the wire, and
 *   3. fields CEE reads but the producer does NOT emit stay pinned absent
 *      (the silent-empty class), so a producer change flips a test rather
 *      than a dashboard.
 *
 * Evidence:
 *   - REAL staging capture: tests/fixtures/cross-service/
 *     v5-turn.run-analysis.staging.json (blocks[0].enrichment carries the
 *     full 40-key persisted PLoT envelope; provenance in the adjacent
 *     .metadata.json / fixture-metadata.json). Never hand-edit; refresh by
 *     re-capturing.
 *   - CODE-DERIVED doctrine-B fixture: tests/fixtures/cross-service/
 *     plot-to-cee.doctrine-b.code-derived.json (post-PR #202–#205
 *     vocabulary the capture predates; replace with a live capture when a
 *     constraint-bearing analysis is exercised on staging).
 *
 * CEE read-paths pinned here: src/orchestrator-v5/tools/handlers/
 * run-analysis.ts (readAnalysisStatus, readResultRecords,
 * extractWinProbabilities, selectLeadingOptionId,
 * buildAnalysisResultHeadline).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AnalysisEnrichmentSchema } from "@talchain/schemas/boundary";

const here = dirname(fileURLToPath(import.meta.url));
const crossServiceFixtures = join(here, "..", "fixtures", "cross-service");

function loadJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(crossServiceFixtures, name), "utf-8"));
}

// REAL capture: the persisted PLoT envelope rides on the analysis_result
// block of the captured turn response (full 40-key shape at this seam).
const turnFixture = loadJson("v5-turn.run-analysis.staging.json") as {
  blocks: Array<Record<string, unknown>>;
};
const analysisBlock = turnFixture.blocks.find(
  (b) => b.type === "analysis_result",
);
if (!analysisBlock) {
  throw new Error(
    "v5-turn.run-analysis.staging.json no longer carries an analysis_result block — re-capture the fixture",
  );
}
const captured = analysisBlock.enrichment as Record<string, unknown>;

const doctrineFixture = loadJson("plot-to-cee.doctrine-b.code-derived.json");
const doctrineB = doctrineFixture.enrichment as Record<string, unknown>;
const suppressed = doctrineFixture.enrichment_suppressed_variant as Record<
  string,
  unknown
>;

describe("PLoT→CEE: envelope validates against the typed schema", () => {
  it.each([
    ["staging capture (real wire)", captured],
    ["doctrine-B delivered (code-derived)", doctrineB],
    ["doctrine-B suppressed variant (code-derived)", suppressed],
  ])("%s parses", (_name, envelope) => {
    const result = AnalysisEnrichmentSchema.safeParse(envelope);
    if (!result.success) throw new Error(result.error.message);
    expect(result.success).toBe(true);
  });
});

describe("PLoT→CEE: load-bearing CEE read-paths exist on the wire", () => {
  it("analysis_status present (readAnalysisStatus gates the whole fact)", () => {
    expect(typeof captured.analysis_status).toBe("string");
  });

  it("option_comparison[] carries option_id + win_probability (readResultRecords/extractWinProbabilities)", () => {
    const oc = captured.option_comparison as Array<Record<string, unknown>>;
    expect(oc.length).toBeGreaterThan(0);
    for (const record of oc) {
      expect(typeof record.option_id).toBe("string");
      expect(typeof record.win_probability).toBe("number");
    }
  });

  it("factor_sensitivity[] carries factor_id (+label) for the headline builder and driver projection", () => {
    const fs = captured.factor_sensitivity as Array<Record<string, unknown>>;
    expect(fs.length).toBeGreaterThan(0);
    for (const record of fs) {
      expect(typeof record.factor_id).toBe("string");
    }
  });

  it("robustness.fragile_edges available for fragility phrasing", () => {
    const robustness = captured.robustness as Record<string, unknown>;
    expect(Array.isArray(robustness.fragile_edges)).toBe(true);
  });

  it("meta.computed_at present (freshness derivation input)", () => {
    const meta = captured.meta as Record<string, unknown>;
    expect(typeof meta.computed_at).toBe("string");
  });
});

describe("PLoT→CEE: consumer reads the producer does NOT emit (pinned absences)", () => {
  it("`results` is NOT emitted by /v2/run — CEE readResultRecords PREFERS it; if this starts failing, PLoT began emitting `results` and CEE read-order must be re-verified deliberately", () => {
    expect(captured).not.toHaveProperty("results");
    expect(doctrineB).not.toHaveProperty("results");
  });

  it("robustness.recommendation_stability no longer emitted on current builds (lane H item B) — tolerated inbound only", () => {
    // The 2026-04 capture PREDATES the removal, so assert on the
    // doctrine-B (current-code-derived) fixture; the capture stays as
    // documentation of the old wire for inbound tolerance.
    const currentRobustness = doctrineB.robustness as Record<string, unknown>;
    expect(currentRobustness).not.toHaveProperty("recommendation_stability");
  });

  it("doctrine-B suppressed variant withholds constraint numbers entirely (PLoT PR #205)", () => {
    expect(suppressed.constraints_status).toBe("unavailable");
    expect(suppressed).not.toHaveProperty("constraint_results");
    expect(suppressed).not.toHaveProperty("conditional_probabilities");
    const oc = (suppressed.option_comparison as Array<Record<string, unknown>>)[0];
    expect(oc).not.toHaveProperty("probability_of_joint_goal");
    expect(oc).not.toHaveProperty("constraint_probabilities");
  });
});
