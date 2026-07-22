/**
 * CEE → UI wire-shape contract (analysis_result block enrichment).
 *
 * Installed from the olumi-schemas contract-test pack (contract-tests/
 * cee-to-ui.contract.test.ts @ main 5612e266, enrichment v1 rollout
 * step 2 — see that repo's docs/enrichment-v1/ROLLOUT.md and
 * contract-tests/README.md §CEE lane). Requires @talchain/schemas ≥ 0.14.0.
 *
 * CEE reduces the persisted 40-key PLoT envelope to the P0-B safe-transport
 * keep-list before it ships on `analysis_result` blocks
 * (src/orchestrator-v5/compose.ts: toSafeTransportEnrichment +
 * stripInternalKeysDeep). This contract pins:
 *
 *   1. THE DRIFT BOLT: compose.ts `P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP`
 *      equals `CEE_UI_ENRICHMENT_KEEP_LIST` from @talchain/schemas
 *      element-for-element — the schemas package is the cross-repo source
 *      of truth (the UI's contract test reads the same constant), so the
 *      two lists must never drift,
 *   2. the REAL projection (imported from compose.ts, not a mirror) parses
 *      against AnalysisEnrichmentSchema,
 *   3. internal carriers never ship at any depth (the leak class the
 *      keep-list exists to stop), and
 *   4. keep-list membership pins for the UI's no-fallback reads.
 *
 * UI read-path evidence (DecisionGuideAI @ staging eeea43d2):
 *   - option_comparison_status — OutcomePanel.tsx (read, no fallback)
 *   - conditional_probabilities — read with no fallback (CEE keep-list
 *     closure review)
 *   - factor_sensitivity[].influence_score / sensitivity_score —
 *     debug exportBundle field resolvers
 *   - block enrichment container — src/v5/extractPhase3FromV5Response.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AnalysisEnrichmentSchema,
  CEE_UI_ENRICHMENT_KEEP_LIST,
} from "@talchain/schemas/boundary";
import {
  P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP,
  toSafeTransportEnrichment,
} from "../../src/orchestrator-v5/compose.js";
import { ENRICHMENT_PRODUCER_MANIFEST } from "../../src/orchestrator-v5/context/enrichment-manifest.js";

const here = dirname(fileURLToPath(import.meta.url));
const crossServiceFixtures = join(here, "..", "fixtures", "cross-service");

/**
 * Keys CEE strips at ANY depth — assertion mirror of compose.ts
 * INTERNAL_ENRICHMENT_KEYS. This set is used to inspect the projection
 * OUTPUT (the projection itself is the real compose.ts function); keep it
 * in sync with compose.ts if the denylist grows.
 */
const INTERNAL_KEYS = new Set([
  "_meta", "meta", "_diagnostics", "ceeTrace", "cee_trace", "debug",
  "payloads", "downstream_calls", "graph", "graph_hash", "graph_hash_at_run",
  "feature_flags", "feature_flags_snapshot", "lineage", "seed",
  "isl_response", "isl_engine",
]);

const turnFixture = JSON.parse(
  readFileSync(
    join(crossServiceFixtures, "v5-turn.run-analysis.staging.json"),
    "utf-8",
  ),
) as { blocks: Array<Record<string, unknown>> };
const analysisBlock = turnFixture.blocks.find(
  (b) => b.type === "analysis_result",
);
if (!analysisBlock) {
  throw new Error(
    "v5-turn.run-analysis.staging.json no longer carries an analysis_result block — re-capture the fixture",
  );
}
const persisted = analysisBlock.enrichment as Record<string, unknown>;
const projected = toSafeTransportEnrichment(persisted);
if (!projected) {
  throw new Error(
    "toSafeTransportEnrichment returned undefined for the staging capture — the capture should carry kept fields",
  );
}

describe("CEE→UI: keep-list drift bolt (schemas package is the source of truth)", () => {
  it("compose.ts P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP === @talchain/schemas CEE_UI_ENRICHMENT_KEEP_LIST, element-for-element", () => {
    expect([...P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP]).toEqual([
      ...CEE_UI_ENRICHMENT_KEEP_LIST,
    ]);
  });
});

describe("CEE→UI: keep-list is anchored to the PLoT PRODUCER manifest (context-audit #1 row #1)", () => {
  // The original drift bolt compares CEE-copy == schemas-copy ONLY — it stays
  // green while BOTH mirror copies omit a real new PLoT field (it never looks
  // at the producer). Anchor the keep-list to ENRICHMENT_PRODUCER_MANIFEST
  // (the PLoT /v2/run RunResponseV3 top-level field set) so a kept key that is
  // NOT a real producer field — a drifted/renamed/removed-upstream key — goes
  // RED here instead of silently shipping an always-absent key to the UI.
  it("every kept key is a real PLoT producer field", () => {
    const notEmitted = P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP.filter(
      (key) => !ENRICHMENT_PRODUCER_MANIFEST.has(key),
    );
    expect(notEmitted).toEqual([]);
  });

  it("POSITIVE CONTROL — the producer check SEES a keep-list key absent from the manifest", () => {
    // Prove the subset check can detect a violation (doctrine trap #13):
    // a hypothetical kept key PLoT never emits must be flagged.
    const withPhantom = [...P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP, "ghost_field_plot_never_emits"];
    const notEmitted = withPhantom.filter((key) => !ENRICHMENT_PRODUCER_MANIFEST.has(key));
    expect(notEmitted).toContain("ghost_field_plot_never_emits");
  });
});

describe("CEE→UI: keep-list projection (real compose.ts toSafeTransportEnrichment)", () => {
  it("parses against AnalysisEnrichmentSchema", () => {
    const result = AnalysisEnrichmentSchema.safeParse(projected);
    if (!result.success) throw new Error(result.error.message);
    expect(result.success).toBe(true);
  });

  it("carries every UI no-fallback read present on the source envelope", () => {
    // option_comparison_status: OutcomePanel read.
    expect(projected.option_comparison_status).toBe(
      persisted.option_comparison_status,
    );
    // factor_sensitivity influence/sensitivity scores: exportBundle resolvers.
    const fs = projected.factor_sensitivity as Array<Record<string, unknown>>;
    expect(fs.length).toBeGreaterThan(0);
    expect(typeof fs[0].influence_score).toBe("number");
    expect(typeof fs[0].sensitivity_score).toBe("number");
  });

  it("ships NO internal carrier at any depth (leak pin)", () => {
    const violations: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, `${path}[${i}]`));
      } else if (value !== null && typeof value === "object") {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (INTERNAL_KEYS.has(k)) violations.push(`${path}.${k}`);
          walk(v, `${path}.${k}`);
        }
      } else if (typeof value === "string" && value.includes("[REDACTED]")) {
        violations.push(`${path} carries [REDACTED]`);
      }
    };
    walk(projected, "$");
    expect(violations).toEqual([]);
  });

  it("drops the non-keep-listed keys (they exist on the persisted fact, not the wire)", () => {
    for (const droppedKey of [
      "m1_coaching",
      "_meta",
      "meta",
      "downstream_calls",
      "fact_objects",
      "critiques",
    ]) {
      expect(projected, `${droppedKey} must not ship`).not.toHaveProperty(
        droppedKey,
      );
    }
  });

  // Wave-2 ask 3 (0.19.0): decision_brief joined the keep-list — the UI's
  // leader-band consumer (DGAI #291/#292) shipped contract-pinned and never
  // fired because this key was stripped. The lineage-leak reason for the
  // original omission is the mutation-check built into this test: the
  // PERSISTED staging capture really carries `seed` and `graph_hash` inside
  // the brief (asserted below as positive controls), so if
  // stripInternalKeysDeep ever stops discriminating, the not-shipped
  // assertions go red.
  it("ships decision_brief WITH its internal lineage stripped (0.19.0, through the REAL projection)", () => {
    const persistedBrief = persisted.decision_brief as Record<string, unknown>;
    // Positive controls — the source really carries the internal keys.
    expect(persistedBrief).toHaveProperty("seed");
    expect(persistedBrief).toHaveProperty("graph_hash");
    // The real projection ships the brief…
    const shipped = projected.decision_brief as Record<string, unknown>;
    expect(shipped).toBeDefined();
    expect(shipped.headline).toBe(persistedBrief.headline);
    expect(shipped.options).toEqual(persistedBrief.options);
    // …minus the internal carriers, at any depth.
    expect(shipped).not.toHaveProperty("seed");
    expect(shipped).not.toHaveProperty("graph_hash");
  });
});

describe("CEE→UI: keep-list membership pins", () => {
  it("conditional_probabilities and results stay keep-listed (UI reads with no fallback)", () => {
    expect(CEE_UI_ENRICHMENT_KEEP_LIST).toContain("conditional_probabilities");
    expect(CEE_UI_ENRICHMENT_KEEP_LIST).toContain("results");
  });

  it("m1_coaching stays DEFERRED (carries internal isl_engine provenance token)", () => {
    expect(CEE_UI_ENRICHMENT_KEEP_LIST).not.toContain("m1_coaching");
  });

  it("decision_brief is keep-listed (0.19.0, wave-2 ask 3)", () => {
    expect(CEE_UI_ENRICHMENT_KEEP_LIST).toContain("decision_brief");
  });

  it("keep-list is exactly the CEE compose.ts P0B list (12 keys)", () => {
    expect(CEE_UI_ENRICHMENT_KEEP_LIST).toHaveLength(12);
  });
});
